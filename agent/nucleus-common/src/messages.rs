use serde::{Deserialize, Serialize};
use crate::types::{AdapterInfo, DiscoveredEndpointInfo};

// ── Server → Agent ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum ServerToAgent {
    #[serde(rename = "session.open", alias = "start_session")]
    SessionOpen {
        #[serde(default, rename = "sessionId", alias = "session_id")]
        session_id: Option<String>,
        #[serde(default, rename = "targetIp", alias = "target_ip")]
        target_ip: Option<String>,
        #[serde(default, rename = "targetPort", alias = "target_port")]
        target_port: Option<u16>,
        #[serde(default, rename = "streamId", alias = "stream_id")]
        stream_id: Option<u32>,
        /// Go agent format nests fields under "payload"
        #[serde(default)]
        payload: Option<SessionPayload>,
    },
    #[serde(rename = "session.close", alias = "stop_session")]
    SessionClose {
        #[serde(default, rename = "sessionId", alias = "session_id")]
        session_id: Option<String>,
        #[serde(default)]
        payload: Option<SessionPayload>,
    },
    #[serde(rename = "discovery.trigger")]
    DiscoveryTrigger {
        #[serde(rename = "adapterId")]
        adapter_id: Option<String>,
        #[serde(rename = "scanType")]
        scan_type: String,
    },
    #[serde(rename = "ping")]
    Ping,

    // /comms WebSocket relay (browser → agent → device Node-RED /comms)
    #[serde(rename = "comms_open")]
    CommsOpen {
        #[serde(alias = "payload")]
        payload: CommsOpenPayload,
    },
    #[serde(rename = "comms_frame")]
    CommsFrame {
        #[serde(alias = "payload")]
        payload: CommsFramePayload,
    },
    #[serde(rename = "comms_close")]
    CommsClose {
        #[serde(alias = "payload")]
        payload: CommsClosePayload,
    },

    // mbusd process control
    #[serde(rename = "mbusd_start")]
    MbusdStart {
        #[serde(default)]
        payload: Option<MbusdConfig>,
    },
    #[serde(rename = "mbusd_stop")]
    MbusdStop,
    #[serde(rename = "mbusd_status")]
    MbusdStatusReq,

    // Network scanning (agent-side subnet scan)
    #[serde(rename = "network_scan")]
    NetworkScan {
        #[serde(default)]
        payload: Option<NetworkScanPayload>,
    },

    // Endpoint health check: TCP connect probe to a list of IP:port targets
    #[serde(rename = "endpoint_health_check")]
    EndpointHealthCheck {
        #[serde(default)]
        payload: Option<EndpointHealthCheckPayload>,
    },

    // Go proxy protocol: per-request TCP stream multiplexing
    #[serde(rename = "tcp_stream_open")]
    TcpStreamOpen {
        #[serde(default)]
        payload: Option<TcpStreamPayload>,
    },
    #[serde(rename = "tcp_stream_data")]
    TcpStreamData {
        #[serde(default)]
        payload: Option<TcpStreamDataPayload>,
    },
    #[serde(rename = "tcp_stream_close")]
    TcpStreamClose {
        #[serde(default)]
        payload: Option<TcpStreamPayload>,
    },

    // Force sync: agent should send heartbeat + discovery immediately
    #[serde(rename = "force_sync")]
    ForceSync,

    // Rathole port management (V2 transport)
    #[serde(rename = "port_expose")]
    PortExpose {
        service_name: String,
        local_addr: String,
        remote_port: u16,
    },
    #[serde(rename = "port_unexpose")]
    PortUnexpose {
        service_name: String,
    },
}

/// Endpoint health check — list of targets to TCP-probe
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct EndpointHealthCheckPayload {
    pub request_id: Option<String>,
    pub targets: Option<Vec<HealthCheckTarget>>,
    pub timeout_ms: Option<u64>,
}

/// A single target to probe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckTarget {
    pub ip: String,
    pub port: u16,
}

/// Result for a single target probe
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HealthCheckResult {
    pub ip: String,
    pub port: u16,
    pub reachable: bool,
    pub latency_ms: Option<u32>,
    pub error: Option<String>,
}

/// Network scan configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct NetworkScanPayload {
    pub adapter_name: Option<String>,
    pub scan_type: Option<String>,  // "quick", "standard", "deep"
    pub ports: Option<Vec<u16>>,    // custom port list (overrides scan_type)
    pub timeout_ms: Option<u64>,
    pub concurrency: Option<u32>,
}

/// Scanned host result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedHost {
    pub ip: String,
    pub ports: Vec<ScannedPort>,
    pub latency_ms: Option<u32>,
}

/// Scanned port result
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScannedPort {
    pub port: u16,
    pub open: bool,
    pub service: Option<String>,
}

/// Payload for tcp_stream_open/close
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TcpStreamPayload {
    pub session_id: Option<String>,
    pub stream_id: Option<u32>,
    pub target_ip: Option<String>,
    pub target_port: Option<u16>,
    pub port: Option<u16>,
}

