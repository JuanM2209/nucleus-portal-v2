import { Injectable, Inject, NotFoundException, BadRequestException } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { devices, deviceAdapters, discoveredEndpoints } from '../database/schema';
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
}
