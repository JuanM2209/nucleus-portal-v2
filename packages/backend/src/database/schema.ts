import {
  pgTable,
  uuid,
  varchar,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigint,
  real,
  inet,
  uniqueIndex,
  index,
  primaryKey,
} from 'drizzle-orm/pg-core';

// ── Tenants ──

export const tenants = pgTable('tenants', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  settings: jsonb('settings').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Users ──

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  displayName: varchar('display_name', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('users_tenant_email_idx').on(table.tenantId, table.email),
]);

// ── Roles & Permissions ──

export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  name: varchar('name', { length: 100 }).notNull(),
  description: text('description'),
  isSystem: boolean('is_system').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('roles_tenant_name_idx').on(table.tenantId, table.name),
]);

export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  resource: varchar('resource', { length: 100 }).notNull(),
  action: varchar('action', { length: 100 }).notNull(),
  description: text('description'),
}, (table) => [
  uniqueIndex('permissions_resource_action_idx').on(table.resource, table.action),
]);

export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.roleId, table.permissionId] }),
]);

export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.roleId] }),
]);

export const refreshTokens = pgTable('refresh_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Devices ──

export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  serialNumber: varchar('serial_number', { length: 100 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  firmwareVersion: varchar('firmware_version', { length: 50 }),
  agentVersion: varchar('agent_version', { length: 50 }),
  status: varchar('status', { length: 20 }).notNull().default('offline'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  metadata: jsonb('metadata').notNull().default({}),
  tags: text('tags').array().notNull().default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_devices_tenant').on(table.tenantId),
  index('idx_devices_status').on(table.tenantId, table.status),
]);

// ── Network Adapters ──

export const deviceAdapters = pgTable('device_adapters', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 50 }).notNull(),
  macAddress: varchar('mac_address', { length: 17 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  subnetMask: varchar('subnet_mask', { length: 15 }),
  gateway: varchar('gateway', { length: 45 }),
  mode: varchar('mode', { length: 20 }),
  configProfile: varchar('config_profile', { length: 100 }),
  isUp: boolean('is_up').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('adapters_device_name_idx').on(table.deviceId, table.name),
]);

// ── Discovered Endpoints ──

export const discoveredEndpoints = pgTable('discovered_endpoints', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  adapterId: uuid('adapter_id').notNull().references(() => deviceAdapters.id, { onDelete: 'cascade' }),
  ipAddress: varchar('ip_address', { length: 45 }).notNull(),
  macAddress: varchar('mac_address', { length: 17 }),
  hostname: varchar('hostname', { length: 255 }),
  vendor: varchar('vendor', { length: 255 }),
  firstSeenAt: timestamp('first_seen_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').notNull().default({}),
}, (table) => [
  uniqueIndex('endpoints_device_adapter_ip_idx').on(table.deviceId, table.adapterId, table.ipAddress),
  index('idx_discovered_device').on(table.deviceId),
]);

// ── Endpoint Services ──

