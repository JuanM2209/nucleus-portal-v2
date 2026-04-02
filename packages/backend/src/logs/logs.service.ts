import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { activityLogs, users, devices, organizations, orgDevices } from '../database/schema';
import { eq, and, sql, desc, gte, lte, inArray } from 'drizzle-orm';

@Injectable()
export class LogsService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async list(query: {
    orgId?: string;
    userId?: string;
    deviceId?: string;
    action?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }) {
    const { page = 1, limit = 50, orgId, userId, deviceId, action, from, to } = query;
    const offset = (page - 1) * limit;

    const conditions: any[] = [];

    if (orgId) conditions.push(eq(activityLogs.orgId, orgId));
    if (userId) conditions.push(eq(activityLogs.userId, userId));
    if (deviceId) conditions.push(eq(activityLogs.deviceId, deviceId));
    if (action) conditions.push(eq(activityLogs.action, action));
    if (from) conditions.push(gte(activityLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(activityLogs.createdAt, new Date(to)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [data, countResult] = await Promise.all([
      this.db
        .select({
          id: activityLogs.id,
          action: activityLogs.action,
          resourceType: activityLogs.resourceType,
          resourceId: activityLogs.resourceId,
          details: activityLogs.details,
          ipAddress: activityLogs.ipAddress,
          createdAt: activityLogs.createdAt,
          userId: activityLogs.userId,
          deviceId: activityLogs.deviceId,
          orgId: activityLogs.orgId,
          userName: users.displayName,
          userEmail: users.email,
          deviceName: devices.name,
          deviceSerial: devices.serialNumber,
          orgName: organizations.name,
        })
        .from(activityLogs)
        .leftJoin(users, eq(activityLogs.userId, users.id))
        .leftJoin(devices, eq(activityLogs.deviceId, devices.id))
        .leftJoin(organizations, eq(activityLogs.orgId, organizations.id))
        .where(where)
        .orderBy(desc(activityLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(activityLogs)
        .where(where),
    ]);

    // Resolve device → organizations via org_devices (a device can belong to multiple orgs)
    const deviceIdSet = new Set<string>();
    for (const r of data) { if ((r as any).deviceId) deviceIdSet.add((r as any).deviceId); }
    const deviceIds = Array.from(deviceIdSet);
    let deviceOrgMap: Record<string, { id: string; name: string }[]> = {};

    if (deviceIds.length > 0) {
      const orgRows = await this.db
        .select({
          deviceId: orgDevices.deviceId,
          orgId: organizations.id,
          orgName: organizations.name,
        })
        .from(orgDevices)
        .innerJoin(organizations, and(
          eq(orgDevices.orgId, organizations.id),
          eq(organizations.isActive, true),
        ))
        .where(inArray(orgDevices.deviceId, deviceIds));

      for (const row of orgRows) {
        if (!deviceOrgMap[row.deviceId]) deviceOrgMap[row.deviceId] = [];
        deviceOrgMap[row.deviceId].push({ id: row.orgId, name: row.orgName });
      }
    }

    // Enrich each log entry with device organizations
    const enrichedData = data.map((row: any) => ({
      ...row,
      // Use org from org_devices if activity_logs.org_id is null
      orgName: row.orgName || null,
      deviceOrgs: row.deviceId ? (deviceOrgMap[row.deviceId] || []) : [],
    }));

    return { data: enrichedData, total: Number(countResult[0]?.count || 0) };
  }

  async stats(query: { orgId?: string; from?: string; to?: string }) {
    const { orgId, from, to } = query;

    const conditions: any[] = [];
    if (orgId) conditions.push(eq(activityLogs.orgId, orgId));
    if (from) conditions.push(gte(activityLogs.createdAt, new Date(from)));
    if (to) conditions.push(lte(activityLogs.createdAt, new Date(to)));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [actionsPerDay, topUsers, actionCounts] = await Promise.all([
      this.db
        .select({
          day: sql<string>`date_trunc('day', ${activityLogs.createdAt})::date`.as('day'),
          count: sql<number>`count(*)`.as('count'),
        })
        .from(activityLogs)
        .where(where)
        .groupBy(sql`date_trunc('day', ${activityLogs.createdAt})::date`)
        .orderBy(sql`date_trunc('day', ${activityLogs.createdAt})::date`),
      this.db
        .select({
          userId: activityLogs.userId,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(activityLogs)
        .where(where)
        .groupBy(activityLogs.userId)
        .orderBy(desc(sql`count(*)`))
        .limit(10),
      this.db
        .select({
          action: activityLogs.action,
          count: sql<number>`count(*)`.as('count'),
        })
        .from(activityLogs)
        .where(where)
        .groupBy(activityLogs.action)
        .orderBy(desc(sql`count(*)`)),
    ]);

    return {
      actionsPerDay: actionsPerDay.map((r: any) => ({ day: r.day, count: Number(r.count) })),
      topUsers: topUsers.map((r: any) => ({ userId: r.userId, count: Number(r.count) })),
      actionCounts: actionCounts.map((r: any) => ({ action: r.action, count: Number(r.count) })),
    };
  }

  async logActivity(params: {
    orgId?: string;
    userId?: string;
    deviceId?: string;
    action: string;
    resourceType?: string;
    resourceId?: string;
    details?: any;
    ipAddress?: string;
  }) {
    const [log] = await this.db
      .insert(activityLogs)
      .values({
        orgId: params.orgId ?? null,
        userId: params.userId ?? null,
        deviceId: params.deviceId ?? null,
        action: params.action,
        resourceType: params.resourceType ?? null,
        resourceId: params.resourceId ?? null,
        details: params.details ?? {},
        ipAddress: params.ipAddress ?? null,
      })
      .returning();

    return log;
  }
}
