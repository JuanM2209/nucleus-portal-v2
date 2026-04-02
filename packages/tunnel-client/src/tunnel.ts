import * as net from 'net';
import WebSocket from 'ws';

export interface TunnelConfig {
  serverUrl: string;
  sessionToken: string;
  remotePort: number;
  localPort: number;
}

interface ActiveConnection {
  id: number;
  socket: net.Socket;
  bytesIn: number;
  bytesOut: number;
}

/** Device info received from backend on session.ready */
interface SessionInfo {
  deviceName: string;
  deviceId: string;
  targetPort: number;
  targetIp: string;
  isLocalPort: boolean;
}

/**
 * TunnelClient — bridges local TCP connections to a remote device port
 * through the Nucleus Portal WebSocket tunnel.
 *
 * Flow:
 *   Local App (Modbus Poll, PCCU, etc.)
 *     ↕ TCP on localhost:{localPort}
 *   TunnelClient
 *     ↕ WebSocket to Nucleus backend
 *   Nucleus Backend
 *     ↕ Agent tunnel bridge
 *   Device Agent
 *     ↕ TCP to device localhost:{remotePort}
 *   Target Service (Modbus, Serial, etc.)
 */
export class TunnelClient {
  private readonly config: TunnelConfig;
  private server: net.Server | null = null;
  private ws: WebSocket | null = null;
  private keepAliveInterval: ReturnType<typeof setInterval> | null = null;
  private connections = new Map<number, ActiveConnection>();
  private nextConnId = 1;
  private reconnectAttempts = 0;
  private readonly maxReconnects = 5;
  private closed = false;
  private sessionInfo: SessionInfo | null = null;

  constructor(config: TunnelConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    // Step 1: Connect to Nucleus backend WebSocket
    await this.connectWebSocket();

    // Step 2: Start local TCP server
    await this.startTcpServer();
  }

  close(): void {
    this.closed = true;
    for (const [id, conn] of this.connections) {
      conn.socket.destroy();
      this.sendMessage({ type: 'stream.close', connectionId: id });
    }
    this.connections.clear();
    this.server?.close();
    this.ws?.close();
  }

  // ── WebSocket Connection ──

  private connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const wsUrl = `${this.config.serverUrl}/ws/tunnel?token=${encodeURIComponent(this.config.sessionToken)}`;
      // Don't show the server URL — protect the API endpoint
      this.log('info', 'Connecting to Nucleus Cloud...');

