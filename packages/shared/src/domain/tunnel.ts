export interface TunnelSession {
  id: string;
  deviceId: string;
  deviceName: string | null;
  targetIp: string;
  targetPort: number;
  tunnelType: 'browser' | 'local';
  status: 'pending' | 'active' | 'closed' | 'expired' | 'error';
  proxyUrl: string | null;
  localPort: number | null;
  openedAt: string | null;
  expiresAt: string;
  bytesTx: number;
  bytesRx: number;
}
