export interface NetworkAdapter {
  id: string;
  name: string;
  macAddress: string | null;
  ipAddress: string | null;
  subnetMask: string | null;
  gateway: string | null;
  mode: 'static' | 'dhcp' | 'both' | null;
  isUp: boolean;
  endpointCount: number;
}

export interface NetworkEndpoint {
  id: string;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  vendor: string | null;
  isActive: boolean;
  lastSeenAt: string;
  services: NetworkService[];
}

export interface NetworkService {
  id: string;
  port: number;
  protocol: 'tcp' | 'udp';
  serviceName: string | null;
  tunnelType: 'browser' | 'local' | null;
}
