import { Module, forwardRef } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';

@Module({
  imports: [forwardRef(() => AgentGatewayModule)],
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
