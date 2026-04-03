use nucleus_common::messages::{AgentToServer, NetworkScanPayload, ScannedHost, ScannedPort};
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

/// Known port → service name mapping
fn port_to_service(port: u16) -> Option<&'static str> {
    match port {
        21 => Some("FTP"),
        22 => Some("SSH"),
        23 => Some("Telnet"),
        80 => Some("HTTP"),
        443 => Some("HTTPS"),
        502 => Some("Modbus TCP"),
        1880 => Some("Node-RED"),
        2202 => Some("mbusd"),
        3389 => Some("RDP"),
        4840 => Some("OPC UA"),
        5900 => Some("VNC"),
        8080 => Some("HTTP-Alt"),
        9090 => Some("Cockpit"),
        9999 => Some("Custom"),
        10002 => Some("Serial-TCP"),
        44818 => Some("EtherNet/IP"),
        47808 => Some("BACnet"),
        _ => None,
    }
}

/// Port profiles matching the backend scanner
fn get_ports(scan_type: &str) -> Vec<u16> {
    match scan_type {
        "quick" => vec![22, 80, 443, 502, 1880, 9090],
        "standard" => vec![21, 22, 23, 80, 81, 443, 502, 1880, 2202, 2404, 3389, 5900, 8080, 8443, 9090, 9999, 10002, 44818],
        "deep" => vec![
            21, 22, 23, 25, 53, 80, 81, 110, 143, 443, 502, 993, 995,
            1433, 1521, 1880, 2202, 2404, 3306, 3389, 4840, 5020, 5432,
            5900, 6379, 8000, 8080, 8081, 8443, 8888, 9090, 9999, 10002,
            10502, 27017, 44818, 47808,
        ],
        _ => vec![22, 80, 443, 502, 1880, 9090],
    }
}

/// Calculate IP range from IP + subnet mask
fn ip_range(ip: &str, mask: &str) -> Vec<String> {
    let ip: Ipv4Addr = match ip.parse() {
        Ok(ip) => ip,
        Err(_) => return vec![],
    };
    let mask: Ipv4Addr = match mask.parse() {
        Ok(m) => m,
        Err(_) => return vec![],
    };

    let ip_u32 = u32::from(ip);
    let mask_u32 = u32::from(mask);
    let network = ip_u32 & mask_u32;
    let broadcast = network | !mask_u32;
    let host_count = broadcast - network;

    // Limit to /24 or smaller (max 254 hosts)
    if host_count > 254 || host_count == 0 {
        return vec![];
    }

    let mut ips = Vec::new();
    for i in 1..host_count {
        let host_ip = Ipv4Addr::from(network + i);
        // Skip our own IP
        if host_ip != ip {
            ips.push(host_ip.to_string());
        }
    }
    ips
}

/// Probe a single port on a host with timeout
async fn probe_port(ip: &str, port: u16, timeout: Duration) -> bool {
    let addr = format!("{}:{}", ip, port);
    tokio::time::timeout(timeout, TcpStream::connect(&addr))
        .await
        .map(|r| r.is_ok())
        .unwrap_or(false)
}

/// Scan a single host for open ports
async fn scan_host(ip: String, ports: &[u16], timeout: Duration) -> Option<ScannedHost> {
    let start = Instant::now();
    let mut open_ports = Vec::new();

    for &port in ports {
        if probe_port(&ip, port, timeout).await {
            open_ports.push(ScannedPort {
                port,
                open: true,
                service: port_to_service(port).map(|s| s.to_string()),
            });
        }
    }

    if open_ports.is_empty() {
        return None;
    }

    let latency = start.elapsed().as_millis() as u32 / open_ports.len().max(1) as u32;

    Some(ScannedHost {
        ip,
        ports: open_ports,
        latency_ms: Some(latency),
    })
}

