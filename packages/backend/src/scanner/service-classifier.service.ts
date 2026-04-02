import { Injectable, Logger } from '@nestjs/common';
import * as http from 'http';
import * as https from 'https';

interface ServiceInfo {
  serviceName: string;
  serviceType: 'browser' | 'local';
  icon: string;
}

const KNOWN_SERVICES: Record<number, ServiceInfo> = {
  21: { serviceName: 'FTP', serviceType: 'local', icon: 'folder' },
  22: { serviceName: 'SSH', serviceType: 'local', icon: 'terminal' },
  23: { serviceName: 'Telnet', serviceType: 'local', icon: 'terminal' },
  25: { serviceName: 'SMTP', serviceType: 'local', icon: 'mail' },
  53: { serviceName: 'DNS', serviceType: 'local', icon: 'globe' },
  80: { serviceName: 'HTTP', serviceType: 'browser', icon: 'globe' },
  81: { serviceName: 'HTTP Alt', serviceType: 'browser', icon: 'globe' },
  110: { serviceName: 'POP3', serviceType: 'local', icon: 'mail' },
  143: { serviceName: 'IMAP', serviceType: 'local', icon: 'mail' },
  443: { serviceName: 'HTTPS', serviceType: 'browser', icon: 'lock' },
  502: { serviceName: 'Modbus TCP', serviceType: 'local', icon: 'cpu' },
  993: { serviceName: 'IMAPS', serviceType: 'local', icon: 'mail' },
  995: { serviceName: 'POP3S', serviceType: 'local', icon: 'mail' },
  1433: { serviceName: 'MSSQL', serviceType: 'local', icon: 'database' },
  1521: { serviceName: 'Oracle', serviceType: 'local', icon: 'database' },
  1880: { serviceName: 'Node-RED', serviceType: 'browser', icon: 'workflow' },
  2404: { serviceName: 'IEC 60870-5-104', serviceType: 'local', icon: 'zap' },
  3306: { serviceName: 'MySQL', serviceType: 'local', icon: 'database' },
  3389: { serviceName: 'RDP', serviceType: 'local', icon: 'monitor' },
  4840: { serviceName: 'OPC UA', serviceType: 'local', icon: 'server' },
  5020: { serviceName: 'Modbus Alt', serviceType: 'local', icon: 'cpu' },
  5432: { serviceName: 'PostgreSQL', serviceType: 'local', icon: 'database' },
  5900: { serviceName: 'VNC', serviceType: 'local', icon: 'monitor' },
  6379: { serviceName: 'Redis', serviceType: 'local', icon: 'database' },
  8000: { serviceName: 'HTTP Dev', serviceType: 'browser', icon: 'globe' },
  8080: { serviceName: 'HTTP Proxy', serviceType: 'browser', icon: 'globe' },
  8081: { serviceName: 'HTTP Alt', serviceType: 'browser', icon: 'globe' },
  8443: { serviceName: 'HTTPS Alt', serviceType: 'browser', icon: 'lock' },
  8888: { serviceName: 'HTTP Alt', serviceType: 'browser', icon: 'globe' },
  9090: { serviceName: 'Cockpit/Monitor', serviceType: 'browser', icon: 'activity' },
  10502: { serviceName: 'Modbus Gateway', serviceType: 'local', icon: 'cpu' },
  27017: { serviceName: 'MongoDB', serviceType: 'local', icon: 'database' },
  44818: { serviceName: 'EtherNet/IP', serviceType: 'local', icon: 'cpu' },
  47808: { serviceName: 'BACnet', serviceType: 'local', icon: 'building' },
};

@Injectable()
export class ServiceClassifierService {
  private readonly logger = new Logger(ServiceClassifierService.name);

  classify(port: number, banner?: string): ServiceInfo {
    const known = KNOWN_SERVICES[port];
    if (known) {
      return { ...known };
    }
    return { serviceName: `TCP/${port}`, serviceType: 'local', icon: 'network' };
  }

  isWebPort(port: number): boolean {
    return [80, 81, 443, 1880, 8000, 8080, 8081, 8443, 8888, 9090].includes(port);
  }

  async grabBanner(
    ip: string,
    port: number,
    timeout: number = 2000,
  ): Promise<string | null> {
    if (!this.isWebPort(port)) {
      return null;
    }

    const isHttps = [443, 8443].includes(port);
    const protocol = isHttps ? 'https' : 'http';
    const url = `${protocol}://${ip}:${port}/`;

    return new Promise((resolve) => {
      const lib = isHttps ? https : http;

      const options = {
        hostname: ip,
        port,
        path: '/',
        method: 'GET',
        timeout,
        headers: { 'User-Agent': 'NucleusScanner/1.0' },
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      };

      const req = lib.request(options, (res) => {
        const server = res.headers['server'] ?? null;
        const banner = server
          ? String(server)
          : `${res.statusCode} ${res.statusMessage ?? ''}`.trim();
        res.destroy();
        resolve(banner);
      });

      req.on('timeout', () => {
        req.destroy();
        resolve(null);
      });

      req.on('error', () => {
        resolve(null);
      });

      req.end();
    });
  }
}