/// Payload for tcp_stream_data (base64-encoded)
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct TcpStreamDataPayload {
    pub session_id: Option<String>,
    pub stream_id: Option<u32>,
    pub data: Option<String>,
}

/// Session payload for Go agent format: { type: "start_session", payload: { session_id, ... } }
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionPayload {
    pub session_id: Option<String>,
    pub target_ip: Option<String>,
    pub target_port: Option<u16>,
    pub stream_id: Option<u32>,
}

/// mbusd bridge configuration
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MbusdConfig {
    pub serial_port: Option<String>,
    pub baud_rate: Option<u32>,
    pub mode: Option<String>,       // e.g. "8n1", "8e1"
    pub tcp_port: Option<u16>,
    pub verbosity: Option<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommsOpenPayload {
    pub comms_id: String,
    pub target_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommsFramePayload {
    pub comms_id: String,
    pub data: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommsClosePayload {
    pub comms_id: String,
}

// ── Agent → Server ──

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentToServer {
    #[serde(rename = "heartbeat")]
    Heartbeat {
        cpu: f32,
        mem: u64,
        #[serde(rename = "memTotal")]
        mem_total: u64,
        disk: u64,
        #[serde(rename = "diskTotal")]
        disk_total: u64,
        uptime: u64,
        #[serde(rename = "agentVersion")]
        agent_version: String,
        #[serde(rename = "activeTunnels")]
        active_tunnels: u32,
        adapters: Vec<AdapterInfo>,
        #[serde(rename = "signalQuality", skip_serializing_if = "Option::is_none")]
        signal_quality: Option<u8>,
    },
    #[serde(rename = "session.ready")]
    SessionReady {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "streamId")]
        stream_id: u32,
    },
    #[serde(rename = "session.error")]
    SessionError {
        #[serde(rename = "sessionId")]
        session_id: String,
        error: String,
    },
    #[serde(rename = "session.closed")]
    SessionClosed {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "bytesTx")]
        bytes_tx: u64,
        #[serde(rename = "bytesRx")]
        bytes_rx: u64,
    },
    #[serde(rename = "discovery.result")]
    DiscoveryResult {
        #[serde(rename = "adapterId")]
        adapter_id: String,
        #[serde(rename = "adapterName")]
        adapter_name: String,
        endpoints: Vec<DiscoveredEndpointInfo>,
    },
    #[serde(rename = "pong")]
    Pong,

    // /comms WebSocket relay responses
    #[serde(rename = "comms_opened")]
    CommsOpened {
        comms_id: String,
    },
    #[serde(rename = "comms_frame")]
    CommsFrame {
        comms_id: String,
        data: String,
    },
    #[serde(rename = "comms_closed")]
    CommsClosed {
        comms_id: String,
    },
    #[serde(rename = "comms_error")]
    CommsError {
        comms_id: String,
        error: String,
    },

    // mbusd process control responses
    #[serde(rename = "mbusd_started")]
    MbusdStarted {
        pid: u32,
        tcp_port: u16,
    },
    #[serde(rename = "mbusd_stopped")]
    MbusdStopped,
    #[serde(rename = "mbusd_error")]
    MbusdError {
        error: String,
    },
    #[serde(rename = "mbusd_status")]
    MbusdStatusResp {
        active: bool,
        pid: Option<u32>,
        tcp_port: Option<u16>,
        serial_port: Option<String>,
    },

    // Network scan results
    #[serde(rename = "network_scan_result")]
    NetworkScanResult {
        adapter_name: String,
        hosts: Vec<ScannedHost>,
        scan_type: String,
        duration_ms: u64,
    },
    #[serde(rename = "network_scan_error")]
    NetworkScanError {
        adapter_name: String,
        error: String,
    },

    // Endpoint health check response
    #[serde(rename = "endpoint_health_check_result")]
    EndpointHealthCheckResult {
        request_id: String,
        results: Vec<HealthCheckResult>,
        duration_ms: u64,
    },

    // Go proxy protocol responses
    #[serde(rename = "tcp_stream_opened")]
    TcpStreamOpened {
        session_id: String,
        stream_id: u32,
    },
    #[serde(rename = "tcp_stream_data")]
    TcpStreamData {
        session_id: String,
        stream_id: u32,
        data: String,
    },
    #[serde(rename = "tcp_stream_closed")]
    TcpStreamClosed {
        session_id: String,
        stream_id: u32,
    },

    // Rathole port management responses (V2 transport)
    #[serde(rename = "port_exposed")]
    PortExposed {
        service_name: String,
        remote_port: u16,
    },
    #[serde(rename = "port_unexposed")]
    PortUnexposeConfirm {
        service_name: String,
    },
    #[serde(rename = "port_error")]
    PortError {
        service_name: String,
        error: String,
    },
}
