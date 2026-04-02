use nucleus_common::messages::{AgentToServer, MbusdConfig};
use std::process::{Child, Command, Stdio};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn, error};

/// Manages the mbusd process lifecycle on the device.
///
/// mbusd translates Modbus RTU (serial) ↔ Modbus TCP, allowing
/// remote PLC access via the portal's tunnel system.
pub struct MbusdManager {
    tx: mpsc::UnboundedSender<Message>,
    child: Option<Child>,
    config: Option<MbusdConfig>,
}

impl MbusdManager {
    pub fn new(tx: mpsc::UnboundedSender<Message>) -> Self {
        Self {
            tx,
            child: None,
            config: None,
        }
    }

    /// Start mbusd with the given configuration.
    /// Equivalent to: `mbusd -d -v 2 -p /dev/ttymxc5 -s 9600 -m 8n1 -P 2202`
    pub fn start(&mut self, config: MbusdConfig) {
        // Kill existing instance if running
        self.stop_internal();

        let serial_port = config.serial_port.clone().unwrap_or_else(|| "/dev/ttymxc5".to_string());
        let baud_rate = config.baud_rate.unwrap_or(9600).to_string();
        let mode = config.mode.clone().unwrap_or_else(|| "8n1".to_string());
        let tcp_port = config.tcp_port.unwrap_or(2202);
        let verbosity = config.verbosity.unwrap_or(2).to_string();

        info!(
            serial_port = %serial_port,
            baud_rate = %baud_rate,
            mode = %mode,
            tcp_port = tcp_port,
            "Starting mbusd"
        );

        // Validate serial port exists
        if !std::path::Path::new(&serial_port).exists() {
            let err = format!("Serial port {} does not exist", serial_port);
            error!("{}", err);
            self.send_response(&AgentToServer::MbusdError { error: err });
            return;
        }

        // Spawn mbusd process.
        // mbusd binary is bundled in the container image at /usr/local/bin/mbusd.
        // With --privileged docker flag, the container has full /dev access
        // so mbusd can open serial ports directly. Falls back to nsenter
        // for host namespace execution if direct spawn fails.
        //
        // Flags: -d = don't daemonize, -v = verbosity, -p = serial port,
        //        -s = baud rate, -m = mode, -P = TCP port
        let mbusd_args = ["-d", "-v", &verbosity, "-p", &serial_port,
                          "-s", &baud_rate, "-m", &mode, "-P", &tcp_port.to_string()];

        info!("Starting mbusd directly...");
        let spawn_result = Command::new("mbusd")
            .args(&mbusd_args)
            .stderr(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .or_else(|e| {
                warn!("Direct mbusd failed ({}), trying nsenter to host...", e);
                Command::new("nsenter")
                    .args(["-t", "1", "-m", "-u", "-i", "-n", "--", "mbusd"])
                    .args(&mbusd_args)
                    .stderr(Stdio::piped())
                    .stdout(Stdio::piped())
                    .spawn()
            });

        match spawn_result
        {
            Ok(mut child) => {
                let pid = child.id();
                info!(pid = pid, tcp_port = tcp_port, "mbusd spawned, verifying...");

                // Wait briefly to check if mbusd survives startup
                std::thread::sleep(std::time::Duration::from_millis(500));

                match child.try_wait() {
                    Ok(Some(exit_status)) => {
                        // Process already exited — capture stderr for diagnostics
                        let stderr_msg = child.stderr.take()
                            .and_then(|mut se| {
                                use std::io::Read;
                                let mut buf = String::new();
                                se.read_to_string(&mut buf).ok().map(|_| buf)
                            })
                            .unwrap_or_default();
                        let stdout_msg = child.stdout.take()
                            .and_then(|mut so| {
                                use std::io::Read;
                                let mut buf = String::new();
                                so.read_to_string(&mut buf).ok().map(|_| buf)
                            })
                            .unwrap_or_default();

                        let detail = if !stderr_msg.trim().is_empty() {
                            stderr_msg.trim().to_string()
                        } else if !stdout_msg.trim().is_empty() {
                            stdout_msg.trim().to_string()
                        } else {
                            format!("exit code {}", exit_status)
                        };
                        let err = format!("mbusd exited immediately: {}", detail);
                        error!("{}", err);
                        self.send_response(&AgentToServer::MbusdError { error: err });
                    }
                    Ok(None) => {
                        // Still running — success
                        info!(pid = pid, tcp_port = tcp_port, "mbusd confirmed running");
                        self.child = Some(child);
                        self.config = Some(config);
                        self.send_response(&AgentToServer::MbusdStarted {
                            pid,
                            tcp_port,
                        });
                    }
                    Err(e) => {
                        let err = format!("Failed to check mbusd status after spawn: {}", e);
                        error!("{}", err);
                        self.send_response(&AgentToServer::MbusdError { error: err });
                    }
                }
            }
            Err(e) => {
                let err = format!("Failed to start mbusd: {}", e);
                error!("{}", err);
                self.send_response(&AgentToServer::MbusdError { error: err });
            }
        }
    }

    /// Stop the running mbusd process.
    pub fn stop(&mut self) {
        if self.stop_internal() {
            info!("mbusd stopped by user request");
            self.send_response(&AgentToServer::MbusdStopped);
        } else {
            self.send_response(&AgentToServer::MbusdError {
                error: "mbusd is not running".to_string(),
            });
        }
    }

    /// Report current mbusd status.
    pub fn status(&mut self) {
        self.check_alive();
        let active = self.child.is_some();
        let pid = self.child.as_ref().map(|c| c.id());
        let tcp_port = self.config.as_ref().and_then(|c| c.tcp_port);
        let serial_port = self.config.as_ref().and_then(|c| c.serial_port.clone());

        self.send_response(&AgentToServer::MbusdStatusResp {
            active,
            pid,
            tcp_port,
            serial_port,
        });
    }

    /// Kill all mbusd processes on cleanup (agent disconnect).
    pub fn cleanup(&mut self) {
        self.stop_internal();
    }

    // ── Private ──

    fn stop_internal(&mut self) -> bool {
        if let Some(mut child) = self.child.take() {
            let pid = child.id();
            // Try child.kill() first (works when mbusd runs in same namespace)
            let _ = child.kill();
            let _ = child.wait();
            // Always also killall via nsenter — mbusd may run in host namespace
            let _ = Command::new("nsenter")
                .args(["-t", "1", "-m", "-u", "-i", "-n", "--", "killall", "mbusd"])
                .output();
            info!(pid = pid, "mbusd process killed");
            self.config = None;
            true
        } else {
            // Try killall anyway (might be a stale process from previous run)
            let _ = Command::new("killall").arg("mbusd").output();
            let _ = Command::new("nsenter").args(["-t", "1", "-m", "-u", "-i", "-n", "--", "killall", "mbusd"]).output();
            false
        }
    }

    fn check_alive(&mut self) {
        if let Some(ref mut child) = self.child {
            match child.try_wait() {
                Ok(Some(_status)) => {
                    // Process exited
                    info!("mbusd process exited");
                    self.child = None;
                    self.config = None;
                }
                Ok(None) => {} // Still running
                Err(e) => {
                    warn!(error = %e, "Failed to check mbusd status");
                    self.child = None;
                    self.config = None;
                }
            }
        }
    }

    fn send_response(&self, msg: &AgentToServer) {
        if let Ok(json) = serde_json::to_string(msg) {
            let _ = self.tx.send(Message::Text(json));
        }
    }
}
