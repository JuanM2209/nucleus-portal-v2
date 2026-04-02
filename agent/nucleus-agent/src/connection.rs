use crate::chisel::ChiselManager;
use crate::config::AgentConfig;
use crate::comms::CommsManager;
use crate::mbusd::MbusdManager;
use crate::tunnel::TunnelManager;
use futures_util::{SinkExt, StreamExt};
use nucleus_common::messages::{AgentToServer, ServerToAgent};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, warn, error};
use std::time::Duration;

const MAX_BACKOFF_SECS: u64 = 10; // Fast reconnect for cellular networks

/// Main connection loop with automatic reconnection and exponential backoff.
pub async fn run(config: AgentConfig) {
    let mut backoff_secs: u64 = 1;

    loop {
        info!("Connecting to {}...", config.server.url);

        match connect_and_run(&config).await {
            Ok(()) => {
                info!("Connection closed gracefully");
                backoff_secs = 1;
            }
            Err(e) => {
                error!("Connection error: {}", e);
            }
        }

        warn!("Reconnecting in {} seconds...", backoff_secs);
        tokio::time::sleep(Duration::from_secs(backoff_secs)).await;

        // Exponential backoff with jitter
        backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
        let jitter = rand_jitter(backoff_secs);
        backoff_secs = backoff_secs.saturating_add(jitter);
    }
}

async fn connect_and_run(config: &AgentConfig) -> Result<(), Box<dyn std::error::Error>> {
    let url = format!("{}?token={}", config.server.url, config.server.token);

    let (ws_stream, _response) = connect_async(&url).await?;
    info!("Connected to control plane");

    let (ws_write, mut ws_read) = ws_stream.split();

    // Create an unbounded channel for outbound WebSocket messages.
    // All tasks (heartbeat, tunnel reader, main loop) send through this
    // channel, and the writer task drains it to the WS write half.
    let (tx, rx) = mpsc::unbounded_channel::<Message>();

    // Create managers
    let mut tunnel_mgr = TunnelManager::new(tx.clone());
    let mut comms_mgr = CommsManager::new(tx.clone());
    let mut mbusd_mgr = MbusdManager::new(tx.clone());

    // Chisel manager for V2 TCP transport (via Cloudflare Tunnel WebSocket)
    let chisel_url = config.chisel.server_url.clone()
        .or_else(|| std::env::var("CHISEL_SERVER_URL").ok())
        .unwrap_or_else(|| {
            // Derive from WS URL: same host + /chisel path
            let host = config.server.url
                .replace("wss://", "https://").replace("ws://", "http://")
                .split("/ws/").next().unwrap_or("https://localhost:3001").to_string();
            format!("{}/chisel", host)
        });
    let chisel_auth = config.chisel.auth.clone()
        .or_else(|| std::env::var("CHISEL_AUTH").ok())
        .unwrap_or_else(|| "nucleus:nucleus".to_string());
    let mut chisel_mgr = ChiselManager::new(
        &config.chisel.binary_path,
        &chisel_url,
        &chisel_auth,
        tx.clone(),
    );
    chisel_mgr.start().await;

    // Writer task: drains the channel and sends messages through the WS
    let writer_handle = tokio::spawn(ws_writer_task(ws_write, rx));

    // WebSocket ping task: sends ping frames every 20s to keep Cloudflare tunnel alive
    let ping_tx = tx.clone();
    let ping_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(20));
        loop {
            interval.tick().await;
            if ping_tx.send(Message::Ping(vec![42])).is_err() {
                break;
            }
        }
    });

    // Heartbeat task: periodically sends health metrics
    let hb_tx = tx.clone();
    let hb_interval = config.heartbeat.interval_secs;
    let heartbeat_handle = tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(hb_interval));
        loop {
            interval.tick().await;
            let heartbeat = crate::health::collect_heartbeat();
            match serde_json::to_string(&heartbeat) {
                Ok(json) => {
                    if hb_tx.send(Message::Text(json)).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    error!("Failed to serialize heartbeat: {}", e);
                }
            }
        }
    });

    // Main read loop: dispatch incoming WS messages
    while let Some(msg) = ws_read.next().await {
        let msg = match msg {
            Ok(m) => m,
            Err(e) => {
                error!("WebSocket read error: {}", e);
                break;
            }
        };

        match msg {
            Message::Text(text) => {
                handle_text_message(&text, &mut tunnel_mgr, &mut comms_mgr, &mut mbusd_mgr, &mut chisel_mgr, &tx).await;
            }
            Message::Binary(data) => {
                handle_binary_frame(&data, &mut tunnel_mgr).await;
            }
            Message::Ping(data) => {
                let _ = tx.send(Message::Pong(data));
            }
            Message::Close(_) => {
                info!("Server closed connection");
                break;
            }
            _ => {}
        }
    }

    // Clean up
    ping_handle.abort();
    heartbeat_handle.abort();
    comms_mgr.close_all();
    mbusd_mgr.cleanup();
    chisel_mgr.stop();
    tunnel_mgr.close_all().await;
    // Drop tx so the writer task's rx completes
    drop(tx);
    // Wait briefly for the writer to flush remaining messages
    let _ = tokio::time::timeout(Duration::from_secs(2), writer_handle).await;

    Ok(())
}

