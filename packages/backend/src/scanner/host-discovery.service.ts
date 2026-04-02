import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';

export interface HostResult {
  ip: string;
  latency: number | null;
  isAlive: boolean;
  respondedOnPort?: number;
}

interface DiscoveryOptions {
  timeout: number;
  concurrency: number;
}

@Injectable()
export class HostDiscoveryService {
  private readonly logger = new Logger(HostDiscoveryService.name);

  private static readonly PROBE_PORTS = [80, 443, 22];

  async discoverHosts(
    subnetBase: string,
    cidr: number,
    options: DiscoveryOptions,
  ): Promise<HostResult[]> {
    const ips = this.calculateIpRange(subnetBase, cidr);
    this.logger.log(
      `Starting host discovery on ${subnetBase}/${cidr} (${ips.length} addresses, concurrency=${options.concurrency})`,
    );

    const results: HostResult[] = [];
    const chunks = this.chunk(ips, options.concurrency);

    for (const batch of chunks) {
      const batchResults = await Promise.all(
        batch.map((ip) => this.probeHost(ip, options.timeout)),
      );
      results.push(...batchResults);
    }

    const alive = results.filter((r) => r.isAlive);
    this.logger.log(
      `Host discovery complete: ${alive.length}/${ips.length} hosts alive`,
    );

    return results;
  }

  async probeHost(ip: string, timeout: number): Promise<HostResult> {
    for (const port of HostDiscoveryService.PROBE_PORTS) {
      const result = await this.tcpProbe(ip, port, timeout);
      if (result.open) {
        return {
          ip,
          latency: result.latency,
          isAlive: true,
          respondedOnPort: port,
        };
      }
    }

    return { ip, latency: null, isAlive: false };
  }

  calculateIpRange(ip: string, cidr: number): string[] {
    const ipNum = this.ipToNumber(ip);
    const maskBits = 32 - cidr;
    const hostCount = Math.pow(2, maskBits);
    const networkAddr = (ipNum >>> 0) & (~((1 << maskBits) - 1) >>> 0);

    // Limit to max 254 addresses (typical /24)
    const maxHosts = Math.min(hostCount - 2, 254);
    if (maxHosts <= 0) {
      return [ip];
    }

    const addresses: string[] = [];
    // Skip network address (first) and broadcast address (last)
    for (let i = 1; i <= maxHosts; i++) {
      addresses.push(this.numberToIp((networkAddr + i) >>> 0));
    }

    return addresses;
  }

  private tcpProbe(
    ip: string,
    port: number,
    timeout: number,
  ): Promise<{ open: boolean; latency: number | null }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const socket = new net.Socket();

      const cleanup = () => {
        socket.removeAllListeners();
        socket.destroy();
      };

      socket.setTimeout(timeout);

      socket.on('connect', () => {
        const latency = Date.now() - start;
        cleanup();
        resolve({ open: true, latency });
      });

      socket.on('timeout', () => {
        cleanup();
        resolve({ open: false, latency: null });
      });

      socket.on('error', () => {
        cleanup();
        resolve({ open: false, latency: null });
      });

      socket.connect(port, ip);
    });
  }

  private ipToNumber(ip: string): number {
    const parts = ip.split('.').map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  private numberToIp(num: number): string {
    return [
      (num >>> 24) & 0xff,
      (num >>> 16) & 0xff,
      (num >>> 8) & 0xff,
      num & 0xff,
    ].join('.');
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
