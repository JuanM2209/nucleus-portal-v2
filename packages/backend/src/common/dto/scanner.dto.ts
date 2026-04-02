import { z } from 'zod';

export const StartScanDto = z.object({
  scanType: z.enum(['quick', 'standard', 'deep']).default('quick'),
});

export type StartScanDtoType = z.infer<typeof StartScanDto>;
