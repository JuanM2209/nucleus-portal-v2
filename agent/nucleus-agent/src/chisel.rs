use nucleus_common::messages::AgentToServer;
use std::collections::HashMap;
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, error};

/// Manages the chisel client process for TCP port forwarding.
///
/// Chisel reverse mode: client tells the server which ports to expose.
/// Ports are specified as CLI args — adding/removing requires process restart.
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

    pub async fn start(&mut self) {
        if !self.active_services.is_empty() {
            self.restart_chisel().await;
        } else {
            info!("ChiselManager ready (no services yet, will start on first expose)");
        }
    }

    /// Add a port exposure and restart chisel with all active services.
    pub async fn expose_port(&mut self, service_name: &str, local_addr: &str, remote_port: u16) {
        info!(
            service = service_name,
            local = local_addr,
            remote = remote_port,
            "Exposing port via chisel"
        );

        self.active_services.insert(
            service_name.to_string(),
            ServiceConfig {
                local_addr: local_addr.to_string(),
                remote_port,
            },
        );

        self.restart_chisel().await;

        // Send success response
        let msg = AgentToServer::PortExposed {
            service_name: service_name.to_string(),
            remote_port,
        };
        self.send_msg(&msg);
    }

    /// Remove a port exposure and restart chisel.
    pub async fn unexpose_port(&mut self, service_name: &str) {
        info!(service = service_name, "Unexposing port via chisel");
        self.active_services.remove(service_name);

        if self.active_services.is_empty() {
            // No services left — kill chisel
            if let Some(mut child) = self.child.take() {
                let _ = child.start_kill();
            }
            info!("All services removed, chisel stopped");
        } else {
            self.restart_chisel().await;
        }

        let msg = AgentToServer::PortUnexposeConfirm {
            service_name: service_name.to_string(),
        };
        self.send_msg(&msg);
    }

    /// Build chisel CLI args: client --auth USER:PASS URL R:PORT:ADDR ...
    fn build_chisel_args(&self) -> Vec<String> {
        let mut args = vec![
            "client".to_string(),
            "--auth".to_string(),
            self.auth.clone(),
            self.server_url.clone(),
        ];

        for svc in self.active_services.values() {
            args.push(format!("R:{}:{}", svc.remote_port, svc.local_addr));
        }

        args
    }

    /// Kill existing chisel process and start a new one with all active services.
    async fn restart_chisel(&mut self) {
        // Kill existing process
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            // Brief wait for clean shutdown
            tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        }

        if self.active_services.is_empty() {
            return;
        }

        let args = self.build_chisel_args();
        info!(services = self.active_services.len(), "Starting chisel client");

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
                error!("Failed to start chisel: {}", e);
            }
        }
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            info!("Chisel client stopped");
        }
        self.active_services.clear();
    }

    fn send_msg(&self, msg: &AgentToServer) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }
}
