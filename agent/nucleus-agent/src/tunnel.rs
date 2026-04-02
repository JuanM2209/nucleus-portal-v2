use std::collections::HashMap;
use nucleus_common::messages::AgentToServer;
use tokio::io::{AsyncRead, AsyncWrite, AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn, error};

const TCP_BUF_SIZE: usize = 32 * 1024; // 32 KB

/// Ports that require TLS (the agent terminates TLS so the proxy can send plain HTTP)
const TLS_PORTS: &[u16] = &[443, 8443, 9443, 9090];
const TCP_CONNECT_TIMEOUT_SECS: u64 = 5;

/// Manages active tunnel sessions, bridging TCP connections to the WebSocket.
pub struct TunnelManager {
    sessions: HashMap<String, TunnelSession>,
    stream_to_session: HashMap<u32, String>,
    tx: mpsc::UnboundedSender<Message>,
}

struct TunnelSession {
    session_id: String,
    stream_id: u32,
    target_ip: String,
    target_port: u16,
    tcp_writer: Option<tokio::io::WriteHalf<TcpStream>>,
    reader_handle: Option<JoinHandle<()>>,
    bytes_tx: u64,
    bytes_rx: u64,
}

impl TunnelManager {
    pub fn new(tx: mpsc::UnboundedSender<Message>) -> Self {
        Self {
            sessions: HashMap::new(),
            stream_to_session: HashMap::new(),
            tx,
        }
    }

    /// Returns the number of currently active tunnel sessions.
    pub fn active_count(&self) -> u32 {
        self.sessions.len() as u32
    }

    /// Handle a `session.open` command from the backend.
    ///
    /// Connects to `target_ip:target_port` via TCP with a 5-second timeout,
    /// spawns a reader task that forwards TCP data as binary WS frames,
    /// Register a tunnel session and open TCP connection to the target.
    /// Browser proxy uses tcp_stream_open/data/close for per-request HTTP,
    /// but tunnel CLI sends binary frames directly to this TCP connection.
    pub async fn handle_session_open(
        &mut self,
        session_id: String,
        target_ip: String,
        target_port: u16,
        stream_id: u32,
    ) {
        info!(
            session_id = %session_id,
            target = %format!("{}:{}", target_ip, target_port),
            stream_id = stream_id,
            "Opening tunnel session"
        );

        // Prevent duplicate sessions
        if self.sessions.contains_key(&session_id) {
            warn!(session_id = %session_id, "Session already exists, ignoring duplicate open");
            return;
        }

        // Close any existing session to the same target to prevent stale stream_id conflicts.
        // This happens when tunnel CLI reconnects — new session gets a new stream_id but
        // old TCP reader task still sends data with the old stream_id.
        let stale: Vec<String> = self.sessions.iter()
            .filter(|(sid, s)| **sid != session_id && s.target_ip == target_ip && s.target_port == target_port)
            .map(|(sid, _)| sid.clone())
            .collect();
        for sid in stale {
            warn!(session_id = %sid, "Closing stale session for same target {}:{}", target_ip, target_port);
            self.handle_session_close(&sid).await;
        }

        // Don't open TCP yet — lazy connect on first data frame.
        // Binary frames from tunnel CLI trigger lazy_connect() in handle_data(),
        // which opens TCP and spawns the reader task. This ensures:
        // 1. SSH server banner doesn't arrive before PuTTY connects
        // 2. mbusd doesn't timeout waiting for data
        // 3. The TCP reader task uses the correct stream_id
        let session = TunnelSession {
            session_id: session_id.clone(),
            stream_id,
            target_ip,
            target_port,
            tcp_writer: None,
            reader_handle: None,
            bytes_tx: 0,
            bytes_rx: 0,
        };

        self.stream_to_session.insert(stream_id, session_id.clone());
        self.sessions.insert(session_id.clone(), session);

        self.send_session_ready(&session_id, stream_id);
    }

