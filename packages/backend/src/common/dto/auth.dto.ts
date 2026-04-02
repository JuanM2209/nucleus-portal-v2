import { z } from 'zod';

export const LoginDto = z.object({
  email: z.string().email('Invalid email format'),
  password: z.string().min(1, 'Password is required').max(128, 'Password too long'),
  tenantId: z.string().uuid().optional(),
});

export const RefreshTokenDto = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

export type LoginDtoType = z.infer<typeof LoginDto>;
export type RefreshTokenDtoType = z.infer<typeof RefreshTokenDto>;
