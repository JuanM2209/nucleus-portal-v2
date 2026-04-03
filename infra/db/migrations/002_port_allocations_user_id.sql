-- Migration: Add user_id column to port_allocations for session tracking
-- Date: 2026-04-02

ALTER TABLE port_allocations ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id);
CREATE INDEX IF NOT EXISTS idx_port_alloc_user ON port_allocations (user_id);
