import { z } from 'zod';

export const TunnelTypeSchema = z.enum(['browser', 'local']);
export type TunnelType = z.infer<typeof TunnelTypeSchema>;

export const SessionStatusSchema = z.enum(['pending', 'active', 'closed', 'expired', 'error']);
export type SessionStatus = z.infer<typeof SessionStatusSchema>;

export const CreateSessionRequestSchema = z.object({
  deviceId: z.string().uuid(),
  targetIp: z.string().ip(),
  targetPort: z.number().int().min(1).max(65535),
  tunnelType: TunnelTypeSchema,
  durationMinutes: z.number().int().min(5).max(480).default(60),
});
export type CreateSessionRequest = z.infer<typeof CreateSessionRequestSchema>;

export const SessionSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid(),
  deviceId: z.string().uuid(),
  targetIp: z.string(),
  targetPort: z.number(),
  tunnelType: TunnelTypeSchema,
  status: SessionStatusSchema,
  proxyUrl: z.string().nullable(),
  localPort: z.number().nullable(),
  requestedAt: z.string().datetime(),
  openedAt: z.string().datetime().nullable(),
  closedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime(),
  closeReason: z.string().nullable(),
  bytesTx: z.number(),
  bytesRx: z.number(),
});
export type Session = z.infer<typeof SessionSchema>;

export const HelperConfigSchema = z.object({
  wsUrl: z.string().url(),
  sessionToken: z.string(),
  targetPort: z.number(),
});
export type HelperConfig = z.infer<typeof HelperConfigSchema>;

export const SessionCreatedResponseSchema = z.object({
  sessionId: z.string().uuid(),
  status: z.literal('pending'),
  tunnelType: TunnelTypeSchema,
  proxyUrl: z.string().nullable(),
  helperConfig: HelperConfigSchema.nullable(),
  expiresAt: z.string().datetime(),
});
export type SessionCreatedResponse = z.infer<typeof SessionCreatedResponseSchema>;
