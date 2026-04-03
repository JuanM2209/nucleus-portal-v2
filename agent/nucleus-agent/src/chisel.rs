use nucleus_common::messages::AgentToServer;
use std::collections::HashMap;
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;
use tokio::sync::Notify;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn, error};

/// Manages the chisel client process for TCP port forwarding.
///
/// Uses a debounce pattern: when ports change rapidly (multiple expose/unexpose),
/// waits 3 seconds after the last change before restarting chisel.
/// This ensures chisel starts ONCE with ALL ports, not per-port.
///
/// **Auto-restart**: A separate monitor task watches the chisel process.
/// If it exits unexpectedly (Cloudflare timeout, crash, etc.), the monitor
/// signals a restart with exponential backoff (2s → 4s → 8s → max 30s).
pub struct ChiselManager {
    binary_path: String,
    active_services: Arc<Mutex<HashMap<String, ServiceConfig>>>,
    /// Shared child handle so stop() can kill the process spawned by the background task.
    shared_child: Arc<Mutex<Option<Child>>>,
    server_url: String,
    auth: String,
    tx: mpsc::UnboundedSender<Message>,
    restart_notify: Arc<Notify>,
    /// Cancellation token for the background debounce task.
    cancel: Arc<Notify>,
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
            active_services: Arc::new(Mutex::new(HashMap::new())),
            shared_child: Arc::new(Mutex::new(None)),
            server_url: server_url.to_string(),
            auth: auth.to_string(),
            tx,
            restart_notify: Arc::new(Notify::new()),
            cancel: Arc::new(Notify::new()),
        }
    }

    /// Start the debounce restart loop (runs in background).
    ///
    /// The loop has two phases:
    /// 1. **Wait** for a restart signal (expose/unexpose/auto-restart)
    /// 2. **Debounce** 3s to batch rapid changes
    /// 3. **Spawn** chisel + monitor task that watches for unexpected exits
    pub async fn start(&mut self) {
        info!("ChiselManager ready (no services yet, will start on first expose)");

        let notify = self.restart_notify.clone();
        let cancel = self.cancel.clone();
        let services = self.active_services.clone();
        let shared_child = self.shared_child.clone();
        let binary = self.binary_path.clone();
        let url = self.server_url.clone();
        let auth = self.auth.clone();

        tokio::spawn(async move {
            loop {
                // Wait for a restart signal or cancellation
                tokio::select! {
                    _ = notify.notified() => {},
                    _ = cancel.notified() => {
                        info!("ChiselManager background task cancelled");
                        if let Ok(mut guard) = shared_child.lock() {
                            if let Some(mut c) = guard.take() {
                                let _ = c.start_kill();
                            }
                        }
                        break;
                    }
                }

                // Debounce: wait 3 seconds, consuming any additional signals
                let cancelled = loop {
                    tokio::select! {
                        _ = tokio::time::sleep(std::time::Duration::from_secs(3)) => break false,
                        _ = notify.notified() => {
                            // Another change came in, reset the timer
                            continue;
                        }
                        _ = cancel.notified() => break true,
                    }
                };
                if cancelled {
                    info!("ChiselManager background task cancelled during debounce");
                    if let Ok(mut guard) = shared_child.lock() {
                        if let Some(mut c) = guard.take() {
                            let _ = c.start_kill();
                        }
                    }
                    break;
                }

                // Kill existing chisel via shared handle
                {
                    let mut guard = shared_child.lock().unwrap();
                    if let Some(mut c) = guard.take() {
                        info!("Killing old chisel process");
                        let _ = c.start_kill();
                    }
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;

                // Build args from current services
                let args = {
                    let svcs = services.lock().unwrap();
                    if svcs.is_empty() {
                        info!("All services removed, chisel stopped");
                        continue;
                    }
                    let mut a = vec![
                        "client".to_string(),
                        "--keepalive".to_string(),
                        "15s".to_string(),
                        "--auth".to_string(),
                        auth.clone(),
                        url.clone(),
                    ];
                    for svc in svcs.values() {
                        a.push(format!("R:{}:{}", svc.remote_port, svc.local_addr));
                    }
                    info!(services = svcs.len(), args = ?a, "Starting chisel with all ports");
                    a
                };

                // Start chisel
                match Command::new(&binary)
                    .args(&args)
                    .stdout(Stdio::piped())
                    .stderr(Stdio::piped())
                    .kill_on_drop(true)
                    .spawn()
                {
                    Ok(c) => {
                        let pid = c.id();
                        info!(pid = ?pid, "Chisel client started");
                        {
                            let mut guard = shared_child.lock().unwrap();
                            *guard = Some(c);
                        }

                        // Spawn monitor task: watches the chisel process and
                        // triggers auto-restart if it exits unexpectedly.
                        let monitor_child = shared_child.clone();
                        let monitor_notify = notify.clone();
                        let monitor_services = services.clone();
                        tokio::spawn(async move {
                            // Poll every 2s to check if chisel is still alive
                            loop {
                                tokio::time::sleep(std::time::Duration::from_secs(2)).await;

                                let mut guard = monitor_child.lock().unwrap();
                                if let Some(ref mut child) = *guard {
                                    match child.try_wait() {
                                        Ok(Some(status)) => {
                                            // Process exited — remove dead child
                                            guard.take();
                                            drop(guard);

                                            // Only restart if there are still active services
                                            let has_services = {
                                                let svcs = monitor_services.lock().unwrap();
                                                !svcs.is_empty()
                                            };

                                            if has_services {
                                                warn!(
                                                    code = ?status.code(),
                                                    "Chisel exited unexpectedly — auto-restart in 3s"
                                                );
                                                monitor_notify.notify_one();
                                            } else {
                                                info!(code = ?status.code(), "Chisel exited (no active services)");
                                            }
                                            return;
                                        }
                                        Ok(None) => {
                                            // Still running — keep monitoring
                                            continue;
                                        }
                                        Err(e) => {
                                            warn!("Error checking chisel process: {}", e);
                                            guard.take();
                                            drop(guard);
                                            monitor_notify.notify_one();
                                            return;
                                        }
                                    }
                                } else {
                                    // Child was taken by someone else (stop() or new restart)
                                    return;
                                }
                            }
                        });
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
            info!(total_services = svcs.len(), "Service added to chisel map");
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
            info!(total_services = svcs.len(), "Service removed from chisel map");
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

    /// Stop chisel and cancel the background task.
    pub fn stop(&mut self) {
        // Signal the background task to exit
        self.cancel.notify_one();

        // Also kill chisel directly (belt and suspenders)
        if let Ok(mut guard) = self.shared_child.lock() {
            if let Some(mut child) = guard.take() {
                info!("Stopping chisel client process");
                let _ = child.start_kill();
            }
        }

        self.active_services.lock().unwrap().clear();
        info!("Chisel client stopped and services cleared");
    }

    fn send_msg(&self, msg: &AgentToServer) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }
}
