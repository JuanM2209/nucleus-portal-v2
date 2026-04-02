import { Injectable, Inject, forwardRef, Logger } from '@nestjs/common';
import * as net from 'net';
import { EventEmitter } from 'events';

// ── Binary Frame Helpers ──

function buildFrame(streamId: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(streamId, 0);
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

function buildControlFrame(cmd: { cmd: string; streamId: number }): Buffer {
  const payload = Buffer.from(JSON.stringify(cmd));
  return buildFrame(0, payload);
}

// ── Types ──

interface StreamEntry {
  socket: net.Socket;
  sessionId: string;
  lastActivity: number;
}

/** Queued request waiting for its turn through a Go agent TCP stream */
interface QueuedRequest {
  streamId: number;
  socket: net.Socket;
  data: Buffer[];
  headersSent: boolean;
  lastActivity: number;
}

interface BridgeEntry {
  server: net.Server;
  port: number;
  deviceId: string;
  sessionId: string;
  agentSocket: any; // WebSocket instance
  streams: Map<number, StreamEntry>;
  useJsonProxy: boolean;
  targetIp?: string;
  targetPort?: number;
  /** For Rust agents: the stream ID shared with the agent from start_session */
  agentStreamId?: number;
  /** FIFO queue — serializes requests since Go agent has no correlation IDs */
  requestQueue: QueuedRequest[];
  /** Currently active request */
  activeRequest: QueuedRequest | null;
  /** If true, skip FIFO timeouts (for persistent connections like /cockpit/socket) */
  persistent?: boolean;
}

// ── Service ──

@Injectable()
export class StreamBridgeService {
  private readonly logger = new Logger(StreamBridgeService.name);
  private readonly events = new EventEmitter();

  /** sessionId → BridgeEntry (each bridge has its own TCP server + agent session) */
  private readonly bridges = new Map<string, BridgeEntry>();

  /** streamId → sessionId (global reverse lookup for fast routing) */
  private readonly streamToSession = new Map<number, string>();

  /** Global stream ID counter (unique across all sessions) */
  private globalStreamCounter = 1;

  /** primarySessionId → dedicated /comms bridge port */
  private readonly commsBridgePorts = new Map<string, number>();

  /** primarySessionId → comms bridge sessionId (for cleanup) */
  private readonly commsBridgeSessionIds = new Map<string, string>();

  /** deviceId → pending session IDs queue (FIFO for pool workers) */
  private readonly pendingSessions = new Map<string, string[]>();

  /** ourSessionId → agentSessionId (agent uses its own UUIDs internally) */
  private readonly agentSessionMap = new Map<string, string>();

  /**
   * Sticky routing: the bridge currently receiving data from the Go agent.
   * Since tcp_stream_data/closed messages lack session_id, we track which bridge
   * was last confirmed via tcp_stream_opened (which DOES include session_id).
   * All subsequent data/closed messages route to this bridge until tcp_stream_closed.
   */
  private currentDataReceiver: string | null = null;

  /**
   * Bridge pool: primarySessionId → [bridgeSessionId1, bridgeSessionId2, ...]
   * Enables round-robin load balancing across multiple bridges.
   */
  private readonly bridgePools = new Map<string, string[]>();

  /** Round-robin counter per pool */
  private readonly poolRoundRobin = new Map<string, number>();

  // ── Lifecycle ──

  async createBridge(
    sessionId: string,
    deviceId: string,
    agentSocket: any,
    useJsonProxy = false,
    targetIp?: string,
    targetPort?: number,
    /** For Rust agents: the stream ID sent in start_session, shared with the agent */
    agentStreamId?: number,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const bridge: BridgeEntry = {
        server: net.createServer(),
        port: 0,
        deviceId,
        sessionId,
        agentSocket,
        streams: new Map(),
        useJsonProxy,
        targetIp,
        targetPort,
        agentStreamId,
        requestQueue: [],
        activeRequest: null,
      };

      bridge.server.on('connection', (socket: net.Socket) => {
        this.handleNewConnection(sessionId, bridge, socket);
      });

      bridge.server.on('error', (err: Error) => {
        this.logger.error(`Bridge server error for session ${sessionId}: ${err.message}`);
      });

      bridge.server.listen(0, '127.0.0.1', () => {
        const addr = bridge.server.address() as net.AddressInfo;
        bridge.port = addr.port;
        this.bridges.set(sessionId, bridge);
        this.logger.log(
          `Bridge created: session=${sessionId} on 127.0.0.1:${bridge.port} → device ${deviceId}`,
        );
        resolve(bridge.port);
      });

      setTimeout(() => reject(new Error('Bridge server start timeout')), 5000);
    });
  }

  /**
   * Register a pool of bridge session IDs under a primary session.
   * getBridgePort() will round-robin across them.
   */
  registerBridgePool(primarySessionId: string, bridgeSessionIds: string[]): void {
    this.bridgePools.set(primarySessionId, bridgeSessionIds);
    this.poolRoundRobin.set(primarySessionId, 0);
    this.logger.log(
      `Bridge pool registered: primary=${primarySessionId}, members=[${bridgeSessionIds.join(', ')}]`,
    );
  }

  /** Get all bridge session IDs in a pool (for cleanup) */
  getPoolSessionIds(primarySessionId: string): string[] {
    return this.bridgePools.get(primarySessionId) || [primarySessionId];
  }

  /**
   * Get a bridge port for a session. If the session has a pool,
   * round-robin across pool members for load balancing.
   */
  getBridgePort(sessionId: string): number | null {
    // Check if this session has a bridge pool
    const pool = this.bridgePools.get(sessionId);
    if (pool && pool.length > 0) {
      const idx = (this.poolRoundRobin.get(sessionId) || 0) % pool.length;
      this.poolRoundRobin.set(sessionId, idx + 1);

      // Find an available bridge (prefer one with no active request)
      let bestId = pool[idx];
      let bestLoad = Infinity;

      for (let i = 0; i < pool.length; i++) {
        const candidateIdx = (idx + i) % pool.length;
        const candidateId = pool[candidateIdx];
        const bridge = this.bridges.get(candidateId);
        if (!bridge) continue;
        const load = bridge.requestQueue.length + (bridge.activeRequest ? 1 : 0);
        if (load === 0) {
          bestId = candidateId;
          break; // Idle bridge — use immediately
        }
        if (load < bestLoad) {
          bestLoad = load;
          bestId = candidateId;
        }
      }

      return this.bridges.get(bestId)?.port ?? null;
    }

    // Single bridge
    return this.bridges.get(sessionId)?.port ?? null;
  }

  /**
   * Create a dedicated bridge for /comms WebSocket relay.
   * Unlike the FIFO bridge, this bridge allows a SINGLE persistent TCP connection
   * (the /comms WebSocket) that stays open for the session lifetime.
   * This runs on a separate agent session so it doesn't block HTTP FIFO.
   */
  async createCommsBridge(
    primarySessionId: string,
    commsSessionId: string,
    deviceId: string,
    agentSocket: any,
    targetIp?: string,
    targetPort?: number,
  ): Promise<number> {
    // Create a bridge marked as persistent (no FIFO timeouts).
    // The comms bridge carries the /cockpit/socket WebSocket which must
    // stay alive indefinitely — the 60s absolute timeout would kill it.
    const port = await this.createBridge(
      commsSessionId, deviceId, agentSocket, true, targetIp, targetPort,
    );
    // Mark as persistent after creation
    const bridge = this.bridges.get(commsSessionId);
    if (bridge) bridge.persistent = true;
    this.commsBridgePorts.set(primarySessionId, port);
    this.commsBridgeSessionIds.set(primarySessionId, commsSessionId);
    this.logger.log(
      `Comms bridge created: primary=${primarySessionId}, comms=${commsSessionId}, port=${port}`,
    );
    return port;
  }

  /** Get the dedicated /comms bridge port for a session */
  getCommsBridgePort(primarySessionId: string): number | null {
    return this.commsBridgePorts.get(primarySessionId) ?? null;
  }

  /** Get the agent WebSocket for a bridge (for spawning on-demand bridges) */
  getAgentSocket(primarySessionId: string): any | null {
    // Try pool members first, then direct lookup
    const poolMembers = this.bridgePools.get(primarySessionId);
    if (poolMembers) {
      for (const memberId of poolMembers) {
        const bridge = this.bridges.get(memberId);
        if (bridge?.agentSocket) return bridge.agentSocket;
      }
    }
    const bridge = this.bridges.get(primarySessionId);
    return bridge?.agentSocket ?? null;
  }

  /**
   * Create an on-demand persistent bridge for a WebSocket connection.
   * Each browser tab that opens /cockpit/socket gets its own dedicated bridge
   * so it doesn't occupy a pool bridge slot. The bridge is destroyed when
   * the WebSocket closes.
   */
  async createOnDemandWsBridge(
    primarySessionId: string,
    deviceId: string,
    agentSocket: any,
    targetIp?: string,
    targetPort?: number,
  ): Promise<number> {
    const wsSessionId = `${primarySessionId}-ws-${Date.now().toString(36)}`;
    const port = await this.createBridge(
      wsSessionId, deviceId, agentSocket, true, targetIp, targetPort,
    );
    const bridge = this.bridges.get(wsSessionId);
    if (bridge) bridge.persistent = true;
    this.logger.log(`On-demand WS bridge created: ${wsSessionId} port=${port}`);
    return port;
  }

  destroyBridge(sessionId: string): void {
    // Destroy /comms bridge first
    const commsSessionId = this.commsBridgeSessionIds.get(sessionId);
    if (commsSessionId) {
      this.destroySingleBridge(commsSessionId);
      this.commsBridgePorts.delete(sessionId);
      this.commsBridgeSessionIds.delete(sessionId);
      this.logger.log(`Comms bridge destroyed for primary=${sessionId}`);
    }

    // Destroy pool bridges
    const pool = this.bridgePools.get(sessionId);
    if (pool) {
      for (const poolSessionId of pool) {
        if (poolSessionId !== sessionId) {
          this.destroySingleBridge(poolSessionId);
        }
      }
      this.bridgePools.delete(sessionId);
      this.poolRoundRobin.delete(sessionId);
    }

    // Destroy the primary bridge
    this.destroySingleBridge(sessionId);
  }

  private destroySingleBridge(sessionId: string): void {
    const bridge = this.bridges.get(sessionId);
    if (!bridge) return;

    for (const [streamId, entry] of bridge.streams) {
      entry.socket.destroy();
      this.streamToSession.delete(streamId);
    }
    bridge.streams.clear();
    bridge.requestQueue = [];
    bridge.activeRequest = null;

    bridge.server.close();
    this.bridges.delete(sessionId);
    this.agentSessionMap.delete(sessionId);

    this.logger.log(`Bridge destroyed: session=${sessionId}`);
  }

  destroyAllBridgesForDevice(deviceId: string): void {
    // Collect IDs first to avoid modifying Map during iteration
    const sessionIds = [...this.bridges.entries()]
      .filter(([, bridge]) => bridge.deviceId === deviceId)
      .map(([sessionId]) => sessionId);

    for (const sessionId of sessionIds) {
      this.destroyBridge(sessionId);
    }
  }

  /** Mark a bridge as persistent (no FIFO timeout). Used for tunnel CLI raw TCP bridges. */
  markPersistent(sessionId: string): void {
    const bridge = this.bridges.get(sessionId);
    if (bridge) {
      bridge.persistent = true;
      this.logger.log(`Bridge ${sessionId} marked as persistent`);
    }
  }

  /**
   * Update the agentSocket reference on ALL bridges for a device.
   * Called when an agent reconnects with a new WebSocket — existing bridges
   * would otherwise hold stale socket references that silently fail to send.
   */
  updateAgentSocket(deviceId: string, newSocket: any): number {
    let updated = 0;
    for (const [, bridge] of this.bridges) {
      if (bridge.deviceId === deviceId && bridge.agentSocket !== newSocket) {
        bridge.agentSocket = newSocket;
        updated++;
      }
    }
    if (updated > 0) {
      this.logger.log(`Updated agentSocket on ${updated} bridge(s) for device ${deviceId}`);
    }
    return updated;
  }

  // ── Incoming from Agent (binary frames — Rust agent) ──

  routeAgentData(deviceId: string, streamId: number, payload: Buffer): void {
    const sessionId = this.streamToSession.get(streamId);
    if (!sessionId) {
      this.logger.warn(`routeAgentData: no session for streamId=${streamId}, known streams: [${[...this.streamToSession.keys()].join(',')}]`);
      return;
    }

    const bridge = this.bridges.get(sessionId);
    if (!bridge) {
      this.logger.warn(`routeAgentData: no bridge for session=${sessionId}`);
      return;
    }

    const entry = bridge.streams.get(streamId);
    if (!entry) {
      this.logger.warn(`routeAgentData: no stream entry for streamId=${streamId} in bridge ${sessionId}, known: [${[...bridge.streams.keys()].join(',')}]`);
      return;
    }

    entry.lastActivity = Date.now();
    entry.socket.write(payload);
    this.logger.debug(`routeAgentData: wrote ${payload.length} bytes to stream ${streamId}`);
  }

  handleStreamControl(
    deviceId: string,
    cmd: { cmd: string; streamId: number },
  ): void {
    const sessionId = this.streamToSession.get(cmd.streamId);
    if (!sessionId) return;

    const bridge = this.bridges.get(sessionId);
    if (!bridge) return;

    const entry = bridge.streams.get(cmd.streamId);

    switch (cmd.cmd) {
      case 'FIN':
        if (entry) {
          entry.socket.end();
          bridge.streams.delete(cmd.streamId);
          this.streamToSession.delete(cmd.streamId);
        }
        break;
      case 'RST':
        if (entry) {
          entry.socket.destroy();
          bridge.streams.delete(cmd.streamId);
          this.streamToSession.delete(cmd.streamId);
        }
        break;
      case 'SYN':
        break;
    }
  }

  // ── Session Ready Event ──

  registerPendingSession(deviceId: string, sessionId: string): void {
    const queue = this.pendingSessions.get(deviceId) || [];
    queue.push(sessionId);
    this.pendingSessions.set(deviceId, queue);
  }

  resolvePendingSession(deviceId: string): string | undefined {
    const queue = this.pendingSessions.get(deviceId);
    if (!queue || queue.length === 0) return undefined;
    const sessionId = queue.shift()!;
    if (queue.length === 0) this.pendingSessions.delete(deviceId);
    return sessionId;
  }

  notifySessionReady(sessionId: string): void {
    this.events.emit(`session.ready:${sessionId}`);
  }

  waitForSessionReady(sessionId: string, timeoutMs = 10000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.events.removeAllListeners(`session.ready:${sessionId}`);
        reject(new Error('Session ready timeout'));
      }, timeoutMs);

      this.events.once(`session.ready:${sessionId}`, () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  notifySessionError(sessionId: string, error: string): void {
    this.events.emit(`session.error:${sessionId}`, error);
  }

  /** Store mapping from our session ID to the Go agent's internal session ID */
  mapAgentSession(ourSessionId: string, agentSessionId: string): void {
    this.agentSessionMap.set(ourSessionId, agentSessionId);
    this.logger.log(`Session ID mapped: ours=${ourSessionId} → agent=${agentSessionId}`);
  }

  /** Get the agent's internal session ID for sending stop_session */
  getAgentSessionId(ourSessionId: string): string | undefined {
    return this.agentSessionMap.get(ourSessionId);
  }

  /** Get all agent session IDs for a pool (for stop_session cleanup) */
  getAgentSessionIds(primarySessionId: string): string[] {
    const poolIds = this.getPoolSessionIds(primarySessionId);
    return poolIds.map(id => this.agentSessionMap.get(id) || id);
  }

  // ── Go Agent JSON-based proxy messages ──

  /**
   * Handle proxy messages from Go agent (JSON-based).
   * Each bridge has its own session, so responses route to the correct bridge
   * via session ID match. Falls back to any bridge with an active request.
   */
  handleGoProxyMessage(sessionId: string, msgType: string, msg: any): void {
    // Route to the correct bridge using sticky routing:
    // 1. If sessionId provided (tcp_stream_opened), look up directly
    // 2. If no sessionId (tcp_stream_data/closed), use currentDataReceiver
    // 3. Last resort: any bridge with an active request

    let bridge: BridgeEntry | undefined;

    // Direct lookup by session ID (works for tcp_stream_opened)
    if (sessionId) {
      bridge = this.bridges.get(sessionId);
      if (!bridge) {
        for (const [, b] of this.bridges) {
          if (b.useJsonProxy && b.sessionId === sessionId) {
            bridge = b;
            break;
          }
        }
      }
    }

    // Sticky routing: use the bridge that last received tcp_stream_opened
    if (!bridge && this.currentDataReceiver) {
      bridge = this.bridges.get(this.currentDataReceiver);
    }

    // Last resort: any Go bridge with an active request
    if (!bridge) {
      for (const [, b] of this.bridges) {
        if (b.useJsonProxy && b.activeRequest) {
          bridge = b;
          break;
        }
      }
    }

    if (!bridge) return;

    const active = bridge.activeRequest;

    switch (msgType) {
      case 'tcp_stream_open':
      case 'tcp_stream_opened': {
        const p = msg.payload || {};
        const err = p.error;
        if (err) {
          this.logger.warn(`Go proxy tcp_stream_opened error (session ${bridge.sessionId}): ${err}`);
          if (active) {
            active.socket.end();
            this.cleanupActiveRequest(bridge);
          }
        } else {
          // Set this bridge as the sticky data receiver
          this.currentDataReceiver = bridge.sessionId;
          this.logger.debug(`Go proxy tcp_stream_opened → sticky receiver set to ${bridge.sessionId}`);

          // Now send the buffered HTTP request data
          if (active && active.data.length > 0) {
            const combined = Buffer.concat(active.data);
            active.data = [];
            active.headersSent = true;
            this.sendJsonToAgent(bridge, {
              type: 'tcp_stream_data',
              payload: {
                session_id: bridge.sessionId,
                stream_id: active.streamId,
                data: combined.toString('base64'),
              },
            });
          }
        }
        break;
      }

      case 'tcp_stream_data': {
        const p = msg.payload || msg;
        const payload = p.data || p.payload || msg.data;
        if (payload && active) {
          const buf = Buffer.from(payload, 'base64');
          active.socket.write(buf);
          active.lastActivity = Date.now();
        }
        break;
      }

      case 'tcp_stream_close':
      case 'tcp_stream_closed': {
        // Clear sticky receiver so next tcp_stream_opened can set a new one
        if (this.currentDataReceiver === bridge.sessionId) {
          this.currentDataReceiver = null;
        }
        if (active) {
          // For persistent bridges (tunnel CLI), don't close the client socket.
          // Modbus TCP polls continuously — closing the socket disconnects Modbus Poll.
          // The next request will trigger a new tcp_stream_open cycle.
          if (!bridge.persistent) {
            active.socket.end();
          }
          this.cleanupActiveRequest(bridge);
        }
        break;
      }

      case 'http_proxy_resp': {
        const p = msg.payload || msg;
        const data = p.body || p.data || msg.body || msg.data;
        if (data && active) {
          const buf = typeof data === 'string'
            ? Buffer.from(data, 'base64')
            : Buffer.from(JSON.stringify(data));
          active.socket.write(buf);
        }
        break;
      }

      case 'ws_proxy_opened':
      case 'ws_proxy_frame': {
        const p = msg.payload || msg;
        const payload = p.data || p.payload || msg.data;
        if (payload && active) {
          active.socket.write(Buffer.from(payload, 'base64'));
        }
        break;
      }

      case 'ws_proxy_closed':
        break;
    }
  }

  /**
   * Clean up active request and process next in queue.
   */
  private cleanupActiveRequest(bridge: BridgeEntry): void {
    if (bridge.activeRequest) {
      const streamId = bridge.activeRequest.streamId;
      bridge.streams.delete(streamId);
      this.streamToSession.delete(streamId);
      bridge.activeRequest = null;
    }
    // Process next queued request
    this.processNextRequest(bridge);
  }

  /**
   * Process the next request in the FIFO queue.
   */
  private processNextRequest(bridge: BridgeEntry): void {
    if (bridge.requestQueue.length === 0) return;

    // For persistent bridges (comms bridge), a new connection replaces the old one.
    // This happens on page reload — the old WebSocket is dead, the new one takes over.
    if (bridge.activeRequest && bridge.persistent) {
      this.logger.log(`Persistent bridge replacing old stream ${bridge.activeRequest.streamId} with new connection on session ${bridge.sessionId}`);
      try {
        this.sendJsonToAgent(bridge, {
          type: 'tcp_stream_close',
          payload: { session_id: bridge.sessionId, stream_id: bridge.activeRequest.streamId },
        });
        if (!bridge.activeRequest.socket.destroyed) bridge.activeRequest.socket.end();
      } catch (e) { /* cleanup error */ }
      bridge.streams.delete(bridge.activeRequest.streamId);
      this.streamToSession.delete(bridge.activeRequest.streamId);
      bridge.activeRequest = null;
    }

    if (bridge.activeRequest) return; // non-persistent: wait for current to finish

    const next = bridge.requestQueue.shift()!;
    bridge.activeRequest = next;

    // Check if socket is still alive
    if (next.socket.destroyed) {
      bridge.streams.delete(next.streamId);
      this.streamToSession.delete(next.streamId);
      bridge.activeRequest = null;
      this.processNextRequest(bridge);
      return;
    }

    // Send tcp_stream_open to agent
    this.sendJsonToAgent(bridge, {
      type: 'tcp_stream_open',
      payload: {
        session_id: bridge.sessionId,
        stream_id: next.streamId,
        port: bridge.targetPort || 0,
        target_ip: bridge.targetIp,
        target_port: bridge.targetPort,
      },
    });

    // Skip timeouts for persistent bridges (comms bridge for /cockpit/socket).
    // These carry long-lived WebSocket connections that must stay alive indefinitely.
    if (bridge.persistent) {
      this.logger.log(`Persistent bridge — no timeout for stream ${next.streamId} on session ${bridge.sessionId}`);
      return; // No timeout checking for persistent connections
    }

    // Inactivity timeout — if no data received, skip this request and process next.
    // Uses lastActivity (updated on each tcp_stream_data) so large file transfers
    // won't time out as long as data keeps flowing.
    // WebSocket connections get unlimited timeout (they're long-lived).
    // Detection: the tunnel-proxy tags the socket with __isWebSocket before connecting.
    const isWebSocket = (next.socket as any).__isWebSocket === true;
    if (isWebSocket) {
      this.logger.log(`WebSocket stream ${next.streamId} — no timeout (session ${bridge.sessionId})`);
      return; // No timeout for WebSocket connections
    }
    const INACTIVITY_TIMEOUT = 45_000;
    const ABSOLUTE_TIMEOUT = 90_000;
    const CHECK_INTERVAL = 3_000;
    const startTime = Date.now();
    const checkInactivity = () => {
      if (bridge.activeRequest !== next) return; // already completed
      const idle = Date.now() - next.lastActivity;
      const elapsed = Date.now() - startTime;

      if (idle >= INACTIVITY_TIMEOUT || elapsed >= ABSOLUTE_TIMEOUT) {
        const reason = elapsed >= ABSOLUTE_TIMEOUT ? `absolute timeout ${Math.round(elapsed/1000)}s` : `idle ${Math.round(idle/1000)}s`;
        this.logger.warn(`Go proxy stream ${next.streamId} timed out (${reason}) on session ${bridge.sessionId}`);
        try {
          // Send tcp_stream_close to agent to reset its state
          this.sendJsonToAgent(bridge, {
            type: 'tcp_stream_close',
            payload: { session_id: bridge.sessionId, stream_id: next.streamId },
          });
          if (!next.socket.destroyed) next.socket.end();
        } catch (e) {
          this.logger.warn(`Timeout cleanup error: ${e}`);
        }
        this.cleanupActiveRequest(bridge);
      } else {
        setTimeout(checkInactivity, CHECK_INTERVAL);
      }
    };
    setTimeout(checkInactivity, CHECK_INTERVAL);
  }

  // ── Internal: TCP Connection Handling ──

  private handleNewConnection(
    sessionId: string,
    bridge: BridgeEntry,
    socket: net.Socket,
  ): void {
    const streamId = this.globalStreamCounter++;
    if (this.globalStreamCounter >= 0xFFFFFFFF) {
      this.globalStreamCounter = 1;
    }

    const entry: StreamEntry = {
      socket,
      sessionId,
      lastActivity: Date.now(),
    };

    bridge.streams.set(streamId, entry);
    this.streamToSession.set(streamId, sessionId);

    if (bridge.useJsonProxy) {
      this.handleGoAgentStream(sessionId, bridge, socket, streamId);
    } else {
      this.handleBinaryAgentStream(sessionId, bridge, socket, streamId, entry);
    }
  }

  // WebSocket connections are handled via dedicated on-demand comms bridges.
  // Each browser tab that opens /cockpit/socket gets its own comms bridge,
  // keeping the pool bridges free for HTTP requests.

  /**
   * Go agent: buffer the HTTP request data, then process via FIFO queue.
   */
  private handleGoAgentStream(
    sessionId: string,
    bridge: BridgeEntry,
    socket: net.Socket,
    streamId: number,
  ): void {
    const queued: QueuedRequest = {
      streamId,
      socket,
      data: [],
      headersSent: false,
      lastActivity: Date.now(),
    };

    // Buffer incoming data
    socket.on('data', (data: Buffer) => {
      queued.data.push(data);
      queued.lastActivity = Date.now();

      // For persistent bridges: if no active request, start a new tcp_stream cycle.
      // This happens after tcp_stream_closed cleaned up the previous active request.
      // Set activeRequest FIRST to prevent duplicate tcp_stream_open from rapid data events.
      if (bridge.persistent && !bridge.activeRequest) {
        bridge.activeRequest = queued;
        queued.headersSent = false;
        this.sendJsonToAgent(bridge, {
          type: 'tcp_stream_open',
          payload: {
            session_id: bridge.sessionId,
            stream_id: streamId,
            target_ip: bridge.targetIp || '127.0.0.1',
            target_port: bridge.targetPort || 0,
          },
        });
        // Don't return — data is buffered and will be sent when tcp_stream_opened arrives
      }

      // If activeRequest is set but stream not yet open, buffer data (wait for tcp_stream_opened)
      if (bridge.activeRequest === queued && !queued.headersSent) {
        return;
      }

      // If this request is already active and stream is open, send data immediately
      if (bridge.activeRequest === queued && queued.headersSent) {
        const combined = Buffer.concat(queued.data);
        queued.data = [];
        this.sendJsonToAgent(bridge, {
          type: 'tcp_stream_data',
          payload: {
            session_id: bridge.sessionId,
            stream_id: streamId,
            data: combined.toString('base64'),
          },
        });
      }
    });

    socket.on('close', () => {
      // Remove from queue if still waiting
      const idx = bridge.requestQueue.indexOf(queued);
      if (idx >= 0) {
        bridge.requestQueue.splice(idx, 1);
        bridge.streams.delete(streamId);
        this.streamToSession.delete(streamId);
      }
      // If this was the active request, clean up and process next
      if (bridge.activeRequest === queued) {
        this.cleanupActiveRequest(bridge);
      }
    });

    socket.on('error', (err: Error) => {
      this.logger.debug(`Go proxy stream ${streamId} error: ${err.message}`);
      const idx = bridge.requestQueue.indexOf(queued);
      if (idx >= 0) bridge.requestQueue.splice(idx, 1);
      if (bridge.activeRequest === queued) {
        this.cleanupActiveRequest(bridge);
      }
      bridge.streams.delete(streamId);
      this.streamToSession.delete(streamId);
    });

    // Add to queue and start processing
    bridge.requestQueue.push(queued);
    this.processNextRequest(bridge);
  }

  /**
   * Rust agent binary frame proxy.
   */
  private handleBinaryAgentStream(
    sessionId: string,
    bridge: BridgeEntry,
    socket: net.Socket,
    streamId: number,
    entry: StreamEntry,
  ): void {
    // For Rust agents, use the stream ID shared with the agent from start_session.
    // The agent's tunnel maps stream_id → TCP connection, so we MUST use the same ID.
    // For subsequent connections (bridge pool), fall back to local streamId.
    const effectiveStreamId = bridge.agentStreamId || streamId;

    // Re-register mapping with the effective stream ID
    if (effectiveStreamId !== streamId) {
      bridge.streams.delete(streamId);
      this.streamToSession.delete(streamId);
      bridge.streams.set(effectiveStreamId, entry);
      this.streamToSession.set(effectiveStreamId, sessionId);
      this.logger.log(`Binary stream: remapped local ${streamId} → agent ${effectiveStreamId}`);
    }

    // No SYN needed — the Rust agent already has the TCP connection open from start_session.
    // Just forward data bidirectionally using the shared stream ID.

    socket.on('data', (data: Buffer) => {
      entry.lastActivity = Date.now();
      this.logger.debug(`Binary stream ${effectiveStreamId}: sending ${data.length} bytes to agent`);
      this.sendToAgent(bridge, buildFrame(effectiveStreamId, data));
    });

    socket.on('close', () => {
      // For persistent bridges (tunnel CLI), don't send FIN to agent —
      // it would close the agent's TCP connection to the target (SSH, etc.)
      // and prevent new connections from working. Just clean up locally.
      if (!bridge.persistent) {
        this.sendToAgent(bridge, buildControlFrame({ cmd: 'FIN', streamId: effectiveStreamId }));
      }
      bridge.streams.delete(effectiveStreamId);
      this.streamToSession.delete(effectiveStreamId);
    });

    socket.on('error', (err: Error) => {
      if (!bridge.persistent) {
        this.sendToAgent(bridge, buildControlFrame({ cmd: 'RST', streamId: effectiveStreamId }));
      }
      bridge.streams.delete(effectiveStreamId);
      this.streamToSession.delete(effectiveStreamId);
    });
  }

  private sendToAgent(bridge: BridgeEntry, data: Buffer): void {
    try {
      if (bridge.agentSocket?.readyState === 1) {
        bridge.agentSocket.send(data);
      } else {
        this.logger.warn(
          `Cannot send to agent for session ${bridge.sessionId}: socket readyState=${bridge.agentSocket?.readyState ?? 'null'}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to send to agent: ${err}`);
    }
  }

  private sendJsonToAgent(bridge: BridgeEntry, msg: Record<string, unknown>): void {
    try {
      if (bridge.agentSocket?.readyState === 1) {
        bridge.agentSocket.send(JSON.stringify(msg));
      } else {
        this.logger.warn(
          `Cannot send JSON to agent for session ${bridge.sessionId}: socket readyState=${bridge.agentSocket?.readyState ?? 'null'}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to send JSON to agent: ${err}`);
    }
  }
}
