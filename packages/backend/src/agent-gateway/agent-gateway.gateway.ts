import {
  WebSocketGateway,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Inject, Logger, forwardRef } from '@nestjs/common';
import { Server } from 'ws';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { AgentRegistryService } from './agent-registry.service';
import { DevicesService } from '../devices/devices.service';
import { StreamBridgeService } from '../tunnels/stream-bridge.service';
import { CommsRelayService } from '../tunnels/comms-relay.service';
import { randomBytes } from 'crypto';
import { DATABASE } from '../database/database.module';
import {
  devices,
  deviceAdapters,
  discoveredEndpoints,
  endpointServices,
  accessSessions,
  exposures,
  agentHeartbeats,
  pendingDevices,
  tenants,
  portAllocations,
} from '../database/schema';
import type {
  AgentToServerMessage,
  HeartbeatMessage,
  DiscoveryResultMessage,
} from '@nucleus/shared';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@WebSocketGateway({ path: '/ws/agent' })
export class AgentGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(AgentGateway.name);
  private readonly keepAliveIntervals = new Map<any, NodeJS.Timeout>();
  /** Tracks when each device last had subnet scans triggered (epoch ms) */
  private readonly lastSubnetScanTime = new Map<string, number>();

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly registry: AgentRegistryService,
    private readonly devicesService: DevicesService,
    private readonly streamBridge: StreamBridgeService,
    private readonly commsRelay: CommsRelayService,
    @Inject(DATABASE) private readonly db: any,
  ) {}

  async handleConnection(client: any, ...args: any[]) {
    try {
      // NestJS WS adapter: upgradeReq may be on client or passed as first arg
      const req = client.upgradeReq || client._req || args?.[0];
      const rawUrl = req?.url || client.url || '';
      this.logger.log(`Agent WS connection — raw URL: "${rawUrl}", args count: ${args?.length}`);

      const url = new URL(rawUrl || '/', 'http://localhost');
      const token = url.searchParams.get('token');
      this.logger.log(`Agent WS connection — parsed token: "${token}"`);

      // ── Method 1: Token in URL query param (?token=<device-uuid-or-serial>) ──
      if (token) {
        let device: any = null;

        if (UUID_REGEX.test(token)) {
          // UUID token — lookup by device ID
          [device] = await this.db
            .select()
            .from(devices)
            .where(eq(devices.id, token))
            .limit(1);
        } else {
          // Non-UUID token — lookup by serialNumber (e.g. "N-1065")
          [device] = await this.db
            .select()
            .from(devices)
            .where(eq(devices.serialNumber, token))
            .limit(1);
          if (device) {
            this.logger.log(`Agent auth via serial number: ${token} → ${device.id}`);
          }
        }

        if (!device) {
          // Device not found — check approval policy and possibly auto-register
          const handled = await this.handleUnknownDevice(client, token);
          if (!handled) {
            this.logger.warn(`Agent connection rejected: device not found for token "${token}"`);
            client.close(4003, 'Device not found — pending approval or denied');
          }
          return;
        }

        await this.activateAgent(client, device);
        return;
      }

      // ── Method 2: Legacy agente-rs — no token in URL ──
      // Wait for first message which should contain auth credentials
      this.logger.log('Agent connected without token — waiting for auth message...');
      this.setupPendingAuth(client);
    } catch (error) {
      this.logger.error(`Error during agent connection: ${error}`);
      client.close(4500, 'Internal server error');
    }
  }

  /**
   * Handle an agent connection with a token that doesn't match any existing device.
   * Checks tenant approval policy and either auto-registers or queues for approval.
   * Returns true if the device was auto-approved and activated.
   */
  private async handleUnknownDevice(client: any, token: string): Promise<boolean> {
    // Extract remote IP from the connection
    const req = client.upgradeReq || client._req;
    const remoteIp = req?.headers?.['x-forwarded-for']?.split(',')[0]?.trim()
      || req?.socket?.remoteAddress
      || null;

    // Get the default tenant (single-tenant deployment for now)
    const [tenant] = await this.db
      .select()
      .from(tenants)
      .where(eq(tenants.isActive, true))
      .limit(1);

    if (!tenant) {
      this.logger.warn('No active tenant found for auto-registration');
      return false;
    }

    const tenantSettings = (tenant.settings ?? {}) as Record<string, any>;
    const policy = tenantSettings.deviceApprovalPolicy ?? 'manual';

    if (policy === 'deny_all') {
      this.logger.warn(`Device "${token}" rejected: tenant policy is deny_all`);
      client.close(4003, 'Device registration denied by policy');
      return true; // handled — don't send generic close
    }

    if (policy === 'auto_approve') {
      // Auto-register the device immediately
      const device = await this.autoRegisterDevice(tenant.id, token, remoteIp);
      if (device) {
        this.logger.log(`Device "${token}" auto-approved and registered as ${device.id}`);
        await this.activateAgent(client, device);
        return true;
      }
      return false;
    }

    // policy === 'manual' (default) — queue for approval
    await this.queuePendingDevice(tenant.id, token, remoteIp);
    this.logger.log(`Device "${token}" queued for manual approval (tenant: ${tenant.name})`);
    client.close(4004, 'Device pending approval');
    return true;
  }

  /**
   * Auto-register a new device in the devices table.
   */
  private async autoRegisterDevice(tenantId: string, serialNumber: string, ipAddress: string | null) {
    try {
      const [device] = await this.db
        .insert(devices)
        .values({
          tenantId,
          serialNumber,
          name: `Nucleus ${serialNumber}`,
          status: 'offline',
          metadata: {},
          tags: [],
        })
        .onConflictDoNothing()
        .returning();

      if (!device) {
        // Conflict — device already exists (race condition), try to fetch it
        const [existing] = await this.db
          .select()
          .from(devices)
          .where(eq(devices.serialNumber, serialNumber))
          .limit(1);
        return existing ?? null;
      }

      // Also mark in pending_devices as approved (for audit trail)
      await this.db
        .insert(pendingDevices)
        .values({
          tenantId,
          serialNumber,
          ipAddress,
          status: 'approved',
          reviewedAt: new Date(),
        })
        .onConflictDoNothing()
        .catch(() => {}); // best-effort

      return device;
    } catch (err: any) {
      this.logger.error(`Auto-register device "${serialNumber}" failed: ${err.message}`);
      return null;
    }
  }

  /**
   * Queue an unknown device for manual approval.
   */
  private async queuePendingDevice(tenantId: string, serialNumber: string, ipAddress: string | null) {
    try {
      await this.db
        .insert(pendingDevices)
        .values({
          tenantId,
          serialNumber,
          ipAddress,
          status: 'pending',
        })
        .onConflictDoNothing(); // Don't duplicate if already pending
    } catch (err: any) {
      this.logger.error(`Queue pending device "${serialNumber}" failed: ${err.message}`);
    }
  }

  /**
   * Activate a fully authenticated agent connection.
   */
  private async activateAgent(client: any, device: any) {
    const deviceId = device.id;

    // If a previous socket exists, clean up its keepalive and update bridge refs
    const oldSocket = this.registry.getSocket(deviceId);
    if (oldSocket && oldSocket !== client) {
      this.logger.log(`Replacing existing connection for ${deviceId}`);
      const oldInterval = this.keepAliveIntervals.get(oldSocket);
      if (oldInterval) {
        clearInterval(oldInterval);
        this.keepAliveIntervals.delete(oldSocket);
      }
      // Update socket references on existing bridges to use the new connection.
      // This is critical: without this update, bridges hold stale socket references
      // and all subsequent sendJsonToAgent() calls silently fail.
      const updated = this.streamBridge.updateAgentSocket(deviceId, client);
      if (updated > 0) {
        this.logger.log(`Updated ${updated} bridge(s) to new socket for ${deviceId}`);
      } else {
        // No existing bridges — destroy and rebuild from scratch
        this.streamBridge.destroyAllBridgesForDevice(deviceId);
      }
      this.commsRelay.cleanupDevice(deviceId);
    }

    this.registry.register(deviceId, client);
    await this.devicesService.updateStatus(deviceId, 'online');

    this.logger.log(`Agent connected: ${deviceId} (${device.name || device.serialNumber})`);

    // Rebuild tunnel bridges for any active sessions (reconnect recovery)
    this.rebuildActiveSessions(deviceId, client).catch(e =>
      this.logger.warn(`Failed to rebuild sessions for ${deviceId}: ${e}`),
    );

    // Re-expose chisel ports: resend port_expose for all active allocations
    // Agent loses chisel state on restart, so we must re-send all active ports
    this.reExposeChiselPorts(deviceId, client).catch(e =>
      this.logger.warn(`Failed to re-expose chisel ports for ${deviceId}: ${e}`),
    );

    // Remove any pending auth listeners and set up normal message handling
    client.removeAllListeners('message');
    client.on('message', (data: Buffer | string) => {
      this.handleMessage(deviceId, client, data);
    });

    // Setup ping/pong keepalive (Cloudflare times out idle WS after ~100s)
    this.setupKeepAlive(client, deviceId);

    // Auto-discovery: trigger localhost scan 3s after agent connects
    // Persisted under 'localhost' — scanner service maps it to a real adapter
    setTimeout(() => {
      if (client.readyState === 1) {
        this.logger.log(`Auto-scan: triggering localhost discovery for ${deviceId}`);
        try {
          client.send(JSON.stringify({
            type: 'network_scan',
            payload: {
              adapter_name: 'localhost',
              scan_type: 'standard',
              timeout_ms: 1000,
              concurrency: 20,
            },
          }));
        } catch (e: any) {
          this.logger.warn(`Auto-scan send failed for ${deviceId}: ${e.message}`);
        }
      }
    }, 3000);

    // Log disconnect reason
    client.on('close', (code: number, reason: Buffer) => {
      this.logger.log(`Agent WS close event — device=${deviceId} code=${code} reason="${reason?.toString()}"`);
    });
    client.on('error', (err: Error) => {
      this.logger.error(`Agent WS error — device=${deviceId}: ${err.message}`);
    });
  }

  private setupKeepAlive(client: any, deviceId: string) {
    // Clear any existing interval for this client
    const existing = this.keepAliveIntervals.get(client);
    if (existing) clearInterval(existing);

    let isAlive = true;
    client.on('pong', () => { isAlive = true; });

    const interval = setInterval(() => {
      if (!isAlive) {
        this.logger.warn(`Agent ${deviceId} failed ping/pong — terminating`);
        clearInterval(interval);
        this.keepAliveIntervals.delete(client);
        client.terminate();
        return;
      }
      isAlive = false;
      try {
        client.ping();
      } catch (e) {
        this.logger.warn(`Agent ${deviceId} ping failed: ${e}`);
        clearInterval(interval);
        this.keepAliveIntervals.delete(client);
      }
    }, 15_000); // Ping every 15s — aggressive keepalive for cellular networks

    this.keepAliveIntervals.set(client, interval);
    client.once('close', () => {
      clearInterval(interval);
      this.keepAliveIntervals.delete(client);
    });
  }

  /**
   * Handle legacy agents that authenticate via first message.
   * SECURITY: Now requires device_id (UUID) in the auth message — device_name/serial
   * lookup is no longer accepted as it allows any authenticated user who can see
   * device names to impersonate agents.
   * Times out after 10 seconds if no auth received.
   */
  private setupPendingAuth(client: any) {
    const AUTH_TIMEOUT_MS = 10_000;

    const authTimeout = setTimeout(() => {
      this.logger.warn('Agent auth timeout — no auth message received in 10s');
      client.close(4001, 'Auth timeout');
    }, AUTH_TIMEOUT_MS);

    const onMessage = async (data: Buffer | string) => {
      try {
        const text = data.toString();
        this.logger.debug(`Pending auth — raw message (first 200 chars): ${text.substring(0, 200)}`);

        const msg = JSON.parse(text);
        const msgType = msg.type || msg.message_type || '';

        // Only accept device_id (UUID) — no name/serial/hostname lookup
        const p = msg.payload || {};
        const deviceId = msg.device_id || msg.deviceId || p.device_id || p.deviceId;

        if (!deviceId) {
          this.logger.warn('No device_id in auth message — waiting for next message');
          return;
        }

        if (!UUID_REGEX.test(deviceId)) {
          this.logger.warn(`Legacy auth rejected: "${deviceId}" is not a valid UUID. Agents must use device UUID.`);
          clearTimeout(authTimeout);
          client.close(4002, 'Invalid device_id format — UUID required');
          return;
        }

        const [device] = await this.db
          .select()
          .from(devices)
          .where(eq(devices.id, deviceId))
          .limit(1);

        if (!device) {
          this.logger.warn(`Auth failed: device ${deviceId} not found in DB`);
          clearTimeout(authTimeout);
          client.close(4003, 'Device not found');
          return;
        }

        clearTimeout(authTimeout);
        client.removeListener('message', onMessage);
        this.logger.log(`Legacy agent authenticated: ${device.id} (${device.name})`);
        await this.activateAgent(client, device);

        // Re-process this message as normal data (heartbeat, inventory, etc.)
        if (msgType && msgType !== 'auth') {
          this.handleMessage(device.id, client, data);
        }
      } catch (e) {
        this.logger.warn(`Failed to parse auth message: ${e}`);
        clearTimeout(authTimeout);
        client.close(4001, 'Invalid auth message');
      }
    };

    client.on('message', onMessage);
    client.once('close', () => clearTimeout(authTimeout));
  }

  /**
   * Re-expose chisel ports for a device that just reconnected.
   * The agent loses its chisel state on restart, so we resend all active
   * port_expose commands so chisel client re-establishes the reverse tunnels.
   */
  private async reExposeChiselPorts(deviceId: string, agentSocket: any): Promise<void> {
    const activeAllocations = await this.db
      .select()
      .from(portAllocations)
      .where(
        and(
          eq(portAllocations.deviceId, deviceId),
          eq(portAllocations.status, 'active'),
        ),
      );

    if (activeAllocations.length === 0) return;

    this.logger.log(
      `Re-exposing ${activeAllocations.length} chisel port(s) for reconnected device ${deviceId}`,
    );

    for (const alloc of activeAllocations) {
      try {
        agentSocket.send(JSON.stringify({
          type: 'port_expose',
          service_name: alloc.serviceName,
          local_addr: `127.0.0.1:${alloc.targetPort}`,
          remote_port: alloc.remotePort,
        }));
        this.logger.log(
          `Re-exposed ${alloc.serviceName}: localhost:${alloc.targetPort} → remote:${alloc.remotePort}`,
        );
      } catch (e: any) {
        this.logger.warn(`Failed to re-expose port ${alloc.targetPort} for ${deviceId}: ${e.message}`);
      }
    }
  }

  /**
   * When an agent reconnects, rebuild tunnel bridges for active exposures.
   * Uses the shared exposure model: one set of bridges per device+port,
   * shared by all client attachments. This avoids duplicating bridges
   * when multiple tabs/users are connected.
   */
  private async rebuildActiveSessions(deviceId: string, agentSocket: any): Promise<void> {
    // Query exposures table (not accessSessions) to rebuild shared infrastructure
    const activeExposures = await this.db
      .select()
      .from(exposures)
      .where(
        and(
          eq(exposures.deviceId, deviceId),
          inArray(exposures.status, ['active', 'idle']),
        ),
      );

    // Also rebuild legacy sessions (no exposureId) for backward compatibility
    const legacySessions = await this.db
      .select()
      .from(accessSessions)
      .where(
        and(
          eq(accessSessions.deviceId, deviceId),
          eq(accessSessions.status, 'active'),
          sql`${accessSessions.exposureId} IS NULL`,
        ),
      );

    const totalToRebuild = activeExposures.length + legacySessions.length;
    if (totalToRebuild === 0) return;

    this.logger.log(`Rebuilding ${activeExposures.length} exposure(s) + ${legacySessions.length} legacy session(s) for reconnected agent ${deviceId}`);

    // Rebuild shared exposures
    for (const exposure of activeExposures) {
      if (new Date(exposure.expiresAt) < new Date()) {
        await this.db.update(exposures)
          .set({ status: 'closed', closedAt: new Date(), closeReason: 'expired' })
          .where(eq(exposures.id, exposure.id));
        continue;
      }

      try {
        const streamId = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
        this.streamBridge.registerPendingSession(deviceId, exposure.id);
        agentSocket.send(JSON.stringify({
          type: 'start_session',
          payload: {
            session_id: exposure.id,
            target_ip: exposure.targetIp,
            target_port: exposure.targetPort,
            stream_id: streamId,
          },
        }));

        await this.streamBridge.waitForSessionReady(exposure.id, 10_000);

        await this.streamBridge.createBridge(
          exposure.id, deviceId, agentSocket, true,
          exposure.targetIp, exposure.targetPort,
        );

        this.logger.log(`Rebuilt exposure ${exposure.id} → ${exposure.targetIp}:${exposure.targetPort}`);

        // Rebuild pool + comms for the exposure (not per-attachment)
        this.rebuildPoolAndComms(
          exposure.id, deviceId, agentSocket,
          exposure.targetIp, exposure.targetPort,
        ).catch(e => this.logger.warn(`Pool/comms rebuild failed for exposure ${exposure.id}: ${e}`));
      } catch (e) {
        this.logger.warn(`Failed to rebuild exposure ${exposure.id}: ${e}`);
      }
    }

    // Rebuild legacy sessions (backward compat — sessions without exposureId)
    for (const session of legacySessions) {
      if (new Date(session.expiresAt) < new Date()) {
        await this.db.update(accessSessions)
          .set({ status: 'expired', closedAt: new Date() })
          .where(eq(accessSessions.id, session.id));
        continue;
      }

      try {
        const streamId = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
        this.streamBridge.registerPendingSession(deviceId, session.id);
        agentSocket.send(JSON.stringify({
          type: 'start_session',
          payload: {
            session_id: session.id,
            target_ip: session.targetIp,
            target_port: session.targetPort,
            stream_id: streamId,
          },
        }));

        await this.streamBridge.waitForSessionReady(session.id, 10_000);

        await this.streamBridge.createBridge(
          session.id, deviceId, agentSocket, true,
          session.targetIp, session.targetPort,
        );

        this.logger.log(`Rebuilt legacy session ${session.id} → ${session.targetIp}:${session.targetPort}`);

        this.rebuildPoolAndComms(
          session.id, deviceId, agentSocket,
          session.targetIp, session.targetPort,
        ).catch(e => this.logger.warn(`Pool/comms rebuild failed for legacy ${session.id}: ${e}`));
      } catch (e) {
        this.logger.warn(`Failed to rebuild legacy session ${session.id}: ${e}`);
      }
    }
  }

  async handleDisconnect(client: any) {
    try {
      const deviceId = this.registry.getDeviceIdBySocket(client);
      if (deviceId) {
        // Only unregister if this client is still the current registered socket.
        // Prevents race condition: new connection registers → old connection closes → unregisters new one.
        const currentSocket = this.registry.getSocket(deviceId);
        if (currentSocket === client) {
          // Destroy bridges but keep sessions active for reconnect recovery
          this.streamBridge.destroyAllBridgesForDevice(deviceId);
          this.commsRelay.cleanupDevice(deviceId);
          this.registry.unregister(deviceId);
          this.lastSubnetScanTime.delete(deviceId);
          // Don't mark as offline immediately — give 60s for reconnect
          setTimeout(async () => {
            if (!this.registry.isOnline(deviceId)) {
              await this.devicesService.updateStatus(deviceId, 'offline');
              this.logger.log(`Agent confirmed offline: ${deviceId}`);
            }
          }, 60_000);
          this.logger.log(`Agent disconnected: ${deviceId} (waiting 60s for reconnect)`);
        } else {
          this.logger.log(`Stale socket closed for ${deviceId} — newer connection still active, skipping unregister`);
        }
      }
    } catch (error) {
      this.logger.error(`Error during agent disconnect: ${error}`);
    }
  }

  private handleMessage(deviceId: string, client: any, data: Buffer | string) {
    if (typeof data === 'string' || (data instanceof Buffer && data[0] === 0x7b)) {
      // Text/JSON message - control protocol
      try {
        const msg: AgentToServerMessage = JSON.parse(data.toString());
        this.handleControlMessage(deviceId, msg);
      } catch (e) {
        this.logger.warn(`Failed to parse agent message from ${deviceId}: ${e}`);
      }
    } else {
      // Binary message - tunnel data
      this.handleTunnelData(deviceId, data);
    }
  }

  private async handleControlMessage(deviceId: string, msg: any) {
    try {
      // Support both 'type' (new Rust agent) and 'message_type' (legacy Go agent)
      const msgType = msg.type || msg.message_type || '';
      switch (msgType) {
        case 'heartbeat':
          await this.handleHeartbeat(deviceId, msg);
          break;

        case 'session.ready':
        case 'session_started': {
          // Go agent may send its own session ID — always resolve from pending to get ours
          const agentSrId = msg.sessionId || msg.session_id || msg.payload?.session_id || msg.payload?.sessionId;
          const ourSrId = this.streamBridge.resolvePendingSession(deviceId) || agentSrId;
          if (ourSrId) {
            // Map agent's ID to ours if different
            if (agentSrId && agentSrId !== ourSrId) {
              this.streamBridge.mapAgentSession(ourSrId, agentSrId);
            }
            await this.handleSessionReady(deviceId, ourSrId, msg.streamId || msg.stream_id || msg.payload?.stream_id || 0);
          } else {
            this.logger.warn(`session_started from ${deviceId} but no session ID found and no pending session`);
          }
          break;
        }

        case 'session.error':
        case 'session_error': {
          const seSessionId = msg.sessionId || msg.session_id || msg.payload?.session_id || this.streamBridge.resolvePendingSession(deviceId);
          const seError = msg.error || msg.payload?.error || 'Unknown agent error';
          if (seSessionId) {
            await this.handleSessionError(deviceId, seSessionId, seError);
          }
          break;
        }

        case 'session.closed':
        case 'session_stopped': {
          const scPayload = msg.payload || {};
          const scSessionId = msg.sessionId || msg.session_id || scPayload.session_id || scPayload.sessionId;
          if (scSessionId) {
            await this.handleSessionClosed(
              deviceId,
              scSessionId,
              msg.bytesTx ?? msg.bytes_tx ?? scPayload.bytes_tx ?? 0,
              msg.bytesRx ?? msg.bytes_rx ?? scPayload.bytes_rx ?? 0,
            );
          } else {
            this.logger.debug(`session_stopped from ${deviceId} without session ID — ignoring`);
          }
          break;
        }

        // Go agent proxy messages (handle both present and past tense variants)
        case 'ws_proxy_opened':
        case 'ws_proxy_open':
        case 'ws_proxy_frame':
        case 'ws_proxy_closed':
        case 'ws_proxy_close':
        case 'tcp_stream_open':
        case 'tcp_stream_opened':
        case 'tcp_stream_data':
        case 'tcp_stream_close':
        case 'tcp_stream_closed':
        case 'http_proxy_resp':
        case 'http_proxy_response':
          this.handleGoProxyMessage(deviceId, msgType, msg);
          break;

        // /comms WebSocket relay messages (direct, no bridge)
        case 'comms_opened':
        case 'comms_frame':
        case 'comms_close':
        case 'comms_closed':
        case 'comms_error':
          this.commsRelay.handleAgentMessage(deviceId, msgType, msg);
          break;

        // Network scan results from agent
        case 'network_scan_result': {
          const scanPayload = msg.payload || msg;
          this.logger.log(`Network scan result from ${deviceId}: adapter=${scanPayload.adapter_name || msg.adapter_name}, hosts=${(scanPayload.hosts || msg.hosts || []).length}`);
          // Forward to scanner service for persistence
          (process as any).emit('agent_scan_result', deviceId, msg);
          break;
        }
        case 'network_scan_error': {
          this.logger.warn(`Network scan error from ${deviceId}: ${(msg.payload || msg).error || msg.error}`);
          (process as any).emit('agent_scan_result', deviceId, msg);
          break;
        }

        // mbusd process control responses
        case 'mbusd_started':
        case 'mbusd_stopped':
        case 'mbusd_error':
        case 'mbusd_status': {
          this.logger.log(`mbusd ${msgType} from ${deviceId}: ${JSON.stringify(msg).substring(0, 200)}`);
          // Forward to DevicesController for bridge API response
          try {
            const { DevicesController } = require('../devices/devices.controller');
            // Use dynamic import to avoid circular dependency
            const controller = this.devicesService as any;
            // Emit via a global event bus pattern
            const payload = msg.payload || msg;
            (process as any).emit('mbusd_response', deviceId, msgType, payload);
          } catch { /* controller not available */ }
          break;
        }

        case 'discovery.result':
        case 'inventory':
          await this.handleDiscoveryResult(deviceId, msg);
          break;

        case 'pong':
          break;

        case 'ack': {
          // Go agent sends "ack" with payload containing its OWN session ID.
          // We ALWAYS resolve from pending sessions to get OUR session ID,
          // and store the mapping (ours → agent's) for stop_session commands.
          const p = msg.payload || {};
          const agentSessionId = p.session_id || p.sessionId || msg.session_id || msg.sessionId;
          const ackSuccess = p.success ?? msg.success ?? true;

          // Always pop from pending sessions to get our session ID
          const ourSessionId = this.streamBridge.resolvePendingSession(deviceId);

          this.logger.log(
            `Agent ACK from ${deviceId}: agentId=${agentSessionId}, ourId=${ourSessionId}, success=${ackSuccess}`,
          );

          if (!ourSessionId) {
            this.logger.warn(`Agent ACK from ${deviceId} but no pending session in queue`);
            break;
          }

          // Store mapping: our ID → agent's ID (needed for stop_session)
          if (agentSessionId && agentSessionId !== ourSessionId) {
            this.streamBridge.mapAgentSession(ourSessionId, agentSessionId);
          }

          if (ackSuccess !== false) {
            await this.handleSessionReady(deviceId, ourSessionId, p.stream_id || p.streamId || 0);
          } else {
            await this.handleSessionError(
              deviceId,
              ourSessionId,
              p.error || msg.error || 'Agent rejected session',
            );
          }
          break;
        }

        default:
          this.logger.log(`Unhandled message type="${msgType}" from ${deviceId}, keys=${Object.keys(msg).join(',')}, full=${JSON.stringify(msg).substring(0, 500)}`);
          break;
      }
    } catch (error) {
      this.logger.error(
        `Error handling control message type="${msg.type}" from device=${deviceId}: ${error}`,
      );
    }
  }

  // ── Heartbeat handling ──

  private async handleHeartbeat(deviceId: string, msg: any) {
    // Support both flat (new agent) and nested payload (Go agente-rs) formats
    const p = msg.payload || msg;
    const cpu = p.cpu ?? p.cpu_percent ?? null;
    const mem = p.mem ?? p.mem_used_bytes ?? null;
    const memTotal = p.memTotal ?? p.mem_total_bytes ?? null;
    const disk = p.disk ?? p.disk_used_bytes ?? null;
    const diskTotal = p.diskTotal ?? p.disk_total_bytes ?? null;
    const rawUptime = p.uptime ?? p.uptime_seconds ?? 0;
    const uptime = typeof rawUptime === 'number' ? Math.floor(rawUptime) : 0;
    const agentVersion = p.agentVersion ?? p.agent_version ?? null;
    const activeTunnels = p.activeTunnels ?? p.active_tunnels ?? p.active_sessions ?? 0;
    const adapters = p.adapters;

    this.logger.debug(`Heartbeat from ${deviceId}: CPU=${cpu}%, Mem=${mem}, sessions=${p.active_sessions}, bridges=${p.active_bridges}, uptime=${uptime}s, keys=${Object.keys(p).join(',')}`);

    // Insert heartbeat — raw SQL because the hypertable column names differ from Drizzle schema
    try {
      await this.db.execute(
        sql`INSERT INTO agent_heartbeats (time, device_id, cpu_percent, mem_used_bytes, mem_total_bytes, disk_used_bytes, disk_total_bytes, uptime_secs, agent_version, active_tunnels, adapters)
            VALUES (NOW(), ${deviceId}, ${cpu ?? 0}, ${mem ?? 0}, ${memTotal ?? 0}, ${disk ?? 0}, ${diskTotal ?? 0}, ${uptime ?? 0}, ${agentVersion ?? null}, ${activeTunnels ?? 0}, ${JSON.stringify(adapters ?? [])}::jsonb)`,
      );
    } catch (e) {
      this.logger.warn(`Failed to insert heartbeat for ${deviceId}: ${e}`);
    }

    // Update device lastSeenAt, status, agentVersion, and latest metrics in metadata
    const signalQuality = p.signalQuality ?? p.signal_quality ?? null;
    const metadataUpdate: Record<string, any> = {};
    if (cpu !== undefined) metadataUpdate.cpu = cpu;
    if (mem !== undefined && memTotal) metadataUpdate.memUsed = mem;
    if (memTotal) metadataUpdate.memTotal = memTotal;
    if (disk !== undefined && diskTotal) metadataUpdate.diskUsed = disk;
    if (diskTotal) metadataUpdate.diskTotal = diskTotal;
    if (uptime) metadataUpdate.uptime = uptime;
    if (signalQuality !== null) metadataUpdate.signalQuality = signalQuality;

    await this.db
      .update(devices)
      .set({
        status: 'online',
        lastSeenAt: new Date(),
        agentVersion: agentVersion || undefined,
        updatedAt: new Date(),
        // Merge metrics into existing metadata (preserves signalQuality, type, etc.)
        metadata: sql`COALESCE(${devices.metadata}, '{}'::jsonb) || ${JSON.stringify(metadataUpdate)}::jsonb`,
      })
      .where(eq(devices.id, deviceId));

    // Upsert device adapters if present
    if (adapters && Array.isArray(adapters) && adapters.length > 0) {
      await this.upsertDeviceAdapters(deviceId, adapters);

      // Trigger subnet scans for adapters with IPs (on first heartbeat + periodically)
      await this.maybeTrigerSubnetScans(deviceId, adapters);
    }
  }

  private async upsertDeviceAdapters(
    deviceId: string,
    adapters: HeartbeatMessage['adapters'],
  ) {
    // Batch upsert using ON CONFLICT (unique index on deviceId + name)
    // Agent sends snake_case JSON; TS interface expects camelCase — support both
    // Skip virtual/irrelevant adapters that clutter the UI
    const SKIP_ADAPTERS = new Set(['lo', 'auto', 'localhost', 'dummy0', 'sit0', 'p2p0', 'docker0', 'br-', 'veth']);
    for (const raw of adapters) {
      const adapterName = (raw as any).name ?? '';
      if (SKIP_ADAPTERS.has(adapterName) || adapterName.startsWith('veth') || adapterName.startsWith('br-')) {
        continue;
      }
      const a = raw as any;
      const macAddress = a.macAddress ?? a.mac_address ?? null;
      const ipAddress = a.ipAddress ?? a.ip_address ?? null;
      const subnetMask = a.subnetMask ?? a.subnet_mask ?? null;
      const gateway = a.gateway ?? null;
      const mode = a.mode ?? null;
      const configProfile = a.configProfile ?? a.config_profile ?? null;
      const isUp = a.isUp ?? a.is_up ?? false;

      try {
        await this.db
          .insert(deviceAdapters)
          .values({
            deviceId,
            name: a.name,
            macAddress,
            ipAddress,
            subnetMask,
            gateway,
            mode,
            configProfile,
            isUp,
          })
          .onConflictDoUpdate({
            target: [deviceAdapters.deviceId, deviceAdapters.name],
            set: {
              macAddress,
              ipAddress,
              subnetMask,
              gateway,
              mode,
              configProfile,
              isUp,
              updatedAt: new Date(),
            },
          });
      } catch (error) {
        this.logger.error(
          `Error upserting adapter "${a.name}" for device ${deviceId}: ${error}`,
        );
      }
    }
  }

  /**
   * Trigger subnet scans for each adapter that has an IP + subnet mask.
   * Only fires on first heartbeat after connect, then respects autoScanIntervalSeconds.
   * Uses DB adapter data (not raw heartbeat) since heartbeat may have null IPs.
   */
  private async maybeTrigerSubnetScans(deviceId: string, _adapters: any[]) {
    const now = Date.now();
    const lastScan = this.lastSubnetScanTime.get(deviceId) ?? 0;

    // Get tenant scan interval setting
    let scanIntervalSecs = 300; // default 5 minutes
    try {
      const [device] = await this.db
        .select({ tenantId: devices.tenantId })
        .from(devices)
        .where(eq(devices.id, deviceId))
        .limit(1);
      if (device) {
        const [tenant] = await this.db
          .select({ settings: tenants.settings })
          .from(tenants)
          .where(eq(tenants.id, device.tenantId))
          .limit(1);
        const s = (tenant?.settings ?? {}) as Record<string, any>;
        scanIntervalSecs = s.autoScanIntervalSeconds ?? 300;
      }
    } catch (e: any) {
      this.logger.warn(`Failed to read scan interval for ${deviceId}: ${e.message}`);
    }

    // If auto-scan is disabled (interval=0), only scan on first heartbeat
    const intervalMs = scanIntervalSecs > 0 ? scanIntervalSecs * 1000 : Infinity;
    const isFirstScan = lastScan === 0;
    const isIntervalElapsed = (now - lastScan) >= intervalMs;

    if (!isFirstScan && !isIntervalElapsed) return;

    this.lastSubnetScanTime.set(deviceId, now);

    const client = this.registry.getSocket(deviceId);
    if (!client || client.readyState !== 1) return;

    // Query DB for adapters with IPs (heartbeat data may have null IPs
    // because Rust serializes as snake_case but JS upsert reads camelCase,
    // leaving DB IPs from previous working heartbeats intact)
    let dbAdapters: any[] = [];
    try {
      dbAdapters = await this.db
        .select({
          name: deviceAdapters.name,
          ipAddress: deviceAdapters.ipAddress,
          subnetMask: deviceAdapters.subnetMask,
          isUp: deviceAdapters.isUp,
        })
        .from(deviceAdapters)
        .where(eq(deviceAdapters.deviceId, deviceId));
    } catch (e: any) {
      this.logger.warn(`Failed to query adapters for ${deviceId}: ${e.message}`);
      return;
    }

    // Filter to scannable adapters (has IP + mask, is up, skip loopback + cellular)
    const scannableAdapters = dbAdapters.filter(a =>
      a.ipAddress &&
      a.subnetMask &&
      a.isUp !== false &&
      a.name !== 'lo' &&
      a.name !== 'auto' &&
      // Skip cellular/WAN adapters — not local networks
      !a.name?.startsWith('wwan'),
    );

    if (scannableAdapters.length === 0) return;

    this.logger.log(
      `Subnet scan: triggering for ${deviceId} — ${scannableAdapters.length} adapters: ${scannableAdapters.map(a => `${a.name}(${a.ipAddress})`).join(', ')}`,
    );

    for (const adapter of scannableAdapters) {
      try {
        client.send(JSON.stringify({
          type: 'network_scan',
          payload: {
            adapter_name: adapter.name,
            scan_type: 'deep',
            timeout_ms: 3000,
            concurrency: 50,
            // Send IP/mask from DB so agent doesn't need to run `ip` command
            ip_address: adapter.ipAddress,
            subnet_mask: adapter.subnetMask,
          },
        }));
      } catch (e: any) {
        this.logger.warn(`Failed to send subnet scan for ${adapter.name} on ${deviceId}: ${e.message}`);
      }
    }
  }

  // ── Session event handling ──

  private async handleSessionReady(deviceId: string, sessionId: string, streamId: number) {
    this.logger.log(`Session ${sessionId} ready on ${deviceId} (stream=${streamId})`);

    // Only update DB for real sessions (valid UUIDs).
    // Pool/comms bridge sessions use IDs like "exposureId-pool-0" or "exposureId-comms-1"
    // which are NOT in the access_sessions table — they're bridge-internal.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
    if (isUuid) {
      await this.db
        .update(accessSessions)
        .set({
          status: 'active',
          openedAt: new Date(),
        })
        .where(
          and(
            eq(accessSessions.id, sessionId),
            eq(accessSessions.deviceId, deviceId),
          ),
        );
    }

    // Notify StreamBridge so createSession()/spawnPool/spawnComms can resolve
    this.streamBridge.notifySessionReady(sessionId);
  }

  private async handleSessionError(deviceId: string, sessionId: string, error: string) {
    this.logger.warn(`Session ${sessionId} error on ${deviceId}: ${error}`);

    // Only update DB for real sessions (valid UUIDs), not pool/comms bridge sessions
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(sessionId);
    if (!isUuid) {
      this.streamBridge.notifySessionError(sessionId, error);
      return;
    }

    await this.db
      .update(accessSessions)
      .set({
        status: 'error',
        closeReason: error,
        closedAt: new Date(),
      })
      .where(
        and(
          eq(accessSessions.id, sessionId),
          eq(accessSessions.deviceId, deviceId),
        ),
      );

    // Notify StreamBridge so createSession() can handle the error
    this.streamBridge.notifySessionError(sessionId, error);
  }

  private async handleSessionClosed(
    deviceId: string,
    sessionId: string,
    bytesTx: number,
    bytesRx: number,
  ) {
    this.logger.log(`Session ${sessionId} closed on ${deviceId} (tx=${bytesTx}, rx=${bytesRx})`);

    // Don't close browser tunnel sessions — they use tcp_stream for individual
    // requests and the primary session should stay alive for the session duration.
    // Only mark as closed if the session was explicitly stopped by the user.
    const [session] = await this.db.select().from(accessSessions)
      .where(and(eq(accessSessions.id, sessionId), eq(accessSessions.deviceId, deviceId)))
      .limit(1);

    if (session?.tunnelType === 'browser' && session?.status === 'active') {
      this.logger.log(`Ignoring session.closed for active browser session ${sessionId} — tcp_stream handles requests`);
      return;
    }

    await this.db
      .update(accessSessions)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closeReason: 'agent_closed',
        bytesTx,
        bytesRx,
      })
      .where(
        and(
          eq(accessSessions.id, sessionId),
          eq(accessSessions.deviceId, deviceId),
        ),
      );
  }

  // ── Discovery handling ──

  private async handleDiscoveryResult(deviceId: string, msg: any) {
    // Support both Rust agent (type: discovery.result, adapterName, endpoints)
    // and Go agent (message_type: inventory, results or endpoints array)
    const endpoints = msg.endpoints || msg.results || [];
    const adapterName = msg.adapterName || msg.adapter_name || msg.interface || 'eth0';

    this.logger.log(
      `Discovery result from ${deviceId}: ${endpoints.length} endpoints on ${adapterName}`,
    );

    // Find the adapter by name for this device
    const [adapter] = await this.db
      .select()
      .from(deviceAdapters)
      .where(
        and(
          eq(deviceAdapters.deviceId, deviceId),
          eq(deviceAdapters.name, adapterName),
        ),
      )
      .limit(1);

    if (!adapter) {
      this.logger.warn(
        `Adapter "${adapterName}" not found for device ${deviceId}, storing endpoints without adapter`,
      );
      // Don't return — still try to process endpoints without adapter linkage
    }

    for (const endpoint of endpoints) {
      try {
        // Normalize Go agent fields: ip -> ipAddress, mac -> macAddress
        const epIp = endpoint.ipAddress || endpoint.ip;
        const epMac = endpoint.macAddress || endpoint.mac;
        const epHostname = endpoint.hostname || endpoint.name;
        const epServices = endpoint.services || endpoint.open_ports?.map((p: any) => ({
          port: typeof p === 'number' ? p : p.port,
          protocol: p.protocol || 'tcp',
          serviceName: p.service || p.serviceName || null,
          serviceVersion: p.serviceVersion || null,
          banner: p.banner || null,
          tunnelType: p.tunnelType || p.tunnel_type || null,
        })) || [];

        if (!epIp) continue;

        // Upsert discovered endpoint
        const adapterId = adapter?.id;
        const whereConditions = adapterId
          ? and(
              eq(discoveredEndpoints.deviceId, deviceId),
              eq(discoveredEndpoints.adapterId, adapterId),
              eq(discoveredEndpoints.ipAddress, epIp),
            )
          : and(
              eq(discoveredEndpoints.deviceId, deviceId),
              eq(discoveredEndpoints.ipAddress, epIp),
            );

        const [existing] = await this.db
          .select()
          .from(discoveredEndpoints)
          .where(whereConditions)
          .limit(1);

        let endpointId: string;

        if (existing) {
          // Update existing endpoint
          await this.db
            .update(discoveredEndpoints)
            .set({
              macAddress: epMac,
              hostname: epHostname,
              lastSeenAt: new Date(),
              isActive: true,
            })
            .where(eq(discoveredEndpoints.id, existing.id));
          endpointId = existing.id;
        } else {
          // Insert new endpoint
          const [inserted] = await this.db
            .insert(discoveredEndpoints)
            .values({
              deviceId,
              adapterId: adapterId || null,
              ipAddress: epIp,
              macAddress: epMac,
              hostname: epHostname,
            })
            .returning();
          endpointId = inserted.id;
        }

        // Upsert services for this endpoint
        for (const service of epServices) {
          await this.upsertEndpointService(endpointId, service);
        }
      } catch (error) {
        this.logger.error(
          `Error upserting endpoint for device ${deviceId}: ${error}`,
        );
      }
    }
  }

  private async upsertEndpointService(
    endpointId: string,
    service: { port: number; protocol: string; serviceName: string | null; serviceVersion: string | null; banner: string | null; tunnelType: string | null },
  ) {
    try {
      const [existing] = await this.db
        .select()
        .from(endpointServices)
        .where(
          and(
            eq(endpointServices.endpointId, endpointId),
            eq(endpointServices.port, service.port),
            eq(endpointServices.protocol, service.protocol),
          ),
        )
        .limit(1);

      if (existing) {
        await this.db
          .update(endpointServices)
          .set({
            serviceName: service.serviceName,
            serviceVersion: service.serviceVersion,
            banner: service.banner,
            isTunnelable: service.tunnelType !== null,
            tunnelType: service.tunnelType,
            lastScannedAt: new Date(),
          })
          .where(eq(endpointServices.id, existing.id));
      } else {
        await this.db.insert(endpointServices).values({
          endpointId,
          port: service.port,
          protocol: service.protocol,
          serviceName: service.serviceName,
          serviceVersion: service.serviceVersion,
          banner: service.banner,
          isTunnelable: service.tunnelType !== null,
          tunnelType: service.tunnelType,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error upserting service port=${service.port} for endpoint ${endpointId}: ${error}`,
      );
    }
  }

  // ── Go agent proxy message handling ──

  private handleGoProxyMessage(deviceId: string, msgType: string, msg: any) {
    const p = msg.payload || {};
    const sessionId = p.session_id || p.sessionId || msg.session_id || msg.sessionId;
    this.logger.debug(`Go proxy from ${deviceId}: type=${msgType}, session=${sessionId}`);
    this.streamBridge.handleGoProxyMessage(sessionId || '', msgType, msg);
  }

  // ── Tunnel data handling ──

  private handleTunnelData(deviceId: string, data: Buffer) {
    if (data.length < 8) {
      this.logger.warn(`Tunnel data from ${deviceId}: frame too short (${data.length} bytes)`);
      return;
    }

    const streamId = data.readUInt32BE(0);
    const payload = data.subarray(8);

    if (streamId === 0) {
      // Control stream - parse JSON command (SYN/FIN/RST)
      try {
        const cmd = JSON.parse(payload.toString());
        this.streamBridge.handleStreamControl(deviceId, cmd);
      } catch (e) {
        this.logger.warn(`Failed to parse tunnel control frame from ${deviceId}: ${e}`);
      }
      return;
    }

    // Data stream - route payload to the local TCP socket via StreamBridge
    this.streamBridge.routeAgentData(deviceId, streamId, payload);
  }

  /**
   * Spawn pool bridges (3 extra) + comms bridge for rebuilt sessions.
   * Mirrors TunnelsService.createSession logic for pool + comms creation.
   */
  private async rebuildPoolAndComms(
    primarySessionId: string,
    deviceId: string,
    agentSocket: any,
    targetIp: string,
    targetPort: number,
  ): Promise<void> {
    const POOL_SIZE = 5; // primary + 5 = 6 total — handle burst of ~20 concurrent Cockpit requests
    const poolSessionIds = [primarySessionId];

    // Spawn pool bridges
    for (let i = 0; i < POOL_SIZE; i++) {
      try {
        const workerSessionId = randomBytes(16).toString('hex');
        this.streamBridge.registerPendingSession(deviceId, workerSessionId);
        agentSocket.send(JSON.stringify({
          type: 'start_session',
          payload: { session_id: workerSessionId, target_ip: targetIp, target_port: targetPort },
        }));
        await this.streamBridge.waitForSessionReady(workerSessionId, 10_000);
        await this.streamBridge.createBridge(workerSessionId, deviceId, agentSocket, true, targetIp, targetPort);
        poolSessionIds.push(workerSessionId);
        this.logger.log(`Rebuild pool bridge ${i + 1}/${POOL_SIZE} ready for ${primarySessionId}`);
      } catch (e) {
        this.logger.warn(`Rebuild pool bridge ${i + 1}/${POOL_SIZE} failed: ${e instanceof Error ? e.message : e}`);
        break;
      }
    }
    if (poolSessionIds.length > 1) {
      this.streamBridge.registerBridgePool(primarySessionId, poolSessionIds);
    }

    // Spawn comms bridge
    try {
      const commsSessionId = randomBytes(16).toString('hex');
      this.streamBridge.registerPendingSession(deviceId, commsSessionId);
      agentSocket.send(JSON.stringify({
        type: 'start_session',
        payload: { session_id: commsSessionId, target_ip: targetIp, target_port: targetPort },
      }));
      await this.streamBridge.waitForSessionReady(commsSessionId, 10_000);
      await this.streamBridge.createCommsBridge(primarySessionId, commsSessionId, deviceId, agentSocket, targetIp, targetPort);
      this.logger.log(`Rebuild comms bridge ready for ${primarySessionId}`);
    } catch (e) {
      this.logger.warn(`Rebuild comms bridge failed: ${e instanceof Error ? e.message : e}`);
    }
  }
}
