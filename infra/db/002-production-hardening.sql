-- ============================================================
-- PRODUCTION HARDENING MIGRATION
-- Date: 2026-03-31
-- Scale target: 3000 devices, 20 orgs, 200 users
-- ============================================================

-- ── 1. Missing indexes for proxy performance ──
-- Each proxy request does: SELECT WHERE proxy_path = ? AND status = 'active'
-- Without this index, it's a sequential scan on every HTTP request.
CREATE INDEX IF NOT EXISTS idx_sessions_proxy_path ON access_sessions(proxy_path);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON access_sessions(status);

-- Composite index for the most common proxy lookup pattern
CREATE INDEX IF NOT EXISTS idx_sessions_proxy_active
  ON access_sessions(proxy_path, status) WHERE status = 'active';

-- ── 2. Partial unique constraint on exposures ──
-- Prevents race condition (TOCTOU) where two concurrent requests create
-- duplicate exposures for the same device+port. Only enforced for active/idle/pending.
CREATE UNIQUE INDEX IF NOT EXISTS idx_exposures_device_port_active
  ON exposures(device_id, target_port)
  WHERE status IN ('active', 'idle', 'pending');

-- ── 3. Cascade deletes for referential integrity ──
-- Without cascades, deleting a device/user fails with FK violation errors.

-- access_sessions.device_id → ON DELETE CASCADE
ALTER TABLE access_sessions DROP CONSTRAINT IF EXISTS access_sessions_device_id_devices_id_fk;
ALTER TABLE access_sessions
  ADD CONSTRAINT access_sessions_device_id_devices_id_fk
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

-- access_sessions.user_id → ON DELETE CASCADE
ALTER TABLE access_sessions DROP CONSTRAINT IF EXISTS access_sessions_user_id_users_id_fk;
ALTER TABLE access_sessions
  ADD CONSTRAINT access_sessions_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

-- access_sessions.exposure_id → ON DELETE SET NULL (exposure may be cleaned up independently)
ALTER TABLE access_sessions DROP CONSTRAINT IF EXISTS access_sessions_exposure_id_exposures_id_fk;
ALTER TABLE access_sessions
  ADD CONSTRAINT access_sessions_exposure_id_exposures_id_fk
  FOREIGN KEY (exposure_id) REFERENCES exposures(id) ON DELETE SET NULL;

-- exposures.device_id → ON DELETE CASCADE
ALTER TABLE exposures DROP CONSTRAINT IF EXISTS exposures_device_id_devices_id_fk;
ALTER TABLE exposures
  ADD CONSTRAINT exposures_device_id_devices_id_fk
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE;

-- audit_events → SET NULL on user/device/session delete (preserve audit trail)
ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_user_id_users_id_fk;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_device_id_devices_id_fk;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_device_id_devices_id_fk
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

ALTER TABLE audit_events DROP CONSTRAINT IF EXISTS audit_events_session_id_access_sessions_id_fk;
ALTER TABLE audit_events
  ADD CONSTRAINT audit_events_session_id_access_sessions_id_fk
  FOREIGN KEY (session_id) REFERENCES access_sessions(id) ON DELETE SET NULL;

-- activity_logs → SET NULL on user/device/org delete
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_user_id_users_id_fk;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_user_id_users_id_fk
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_device_id_devices_id_fk;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_device_id_devices_id_fk
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE SET NULL;

ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_org_id_organizations_id_fk;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_org_id_organizations_id_fk
  FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE SET NULL;

-- ── 4. Heartbeat retention policy ──
-- 3000 devices × 1 heartbeat/30s = 100K rows/hour = 2.4M rows/day
-- Without cleanup, the table grows ~70M rows/month.

-- TimescaleDB hypertable (convert if extension available)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'timescaledb') THEN
    -- Only convert if not already a hypertable
    IF NOT EXISTS (
      SELECT 1 FROM timescaledb_information.hypertables
      WHERE hypertable_name = 'agent_heartbeats'
    ) THEN
      PERFORM create_hypertable('agent_heartbeats', 'created_at',
        migrate_data => true,
        chunk_time_interval => INTERVAL '1 day'
      );
      RAISE NOTICE 'agent_heartbeats converted to hypertable';
    END IF;

    -- Retention policy: keep 7 days of raw heartbeats
    -- For historical data, create a continuous aggregate (hourly averages)
    BEGIN
      PERFORM add_retention_policy('agent_heartbeats', INTERVAL '7 days', if_not_exists => true);
      RAISE NOTICE 'Retention policy set: 7 days';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Retention policy already exists or failed: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'TimescaleDB not available — skipping hypertable conversion. Manual cleanup required.';
  END IF;
END $$;

-- ── 5. Expired session cleanup index ──
-- The cleanup job needs to find expired active sessions efficiently.
CREATE INDEX IF NOT EXISTS idx_sessions_expires_active
  ON access_sessions(expires_at) WHERE status = 'active';

-- Expired exposure cleanup
CREATE INDEX IF NOT EXISTS idx_exposures_expires_active
  ON exposures(expires_at) WHERE status IN ('active', 'idle');

-- ── 6. Refresh token cleanup index ──
-- Finding non-revoked expired tokens for cleanup
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires
  ON refresh_tokens(expires_at) WHERE revoked_at IS NULL;

-- ── 7. Device tenant + status composite for list queries ──
-- The devices list page does: WHERE tenant_id = ? AND status = ? ORDER BY last_seen_at
CREATE INDEX IF NOT EXISTS idx_devices_tenant_status_seen
  ON devices(tenant_id, status, last_seen_at DESC);

-- ── 8. Scan jobs cleanup — old completed scans ──
CREATE INDEX IF NOT EXISTS idx_scan_jobs_completed
  ON scan_jobs(completed_at) WHERE status = 'completed';
