import { Module } from '@nestjs/common';
import { TunnelsController } from './tunnels.controller';
import { TunnelsService } from './tunnels.service';
import { TunnelProxyService } from './tunnel-proxy.service';
import { ExposureService } from './exposure.service';
import { CommsRelayService } from './comms-relay.service';
import { SessionCleanupService } from './session-cleanup.service';
import { PortAllocationService } from './port-allocation.service';
import { ChiselConfigService } from './chisel-config.service';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';
import { AuditModule } from '../audit/audit.module';
import { LogsModule } from '../logs/logs.module';

@Module({
  imports: [AgentGatewayModule, AuditModule, LogsModule],
  controllers: [TunnelsController],
  providers: [
    TunnelsService,
    TunnelProxyService,
    ExposureService,
    SessionCleanupService,
    PortAllocationService,
    ChiselConfigService,
  ],
  exports: [TunnelsService, TunnelProxyService, ExposureService, PortAllocationService, ChiselConfigService],
})
export class TunnelsModule {}