export const endpointServices = pgTable('endpoint_services', {
  id: uuid('id').primaryKey().defaultRandom(),
  endpointId: uuid('endpoint_id').notNull().references(() => discoveredEndpoints.id, { onDelete: 'cascade' }),
  port: integer('port').notNull(),
  protocol: varchar('protocol', { length: 10 }).notNull().default('tcp'),
  serviceName: varchar('service_name', { length: 100 }),
  serviceVersion: varchar('service_version', { length: 100 }),
  banner: text('banner'),
  isTunnelable: boolean('is_tunnelable').notNull().default(false),
  tunnelType: varchar('tunnel_type', { length: 20 }),
  lastScannedAt: timestamp('last_scanned_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex('services_endpoint_port_proto_idx').on(table.endpointId, table.port, table.protocol),
  index('idx_services_endpoint').on(table.endpointId),
]);

// ── Exposures (shared tunnel infrastructure per device+port) ──

export const exposures = pgTable('exposures', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  targetIp: varchar('target_ip', { length: 45 }).notNull(),
  targetPort: integer('target_port').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  refCount: integer('ref_count').notNull().default(0),
  idleAt: timestamp('idle_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  closeReason: varchar('close_reason', { length: 255 }),
}, (table) => [
  index('idx_exposures_device_port').on(table.deviceId, table.targetPort),
  index('idx_exposures_tenant').on(table.tenantId),
  index('idx_exposures_status').on(table.status),
]);

// ── Access Sessions (client attachments to shared exposures) ──

export const accessSessions = pgTable('access_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  exposureId: uuid('exposure_id').references(() => exposures.id),
  targetIp: varchar('target_ip', { length: 45 }).notNull(),
  targetPort: integer('target_port').notNull(),
  tunnelType: varchar('tunnel_type', { length: 20 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  proxySubdomain: varchar('proxy_subdomain', { length: 100 }),
  proxyPath: varchar('proxy_path', { length: 255 }),
  helperId: varchar('helper_id', { length: 100 }),
  localPort: integer('local_port'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  openedAt: timestamp('opened_at', { withTimezone: true }),
  closedAt: timestamp('closed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  closeReason: varchar('close_reason', { length: 255 }),
  userIp: varchar('user_ip', { length: 45 }),
  userAgent: text('user_agent'),
  bytesTx: bigint('bytes_tx', { mode: 'number' }).notNull().default(0),
  bytesRx: bigint('bytes_rx', { mode: 'number' }).notNull().default(0),
}, (table) => [
  index('idx_sessions_tenant').on(table.tenantId),
  index('idx_sessions_device').on(table.deviceId),
  index('idx_sessions_user').on(table.userId),
  index('idx_sessions_exposure').on(table.exposureId),
  index('idx_sessions_proxy_path').on(table.proxyPath),
  index('idx_sessions_status').on(table.status),
]);

// ── Audit Events ──

export const auditEvents = pgTable('audit_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  userId: uuid('user_id').references(() => users.id),
  sessionId: uuid('session_id').references(() => accessSessions.id),
  deviceId: uuid('device_id').references(() => devices.id),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }).notNull(),
  resourceId: uuid('resource_id'),
  details: jsonb('details').notNull().default({}),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_audit_tenant').on(table.tenantId),
  index('idx_audit_created').on(table.tenantId, table.createdAt),
  index('idx_audit_action').on(table.action),
]);

// ── Scan Jobs ──

export const scanJobs = pgTable('scan_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id),
  adapterId: uuid('adapter_id').notNull().references(() => deviceAdapters.id),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  scanType: varchar('scan_type', { length: 20 }).notNull().default('quick'),
  status: varchar('status', { length: 20 }).notNull().default('running'),
  progress: integer('progress').notNull().default(0),
  hostsScanned: integer('hosts_scanned').notNull().default(0),
  hostsFound: integer('hosts_found').notNull().default(0),
  portsFound: integer('ports_found').notNull().default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  error: text('error'),
  results: jsonb('results').notNull().default([]),
}, (table) => [
  index('idx_scan_jobs_device').on(table.deviceId),
  index('idx_scan_jobs_status').on(table.status),
]);

// ── Organizations ──

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  logoUrl: varchar('logo_url', { length: 500 }),
  settings: jsonb('settings').notNull().default({}),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const orgDevices = pgTable('org_devices', {
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).notNull().defaultNow(),
  assignedBy: uuid('assigned_by').references(() => users.id),
}, (table) => [
  primaryKey({ columns: [table.orgId, table.deviceId] }),
]);

export const orgUsers = pgTable('org_users', {
  orgId: uuid('org_id').notNull().references(() => organizations.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: varchar('role', { length: 50 }).notNull().default('member'),
  isActive: boolean('is_active').notNull().default(true),
  joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.orgId, table.userId] }),
]);

// ── User Preferences ──

