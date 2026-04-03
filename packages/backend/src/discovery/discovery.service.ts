import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { devices, deviceAdapters, discoveredEndpoints, endpointServices, tenants } from '../database/schema';
import { eq, and, inArray, lt, sql } from 'drizzle-orm';

@Injectable()
export class DiscoveryService {
  private readonly logger = new Logger(DiscoveryService.name);

  constructor(@Inject(DATABASE) private readonly db: any) {}

  async listAdapters(tenantId: string, deviceId: string) {
    const rows = await this.db
      .select()
      .from(deviceAdapters)
      .innerJoin(devices, eq(devices.id, deviceAdapters.deviceId))
      .where(and(eq(deviceAdapters.deviceId, deviceId), eq(devices.tenantId, tenantId)));

    return rows.map((row: any) => row.device_adapters);
  }

  async listEndpointsForAdapter(tenantId: string, deviceId: string, adapterId: string) {
    const endpointRows = await this.db
      .select()
      .from(discoveredEndpoints)
      .innerJoin(devices, eq(devices.id, discoveredEndpoints.deviceId))
      .where(
        and(
          eq(discoveredEndpoints.deviceId, deviceId),
          eq(discoveredEndpoints.adapterId, adapterId),
          eq(devices.tenantId, tenantId),
        ),
      );

    const endpoints = endpointRows.map((row: any) => row.discovered_endpoints);

    if (endpoints.length === 0) {
      return [];
    }

    const endpointIds = endpoints.map((ep: any) => ep.id);

    const services = await this.db
      .select()
      .from(endpointServices)
      .where(inArray(endpointServices.endpointId, endpointIds));

    return this.attachServicesToEndpoints(endpoints, services);
  }

  async listEndpointsForDevice(tenantId: string, deviceId: string) {
    const endpointRows = await this.db
      .select()
      .from(discoveredEndpoints)
      .innerJoin(devices, eq(devices.id, discoveredEndpoints.deviceId))
      .where(
        and(
          eq(discoveredEndpoints.deviceId, deviceId),
          eq(devices.tenantId, tenantId),
        ),
      );

    const endpoints = endpointRows.map((row: any) => row.discovered_endpoints);

    if (endpoints.length === 0) {
      return [];
    }

    const endpointIds = endpoints.map((ep: any) => ep.id);

    const services = await this.db
      .select()
      .from(endpointServices)
      .where(inArray(endpointServices.endpointId, endpointIds));

    return this.attachServicesToEndpoints(endpoints, services);
  }

  private attachServicesToEndpoints(endpoints: any[], services: any[]) {
    const servicesByEndpointId = new Map<string, any[]>();
    for (const svc of services) {
      const list = servicesByEndpointId.get(svc.endpointId) ?? [];
      list.push({
        id: svc.id,
        port: svc.port,
        protocol: svc.protocol,
        serviceName: svc.serviceName,
        serviceVersion: svc.serviceVersion,
        banner: svc.banner,
        isTunnelable: svc.isTunnelable,
        tunnelType: svc.tunnelType,
        lastScannedAt: svc.lastScannedAt,
      });
      servicesByEndpointId.set(svc.endpointId, list);
    }

    return endpoints.map((ep) => ({
      ...ep,
      latency: ep.metadata?.latency ?? null,
      services: servicesByEndpointId.get(ep.id) ?? [],
    }));
  }

  /**
   * Remove stale endpoints that haven't been seen since the given cutoff.
   * Also removes their associated services (cascade via endpointId FK).
   */
  async cleanupStaleEndpoints(deviceId: string, staleThresholdSeconds: number): Promise<number> {
    const cutoff = new Date(Date.now() - staleThresholdSeconds * 1000);

    // Find stale endpoints
    const staleEndpoints = await this.db
      .select({ id: discoveredEndpoints.id })
      .from(discoveredEndpoints)
      .where(
        and(
          eq(discoveredEndpoints.deviceId, deviceId),
          lt(discoveredEndpoints.lastSeenAt, cutoff),
        ),
      );

    if (staleEndpoints.length === 0) return 0;

    const staleIds = staleEndpoints.map((e: any) => e.id);

    // Delete services first (FK constraint)
    await this.db
      .delete(endpointServices)
      .where(inArray(endpointServices.endpointId, staleIds));

    // Delete endpoints
    const result = await this.db
      .delete(discoveredEndpoints)
      .where(inArray(discoveredEndpoints.id, staleIds));

    const count = result.rowCount ?? staleIds.length;
    this.logger.log(`Cleaned up ${count} stale endpoints for device ${deviceId} (threshold: ${staleThresholdSeconds}s)`);
    return count;
  }

  /**
   * Get the stale endpoint threshold from tenant settings.
   * Default: 45 seconds.
   */
  async getStaleThreshold(tenantId: string): Promise<number> {
    const [tenant] = await this.db
      .select({ settings: tenants.settings })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const settings = (tenant?.settings ?? {}) as Record<string, any>;
    return settings.endpointStaleThresholdSeconds ?? 45;
  }
}