    /// Handle a `session.close` command from the backend.
    ///
    /// Closes the TCP connection, aborts the reader task, and sends
    /// `session.closed` with byte counts.
    pub async fn handle_session_close(&mut self, session_id: &str) {
        info!(session_id = %session_id, "Closing tunnel session");

        let Some(mut session) = self.sessions.remove(session_id) else {
            warn!(session_id = %session_id, "Session not found for close");
            return;
        };

        self.stream_to_session.remove(&session.stream_id);

        // Drop the TCP writer (closes the write half)
        session.tcp_writer.take();

        // Abort the reader task
        if let Some(handle) = session.reader_handle.take() {
            handle.abort();
        }

        self.send_session_closed(&session.session_id, session.bytes_tx, session.bytes_rx);
    }

    /// Handle incoming binary data from the backend destined for a TCP socket.
    ///
    /// The payload is written to the TCP socket associated with `stream_id`.
    /// If no TCP connection exists yet (tunnel CLI lazy connect), opens one first.
    pub async fn handle_data(&mut self, stream_id: u32, payload: &[u8]) {
        let Some(session_id) = self.stream_to_session.get(&stream_id) else {
            warn!(stream_id = stream_id, "No session for stream, dropping data");
            return;
        };

        let session_id = session_id.clone();
        let Some(session) = self.sessions.get_mut(&session_id) else {
            warn!(session_id = %session_id, "Session not found, dropping data");
            return;
        };

        // Lazy connect: if TCP writer is None, open connection to target now.
        // This handles tunnel CLI which sends binary frames without tcp_stream_open.
        if session.tcp_writer.is_none() {
            let addr = format!("{}:{}", session.target_ip, session.target_port);
            info!(session_id = %session_id, target = %addr, "Lazy TCP connect for binary tunnel");

            match tokio::time::timeout(
                std::time::Duration::from_secs(TCP_CONNECT_TIMEOUT_SECS),
                TcpStream::connect(&addr),
            ).await {
                Ok(Ok(tcp_stream)) => {
                    let (reader, writer) = tokio::io::split(tcp_stream);
                    session.tcp_writer = Some(writer);

                    // Spawn reader task to forward TCP → WebSocket
                    let tx = self.tx.clone();
                    let sid = session.stream_id;
                    let s_id = session_id.clone();
                    let reader_handle = tokio::spawn(async move {
                        tcp_reader_task(reader, sid, s_id, tx).await;
                    });
                    session.reader_handle = Some(reader_handle);
                    info!(session_id = %session_id, target = %addr, "Lazy TCP connected");
                }
                Ok(Err(e)) => {
                    error!(session_id = %session_id, error = %e, "Lazy TCP connect failed");
                    self.close_session_on_error(&session_id).await;
                    return;
                }
                Err(_) => {
                    error!(session_id = %session_id, "Lazy TCP connect timed out");
                    self.close_session_on_error(&session_id).await;
                    return;
                }
            }
        }

        session.bytes_rx += payload.len() as u64;

        let Some(writer) = session.tcp_writer.as_mut() else {
            return;
        };

        if let Err(e) = writer.write_all(payload).await {
            error!(
                session_id = %session_id,
                error = %e,
                "Failed to write to TCP, closing session"
            );
            self.close_session_on_error(&session_id).await;
        }
    }

    /// Handle a control frame (streamId 0) from the backend.
    ///
    /// Control frames are JSON payloads with `cmd` and `streamId` fields.
    /// Supported commands: SYN, FIN, RST.
    pub async fn handle_control(&mut self, cmd: &serde_json::Value) {
        let Some(cmd_str) = cmd.get("cmd").and_then(|v| v.as_str()) else {
            warn!("Control frame missing 'cmd' field");
            return;
        };

        let stream_id = cmd
            .get("streamId")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;

        match cmd_str {
            "SYN" => {
                // SYN is handled via session.open text message, but if it arrives
                // as a control frame, log and ignore.
                info!(stream_id = stream_id, "Received SYN control frame (no-op)");
            }
            "FIN" => {
                info!(stream_id = stream_id, "Received FIN control frame");
                if let Some(session_id) = self.stream_to_session.get(&stream_id).cloned() {
                    self.handle_session_close(&session_id).await;
                }
            }
            "RST" => {
                info!(stream_id = stream_id, "Received RST control frame");
                if let Some(session_id) = self.stream_to_session.get(&stream_id).cloned() {
                    self.handle_session_close(&session_id).await;
                }
            }
            other => {
                warn!(cmd = other, "Unknown control frame command");
            }
        }
    }

