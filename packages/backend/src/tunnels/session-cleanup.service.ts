import { Injectable, Inject, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { accessSessions, exposures, refreshTokens } from '../database/schema';
import { eq, and, lt, isNull, inArray, sql } from 'drizzle-orm';

/**
 * Periodic cleanup of expired sessions, exposures, and stale tokens.
 *
 * At scale (3000 devices, 200 users):
 * - Expired sessions accumulate if users don't close tabs
 * - Orphaned exposures hold bridge resources indefinitely
 * - Revoked/expired refresh tokens grow unbounded
 * - Old heartbeats consume disk (handled by TimescaleDB retention policy)
 *
 * Runs every 60 seconds. Each cleanup is idempotent and safe to run concurrently.
 */
@Injectable()
export class SessionCleanupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private intervalId: NodeJS.Timeout | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60_000; // 1 minute

  constructor(@Inject(DATABASE) private readonly db: any) {}

  onModuleInit() {
    this.logger.log('Session cleanup service started (interval: 60s)');
    // Run immediately on startup, then every interval
    this.runCleanup().catch(e => this.logger.error(`Initial cleanup failed: ${e.message}`));
    this.intervalId = setInterval(() => {
      this.runCleanup().catch(e => this.logger.error(`Cleanup cycle failed: ${e.message}`));
    }, this.CLEANUP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private async runCleanup(): Promise<void> {
    const now = new Date();

    // 1. Close expired active sessions
    const expiredSessions = await this.db
      .update(accessSessions)
      .set({
        status: 'closed',
        closedAt: now,
        closeReason: 'expired',
      })
      .where(
        and(
          eq(accessSessions.status, 'active'),
          lt(accessSessions.expiresAt, now),
        ),
      )
      .returning({ id: accessSessions.id, exposureId: accessSessions.exposureId });

    if (expiredSessions.length > 0) {
      this.logger.log(`Closed ${expiredSessions.length} expired session(s)`);

      // Decrement refCount for each exposure (batch by exposureId)
      const exposureIdSet = new Set<string>();
      for (const s of expiredSessions) {
        if ((s as any).exposureId) exposureIdSet.add((s as any).exposureId);
      }

      for (const eid of exposureIdSet) {
        const count = expiredSessions.filter((s: any) => s.exposureId === eid).length;
        await this.db
          .update(exposures)
          .set({ refCount: sql`GREATEST(${exposures.refCount} - ${count}, 0)` })
          .where(eq(exposures.id, eid));
      }
    }

    // 2. Close expired exposures (those past their expiresAt)
    const expiredExposures = await this.db
      .update(exposures)
      .set({
        status: 'closed',
        closedAt: now,
        closeReason: 'expired',
        refCount: 0,
      })
      .where(
        and(
          inArray(exposures.status, ['active', 'idle', 'pending']),
          lt(exposures.expiresAt, now),
        ),
      )
      .returning({ id: exposures.id });

    if (expiredExposures.length > 0) {
      this.logger.log(`Closed ${expiredExposures.length} expired exposure(s)`);
    }

    // 3. Close orphaned idle exposures (idle for > 10 minutes with refCount 0)
    const staleIdleThreshold = new Date(now.getTime() - 10 * 60 * 1000);
    const orphanedExposures = await this.db
      .update(exposures)
      .set({
        status: 'closed',
        closedAt: now,
        closeReason: 'idle_orphan',
        refCount: 0,
      })
      .where(
        and(
          eq(exposures.status, 'idle'),
          eq(exposures.refCount, 0),
          lt(exposures.idleAt, staleIdleThreshold),
        ),
      )
      .returning({ id: exposures.id });

    if (orphanedExposures.length > 0) {
      this.logger.log(`Closed ${orphanedExposures.length} orphaned idle exposure(s)`);
    }

    // 4. Purge expired & revoked refresh tokens (older than 30 days)
    const tokenCutoff = new Date(now.getTime() - 30 * 24 * 60 * 1000);
    const deletedTokens = await this.db
      .delete(refreshTokens)
      .where(lt(refreshTokens.expiresAt, tokenCutoff));

    if (deletedTokens.rowCount > 0) {
      this.logger.debug(`Purged ${deletedTokens.rowCount} expired refresh token(s)`);
    }
  }
}
