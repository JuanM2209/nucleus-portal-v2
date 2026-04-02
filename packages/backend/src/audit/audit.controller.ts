import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { paginatedResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuditQueryDto, AuditQueryDtoType } from '../common/dto/audit.dto';

@Controller('audit')
@UseGuards(JwtAuthGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  async list(
    @CurrentUser('tenantId') tenantId: string,
    @Query(new ZodValidationPipe(AuditQueryDto)) query: AuditQueryDtoType,
  ) {
    const { data, total } = await this.auditService.list(tenantId, query);
    return paginatedResponse(data, total, query.page, query.limit);
  }
}
