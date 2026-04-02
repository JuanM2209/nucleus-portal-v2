import { z } from 'zod';
import { CreateSessionRequestSchema } from '@nucleus/shared';

// Re-export shared schema for session creation
export const CreateSessionDto = CreateSessionRequestSchema;

export const ExtendSessionDto = z.object({
  additionalMinutes: z.coerce.number().int().min(5).max(1440).default(60),
});

export type CreateSessionDtoType = z.infer<typeof CreateSessionDto>;
export type ExtendSessionDtoType = z.infer<typeof ExtendSessionDto>;
