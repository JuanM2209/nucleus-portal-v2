import { Injectable, Logger } from '@nestjs/common';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import * as WebSocket from 'ws';

/**
 * Direct /comms WebSocket relay via agent's existing WebSocket connection.
 *
 * Architecture:
 *   Browser ←WS→ Backend ←AgentWS→ Agent ←WS→ Device Node-RED /comms
 *
 * This bypasses the TCP FIFO bridge entirely. The agent's WebSocket
 * (already used for heartbeats, session control, etc.) carries /comms
 * frames as JSON messages, providing true real-time bidirectional
 * communication without blocking HTTP requests.
 *
 * Protocol:
 *   Backend → Agent:  { type: "comms_open",  payload: { comms_id, target_url } }
 *   Agent → Backend:  { type: "comms_opened", payload: { comms_id } }
 *   Agent → Backend:  { type: "comms_frame", payload: { comms_id, data } }
 *   Backend → Agent:  { type: "comms_frame", payload: { comms_id, data } }
 *   Either → Other:   { type: "comms_close", payload: { comms_id } }
 *
 * Fallback: If the agent doesn't support comms_* messages, we detect this
 * when comms_opened never arrives and fall back to mock mode.
 */
@Injectable()
export class CommsRelayService {
  private readonly logger = new Logger(CommsRelayService.name);

  /** commsId → browser WebSocket */
  private readonly browserSockets = new Map<string, any>();

  /** deviceId → Set of active commsIds (for cleanup on disconnect) */
  private readonly deviceComms = new Map<string, Set<string>>();

  /** commsId → deviceId (reverse lookup) */
  private readonly commsToDevice = new Map<string, string>();

