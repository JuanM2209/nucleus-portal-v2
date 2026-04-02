Eres el asistente principal del proyecto Nucleus Portal — una plataforma Enterprise de Remote Access & Device Management para IoT industrial.

## Proyecto
- Ruta local: Z:\nucleus-portal
- Monorepo: Next.js 14 + NestJS 10 + Rust agents
- Obsidian Vault: Z:\NucleusVault\Nucleus\

## Stack
- Frontend: Next.js 14 (App Router), React 18, Tailwind CSS, Zustand, TanStack Query, Recharts
- Backend: NestJS 10, Drizzle ORM, JWT/Passport, WebSocket, Zod
- Database: PostgreSQL 16 + TimescaleDB, PgBouncer, Redis 7
- Agents: Rust (tokio, tungstenite) — cross-compiled ARM, Docker image ghcr.io/juanm2209/nucleus-agent:r19
- DevOps: Turbo, pnpm workspaces, Docker Compose, Cloudflare Tunnels

## Producción
- Frontend: https://portal.datadesng.com → localhost:3000 (Next.js dev mode)
- Backend API: https://api.datadesng.com/api → localhost:3001
- WebSocket: wss://api.datadesng.com/ws/agent
- Todo corre LOCAL en Windows via Cloudflare Tunnel `agente-rs-public` (ID: 8825530a-d505-4d9e-bd15-bbc1b85c1f15)
- Config tunnel: C:\Users\JML\.cloudflared\config.yml

## Puertos Dev
Frontend :3000 | Backend :3001 | Postgres :5432 | PgBouncer :6432 | Redis :6379

## Backend Modules (11 + common)
- auth/ — JWT login, refresh, logout
- agent-gateway/ — WebSocket gateway para Rust agents (ping/pong, heartbeats, sessions)
- devices/ — CRUD + bridge control (mbusd) + metrics + sync
- tunnels/ — Tunnel proxy + sessions + stream bridge + comms relay
- scanner/ — Port scanner + host discovery + health check + service classifier
- discovery/ — Network adapters + endpoint auto-discovery
- audit/ — Audit log trail
- logs/ — Activity logging (LEFT JOIN users, devices, orgs para enriquecer datos)
- orgs/ — Organization management (devices M2M, users M2M, roles, HARD delete con cascade)
- settings/ — User preferences + org settings
- health/ — Health check endpoint
- common/ — DTOs (Zod), JwtAuthGuard, HttpExceptionFilter, ZodValidationPipe, RequestLogger, @CurrentUser decorator, ApiResponse<T>

## API Endpoints (40+)

### Auth
POST /api/auth/login | POST /api/auth/refresh | POST /api/auth/logout

### Devices
GET /api/devices | GET /api/devices/:id | PATCH /api/devices/:id | DELETE /api/devices/:id
POST /api/devices/:id/bridge/start | POST /api/devices/:id/bridge/stop | GET /api/devices/:id/bridge/status
GET /api/devices/:id/metrics | POST /api/devices/:id/sync

### Sessions (Tunnels)
POST /api/sessions | GET /api/sessions | GET /api/sessions/:id | POST /api/sessions/:id/extend | DELETE /api/sessions/:id

### Scanner
POST /api/devices/:deviceId/adapters/:adapterId/scan | GET /api/scans/:scanId | GET /api/scans/:scanId/results
POST /api/devices/:deviceId/health-check | GET /api/devices/:deviceId/health

### Discovery
GET /api/devices/:deviceId/adapters | GET /api/devices/:deviceId/adapters/:adapterId/endpoints | GET /api/devices/:deviceId/endpoints

### Organizations
GET /api/orgs | POST /api/orgs | GET /api/orgs/:orgId | PATCH /api/orgs/:orgId | DELETE /api/orgs/:orgId
GET /api/orgs/:orgId/devices | POST /api/orgs/:orgId/devices | DELETE /api/orgs/:orgId/devices/:deviceId
GET /api/orgs/:orgId/users | POST /api/orgs/:orgId/users | PATCH /api/orgs/:orgId/users/:userId | DELETE /api/orgs/:orgId/users/:userId

### Logs & Audit
GET /api/audit | GET /api/logs | GET /api/logs/stats

### Settings
GET /api/settings/preferences | PATCH /api/settings/preferences | GET /api/settings/org/:orgId | PATCH /api/settings/org/:orgId

### Health
GET /api/health

### WebSocket
/ws/agent — Agent gateway (token auth, ping/pong 30s)

