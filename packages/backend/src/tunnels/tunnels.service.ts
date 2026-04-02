import { Injectable, Inject, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DATABASE } from '../database/database.module';
import { accessSessions, devices, exposures } from '../database/schema';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import { StreamBridgeService } from './stream-bridge.service';
import { TunnelProxyService } from './tunnel-proxy.service';
import { ExposureService } from './exposure.service';
import { AuditService } from '../audit/audit.service';
import { LogsService } from '../logs/logs.service';
import { eq, and, gte, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';

@Injectable()
export class TunnelsService {
  private readonly logger = new Logger(TunnelsService.name);
  private readonly tunnelBaseUrl: string;

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly agentRegistry: AgentRegistryService,
    private readonly streamBridge: StreamBridgeService,
    private readonly tunnelProxy: TunnelProxyService,
    private readonly exposureService: ExposureService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly logsService: LogsService,
  ) {
    const port = this.configService.get<number>('PORT') || 3001;
    this.tunnelBaseUrl =
      this.configService.get<string>('TUNNEL_BASE_URL') || `http://localhost:${port}`;
  }

  async createSession(user: any, params: any) {
    const { deviceId, targetIp, targetPort, tunnelType, durationMinutes = 480 } = params; // Default 8 hours

    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const proxyToken = randomBytes(16).toString('hex');

    if (tunnelType === 'browser') {
      // ── Shared Exposure model ──
      // Find or create a shared exposure (tunnel infrastructure) for this device+port.
      // Multiple attachments (tabs/users) share the same set of agent tunnels.
      const { exposure, isNew } = await this.exposureService.findOrCreateExposure(
        user.tenantId, deviceId, targetIp, targetPort, durationMinutes,
      );

      // Auto-cleanup: Close ALL previous active sessions for this same user + device + port.
      // Cockpit on embedded devices has limited concurrent sessions (often just 1-2).
      // Leaving stale sessions causes "protocol-error" on new logins.
      // This ensures each "Open in Browser" click gives the user a clean session.
      const previousSessions = await this.db
        .select()
        .from(accessSessions)
        .where(
          and(
            eq(accessSessions.userId, user.id),
            eq(accessSessions.deviceId, deviceId),
            eq(accessSessions.targetPort, targetPort),
            eq(accessSessions.status, 'active'),
          ),
        );

      for (const prev of previousSessions) {
        this.logger.log(`Auto-closing previous session ${prev.id?.substring(0, 8)} for same user+device+port`);
        await this.db
          .update(accessSessions)
          .set({ status: 'closed', closedAt: new Date(), closeReason: 'replaced_by_new_session' })
          .where(eq(accessSessions.id, prev.id));
        if (prev.exposureId) {
          await this.exposureService.decrementRefCount(prev.exposureId);
        }
      }
      if (previousSessions.length > 0) {
        this.logger.log(`Cleaned ${previousSessions.length} previous sessions — device resources freed`);
        // Wait for Cockpit on the device to release stale sessions.
        // Cockpit-ws takes 2-10s to recycle sessions after the tunnel closes.
        // Without this delay, the new login hits "protocol-error".
        const waitMs = Math.min(previousSessions.length * 3000, 15000);
        this.logger.log(`Waiting ${waitMs / 1000}s for device to release Cockpit sessions...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
      }

      // Soft limit check — if at max, log a warning but don't reject.
      // Production users should never be blocked from opening a port.
      const totalAttachments = await this.db
        .select()
        .from(accessSessions)
        .where(
          and(
            eq(accessSessions.exposureId, exposure.id),
            eq(accessSessions.status, 'active'),
          ),
        );

      if (totalAttachments.length >= 20) {
        // Hard limit to prevent resource exhaustion — close the oldest
        const oldest = totalAttachments.sort((a: any, b: any) =>
          new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime()
        )[0];
        this.logger.warn(`Closing oldest attachment ${oldest.id} to make room (total: ${totalAttachments.length})`);
        await this.db
          .update(accessSessions)
          .set({ status: 'closed', closedAt: new Date(), closeReason: 'limit_exceeded' })
          .where(eq(accessSessions.id, oldest.id));
        await this.exposureService.decrementRefCount(exposure.id);
      }

      // Create client attachment (session record) pointing to the shared exposure
      const proxyUrl = `${this.tunnelBaseUrl}/proxy/${proxyToken}/`;
      const [session] = await this.db.insert(accessSessions).values({
        tenantId: user.tenantId,
        userId: user.id,
        deviceId,
        exposureId: exposure.id,
        targetIp,
        targetPort,
        tunnelType,
        status: 'active',
        proxySubdomain: null,
        proxyPath: `/proxy/${proxyToken}`,
        expiresAt,
        openedAt: new Date(),
        userIp: null,
      }).returning();

      // Increment exposure reference count
      await this.exposureService.incrementRefCount(exposure.id);

      this.logger.log(
        `Attachment ${session.id} created for exposure ${exposure.id} (${deviceId}:${targetPort}, isNew=${isNew})`,
      );

      this.logSessionCreated(user, session, deviceId, targetIp, targetPort, tunnelType, expiresAt);

      // Cockpit health probe + cache warming (fire-and-forget).
      // Runs in background so createSession returns immediately to the user.
      // The frontend shows a "Connecting..." page which naturally waits for Cockpit to be ready.
      if (targetPort === 9090) {
        const proxyPath = `/proxy/${proxyToken}`;
        this.runCockpitProbeAsync(proxyPath, isNew, exposure.id)
          .catch(e => this.logger.warn(`Cockpit probe failed: ${e}`));
      }

      return {
        sessionId: session.id,
        status: 'active',
        tunnelType,
        proxyUrl,
        helperConfig: null,
        exposureId: exposure.id,
        attachmentCount: totalAttachments.length + 1,
        expiresAt: expiresAt.toISOString(),
      };
    }

    // ── Local (helper) tunnels — no shared exposure model ──
    const sessionToken = randomBytes(32).toString('hex');
    const host = new URL(this.tunnelBaseUrl).host;
    const helperConfig = {
      wsUrl: `wss://${host}/ws/tunnel`,
      sessionToken,
      targetPort,
      server: `wss://${host}`,
    };

    // Store token in proxyPath so /ws/tunnel can look it up
    const [session] = await this.db.insert(accessSessions).values({
      tenantId: user.tenantId,
      userId: user.id,
      deviceId,
      targetIp,
      targetPort,
      tunnelType,
      status: 'active',
      proxySubdomain: null,
      proxyPath: `/tunnel/${sessionToken}`,
      expiresAt,
      openedAt: new Date(),
      userIp: null,
    }).returning();

    this.logger.log(
      `Session ${session.id} created for device ${deviceId} -> ${targetIp}:${targetPort} (${tunnelType})`,
    );

    // Don't send start_session here — the tunnel WS gateway (/ws/tunnel)
    // sends its own start_session when the CLI client connects. Sending
    // two start_session commands creates duplicate agent sessions that
    // interfere with each other (one closes while the other expects data).

    this.logSessionCreated(user, session, deviceId, targetIp, targetPort, tunnelType, expiresAt);

    return {
      sessionId: session.id,
      status: session.status,
      tunnelType,
      proxyUrl: null,
      helperConfig,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listActiveSessions(tenantId: string, userId: string) {
    return this.db
      .select()
      .from(accessSessions)
      .where(
        and(
          eq(accessSessions.tenantId, tenantId),
          eq(accessSessions.userId, userId),
          eq(accessSessions.status, 'active'),
        ),
      );
  }

  async findById(tenantId: string, id: string) {
    const [session] = await this.db
      .select()
      .from(accessSessions)
      .where(and(eq(accessSessions.id, id), eq(accessSessions.tenantId, tenantId)))
      .limit(1);

    return session || null;
  }

  async extendSession(tenantId: string, id: string) {
    const newExpiry = new Date(Date.now() + 60 * 60 * 1000); // +1 hour
    const [session] = await this.db
      .update(accessSessions)
      .set({ expiresAt: newExpiry })
      .where(
        and(
          eq(accessSessions.id, id),
          eq(accessSessions.tenantId, tenantId),
          eq(accessSessions.status, 'active'),
        ),
      )
      .returning();

    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async closeSession(tenantId: string, id: string, reason: string) {
    // Mark this attachment as closed (do NOT destroy bridges — other attachments may still use them)
    const [session] = await this.db
      .update(accessSessions)
      .set({
        status: 'closed',
        closedAt: new Date(),
        closeReason: reason,
      })
      .where(
        and(
          eq(accessSessions.id, id),
          eq(accessSessions.tenantId, tenantId),
        ),
      )
      .returning();

    if (!session) throw new NotFoundException('Session not found');

    // Decrement exposure refCount — if it hits 0, the idle timer starts.
    // The exposure (bridges + agent tunnels) is only destroyed when the timer fires
    // and no new attachments have joined.
    if (session.exposureId) {
      await this.exposureService.decrementRefCount(session.exposureId);
    } else {
      // Legacy session without exposure — destroy bridges directly
      this.streamBridge.destroyBridge(id);
      const socket = this.agentRegistry.getSocket(session.deviceId);
      if (socket) {
        const agentIds = this.streamBridge.getAgentSessionIds(id);
        for (const agentSid of agentIds) {
          try {
            socket.send(JSON.stringify({
              type: 'stop_session',
              payload: { session_id: agentSid },
            }));
          } catch { /* best-effort */ }
        }
      }
    }

    // Audit + Activity log: attachment closed
    const closeDetails = {
      targetIp: session.targetIp,
      targetPort: session.targetPort,
      tunnelType: session.tunnelType,
      closeReason: reason,
      exposureId: session.exposureId,
      duration: session.openedAt
        ? Math.round((Date.now() - new Date(session.openedAt).getTime()) / 1000)
        : null,
    };

    this.auditService.log({
      tenantId,
      userId: session.userId,
      deviceId: session.deviceId,
      action: 'session.close',
      resourceType: 'session',
      resourceId: session.id,
      details: closeDetails,
    }).catch(() => {});

    this.logsService.logActivity({
      userId: session.userId,
      deviceId: session.deviceId,
      action: 'session.close',
      resourceType: 'session',
      resourceId: session.id,
      details: closeDetails,
    }).catch((e) => this.logger.error(`Activity log (close) failed: ${e.message}`));

    return session;
  }

  /** Fire-and-forget audit + activity log for session creation */
  private logSessionCreated(
    user: any, session: any, deviceId: string,
    targetIp: string, targetPort: number,
    tunnelType: string, expiresAt: Date,
  ) {
    this.logger.log(`[AUDIT] Logging session create: user=${user.email} device=${deviceId} port=${targetPort} type=${tunnelType}`);
    const details = {
      targetIp,
      targetPort,
      tunnelType,
      expiresAt: expiresAt.toISOString(),
      sessionId: session.id,
      userEmail: user.email || user.displayName || user.id,
    };

    // Audit log (formal audit trail)
    this.auditService.log({
      tenantId: user.tenantId,
      userId: user.id,
      deviceId,
      action: 'session.create',
      resourceType: 'session',
      resourceId: session.id,
      details,
    }).catch(() => {});

    // Activity log (user-facing activity feed)
    // Note: orgId references organizations table, not tenants — pass null until org context is available
    this.logsService.logActivity({
      userId: user.id,
      deviceId,
      action: tunnelType === 'browser' ? 'session.open' : 'session.export',
      resourceType: 'session',
      resourceId: session.id,
      details,
    }).catch((e) => this.logger.error(`Activity log failed: ${e.message}`));
  }

  /** Background Cockpit health probe — does NOT block session creation */
  private async runCockpitProbeAsync(proxyPath: string, isNew: boolean, exposureId: string): Promise<void> {
    const baseUrl = `http://localhost:${process.env.PORT || 3001}${proxyPath}`;
    const cockpitUser = this.configService.get<string>('COCKPIT_USER');
    const cockpitPass = this.configService.get<string>('COCKPIT_PASSWORD');
    if (!cockpitUser || !cockpitPass) {
      this.logger.warn('Cockpit probe skipped: COCKPIT_USER/COCKPIT_PASSWORD not configured');
      return;
    }

    for (let attempt = 1; attempt <= 4; attempt++) {
      try {
        const loginResp = await fetch(`${baseUrl}/cockpit/login`, {
          headers: { 'Authorization': 'Basic ' + Buffer.from(`${cockpitUser}:${cockpitPass}`).toString('base64') },
          redirect: 'manual',
        });
        if (!loginResp.ok) {
          this.logger.warn(`Cockpit probe: login ${loginResp.status} (attempt ${attempt}/4)`);
          if (attempt < 4) await new Promise(r => setTimeout(r, 5000));
          continue;
        }
        const setCookie = loginResp.headers.get('set-cookie') || '';
        const cookie = setCookie.split(';')[0];
        const shellResp = await fetch(`${baseUrl}/`, { headers: { 'Cookie': cookie } });
        try { await fetch(`${baseUrl}/cockpit/logout`, { method: 'POST', headers: { 'Cookie': cookie } }); } catch {}
        if (shellResp.status === 200) {
          this.logger.log(`Cockpit probe: OK (attempt ${attempt})`);
          break;
        }
        if (attempt < 4) await new Promise(r => setTimeout(r, 5000));
      } catch (e) {
        this.logger.debug(`Cockpit probe error (attempt ${attempt}): ${e}`);
        if (attempt < 4) await new Promise(r => setTimeout(r, 5000));
      }
    }

    // Cache warming (best-effort)
    const cacheSize = this.tunnelProxy.getCacheSize?.() ?? 0;
    if (isNew || cacheSize < 100_000) {
      this.tunnelProxy.warmCockpitCache(exposureId, proxyPath)
        .catch(e => this.logger.warn(`Cache warm failed: ${e}`));
    }
  }

  // ── /comms Bridge Creation ──

  /**
   * Public wrapper to spawn pool + comms bridges (used during session rebuild).
   */
  async spawnPoolAndComms(
    primarySessionId: string,
    deviceId: string,
    agentSocket: any,
    targetIp: string,
    targetPort: number,
  ): Promise<void> {
    await Promise.all([
      this.spawnPoolWorkers(primarySessionId, deviceId, agentSocket, targetIp, targetPort)
        .catch(e => this.logger.warn(`Pool bridges failed: ${e}`)),
      this.spawnCommsBridge(primarySessionId, deviceId, agentSocket, targetIp, targetPort)
        .catch(e => this.logger.warn(`Comms bridge failed: ${e}`)),
    ]);
  }

  /**
   * Spawn a dedicated agent session + bridge for the /comms WebSocket.
   * This runs on a separate agent session so it doesn't block the FIFO HTTP bridge.
   * The /comms bridge allows a single persistent WebSocket connection for real-time
   * communication: node status, deploy notifications, inject results, debug messages.
   *
   * Best-effort: if this fails, the editor still works but without real-time features.
   */
  private async spawnCommsBridge(
    primarySessionId: string,
    deviceId: string,
    agentSocket: any,
    targetIp: string,
    targetPort: number,
  ): Promise<void> {
    const commsSessionId = randomBytes(16).toString('hex');
    try {
      this.streamBridge.registerPendingSession(deviceId, commsSessionId);
      agentSocket.send(JSON.stringify({
        type: 'start_session',
        payload: {
          session_id: commsSessionId,
          target_ip: targetIp,
          target_port: targetPort,
        },
      }));
      this.logger.log(`Spawning /comms bridge (${commsSessionId}) for primary ${primarySessionId}`);

      await this.streamBridge.waitForSessionReady(commsSessionId, 10_000);
      await this.streamBridge.createCommsBridge(
        primarySessionId, commsSessionId, deviceId, agentSocket, targetIp, targetPort,
      );
      this.logger.log(`/comms bridge ready for primary ${primarySessionId}`);
    } catch (e) {
      this.logger.warn(
        `/comms bridge failed for ${primarySessionId}: ${e instanceof Error ? e.message : e} — editor will work without real-time features`,
      );
      // Non-fatal: don't throw, editor will fall back to mock /comms
    }
  }

  // ── Pool Worker Creation ──

  /**
   * Spawn additional Go agent sessions, each with its own bridge (TCP server).
   * This gives true parallelism: each bridge handles one request at a time independently.
   * The proxy service round-robins across bridges via getBridgePort().
   *
   * Go agent supports max 5 concurrent sessions, so we create 3 extras (4 total).
   */
  private async spawnPoolWorkers(
    primarySessionId: string,
    deviceId: string,
    agentSocket: any,
    targetIp: string,
    targetPort: number,
  ): Promise<void> {
    const POOL_SIZE = 6; // Handle burst of ~20 concurrent Cockpit resource requests
    const poolSessionIds = [primarySessionId]; // Start with primary

    for (let i = 0; i < POOL_SIZE; i++) {
      try {
        const workerSessionId = randomBytes(16).toString('hex');

        // Register pending session for ack mapping
        this.streamBridge.registerPendingSession(deviceId, workerSessionId);

        // Send start_session to agent
        agentSocket.send(JSON.stringify({
          type: 'start_session',
          payload: {
            session_id: workerSessionId,
            target_ip: targetIp,
            target_port: targetPort,
          },
        }));

        this.logger.log(`Spawning pool bridge ${i + 1}/${POOL_SIZE} (${workerSessionId}) for primary ${primarySessionId}`);

        // Wait for agent confirmation (sequential to avoid overwhelming agent)
        await this.streamBridge.waitForSessionReady(workerSessionId, 10_000);

        // Create a SEPARATE bridge (own TCP server) for this session
        // Always use JSON proxy for HTTP browser tunnels (handles request multiplexing)
        await this.streamBridge.createBridge(workerSessionId, deviceId, agentSocket, true, targetIp, targetPort);
        poolSessionIds.push(workerSessionId);

        this.logger.log(`Pool bridge ${i + 1}/${POOL_SIZE} ready for primary ${primarySessionId}`);
      } catch (e) {
        this.logger.warn(
          `Pool bridge ${i + 1}/${POOL_SIZE} failed for primary ${primarySessionId}: ${e instanceof Error ? e.message : e}`,
        );
        break; // Stop trying if one fails (agent likely at max sessions)
      }
    }

    // Register the pool so getBridgePort() round-robins across all bridges
    if (poolSessionIds.length > 1) {
      this.streamBridge.registerBridgePool(primarySessionId, poolSessionIds);
    }
  }
}
