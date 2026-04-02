import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { devices, deviceAdapters, discoveredEndpoints, endpointServices } from '../database/schema';
import { eq, and, inArray } from 'drizzle-orm';

@Injectable()
export class DiscoveryService {
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
}
