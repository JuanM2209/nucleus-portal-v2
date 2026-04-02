use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AdapterInfo {
    pub name: String,
    pub mac_address: Option<String>,
    pub ip_address: Option<String>,
    pub subnet_mask: Option<String>,
    pub gateway: Option<String>,
    pub mode: Option<String>,
    pub is_up: bool,
    /// NM connection profile name (e.g., "eth0-static", "eth1-dhcp")
    /// Allows detecting mismatches between profile name and actual mode
    #[serde(skip_serializing_if = "Option::is_none")]
    pub config_profile: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredService {
    pub port: u16,
    pub protocol: String,
    pub service_name: Option<String>,
    pub service_version: Option<String>,
    pub banner: Option<String>,
    pub tunnel_type: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiscoveredEndpointInfo {
    pub ip_address: String,
    pub mac_address: Option<String>,
    pub hostname: Option<String>,
    pub services: Vec<DiscoveredService>,
}
