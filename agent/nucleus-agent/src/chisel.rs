use nucleus_common::messages::AgentToServer;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, error};

/// Manages the chisel client process for TCP port forwarding.
///
/// Chisel uses reverse mode: the client tells the server which ports to expose.
/// Unlike rathole, chisel has no config file — ports are specified as CLI args.
/// Adding/removing ports requires restarting the chisel process (<1s).
///
/// Flow:
///   portal sends port_expose → agent adds to active_services → restart_chisel()
///   portal sends port_unexpose → agent removes from active_services → restart_chisel()
pub struct ChiselManager {
    binary_path: String,
    child: Option<Child>,
    active_services: HashMap<String, ServiceConfig>,
    server_url: String,
    auth: String,
    tx: mpsc::UnboundedSender<Message>,
}

#[derive(Debug, Clone)]
struct ServiceConfig {
    service_name: String,
    local_addr: String,
    remote_port: u16,
}

impl ChiselManager {
    pub fn new(
        binary_path: &str,
        server_url: &str,
        auth: &str,
        tx: mpsc::UnboundedSender<Message>,
    ) -> Self {
        Self {
            binary_path: binary_path.to_string(),
            child: None,
            active_services: HashMap::new(),
            server_url: server_url.to_string(),
            auth: auth.to_string(),
            tx,
        }
    }

    /// Start chisel client (only if there are active services).
    pub async fn start(&mut self) {
        if !self.active_services.is_empty() {
            self.restart_chisel().await;
        } else {
            info!("ChiselManager ready (no services yet, will start on first expose)");
        }
    }

    /// Add a port exposure and restart chisel.
    pub fn expose_port(&mut self, service_name: &str, local_addr: &str, remote_port: u16) {
        info!(
            service = service_name,
            local = local_addr,
            remote = remote_port,
            "Exposing port via chisel"
        );

        self.active_services.insert(
            service_name.to_string(),
            ServiceConfig {
                service_name: service_name.to_string(),
                local_addr: local_addr.to_string(),
                remote_port,
            },
        );

        // Spawn restart in background to avoid blocking the message handler
        let mgr_info = self.build_chisel_args();
        let binary = self.binary_path.clone();
        let svc_name = service_name.to_string();
        let tx = self.tx.clone();
        let rport = remote_port;

        // Kill existing child synchronously
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }

        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            match Command::new(&binary)
                .args(&mgr_info)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
            {
                Ok(_child) => {
                    info!("Chisel restarted with {} services", mgr_info.len() - 3); // subtract: client, --auth, URL
                    let msg = AgentToServer::PortExposed {
                        service_name: svc_name,
                        remote_port: rport,
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        let _ = tx.send(Message::Text(json));
                    }
                }
                Err(e) => {
                    error!("Failed to start chisel: {}", e);
                    let msg = AgentToServer::PortError {
                        service_name: svc_name,
                        error: format!("Chisel start failed: {}", e),
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        let _ = tx.send(Message::Text(json));
                    }
                }
            }
        });
    }

    /// Remove a port exposure and restart chisel.
    pub fn unexpose_port(&mut self, service_name: &str) {
        info!(service = service_name, "Unexposing port via chisel");
        self.active_services.remove(service_name);

        // Kill existing
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }

        let svc_name = service_name.to_string();
        let tx = self.tx.clone();

        if self.active_services.is_empty() {
            // No services left, don't restart chisel
            info!("All services removed, chisel stopped");
            let msg = AgentToServer::PortUnexposeConfirm {
                service_name: svc_name,
            };
            if let Ok(json) = serde_json::to_string(&msg) {
                let _ = tx.send(Message::Text(json));
            }
            return;
        }

        // Restart with remaining services
        let args = self.build_chisel_args();
        let binary = self.binary_path.clone();

        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
            match Command::new(&binary)
                .args(&args)
                .stdout(Stdio::null())
                .stderr(Stdio::null())
                .kill_on_drop(true)
                .spawn()
            {
                Ok(_) => {
                    let msg = AgentToServer::PortUnexposeConfirm {
                        service_name: svc_name,
                    };
                    if let Ok(json) = serde_json::to_string(&msg) {
                        let _ = tx.send(Message::Text(json));
                    }
                }
                Err(e) => {
                    error!("Failed to restart chisel after unexpose: {}", e);
                }
            }
        });
    }

    /// Build chisel client command-line arguments.
    /// Format: client --auth USER:PASS SERVER_URL R:REMOTE:LOCAL R:REMOTE:LOCAL ...
    fn build_chisel_args(&self) -> Vec<String> {
        let mut args = vec![
            "client".to_string(),
            "--auth".to_string(),
            self.auth.clone(),
            self.server_url.clone(),
        ];

        for svc in self.active_services.values() {
            // R:REMOTE_PORT:LOCAL_ADDR (reverse mode)
            args.push(format!("R:{}:{}", svc.remote_port, svc.local_addr));
        }

        args
    }

    /// Restart the chisel client process with current active services.
    async fn restart_chisel(&mut self) {
        // Kill existing
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        }

        if self.active_services.is_empty() {
            info!("No active services, chisel not started");
            return;
        }

        let args = self.build_chisel_args();
        info!(args = ?args, "Starting chisel client");

        match Command::new(&self.binary_path)
            .args(&args)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => {
                info!(pid = ?child.id(), services = self.active_services.len(), "Chisel client started");
                self.child = Some(child);
            }
            Err(e) => {
                error!("Failed to start chisel client: {}", e);
            }
        }
    }

    /// Stop chisel and clear all services.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            info!("Chisel client stopped");
        }
        self.active_services.clear();
    }
}
