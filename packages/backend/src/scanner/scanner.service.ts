import { Injectable, Inject, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DATABASE } from '../database/database.module';
import {
  devices,
  deviceAdapters,
  discoveredEndpoints,
  endpointServices,
} from '../database/schema';
import { eq, and, sql } from 'drizzle-orm';
import { HostDiscoveryService, HostResult } from './host-discovery.service';
import { PortScannerService, PortResult } from './port-scanner.service';
import { ServiceClassifierService } from './service-classifier.service';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';

// ── Interfaces ──

export interface ScanResult {
  ip: string;
  hostname?: string;
  mac?: string;
  latency?: number;
  isAlive: boolean;
  ports: ScanPortResult[];
  reachability: 'direct' | 'requires-agent';
}

export interface ScanPortResult {
  port: number;
  protocol: string;
  isOpen: boolean;
  serviceName?: string;
  serviceType?: 'browser' | 'local';
  icon?: string;
  banner?: string;
  httpStatus?: number;
  latency?: number;
}

export interface ScanJob {
  id: string;
  deviceId: string;
  adapterId: string;
  tenantId: string;
  scanType: 'quick' | 'standard' | 'deep';
  status: 'running' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date;
  progress: number;
  hostsScanned: number;
  hostsFound: number;
  portsFound: number;
  results: ScanResult[];
  error?: string;
}

// ── Scan configuration by type ──

const SCAN_CONFIG: Record<string, { timeout: number; concurrency: number }> = {
  quick: { timeout: 500, concurrency: 20 },
  standard: { timeout: 1000, concurrency: 40 },
  deep: { timeout: 2000, concurrency: 80 },
};

