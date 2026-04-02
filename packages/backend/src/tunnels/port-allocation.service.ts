import { Injectable, Logger, ConflictException, NotFoundException } from '@nestjs/common';
import { Inject } from '@nestjs/common';
import { eq, and, sql } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { portAllocations, devices } from '../database/schema';

/** Port range for dynamic rathole tunnels: 10001–19999 (port 10000 reserved for healthcheck) */
const PORT_RANGE_START = 10001;
const PORT_RANGE_END = 19999;

interface PortAllocation {
  id: string;
  deviceId: string;
  targetPort: number;
  remotePort: number;
  serviceName: string;
  status: string;
  createdAt: Date;
}

@Injectable()
export class PortAllocationService {
  private readonly logger = new Logger(PortAllocationService.name);

  constructor(
    @Inject('DATABASE') private readonly db: NodePgDatabase<any>,
  ) {}

  /**
   * Allocate a remote port for a device+targetPort combination.
   * Returns existing allocation if one already exists (idempotent).
   */
  async allocatePort(deviceId: string, targetPort: number): Promise<PortAllocation> {
    // Check for existing active allocation
    const existing = await this.db
      .select()
      .from(portAllocations)
      .where(
        and(
          eq(portAllocations.deviceId, deviceId),
          eq(portAllocations.targetPort, targetPort),
          eq(portAllocations.status, 'active'),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      this.logger.log(`Reusing existing allocation: device=${deviceId} port=${targetPort} → remote=${existing[0].remotePort}`);
      return existing[0] as PortAllocation;
    }

    // Find next available remote port
    const remotePort = await this.findAvailablePort();

    // Get device serial for service name
    const device = await this.db
      .select({ serialNumber: devices.serialNumber })
      .from(devices)
      .where(eq(devices.id, deviceId))
      .limit(1);

    const serial = device[0]?.serialNumber ?? deviceId.slice(0, 8);
    const serviceName = `p${targetPort}-${serial}`;

    // Create allocation
    const [allocation] = await this.db
      .insert(portAllocations)
      .values({
        deviceId,
        targetPort,
        remotePort,
        serviceName,
        status: 'active',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h TTL
      })
      .returning();

    this.logger.log(`Allocated: ${serviceName} → remote:${remotePort} (device=${deviceId}, target=${targetPort})`);
    return allocation as PortAllocation;
  }

  /**
   * Release a port allocation.
   */
  async releasePort(deviceId: string, targetPort: number): Promise<{ serviceName: string } | null> {
    const existing = await this.db
      .select()
      .from(portAllocations)
      .where(
        and(
          eq(portAllocations.deviceId, deviceId),
          eq(portAllocations.targetPort, targetPort),
          eq(portAllocations.status, 'active'),
        ),
      )
      .limit(1);

    if (existing.length === 0) return null;

    await this.db
      .update(portAllocations)
      .set({ status: 'released' })
      .where(eq(portAllocations.id, existing[0].id));

    this.logger.log(`Released: ${existing[0].serviceName} (device=${deviceId}, target=${targetPort})`);
    return { serviceName: existing[0].serviceName };
  }

  /**
   * Get all active allocations for a device.
   */
  async getActiveAllocations(deviceId: string): Promise<PortAllocation[]> {
    return this.db
      .select()
      .from(portAllocations)
      .where(
        and(
          eq(portAllocations.deviceId, deviceId),
          eq(portAllocations.status, 'active'),
        ),
      ) as Promise<PortAllocation[]>;
  }

  /**
   * Release all allocations for a device (called on device disconnect).
   */
  async releaseAllForDevice(deviceId: string): Promise<string[]> {
    const active = await this.getActiveAllocations(deviceId);
    const names = active.map(a => a.serviceName);

    if (active.length > 0) {
      await this.db
        .update(portAllocations)
        .set({ status: 'released' })
        .where(
          and(
            eq(portAllocations.deviceId, deviceId),
            eq(portAllocations.status, 'active'),
          ),
        );
      this.logger.log(`Released ${names.length} allocations for device ${deviceId}`);
    }

    return names;
  }

  /**
   * Find the next available port in the dynamic range.
   */
  private async findAvailablePort(): Promise<number> {
    const used = await this.db
      .select({ remotePort: portAllocations.remotePort })
      .from(portAllocations)
      .where(eq(portAllocations.status, 'active'));

    const usedSet = new Set(used.map(u => u.remotePort));

    for (let port = PORT_RANGE_START; port <= PORT_RANGE_END; port++) {
      if (!usedSet.has(port)) return port;
    }

    throw new ConflictException('No available ports in range 10001-19999');
  }
}