/// Writer task: reads from the channel and sends to the WebSocket write half.
async fn ws_writer_task(
    mut ws_write: futures_util::stream::SplitSink<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        Message,
    >,
    mut rx: mpsc::UnboundedReceiver<Message>,
) {
    while let Some(msg) = rx.recv().await {
        if let Err(e) = ws_write.send(msg).await {
            error!("WebSocket write error: {}", e);
            break;
        }
    }
}

/// Dispatch a text (JSON) message from the server.
async fn handle_text_message(
    text: &str,
    tunnel_mgr: &mut TunnelManager,
    comms_mgr: &mut CommsManager,
    mbusd_mgr: &mut MbusdManager,
    chisel_mgr: &mut ChiselManager,
    tx: &mpsc::UnboundedSender<Message>,
) {
    match serde_json::from_str::<ServerToAgent>(text) {
        Ok(ServerToAgent::SessionOpen {
            session_id,
            target_ip,
            target_port,
            stream_id,
            payload,
        }) => {
            // Support both flat fields (Rust format) and nested payload (Go format)
            let p = payload.unwrap_or_default();
            let sid = session_id.or(p.session_id).unwrap_or_default();
            let tip = target_ip.or(p.target_ip).unwrap_or_else(|| "127.0.0.1".to_string());
            let tport = target_port.or(p.target_port).unwrap_or(0);
            let stid = stream_id.or(p.stream_id).unwrap_or(0);
            tunnel_mgr
                .handle_session_open(sid, tip, tport, stid)
                .await;
        }
        Ok(ServerToAgent::SessionClose { session_id, payload }) => {
            let p = payload.unwrap_or_default();
            let sid = session_id.or(p.session_id).unwrap_or_default();
            tunnel_mgr.handle_session_close(&sid).await;
        }
        Ok(ServerToAgent::DiscoveryTrigger { adapter_id, scan_type }) => {
            info!(
                adapter_id = ?adapter_id,
                scan_type = %scan_type,
                "Discovery trigger received (not yet implemented)"
            );
        }
        Ok(ServerToAgent::Ping) => {
            let pong = AgentToServer::Pong;
            if let Ok(json) = serde_json::to_string(&pong) {
                let _ = tx.send(Message::Text(json));
            }
        }
        // /comms WebSocket relay
        Ok(ServerToAgent::CommsOpen { payload }) => {
            comms_mgr.open(payload.comms_id, payload.target_url).await;
        }
        Ok(ServerToAgent::CommsFrame { payload }) => {
            comms_mgr.send_frame(&payload.comms_id, payload.data);
        }
        Ok(ServerToAgent::CommsClose { payload }) => {
            comms_mgr.close(&payload.comms_id);
        }
        // Go proxy protocol: per-request TCP streams
        Ok(ServerToAgent::TcpStreamOpen { payload }) => {
            let p = payload.unwrap_or_default();
            let sid = p.session_id.unwrap_or_default();
            let stid = p.stream_id.unwrap_or(0);
            let tip = p.target_ip.unwrap_or_else(|| "127.0.0.1".to_string());
            let tport = p.target_port.or(p.port).unwrap_or(0);
            tunnel_mgr.handle_tcp_stream_open(sid, stid, tip, tport);
        }
        Ok(ServerToAgent::TcpStreamData { payload }) => {
            let p = payload.unwrap_or_default();
            let stid = p.stream_id.unwrap_or(0);
            let data = p.data.unwrap_or_default();
            tunnel_mgr.handle_tcp_stream_data(stid, &data);
        }
        Ok(ServerToAgent::TcpStreamClose { payload }) => {
            let p = payload.unwrap_or_default();
            let stid = p.stream_id.unwrap_or(0);
            tunnel_mgr.handle_tcp_stream_close(stid);
        }
        // Endpoint health check (TCP connect probe)
        Ok(ServerToAgent::EndpointHealthCheck { payload }) => {
            let p = payload.unwrap_or_default();
            let request_id = p.request_id.unwrap_or_else(|| "unknown".to_string());
            let targets = p.targets.unwrap_or_default();
            let timeout = p.timeout_ms.unwrap_or(3000);
            let tx2 = tx.clone();
            tokio::spawn(async move {
                crate::health::run_endpoint_health_check(tx2, request_id, targets, timeout).await;
            });
        }
        // Network scanning
        Ok(ServerToAgent::NetworkScan { payload }) => {
            let p = payload.unwrap_or_default();
            let adapter_name = p.adapter_name.clone().unwrap_or_else(|| "eth0".to_string());
            // Get adapter IP and subnet from current system state
            let adapters = crate::health::collect_adapters_pub();
            if let Some(adapter) = adapters.iter().find(|a| a.name == adapter_name) {
                if let (Some(ip), Some(mask)) = (&adapter.ip_address, &adapter.subnet_mask) {
                    crate::scanner::run_scan(tx.clone(), adapter_name, ip.clone(), mask.clone(), p);
                } else {
                    warn!("Adapter {} has no IP/subnet for scanning", adapter_name);
                }
            } else {
                warn!("Adapter {} not found", adapter_name);
            }
        }
        // mbusd process control
        Ok(ServerToAgent::MbusdStart { payload }) => {
            mbusd_mgr.start(payload.unwrap_or_default());
        }
        Ok(ServerToAgent::MbusdStop) => {
            mbusd_mgr.stop();
        }
        Ok(ServerToAgent::MbusdStatusReq) => {
            mbusd_mgr.status();
        }
        // Chisel V2 transport
        Ok(ServerToAgent::PortExpose { service_name, local_addr, remote_port }) => {
            chisel_mgr.expose_port(&service_name, &local_addr, remote_port).await;
        }
        Ok(ServerToAgent::PortUnexpose { service_name }) => {
            chisel_mgr.unexpose_port(&service_name).await;
        }
        Err(e) => {
            warn!("Failed to parse control message: {} — raw: {}", e, text);
        }
    }
}

/// Dispatch a binary frame from the server.
///
/// Binary frame format: `[4B streamId BE][4B length BE][payload]`
/// - streamId 0 = control frame (JSON SYN/FIN/RST)
/// - streamId > 0 = tunnel data
async fn handle_binary_frame(data: &[u8], tunnel_mgr: &mut TunnelManager) {
    if data.len() < 8 {
        warn!("Binary frame too short: {} bytes", data.len());
        return;
    }

    let stream_id = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
    let _length = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as usize;
    let payload = &data[8..];

    if stream_id == 0 {
        // Control frame: parse JSON and dispatch
        match serde_json::from_slice::<serde_json::Value>(payload) {
            Ok(cmd) => {
                tunnel_mgr.handle_control(&cmd).await;
            }
            Err(e) => {
                warn!("Failed to parse control frame JSON: {}", e);
            }
        }
    } else {
        // Tunnel data: forward to TCP socket
        tunnel_mgr.handle_data(stream_id, payload).await;
    }
}

fn rand_jitter(max: u64) -> u64 {
    // Simple jitter without requiring rand crate
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .subsec_nanos() as u64;
    t % (max / 4 + 1)
}
