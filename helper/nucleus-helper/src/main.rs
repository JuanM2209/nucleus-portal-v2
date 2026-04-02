use tracing::info;

mod config;
mod tunnel;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter("nucleus_helper=info")
        .init();

    info!("Nucleus Helper starting...");

    // Parse command line or deep link args
    let args: Vec<String> = std::env::args().collect();

    if args.len() < 2 {
        eprintln!("Usage: nucleus-helper <deep-link-url>");
        eprintln!("  e.g.: nucleus-helper nucleus-helper://tunnel?config=<base64>");
        std::process::exit(1);
    }

    let deep_link = &args[1];
    let tunnel_config = match config::parse_deep_link(deep_link) {
        Ok(c) => c,
        Err(e) => {
            eprintln!("Failed to parse config: {}", e);
            std::process::exit(1);
        }
    };

    info!("Tunnel config: target port {}", tunnel_config.target_port);

    // Run the tunnel
    if let Err(e) = tunnel::run(tunnel_config).await {
        eprintln!("Tunnel error: {}", e);
        std::process::exit(1);
    }
}
