import { z } from 'zod';

export const LogsQueryDto = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  orgId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  deviceId: z.string().uuid().optional(),
  action: z.string().max(100).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export const LogsStatsQueryDto = z.object({
  orgId: z.string().uuid().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export type LogsQueryDtoType = z.infer<typeof LogsQueryDto>;
export type LogsStatsQueryDtoType = z.infer<typeof LogsStatsQueryDto>;
