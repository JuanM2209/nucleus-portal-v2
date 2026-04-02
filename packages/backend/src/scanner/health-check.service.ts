import { Injectable, Inject, Logger } from '@nestjs/common';
import * as net from 'net';
import * as http from 'http';
import * as https from 'https';
import { DATABASE } from '../database/database.module';
import {
  devices,
  discoveredEndpoints,
  endpointServices,
} from '../database/schema';
import { eq, and } from 'drizzle-orm';

export interface HealthResult {
  ip: string;
  port: number;
  serviceName: string;
  tcpOpen: boolean;
  httpResponding: boolean;
  httpStatus: number | null;
  latency: number | null;
  status: 'alive' | 'degraded' | 'unreachable' | 'unstable';
  checkedAt: string;
  error: string | null;
}

const WEB_PORTS = [80, 81, 443, 1880, 8000, 8080, 8081, 8443, 8888, 9090];

@Injectable()
export class HealthCheckService {
  private readonly logger = new Logger(HealthCheckService.name);

  constructor(@Inject(DATABASE) private readonly db: any) {}

  async checkService(
    ip: string,
    port: number,
    serviceName: string,
  ): Promise<HealthResult> {
    const result: HealthResult = {
      ip,
      port,
      serviceName,
      tcpOpen: false,
      httpResponding: false,
      httpStatus: null,
      latency: null,
      status: 'unreachable',
      checkedAt: new Date().toISOString(),
      error: null,
    };

    try {
      // 1. TCP connect check
      const tcpResult = await this.tcpCheck(ip, port);
      result.tcpOpen = tcpResult.open;
      result.latency = tcpResult.latency;

      if (!result.tcpOpen) {
        result.status = 'unreachable';
        return result;
      }

      // 2. For web ports, HTTP check
      if (this.isWebPort(port)) {
        const httpResult = await this.httpCheck(ip, port);
        result.httpResponding = httpResult.responding;
        result.httpStatus = httpResult.status;
        result.latency = httpResult.latency ?? result.latency;

        if (httpResult.responding && httpResult.status !== null && httpResult.status < 500) {
          result.status = 'alive';
        } else if (httpResult.responding) {
          result.status = 'degraded';
        } else {
          result.status = 'degraded'; // TCP open but HTTP failed
        }
      } else {
        result.status = 'alive'; // TCP open for non-web service
      }
    } catch (err: any) {
      result.error = err.message ?? 'Unknown error';
      result.status = 'unreachable';
    }

    return result;
  }

  async checkDeviceHealth(
    tenantId: string,
    deviceId: string,
  ): Promise<HealthResult[]> {
    // Get the device's access IP
    const [device] = await this.db
      .select()
      .from(devices)
      .where(and(eq(devices.id, deviceId), eq(devices.tenantId, tenantId)))
      .limit(1);

    if (!device) {
      this.logger.warn(`Device ${deviceId} not found for tenant ${tenantId}`);
      return [];
    }

    // Get all endpoints and their services for this device
    const endpointRows = await this.db
      .select()
      .from(discoveredEndpoints)
      .where(eq(discoveredEndpoints.deviceId, deviceId));

    if (endpointRows.length === 0) {
      this.logger.log(`No endpoints found for device ${deviceId}`);
      return [];
    }

    const results: HealthResult[] = [];

    for (const endpoint of endpointRows) {
      const services = await this.db
        .select()
        .from(endpointServices)
        .where(eq(endpointServices.endpointId, endpoint.id));

      for (const svc of services) {
        const healthResult = await this.checkService(
          endpoint.ipAddress,
          svc.port,
          svc.serviceName ?? `TCP/${svc.port}`,
        );
        results.push(healthResult);
      }
    }

    this.logger.log(
      `Health check for device ${deviceId}: ${results.filter((r) => r.status === 'alive').length}/${results.length} alive`,
    );

    return results;
  }

  private isWebPort(port: number): boolean {
    return WEB_PORTS.includes(port);
  }

  private tcpCheck(
    ip: string,
    port: number,
    timeout: number = 3000,
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

  private httpCheck(
    ip: string,
    port: number,
    timeout: number = 5000,
  ): Promise<{ responding: boolean; status: number | null; latency: number | null }> {
    return new Promise((resolve) => {
      const start = Date.now();
      const isHttps = [443, 8443].includes(port);
      const lib = isHttps ? https : http;

      const options: http.RequestOptions = {
        hostname: ip,
        port,
        path: '/',
        method: 'GET',
        timeout,
        headers: { 'User-Agent': 'NucleusScanner/1.0' },
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      };

      const req = lib.request(options, (res) => {
        const latency = Date.now() - start;
        const status = res.statusCode ?? null;
        res.destroy();
        resolve({ responding: true, status, latency });
      });

      req.on('timeout', () => {
        req.destroy();
        resolve({ responding: false, status: null, latency: null });
      });

      req.on('error', () => {
        resolve({ responding: false, status: null, latency: null });
      });

      req.end();
    });
  }
}
