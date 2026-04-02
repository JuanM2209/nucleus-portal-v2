import { Module, forwardRef } from '@nestjs/common';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';
import { HostDiscoveryService } from './host-discovery.service';
import { PortScannerService } from './port-scanner.service';
import { ServiceClassifierService } from './service-classifier.service';
import { HealthCheckService } from './health-check.service';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';

@Module({
  imports: [forwardRef(() => AgentGatewayModule)],
  controllers: [ScannerController],
  providers: [
    ScannerService,
    HostDiscoveryService,
    PortScannerService,
    ServiceClassifierService,
    HealthCheckService,
  ],
  exports: [ScannerService, HealthCheckService],
})
export class ScannerModule {}
