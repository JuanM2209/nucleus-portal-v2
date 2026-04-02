use crate::config::TunnelConfig;
use futures_util::{SinkExt, StreamExt};
use tokio::net::TcpListener;
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tracing::{info, error};

pub async fn run(config: TunnelConfig) -> Result<(), Box<dyn std::error::Error>> {
    // Connect to backend WebSocket
    let url = format!("{}?token={}", config.ws_url, config.session_token);
    let (ws_stream, _) = connect_async(&url).await?;
    info!("Connected to backend");

    let (mut ws_write, mut ws_read) = ws_stream.split();

    // Bind local port
    let local_port = config.target_port;
    let listener = TcpListener::bind(format!("127.0.0.1:{}", local_port)).await?;
    info!("Listening on localhost:{}", local_port);

    // Notify backend of bind
    let bind_msg = serde_json::json!({ "type": "session.bind", "port": local_port });
    ws_write.send(Message::Text(bind_msg.to_string())).await?;

    println!("==============================================");
    println!("  Tunnel active: localhost:{}", local_port);
    println!("  Press Ctrl+C to close");
    println!("==============================================");

    // Accept one TCP connection at a time (MVP)
    loop {
        let (tcp_stream, addr) = listener.accept().await?;
        info!("TCP connection from {}", addr);

        // TODO: Bidirectional bridge between tcp_stream and ws_stream
        // For MVP, this is the core data path
        info!("Would bridge TCP <-> WS for this connection");
        drop(tcp_stream);
    }
}
