import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe, ParseIntPipe } from '@nestjs/common';
import { DevicesService } from './devices.service';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import { PortAllocationService } from '../tunnels/port-allocation.service';
import { ChiselConfigService } from '../tunnels/chisel-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse, paginatedResponse, errorResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ListDevicesQuery,
  UpdateDeviceDto,
  ListDevicesQueryType,
  UpdateDeviceDtoType,
} from '../common/dto/devices.dto';
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter } from 'events';

@Controller('devices')
@UseGuards(JwtAuthGuard)
export class DevicesController implements OnModuleDestroy {
  private readonly logger = new Logger(DevicesController.name);
  private readonly bridgeEvents = new EventEmitter();
  private readonly mbusdListener: (...args: any[]) => void;

  constructor(
    private readonly devicesService: DevicesService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly portAllocation: PortAllocationService,
    private readonly chiselConfig: ChiselConfigService,
  ) {
    this.bridgeEvents.setMaxListeners(50);
    // Listen for mbusd responses from AgentGateway via process events
    this.mbusdListener = (deviceId: string, msgType: string, data: any) => {
      this.bridgeEvents.emit(`${msgType}:${deviceId}`, data);
    };
    process.on('mbusd_response' as any, this.mbusdListener);
  }

  onModuleDestroy() {
    process.removeListener('mbusd_response' as any, this.mbusdListener);
    this.bridgeEvents.removeAllListeners();
  }

  @Get()
  async list(
    @CurrentUser('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(ListDevicesQuery)) query: ListDevicesQueryType,
  ) {
    const { data, total } = await this.devicesService.list(tenantId, query);
    return paginatedResponse(data, total, query.page, query.limit);
  }

  @Get(':id')
  async get(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) {
      return errorResponse('Device not found');
    }
    return successResponse(device);
  }