export const userPreferences = pgTable('user_preferences', {
  userId: uuid('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  theme: varchar('theme', { length: 20 }).notNull().default('system'),
  sessionDurationHours: integer('session_duration_hours').notNull().default(8),
  notificationsEnabled: boolean('notifications_enabled').notNull().default(true),
  sessionExpiryAlerts: boolean('session_expiry_alerts').notNull().default(true),
  deviceOfflineAlerts: boolean('device_offline_alerts').notNull().default(false),
  healthCheckAlerts: boolean('health_check_alerts').notNull().default(false),
  agentUpdateAlerts: boolean('agent_update_alerts').notNull().default(false),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
});

// ── User Invitations ──

export const invitations = pgTable('invitations', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  email: varchar('email', { length: 255 }).notNull(),
  role: varchar('role', { length: 50 }).notNull().default('viewer'),
  token: varchar('token', { length: 128 }).notNull().unique(),
  invitedBy: uuid('invited_by').notNull().references(() => users.id),
  acceptedAt: timestamp('accepted_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ── Pending Devices (awaiting approval) ──

export const pendingDevices = pgTable('pending_devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  tenantId: uuid('tenant_id').notNull().references(() => tenants.id),
  serialNumber: varchar('serial_number', { length: 100 }).notNull(),
  agentVersion: varchar('agent_version', { length: 50 }),
  ipAddress: varchar('ip_address', { length: 45 }),
  metadata: jsonb('metadata').notNull().default({}),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  reviewedBy: uuid('reviewed_by').references(() => users.id),
}, (table) => [
  uniqueIndex('pending_devices_tenant_serial_idx').on(table.tenantId, table.serialNumber),
  index('idx_pending_devices_tenant_status').on(table.tenantId, table.status),
]);

// ── Port Allocations (Rathole V2 transport) ──

export const portAllocations = pgTable('port_allocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id),
  targetPort: integer('target_port').notNull(),
  remotePort: integer('remote_port').notNull().unique(),
  serviceName: varchar('service_name', { length: 100 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('active'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => [
  uniqueIndex('port_alloc_device_port_idx').on(table.deviceId, table.targetPort),
  index('idx_port_alloc_status').on(table.status),
  index('idx_port_alloc_remote').on(table.remotePort),
  index('idx_port_alloc_user').on(table.userId),
]);

// ── Agent Heartbeats ──

export const agentHeartbeats = pgTable('agent_heartbeats', {
  id: uuid('id').primaryKey().defaultRandom(),
  deviceId: uuid('device_id').notNull().references(() => devices.id, { onDelete: 'cascade' }),
  cpu: real('cpu').notNull(),
  mem: real('mem').notNull(),
  memTotal: bigint('mem_total', { mode: 'number' }).notNull().default(0),
  disk: real('disk').notNull(),
  diskTotal: bigint('disk_total', { mode: 'number' }).notNull().default(0),
  uptime: bigint('uptime', { mode: 'number' }).notNull().default(0),
  agentVersion: varchar('agent_version', { length: 50 }),
  activeTunnels: integer('active_tunnels').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_heartbeats_device').on(table.deviceId),
  index('idx_heartbeats_created').on(table.createdAt),
]);

// ── Activity Logs ──

export const activityLogs = pgTable('activity_logs', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').references(() => organizations.id),
  userId: uuid('user_id').references(() => users.id),
  deviceId: uuid('device_id').references(() => devices.id),
  action: varchar('action', { length: 100 }).notNull(),
  resourceType: varchar('resource_type', { length: 50 }),
  resourceId: uuid('resource_id'),
  details: jsonb('details').notNull().default({}),
  ipAddress: varchar('ip_address', { length: 45 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_activity_logs_org').on(table.orgId),
  index('idx_activity_logs_user').on(table.userId),
  index('idx_activity_logs_created').on(table.createdAt),
  index('idx_activity_logs_action').on(table.action),
]);
