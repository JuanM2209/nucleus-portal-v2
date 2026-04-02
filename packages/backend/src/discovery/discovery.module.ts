import { Module, forwardRef } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { EndpointHealthService } from './endpoint-health.service';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';

@Module({
  imports: [forwardRef(() => AgentGatewayModule)],
  controllers: [DiscoveryController],
  providers: [DiscoveryService, EndpointHealthService],
  exports: [DiscoveryService, EndpointHealthService],
})
export class DiscoveryModule {}
