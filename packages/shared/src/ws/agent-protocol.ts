// ── Server → Agent Messages ──

export interface SessionOpenMessage {
  type: 'session.open';
  sessionId: string;
  targetIp: string;
  targetPort: number;
  streamId: number;
}

export interface SessionCloseMessage {
  type: 'session.close';
  sessionId: string;
}

export interface DiscoveryTriggerMessage {
  type: 'discovery.trigger';
  adapterId?: string;
  scanType: 'passive' | 'active' | 'full';
}

export interface PingMessage {
  type: 'ping';
}

export type ServerToAgentMessage =
  | SessionOpenMessage
  | SessionCloseMessage
  | DiscoveryTriggerMessage
  | PingMessage;

// ── Agent → Server Messages ──

export interface AdapterInfo {
  name: string;
  macAddress: string | null;
  ipAddress: string | null;
  subnetMask: string | null;
  gateway: string | null;
  mode: 'static' | 'dhcp' | 'both' | null;
  isUp: boolean;
}

export interface HeartbeatMessage {
  type: 'heartbeat';
  cpu: number;
  mem: number;
  memTotal: number;
  disk: number;
  diskTotal: number;
  uptime: number;
  agentVersion: string;
  activeTunnels: number;
  adapters: AdapterInfo[];
}

export interface SessionReadyMessage {
  type: 'session.ready';
  sessionId: string;
  streamId: number;
}

export interface SessionErrorMessage {
  type: 'session.error';
  sessionId: string;
  error: string;
}

export interface SessionClosedMessage {
  type: 'session.closed';
  sessionId: string;
  bytesTx: number;
  bytesRx: number;
}

export interface DiscoveredService {
  port: number;
  protocol: 'tcp' | 'udp';
  serviceName: string | null;
  serviceVersion: string | null;
  banner: string | null;
  tunnelType: 'browser' | 'local' | null;
}

export interface DiscoveredEndpointInfo {
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  services: DiscoveredService[];
}

export interface DiscoveryResultMessage {
  type: 'discovery.result';
  adapterId: string;
  adapterName: string;
  endpoints: DiscoveredEndpointInfo[];
}

export interface PongMessage {
  type: 'pong';
}

export type AgentToServerMessage =
  | HeartbeatMessage
  | SessionReadyMessage
  | SessionErrorMessage
  | SessionClosedMessage
  | DiscoveryResultMessage
  | PongMessage;

// ── Binary Frame Protocol ──
// Binary frames use a simple multiplexing protocol:
// [4 bytes: streamId (big-endian u32)] [4 bytes: length (big-endian u32)] [payload]
// Control frames (streamId = 0):
//   payload = JSON: { "cmd": "SYN", "streamId": N } | { "cmd": "FIN", "streamId": N } | { "cmd": "RST", "streamId": N }

export const CONTROL_STREAM_ID = 0;

export interface StreamSynCommand {
  cmd: 'SYN';
  streamId: number;
}

export interface StreamFinCommand {
  cmd: 'FIN';
  streamId: number;
}

export interface StreamRstCommand {
  cmd: 'RST';
  streamId: number;
}

export type StreamControlCommand = StreamSynCommand | StreamFinCommand | StreamRstCommand;
