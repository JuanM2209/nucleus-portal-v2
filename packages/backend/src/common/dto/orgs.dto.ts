import { z } from 'zod';

export const CreateOrgDto = z.object({
  name: z.string().min(1).max(200),
  slug: z.string().min(1).max(100).regex(
    /^[a-z0-9-]+$/,
    'Slug must be lowercase alphanumeric with hyphens',
  ),
  description: z.string().max(1000).optional(),
  logoUrl: z.string().url().optional(),
  settings: z.record(z.unknown()).optional(),
});

export const UpdateOrgDto = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const AddOrgMemberDto = z.object({
  userId: z.string().uuid('Invalid user ID'),
  role: z.enum(['admin', 'member', 'viewer']).default('member'),
});

export const UpdateOrgMemberRoleDto = z.object({
  role: z.enum(['admin', 'member', 'viewer']),
});

export const AssignDeviceDto = z.object({
  deviceId: z.string().uuid('Invalid device ID'),
});

export type CreateOrgDtoType = z.infer<typeof CreateOrgDto>;
export type UpdateOrgDtoType = z.infer<typeof UpdateOrgDto>;
export type AddOrgMemberDtoType = z.infer<typeof AddOrgMemberDto>;
export type UpdateOrgMemberRoleDtoType = z.infer<typeof UpdateOrgMemberRoleDto>;
export type AssignDeviceDtoType = z.infer<typeof AssignDeviceDto>;
