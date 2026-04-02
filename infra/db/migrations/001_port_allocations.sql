-- Migration: Add port_allocations table for Rathole V2 transport
-- Date: 2026-04-01

CREATE TABLE IF NOT EXISTS port_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  target_port INTEGER NOT NULL,
  remote_port INTEGER NOT NULL UNIQUE,
  service_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS port_alloc_device_port_idx ON port_allocations (device_id, target_port);
CREATE INDEX IF NOT EXISTS idx_port_alloc_status ON port_allocations (status);
CREATE INDEX IF NOT EXISTS idx_port_alloc_remote ON port_allocations (remote_port);