@Injectable()
export class ScannerService {
  private readonly logger = new Logger(ScannerService.name);
  private readonly scanJobs = new Map<string, ScanJob>();

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly hostDiscovery: HostDiscoveryService,
    private readonly portScanner: PortScannerService,
    private readonly serviceClassifier: ServiceClassifierService,
    private readonly agentRegistry: AgentRegistryService,
  ) {
    // Listen for agent scan results
    (process as any).on('agent_scan_result', (deviceId: string, msg: any) => {
      this.handleAgentScanResult(deviceId, msg);
    });
  }

  async startScan(
    tenantId: string,
    deviceId: string,
    adapterId: string,
    scanType: 'quick' | 'standard' | 'deep',
  ): Promise<ScanJob> {
    // Validate device + adapter belong to tenant
    const [adapter] = await this.db
      .select({
        adapter: deviceAdapters,
        device: devices,
      })
      .from(deviceAdapters)
      .innerJoin(devices, eq(devices.id, deviceAdapters.deviceId))
      .where(
        and(
          eq(deviceAdapters.id, adapterId),
          eq(deviceAdapters.deviceId, deviceId),
          eq(devices.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!adapter) {
      throw new NotFoundException(
        `Adapter ${adapterId} not found for device ${deviceId}`,
      );
    }

    const adapterData = adapter.adapter;
    const deviceData = adapter.device;

    const job: ScanJob = {
      id: randomUUID(),
      deviceId,
      adapterId,
      tenantId,
      scanType,
      status: 'running',
      startedAt: new Date(),
      progress: 0,
      hostsScanned: 0,
      hostsFound: 0,
      portsFound: 0,
      results: [],
    };

    this.scanJobs.set(job.id, job);

    // Route scan through agent when available (for devices behind Nucleus)
    const agentSocket = this.agentRegistry.getSocket(deviceId);
    if (agentSocket?.readyState === 1 && adapterData.ipAddress) {
      this.logger.log(`Routing scan through agent for ${adapterData.name} (${adapterData.ipAddress})`);
      try {
        agentSocket.send(JSON.stringify({
          type: 'network_scan',
          payload: {
            adapter_name: adapterData.name,
            scan_type: scanType,
            timeout_ms: SCAN_CONFIG[scanType]?.timeout || 1000,
            concurrency: SCAN_CONFIG[scanType]?.concurrency || 20,
          },
        }));
        // Agent scan — will be completed by handleAgentScanResult
        (job as any).__agentRouted = true;
        (job as any).__adapterData = adapterData;

        // Simulate incremental progress so the UI doesn't stay at 0%
        // Agent scans have no intermediate updates, so we tick progress
        // from 5→85% over the expected scan duration.
        const expectedMs = scanType === 'quick' ? 15000 : scanType === 'standard' ? 45000 : 120000;
        const tickInterval = 1500;
        const tickIncrement = Math.round(80 / (expectedMs / tickInterval));
        const timer = setInterval(() => {
          const current = this.scanJobs.get(job.id);
          if (!current || current.status !== 'running') {
            clearInterval(timer);
            return;
          }
          const nextProgress = Math.min(current.progress + tickIncrement, 85);
          this.updateJob(job.id, { progress: nextProgress });
        }, tickInterval);

        // Safety timeout: if agent never responds, complete with whatever we have
        // Use shorter timeout to avoid scan appearing stuck
        const timeoutMs = Math.min(expectedMs + 5000, 60000);
        setTimeout(() => {
          const current = this.scanJobs.get(job.id);
          if (current && current.status === 'running') {
            clearInterval(timer);
            this.logger.warn(`Agent scan timed out for job ${job.id} after ${timeoutMs}ms, completing with partial results`);
            this.updateJob(job.id, {
              status: 'completed',
              progress: 100,
              completedAt: new Date(),
            });
          }
        }, timeoutMs);

        return job;
      } catch (e) {
        this.logger.warn(`Failed to route scan through agent, falling back to direct: ${e}`);
      }
    }

    // Run scan directly from backend (fallback)
    this.executeScan(job, adapterData, deviceData).catch((err) => {
      this.logger.error(`Scan ${job.id} failed: ${err.message}`, err.stack);
      const updated: ScanJob = {
        ...job,
        status: 'failed',
        error: err.message,
        completedAt: new Date(),
      };
      this.scanJobs.set(job.id, updated);
    });

    return job;
  }

  getScanStatus(scanId: string): ScanJob | undefined {
    return this.scanJobs.get(scanId);
  }

  getScanResults(scanId: string): ScanJob | undefined {
    return this.scanJobs.get(scanId);
  }

  private async executeScan(
    job: ScanJob,
    adapter: any,
    device: any,
  ): Promise<void> {
    const config = SCAN_CONFIG[job.scanType] ?? SCAN_CONFIG.quick;
    const ports = this.portScanner.getPortsForScanType(job.scanType);

    // Determine what we can scan directly
    // The device's access IP (from metadata or a known location) is directly reachable
    const accessIp = device.metadata?.accessIp ?? adapter.gateway ?? adapter.ipAddress;
    const adapterIp = adapter.ipAddress;
    const subnetMask = adapter.subnetMask;
    const cidr = subnetMask ? this.maskToCidr(subnetMask) : 24;

    this.logger.log(
      `Scan ${job.id}: device=${device.name}, adapter=${adapter.name}, ` +
      `ip=${adapterIp}, accessIp=${accessIp}, cidr=${cidr}, type=${job.scanType}`,
    );

    // Phase 1: Scan the device's own access IP (directly reachable from backend)
    this.updateJob(job.id, { progress: 5 });

    const directResults: ScanResult[] = [];

    if (accessIp) {
      this.logger.log(`Scanning access IP ${accessIp} directly`);
      const portResults = await this.portScanner.scanPorts(
        accessIp,
        ports,
        config,
      );

      const openPorts = portResults.filter((p) => p.isOpen);
      const classifiedPorts = await this.classifyPorts(accessIp, openPorts, config.timeout);

      directResults.push({
        ip: accessIp,
        isAlive: openPorts.length > 0,
        latency: openPorts[0]?.latency,
        ports: classifiedPorts,
        reachability: 'direct',
      });
    }

    this.updateJob(job.id, {
      progress: 30,
      hostsScanned: 1,
      hostsFound: directResults.filter((r) => r.isAlive).length,
      portsFound: directResults.reduce(
        (sum, r) => sum + r.ports.filter((p) => p.isOpen).length,
        0,
      ),
    });

    // Phase 2: Discover hosts on the adapter's subnet
    // These are behind the device - backend may not reach them directly
    const subnetResults: ScanResult[] = [];

    if (adapterIp && cidr) {
      this.logger.log(
        `Discovering hosts on ${adapterIp}/${cidr} (may be behind device)`,
      );

      // Try host discovery. If hosts are behind the device, connections will timeout.
      const hosts = await this.hostDiscovery.discoverHosts(
        adapterIp,
        cidr,
        config,
      );

      this.updateJob(job.id, { progress: 60 });

      const aliveHosts = hosts.filter((h) => h.isAlive);

      // For each alive host (that isn't our access IP), scan ports
      for (let i = 0; i < aliveHosts.length; i++) {
        const host = aliveHosts[i];
        if (host.ip === accessIp) continue; // Already scanned

        const portResults = await this.portScanner.scanPorts(
          host.ip,
          ports,
          config,
        );

        const openPorts = portResults.filter((p) => p.isOpen);
        const classifiedPorts = await this.classifyPorts(host.ip, openPorts, config.timeout);

        subnetResults.push({
          ip: host.ip,
          isAlive: true,
          latency: host.latency ?? undefined,
          ports: classifiedPorts,
          reachability: 'direct',
        });

        const progress = 60 + Math.round((i / aliveHosts.length) * 30);
        this.updateJob(job.id, { progress: Math.min(progress, 90) });
      }

      // Mark hosts that didn't respond as potentially behind the device
      const unreachableHosts = hosts.filter(
        (h) => !h.isAlive && h.ip !== accessIp,
      );
      // We don't add every unreachable IP - just note in logs
      if (unreachableHosts.length > 0) {
        this.logger.log(
          `${unreachableHosts.length} hosts on ${adapterIp}/${cidr} not reachable from backend (may require agent)`,
        );
      }
    }

    // Phase 3: Store results in DB
    const allResults = [...directResults, ...subnetResults];
    await this.persistResults(job.tenantId, job.deviceId, job.adapterId, allResults);

    // Finalize
    const totalPorts = allResults.reduce(
      (sum, r) => sum + r.ports.filter((p) => p.isOpen).length,
      0,
    );

    this.updateJob(job.id, {
      status: 'completed',
      progress: 100,
      completedAt: new Date(),
      hostsScanned: allResults.length,
      hostsFound: allResults.filter((r) => r.isAlive).length,
      portsFound: totalPorts,
      results: allResults,
    });

    this.logger.log(
      `Scan ${job.id} completed: ${allResults.filter((r) => r.isAlive).length} hosts, ${totalPorts} open ports`,
    );
  }

  private async classifyPorts(
    ip: string,
    openPorts: PortResult[],
    timeout: number,
  ): Promise<ScanPortResult[]> {
    const classified: ScanPortResult[] = [];

    for (const portResult of openPorts) {
      const info = this.serviceClassifier.classify(portResult.port);
      const banner = await this.serviceClassifier.grabBanner(
        ip,
        portResult.port,
        timeout,
      );

      classified.push({
        port: portResult.port,
        protocol: portResult.protocol,
        isOpen: true,
        serviceName: info.serviceName,
        serviceType: info.serviceType,
        icon: info.icon,
        banner: banner ?? undefined,
        latency: portResult.latency,
      });
    }

    return classified;
  }

  private async persistResults(
    tenantId: string,
    deviceId: string,
    adapterId: string,
    results: ScanResult[],
  ): Promise<void> {
    for (const hostResult of results) {
      if (!hostResult.isAlive) continue;

      try {
        // First try to find existing endpoint to preserve metadata
        const [existing] = await this.db
          .select({ metadata: discoveredEndpoints.metadata })
          .from(discoveredEndpoints)
          .where(and(
            eq(discoveredEndpoints.deviceId, deviceId),
            eq(discoveredEndpoints.adapterId, adapterId),
            eq(discoveredEndpoints.ipAddress, hostResult.ip),
          ))
          .limit(1);

        const scanMeta = { reachability: hostResult.reachability, latency: hostResult.latency ?? null };
        // Merge: keep existing type/classification, add scan data
        const mergedMeta = existing?.metadata
          ? { ...(existing.metadata as Record<string, any>), ...scanMeta }
          : scanMeta;

        // Upsert discovered endpoint
        const [endpoint] = await this.db
          .insert(discoveredEndpoints)
          .values({
            deviceId,
            adapterId,
            ipAddress: hostResult.ip,
            macAddress: hostResult.mac ?? null,
            hostname: hostResult.hostname ?? null,
            isActive: true,
            lastSeenAt: new Date(),
            metadata: mergedMeta,
          })
          .onConflictDoUpdate({
            target: [
              discoveredEndpoints.deviceId,
              discoveredEndpoints.adapterId,
              discoveredEndpoints.ipAddress,
            ],
            set: {
              isActive: true,
              lastSeenAt: new Date(),
              hostname: hostResult.hostname ?? null,
              macAddress: hostResult.mac ?? null,
              metadata: mergedMeta,
            },
          })
          .returning();

        // Upsert services for open ports
        for (const portInfo of hostResult.ports) {
          if (!portInfo.isOpen) continue;

          await this.db
            .insert(endpointServices)
            .values({
              endpointId: endpoint.id,
              port: portInfo.port,
              protocol: portInfo.protocol,
              serviceName: portInfo.serviceName ?? null,
              banner: portInfo.banner ?? null,
              isTunnelable: portInfo.serviceType === 'browser',
              tunnelType: portInfo.serviceType === 'browser' ? 'http' : null,
              lastScannedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [
                endpointServices.endpointId,
                endpointServices.port,
                endpointServices.protocol,
              ],
              set: {
                serviceName: portInfo.serviceName ?? null,
                banner: portInfo.banner ?? null,
                isTunnelable: portInfo.serviceType === 'browser',
                tunnelType: portInfo.serviceType === 'browser' ? 'http' : null,
                lastScannedAt: new Date(),
              },
            });
        }
      } catch (err: any) {
        this.logger.error(
          `Failed to persist results for ${hostResult.ip}: ${err.message}`,
        );
      }
    }
  }

  private updateJob(id: string, updates: Partial<ScanJob>): void {
    const existing = this.scanJobs.get(id);
    if (existing) {
      this.scanJobs.set(id, { ...existing, ...updates });
    }
  }

  private maskToCidr(mask: string): number {
    const parts = mask.split('.').map(Number);
    let bits = 0;
    for (const part of parts) {
      let byte = part;
      while (byte > 0) {
        bits += byte & 1;
        byte >>= 1;
      }
    }
    return bits;
  }

  /**
   * Handle scan results from the agent (network_scan_result message).
   * Persists results to DB and updates the scan job status.
   */
  private async handleAgentScanResult(deviceId: string, msg: any): Promise<void> {
    const payload = msg.payload || msg;
    const adapterName = payload.adapter_name || msg.adapter_name;
    const hosts = payload.hosts || msg.hosts || [];
    const isError = msg.type === 'network_scan_error';

    this.logger.log(`Agent scan result for ${deviceId}/${adapterName}: ${hosts.length} hosts`);

    // Find the matching scan job
    let matchedJob: ScanJob | undefined;
    for (const [id, job] of this.scanJobs) {
      if (job.deviceId === deviceId && job.status === 'running' && (job as any).__agentRouted) {
        matchedJob = job;
        break;
      }
    }

    if (!matchedJob) {
      this.logger.warn(`No matching scan job for agent result from ${deviceId}`);
      return;
    }

    if (isError) {
      const error = payload.error || msg.error || 'Agent scan failed';
      const updated: ScanJob = { ...matchedJob, status: 'failed', error, completedAt: new Date() };
      this.scanJobs.set(matchedJob.id, updated);
      return;
    }

    // Convert agent results to ScanResult format and persist
    const adapterData = (matchedJob as any).__adapterData;
    if (!adapterData) return;

    const results: ScanResult[] = hosts.map((host: any) => ({
      ip: host.ip,
      hostname: null,
      mac: null,
      latency: host.latency_ms || null,
      isAlive: true, // agent only returns alive hosts
      ports: (host.ports || []).map((p: any) => ({
        port: p.port,
        protocol: 'tcp',
        isOpen: p.open,
        serviceName: p.service || null,
        serviceType: this.classifyServiceType(p.port),
        banner: null,
      })),
      reachability: 'requires-agent',
    }));

    // Persist to DB
    try {
      await this.persistResults(matchedJob.tenantId, matchedJob.deviceId, matchedJob.adapterId, results);
    } catch (e) {
      this.logger.error(`Failed to persist agent scan results: ${e}`);
    }

    // Update job status
    const totalPorts = results.reduce((sum: number, r: ScanResult) => sum + r.ports.filter((p: any) => p.isOpen).length, 0);
    const updated: ScanJob = {
      ...matchedJob,
      status: 'completed',
      completedAt: new Date(),
      hostsScanned: hosts.length,
      hostsFound: results.length,
      portsFound: totalPorts,
      results,
      progress: 100,
    };
    this.scanJobs.set(matchedJob.id, updated);
    this.logger.log(`Agent scan completed: ${results.length} hosts, ${totalPorts} ports`);
  }

  private classifyServiceType(port: number): string {
    const webPorts = [80, 81, 443, 1880, 8080, 8443, 9090];
    return webPorts.includes(port) ? 'browser' : 'local';
  }
}