      const ws = new WebSocket(wsUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.sessionToken}`,
        },
      });

      ws.on('open', () => {
        this.ws = ws;
        this.reconnectAttempts = 0;
        this.log('success', 'Connected to Nucleus Cloud');

        // Keepalive ping every 30s — prevents Cloudflare from closing idle WebSockets (~100s timeout)
        if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
        this.keepAliveInterval = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
          }
        }, 30_000);

        // Send session bind
        this.sendMessage({
          type: 'session.bind',
          token: this.config.sessionToken,
          remotePort: this.config.remotePort,
        });
      });

      ws.on('message', (data: WebSocket.Data) => {
        this.handleMessage(data);
      });

      ws.on('close', (code, reason) => {
        if (this.keepAliveInterval) { clearInterval(this.keepAliveInterval); this.keepAliveInterval = null; }
        if (this.closed) return;
        this.log('warn', `Connection lost (code: ${code})`);
        this.ws = null;
        this.handleReconnect();
      });

      ws.on('error', (err) => {
        if (!this.ws) {
          reject(new Error(`Connection failed — check your token`));
        } else {
          this.log('error', `Connection error: ${err.message}`);
        }
      });

      // Resolve once we receive session.ready
      const onReady = (data: WebSocket.Data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'session.ready') {
            ws.removeListener('message', onReady);

            // Store session info for display
            this.sessionInfo = {
              deviceName: msg.deviceName || msg.deviceId?.substring(0, 8) || 'unknown',
              deviceId: msg.deviceId || '',
              targetPort: msg.targetPort || this.config.remotePort,
              targetIp: msg.targetIp || 'localhost',
              isLocalPort: msg.isLocalPort ?? true,
            };

            // Print device connection info
            this.printSessionInfo();
            resolve();
          } else if (msg.type === 'session.error') {
            ws.removeListener('message', onReady);
            reject(new Error(`Session error: ${msg.error || 'unknown'}`));
          }
        } catch {}
      };
      ws.on('message', onReady);

      // Timeout
      setTimeout(() => {
        if (!this.ws) {
          ws.removeListener('message', onReady);
          reject(new Error('Connection timeout — check your token'));
        }
      }, 30000);
    });
  }

  private printSessionInfo(): void {
    const info = this.sessionInfo;
    if (!info) return;

    const targetDisplay = info.isLocalPort
      ? `device (localhost:${info.targetPort})`
      : `${info.targetIp}:${info.targetPort}`;

    console.log('');
    console.log(`  \x1b[36m┌─────────────────────────────────────────┐\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  \x1b[1mDevice:\x1b[0m  ${info.deviceName.padEnd(29)}\x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  \x1b[1mTarget:\x1b[0m  ${targetDisplay.padEnd(29)}\x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m│\x1b[0m  \x1b[1mLocal:\x1b[0m   localhost:${String(this.config.localPort).padEnd(20)}\x1b[36m│\x1b[0m`);
    console.log(`  \x1b[36m└─────────────────────────────────────────┘\x1b[0m`);
    console.log('');
  }

  private handleReconnect(): void {
    if (this.closed || this.reconnectAttempts >= this.maxReconnects) {
      if (!this.closed) {
        this.log('error', `Max reconnect attempts (${this.maxReconnects}). Exiting.`);
        process.exit(1);
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(2000 * this.reconnectAttempts, 10000);
    this.log('info', `Reconnecting in ${delay / 1000}s (${this.reconnectAttempts}/${this.maxReconnects})...`);

    setTimeout(async () => {
      try {
        await this.connectWebSocket();
        this.log('success', 'Reconnected!');
      } catch (err) {
        this.log('error', `Reconnect failed: ${(err as Error).message}`);
        this.handleReconnect();
      }
    }, delay);
  }

  // ── TCP Server ──

  private startTcpServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        this.handleTcpConnection(socket);
      });

      server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          this.log('error', `Port ${this.config.localPort} is already in use`);
          this.log('info', `Try: --local-port ${this.config.localPort + 1000}`);
          reject(err);
        } else {
          this.log('error', `TCP server error: ${err.message}`);
          reject(err);
        }
      });

      server.listen(this.config.localPort, '127.0.0.1', () => {
        this.server = server;
        this.log('success', `Forwarding localhost:${this.config.localPort} → device:${this.config.remotePort}`);
        console.log('');
        this.log('info', `\x1b[32m  Ready! Connect your tools to:\x1b[0m`);
        this.log('info', `\x1b[36m  → localhost:${this.config.localPort}\x1b[0m`);
        console.log('');
        this.log('info', `Press Ctrl+C to stop.\n`);
        resolve();
      });
    });
  }

  // ── TCP Connection Handling ──

  private handleTcpConnection(socket: net.Socket): void {
    const connId = this.nextConnId++;
    const conn: ActiveConnection = { id: connId, socket, bytesIn: 0, bytesOut: 0 };
    this.connections.set(connId, conn);

    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    this.log('info', `[${connId}] New connection from ${remote}`);

    // Tell backend to open a stream to the device
    this.sendMessage({
      type: 'stream.open',
      connectionId: connId,
      remotePort: this.config.remotePort,
    });

    // Forward TCP data → WebSocket
    socket.on('data', (data: Buffer) => {
      conn.bytesOut += data.length;
      this.sendMessage({
        type: 'stream.data',
        connectionId: connId,
        data: data.toString('base64'),
      });
    });

    socket.on('close', () => {
      this.log('info', `[${connId}] Closed (in: ${formatBytes(conn.bytesIn)}, out: ${formatBytes(conn.bytesOut)})`);
      this.connections.delete(connId);
      this.sendMessage({ type: 'stream.close', connectionId: connId });
    });

    socket.on('error', (err) => {
      this.log('warn', `[${connId}] TCP error: ${err.message}`);
      this.connections.delete(connId);
    });
  }

  // ── WebSocket Message Handling ──

  private handleMessage(data: WebSocket.Data): void {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'stream.data': {
          const conn = this.connections.get(msg.connectionId);
          if (conn && !conn.socket.destroyed) {
            const buf = Buffer.from(msg.data, 'base64');
            conn.bytesIn += buf.length;
            conn.socket.write(buf);
          }
          break;
        }

        case 'stream.close': {
          const conn = this.connections.get(msg.connectionId);
          if (conn) {
            conn.socket.end();
            this.connections.delete(msg.connectionId);
          }
          break;
        }

        case 'stream.error': {
          const conn = this.connections.get(msg.connectionId);
          this.log('warn', `[${msg.connectionId}] Stream error: ${msg.error}`);
          if (conn) {
            conn.socket.destroy();
            this.connections.delete(msg.connectionId);
          }
          break;
        }

        case 'session.ready':
          // Already handled in connectWebSocket
          break;

        case 'session.error':
          this.log('error', `Session error: ${msg.error}`);
          break;

        case 'ping':
          this.sendMessage({ type: 'pong' });
          break;

        default:
          break;
      }
    } catch (err) {
      // Binary frame — could be raw tunnel data
      if (Buffer.isBuffer(data) && data.length >= 8) {
        this.handleBinaryFrame(data as Buffer);
      }
    }
  }

  private handleBinaryFrame(data: Buffer): void {
    const connId = data.readUInt32BE(0);
    const length = data.readUInt32BE(4);
    const payload = data.subarray(8, 8 + length);

    const conn = this.connections.get(connId);
    if (conn && !conn.socket.destroyed) {
      conn.bytesIn += payload.length;
      conn.socket.write(payload);
    }
  }

  // ── Helpers ──

  private sendMessage(msg: Record<string, unknown>): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  private log(level: string, message: string): void {
    const prefix = {
      info: '\x1b[90m  ℹ\x1b[0m',
      success: '\x1b[32m  ✓\x1b[0m',
      warn: '\x1b[33m  ⚠\x1b[0m',
      error: '\x1b[31m  ✗\x1b[0m',
    }[level] || '  ';

    console.log(`${prefix} ${message}`);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