  /** commsId → fallback mock timer (cleared when real relay works) */
  private readonly mockTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly agentRegistry: AgentRegistryService) {}

  /**
   * Open a /comms relay between the browser and a device's Node-RED.
   * Returns true if the relay was started, false if agent is offline.
   */
  openRelay(
    commsId: string,
    deviceId: string,
    browserWs: any,
    targetPort: number,
  ): boolean {
    const agentSocket = this.agentRegistry.getSocket(deviceId);
    if (!agentSocket || agentSocket.readyState !== 1) {
      this.logger.warn(`/comms relay: agent offline for device ${deviceId}`);
      return false;
    }

    this.browserSockets.set(commsId, browserWs);
    this.commsToDevice.set(commsId, deviceId);

    const deviceSet = this.deviceComms.get(deviceId) || new Set();
    deviceSet.add(commsId);
    this.deviceComms.set(deviceId, deviceSet);

    // Send comms_open to agent
    const targetUrl = `ws://127.0.0.1:${targetPort}/comms`;
    try {
      agentSocket.send(JSON.stringify({
        type: 'comms_open',
        payload: { comms_id: commsId, target_url: targetUrl },
      }));
      this.logger.log(`/comms relay: sent comms_open to agent (${commsId} → ${targetUrl})`);
    } catch (e) {
      this.logger.error(`/comms relay: failed to send comms_open: ${e}`);
      this.cleanup(commsId);
      return false;
    }

    // Relay browser → agent
    browserWs.on('message', (data: WebSocket.Data) => {
      const agent = this.agentRegistry.getSocket(deviceId);
      if (agent?.readyState === 1) {
        const textData = typeof data === 'string' ? data : data.toString();
        agent.send(JSON.stringify({
          type: 'comms_frame',
          payload: { comms_id: commsId, data: textData },
        }));
      }
    });

    browserWs.on('close', () => {
      this.logger.log(`/comms relay: browser closed (${commsId})`);
      // Send close to agent
      const agent = this.agentRegistry.getSocket(deviceId);
      if (agent?.readyState === 1) {
        try {
          agent.send(JSON.stringify({
            type: 'comms_close',
            payload: { comms_id: commsId },
          }));
        } catch { /* best-effort */ }
      }
      this.cleanup(commsId);
    });

    browserWs.on('error', (err: Error) => {
      this.logger.error(`/comms relay: browser error (${commsId}): ${err.message}`);
      this.cleanup(commsId);
    });

    // Fallback: if agent doesn't support comms_* protocol, start mock after 5s
    const fallbackTimer = setTimeout(() => {
      if (this.browserSockets.has(commsId) && !this.mockTimers.has(`confirmed:${commsId}`)) {
        this.logger.warn(`/comms relay: no comms_opened from agent after 5s — starting mock for ${commsId}`);
        this.startMockMode(commsId, browserWs);
      }
    }, 5_000);
    this.mockTimers.set(commsId, fallbackTimer);

    return true;
  }

  /**
   * Handle incoming comms_* message from agent (called by AgentGateway).
   */
  handleAgentMessage(deviceId: string, msgType: string, msg: any): void {
    const payload = msg.payload || msg;
    const commsId = payload.comms_id || payload.commsId;

    if (!commsId) {
      this.logger.debug(`/comms relay: ${msgType} without comms_id from ${deviceId}`);
      return;
    }

    const browserWs = this.browserSockets.get(commsId);

    switch (msgType) {
      case 'comms_opened': {
        // Agent confirmed the /comms WebSocket is open — cancel fallback timer
        const timer = this.mockTimers.get(commsId);
        if (timer) {
          clearTimeout(timer);
          this.mockTimers.delete(commsId);
        }
        this.mockTimers.set(`confirmed:${commsId}`, undefined as any);
        this.logger.log(`/comms relay: confirmed (${commsId})`);
        break;
      }

      case 'comms_frame': {
        const data = payload.data;
        if (data && browserWs?.readyState === (WebSocket as any).OPEN) {
          browserWs.send(data);
        }
        break;
      }

      case 'comms_close':
      case 'comms_closed': {
        this.logger.log(`/comms relay: agent closed (${commsId})`);
        if (browserWs?.readyState === (WebSocket as any).OPEN) {
          browserWs.close(1000);
        }
        this.cleanup(commsId);
        break;
      }

      case 'comms_error': {
        const error = payload.error || 'unknown';
        this.logger.warn(`/comms relay: agent error (${commsId}): ${error}`);
        // Fall back to mock
        if (browserWs?.readyState === (WebSocket as any).OPEN) {
          this.startMockMode(commsId, browserWs);
        }
        break;
      }
    }
  }

  /** Clean up all relays for a device (called on agent disconnect) */
  cleanupDevice(deviceId: string): void {
    const commsIds = this.deviceComms.get(deviceId);
    if (!commsIds) return;
    for (const commsId of commsIds) {
      const browserWs = this.browserSockets.get(commsId);
      if (browserWs?.readyState === (WebSocket as any).OPEN) {
        browserWs.close(1001, 'Agent disconnected');
      }
      this.cleanup(commsId);
    }
    this.deviceComms.delete(deviceId);
  }

  /**
   * Check if a relay has been confirmed (comms_opened received from agent).
   */
  isRelayConfirmed(commsId: string): boolean {
    return this.mockTimers.has(`confirmed:${commsId}`);
  }

  /**
   * Broadcast a message to ALL active /comms browser WebSockets.
   * Used for deploy notifications that should reach every open editor.
   */
  broadcastToAll(data: string): void {
    let sent = 0;
    for (const [commsId, browserWs] of this.browserSockets) {
      if (browserWs?.readyState === (WebSocket as any).OPEN) {
        browserWs.send(data);
        sent++;
      }
    }
    if (sent > 0) {
      this.logger.log(`Broadcast to ${sent} active /comms relay(s)`);
    }
  }

  private cleanup(commsId: string): void {
    this.browserSockets.delete(commsId);
    const deviceId = this.commsToDevice.get(commsId);
    this.commsToDevice.delete(commsId);
    if (deviceId) {
      this.deviceComms.get(deviceId)?.delete(commsId);
    }
    const timer = this.mockTimers.get(commsId);
    if (timer) clearTimeout(timer);
    this.mockTimers.delete(commsId);
    this.mockTimers.delete(`confirmed:${commsId}`);
  }

  /**
   * Mock mode fallback: if the agent doesn't support comms_* protocol,
   * provide minimal /comms functionality (auth ok, heartbeats, runtime-state).
   */
  private startMockMode(commsId: string, browserWs: any): void {
    this.logger.log(`/comms mock mode started for ${commsId}`);

    const keepalive = setInterval(() => {
      if (browserWs.readyState === (WebSocket as any).OPEN) {
        browserWs.send(JSON.stringify([{ topic: 'hb', data: Date.now() }]));
      } else {
        clearInterval(keepalive);
      }
    }, 15_000);

    // Send initial runtime state
    if (browserWs.readyState === (WebSocket as any).OPEN) {
      browserWs.send(JSON.stringify({ auth: 'ok' }));
      setTimeout(() => {
        if (browserWs.readyState === (WebSocket as any).OPEN) {
          browserWs.send(JSON.stringify([{
            topic: 'notification/runtime-state',
            data: { state: 'start' },
          }]));
        }
      }, 200);
    }

    browserWs.on('close', () => clearInterval(keepalive));
  }
}
