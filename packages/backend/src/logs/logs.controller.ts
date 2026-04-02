import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { LogsService } from './logs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { successResponse, paginatedResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  LogsQueryDto,
  LogsStatsQueryDto,
  LogsQueryDtoType,
  LogsStatsQueryDtoType,
} from '../common/dto/logs.dto';

@Controller('logs')
@UseGuards(JwtAuthGuard)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(LogsQueryDto)) query: LogsQueryDtoType,
  ) {
    const { data, total } = await this.logsService.list(query);

    return paginatedResponse(data, total, query.page, query.limit);
  }

  @Get('stats')
  async stats(
    @Query(new ZodValidationPipe(LogsStatsQueryDto)) query: LogsStatsQueryDtoType,
  ) {
    const stats = await this.logsService.stats(query);
    return successResponse(stats);
  }
}
