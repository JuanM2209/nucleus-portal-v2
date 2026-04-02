export interface DeviceSummary {
  id: string;
  serialNumber: string;
  name: string | null;
  status: 'online' | 'offline' | 'degraded';
  lastSeenAt: string | null;
  tags: string[];
}

export interface DeviceHealth {
  cpu: number;
  mem: number;
  memTotal: number;
  disk: number;
  diskTotal: number;
  uptime: number;
  agentVersion: string;
  activeTunnels: number;
  lastHeartbeat: string;
}
