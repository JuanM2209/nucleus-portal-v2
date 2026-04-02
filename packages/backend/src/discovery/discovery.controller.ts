import { Controller, Get, Post, Param, UseGuards, ParseUUIDPipe, Logger, Inject } from '@nestjs/common';
import { DiscoveryService } from './discovery.service';
import { EndpointHealthService } from './endpoint-health.service';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse, errorResponse } from '../common/types/api-response';
import { DATABASE } from '../database/database.module';
import { deviceAdapters } from '../database/schema';
import { eq } from 'drizzle-orm';

@Controller('devices/:deviceId')
@UseGuards(JwtAuthGuard)
export class DiscoveryController {
  private readonly logger = new Logger(DiscoveryController.name);

  constructor(
    private readonly discoveryService: DiscoveryService,
    private readonly endpointHealth: EndpointHealthService,
    private readonly agentRegistry: AgentRegistryService,
    @Inject(DATABASE) private readonly db: any,
  ) {}

  @Get('adapters')
  async listAdapters(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const adapters = await this.discoveryService.listAdapters(tenantId, deviceId);
    return successResponse(adapters);
  }

  @Get('adapters/:adapterId/endpoints')
  async listAdapterEndpoints(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Param('adapterId', ParseUUIDPipe) adapterId: string,
  ) {
    const endpoints = await this.discoveryService.listEndpointsForAdapter(
      tenantId,
      deviceId,
      adapterId,
    );
    const withLiveStatus = await this.inferLiveStatus(deviceId, endpoints);
    const enriched = await this.injectBridgePort(deviceId, withLiveStatus);
    return successResponse(enriched);
  }

  @Get('endpoints')
  async listDeviceEndpoints(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const endpoints = await this.discoveryService.listEndpointsForDevice(tenantId, deviceId);
    const withLiveStatus = await this.inferLiveStatus(deviceId, endpoints);
    const enriched = await this.injectBridgePort(deviceId, withLiveStatus);
    return successResponse(enriched);
  }

  /**
   * Trigger a health check on all discovered endpoints for a device.
   * Asks the agent to verify reachability of known IPs via TCP connect.
   * Updates endpoint.isActive and endpoint.lastSeenAt in the database.
   */
  @Post('endpoints/health-check')
  async healthCheck(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    try {
      const result = await this.endpointHealth.checkEndpoints(tenantId, deviceId);
      return successResponse(result);
    } catch (err: any) {
      return errorResponse(err.message || 'Health check failed');
    }
  }

  /**
   * Infer live endpoint status from adapter state + agent connectivity.
   * This prevents stale isActive=false values from the DB showing endpoints
   * as "Idle/OFFLINE" when the adapter is actually Up with cable connected.
   *
   * Rules:
   * - Localhost (127.0.0.1) → active if agent is online
   * - Remote → active if agent online AND adapter isUp AND adapter has IP
   */
  private async inferLiveStatus(deviceId: string, endpoints: any[]): Promise<any[]> {
    if (endpoints.length === 0) return endpoints;

    const agentOnline = !!this.agentRegistry.getSocket(deviceId);

    // Load adapters for this device
    const adapters = await this.db
      .select()
      .from(deviceAdapters)
      .where(eq(deviceAdapters.deviceId, deviceId));

    const adapterMap = new Map<string, any>(adapters.map((a: any) => [a.id, a]));

    return endpoints.map((ep: any) => {
      const isLocalhost = ep.ipAddress === '127.0.0.1' || ep.ipAddress === 'localhost';
      const adapter: any = adapterMap.get(ep.adapterId);
      const adapterUp = adapter?.isUp && !!adapter?.ipAddress;

      const liveActive = isLocalhost ? agentOnline : (agentOnline && adapterUp);

      return {
        ...ep,
        isActive: liveActive,
      };
    });
  }

  /**
   * If the mbusd bridge is active on a device, inject port 2202 as a virtual
   * Modbus TCP service on the localhost endpoint. This ensures the bridge port
   * persists in the service list even after page refresh (since mbusd ports
   * are not in the discovered_endpoints table — they come from the running process).
   */
  private async injectBridgePort(deviceId: string, endpoints: any[]): Promise<any[]> {
    try {
      const socket = this.agentRegistry.getSocket(deviceId);
      if (!socket || socket.readyState !== 1) return endpoints;

      // Query bridge status with a short timeout
      const bridgeStatus = await new Promise<any>((resolve) => {
        const handler = (_devId: string, msgType: string, data: any) => {
          if (_devId === deviceId && msgType === 'mbusd_status') {
            clearTimeout(timer);
            process.removeListener('mbusd_response' as any, handler);
            resolve(data);
          }
        };
        const timer = setTimeout(() => {
          process.removeListener('mbusd_response' as any, handler);
          resolve(null);
        }, 3000);
        process.on('mbusd_response' as any, handler);
        socket.send(JSON.stringify({ type: 'mbusd_status' }));
      });

      if (!bridgeStatus?.active) return endpoints;

      const tcpPort = bridgeStatus.tcpPort || 2202;

      // Find or create localhost endpoint to attach the bridge service
      let localhostEp = endpoints.find(
        (ep: any) => ep.ipAddress === '127.0.0.1' || ep.ipAddress === 'localhost',
      );

      const bridgeService = {
        id: `bridge-mbusd-${tcpPort}`,
        port: tcpPort,
        protocol: 'tcp',
        serviceName: 'Modbus TCP (mbusd bridge)',
        serviceVersion: null,
        banner: `mbusd pid=${bridgeStatus.pid ?? '?'}`,
        isTunnelable: true,
        tunnelType: 'local' as const,
        lastScannedAt: new Date().toISOString(),
      };

      if (localhostEp) {
        // Don't duplicate if already present
        const alreadyHas = localhostEp.services?.some((s: any) => s.port === tcpPort);
        if (!alreadyHas) {
          localhostEp.services = [...(localhostEp.services ?? []), bridgeService];
        }
      } else {
        // Create a virtual localhost endpoint with just the bridge service
        endpoints = [
          ...endpoints,
          {
            id: `virtual-localhost-bridge`,
            ipAddress: '127.0.0.1',
            hostname: 'localhost',
            adapterId: endpoints[0]?.adapterId ?? null,
            macAddress: null,
            vendor: null,
            isActive: true,
            lastSeenAt: new Date().toISOString(),
            latency: null,
            services: [bridgeService],
          },
        ];
      }

      this.logger.debug(`Injected mbusd bridge port ${tcpPort} for device ${deviceId}`);
      return endpoints;
    } catch (err: any) {
      this.logger.debug(`Bridge status check skipped: ${err.message}`);
      return endpoints;
    }
  }
}
