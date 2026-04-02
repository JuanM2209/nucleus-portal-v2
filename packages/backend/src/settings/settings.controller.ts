import { Controller, Get, Patch, Param, Body, UseGuards, ParseUUIDPipe } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  UpdatePreferencesDto,
  UpdateOrgSettingsDto,
  UpdatePreferencesDtoType,
  UpdateOrgSettingsDtoType,
} from '../common/dto/settings.dto';

@Controller('settings')
@UseGuards(JwtAuthGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('preferences')
  async getPreferences(@CurrentUser('id') userId: string) {
    const prefs = await this.settingsService.getUserPreferences(userId);
    return successResponse(prefs);
  }

  @Patch('preferences')
  async updatePreferences(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(UpdatePreferencesDto)) body: UpdatePreferencesDtoType,
  ) {
    const prefs = await this.settingsService.updateUserPreferences(userId, body);
    return successResponse(prefs);
  }

  @Get('org/:orgId')
  async getOrgSettings(@Param('orgId', ParseUUIDPipe) orgId: string) {
    const settings = await this.settingsService.getOrgSettings(orgId);
    return successResponse(settings);
  }

  @Patch('org/:orgId')
  async updateOrgSettings(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(UpdateOrgSettingsDto)) body: UpdateOrgSettingsDtoType,
  ) {
    const settings = await this.settingsService.updateOrgSettings(orgId, body.settings);
    return successResponse(settings);
  }
}