    /// Close all active sessions. Called on WebSocket disconnect.
    pub async fn close_all(&mut self) {
        let session_ids: Vec<String> = self.sessions.keys().cloned().collect();
        for session_id in session_ids {
            self.handle_session_close(&session_id).await;
        }
    }

    // ── Private helpers ──

    /// Close a session due to a TCP write error.
    async fn close_session_on_error(&mut self, session_id: &str) {
        let session_id = session_id.to_string();
        self.handle_session_close(&session_id).await;
    }

    fn send_session_ready(&self, session_id: &str, stream_id: u32) {
        let msg = nucleus_common::messages::AgentToServer::SessionReady {
            session_id: session_id.to_string(),
            stream_id,
        };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }

    fn send_session_error(&self, session_id: &str, error: &str) {
        let msg = nucleus_common::messages::AgentToServer::SessionError {
            session_id: session_id.to_string(),
            error: error.to_string(),
        };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }

    fn send_session_closed(&self, session_id: &str, bytes_tx: u64, bytes_rx: u64) {
        let msg = nucleus_common::messages::AgentToServer::SessionClosed {
            session_id: session_id.to_string(),
            bytes_tx,
            bytes_rx,
        };
        if let Ok(json) = serde_json::to_string(&msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }

    /// Handle a `tcp_stream_open` message (Go proxy protocol).
    /// Opens a per-request TCP connection. The backend sends request data via
    /// `tcp_stream_data`, then reads the response via `tcp_stream_data` back.
    /// For HTTPS ports (443, 8443, 9443), wraps the connection in TLS so the
    /// backend proxy can send plain HTTP through the bridge.
    pub fn handle_tcp_stream_open(
        &self,
        session_id: String,
        stream_id: u32,
        target_ip: String,
        target_port: u16,
    ) {
        let tx = self.tx.clone();
        tokio::spawn(async move {
            let addr = format!("{}:{}", target_ip, target_port);
            let tcp_stream = match tokio::time::timeout(
                std::time::Duration::from_secs(5),
                TcpStream::connect(&addr),
            ).await {
                Ok(Ok(s)) => s,
                _ => {
                    let _ = send_json_msg(&tx, &AgentToServer::TcpStreamClosed {
                        session_id, stream_id,
                    });
                    return;
                }
            };

            // For HTTPS ports, wrap in TLS. The proxy sends plain HTTP to the bridge,
            // the agent terminates TLS to the actual target.
            let use_tls = TLS_PORTS.contains(&target_port);
            let (reader, writer): (
                Box<dyn AsyncRead + Unpin + Send>,
                Box<dyn AsyncWrite + Unpin + Send>,
            ) = if use_tls {
                info!(stream_id, target = %addr, "Wrapping TCP stream in TLS");
                match wrap_tls(tcp_stream, &target_ip).await {
                    Ok(tls_stream) => {
                        let (r, w) = tokio::io::split(tls_stream);
                        (Box::new(r), Box::new(w))
                    }
                    Err(e) => {
                        warn!(stream_id, target = %addr, error = %e, "TLS handshake failed");
                        let _ = send_json_msg(&tx, &AgentToServer::TcpStreamClosed {
                            session_id, stream_id,
                        });
                        return;
                    }
                }
            } else {
                let (r, w) = tokio::io::split(tcp_stream);
                (Box::new(r), Box::new(w))
            };

            // Send tcp_stream_opened
            let _ = send_json_msg(&tx, &AgentToServer::TcpStreamOpened {
                session_id: session_id.clone(),
                stream_id,
            });

            let writer = std::sync::Arc::new(tokio::sync::Mutex::new(writer));

            // Store writer for tcp_stream_data writes from backend
            TCP_STREAM_WRITERS_DYN.lock().unwrap().insert(stream_id, writer.clone());

            // Create ordered write channel — data queued here is written
            // sequentially to TCP, preventing SSH packet reordering
            let (write_tx, mut write_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);
            TCP_STREAM_WRITE_CHANNELS.lock().unwrap().insert(stream_id, write_tx);

            // Spawn sequential writer task
            let writer_for_channel = writer.clone();
            tokio::spawn(async move {
                while let Some(data) = write_rx.recv().await {
                    let mut w = writer_for_channel.lock().await;
                    if w.write_all(&data).await.is_err() {
                        break;
                    }
                }
            });

            // Use a notify to signal when data has been written (backend → TCP)
            let data_written = std::sync::Arc::new(tokio::sync::Notify::new());
            let data_written_clone = data_written.clone();
            TCP_STREAM_NOTIFIERS.lock().unwrap().insert(stream_id, data_written_clone);

            // Wait for first write from backend before reading response.
            // 30s timeout — tunnel CLI sessions may take time to start sending.
            let _ = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                data_written.notified(),
            ).await;

            // Read response loop.
            // 5-minute idle timeout — SSH, Modbus, and other persistent protocols
            // can have long pauses between data. Only close on true EOF or error.
            let mut reader = reader;
            let mut buf = vec![0u8; 65536];
            loop {
                match tokio::time::timeout(
                    std::time::Duration::from_secs(300),
                    reader.read(&mut buf),
                ).await {
                    Ok(Ok(0)) => break,
                    Ok(Ok(n)) => {
                        use base64::Engine;
                        let encoded = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                        if send_json_msg(&tx, &AgentToServer::TcpStreamData {
                            session_id: session_id.clone(),
                            stream_id,
                            data: encoded,
                        }).is_err() {
                            break;
                        }
                    }
                    Ok(Err(_)) => break,
                    Err(_) => break, // 5min idle timeout
                }
            }

            // Cleanup
            TCP_STREAM_WRITE_CHANNELS.lock().unwrap().remove(&stream_id);
            TCP_STREAM_WRITERS_DYN.lock().unwrap().remove(&stream_id);
            TCP_STREAM_NOTIFIERS.lock().unwrap().remove(&stream_id);
            let _ = send_json_msg(&tx, &AgentToServer::TcpStreamClosed {
                session_id, stream_id,
            });
        });
    }

