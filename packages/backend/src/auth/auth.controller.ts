import { Controller, Post, Get, Body, HttpCode, HttpStatus, UseGuards, Param } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse, errorResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  LoginDto,
  RefreshTokenDto,
  RegisterUserDto,
  InviteUserDto,
  AcceptInviteDto,
  LoginDtoType,
  RefreshTokenDtoType,
  RegisterUserDtoType,
  InviteUserDtoType,
  AcceptInviteDtoType,
} from '../common/dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async login(@Body(new ZodValidationPipe(LoginDto)) body: LoginDtoType) {
    try {
      const result = await this.authService.login(body.email, body.password, body.tenantId);
      return successResponse(result);
    } catch (error: any) {
      return errorResponse(error.message || 'Login failed');
    }
  }

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async register(
    @CurrentUser('tenantId') tenantId: string,
    @Body(new ZodValidationPipe(RegisterUserDto)) body: RegisterUserDtoType,
  ) {
    try {
      const result = await this.authService.registerUser(
        tenantId,
        body.email,
        body.password,
        body.displayName,
        body.role,
      );
      return successResponse(result);
    } catch (error: any) {
      return errorResponse(error.message || 'Registration failed');
    }
  }

  // ── Invitations ──

  @Post('invite')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(JwtAuthGuard)
  async invite(
    @CurrentUser('tenantId') tenantId: string,
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(InviteUserDto)) body: InviteUserDtoType,
  ) {
    try {
      const result = await this.authService.createInvitation(
        tenantId,
        userId,
        body.email,
        body.role,
      );
      return successResponse(result);
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to create invitation');
    }
  }

  @Post('accept-invite')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  async acceptInvite(
    @Body(new ZodValidationPipe(AcceptInviteDto)) body: AcceptInviteDtoType,
  ) {
    try {
      const result = await this.authService.acceptInvitation(
        body.token,
        body.displayName,
        body.password,
      );
      return successResponse(result);
    } catch (error: any) {
      return errorResponse(error.message || 'Failed to accept invitation');
    }
  }

  @Get('invite/:token')
  async getInviteInfo(@Param('token') token: string) {
    try {
      const result = await this.authService.getInvitationByToken(token);
      return successResponse(result);
    } catch (error: any) {
      return errorResponse(error.message || 'Invitation not found');
    }
  }

  @Get('invitations')
  @UseGuards(JwtAuthGuard)
  async listInvitations(@CurrentUser('tenantId') tenantId: string) {
    const result = await this.authService.getPendingInvitations(tenantId);
    return successResponse(result);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  async refresh(@Body(new ZodValidationPipe(RefreshTokenDto)) body: RefreshTokenDtoType) {
    try {
      const result = await this.authService.refreshTokens(body.refreshToken);
      return successResponse(result);
    } catch (error: any) {
      return errorResponse(error.message || 'Token refresh failed');
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  async logout(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(RefreshTokenDto)) body: RefreshTokenDtoType,
  ) {
    await this.authService.revokeRefreshTokenForUser(userId, body.refreshToken);
    return successResponse({ message: 'Logged out' });
  }
}
