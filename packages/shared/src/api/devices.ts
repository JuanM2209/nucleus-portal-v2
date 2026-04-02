import { z } from 'zod';

export const DeviceStatusSchema = z.enum(['online', 'offline', 'degraded']);
export type DeviceStatus = z.infer<typeof DeviceStatusSchema>;

export const DeviceSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  serialNumber: z.string(),
  name: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  agentVersion: z.string().nullable(),
  status: DeviceStatusSchema,
  lastSeenAt: z.string().datetime().nullable(),
  metadata: z.record(z.unknown()),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Device = z.infer<typeof DeviceSchema>;

export const DeviceListQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  status: DeviceStatusSchema.optional(),
  search: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sortBy: z.enum(['name', 'serialNumber', 'status', 'lastSeenAt', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
export type DeviceListQuery = z.infer<typeof DeviceListQuerySchema>;

export const UpdateDeviceSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type UpdateDevice = z.infer<typeof UpdateDeviceSchema>;
