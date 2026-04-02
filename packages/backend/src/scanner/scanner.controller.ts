import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  UseGuards,
  NotFoundException,
  ParseUUIDPipe,
} from '@nestjs/common';
import { ScannerService } from './scanner.service';
import { HealthCheckService } from './health-check.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { StartScanDto, StartScanDtoType } from '../common/dto/scanner.dto';

@Controller()
@UseGuards(JwtAuthGuard)
export class ScannerController {
  constructor(
    private readonly scannerService: ScannerService,
    private readonly healthCheckService: HealthCheckService,
  ) {}

  @Post('devices/:deviceId/adapters/:adapterId/scan')
  async startScan(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Param('adapterId', ParseUUIDPipe) adapterId: string,
    @Body(new ZodValidationPipe(StartScanDto)) body: StartScanDtoType,
  ) {
    const job = await this.scannerService.startScan(
      tenantId,
      deviceId,
      adapterId,
      body.scanType,
    );

    return successResponse({
      scanId: job.id,
      status: job.status,
      scanType: job.scanType,
      startedAt: job.startedAt.toISOString(),
    });
  }

  @Get('scans/:scanId')
  async getScanStatus(
    @CurrentUser('tenantId') tenantId: string,
    @Param('scanId') scanId: string,
  ) {
    const job = this.scannerService.getScanStatus(scanId);
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException(`Scan ${scanId} not found`);
    }

    return successResponse({
      scanId: job.id,
      deviceId: job.deviceId,
      adapterId: job.adapterId,
      scanType: job.scanType,
      status: job.status,
      progress: job.progress,
      hostsScanned: job.hostsScanned,
      hostsFound: job.hostsFound,
      portsFound: job.portsFound,
      startedAt: job.startedAt.toISOString(),
      completedAt: job.completedAt?.toISOString() ?? null,
      error: job.error ?? null,
    });
  }

  @Get('scans/:scanId/results')
  async getScanResults(
    @CurrentUser('tenantId') tenantId: string,
    @Param('scanId') scanId: string,
  ) {
    const job = this.scannerService.getScanResults(scanId);
    if (!job || job.tenantId !== tenantId) {
      throw new NotFoundException(`Scan ${scanId} not found`);
    }

    return successResponse({
      scanId: job.id,
      status: job.status,
      progress: job.progress,
      hostsFound: job.hostsFound,
      portsFound: job.portsFound,
      results: job.results,
    });
  }

  @Post('devices/:deviceId/health-check')
  async runHealthCheck(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const results = await this.healthCheckService.checkDeviceHealth(
      tenantId,
      deviceId,
    );

    return successResponse({
      deviceId,
      checkedAt: new Date().toISOString(),
      totalServices: results.length,
      alive: results.filter((r) => r.status === 'alive').length,
      degraded: results.filter((r) => r.status === 'degraded').length,
      unreachable: results.filter((r) => r.status === 'unreachable').length,
      results,
    });
  }

  @Get('devices/:deviceId/health')
  async getHealthStatus(
    @CurrentUser('tenantId') tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    const results = await this.healthCheckService.checkDeviceHealth(
      tenantId,
      deviceId,
    );

    return successResponse({
      deviceId,
      checkedAt: new Date().toISOString(),
      totalServices: results.length,
      alive: results.filter((r) => r.status === 'alive').length,
      degraded: results.filter((r) => r.status === 'degraded').length,
      unreachable: results.filter((r) => r.status === 'unreachable').length,
      results,
    });
  }
}
