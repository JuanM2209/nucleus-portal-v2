import { z } from 'zod';

export const AuditActionSchema = z.enum([
  'session.open', 'session.close', 'session.expire', 'session.extend',
  'device.register', 'device.update', 'device.delete',
  'user.login', 'user.logout', 'user.create', 'user.update',
  'discovery.trigger', 'discovery.complete',
  'tenant.create', 'tenant.update',
  'role.create', 'role.update', 'role.delete',
]);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditEventSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  sessionId: z.string().uuid().nullable(),
  deviceId: z.string().uuid().nullable(),
  action: AuditActionSchema,
  resourceType: z.string(),
  resourceId: z.string().uuid().nullable(),
  details: z.record(z.unknown()),
  ipAddress: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: z.string().datetime(),
});
export type AuditEvent = z.infer<typeof AuditEventSchema>;

export const AuditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  action: AuditActionSchema.optional(),
  userId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
});
export type AuditQuery = z.infer<typeof AuditQuerySchema>;
