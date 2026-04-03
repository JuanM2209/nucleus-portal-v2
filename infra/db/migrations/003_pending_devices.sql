-- Pending devices: agents that connected but aren't yet approved
CREATE TABLE IF NOT EXISTS pending_devices (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id),
  serial_number VARCHAR(100) NOT NULL,
  agent_version VARCHAR(50),
  ip_address  VARCHAR(45),
  metadata    JSONB NOT NULL DEFAULT '{}',
  status      VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, approved, denied
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at  TIMESTAMPTZ,
  reviewed_by  UUID REFERENCES users(id),
  UNIQUE(tenant_id, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_pending_devices_tenant_status
  ON pending_devices (tenant_id, status);

-- Add device_approval_policy to tenant settings
-- Policy values: 'manual' (default), 'auto_approve', 'deny_all'
-- Stored in tenants.settings JSONB field as: { "deviceApprovalPolicy": "manual" }
