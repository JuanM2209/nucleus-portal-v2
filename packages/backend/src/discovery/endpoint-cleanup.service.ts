import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { devices } from '../database/schema';
import { eq } from 'drizzle-orm';
import { DiscoveryService } from './discovery.service';

/**
 * Periodic cleanup of stale discovered endpoints.
 *
 * For each online device, checks the tenant's stale threshold setting and
 * removes endpoints that haven't been seen since the cutoff. This runs
 * every 30 seconds to keep endpoint lists accurate and responsive.
 */
@Injectable()
export class EndpointCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EndpointCleanupService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 30_000; // 30 seconds

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly discoveryService: DiscoveryService,
  ) {}

  onModuleInit() {
    this.logger.log('Endpoint cleanup service started (interval: 30s)');
    // Delay first run by 15s to let the system stabilize
    setTimeout(() => {
      this.runCleanup().catch(e => this.logger.error(`Initial endpoint cleanup failed: ${e.message}`));
      this.intervalId = setInterval(() => {
        this.runCleanup().catch(e => this.logger.error(`Endpoint cleanup cycle failed: ${e.message}`));
      }, this.CLEANUP_INTERVAL_MS);
    }, 15_000);
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

    // Cache threshold per tenant to avoid repeated queries
    const thresholdCache = new Map<string, number>();
    let totalRemoved = 0;

    for (const device of onlineDevices) {
      try {
        let threshold = thresholdCache.get(device.tenantId);
        if (threshold === undefined) {
          threshold = await this.discoveryService.getStaleThreshold(device.tenantId);
          thresholdCache.set(device.tenantId, threshold);
        }

        const removed = await this.discoveryService.cleanupStaleEndpoints(device.id, threshold);
        totalRemoved += removed;
      } catch (e: any) {
        this.logger.warn(`Failed to cleanup endpoints for device ${device.id}: ${e.message}`);
      }
    }

    if (totalRemoved > 0) {
      this.logger.log(`Endpoint cleanup: removed ${totalRemoved} stale endpoints across ${onlineDevices.length} devices`);
    }
  }
}
