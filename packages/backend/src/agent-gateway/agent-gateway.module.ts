import { Module, forwardRef } from '@nestjs/common';
import { AgentGateway } from './agent-gateway.gateway';
import { AgentRegistryService } from './agent-registry.service';
import { DevicesModule } from '../devices/devices.module';

@Module({
  imports: [forwardRef(() => DevicesModule)],
  providers: [AgentGateway, AgentRegistryService],
  exports: [AgentRegistryService],
})
export class AgentGatewayModule {}
