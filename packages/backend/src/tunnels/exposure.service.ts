import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { exposures } from '../database/schema';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import { StreamBridgeService } from './stream-bridge.service';
import { eq, and, inArray, sql } from 'drizzle-orm';
import { randomBytes } from 'crypto';

/**
 * ExposureService manages shared tunnel infrastructure.
 *
 * An "exposure" represents the set of agent tunnels (1 primary + 3 pool + 1 comms)
 * for a specific device+port. Multiple client "attachments" (browser tabs / users)
 * share the same exposure without creating duplicate agent tunnels.
 *
 * Lifecycle:
 *   findOrCreate → first attachment joins → refCount=1
 *   more attachments join → refCount++
 *   attachments leave → refCount--
 *   refCount hits 0 → idle timer starts (5 min)
 *   idle timer fires → exposure destroyed (agent sessions stopped, bridges closed)
 *   new attachment before timer → timer cancelled, refCount=1 again
 */
@Injectable()
export class ExposureService {
  private readonly logger = new Logger(ExposureService.name);
  private readonly idleTimers = new Map<string, NodeJS.Timeout>();

  // Configurable limits — generous to avoid blocking users
  private readonly maxExposuresPerDevice = parseInt(process.env.MAX_EXPOSURES_PER_DEVICE || '4', 10);
  private readonly maxAttachmentsPerExposure = parseInt(process.env.MAX_ATTACHMENTS_PER_EXPOSURE || '20', 10);
  private readonly maxAttachmentsPerUser = parseInt(process.env.MAX_ATTACHMENTS_PER_USER || '20', 10);
  private readonly idleTtlMs = parseInt(process.env.EXPOSURE_IDLE_TTL_MS || '300000', 10); // 5 min

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly agentRegistry: AgentRegistryService,
    private readonly streamBridge: StreamBridgeService,
  ) {}

  /**
   * Find an existing active/idle exposure for device+port, or create a new one.
   * This is the core dedup logic — ensures only 1 set of agent tunnels per device+port.
   */
  async findOrCreateExposure(
    tenantId: string,
    deviceId: string,
    targetIp: string,
    targetPort: number,
    durationMinutes: number = 480,
  ): Promise<{ exposure: any; isNew: boolean }> {
    // Look for existing active or idle exposure
    const [existing] = await this.db
      .select()
      .from(exposures)
      .where(
        and(
          eq(exposures.deviceId, deviceId),
          eq(exposures.targetPort, targetPort),
          inArray(exposures.status, ['active', 'idle', 'pending']),
        ),
      )
      .limit(1);

    if (existing) {
      this.logger.log(
        `Found existing exposure ${existing.id} for ${deviceId}:${targetPort} (status=${existing.status}, refCount=${existing.refCount})`,
      );

      // If idle, cancel the teardown timer and reactivate
      if (existing.status === 'idle') {
        this.cancelIdleTimer(existing.id);
        await this.db
          .update(exposures)
          .set({ status: 'active', idleAt: null })
          .where(eq(exposures.id, existing.id));
        this.logger.log(`Reactivated idle exposure ${existing.id}`);
      }

      // Verify bridges still exist (agent may have reconnected)
      const bridgePort = this.streamBridge.getBridgePort(existing.id);
      if (!bridgePort) {
        this.logger.warn(`Exposure ${existing.id} has no bridges — rebuilding`);
        await this.rebuildExposureBridges(existing);
      }

      return { exposure: existing, isNew: false };
    }

    // Check exposure limit per device
    const activeCount = await this.db
      .select()
      .from(exposures)
      .where(
        and(
          eq(exposures.deviceId, deviceId),
          inArray(exposures.status, ['active', 'idle', 'pending']),
        ),
      );

    if (activeCount.length >= this.maxExposuresPerDevice) {
      throw new Error(
        `Device has ${activeCount.length} active exposures (max ${this.maxExposuresPerDevice}). Close an existing session first.`,
      );
    }

    // Create new exposure
    const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000);
    const [exposure] = await this.db.insert(exposures).values({
      tenantId,
      deviceId,
      targetIp,
      targetPort,
      status: 'pending',
      refCount: 0,
      expiresAt,
    }).returning();

    this.logger.log(
      `Created new exposure ${exposure.id} for ${deviceId}:${targetPort}`,
    );

    // Set up agent tunnels
    const agentSocket = this.agentRegistry.getSocket(deviceId);
    if (agentSocket) {
      try {
        await this.setupAgentTunnels(exposure, agentSocket);
        await this.db
          .update(exposures)
          .set({ status: 'active' })
          .where(eq(exposures.id, exposure.id));
        exposure.status = 'active';
      } catch (e: any) {
        await this.db
          .update(exposures)
          .set({ status: 'error', closeReason: e.message, closedAt: new Date() })
          .where(eq(exposures.id, exposure.id));
        throw e;
      }
    } else {
      // No agent — direct proxy mode (exposure still tracks the logical exposure)
      await this.db
        .update(exposures)
        .set({ status: 'active' })
        .where(eq(exposures.id, exposure.id));
      exposure.status = 'active';
    }

    return { exposure, isNew: true };
  }

  /**
   * Set up agent tunnels for an exposure: primary bridge + pool workers + comms bridge.
   */
  private async setupAgentTunnels(exposure: any, agentSocket: any): Promise<void> {
    // Validate socket is still connected
    if (agentSocket.readyState !== 1) { // 1 = WebSocket.OPEN
      throw new Error(`Agent socket not open (readyState=${agentSocket.readyState})`);
    }
    const { id: exposureId, deviceId, targetIp, targetPort } = exposure;

    // Start primary agent session
    const startMsg = {
      type: 'start_session',
      payload: {
        session_id: exposureId,
        target_ip: targetIp,
        target_port: targetPort,
        stream_id: Math.floor(Math.random() * 0x7FFFFFFF) + 1,
      },
    };

    this.streamBridge.registerPendingSession(deviceId, exposureId);
    agentSocket.send(JSON.stringify(startMsg));
    this.logger.log(`Sent start_session for exposure ${exposureId}`);

    await this.streamBridge.waitForSessionReady(exposureId, 30_000);

    // Create primary bridge
    await this.streamBridge.createBridge(exposureId, deviceId, agentSocket, true, targetIp, targetPort);
    this.logger.log(`Primary bridge created for exposure ${exposureId}`);

    // Spawn pool workers (fire-and-forget)
    this.spawnPoolWorkers(exposureId, deviceId, agentSocket, targetIp, targetPort)
      .catch(e => this.logger.warn(`Pool bridges failed for exposure ${exposureId}: ${e}`));

    // Spawn comms bridge
    this.spawnCommsBridge(exposureId, deviceId, agentSocket, targetIp, targetPort)
      .catch(e => this.logger.warn(`Comms bridge failed for exposure ${exposureId}: ${e}`));
  }

  /**
   * Rebuild bridges for an existing exposure (e.g., after agent reconnect).
   */
  async rebuildExposureBridges(exposure: any): Promise<void> {
    const agentSocket = this.agentRegistry.getSocket(exposure.deviceId);
    if (!agentSocket) {
      this.logger.warn(`Cannot rebuild exposure ${exposure.id} — agent offline`);
      return;
    }

    try {
      await this.setupAgentTunnels(exposure, agentSocket);
      this.logger.log(`Rebuilt bridges for exposure ${exposure.id}`);
    } catch (e: any) {
      this.logger.error(`Failed to rebuild exposure ${exposure.id}: ${e.message}`);
    }
  }

  /**
   * Increment attachment count. Cancels idle timer if running.
   */
  async incrementRefCount(exposureId: string): Promise<void> {
    this.cancelIdleTimer(exposureId);

    await this.db
      .update(exposures)
      .set({
        refCount: sql`${exposures.refCount} + 1`,
        status: 'active',
        idleAt: null,
      })
      .where(eq(exposures.id, exposureId));

    this.logger.log(`Exposure ${exposureId} refCount incremented`);
  }

  /**
   * Decrement attachment count. Starts idle timer if refCount hits 0.
   */
  async decrementRefCount(exposureId: string): Promise<void> {
    await this.db
      .update(exposures)
      .set({
        refCount: sql`GREATEST(${exposures.refCount} - 1, 0)`,
      })
      .where(eq(exposures.id, exposureId));

    // Check current refCount
    const [updated] = await this.db
      .select({ refCount: exposures.refCount })
      .from(exposures)
      .where(eq(exposures.id, exposureId));

    if (updated && updated.refCount <= 0) {
      this.logger.log(`Exposure ${exposureId} refCount=0 — starting idle timer (${this.idleTtlMs}ms)`);
      this.startIdleTimer(exposureId);
    } else {
      this.logger.log(`Exposure ${exposureId} refCount=${updated?.refCount}`);
    }
  }

  /**
   * Start idle timer. When it fires, the exposure is destroyed.
   */
  private startIdleTimer(exposureId: string): void {
    this.cancelIdleTimer(exposureId); // Ensure no duplicates

    this.db
      .update(exposures)
      .set({ status: 'idle', idleAt: new Date() })
      .where(eq(exposures.id, exposureId))
      .catch((e: any) => this.logger.error(`Failed to mark exposure ${exposureId} as idle: ${e.message}`));

    const timer = setTimeout(async () => {
      this.idleTimers.delete(exposureId);
      this.logger.log(`Idle timer fired for exposure ${exposureId} — destroying`);
      await this.destroyExposure(exposureId, 'idle_timeout');
    }, this.idleTtlMs);

    this.idleTimers.set(exposureId, timer);
  }

  /**
   * Cancel idle timer (called when new attachment joins).
   */
  private cancelIdleTimer(exposureId: string): void {
    const timer = this.idleTimers.get(exposureId);
    if (timer) {
      clearTimeout(timer);
      this.idleTimers.delete(exposureId);
      this.logger.log(`Cancelled idle timer for exposure ${exposureId}`);
    }
  }

  /**
   * Destroy an exposure: stop agent sessions, destroy bridges, update DB.
   */
  async destroyExposure(exposureId: string, reason: string = 'manual'): Promise<void> {
    this.cancelIdleTimer(exposureId);

    // Send stop_session to agent
    const [exposure] = await this.db
      .select()
      .from(exposures)
      .where(eq(exposures.id, exposureId));

    if (!exposure) return;

    const agentSocket = this.agentRegistry.getSocket(exposure.deviceId);
    if (agentSocket) {
      const agentIds = this.streamBridge.getAgentSessionIds(exposureId);
      for (const agentSid of agentIds) {
        try {
          agentSocket.send(JSON.stringify({
            type: 'stop_session',
            payload: { session_id: agentSid },
          }));
          this.logger.log(`Sent stop_session for exposure ${exposureId}, agentId=${agentSid}`);
        } catch { /* best-effort */ }
      }
    }

    // Destroy local bridges
    this.streamBridge.destroyBridge(exposureId);

    // Update DB
    await this.db
      .update(exposures)
      .set({ status: 'closed', closedAt: new Date(), closeReason: reason, refCount: 0 })
      .where(eq(exposures.id, exposureId));

    this.logger.log(`Exposure ${exposureId} destroyed (reason: ${reason})`);
  }

  /**
   * Get active exposure for a device+port.
   */
  async getActiveExposure(deviceId: string, targetPort: number, tenantId?: string): Promise<any | null> {
    const conditions = [
      eq(exposures.deviceId, deviceId),
      eq(exposures.targetPort, targetPort),
      inArray(exposures.status, ['active', 'idle']),
    ];
    if (tenantId) {
      conditions.push(eq(exposures.tenantId, tenantId));
    }
    const [exposure] = await this.db
      .select()
      .from(exposures)
      .where(and(...conditions))
      .limit(1);
    return exposure ?? null;
  }

  /**
   * Get all active exposures for a device (used by agent gateway rebuild).
   */
  async getActiveExposuresForDevice(deviceId: string): Promise<any[]> {
    return this.db
      .select()
      .from(exposures)
      .where(
        and(
          eq(exposures.deviceId, deviceId),
          inArray(exposures.status, ['active', 'idle']),
        ),
      );
  }

  // Getters for limits (used by TunnelsService)
  get maxAttachments(): number { return this.maxAttachmentsPerExposure; }
  get maxUserAttachments(): number { return this.maxAttachmentsPerUser; }

  // ── Pool / Comms bridge spawning (moved from TunnelsService) ──

  private async spawnPoolWorkers(
    exposureId: string,
    deviceId: string,
    agentSocket: any,
    targetIp: string,
    targetPort: number,
  ): Promise<void> {
    const POOL_SIZE = 6; // Handle burst of ~20 concurrent Cockpit resource requests
    const poolSessionIds: string[] = [];

    for (let i = 0; i < POOL_SIZE; i++) {
      const poolSessionId = `${exposureId}-pool-${i}`;
      const startMsg = {
        type: 'start_session',
        payload: {
          session_id: poolSessionId,
          target_ip: targetIp,
          target_port: targetPort,
          stream_id: Math.floor(Math.random() * 0x7FFFFFFF) + 1,
        },
      };

      this.streamBridge.registerPendingSession(deviceId, poolSessionId);
      agentSocket.send(JSON.stringify(startMsg));

      try {
        await this.streamBridge.waitForSessionReady(poolSessionId, 30_000);
        await this.streamBridge.createBridge(poolSessionId, deviceId, agentSocket, true, targetIp, targetPort);
        poolSessionIds.push(poolSessionId);
        this.logger.log(`Pool bridge ${i + 1}/${POOL_SIZE} created for exposure ${exposureId}`);
      } catch (e: any) {
        this.logger.warn(`Pool bridge ${i + 1} failed for exposure ${exposureId}: ${e.message}`);
      }
    }

    if (poolSessionIds.length > 0) {
      this.streamBridge.registerBridgePool(exposureId, poolSessionIds);
      this.logger.log(`Registered pool of ${poolSessionIds.length} bridges for exposure ${exposureId}`);
    }
  }

  private async spawnCommsBridge(
    exposureId: string,
    deviceId: string,
    agentSocket: any,
    targetIp: string,
    targetPort: number,
  ): Promise<void> {
    // Comms bridge is CRITICAL for /cockpit/socket WebSocket stability.
    // Without it, WebSocket goes through FIFO bridge which has a 60s timeout.
    // Use 30s timeout (cellular RTT can be 12s+) and retry once on failure.
    const COMMS_TIMEOUT = 30_000;
    const MAX_RETRIES = 2;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const commsSessionId = `${exposureId}-comms-${attempt}`;
      const startMsg = {
        type: 'start_session',
        payload: {
          session_id: commsSessionId,
          target_ip: targetIp,
          target_port: targetPort,
          stream_id: Math.floor(Math.random() * 0x7FFFFFFF) + 1,
        },
      };

      this.streamBridge.registerPendingSession(deviceId, commsSessionId);
      agentSocket.send(JSON.stringify(startMsg));

      try {
        await this.streamBridge.waitForSessionReady(commsSessionId, COMMS_TIMEOUT);
        await this.streamBridge.createCommsBridge(
          exposureId, commsSessionId, deviceId, agentSocket, targetIp, targetPort,
        );
        this.logger.log(`Comms bridge created for exposure ${exposureId} (attempt ${attempt})`);
        return; // Success — exit retry loop
      } catch (e: any) {
        this.logger.warn(`Comms bridge attempt ${attempt}/${MAX_RETRIES} failed for exposure ${exposureId}: ${e.message}`);
        if (attempt === MAX_RETRIES) {
          this.logger.error(`Comms bridge FAILED after ${MAX_RETRIES} attempts for exposure ${exposureId}. /cockpit/socket will use FIFO bridge (60s timeout).`);
        }
      }
    } // end retry loop
  }
}
