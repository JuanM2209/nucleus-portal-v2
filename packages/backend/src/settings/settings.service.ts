import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { userPreferences, organizations } from '../database/schema';
import { eq, and } from 'drizzle-orm';

@Injectable()
export class SettingsService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  // ── User Preferences ──

  async getUserPreferences(userId: string) {
    const [prefs] = await this.db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .limit(1);

    if (!prefs) {
      // Return defaults if no preferences row exists yet
      return {
        userId,
        theme: 'system',
        sessionDurationHours: 8,
        notificationsEnabled: true,
        timezone: 'UTC',
      };
    }

    return prefs;
  }

  async updateUserPreferences(
    userId: string,
    data: {
      theme?: string;
      sessionDurationHours?: number;
      notificationsEnabled?: boolean;
      timezone?: string;
    },
  ) {
    // Upsert: insert or update on conflict
    const values: any = { userId };
    if (data.theme !== undefined) values.theme = data.theme;
    if (data.sessionDurationHours !== undefined) values.sessionDurationHours = data.sessionDurationHours;
    if (data.notificationsEnabled !== undefined) values.notificationsEnabled = data.notificationsEnabled;
    if (data.timezone !== undefined) values.timezone = data.timezone;

    const [prefs] = await this.db
      .insert(userPreferences)
      .values(values)
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: data,
      })
      .returning();

    return prefs;
  }

  // ── Org Settings ──

  async getOrgSettings(orgId: string) {
    const [org] = await this.db
      .select({
        id: organizations.id,
        name: organizations.name,
        settings: organizations.settings,
      })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.isActive, true)))
      .limit(1);

    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async updateOrgSettings(orgId: string, settings: Record<string, any>) {
    const [org] = await this.db
      .select({ settings: organizations.settings })
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.isActive, true)))
      .limit(1);

    if (!org) throw new NotFoundException('Organization not found');

    const mergedSettings = { ...org.settings, ...settings };

    const [updated] = await this.db
      .update(organizations)
      .set({ settings: mergedSettings, updatedAt: new Date() })
      .where(eq(organizations.id, orgId))
      .returning();

    return { id: updated.id, name: updated.name, settings: updated.settings };
  }
}