    /// Handle `tcp_stream_data` — write base64-decoded data to the TCP stream.
    /// Queues data for sequential writing via a per-stream channel to prevent
    /// out-of-order delivery that corrupts SSH encrypted streams.
    pub fn handle_tcp_stream_data(&self, stream_id: u32, data_b64: &str) {
        use base64::Engine;
        let Ok(decoded) = base64::engine::general_purpose::STANDARD.decode(data_b64) else {
            return;
        };

        // Queue data for ordered sequential write via channel
        if let Some(ch) = TCP_STREAM_WRITE_CHANNELS.lock().unwrap().get(&stream_id) {
            let _ = ch.try_send(decoded);
            if let Some(notifier) = TCP_STREAM_NOTIFIERS.lock().unwrap().get(&stream_id) {
                notifier.notify_one();
            }
            return;
        }

        // Fallback: direct write for streams without channel (legacy)
        let writer = TCP_STREAM_WRITERS_DYN.lock().unwrap().get(&stream_id).cloned();
        if let Some(writer) = writer {
            if let Some(notifier) = TCP_STREAM_NOTIFIERS.lock().unwrap().get(&stream_id) {
                notifier.notify_one();
            }
            tokio::spawn(async move {
                let mut w = writer.lock().await;
                let _ = w.write_all(&decoded).await;
            });
            return;
        }

        // Legacy plain writer fallback (for any code that still uses TCP_STREAM_WRITERS)
        let writer = TCP_STREAM_WRITERS.lock().unwrap().get(&stream_id).cloned();
        if let Some(writer) = writer {
            if let Some(notifier) = TCP_STREAM_NOTIFIERS.lock().unwrap().get(&stream_id) {
                notifier.notify_one();
            }
            tokio::spawn(async move {
                let mut w = writer.lock().await;
                let _ = w.write_all(&decoded).await;
                let _ = w.flush().await;
            });
        }
    }