  @Patch(':id')
  async update(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDeviceDto)) body: UpdateDeviceDtoType,
  ) {
    const device = await this.devicesService.update(tenantId, id, body);
    return successResponse(device);
  }

  // ── Modbus Bridge (mbusd) Control ──

  @Post(':id/bridge/start')
  async startBridge(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: { serialPort?: string; baudRate?: number; tcpPort?: number; parity?: string; dataBits?: number; stopBits?: number },
  ) {
    // Verify device belongs to tenant before sending commands
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const socket = this.agentRegistry.getSocket(id);
    if (!socket || socket.readyState !== 1) {
      return errorResponse('Agent is offline');
    }

    // Convert portal params to mbusd format
    const parity = (body.parity || 'none')[0]; // 'none'→'n', 'even'→'e', 'odd'→'o'
    const mode = `${body.dataBits || 8}${parity}${body.stopBits || 1}`; // e.g. "8n1"

    const msg = {
      type: 'mbusd_start',
      payload: {
        serial_port: body.serialPort || '/dev/ttymxc5',
        baud_rate: body.baudRate || 9600,
        mode,
        tcp_port: body.tcpPort || 2202,
        verbosity: 2,
      },
    };

    this.logger.log(`Starting mbusd on device ${id}: ${JSON.stringify(msg.payload)}`);
    socket.send(JSON.stringify(msg));

    // Wait for agent response — could be mbusd_started OR mbusd_error
    try {
      const result = await this.waitForMbusdStart(id, 10000);
      if (result.type === 'mbusd_error' || result.error) {
        return errorResponse(result.error || 'mbusd failed to start');
      }
      return successResponse(result);
    } catch {
      return errorResponse('Timeout waiting for mbusd to start');
    }
  }

  @Post(':id/bridge/stop')
  async stopBridge(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const socket = this.agentRegistry.getSocket(id);
    if (!socket || socket.readyState !== 1) {
      return errorResponse('Agent is offline');
    }

    this.logger.log(`Stopping mbusd on device ${id}`);
    socket.send(JSON.stringify({ type: 'mbusd_stop' }));

    try {
      await this.waitForAgentResponse(id, 'mbusd_stopped', 5000);
      return successResponse({ message: 'Bridge stopped' });
    } catch {
      return successResponse({ message: 'Stop command sent' });
    }
  }

  @Get(':id/bridge/status')
  async bridgeStatus(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const socket = this.agentRegistry.getSocket(id);
    if (!socket || socket.readyState !== 1) {
      return successResponse({ active: false, reason: 'agent_offline' });
    }

    socket.send(JSON.stringify({ type: 'mbusd_status' }));

    try {
      const result = await this.waitForAgentResponse(id, 'mbusd_status', 5000);
      return successResponse(result);
    } catch {
      return successResponse({ active: false, reason: 'timeout' });
    }
  }

  /**
   * Wait for a specific agent message type (used for bridge control responses).
   * The AgentGateway emits these events when it receives mbusd_* messages.
   */
  private waitForAgentResponse(deviceId: string, msgType: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const eventKey = `${msgType}:${deviceId}`;
      const handler = (data: any) => {
        clearTimeout(timer);
        resolve(data);
      };
      const timer = setTimeout(() => {
        this.bridgeEvents.removeListener(eventKey, handler);
        reject(new Error('Timeout'));
      }, timeoutMs);

      this.bridgeEvents.once(eventKey, handler);
    });
  }

  /**
   * Wait for mbusd_started OR mbusd_error — whichever arrives first.
   * The agent now verifies the process survives before responding,
   * so if mbusd crashes at startup we get mbusd_error with stderr details.
   */
  private waitForMbusdStart(deviceId: string, timeoutMs: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const startedKey = `mbusd_started:${deviceId}`;
      const errorKey = `mbusd_error:${deviceId}`;

      const cleanup = () => {
        clearTimeout(timer);
        this.bridgeEvents.removeListener(startedKey, onStarted);
        this.bridgeEvents.removeListener(errorKey, onError);
      };

      const onStarted = (data: any) => {
        cleanup();
        resolve(data);
      };
      const onError = (data: any) => {
        cleanup();
        resolve(data); // resolve (not reject) so controller can return the error message
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('Timeout'));
      }, timeoutMs);

      this.bridgeEvents.once(startedKey, onStarted);
      this.bridgeEvents.once(errorKey, onError);
    });
  }

  /** Called by AgentGateway when mbusd response arrives */
  handleMbusdResponse(deviceId: string, msgType: string, data: any): void {
    this.bridgeEvents.emit(`${msgType}:${deviceId}`, data);
  }

  @Get(':id/metrics')
  async getMetrics(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const metrics = await this.devicesService.getMetrics(tenantId, id);
    return successResponse(metrics);
  }

  /** Force agent to send fresh heartbeat + adapter data */
  @Post(':id/sync')
  async syncDevice(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const socket = this.agentRegistry.getSocket(id);
    if (!socket || socket.readyState !== 1) {
      return errorResponse('Agent is offline');
    }
    try {
      socket.send(JSON.stringify({ type: 'force_sync' }));
    } catch (err: any) {
      this.logger.error(`Failed to send sync to device ${id}: ${err.message}`);
      return errorResponse('Failed to send sync request');
    }
    return successResponse({ message: 'Sync requested' });
  }

  // ── Rathole Port Expose (V2 Transport) ──

  @Post(':id/ports/:port/expose')
  async exposePort(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('port', ParseIntPipe) port: number,
    @Body() body: { targetIp?: string },
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const socket = this.agentRegistry.getSocket(id);
    if (!socket || socket.readyState !== 1) {
      return errorResponse('Agent is offline');
    }

    // Allocate remote port
    const allocation = await this.portAllocation.allocatePort(id, port);

    // Add to rathole server config (hot-reload)
    this.chiselConfig.addService(allocation.serviceName, allocation.remotePort);

    // Send port_expose command to agent
    const targetIp = body.targetIp || '127.0.0.1';
    socket.send(JSON.stringify({
      type: 'port_expose',
      service_name: allocation.serviceName,
      local_addr: `${targetIp}:${port}`,
      remote_port: allocation.remotePort,
    }));

    const host = process.env.CHISEL_PUBLIC_HOST ?? process.env.PORTAL_URL?.replace('https://', '').replace('http://', '') ?? 'api.datadesng.com';

    this.logger.log(`Port exposed: device=${id} port=${port} → ${host}:${allocation.remotePort}`);
    return successResponse({
      serviceName: allocation.serviceName,
      remotePort: allocation.remotePort,
      host,
      address: `${host}:${allocation.remotePort}`,
    });
  }

  @Delete(':id/ports/:port/expose')
  async unexposePort(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('port', ParseIntPipe) port: number,
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const released = await this.portAllocation.releasePort(id, port);
    if (!released) return errorResponse('No active allocation for this port');

    // Remove from rathole server config
    this.chiselConfig.removeService(released.serviceName);

    // Send unexpose command to agent
    const socket = this.agentRegistry.getSocket(id);
    if (socket?.readyState === 1) {
      socket.send(JSON.stringify({
        type: 'port_unexpose',
        service_name: released.serviceName,
      }));
    }

    this.logger.log(`Port unexposed: device=${id} port=${port}`);
    return successResponse({ message: 'Port unexposed' });
  }

  @Get(':id/ports')
  async listExposedPorts(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const device = await this.devicesService.findById(tenantId, id);
    if (!device) return errorResponse('Device not found');

    const allocations = await this.portAllocation.getActiveAllocations(id);
    const host = process.env.CHISEL_PUBLIC_HOST ?? 'api.datadesng.com';

    return successResponse(
      allocations.map(a => ({
        ...a,
        host,
        address: `${host}:${a.remotePort}`,
      })),
    );
  }

  @Delete(':id')
  async remove(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.devicesService.remove(tenantId, id);
    return successResponse({ message: 'Device removed' });
  }
}
