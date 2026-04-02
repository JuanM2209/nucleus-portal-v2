import { z } from 'zod';
import { AuditQuerySchema } from '@nucleus/shared';

// Re-export shared schema for audit queries
export const AuditQueryDto = AuditQuerySchema;

export type AuditQueryDtoType = z.infer<typeof AuditQueryDto>;
