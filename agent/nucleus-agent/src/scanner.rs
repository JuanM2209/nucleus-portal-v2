use crate::arp_discovery::{arp_sweep, mac_vendor};
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
        102 => Some("S7comm"),
        161 => Some("SNMP"),
        443 => Some("HTTPS"),
        502 => Some("Modbus TCP"),
        1880 => Some("Node-RED"),
        1883 => Some("MQTT"),
        2202 => Some("mbusd"),
        2222 => Some("EtherNet/IP-config"),
        2404 => Some("IEC 60870-5-104"),
        3389 => Some("RDP"),
        4000 => Some("Remote-IO"),
        4840 => Some("OPC UA"),
        5900 => Some("VNC"),
        8080 => Some("HTTP-Alt"),
        9090 => Some("Cockpit"),
        9999 => Some("Custom"),
        10002 => Some("Serial-TCP"),
        20000 => Some("DNP3"),
        44818 => Some("EtherNet/IP"),
        47808 => Some("BACnet"),
        _ => None,
    }
}

/// Port profiles matching the backend scanner
fn get_ports(scan_type: &str) -> Vec<u16> {
    match scan_type {
        "quick" => vec![22, 80, 443, 502, 1880, 9090],
        "standard" => vec![
            21, 22, 23, 80, 81, 102, 443, 502, 1880, 1883,
            2202, 2404, 3389, 4840, 5900, 8080, 8443, 9090,
            9999, 10002, 44818, 47808,
        ],
        "deep" => vec![
            21, 22, 23, 25, 53, 80, 81, 102, 110, 143, 161, 443, 502,
            993, 995, 1433, 1521, 1880, 1883, 2202, 2222, 2404, 3000,
            3306, 3389, 4000, 4840, 5020, 5432, 5900, 6379, 8000, 8080,
            8081, 8443, 8888, 9090, 9999, 10002, 10502, 20000, 27017,
            44818, 47808,
        ],
        _ => vec![22, 80, 443, 502, 1880, 9090],
    }
}

/// Calculate IPv4 range from IP + subnet mask (excludes own IP)
fn ip_range_v4(ip: &str, mask: &str) -> Vec<Ipv4Addr> {
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

    // Limit to /22 or smaller (max ~1022 hosts)
    if host_count > 1023 || host_count == 0 {
        return vec![];
    }

    let mut ips = Vec::new();
    for i in 1..host_count {
        let host_ip = Ipv4Addr::from(network + i);
        if host_ip != ip {
            ips.push(host_ip);
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

/// Scan a single host for open ports (returns host even if 0 ports found when from ARP)
async fn scan_host_ports(ip: String, ports: &[u16], timeout: Duration) -> Vec<ScannedPort> {
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
    open_ports
}

/// Run a two-phase network scan:
///   Phase 1: ARP sweep to discover live hosts (works even if all TCP ports are closed)
///   Phase 2: TCP port scan only on discovered hosts
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
        let timeout = Duration::from_millis(payload.timeout_ms.unwrap_or(3000));
        let concurrency = payload.concurrency.unwrap_or(50) as usize;

        info!(
            adapter = %adapter_name,
            ip = %adapter_ip,
            mask = %subnet_mask,
            scan_type = scan_type,
            ports = ports.len(),
            "Starting two-phase subnet scan (ARP + TCP)"
        );

        let start = Instant::now();

        // Calculate target IPs (excludes our own)
        let target_ips = ip_range_v4(&adapter_ip, &subnet_mask);
        if target_ips.is_empty() {
            warn!(adapter = %adapter_name, "No target IPs in subnet range");
            let _ = send_json(&tx, &AgentToServer::NetworkScanError {
                adapter_name,
                error: "No valid IPs in subnet".to_string(),
            });
            return;
        }

        // ── Phase 1: ARP Discovery ──
        // Run ARP sweep in a blocking thread (pnet uses synchronous I/O)
        let arp_adapter = adapter_name.clone();
        let arp_ip: Ipv4Addr = adapter_ip.parse().unwrap();
        let arp_targets = target_ips.clone();
        let arp_hosts = tokio::task::spawn_blocking(move || {
            arp_sweep(&arp_adapter, arp_ip, &arp_targets, Duration::from_secs(4))
        }).await.unwrap_or_default();

        info!(
            adapter = %adapter_name,
            arp_hosts = arp_hosts.len(),
            arp_duration_ms = start.elapsed().as_millis(),
            "Phase 1 (ARP) complete — {} live hosts found",
            arp_hosts.len()
        );

        // ── Phase 2: TCP Port Scan on discovered hosts ──
        let mut hosts: Vec<ScannedHost> = Vec::new();

        if arp_hosts.is_empty() {
            // Fallback: if ARP finds nothing (interface issue?), try TCP on all IPs
            warn!(adapter = %adapter_name, "ARP found no hosts — falling back to TCP-only scan");
            let ip_strings: Vec<String> = target_ips.iter().map(|ip| ip.to_string()).collect();
            for chunk in ip_strings.chunks(concurrency) {
                let mut tasks = Vec::new();
                for ip in chunk {
                    let ip = ip.clone();
                    let ports_owned = ports.clone();
                    tasks.push(tokio::spawn(async move {
                        let open = scan_host_ports(ip.clone(), &ports_owned, timeout).await;
                        if open.is_empty() { None } else {
                            Some(ScannedHost {
                                ip,
                                mac: None,
                                vendor: None,
                                ports: open,
                                latency_ms: None,
                            })
                        }
                    }));
                }
                for task in tasks {
                    if let Ok(Some(host)) = task.await {
                        hosts.push(host);
                    }
                }
            }
        } else {
            // Port-scan only ARP-discovered hosts (much faster!)
            info!(adapter = %adapter_name, "Phase 2: TCP port scan on {} ARP-discovered hosts", arp_hosts.len());
            let mut tasks = Vec::new();
            for arp_host in &arp_hosts {
                let ip = arp_host.ip.to_string();
                let mac_str = format!("{}", arp_host.mac);
                let vendor = mac_vendor(&arp_host.mac).map(|s| s.to_string());
                let arp_latency = arp_host.latency_ms;
                let ports_owned = ports.clone();
                tasks.push(tokio::spawn(async move {
                    let open = scan_host_ports(ip.clone(), &ports_owned, timeout).await;
                    ScannedHost {
                        ip,
                        mac: Some(mac_str),
                        vendor,
                        ports: open,
                        latency_ms: Some(arp_latency),
                    }
                }));
            }
            for task in tasks {
                if let Ok(host) = task.await {
                    hosts.push(host);
                }
            }
        }

        let duration = start.elapsed().as_millis() as u64;

        if hosts.is_empty() {
            warn!(adapter = %adapter_name, duration_ms = duration, "No hosts found after ARP + TCP scan");
            let _ = send_json(&tx, &AgentToServer::NetworkScanError {
                adapter_name,
                error: "No hosts found".to_string(),
            });
            return;
        }

        info!(
            adapter = %adapter_name,
            hosts_found = hosts.len(),
            hosts_with_ports = hosts.iter().filter(|h| !h.ports.is_empty()).count(),
            duration_ms = duration,
            "Two-phase scan complete"
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

        let open = scan_host_ports("127.0.0.1".to_string(), &ports, timeout).await;
        if !open.is_empty() {
            info!(services = open.len(), "Localhost: {} services found", open.len());
            hosts.push(ScannedHost {
                ip: "127.0.0.1".to_string(),
                mac: None,
                vendor: None,
                ports: open,
                latency_ms: Some(0),
            });
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
