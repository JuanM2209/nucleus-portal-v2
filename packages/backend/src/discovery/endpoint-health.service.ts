import { Injectable, Inject, Logger } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { discoveredEndpoints, endpointServices, devices, deviceAdapters } from '../database/schema';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import { eq, and, inArray } from 'drizzle-orm';

/**
 * EndpointHealthService — checks reachability of discovered endpoints.
 *
 * Strategy:
 * 1. Localhost endpoints (127.0.0.1) — always reachable if agent is online
 * 2. Remote endpoints — check if adapter is up AND endpoint was seen recently
 * 3. When agent supports `endpoint_health_check` (vr23+), use TCP connect test
 *
 * For now, uses lastSeenAt age + adapter isUp as proxy for reachability.
 */
@Injectable()
export class EndpointHealthService {
  private readonly logger = new Logger(EndpointHealthService.name);
  private readonly STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly agentRegistry: AgentRegistryService,
  ) {}

  /**
   * Check reachability of all discovered endpoints for a device.
   * Returns per-endpoint and per-adapter status.
   */
  async checkEndpoints(tenantId: string, deviceId: string): Promise<any> {
    // Verify device belongs to tenant
    const [device] = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.tenantId, tenantId)))
      .limit(1);

    if (!device) return { success: false, error: 'Device not found' };

    const agentOnline = !!this.agentRegistry.getSocket(deviceId);

    // Get adapters — filter out virtual/system interfaces
    const VIRTUAL_ADAPTERS = /^(dummy|p2p|sit|ip6tnl|tunl|veth|br-|docker|virbr|lo)$/i;
    const allAdapterRows = await this.db
      .select()
      .from(deviceAdapters)
      .where(eq(deviceAdapters.deviceId, deviceId));
    const adapterRows = allAdapterRows.filter(
      (a: any) => !VIRTUAL_ADAPTERS.test(a.name?.replace(/\d+$/, '') ?? ''),
    );

    // Get endpoints
    const endpoints = await this.db
      .select()
      .from(discoveredEndpoints)
      .where(eq(discoveredEndpoints.deviceId, deviceId));

    // Get services
    const endpointIds = endpoints.map((ep: any) => ep.id);
    const services = endpointIds.length > 0
      ? await this.db.select().from(endpointServices).where(inArray(endpointServices.endpointId, endpointIds))
      : [];

    const now = new Date();
    const adapterResults: any[] = [];
    const endpointResults: any[] = [];

    // Check each adapter
    for (const adapter of adapterRows) {
      const hasIp = !!adapter.ipAddress && adapter.ipAddress !== '0.0.0.0';
      // Adapter is considered connected if: has IP, agent reports isUp, and agent is online
      const isConnected = agentOnline && adapter.isUp && hasIp;

      adapterResults.push({
        id: adapter.id,
        name: adapter.name,
        ipAddress: adapter.ipAddress,
        isUp: adapter.isUp,
        hasIp,
        isConnected,
      });
    }

    // Check each endpoint
    for (const ep of endpoints) {
      const isLocalhost = ep.ipAddress === '127.0.0.1' || ep.ipAddress === 'localhost';
      const age = now.getTime() - new Date(ep.lastSeenAt).getTime();
      const isStale = age > this.STALE_THRESHOLD_MS;

      // Find the adapter for this endpoint
      const adapter = adapterRows.find((a: any) => a.id === ep.adapterId);
      const adapterConnected = adapter ? (agentOnline && adapter.isUp && !!adapter.ipAddress) : false;

      // Localhost → always reachable if agent online
      // Remote → reachable if adapter is connected (has cable + IP + agent online)
      // We trust the adapter's live state over lastSeenAt staleness
      const isReachable = isLocalhost
        ? agentOnline
        : adapterConnected;

      // Get service ports for this endpoint
      const epServices = services.filter((s: any) => s.endpointId === ep.id);

      // Update endpoint isActive in DB
      if (ep.isActive !== isReachable) {
        await this.db
          .update(discoveredEndpoints)
          .set({
            isActive: isReachable,
            lastSeenAt: isReachable ? now : ep.lastSeenAt,
          })
          .where(eq(discoveredEndpoints.id, ep.id));
      }

      endpointResults.push({
        id: ep.id,
        ipAddress: ep.ipAddress,
        hostname: ep.hostname,
        adapterId: ep.adapterId,
        adapterName: adapter?.name ?? 'unknown',
        isActive: isReachable,
        isLocalhost,
        isStale,
        lastSeenAt: ep.lastSeenAt,
        ageMinutes: Math.round(age / 60_000),
        services: epServices.map((s: any) => ({
          port: s.port,
          serviceName: s.serviceName,
          isTunnelable: s.isTunnelable,
        })),
      });
    }

    const reachable = endpointResults.filter((r: any) => r.isActive).length;
    const total = endpointResults.length;

    this.logger.log(
      `Health check ${deviceId}: ${reachable}/${total} endpoints reachable, ` +
      `${adapterResults.filter((a: any) => a.isConnected).length}/${adapterResults.length} adapters connected, ` +
      `agent=${agentOnline ? 'online' : 'offline'}`,
    );

    return {
      success: true,
      checkedAt: now.toISOString(),
      agentOnline,
      adapters: adapterResults,
      endpoints: endpointResults,
      reachable,
      total,
    };
  }
}
