import { Injectable, Inject } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { auditEvents } from '../database/schema';
import { eq, and, desc, sql } from 'drizzle-orm';

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: any) {}

  async log(event: {
    tenantId: string;
    userId?: string;
    sessionId?: string;
    deviceId?: string;
    action: string;
    resourceType: string;
    resourceId?: string;
    details?: Record<string, unknown>;
    ipAddress?: string;
    userAgent?: string;
  }) {
    await this.db.insert(auditEvents).values(event);
  }

  async list(tenantId: string, query: any) {
    const { page = 1, limit = 20 } = query;
    const offset = (page - 1) * limit;

    const where = eq(auditEvents.tenantId, tenantId);

    const [data, countResult] = await Promise.all([
      this.db
        .select()
        .from(auditEvents)
        .where(where)
        .orderBy(desc(auditEvents.createdAt))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ count: sql<number>`count(*)` })
        .from(auditEvents)
        .where(where),
    ]);

    return { data, total: Number(countResult[0]?.count || 0) };
  }
}