/// Run a network scan on the adapter's subnet + always include localhost
pub fn run_scan(
    tx: mpsc::UnboundedSender<Message>,
    adapter_name: String,
    adapter_ip: String,
    subnet_mask: String,
    payload: NetworkScanPayload,
) {
    tokio::spawn(async move {
        let scan_type = payload.scan_type.as_deref().unwrap_or("standard");
        let ports = payload.ports.unwrap_or_else(|| get_ports(scan_type));
        let timeout = Duration::from_millis(payload.timeout_ms.unwrap_or(1000));
        let concurrency = payload.concurrency.unwrap_or(20) as usize;

        info!(
            adapter = %adapter_name,
            ip = %adapter_ip,
            mask = %subnet_mask,
            scan_type = scan_type,
            ports = ports.len(),
            "Starting network scan"
        );

        let start = Instant::now();
        let mut hosts: Vec<ScannedHost> = Vec::new();

        // Always scan localhost first (local services: SSH, Node-RED, Cockpit, etc.)
        if let Some(localhost) = scan_host("127.0.0.1".to_string(), &ports, timeout).await {
            info!(services = localhost.ports.len(), "Localhost scan found {} services", localhost.ports.len());
            hosts.push(localhost);
        }

        // Then scan the subnet if we have a valid IP range
        let ips = ip_range(&adapter_ip, &subnet_mask);
        if !ips.is_empty() {
            info!(adapter = %adapter_name, hosts = ips.len(), "Scanning {} hosts", ips.len());
            for chunk in ips.chunks(concurrency) {
                let mut tasks = Vec::new();
                for ip in chunk {
                    let ip = ip.clone();
                    let ports_owned = ports.clone();
                    tasks.push(tokio::spawn(async move {
                        scan_host(ip, &ports_owned, timeout).await
                    }));
                }
                for task in tasks {
                    if let Ok(Some(host)) = task.await {
                        hosts.push(host);
                    }
                }
            }
        }

        if hosts.is_empty() {
            warn!(adapter = %adapter_name, "No hosts found (no localhost services and no subnet hosts)");
            let _ = send_json(&tx, &AgentToServer::NetworkScanError {
                adapter_name,
                error: "No hosts found".to_string(),
            });
            return;
        }

        let duration = start.elapsed().as_millis() as u64;
        info!(
            adapter = %adapter_name,
            hosts_found = hosts.len(),
            duration_ms = duration,
            "Scan complete"
        );

        let _ = send_json(&tx, &AgentToServer::NetworkScanResult {
            adapter_name,
            hosts,
            scan_type: scan_type.to_string(),
            duration_ms: duration,
        });
    });
}

/// Run a localhost-only scan (no adapter IP needed).
/// Used for auto-discovery on agent connect.
pub fn run_localhost_scan(
    tx: mpsc::UnboundedSender<Message>,
    adapter_name: String,
) {
    tokio::spawn(async move {
        let ports = get_ports("standard");
        let timeout = Duration::from_millis(1000);

        info!("Starting localhost auto-discovery scan ({} ports)", ports.len());
        let start = Instant::now();
        let mut hosts: Vec<ScannedHost> = Vec::new();

        if let Some(localhost) = scan_host("127.0.0.1".to_string(), &ports, timeout).await {
            info!(services = localhost.ports.len(), "Localhost: {} services found", localhost.ports.len());
            hosts.push(localhost);
        }

        let duration = start.elapsed().as_millis() as u64;
        info!(hosts_found = hosts.len(), duration_ms = duration, "Localhost scan complete");

        if !hosts.is_empty() {
            let _ = send_json(&tx, &AgentToServer::NetworkScanResult {
                adapter_name,
                hosts,
                scan_type: "auto".to_string(),
                duration_ms: duration,
            });
        }
    });
}

fn send_json(tx: &mpsc::UnboundedSender<Message>, msg: &AgentToServer) -> Result<(), String> {
    let json = serde_json::to_string(msg).map_err(|e| e.to_string())?;
    tx.send(Message::Text(json)).map_err(|e| e.to_string())
}
