import { Controller, Post, Get, Delete, Param, Body, Query, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { TunnelsService } from './tunnels.service';
import { ExposureService } from './exposure.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse, errorResponse, paginatedResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateSessionDto,
  ExtendSessionDto,
  CreateSessionDtoType,
  ExtendSessionDtoType,
} from '../common/dto/tunnels.dto';

@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class TunnelsController {
  constructor(
    private readonly tunnelsService: TunnelsService,
    private readonly exposureService: ExposureService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: any,
    @Body(new ZodValidationPipe(CreateSessionDto)) body: CreateSessionDtoType,
  ) {
    try {
      const session = await this.tunnelsService.createSession(user, body);
      return successResponse(session);
    } catch (error: any) {
      return errorResponse(error.message);
    }
  }

  @Get()
  async list(@CurrentUser() user: any, @Query('history') history?: string) {
    const includeHistory = history === 'true' || history === '1';
    const sessions = await this.tunnelsService.listActiveSessions(user.tenantId, user.id, includeHistory);
    return successResponse(sessions);
  }

  /**
   * All active sessions across all users in the tenant.
   * Used by the Sessions page to show device-grouped active sessions.
   * MUST be defined before :id route to avoid NestJS matching "all" as a UUID param.
   */
  @Get('all')
  async listAll(@CurrentUser('tenantId') tenantId: string) {
    const sessions = await this.tunnelsService.listAllTenantSessions(tenantId);
    return successResponse(sessions);
  }

  /**
   * Full session history (audit trail) with user + device info.
   * Paginated, filterable by device, user, tunnelType, status.
   */
  @Get('history')
  async listHistory(
    @CurrentUser('tenantId') tenantId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('deviceId') deviceId?: string,
    @Query('userId') userId?: string,
    @Query('tunnelType') tunnelType?: string,
    @Query('status') status?: string,
  ) {
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? Math.min(parseInt(limit, 10), 100) : 50;
    const { data, total } = await this.tunnelsService.listSessionHistory(tenantId, {
      page: pageNum,
      limit: limitNum,
      deviceId: deviceId || undefined,
      userId: userId || undefined,
      tunnelType: tunnelType || undefined,
      status: status || undefined,
    });
    return paginatedResponse(data, total, pageNum, limitNum);
  }

  /**
   * Get active exposure for a device+port.
   * Used by frontend to determine whether to show "Join Session" vs "Open in Browser".
   * MUST be defined before :id route to avoid NestJS matching "exposure" as a UUID param.
   */
  @Get('exposure')
  async getExposure(
    @CurrentUser('tenantId') tenantId: string,
    @Query('deviceId') deviceId: string,
    @Query('port') port: string,
  ) {
    if (!deviceId || !port) {
      return errorResponse('deviceId and port are required');
    }
    const exposure = await this.exposureService.getActiveExposure(deviceId, parseInt(port, 10), tenantId);
    return successResponse(exposure);
  }

  @Get(':id')
  async get(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const session = await this.tunnelsService.findById(tenantId, id);
    if (!session) return errorResponse('Session not found');
    return successResponse(session);
  }

  @Post(':id/extend')
  async extend(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(ExtendSessionDto)) body: ExtendSessionDtoType,
  ) {
    const session = await this.tunnelsService.extendSession(tenantId, id, body.additionalMinutes);
    return successResponse(session);
  }

  @Delete(':id')
  async close(
    @CurrentUser('tenantId') tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.tunnelsService.closeSession(tenantId, id, 'user');
    return successResponse({ message: 'Session closed' });
  }
}
