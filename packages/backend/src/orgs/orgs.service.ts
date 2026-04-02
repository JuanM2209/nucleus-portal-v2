import { Injectable, Inject, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { organizations, orgDevices, orgUsers, devices, users } from '../database/schema';
import { eq, and, sql, desc } from 'drizzle-orm';

@Injectable()
export class OrgsService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async listForUser(userId: string) {
    const rows = await this.db
      .select({
        org: organizations,
        role: orgUsers.role,
      })
      .from(orgUsers)
      .innerJoin(organizations, eq(orgUsers.orgId, organizations.id))
      .where(and(eq(orgUsers.userId, userId), eq(orgUsers.isActive, true), eq(organizations.isActive, true)));

    return rows.map((row: any) => ({
      ...row.org,
      userRole: row.role,
    }));
  }

  async create(data: { name: string; slug: string; description?: string; logoUrl?: string; settings?: any }, createdByUserId: string) {
    // Check if slug already exists
    const [existing] = await this.db
      .select({ id: organizations.id, isActive: organizations.isActive })
      .from(organizations)
      .where(eq(organizations.slug, data.slug))
      .limit(1);

    if (existing && !existing.isActive) {
      // Clean up old deactivated org so slug can be reused
      await this.db.delete(orgDevices).where(eq(orgDevices.orgId, existing.id));
      await this.db.delete(orgUsers).where(eq(orgUsers.orgId, existing.id));
      await this.db.delete(organizations).where(eq(organizations.id, existing.id));
    } else if (existing) {
      throw new ConflictException(
        `Organization with slug "${data.slug}" already exists. Choose a different name.`,
      );
    }

    const [org] = await this.db
      .insert(organizations)
      .values({
        name: data.name,
        slug: data.slug,
        description: data.description ?? null,
        logoUrl: data.logoUrl ?? null,
        settings: data.settings ?? {},
      })
      .returning();

    // Add the creator as admin of the new org
    await this.db
      .insert(orgUsers)
      .values({
        orgId: org.id,
        userId: createdByUserId,
        role: 'admin',
      });

    return org;
  }

  async findById(orgId: string) {
    const [org] = await this.db
      .select()
      .from(organizations)
      .where(and(eq(organizations.id, orgId), eq(organizations.isActive, true)))
      .limit(1);

    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async update(orgId: string, data: { name?: string; description?: string; settings?: any }) {
    const updateData: any = { updatedAt: new Date() };
    if (data.name !== undefined) updateData.name = data.name;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.settings !== undefined) updateData.settings = data.settings;

    const [org] = await this.db
      .update(organizations)
      .set(updateData)
      .where(and(eq(organizations.id, orgId), eq(organizations.isActive, true)))
      .returning();

    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async deactivate(orgId: string) {
    // Remove all device and user associations first
    await this.db.delete(orgDevices).where(eq(orgDevices.orgId, orgId));
    await this.db.delete(orgUsers).where(eq(orgUsers.orgId, orgId));

    // Hard delete the org so the slug is freed up
    const [org] = await this.db
      .delete(organizations)
      .where(eq(organizations.id, orgId))
      .returning();

    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  // ── Org Devices ──

  async listDevices(orgId: string) {
    const rows = await this.db
      .select({
        device: devices,
        assignedAt: orgDevices.assignedAt,
        assignedBy: orgDevices.assignedBy,
      })
      .from(orgDevices)
      .innerJoin(devices, eq(orgDevices.deviceId, devices.id))
      .where(eq(orgDevices.orgId, orgId));

    return rows.map((row: any) => ({
      ...row.device,
      assignedAt: row.assignedAt,
      assignedBy: row.assignedBy,
    }));
  }

  async assignDevice(orgId: string, deviceId: string, assignedBy: string) {
    const [row] = await this.db
      .insert(orgDevices)
      .values({ orgId, deviceId, assignedBy })
      .onConflictDoNothing()
      .returning();

    return row ?? { orgId, deviceId, message: 'Device already assigned' };
  }

  async removeDevice(orgId: string, deviceId: string) {
    const result = await this.db
      .delete(orgDevices)
      .where(and(eq(orgDevices.orgId, orgId), eq(orgDevices.deviceId, deviceId)));

    if (!result.rowCount) throw new NotFoundException('Device not assigned to this organization');
  }

  // ── Org Users ──

  async listUsers(orgId: string) {
    const rows = await this.db
      .select({
        user: {
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          isActive: users.isActive,
        },
        role: orgUsers.role,
        joinedAt: orgUsers.joinedAt,
        memberActive: orgUsers.isActive,
      })
      .from(orgUsers)
      .innerJoin(users, eq(orgUsers.userId, users.id))
      .where(eq(orgUsers.orgId, orgId));

    return rows.map((row: any) => ({
      ...row.user,
      role: row.role,
      joinedAt: row.joinedAt,
      memberActive: row.memberActive,
    }));
  }

  async addUser(orgId: string, userId: string, role: string) {
    const [row] = await this.db
      .insert(orgUsers)
      .values({ orgId, userId, role })
      .onConflictDoNothing()
      .returning();

    return row ?? { orgId, userId, message: 'User already in organization' };
  }

  async updateUserRole(orgId: string, userId: string, role: string) {
    const [row] = await this.db
      .update(orgUsers)
      .set({ role })
      .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.userId, userId)))
      .returning();

    if (!row) throw new NotFoundException('User not found in this organization');
    return row;
  }

  async removeUser(orgId: string, userId: string) {
    const result = await this.db
      .delete(orgUsers)
      .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.userId, userId)));

    if (!result.rowCount) throw new NotFoundException('User not found in this organization');
  }

  // ── Helpers ──

  async isUserAdmin(userId: string, roles: string[]): Promise<boolean> {
    return roles.includes('admin') || roles.includes('super_admin');
  }

  async isOrgMember(orgId: string, userId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ orgId: orgUsers.orgId })
      .from(orgUsers)
      .where(and(eq(orgUsers.orgId, orgId), eq(orgUsers.userId, userId), eq(orgUsers.isActive, true)))
      .limit(1);

    return !!row;
  }
}
