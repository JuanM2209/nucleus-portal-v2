import { Injectable, Inject, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { devices, deviceAdapters, discoveredEndpoints, pendingDevices, tenants } from '../database/schema';
import { eq, and, ilike, sql, desc, asc } from 'drizzle-orm';
import type { DeviceListQuery, UpdateDevice } from '@nucleus/shared';

const ALLOWED_SORT_COLUMNS = {
  name: devices.name,
  serialNumber: devices.serialNumber,
  status: devices.status,
  lastSeenAt: devices.lastSeenAt,
  createdAt: devices.createdAt,
} as const;

type AllowedSortColumn = keyof typeof ALLOWED_SORT_COLUMNS;

@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(@Inject(DATABASE) private readonly db: any) {}

  async list(tenantId: string, query: DeviceListQuery) {
    const {
      page = 1,
      limit = 20,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = query;
    const offset = (page - 1) * limit;

    const conditions = [eq(devices.tenantId, tenantId)];

    if (status) {
      conditions.push(eq(devices.status, status));
    }

    if (search) {
      const sanitizedSearch = search.replace(/[%_\\]/g, '\\$&');
      conditions.push(
        sql`(${devices.name} ILIKE ${'%' + sanitizedSearch + '%'} OR ${devices.serialNumber} ILIKE ${'%' + sanitizedSearch + '%'})`,
      );
    }

    const where = and(...conditions);
    const orderFn = sortOrder === 'asc' ? asc : desc;

    const orderCol = ALLOWED_SORT_COLUMNS[sortBy as AllowedSortColumn];
    if (!orderCol) {
      throw new BadRequestException(
        `Invalid sortBy column. Allowed: ${Object.keys(ALLOWED_SORT_COLUMNS).join(', ')}`,
      );
    }

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(devices)
        .where(where)
        .orderBy(orderFn(orderCol))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(devices)
        .where(where),
    ]);

    return { data, total: Number(countResult[0]?.count || 0) };
  }

  async findById(tenantId: string, id: string) {
    const [device] = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, id), eq(devices.tenantId, tenantId)))
      .limit(1);

    if (!device) return null;

    const adapters = await this.db
      .select({
        adapter: deviceAdapters,
        endpointCount: sql<number>`count(${discoveredEndpoints.id})`.as('endpoint_count'),
      })
      .from(deviceAdapters)
      .leftJoin(discoveredEndpoints, eq(discoveredEndpoints.adapterId, deviceAdapters.id))
      .where(eq(deviceAdapters.deviceId, id))
      .groupBy(deviceAdapters.id);

    return {
      ...device,
      adapters: adapters.map((row: any) => ({
        ...row.adapter,
        endpointCount: Number(row.endpointCount),
      })),
    };
  }

  async update(tenantId: string, id: string, data: UpdateDevice) {
    const [device] = await this.db
      .update(devices)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(devices.id, id), eq(devices.tenantId, tenantId)))
      .returning();

    if (!device) throw new NotFoundException('Device not found');
    return device;
  }

  async remove(tenantId: string, id: string) {
    const result = await this.db
      .delete(devices)
      .where(and(eq(devices.id, id), eq(devices.tenantId, tenantId)));

    if (!result.rowCount) throw new NotFoundException('Device not found');
  }

  async updateStatus(deviceId: string, status: string) {
    await this.db
      .update(devices)
      .set({ status, lastSeenAt: new Date(), updatedAt: new Date() })
      .where(eq(devices.id, deviceId));
  }

  /** Get latest device metrics from device metadata or heartbeats table */
  async getMetrics(tenantId: string, deviceId: string) {
    const [device] = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.tenantId, tenantId)))
      .limit(1);

    if (!device) throw new NotFoundException('Device not found');

    // metadata may be an object, array of mixed types, or string
    // Find the latest heartbeat-like object with cpu/memUsed fields
    let meta: Record<string, any> = {};
    const raw = device.metadata;
    if (Array.isArray(raw)) {
      // Find the last object with cpu field (heartbeat data)
      for (let i = raw.length - 1; i >= 0; i--) {
        const item = typeof raw[i] === 'string' ? null : raw[i];
        if (item && typeof item === 'object' && 'cpu' in item) {
          meta = item;
          break;
        }
      }
    } else if (raw && typeof raw === 'object') {
      meta = raw;
    }

    return {
      cpu: meta.cpu ?? null,
      memUsed: meta.memUsed ?? null,
      memTotal: meta.memTotal ?? null,
      diskUsed: meta.diskUsed ?? null,
      diskTotal: meta.diskTotal ?? null,
      uptime: meta.uptime ?? null,
      agentVersion: device.agentVersion,
      signalQuality: meta.signalQuality ?? null,
      lastHeartbeat: device.lastSeenAt,
    };
  }

  // ── Pending Devices ──

  async listPendingDevices(tenantId: string) {
    return this.db
      .select()
      .from(pendingDevices)
      .where(
        and(
          eq(pendingDevices.tenantId, tenantId),
          eq(pendingDevices.status, 'pending'),
        ),
      )
      .orderBy(desc(pendingDevices.requestedAt));
  }

  async approveDevice(tenantId: string, pendingId: string, userId: string) {
    // Get the pending device
    const [pending] = await this.db
      .select()
      .from(pendingDevices)
      .where(
        and(
          eq(pendingDevices.id, pendingId),
          eq(pendingDevices.tenantId, tenantId),
          eq(pendingDevices.status, 'pending'),
        ),
      )
      .limit(1);

    if (!pending) throw new NotFoundException('Pending device not found');

    // Create the device
    const [device] = await this.db
      .insert(devices)
      .values({
        tenantId,
        serialNumber: pending.serialNumber,
        name: `Nucleus ${pending.serialNumber}`,
        status: 'offline',
        metadata: pending.metadata ?? {},
        tags: [],
      })
      .onConflictDoNothing()
      .returning();

    if (!device) {
      // Device already exists (race condition) — just mark as approved
      this.logger.warn(`Device ${pending.serialNumber} already exists — marking pending as approved`);
    }

    // Mark as approved
    await this.db
      .update(pendingDevices)
      .set({
        status: 'approved',
        reviewedAt: new Date(),
        reviewedBy: userId,
      })
      .where(eq(pendingDevices.id, pendingId));

    return device ?? { serialNumber: pending.serialNumber, status: 'already_existed' };
  }

  async denyDevice(tenantId: string, pendingId: string, userId: string) {
    const [pending] = await this.db
      .update(pendingDevices)
      .set({
        status: 'denied',
        reviewedAt: new Date(),
        reviewedBy: userId,
      })
      .where(
        and(
          eq(pendingDevices.id, pendingId),
          eq(pendingDevices.tenantId, tenantId),
          eq(pendingDevices.status, 'pending'),
        ),
      )
      .returning();

    if (!pending) throw new NotFoundException('Pending device not found');
    return pending;
  }

  // ── Approval Policy ──

  async getApprovalPolicy(tenantId: string): Promise<string> {
    const [tenant] = await this.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const settings = (tenant?.settings ?? {}) as Record<string, any>;
    return settings.deviceApprovalPolicy ?? 'manual';
  }

  async setApprovalPolicy(tenantId: string, policy: string) {
    const validPolicies = ['manual', 'auto_approve', 'deny_all'];
    if (!validPolicies.includes(policy)) {
      throw new BadRequestException(`Invalid policy. Must be one of: ${validPolicies.join(', ')}`);
    }

    await this.updateTenantSetting(tenantId, 'deviceApprovalPolicy', policy);
    return { policy };
  }

  // ── Stale Endpoint Threshold ──

  async getStaleThreshold(tenantId: string): Promise<number> {
    const [tenant] = await this.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const settings = (tenant?.settings ?? {}) as Record<string, any>;
    return settings.endpointStaleThresholdSeconds ?? 45;
  }

  async setStaleThreshold(tenantId: string, seconds: number) {
    if (seconds < 10 || seconds > 86400) {
      throw new BadRequestException('Threshold must be between 10 and 86400 seconds');
    }
    await this.updateTenantSetting(tenantId, 'endpointStaleThresholdSeconds', seconds);
    return { endpointStaleThresholdSeconds: seconds };
  }

  // ── Auto-Scan Interval ──

  async getAutoScanInterval(tenantId: string): Promise<number> {
    const [tenant] = await this.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const settings = (tenant?.settings ?? {}) as Record<string, any>;
    return settings.autoScanIntervalSeconds ?? 300; // 5 min default
  }

  async setAutoScanInterval(tenantId: string, seconds: number) {
    if (seconds < 0 || seconds > 86400) {
      throw new BadRequestException('Interval must be between 0 (disabled) and 86400 seconds');
    }
    await this.updateTenantSetting(tenantId, 'autoScanIntervalSeconds', seconds);
    return { autoScanIntervalSeconds: seconds };
  }

  // ── Helper: Update a single tenant setting ──

  private async updateTenantSetting(tenantId: string, key: string, value: any) {
    const [tenant] = await this.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const currentSettings = (tenant?.settings ?? {}) as Record<string, any>;
    const updatedSettings = { ...currentSettings, [key]: value };

    await this.db
      .update(tenants)
      .set({ settings: updatedSettings, updatedAt: new Date() })
      .where(eq(tenants.id, tenantId));
  }
}
