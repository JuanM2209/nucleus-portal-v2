import { Injectable, Logger } from '@nestjs/common';
import * as net from 'net';

export interface PortResult {
  port: number;
  protocol: string;
  isOpen: boolean;
  serviceName?: string;
  serviceType?: 'browser' | 'local';
  banner?: string;
  httpStatus?: number;
  latency?: number;
}

interface PortScanOptions {
  timeout: number;
  concurrency: number;
}

const PORT_PROFILES: Record<string, number[]> = {
  quick: [22, 80, 443, 502, 1880, 9090],
  standard: [
    21, 22, 23, 80, 81, 443, 502, 1880, 2404, 3389, 5900, 8080, 8443, 9090,
    44818,
  ],
  deep: [
    21, 22, 23, 25, 53, 80, 81, 110, 143, 443, 502, 993, 995, 1433, 1521,
    1880, 2404, 3306, 3389, 4840, 5020, 5432, 5900, 6379, 8000, 8080, 8081,
    8443, 8888, 9090, 10502, 27017, 44818, 47808,
  ],
};

@Injectable()
export class PortScannerService {
  private readonly logger = new Logger(PortScannerService.name);

  async scanPorts(
    ip: string,
    ports: number[],
    options: PortScanOptions,
  ): Promise<PortResult[]> {
    this.logger.log(
      `Scanning ${ports.length} ports on ${ip} (timeout=${options.timeout}ms, concurrency=${options.concurrency})`,
    );

    const results: PortResult[] = [];
    const chunks = this.chunk(ports, options.concurrency);

    for (const batch of chunks) {
      const batchResults = await Promise.all(
        batch.map((port) => this.probePort(ip, port, options.timeout)),
      );
      results.push(...batchResults);
    }

    const openPorts = results.filter((r) => r.isOpen);
    this.logger.log(
      `Port scan on ${ip}: ${openPorts.length}/${ports.length} open`,
    );

    return results;
  }

  getPortsForScanType(scanType: 'quick' | 'standard' | 'deep'): number[] {
    const ports = PORT_PROFILES[scanType] ?? PORT_PROFILES.quick;
    return [...new Set(ports)].sort((a, b) => a - b);
  }

  private probePort(
    ip: string,
    port: number,
    timeout: number,
  ): Promise<PortResult> {
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
        resolve({
          port,
          protocol: 'tcp',
          isOpen: true,
          latency,
        });
      });

      socket.on('timeout', () => {
        cleanup();
        resolve({
          port,
          protocol: 'tcp',
          isOpen: false,
        });
      });

      socket.on('error', () => {
        cleanup();
        resolve({
          port,
          protocol: 'tcp',
          isOpen: false,
        });
      });

      socket.connect(port, ip);
    });
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      chunks.push(arr.slice(i, i + size));
    }
    return chunks;
  }
}
