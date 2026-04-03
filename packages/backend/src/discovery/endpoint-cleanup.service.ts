import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { devices, tenants } from '../database/schema';
import { eq } from 'drizzle-orm';
import { DiscoveryService } from './discovery.service';

/**
 * Periodic cleanup of stale discovered endpoints.
 *
 * For each online device, checks the tenant's stale threshold AND scan interval.
 * The effective threshold is: max(staleThreshold, scanInterval * 2 + 60s).
 * This ensures endpoints survive between periodic scans.
 *
 * Runs every 60 seconds.
 */
@Injectable()
export class EndpointCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EndpointCleanupService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60_000; // 60 seconds

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly discoveryService: DiscoveryService,
  ) {}

  onModuleInit() {
    this.logger.log('Endpoint cleanup service started (interval: 60s)');
    // Delay first run by 30s to let agents connect and scan
    setTimeout(() => {
      this.runCleanup().catch(e => this.logger.error(`Initial endpoint cleanup failed: ${e.message}`));
      this.intervalId = setInterval(() => {
        this.runCleanup().catch(e => this.logger.error(`Endpoint cleanup cycle failed: ${e.message}`));
      }, this.CLEANUP_INTERVAL_MS);
    }, 30_000);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runCleanup() {
    // Get all online devices across all tenants
    const onlineDevices = await this.db
      .select({ id: devices.id, tenantId: devices.tenantId })
      .from(devices)
      .where(eq(devices.status, 'online'));

    if (!onlineDevices || onlineDevices.length === 0) return;

    // Cache settings per tenant to avoid repeated queries
    const settingsCache = new Map<string, { staleThreshold: number; scanInterval: number }>();
    let totalRemoved = 0;

    for (const device of onlineDevices) {
      try {
        let settings = settingsCache.get(device.tenantId);
        if (!settings) {
          const [tenant] = await this.db
            .select({ settings: tenants.settings })
            .from(tenants)
            .where(eq(tenants.id, device.tenantId))
            .limit(1);

          const s = (tenant?.settings ?? {}) as Record<string, any>;
          settings = {
            staleThreshold: s.endpointStaleThresholdSeconds ?? 45,
            scanInterval: s.autoScanIntervalSeconds ?? 300,
          };
          settingsCache.set(device.tenantId, settings);
        }

        // Effective threshold: must survive at least 2 scan cycles + buffer
        // If scan interval is 300s, threshold must be at least 660s (300*2+60)
        const minThreshold = settings.scanInterval > 0
          ? settings.scanInterval * 2 + 60
          : settings.staleThreshold;
        const effectiveThreshold = Math.max(settings.staleThreshold, minThreshold);

        const removed = await this.discoveryService.cleanupStaleEndpoints(device.id, effectiveThreshold);
        totalRemoved += removed;
      } catch (e: any) {
        this.logger.warn(`Failed to cleanup endpoints for device ${device.id}: ${e.message}`);
      }
    }

    if (totalRemoved > 0) {
      this.logger.log(`Endpoint cleanup: removed ${totalRemoved} stale endpoints`);
    }
  }
}
