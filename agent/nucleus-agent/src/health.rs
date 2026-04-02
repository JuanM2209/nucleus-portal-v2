use nucleus_common::messages::{AgentToServer, HealthCheckTarget, HealthCheckResult};
use nucleus_common::types::AdapterInfo;
use sysinfo::System;
use tokio::net::TcpStream;
use tokio::sync::mpsc;
use tokio::time::{timeout, Instant};
use tokio_tungstenite::tungstenite::Message;
use std::time::Duration;

pub fn collect_heartbeat() -> AgentToServer {
    let mut sys = System::new();
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpu = sys.global_cpu_usage();
    let mem = sys.used_memory();
    let mem_total = sys.total_memory();

    // Disk usage (root partition)
    let disks = sysinfo::Disks::new_with_refreshed_list();
    let (disk, disk_total) = disks
        .iter()
        .find(|d| d.mount_point() == std::path::Path::new("/"))
        .map(|d| (d.total_space() - d.available_space(), d.total_space()))
        .unwrap_or((0, 0));

    let uptime = System::uptime();

    AgentToServer::Heartbeat {
        cpu,
        mem,
        mem_total,
        disk,
        disk_total,
        uptime,
        agent_version: format!("vr{}", env!("CARGO_PKG_VERSION").split('.').nth(1).unwrap_or("21")),
        active_tunnels: 0, // TODO: Track from tunnel manager
        adapters: collect_adapters(),
        signal_quality: read_signal_quality(),
    }
}

/// Public accessor for connection.rs to get adapter info for scanning
pub fn collect_adapters_pub() -> Vec<AdapterInfo> {
    collect_adapters()
}

fn collect_adapters() -> Vec<AdapterInfo> {
    let mut adapters = Vec::new();
    // Scan /sys/class/net/ for all physical interfaces (skip lo, docker, veth)
    let net_dir = "/sys/class/net";
    let entries = match std::fs::read_dir(net_dir) {
        Ok(e) => e,
        Err(_) => return adapters,
    };

    // Build a map of interface-name → ipv4 method from NetworkManager configs
    let nm_methods = read_nm_methods();

    for entry in entries.flatten() {
        let iface = entry.file_name().to_string_lossy().to_string();

        // Skip virtual interfaces
        if iface == "lo"
            || iface.starts_with("veth")
            || iface.starts_with("br-")
            || iface.starts_with("docker")
            || iface.starts_with("wwan")  // Cellular WAN — not used for device networking
        {
            continue;
        }

        let path = format!("{}/{}", net_dir, iface);

        // operstate reports kernel interface state (admin up/down)
        let oper_up = std::fs::read_to_string(format!("{}/operstate", path))
            .map(|s| s.trim() == "up")
            .unwrap_or(false);

        // carrier reports physical link state (cable connected / Wi-Fi associated)
        // When no cable: kernel returns EINVAL on read → we treat as no carrier.
        // When cable present: returns "1". When admin-down: returns "0" or EINVAL.
        // For Wi-Fi: carrier=1 when associated, EINVAL when not.
        // Only trust operstate for interfaces where carrier file doesn't exist at all.
        let carrier_path = format!("{}/carrier", path);
        let has_carrier = if std::path::Path::new(&carrier_path).exists() {
            // File exists → read it; any error (EINVAL) means no physical link
            std::fs::read_to_string(&carrier_path)
                .map(|s| s.trim() == "1")
                .unwrap_or(false)
        } else {
            // No carrier file (pure virtual) → trust operstate
            oper_up
        };

        let is_up = oper_up && has_carrier;

        let mac = std::fs::read_to_string(format!("{}/address", path))
            .map(|s| {
                let m = s.trim().to_string();
                if m == "00:00:00:00:00:00" { None } else { Some(m) }
            })
            .unwrap_or(None);

        // Get IP address from `ip addr show <iface>` output
        let (ip_address, subnet_mask, gateway) = read_ip_info(&iface);

        // Determine address mode from NetworkManager config (NOT from profile name)
        let (mode, config_profile) = match nm_methods.get(&iface) {
            Some(info) => (Some(info.mode.clone()), Some(info.profile_name.clone())),
            None => (None, None),
        };

        adapters.push(AdapterInfo {
            name: iface,
            mac_address: mac,
            ip_address,
            subnet_mask,
            gateway,
            mode,
            is_up,
            config_profile,
        });
    }

    adapters
}

