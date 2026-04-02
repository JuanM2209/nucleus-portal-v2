import { Global, Module } from '@nestjs/common';
import { StreamBridgeService } from './stream-bridge.service';
import { CommsRelayService } from './comms-relay.service';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';

@Global()
@Module({
  imports: [AgentGatewayModule],
  providers: [StreamBridgeService, CommsRelayService],
  exports: [StreamBridgeService, CommsRelayService],
})
export class StreamBridgeModule {}
