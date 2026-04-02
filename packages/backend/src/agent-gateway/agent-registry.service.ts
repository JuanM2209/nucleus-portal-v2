import { Injectable } from '@nestjs/common';

@Injectable()
export class AgentRegistryService {
  private readonly socketToDevice = new Map<any, string>();
  private readonly deviceToSocket = new Map<string, any>();

  register(deviceId: string, socket: any) {
    this.deviceToSocket.set(deviceId, socket);
    this.socketToDevice.set(socket, deviceId);
  }

  unregister(deviceId: string) {
    const socket = this.deviceToSocket.get(deviceId);
    if (socket) {
      this.socketToDevice.delete(socket);
    }
    this.deviceToSocket.delete(deviceId);
  }

  getSocket(deviceId: string): any | undefined {
    return this.deviceToSocket.get(deviceId);
  }

  getDeviceIdBySocket(socket: any): string | undefined {
    return this.socketToDevice.get(socket);
  }

  isOnline(deviceId: string): boolean {
    return this.deviceToSocket.has(deviceId);
  }

  getConnectedCount(): number {
    return this.deviceToSocket.size;
  }

  getConnectedDeviceIds(): string[] {
    return Array.from(this.deviceToSocket.keys());
  }

  /**
   * Get the remote IP address of a connected agent.
   * Useful for resolving the real device IP when targetIp is localhost/127.0.0.1.
   */
  getAgentRemoteIp(deviceId: string): string | null {
    const socket = this.deviceToSocket.get(deviceId);
    if (!socket) return null;
    // WebSocket object → underlying TCP socket
    const raw = socket._socket || socket._ws?._socket;
    if (raw?.remoteAddress) {
      // Strip IPv6-mapped IPv4 prefix (::ffff:192.168.1.1 → 192.168.1.1)
      return raw.remoteAddress.replace(/^::ffff:/, '');
    }
    return null;
  }
}