/// Read NetworkManager system-connections to determine the real ipv4.method
/// for each interface. This reads the actual config files, NOT the profile name.
///
/// /etc/NetworkManager/system-connections/*.nmconnection or the keyfile format
/// Looks for:
///   [connection]
///   interface-name=eth0
///   [ipv4]
///   method=manual    → "Static"
///   method=auto      → "DHCP"
/// NM profile info: mode (Static/DHCP) and connection profile ID
struct NmProfileInfo {
    mode: String,
    profile_name: String,
}

fn read_nm_methods() -> std::collections::HashMap<String, NmProfileInfo> {
    let mut map = std::collections::HashMap::new();
    let nm_path = "/etc/NetworkManager/system-connections";

    let entries = match std::fs::read_dir(nm_path) {
        Ok(e) => e,
        Err(_) => return map,
    };

    for entry in entries.flatten() {
        let content = match std::fs::read_to_string(entry.path()) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let mut iface_name: Option<String> = None;
        let mut ipv4_method: Option<String> = None;
        let mut conn_id: Option<String> = None;
        let mut in_connection = false;
        let mut in_ipv4 = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == "[connection]" {
                in_connection = true;
                in_ipv4 = false;
                continue;
            }
            if trimmed == "[ipv4]" {
                in_ipv4 = true;
                in_connection = false;
                continue;
            }
            if trimmed.starts_with('[') {
                in_connection = false;
                in_ipv4 = false;
                continue;
            }

            if in_connection {
                if let Some(val) = trimmed.strip_prefix("interface-name=") {
                    iface_name = Some(val.to_string());
                }
                if let Some(val) = trimmed.strip_prefix("id=") {
                    conn_id = Some(val.to_string());
                }
            }
            if in_ipv4 {
                if let Some(val) = trimmed.strip_prefix("method=") {
                    ipv4_method = Some(match val {
                        "manual" => "Static".to_string(),
                        "auto" => "DHCP".to_string(),
                        "shared" => "Shared".to_string(),
                        "link-local" => "Link-Local".to_string(),
                        "disabled" => "Disabled".to_string(),
                        other => other.to_string(),
                    });
                }
            }
        }

        if let (Some(iface), Some(method)) = (iface_name, ipv4_method) {
            let profile_name = conn_id.unwrap_or_else(|| {
                entry.path().file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            });
            map.insert(iface, NmProfileInfo { mode: method, profile_name });
        }
    }

    map
}

/// Read IP info for an interface using /proc/net or `ip` command parsing
fn read_ip_info(iface: &str) -> (Option<String>, Option<String>, Option<String>) {
    // Try reading from `ip -4 addr show <iface>` output
    let output = std::process::Command::new("ip")
        .args(["-4", "-o", "addr", "show", iface])
        .output();

    let ip_address = match &output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            // Format: "2: eth0    inet 10.10.1.1/24 brd 10.10.1.255 scope global eth0"
            stdout.split_whitespace()
                .find(|s| s.contains('/'))
                .and_then(|cidr| cidr.split('/').next())
                .map(|s| s.to_string())
        }
        Err(_) => None,
    };

    let subnet_mask = match &output {
        Ok(out) => {
            let stdout = String::from_utf8_lossy(&out.stdout);
            stdout.split_whitespace()
                .find(|s| s.contains('/'))
                .and_then(|cidr| cidr.split('/').nth(1))
                .and_then(|bits| cidr_to_mask(bits.parse().ok()?))
        }
        Err(_) => None,
    };

    // Gateway from `ip route show dev <iface>`
    let gateway = std::process::Command::new("ip")
        .args(["route", "show", "dev", iface])
        .output()
        .ok()
        .and_then(|out| {
            let stdout = String::from_utf8_lossy(&out.stdout);
            for line in stdout.lines() {
                if line.starts_with("default via") {
                    return line.split_whitespace().nth(2).map(|s| s.to_string());
                }
            }
            None
        });

    (ip_address, subnet_mask, gateway)
}

/// Convert CIDR prefix length to subnet mask string
fn cidr_to_mask(prefix: u8) -> Option<String> {
    if prefix > 32 { return None; }
    let mask: u32 = if prefix == 0 { 0 } else { !0u32 << (32 - prefix) };
    Some(format!(
        "{}.{}.{}.{}",
        (mask >> 24) & 0xFF,
        (mask >> 16) & 0xFF,
        (mask >> 8) & 0xFF,
        mask & 0xFF,
    ))
}

