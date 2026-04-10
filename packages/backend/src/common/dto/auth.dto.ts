import { z } from 'zod';

export const LoginDto = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required').max(128, 'Password too long'),
  tenantId: z.string().uuid().optional(),
});

export const RefreshTokenDto = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export const RegisterUserDto = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128, 'Password too long'),
  displayName: z.string().max(255).optional(),
  role: z.enum(['admin', 'operator', 'viewer']).default('viewer'),
});

export const InviteUserDto = z.object({
  email: z.string().email('Invalid email format'),
  role: z.enum(['admin', 'operator', 'viewer']).default('viewer'),
});

export const AcceptInviteDto = z.object({
  token: z.string().min(1, 'Invitation token is required'),
  displayName: z.string().min(1, 'Display name is required').max(255),
  password: z.string().min(6, 'Password must be at least 6 characters').max(128, 'Password too long'),
});

export type LoginDtoType = z.infer<typeof LoginDto>;
export type RefreshTokenDtoType = z.infer<typeof RefreshTokenDto>;
export type RegisterUserDtoType = z.infer<typeof RegisterUserDto>;
export type InviteUserDtoType = z.infer<typeof InviteUserDto>;
export type AcceptInviteDtoType = z.infer<typeof AcceptInviteDto>;
