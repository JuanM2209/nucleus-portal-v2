import { Controller, Post, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { successResponse, errorResponse } from '../common/types/api-response';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { LoginDto, RefreshTokenDto, LoginDtoType, RefreshTokenDtoType } from '../common/dto/auth.dto';

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
