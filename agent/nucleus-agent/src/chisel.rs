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
    /// Pending restart flag — batches rapid expose/unexpose calls into one restart
    needs_restart: bool,
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
            needs_restart: false,
        }
    }

    pub async fn start(&mut self) {
        if !self.active_services.is_empty() {
            self.restart_chisel().await;
        } else {
            info!("ChiselManager ready (no services yet, will start on first expose)");
        }
    }

    /// Add a port exposure. Marks for restart but doesn't restart immediately.
    /// Call `flush()` after processing all messages in the current batch.
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
                local_addr: local_addr.to_string(),
                remote_port,
            },
        );
        self.needs_restart = true;

        let msg = AgentToServer::PortExposed {
            service_name: service_name.to_string(),
            remote_port,
        };
        self.send_msg(&msg);
    }

    /// Remove a port exposure. Marks for restart.
    pub fn unexpose_port(&mut self, service_name: &str) {
        info!(service = service_name, "Unexposing port via chisel");
        self.active_services.remove(service_name);
        self.needs_restart = true;

        let msg = AgentToServer::PortUnexposeConfirm {
            service_name: service_name.to_string(),
        };
        self.send_msg(&msg);
    }

    /// Apply pending changes — restart chisel if any expose/unexpose happened.
    /// Called once after processing all WebSocket messages in the batch.
    pub async fn flush(&mut self) {
        if !self.needs_restart {
            return;
        }
        self.needs_restart = false;

        if self.active_services.is_empty() {
            if let Some(mut child) = self.child.take() {
                let _ = child.start_kill();
            }
            info!("All services removed, chisel stopped");
        } else {
            self.restart_chisel().await;
        }
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
