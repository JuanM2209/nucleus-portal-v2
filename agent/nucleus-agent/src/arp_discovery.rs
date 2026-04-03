use pnet::datalink::{self, Channel, NetworkInterface};
use pnet::packet::arp::{ArpHardwareTypes, ArpOperations, ArpPacket, MutableArpPacket};
use pnet::packet::ethernet::{EtherTypes, EthernetPacket, MutableEthernetPacket};
use pnet::packet::Packet;
use pnet::util::MacAddr;
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::time::{Duration, Instant};
use tracing::{info, warn, debug};

/// A host discovered via ARP reply.
#[derive(Debug, Clone)]
pub struct ArpHost {
    pub ip: Ipv4Addr,
    pub mac: MacAddr,
    pub latency_ms: u32,
}

/// Perform an ARP sweep on a network interface.
/// Sends ARP who-has requests to all target IPs, collects replies.
/// Returns list of responding hosts.
pub fn arp_sweep(
    interface_name: &str,
    source_ip: Ipv4Addr,
    targets: &[Ipv4Addr],
    timeout: Duration,
) -> Vec<ArpHost> {
    if targets.is_empty() {
        return vec![];
    }

    // Find the network interface
    let interfaces = datalink::interfaces();
    let iface = match interfaces.iter().find(|i| i.name == interface_name) {
        Some(i) => i.clone(),
        None => {
            warn!(adapter = interface_name, "ARP sweep: interface not found");
            return vec![];
        }
    };

    let source_mac = match iface.mac {
        Some(mac) if mac != MacAddr::zero() => mac,
        _ => {
            warn!(adapter = interface_name, "ARP sweep: no MAC address on interface");
            return vec![];
        }
    };

    info!(
        adapter = interface_name,
        source_ip = %source_ip,
        source_mac = %source_mac,
        targets = targets.len(),
        "Starting ARP sweep"
    );

    // Open raw channel on the interface
    let (mut tx, mut rx) = match datalink::channel(&iface, Default::default()) {
        Ok(Channel::Ethernet(tx, rx)) => (tx, rx),
        Ok(_) => {
            warn!("ARP sweep: unsupported channel type");
            return vec![];
        }
        Err(e) => {
            warn!("ARP sweep: failed to open channel on {}: {}", interface_name, e);
            return vec![];
        }
    };

    // Track when each ARP request was sent
    let mut send_times: HashMap<Ipv4Addr, Instant> = HashMap::new();
    let start = Instant::now();

    // Send ARP requests for all targets
    for &target_ip in targets {
        let mut eth_buf = [0u8; 42]; // 14 (ethernet) + 28 (ARP)
        if let Some(mut eth_pkt) = MutableEthernetPacket::new(&mut eth_buf) {
            eth_pkt.set_destination(MacAddr::broadcast());
            eth_pkt.set_source(source_mac);
            eth_pkt.set_ethertype(EtherTypes::Arp);

            let mut arp_buf = [0u8; 28];
            if let Some(mut arp_pkt) = MutableArpPacket::new(&mut arp_buf) {
                arp_pkt.set_hardware_type(ArpHardwareTypes::Ethernet);
                arp_pkt.set_protocol_type(EtherTypes::Ipv4);
                arp_pkt.set_hw_addr_len(6);
                arp_pkt.set_proto_addr_len(4);
                arp_pkt.set_operation(ArpOperations::Request);
                arp_pkt.set_sender_hw_addr(source_mac);
                arp_pkt.set_sender_proto_addr(source_ip);
                arp_pkt.set_target_hw_addr(MacAddr::zero());
                arp_pkt.set_target_proto_addr(target_ip);

                eth_pkt.set_payload(arp_pkt.packet());
            }

            send_times.insert(target_ip, Instant::now());
            if let Some(Err(e)) = tx.send_to(eth_pkt.packet(), None) {
                debug!("ARP send failed for {}: {}", target_ip, e);
            }
        }

        // Small delay between packets to avoid flooding the switch
        std::thread::sleep(Duration::from_micros(500));
    }

    let send_done = Instant::now();
    info!(
        sent = targets.len(),
        send_time_ms = send_done.duration_since(start).as_millis(),
        "ARP requests sent, listening for replies..."
    );

    // Collect ARP replies until timeout
    let mut discovered: HashMap<Ipv4Addr, ArpHost> = HashMap::new();
    let deadline = start + timeout;

    while Instant::now() < deadline {
        match rx.next() {
            Ok(data) => {
                if let Some(eth_pkt) = EthernetPacket::new(data) {
                    if eth_pkt.get_ethertype() == EtherTypes::Arp {
                        if let Some(arp_pkt) = ArpPacket::new(eth_pkt.payload()) {
                            if arp_pkt.get_operation() == ArpOperations::Reply {
                                let reply_ip = arp_pkt.get_sender_proto_addr();
                                let reply_mac = arp_pkt.get_sender_hw_addr();

                                // Only track replies from our target list
                                if let Some(sent_at) = send_times.get(&reply_ip) {
                                    let latency = Instant::now().duration_since(*sent_at).as_millis() as u32;
                                    debug!(ip = %reply_ip, mac = %reply_mac, latency_ms = latency, "ARP reply");
                                    discovered.entry(reply_ip).or_insert(ArpHost {
                                        ip: reply_ip,
                                        mac: reply_mac,
                                        latency_ms: latency,
                                    });
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                debug!("ARP rx error: {}", e);
                std::thread::sleep(Duration::from_millis(10));
            }
        }
    }

    let hosts: Vec<ArpHost> = discovered.into_values().collect();
    info!(
        adapter = interface_name,
        hosts_found = hosts.len(),
        duration_ms = start.elapsed().as_millis(),
        "ARP sweep complete"
    );
    hosts
}

/// MAC OUI vendor lookup (top industrial vendors).
pub fn mac_vendor(mac: &MacAddr) -> Option<&'static str> {
    let oui = (mac.0, mac.1, mac.2);
    match oui {
        // Siemens
        (0x00, 0x0E, 0x8C) | (0x00, 0x1B, 0x1B) | (0x08, 0x00, 0x06) => Some("Siemens"),
        // Rockwell / Allen-Bradley
        (0x00, 0x1D, 0x9C) | (0x00, 0x00, 0xBC) => Some("Rockwell Automation"),
        // Schneider Electric
        (0x00, 0x80, 0xF4) | (0x00, 0x0F, 0x7E) => Some("Schneider Electric"),
        // Moxa
        (0x00, 0x90, 0xE8) => Some("Moxa"),
        // Emerson / Fisher-Rosemount
        (0x00, 0xA0, 0x68) | (0x00, 0x30, 0x11) => Some("Emerson"),
        // ABB
        (0x00, 0x04, 0xBE) => Some("ABB"),
        // Beckhoff
        (0x00, 0x01, 0x05) => Some("Beckhoff"),
        // Phoenix Contact
        (0x00, 0xA0, 0x45) => Some("Phoenix Contact"),
        // Wago
        (0x00, 0x30, 0xDE) => Some("WAGO"),
        // Hikvision (cameras)
        (0x28, 0x57, 0xBE) | (0xC0, 0x56, 0xE3) | (0x44, 0x47, 0xCC) => Some("Hikvision"),
        // Dahua (cameras)
        (0x3C, 0xEF, 0x8C) | (0xB0, 0xA7, 0x32) => Some("Dahua"),
        // Axis (cameras)
        (0x00, 0x40, 0x8C) | (0xAC, 0xCC, 0x8E) => Some("Axis"),
        // Advantech
        (0x00, 0x0B, 0xAB) | (0x08, 0x00, 0x27) => Some("Advantech"),
        // Cisco
        (0x00, 0x1A, 0xA1) | (0x00, 0x26, 0x0B) | (0x00, 0x1E, 0x49) => Some("Cisco"),
        // TP-Link
        (0x50, 0xC7, 0xBF) | (0xEC, 0x08, 0x6B) | (0x60, 0xE3, 0x27) => Some("TP-Link"),
        // Raspberry Pi
        (0xB8, 0x27, 0xEB) | (0xDC, 0xA6, 0x32) | (0xE4, 0x5F, 0x01) => Some("Raspberry Pi"),
        // Honeywell
        (0x00, 0x10, 0xE3) => Some("Honeywell"),
        // GE
        (0x00, 0x04, 0xA5) => Some("GE"),
        // Mitsubishi
        (0x00, 0x0C, 0xCE) => Some("Mitsubishi Electric"),
        // Omron
        (0x00, 0x00, 0x74) => Some("Omron"),
        // Yokogawa
        (0x00, 0xE0, 0x58) => Some("Yokogawa"),
        // Belden / Hirschmann
        (0x00, 0x80, 0x63) => Some("Hirschmann/Belden"),
        // Broadcom (common in embedded)
        (0xB4, 0xFB, 0xE4) => Some("Broadcom"),
        // Texas Instruments (BeagleBone, etc)
        (0xD4, 0x36, 0x39) | (0x90, 0x59, 0xAF) => Some("Texas Instruments"),
        _ => None,
    }
}
