use crate::config::RatholeConfig;
use nucleus_common::messages::AgentToServer;
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Stdio;
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn, error};

/// Manages the rathole client process and dynamic port configuration.
///
/// When the portal sends `port_expose`, the manager:
/// 1. Adds the service to the rathole client config
/// 2. Writes the config file
/// 3. Rathole hot-reloads automatically (file watch)
///
/// When the portal sends `port_unexpose`, the manager:
/// 1. Removes the service from config
/// 2. Writes updated config (hot-reload removes the tunnel)
pub struct RatholeManager {
    config_path: PathBuf,
    binary_path: String,
    child: Option<Child>,
    active_services: HashMap<String, ServiceConfig>,
    server_addr: String,
    token: String,
    tx: mpsc::UnboundedSender<Message>,
}

#[derive(Debug, Clone)]
struct ServiceConfig {
    local_addr: String,
    remote_port: u16,
}

impl RatholeManager {
    pub fn new(
        config: &RatholeConfig,
        server_addr: &str,
        token: &str,
        tx: mpsc::UnboundedSender<Message>,
    ) -> Self {
        Self {
            config_path: PathBuf::from(&config.config_path),
            binary_path: config.binary_path.clone(),
            child: None,
            active_services: HashMap::new(),
            server_addr: server_addr.to_string(),
            token: token.to_string(),
            tx,
        }
    }

    /// Start the rathole client process.
    pub async fn start(&mut self) {
        if self.child.is_some() {
            info!("Rathole client already running");
            return;
        }

        // Write initial empty config
        if let Err(e) = self.write_config() {
            error!("Failed to write initial rathole config: {}", e);
            return;
        }

        match Command::new(&self.binary_path)
            .arg("--client")
            .arg(self.config_path.to_str().unwrap_or(""))
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(child) => {
                info!("Rathole client started (PID: {:?})", child.id());
                self.child = Some(child);
            }
            Err(e) => {
                error!("Failed to start rathole client: {}", e);
            }
        }
    }

    /// Add a port exposure. Writes config and rathole hot-reloads.
    pub fn expose_port(&mut self, service_name: &str, local_addr: &str, remote_port: u16) {
        info!(
            service = service_name,
            local = local_addr,
            remote = remote_port,
            "Exposing port via rathole"
        );

        self.active_services.insert(
            service_name.to_string(),
            ServiceConfig {
                local_addr: local_addr.to_string(),
                remote_port,
            },
        );

        match self.write_config() {
            Ok(()) => {
                let msg = AgentToServer::PortExposed {
                    service_name: service_name.to_string(),
                    remote_port,
                };
                self.send_msg(&msg);
            }
            Err(e) => {
                error!("Failed to write rathole config: {}", e);
                let msg = AgentToServer::PortError {
                    service_name: service_name.to_string(),
                    error: format!("Config write failed: {}", e),
                };
                self.send_msg(&msg);
            }
        }
    }

    /// Remove a port exposure. Writes config and rathole hot-reloads.
    pub fn unexpose_port(&mut self, service_name: &str) {
        info!(service = service_name, "Unexposing port via rathole");

        self.active_services.remove(service_name);

        match self.write_config() {
            Ok(()) => {
                let msg = AgentToServer::PortUnexposeConfirm {
                    service_name: service_name.to_string(),
                };
                self.send_msg(&msg);
            }
            Err(e) => {
                error!("Failed to write rathole config: {}", e);
            }
        }
    }

    /// Generate and write the TOML config file. Rathole watches this file for changes.
    fn write_config(&self) -> Result<(), std::io::Error> {
        let mut toml = String::with_capacity(512);
        toml.push_str("[client]\n");
        toml.push_str(&format!("remote_addr = \"{}\"\n", self.server_addr));
        toml.push_str(&format!("default_token = \"{}\"\n\n", self.token));

        for (name, svc) in &self.active_services {
            toml.push_str(&format!("[client.services.\"{}\"]\n", name));
            toml.push_str(&format!("local_addr = \"{}\"\n\n", svc.local_addr));
        }

        // Ensure parent directory exists
        if let Some(parent) = self.config_path.parent() {
            std::fs::create_dir_all(parent)?;
        }

        std::fs::write(&self.config_path, toml)?;
        info!(
            services = self.active_services.len(),
            "Rathole config written (hot-reload will pick up changes)"
        );
        Ok(())
    }

    /// Stop the rathole client process and clear all services.
    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
            info!("Rathole client stopped");
        }
        self.active_services.clear();
    }

    /// Get count of active services for heartbeat reporting.
    pub fn active_count(&self) -> usize {
        self.active_services.len()
    }

    fn send_msg(&self, msg: &AgentToServer) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }
}