/// Read cellular signal quality via mmcli (ModemManager CLI).
/// Returns a percentage 0-100, or None if no modem is available.
///
/// When running in Docker (--privileged), mmcli isn't in the container.
/// We try: 1) direct mmcli, 2) nsenter to host PID 1 namespace, 3) chroot /host.
fn read_signal_quality() -> Option<u8> {
    // Strategy 1: Direct mmcli (works when running natively or mmcli is in container)
    if let Some(val) = try_mmcli(&["mmcli", "-m", "0", "--output-json"]) {
        return parse_mmcli_json(&val);
    }

    // Strategy 2: nsenter into host PID 1 namespace (Docker --privileged with --network host)
    if let Some(val) = try_mmcli_via_nsenter() {
        return parse_mmcli_json(&val).or_else(|| parse_mmcli_text(&val));
    }

    // Strategy 3: Try text output directly
    if let Some(val) = try_mmcli(&["mmcli", "-m", "0"]) {
        return parse_mmcli_text(&val);
    }

    None
}

fn try_mmcli(args: &[&str]) -> Option<String> {
    let output = std::process::Command::new(args[0])
        .args(&args[1..])
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

fn try_mmcli_via_nsenter() -> Option<String> {
    // nsenter -t 1 -m -u -i -n -- mmcli -m 0 --output-json
    // Enters host's mount/UTS/IPC/net namespaces via PID 1
    let output = std::process::Command::new("nsenter")
        .args(["-t", "1", "-m", "-u", "-i", "-n", "--", "mmcli", "-m", "0", "--output-json"])
        .output()
        .ok()?;
    if output.status.success() {
        return Some(String::from_utf8_lossy(&output.stdout).to_string());
    }
    // Fallback: text mode
    let output = std::process::Command::new("nsenter")
        .args(["-t", "1", "-m", "-u", "-i", "-n", "--", "mmcli", "-m", "0"])
        .output()
        .ok()?;
    if output.status.success() {
        Some(String::from_utf8_lossy(&output.stdout).to_string())
    } else {
        None
    }
}

fn parse_mmcli_json(stdout: &str) -> Option<u8> {
    if let Ok(json) = serde_json::from_str::<serde_json::Value>(stdout) {
        json.get("modem")
            .and_then(|m| m.get("generic"))
            .and_then(|g| g.get("signal-quality"))
            .and_then(|sq| sq.get("value"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<u8>().ok())
    } else {
        None
    }
}

fn parse_mmcli_text(stdout: &str) -> Option<u8> {
    for line in stdout.lines() {
        let trimmed = line.trim();
        if trimmed.contains("signal quality") {
            if let Some(pct) = trimmed.split('\'').nth(1)
                .or_else(|| trimmed.split(':').nth(1)) {
                let num_str: String = pct.chars().filter(|c| c.is_ascii_digit()).collect();
                return num_str.parse::<u8>().ok();
            }
        }
    }
    None
}

/// TCP connect probe for endpoint health check.
/// Attempts to connect to each target within the timeout.
/// Reports reachable/unreachable + latency for each target.
pub async fn run_endpoint_health_check(
    tx: mpsc::UnboundedSender<Message>,
    request_id: String,
    targets: Vec<HealthCheckTarget>,
    timeout_ms: u64,
) {
    let start = Instant::now();
    let to = Duration::from_millis(timeout_ms);
    let mut results = Vec::with_capacity(targets.len());

    for target in &targets {
        let addr = format!("{}:{}", target.ip, target.port);
        let probe_start = Instant::now();

        let result = match timeout(to, TcpStream::connect(&addr)).await {
            Ok(Ok(_stream)) => {
                let latency = probe_start.elapsed().as_millis() as u32;
                HealthCheckResult {
                    ip: target.ip.clone(),
                    port: target.port,
                    reachable: true,
                    latency_ms: Some(latency),
                    error: None,
                }
            }
            Ok(Err(e)) => HealthCheckResult {
                ip: target.ip.clone(),
                port: target.port,
                reachable: false,
                latency_ms: None,
                error: Some(e.to_string()),
            },
            Err(_) => HealthCheckResult {
                ip: target.ip.clone(),
                port: target.port,
                reachable: false,
                latency_ms: None,
                error: Some("timeout".to_string()),
            },
        };
        results.push(result);
    }

    let duration_ms = start.elapsed().as_millis() as u64;
    let response = AgentToServer::EndpointHealthCheckResult {
        request_id,
        results,
        duration_ms,
    };

    if let Ok(json) = serde_json::to_string(&response) {
        let _ = tx.send(Message::Text(json));
    }
}