## Database (20 tables)
tenants, users, roles, permissions, role_permissions, user_roles, refresh_tokens, devices, device_adapters, discovered_endpoints, endpoint_services, access_sessions, audit_events, scan_jobs, organizations, org_devices, org_users, user_preferences, agent_heartbeats, activity_logs

Key relationships:
- org_devices (orgId, deviceId) — M2M orgs↔devices
- org_users (orgId, userId, role) — M2M orgs↔users with role
- user_roles (userId, roleId) — M2M users↔roles

## Frontend Routes (12 pages)
/login — Auth con particle globe
/dashboard — Stat cards (devices online/offline, orgs, sessions, logs) + charts
/devices — Device list con org chips, agent version, search, pagination
/devices/[id] — Device detail + health panel + adapter scan + service rows
/sessions — Active tunnel sessions
/audit — Audit log viewer
/logs — Activity logs con expandable details + export dropdown (CSV, Excel, JSON, PDF)
/admin — Admin engineering panel
/settings — Tabs: General, Devices (multi-org assign), Organizations (CRUD), Users (multi-org manage), Roles
/support — Support page
/health — Health monitoring dashboard

## Frontend Hooks (7 files, 30+ exports)
use-admin.ts — useOrganizations, useCreateOrg, useUpdateOrg, useDeactivateOrg, useOrgMembers, useAddOrgMember, useRemoveOrgMember, useOrgDevices, useAssignDeviceToOrg, useRemoveDeviceFromOrg
use-device.ts — useDevice, useDevices, useDeviceAdapters, useDeviceEndpoints, useAdapterEndpoints, useDeviceMetrics, useSyncDevice
use-dashboard.ts — useDashboardStats, useDeviceStats
use-logs.ts — useActivityLogs, useLogStats, useAuditLogs
use-scanner.ts — useScanNetwork, useScanStatus, useDeviceHealth, useRunHealthCheck
use-sessions.ts — useSessions, useCreateSession, useExtendSession, useCloseSession
use-settings.ts — usePreferences, useUpdatePreferences

## Frontend Stores (Zustand)
auth-store — Token, user, login/logout
sidebar-store — Sidebar collapsed state
theme-store — Dark/light theme
port-filter-store — Port filtering UI state

## Agent WS Protocol (Rust ↔ Backend, 30+ message types)

### Server → Agent
session.open, session.close, discovery.trigger, ping
comms_open, comms_frame, comms_close
mbusd_start, mbusd_stop, mbusd_status
network_scan, tcp_stream_open, tcp_stream_data, tcp_stream_close

### Agent → Server
heartbeat (cpu, mem, disk, uptime, agentVersion, activeTunnels, adapters[], signalQuality)
session.ready, session.error, session.closed
discovery.result, pong
comms_opened, comms_frame, comms_closed, comms_error
mbusd_started, mbusd_stopped, mbusd_error, mbusd_status
network_scan_result, network_scan_error
tcp_stream_opened, tcp_stream_data, tcp_stream_closed

## Dispositivos Conocidos
- N-1065 — Device principal, IP 192.168.41.1, Cockpit :9090, Node-RED :1880
- Serial en device: /data/nucleus/factory/nucleus_serial_number

## Issues Conocidos
- Frontend corre en DEV mode (pnpm dev), no production build
- Si spinner negro gigante → cache .next corrupta → kill proceso + rm -rf .next + pnpm dev
- Cloudflare tunnels corren desde máquina Windows local (no VPS remoto)
- Org delete es HARD DELETE (cascade orgDevices + orgUsers, libera slug)
- Slug duplicado en org create → ConflictException 409 (auto-cleanup de orgs desactivadas)
- Multi-org: devices y users pueden pertenecer a múltiples orgs (junction tables)
- React hooks: fixed 5 hook calls pattern para useOrgDevices/useOrgMembers (no loops)
- Export libraries cargadas via dynamic import() para code splitting

## Comandos Útiles
```bash
# Verificar servicios
curl -s http://localhost:3001/api/health
curl -s http://localhost:3000/ -o /dev/null -w "%{http_code}"
docker ps
cloudflared tunnel list
netstat -ano | grep -E ":3000|:3001"

# Reiniciar frontend
taskkill //PID <pid> //F //T
rm -rf packages/frontend/.next
cd packages/frontend && pnpm dev

# Deploy agent a device
SERIAL=$(cat /data/nucleus/factory/nucleus_serial_number)
docker run -d --name nucleus-agent --restart unless-stopped --network host \
  -e AGENT_SERVER_URL="wss://api.datadesng.com/ws/agent" \
  -e AGENT_TOKEN="$SERIAL" \
  ghcr.io/juanm2209/nucleus-agent:r19
```
