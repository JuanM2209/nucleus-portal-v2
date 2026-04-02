-- ============================================================
-- Nucleus Portal - Database Schema
-- Aligned with packages/backend/src/database/schema.ts
-- ============================================================

-- ============================================================
-- MULTI-TENANCY
-- ============================================================

CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(100) NOT NULL UNIQUE,
    settings        JSONB NOT NULL DEFAULT '{}',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    display_name    VARCHAR(255),
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_tenant_email_idx ON users(tenant_id, email);

CREATE TABLE roles (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES tenants(id),
    name            VARCHAR(100) NOT NULL,
    description     TEXT,
    is_system       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX roles_tenant_name_idx ON roles(tenant_id, name);

CREATE TABLE permissions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    resource        VARCHAR(100) NOT NULL,
    action          VARCHAR(100) NOT NULL,
    description     TEXT
);

CREATE UNIQUE INDEX permissions_resource_action_idx ON permissions(resource, action);

CREATE TABLE role_permissions (
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id   UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- DEVICES
-- ============================================================

CREATE TABLE devices (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    serial_number    VARCHAR(100) NOT NULL UNIQUE,
    name             VARCHAR(255),
    firmware_version VARCHAR(50),
    agent_version    VARCHAR(50),
    status           VARCHAR(20) NOT NULL DEFAULT 'offline',
    last_seen_at     TIMESTAMPTZ,
    metadata         JSONB NOT NULL DEFAULT '{}',
    tags             TEXT[] DEFAULT '{}',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_devices_tenant  ON devices(tenant_id);
CREATE INDEX idx_devices_status  ON devices(tenant_id, status);

-- ============================================================
-- NETWORK ADAPTERS AND DISCOVERY
-- ============================================================

CREATE TABLE device_adapters (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id    UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name         VARCHAR(50) NOT NULL,
    mac_address  VARCHAR(17),
    ip_address   VARCHAR(45),
    subnet_mask  VARCHAR(15),
    gateway      VARCHAR(45),
    mode         VARCHAR(20),
    is_up        BOOLEAN NOT NULL DEFAULT FALSE,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX adapters_device_name_idx ON device_adapters(device_id, name);

CREATE TABLE discovered_endpoints (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    adapter_id    UUID NOT NULL REFERENCES device_adapters(id) ON DELETE CASCADE,
    ip_address    VARCHAR(45) NOT NULL,
    mac_address   VARCHAR(17),
    hostname      VARCHAR(255),
    vendor        VARCHAR(255),
    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    metadata      JSONB NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX endpoints_device_adapter_ip_idx ON discovered_endpoints(device_id, adapter_id, ip_address);
CREATE INDEX idx_discovered_device ON discovered_endpoints(device_id);

CREATE TABLE endpoint_services (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    endpoint_id     UUID NOT NULL REFERENCES discovered_endpoints(id) ON DELETE CASCADE,
    port            INTEGER NOT NULL,
    protocol        VARCHAR(10) NOT NULL DEFAULT 'tcp',
    service_name    VARCHAR(100),
    service_version VARCHAR(100),
    banner          TEXT,
    is_tunnelable   BOOLEAN NOT NULL DEFAULT FALSE,
    tunnel_type     VARCHAR(20),
    last_scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX services_endpoint_port_proto_idx ON endpoint_services(endpoint_id, port, protocol);
CREATE INDEX idx_services_endpoint ON endpoint_services(endpoint_id);

-- ============================================================
-- SCAN JOBS
-- ============================================================

CREATE TABLE scan_jobs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id     UUID NOT NULL REFERENCES devices(id),
    adapter_id    UUID NOT NULL REFERENCES device_adapters(id),
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    scan_type     VARCHAR(20) NOT NULL DEFAULT 'quick',
    status        VARCHAR(20) NOT NULL DEFAULT 'running',
    progress      INTEGER NOT NULL DEFAULT 0,
    hosts_scanned INTEGER NOT NULL DEFAULT 0,
    hosts_found   INTEGER NOT NULL DEFAULT 0,
    ports_found   INTEGER NOT NULL DEFAULT 0,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ,
    error         TEXT,
    results       JSONB NOT NULL DEFAULT '[]'
);

CREATE INDEX idx_scan_jobs_device  ON scan_jobs(device_id);
CREATE INDEX idx_scan_jobs_status  ON scan_jobs(status);

-- ============================================================
-- TUNNEL SESSIONS
-- ============================================================

CREATE TABLE access_sessions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES tenants(id),
    user_id          UUID NOT NULL REFERENCES users(id),
    device_id        UUID NOT NULL REFERENCES devices(id),
    target_ip        VARCHAR(45) NOT NULL,
    target_port      INTEGER NOT NULL,
    tunnel_type      VARCHAR(20) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'pending',
    proxy_subdomain  VARCHAR(100),
    proxy_path       VARCHAR(255),
    helper_id        VARCHAR(100),
    local_port       INTEGER,
    requested_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    opened_at        TIMESTAMPTZ,
    closed_at        TIMESTAMPTZ,
    expires_at       TIMESTAMPTZ NOT NULL,
    close_reason     VARCHAR(50),
    user_ip          VARCHAR(45),
    user_agent       TEXT,
    bytes_tx         BIGINT NOT NULL DEFAULT 0,
    bytes_rx         BIGINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_sessions_tenant  ON access_sessions(tenant_id);
CREATE INDEX idx_sessions_device  ON access_sessions(device_id);
CREATE INDEX idx_sessions_user    ON access_sessions(user_id);
CREATE INDEX idx_sessions_active  ON access_sessions(status) WHERE status = 'active';
CREATE INDEX idx_sessions_expires ON access_sessions(expires_at) WHERE status = 'active';

-- ============================================================
-- AUDIT LOG
-- ============================================================

CREATE TABLE audit_events (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID NOT NULL REFERENCES tenants(id),
    user_id       UUID REFERENCES users(id),
    session_id    UUID REFERENCES access_sessions(id),
    device_id     UUID REFERENCES devices(id),
    action        VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50) NOT NULL,
    resource_id   UUID,
    details       JSONB NOT NULL DEFAULT '{}',
    ip_address    VARCHAR(45),
    user_agent    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant  ON audit_events(tenant_id);
CREATE INDEX idx_audit_created ON audit_events(tenant_id, created_at DESC);
CREATE INDEX idx_audit_action  ON audit_events(action);

-- ============================================================
-- AGENT HEARTBEATS
-- ============================================================

CREATE TABLE agent_heartbeats (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id      UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    cpu            REAL NOT NULL,
    mem            REAL NOT NULL,
    mem_total      BIGINT NOT NULL DEFAULT 0,
    disk           REAL NOT NULL,
    disk_total     BIGINT NOT NULL DEFAULT 0,
    uptime         BIGINT NOT NULL DEFAULT 0,
    agent_version  VARCHAR(50),
    active_tunnels INTEGER NOT NULL DEFAULT 0,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_heartbeats_device  ON agent_heartbeats(device_id);
CREATE INDEX idx_heartbeats_created ON agent_heartbeats(created_at);

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    logo_url    VARCHAR(500),
    settings    JSONB NOT NULL DEFAULT '{}',
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE org_devices (
    org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    device_id   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    assigned_by UUID REFERENCES users(id),
    PRIMARY KEY (org_id, device_id)
);

CREATE TABLE org_users (
    org_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role      VARCHAR(50) NOT NULL DEFAULT 'member',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_id, user_id)
);

-- ============================================================
-- USER PREFERENCES
-- ============================================================

CREATE TABLE user_preferences (
    user_id                UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    theme                  VARCHAR(20) NOT NULL DEFAULT 'system',
    session_duration_hours INTEGER NOT NULL DEFAULT 8,
    notifications_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    timezone               VARCHAR(100) NOT NULL DEFAULT 'UTC'
);

-- ============================================================
-- ACTIVITY LOGS
-- ============================================================

CREATE TABLE activity_logs (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id        UUID REFERENCES organizations(id),
    user_id       UUID REFERENCES users(id),
    device_id     UUID REFERENCES devices(id),
    action        VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id   UUID,
    details       JSONB NOT NULL DEFAULT '{}',
    ip_address    VARCHAR(45),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_logs_org     ON activity_logs(org_id);
CREATE INDEX idx_activity_logs_user    ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at);
CREATE INDEX idx_activity_logs_action  ON activity_logs(action);

-- ============================================================
-- SEED DATA
-- ============================================================

-- Default permissions
INSERT INTO permissions (resource, action, description) VALUES
('device',    'read',    'View devices'),
('device',    'write',   'Edit devices'),
('device',    'delete',  'Delete devices'),
('tunnel',    'browser', 'Open browser tunnels'),
('tunnel',    'local',   'Open local tunnels'),
('tunnel',    'manage',  'Manage all tunnel sessions'),
('discovery', 'trigger', 'Trigger network discovery'),
('audit',     'read',    'View audit logs'),
('user',      'read',    'View users'),
('user',      'write',   'Manage users'),
('tenant',    'read',    'View tenant settings'),
('tenant',    'write',   'Manage tenant settings');

-- Default tenant for development
INSERT INTO tenants (id, name, slug) VALUES
('00000000-0000-4000-8000-000000000001', 'Development Tenant', 'dev');

-- Default roles
INSERT INTO roles (id, tenant_id, name, description, is_system) VALUES
('00000000-0000-4000-8000-000000000010', '00000000-0000-4000-8000-000000000001', 'admin',    'Full access administrator',              TRUE),
('00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000001', 'operator', 'Device operator with tunnel access',     TRUE),
('00000000-0000-4000-8000-000000000012', '00000000-0000-4000-8000-000000000001', 'viewer',   'Read-only viewer',                       TRUE);

-- Admin gets all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-8000-000000000010', id FROM permissions;

-- Operator gets device/tunnel/discovery permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-8000-000000000011', id FROM permissions
WHERE resource IN ('device', 'tunnel', 'discovery') AND action IN ('read', 'browser', 'local', 'trigger');

-- Viewer gets read permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-4000-8000-000000000012', id FROM permissions
WHERE action = 'read';

-- Admin user: password is set by running `pnpm run db:seed` after Docker starts.
-- Placeholder hash ensures the row exists but login is blocked until seed runs.
INSERT INTO users (id, tenant_id, email, password_hash, display_name) VALUES
('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000001',
 'admin@nucleus.local', '$2b$10$PLACEHOLDER_RUN_DB_SEED_TO_FIX', 'Admin User');

INSERT INTO user_roles (user_id, role_id) VALUES
('00000000-0000-4000-8000-000000000100', '00000000-0000-4000-8000-000000000010');
