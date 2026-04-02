import { z } from 'zod';

export const UpdatePreferencesDto = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  timezone: z.string().max(100).optional(),
  sessionDurationHours: z.number().int().min(1).max(24).optional(),
  notificationsEnabled: z.boolean().optional(),
});

export const UpdateOrgSettingsDto = z.object({
  settings: z.record(z.unknown()),
});

export type UpdatePreferencesDtoType = z.infer<typeof UpdatePreferencesDto>;
export type UpdateOrgSettingsDtoType = z.infer<typeof UpdateOrgSettingsDto>;