    /// Handle `tcp_stream_close` — close the TCP stream.
    pub fn handle_tcp_stream_close(&self, stream_id: u32) {
        TCP_STREAM_WRITE_CHANNELS.lock().unwrap().remove(&stream_id);
        TCP_STREAM_WRITERS.lock().unwrap().remove(&stream_id);
        TCP_STREAM_WRITERS_DYN.lock().unwrap().remove(&stream_id);
        TCP_STREAM_NOTIFIERS.lock().unwrap().remove(&stream_id);
    }
}

/// Type-erased async writer for both plain TCP and TLS streams
type DynWriter = Box<dyn AsyncWrite + Unpin + Send>;

/// Global TCP stream writers (dynamic — supports TLS and plain)
static TCP_STREAM_WRITERS_DYN: std::sync::LazyLock<
    std::sync::Mutex<HashMap<u32, std::sync::Arc<tokio::sync::Mutex<DynWriter>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Global TCP stream writers for Go proxy protocol (legacy plain TCP only)
static TCP_STREAM_WRITERS: std::sync::LazyLock<
    std::sync::Mutex<HashMap<u32, std::sync::Arc<tokio::sync::Mutex<tokio::io::WriteHalf<TcpStream>>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Notify signals for when data is first written to a stream
static TCP_STREAM_NOTIFIERS: std::sync::LazyLock<
    std::sync::Mutex<HashMap<u32, std::sync::Arc<tokio::sync::Notify>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Per-stream write channels for ordered sequential TCP writes.
/// Prevents out-of-order delivery that corrupts SSH encrypted streams.
static TCP_STREAM_WRITE_CHANNELS: std::sync::LazyLock<
    std::sync::Mutex<HashMap<u32, tokio::sync::mpsc::Sender<Vec<u8>>>>,
> = std::sync::LazyLock::new(|| std::sync::Mutex::new(HashMap::new()));

/// Wrap a TCP stream in TLS using rustls (accepts self-signed certs for industrial devices)
async fn wrap_tls(
    tcp: TcpStream,
    server_name: &str,
) -> Result<tokio_rustls::client::TlsStream<TcpStream>, Box<dyn std::error::Error + Send + Sync>> {
    use std::sync::Arc;
    use tokio_rustls::TlsConnector;
    use rustls_pki_types::ServerName;

    // Build a TLS config that accepts any certificate (industrial devices use self-signed)
    let mut root_store = rustls::RootCertStore::empty();
    root_store.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let config = rustls::ClientConfig::builder()
        .dangerous()
        .with_custom_certificate_verifier(Arc::new(AcceptAnyCert))
        .with_no_client_auth();

    let connector = TlsConnector::from(Arc::new(config));

    // Try to parse as IP first, fall back to DNS name
    let name: ServerName<'static> = server_name
        .parse::<std::net::IpAddr>()
        .map(|ip| ServerName::IpAddress(ip.into()))
        .unwrap_or_else(|_| ServerName::try_from(server_name.to_string()).unwrap_or_else(|_| {
            ServerName::try_from("localhost".to_string()).unwrap()
        }));

    let tls_stream = connector.connect(name, tcp).await?;
    Ok(tls_stream)
}

/// Certificate verifier that accepts any certificate (for self-signed industrial devices)
#[derive(Debug)]
struct AcceptAnyCert;

