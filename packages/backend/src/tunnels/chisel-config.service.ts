import { Injectable, Logger } from '@nestjs/common';

/**
 * Tracks active chisel tunnel services in memory.
 *
 * Unlike rathole, chisel server needs NO config file — it accepts
 * any authenticated reverse connection dynamically. This service
 * is purely for observability and cleanup coordination.
 */
@Injectable()
export class ChiselConfigService {
  private readonly logger = new Logger(ChiselConfigService.name);
  private readonly services = new Map<string, { remotePort: number }>();

  addService(serviceName: string, remotePort: number): void {
    this.services.set(serviceName, { remotePort });
    this.logger.log(`Service tracked: ${serviceName} → port ${remotePort} (total: ${this.services.size})`);
  }

  removeService(serviceName: string): void {
    this.services.delete(serviceName);
    this.logger.log(`Service removed: ${serviceName} (total: ${this.services.size})`);
  }

  removeServices(serviceNames: string[]): void {
    for (const name of serviceNames) {
      this.services.delete(name);
    }
    if (serviceNames.length > 0) {
      this.logger.log(`Removed ${serviceNames.length} services (total: ${this.services.size})`);
    }
  }

  getServices(): Map<string, { remotePort: number }> {
    return new Map(this.services);
  }

  getActiveCount(): number {
    return this.services.size;
  }
}
