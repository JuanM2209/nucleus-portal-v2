import {
  Controller, Get, Post, Patch, Delete,
  Param, Body, UseGuards, ForbiddenException, ParseUUIDPipe,
} from '@nestjs/common';
import { OrgsService } from './orgs.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateOrgDto,
  UpdateOrgDto,
  AddOrgMemberDto,
  UpdateOrgMemberRoleDto,
  AssignDeviceDto,
  CreateOrgDtoType,
  UpdateOrgDtoType,
  AddOrgMemberDtoType,
  UpdateOrgMemberRoleDtoType,
  AssignDeviceDtoType,
} from '../common/dto/orgs.dto';

@Controller('orgs')
@UseGuards(JwtAuthGuard)
export class OrgsController {
  constructor(private readonly orgsService: OrgsService) {}

  /** Verify the calling user is a member (or admin) of the target org */
  private async requireOrgMember(orgId: string, userId: string): Promise<void> {
    const isMember = await this.orgsService.isOrgMember(orgId, userId);
    if (!isMember) {
      throw new ForbiddenException('You are not a member of this organization');
    }
  }

  @Get()
  async list(@CurrentUser('id') userId: string) {
    const orgs = await this.orgsService.listForUser(userId);
    return successResponse(orgs);
  }

  @Post()
  async create(
    @CurrentUser() user: any,
    @Body(new ZodValidationPipe(CreateOrgDto)) body: CreateOrgDtoType,
  ) {
    if (!await this.orgsService.isUserAdmin(user.id, user.roles)) {
      throw new ForbiddenException('Only admins can create organizations');
    }
    const org = await this.orgsService.create(body, user.id);
    return successResponse(org);
  }

  @Get(':orgId')
  async get(
    @CurrentUser('id') userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    await this.requireOrgMember(orgId, userId);
    const org = await this.orgsService.findById(orgId);
    return successResponse(org);
  }

  @Patch(':orgId')
  async update(
    @CurrentUser('id') userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(UpdateOrgDto)) body: UpdateOrgDtoType,
  ) {
    await this.requireOrgMember(orgId, userId);
    const org = await this.orgsService.update(orgId, body);
    return successResponse(org);
  }

  @Delete(':orgId')
  async deactivate(
    @CurrentUser() user: any,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    // Only system admins can delete orgs
    if (!await this.orgsService.isUserAdmin(user.id, user.roles)) {
      throw new ForbiddenException('Only admins can delete organizations');
    }
    await this.orgsService.deactivate(orgId);
    return successResponse({ message: 'Organization deactivated' });
  }

  // ── Org Devices ──

  @Get(':orgId/devices')
  async listDevices(
    @CurrentUser('id') userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    await this.requireOrgMember(orgId, userId);
    const devices = await this.orgsService.listDevices(orgId);
    return successResponse(devices);
  }

  @Post(':orgId/devices')
  async assignDevice(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(AssignDeviceDto)) body: AssignDeviceDtoType,
  ) {
    await this.requireOrgMember(orgId, userId);
    const result = await this.orgsService.assignDevice(orgId, body.deviceId, userId);
    return successResponse(result);
  }

  @Delete(':orgId/devices/:deviceId')
  async removeDevice(
    @CurrentUser('id') userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
  ) {
    await this.requireOrgMember(orgId, userId);
    await this.orgsService.removeDevice(orgId, deviceId);
    return successResponse({ message: 'Device removed from organization' });
  }

  // ── Org Users ──

  @Get(':orgId/users')
  async listUsers(
    @CurrentUser('id') userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    await this.requireOrgMember(orgId, userId);
    const users = await this.orgsService.listUsers(orgId);
    return successResponse(users);
  }

  @Post(':orgId/users')
  async addUser(
    @CurrentUser('id') userId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(AddOrgMemberDto)) body: AddOrgMemberDtoType,
  ) {
    await this.requireOrgMember(orgId, userId);
    const result = await this.orgsService.addUser(orgId, body.userId, body.role);
    return successResponse(result);
  }

  @Patch(':orgId/users/:userId')
  async updateUserRole(
    @CurrentUser('id') callerId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(UpdateOrgMemberRoleDto)) body: UpdateOrgMemberRoleDtoType,
  ) {
    await this.requireOrgMember(orgId, callerId);
    const result = await this.orgsService.updateUserRole(orgId, userId, body.role);
    return successResponse(result);
  }

  @Delete(':orgId/users/:userId')
  async removeUser(
    @CurrentUser('id') callerId: string,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('userId', ParseUUIDPipe) userId: string,
  ) {
    await this.requireOrgMember(orgId, callerId);
    await this.orgsService.removeUser(orgId, userId);
    return successResponse({ message: 'User removed from organization' });
  }
}