impl rustls::client::danger::ServerCertVerifier for AcceptAnyCert {
    fn verify_server_cert(
        &self,
        _end_entity: &rustls_pki_types::CertificateDer<'_>,
        _intermediates: &[rustls_pki_types::CertificateDer<'_>],
        _server_name: &rustls_pki_types::ServerName<'_>,
        _ocsp_response: &[u8],
        _now: rustls_pki_types::UnixTime,
    ) -> Result<rustls::client::danger::ServerCertVerified, rustls::Error> {
        Ok(rustls::client::danger::ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        _message: &[u8],
        _cert: &rustls_pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn verify_tls13_signature(
        &self,
        _message: &[u8],
        _cert: &rustls_pki_types::CertificateDer<'_>,
        _dss: &rustls::DigitallySignedStruct,
    ) -> Result<rustls::client::danger::HandshakeSignatureValid, rustls::Error> {
        Ok(rustls::client::danger::HandshakeSignatureValid::assertion())
    }

    fn supported_verify_schemes(&self) -> Vec<rustls::SignatureScheme> {
        rustls::crypto::ring::default_provider()
            .signature_verification_algorithms
            .supported_schemes()
    }
}

fn send_json_msg(
    tx: &mpsc::UnboundedSender<Message>,
    msg: &AgentToServer,
) -> Result<(), String> {
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    tx.send(Message::Text(json)).map_err(|e| e.to_string())
}

// ── Binary frame helpers ──

/// Build a binary frame: `[4B stream_id BE][4B length BE][payload]`
fn build_frame(stream_id: u32, payload: &[u8]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(8 + payload.len());
    frame.extend_from_slice(&stream_id.to_be_bytes());
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(payload);
    frame
}

/// Build a control frame (stream_id 0) containing a JSON command.
fn build_control_frame(cmd: &str, stream_id: u32) -> Vec<u8> {
    let json = format!(r#"{{"cmd":"{}","streamId":{}}}"#, cmd, stream_id);
    build_frame(0, json.as_bytes())
}

// ── TCP reader task ──

/// Reads from the TCP socket in a loop and sends binary frames through the
/// WebSocket channel. On EOF or error, sends a FIN control frame and a
/// `session.closed` JSON message.
async fn tcp_reader_task(
    mut tcp_read: tokio::io::ReadHalf<TcpStream>,
    stream_id: u32,
    session_id: String,
    tx: mpsc::UnboundedSender<Message>,
) {
    let mut buf = vec![0u8; TCP_BUF_SIZE];
    let mut bytes_tx: u64 = 0;

    loop {
        match tcp_read.read(&mut buf).await {
            Ok(0) => {
                // EOF — TCP connection closed by the remote
                info!(
                    session_id = %session_id,
                    stream_id = stream_id,
                    bytes_tx = bytes_tx,
                    "TCP read EOF"
                );
                break;
            }
            Ok(n) => {
                bytes_tx += n as u64;
                let frame = build_frame(stream_id, &buf[..n]);
                if tx.send(Message::Binary(frame)).is_err() {
                    // WS channel closed; stop reading
                    warn!(
                        session_id = %session_id,
                        "WS channel closed, stopping TCP reader"
                    );
                    return;
                }
            }
            Err(e) => {
                error!(
                    session_id = %session_id,
                    stream_id = stream_id,
                    error = %e,
                    "TCP read error"
                );
                break;
            }
        }
    }

    // Send FIN control frame to notify the backend the stream is done
    let fin_frame = build_control_frame("FIN", stream_id);
    let _ = tx.send(Message::Binary(fin_frame));

    // Send session.closed JSON message with byte counts
    // Note: bytes_rx is not tracked here (the writer side tracks it),
    // so we send 0 for bytes_rx. The TunnelManager may send a more
    // accurate session.closed if it processes the close first.
    let closed_msg = nucleus_common::messages::AgentToServer::SessionClosed {
        session_id,
        bytes_tx,
        bytes_rx: 0,
    };
    if let Ok(json) = serde_json::to_string(&closed_msg) {
        let _ = tx.send(Message::Text(json));
    }
}
