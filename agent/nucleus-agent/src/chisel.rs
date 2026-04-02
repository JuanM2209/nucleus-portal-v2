use nucleus_common::messages::AgentToServer;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, error};

/// Manages the chisel client process for TCP port forwarding.
///
/// Uses a debounce pattern: when ports change rapidly (multiple expose/unexpose),
/// waits 3 seconds after the last change before restarting chisel.
/// This ensures chisel starts ONCE with ALL ports, not per-port.
pub struct ChiselManager {
    binary_path: String,
    child: Option<Child>,
    active_services: Arc<Mutex<HashMap<String, ServiceConfig>>>,
    server_url: String,
    auth: String,
    tx: mpsc::UnboundedSender<Message>,
    restart_notify: Arc<Notify>,
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
        let mgr = Self {
            binary_path: binary_path.to_string(),
            child: None,
            active_services: Arc::new(Mutex::new(HashMap::new())),
            server_url: server_url.to_string(),
            auth: auth.to_string(),
            tx,
            restart_notify: Arc::new(Notify::new()),
        };
        mgr
    }

    /// Start the debounce restart loop (runs in background).
    pub async fn start(&mut self) {
        info!("ChiselManager ready (no services yet, will start on first expose)");

        // Spawn background task that watches for restart signals
        let notify = self.restart_notify.clone();
        let services = self.active_services.clone();
        let binary = self.binary_path.clone();
        let url = self.server_url.clone();
        let auth = self.auth.clone();

        tokio::spawn(async move {
            let mut child: Option<Child> = None;

            loop {
                // Wait for a restart signal
                notify.notified().await;

                // Debounce: wait 3 seconds, consuming any additional signals
                loop {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => break,
                        _ = notify.notified() => {
                            // Another change came in, reset the timer
                            continue;
                        }
                    }
                }

                // Kill existing chisel
                if let Some(mut c) = child.take() {
                    let _ = c.start_kill();
                    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
                }

                // Build args from current services
                let args = {
                    let svcs = services.lock().unwrap();
                    if svcs.is_empty() {
                        info!("All services removed, chisel stopped");
                        continue;
                    }
                    let mut a = vec![
                        "client".to_string(),
                        "--auth".to_string(),
                        auth.clone(),
                        url.clone(),
                    ];
                    for svc in svcs.values() {
                        a.push(format!("R:{}:{}", svc.remote_port, svc.local_addr));
                    }
                    info!(services = svcs.len(), "Starting chisel with all ports");
                    a
                };

                // Start chisel
                match Command::new(&binary)
                    .args(&args)
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .kill_on_drop(true)
                    .spawn()
                {
                    Ok(c) => {
                        info!(pid = ?c.id(), "Chisel client started");
                        child = Some(c);
                    }
                    Err(e) => {
                        error!("Failed to start chisel: {}", e);
                    }
                }
            }
        });
    }

    /// Add a port exposure. Signals the background task to restart (debounced).
    pub fn expose_port(&mut self, service_name: &str, local_addr: &str, remote_port: u16) {
        info!(
            service = service_name,
            local = local_addr,
            remote = remote_port,
            "Exposing port via chisel"
        );

        {
            let mut svcs = self.active_services.lock().unwrap();
            svcs.insert(
                service_name.to_string(),
                ServiceConfig {
                    local_addr: local_addr.to_string(),
                    remote_port,
                },
            );
        }

        // Signal debounced restart
        self.restart_notify.notify_one();

        let msg = AgentToServer::PortExposed {
            service_name: service_name.to_string(),
            remote_port,
        };
        self.send_msg(&msg);
    }

    /// Remove a port exposure.
    pub fn unexpose_port(&mut self, service_name: &str) {
        info!(service = service_name, "Unexposing port via chisel");

        {
            let mut svcs = self.active_services.lock().unwrap();
            svcs.remove(service_name);
        }

        self.restart_notify.notify_one();

        let msg = AgentToServer::PortUnexposeConfirm {
            service_name: service_name.to_string(),
        };
        self.send_msg(&msg);
    }

    /// No-op flush (restart is handled by background debounce task).
    pub async fn flush(&mut self) {
        // Restart is managed by the background debounce loop
    }

    pub fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.start_kill();
        }
        self.active_services.lock().unwrap().clear();
        info!("Chisel client stopped");
    }

    fn send_msg(&self, msg: &AgentToServer) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }
}
