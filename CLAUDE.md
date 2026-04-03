# Nucleus Portal — Master Orchestrator

Enterprise Remote Access & Device Management Platform.
Monorepo multi-stack: Next.js 14 + NestJS + Rust agents.

## Architecture

```
nucleus-portal/
├── packages/
│   ├── backend/        NestJS 10 + Drizzle ORM + PostgreSQL + Redis
│   ├── frontend/       Next.js 14 + React 18 + Tailwind + TanStack Query
│   ├── shared/         Zod schemas + domain types + WS protocols
│   └── tunnel-client/  (DEPRECATED — replaced by chisel TCP transport)
├── agent/              Rust (tokio) — device monitoring + tunnels + comms + scanner
├── helper/             Rust — desktop client tunnel handler
├── infra/              Docker Compose (Postgres 16, PgBouncer, Redis 7)
└── scripts/            Automation (dev.sh, setup.sh, build-agent.sh, install-agent.sh)
```

## Tech Stack

| Layer      | Tech                                               |
|------------|----------------------------------------------------|
| Frontend   | Next.js 14, React 18, Tailwind, Zustand, TanStack  |
| Backend    | NestJS 10, Drizzle ORM, JWT, WebSocket, Zod        |
| Database   | PostgreSQL 16 + TimescaleDB, PgBouncer, Redis 7    |
| Edge       | Rust (tokio, tungstenite), cross-compiled ARM      |
| Tunnel     | Chisel (TCP over WebSocket), port 2340, CF Tunnel  |
| DevOps     | Turbo, pnpm workspaces, Docker Compose, Cloudflare |

## Dev Workflow

### 1. Start Infrastructure
```bash
cd /z/nucleus-portal
bash scripts/dev.sh        # starts Docker: Postgres, PgBouncer, Redis
```

### 2. Start Services
```bash
pnpm dev                   # runs all packages via Turbo
```

### 3. Individual Services
```bash
# Backend only
cd packages/backend
DATABASE_URL=postgres://nucleus:nucleus_dev@localhost:5432/nucleus \
JWT_SECRET=dev-secret-nucleus-portal-2026 \
PORT=3001 pnpm exec nest start --watch

# Frontend only
cd packages/frontend
pnpm dev

# Build Rust agent
bash scripts/build-agent.sh

# Chisel server (runs on port 2340, proxied via /chisel in NestJS)
# No separate CLI needed — chisel client runs inside the Rust agent
```

### 4. Database
```bash
pnpm db:migrate            # run Drizzle migrations
pnpm db:seed               # seed dev data
```

## Ports
- Frontend:   http://localhost:3000
- Backend:    http://localhost:3001/api
- WebSocket:  ws://localhost:3001
- Chisel:     ws://localhost:3001/chisel (WebSocket proxy to chisel server on port 2340)
- Postgres:   localhost:5432
- PgBouncer:  localhost:6432
- Redis:      localhost:6379

## Environment Variables

**Backend (.env at packages/backend/.env or root):**
```
# Database & Cache
DATABASE_URL=postgres://nucleus:nucleus_dev@localhost:5432/nucleus
REDIS_URL=redis://:password@localhost:6379          # Redis with password
# JWT
JWT_SECRET=dev-secret-nucleus-portal-2026
JWT_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_IN=7d
# Server
PORT=3001
NODE_ENV=development
PORTAL_URL=https://portal.datadesng.com
TUNNEL_BASE_URL=https://tunnel.datadesng.com
CORS_ORIGIN=https://portal.datadesng.com
# Cockpit credentials (env-based, not hardcoded)
COCKPIT_USER=admin
COCKPIT_PASSWORD=password
# Exposure lifecycle
EXPOSURE_IDLE_TTL_MS=300000
MAX_EXPOSURES_PER_DEVICE=2
MAX_ATTACHMENTS_PER_EXPOSURE=5
MAX_ATTACHMENTS_PER_USER=3
```

**Frontend (.env.local at packages/frontend/):**
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_WS_URL=ws://localhost:3001
NEXT_PUBLIC_TUNNEL_DOMAIN=tunnel.datadesng.com
```

## Backend Modules (12 + common)
- `auth/`           JWT authentication + refresh tokens + tenant isolation
- `agent-gateway/`  WebSocket gateway for Rust agents (ping/pong, heartbeats, sessions, bridge rebuild)
- `devices/`        Device CRUD + registry + bridge control + metrics + port expose/unexpose endpoints
- `tunnels/`        Tunnel proxy + sessions + stream bridge + comms relay + exposure management + chisel port allocation
  - `tunnels.service.ts`         Session CRUD, exposure orchestration, Cockpit health probe
  - `tunnel-proxy.service.ts`    HTTP/WS proxy with cache, retry, script injection, cookie rewriting
  - `stream-bridge.service.ts`   Bidirectional WS<>TCP bridge pool + on-demand WS bridges
  - `exposure.service.ts`        Shared exposure lifecycle (find-or-create, attachments, idle TTL, cleanup cron)
  - `comms-relay.service.ts`     WS relay for device Node-RED /comms endpoints
  - `session-cleanup.service.ts` Cron job for stale session cleanup (production scale)
  - `port-allocation.service.ts` Chisel port allocation + expose/unexpose via agent commands
- `scanner/`        Port scanner + host discovery (8 services) + health check + service classifier
  - `host-discovery.service.ts`  Network scanning for active hosts
  - `port-scanner.service.ts`    TCP port enumeration
  - `service-classifier.service.ts` Service identification (HTTP, SSH, Modbus, etc.)
  - `health-check.service.ts`    Real-time health probes
- `discovery/`      Network adapter + endpoint auto-discovery + endpoint-health service
- `audit/`          Audit log trail with security events
- `logs/`           Activity logging (LEFT JOIN users, devices, orgs) with CSV/Excel/JSON/PDF export
- `orgs/`           Organization management (devices, users, roles, hard delete) + membership checks
- `settings/`       User preferences + org settings
- `health/`         Health check endpoints + /health route
- `agent-gateway/`  WebSocket server for agent connections
- `database/`       Drizzle module + schema (22 tables)
- `db/`             Seed script
- `common/`         Decorators, DTOs, filters, guards, middleware, pipes, types

## Frontend Routes (10 core routes)
- `/`                    Redirect to /dashboard
- `/login`               Authentication (particle globe)
- `/dashboard`           Stat cards (devices, orgs, sessions, logs) + charts
- `/devices`             Device list with org chips, agent version, search
- `/devices/[deviceId]`  Device detail + health panel + adapter scan + port cards + BETA badge
- `/sessions`            Active tunnel sessions
- `/audit`               Audit logs with security events
- `/logs`                Activity logs with org/target columns + expandable details + export (CSV/Excel/JSON/PDF)
- `/admin`               Admin engineering panel
- `/health`              Health monitoring dashboard
- `/settings`            Tabs: General, Devices, Organizations, Users, Roles
- `/support`             Support page

## Frontend Key Components & Stores
**Components:**
- `device/port-card.tsx`     Port card with "Open in Browser" / "Join Session" / "Export" buttons
- `device/service-row.tsx`   Service port row with Export modal integration
- `device/export-modal.tsx`  Tunnel CLI command modal with custom local port mapping (copy-paste + download tabs)
- `device/health-panel.tsx`  Real-time health charts (CPU, memory, disk, network)
- `ui/connecting-page.tsx`   "Connecting to Device..." loading page with retry
- `ui/session-expired.tsx`   Session expired page with portal redirect

**Zustand Stores (4):**
- `auth-store.ts`     Current user + authentication state
- `sidebar-store.ts`  Sidebar collapse state + navigation
- `theme-store.ts`    Dark/light mode preference
- `port-filter-store.ts` Port filtering state (export modal)

**Custom Hooks (7):**
- `use-dashboard.ts`  Dashboard data + charts
- `use-device.ts`     Device CRUD + health metrics
- `use-scanner.ts`    Port scanning + service discovery
- `use-logs.ts`       Activity logs with filtering + export
- `use-sessions.ts`   Active tunnel sessions
- `use-admin.ts`      Admin panel state
- `use-settings.ts`   User + org settings

## Shared Types (packages/shared)
**Zod Schemas (6 files):**
- `api/auth.schema.ts`         Login, refresh, JWT validation
- `api/devices.schema.ts`      Device CRUD, adapters, discovered endpoints
- `api/tunnels.schema.ts`      Exposures, sessions, port mapping
- `api/scanner.schema.ts`      Port scanning, host discovery, service classification
- `api/audit.schema.ts`        Audit events, security logs
- `api/common.schema.ts`       Pagination, errors, generic responses

**Domain Types (5 modules):**
- `domain/Device.ts`           Device properties, health metrics, agent version
- `domain/Network.ts`          Adapters, discovered endpoints, services
- `domain/Tenant.ts`           Org-scoped data, multi-tenancy
- `domain/Tunnel.ts`           Exposure, session, attachment, bridge state
- `domain/User.ts`             Auth, roles, permissions, preferences

**WebSocket Protocols (2 definitions):**
- `ws/agent-protocol.ts`       ServerToAgent / AgentToServer message enums
- `ws/helper-protocol.ts`      Desktop client tunnel handler

## Chisel TCP Transport (replaces tunnel-client CLI and rathole)
- **Chisel server** runs on port 2340 on the backend host
- **NestJS main.ts** proxies `/chisel` WebSocket path to the chisel server (allows chisel traffic through Cloudflare Tunnel without extra ports)
- **Agent ChiselManager** (`agent/nucleus-agent/src/chisel.rs`) manages a chisel client process per device
- On `port_expose` command: agent starts chisel client with reverse tunnel `R:<remotePort>:localhost:<localPort>`
- On `port_unexpose` command: agent stops the chisel client for that port
- No laptop CLI needed — users connect tools directly to `tunnel.datadesng.com:<remotePort>`
- **API endpoints:**
  - `POST /devices/:id/ports/:port/expose` — allocate remote port + send PortExpose to agent
  - `DELETE /devices/:id/ports/:port/expose` — send PortUnexpose + release port
  - `GET /devices/:id/ports` — list active port allocations for a device
- **Install script:** `curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-deploy/main/install.sh | bash` (installs agent + chisel client binary)

## ARP Discovery & Two-Phase Scanning (V26-V27)

The agent uses a two-phase approach for subnet device discovery:

**Phase 1 — ARP Sweep (L2, unfirewallable):**
- Uses `pnet` crate for raw AF_PACKET sockets (requires `--privileged`)
- Sends ARP who-has requests to all IPs in subnet with 500us inter-packet delay
- Collects ARP replies for 4 seconds
- Reports MAC address + ARP latency for each responding host
- Works even if all TCP ports are firewalled (L2 protocol)

**Phase 2 — TCP Port Scan (only on ARP-discovered hosts):**
- Scans 22 ports (standard) or 44 ports (deep) including industrial protocols
- Industrial ports: S7comm (102), Modbus (502), MQTT (1883), OPC UA (4840), BACnet (47808), EtherNet/IP (44818), DNP3 (20000), IEC 104 (2404)
- Hosts with 0 open TCP ports still reported if found by ARP (with empty ports vec)
- Fallback: if ARP finds nothing, falls back to TCP-only scan on all IPs

**MAC Vendor OUI Lookup:**
Top industrial vendors identified by first 3 bytes of MAC address:
Siemens, Rockwell Automation, Schneider Electric, Moxa, Emerson, ABB, Beckhoff, Phoenix Contact, WAGO, Hikvision, Dahua, Axis, Advantech, Cisco, TP-Link, Raspberry Pi, Honeywell, GE, Mitsubishi Electric, Omron, Yokogawa, Hirschmann/Belden

**Backend Integration:**
- `agent-gateway.gateway.ts`: Receives scan results, persists to `discovered_endpoints` table
- Self-IP filtering: Rejects endpoints whose IP matches any device adapter IP
- Virtual adapter filtering: Skips lo, dummy0, sit0, p2p0, docker0, veth*, br-*
- Auto re-expose: On agent reconnect, backend resends all active `port_expose` commands
- Auto subnet scan: Backend triggers deep scan on all adapters after agent connects

## Rust Agent (agent/ + common crate)
**Source Files (10 core modules):**
- `main.rs`         Entry point, arg parsing, config loading
- `config.rs`       TOML config parsing (server, heartbeat, discovery, tunnel sections)
- `connection.rs`   WebSocket connection management + auto-reconnect
- `health.rs`       System metrics collection (CPU, memory, disk, network)
- `tunnel.rs`       TCP port tunneling + bidirectional relay (browser proxy)
- `chisel.rs`       ChiselManager — starts/stops chisel client for port expose/unexpose
- `comms.rs`        Node-RED /comms endpoint relay
- `mbusd.rs`        Modbus TCP daemon integration
- `scanner.rs`      Port enumeration + service discovery
- `arp_discovery.rs` ARP sweep (pnet L2) + MAC OUI vendor lookup for industrial devices

**Common Crate:**
- `messages.rs`     ServerToAgent / AgentToServer message enums (protocol)
- `types.rs`        Shared data types (Health, Port, Service, Tunnel, etc.) — ScannedHost includes `mac: Option<String>` and `vendor: Option<String>`

**Build & Deployment:**
- Config: `agent.example.toml` (server, heartbeat, discovery, tunnel sections)
- Docker image: `nucleus-agent:vr27` (Debian slim + mbusd bundled)
- Docker flags: `--privileged --pid=host --network host`
- Cross-compile ARM: `docker buildx build --platform linux/arm/v7 -f infra/docker/Dockerfile.agent`
- GitHub Release: `JuanM2209/nucleus-agent-releases` v0.27.0
- Install: `curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-deploy/main/install.sh | bash` (agent + chisel client)

**Chisel Transport (TCP over WebSocket):**
- All ports use native TCP via chisel reverse tunnels (no base64, no JSON proxy)
- Chisel client on device connects to chisel server via WebSocket through CF Tunnel
- WebSocket path `/chisel` proxied in NestJS main.ts to localhost:2340
- Agent keepalive: Ping frame every 20s (prevents Cloudflare ~100s idle disconnect)
- No protocol-specific handling needed — TCP is TCP (SSH, Modbus, HTTP all work identically)

## Database Schema (22 tables)

**Authentication & Access:**
- tenants, users, roles, permissions, role_permissions, user_roles, refresh_tokens

**Devices & Network:**
- devices, device_adapters, discovered_endpoints, endpoint_services
- agent_heartbeats (configurable retention window)

**Tunnels & Sessions:**
- **exposures** (1 per device+port, attachment-based sharing)
- access_sessions (with cleanup cron for stale entries)
- **port_allocations** (chisel remote port assignments per device+port, unique remote_port)

**Audit & Monitoring:**
- audit_events (security log trail)
- activity_logs (LEFT JOIN: users, devices, orgs)
- scan_jobs (port scanning results)

**Organization & Settings:**
- organizations (with hard delete support)
- org_devices (device-org associations)
- org_users (user-org membership + membership checks)
- user_preferences

## Tunnel System — Bridge Pool Architecture

Per exposure (1 per device+port):
| Bridge Type | Count | Purpose |
|-------------|-------|---------|
| Primary | 1 | Main FIFO HTTP bridge |
| Pool workers | 5 | Round-robin load balancing for concurrent HTTP requests |
| Comms bridge | 1 | Persistent connection for /cockpit/socket WebSocket relay |
| On-demand WS | dynamic | Spawned per-tab for multi-tab WebSocket connections |

Key features:
- **Shared exposures**: Multiple tabs/users share one exposure via attachments
- **Persistent WS bridges**: Comms bridge has `isPersistent=true` (no FIFO timeout)
- **On-demand WS bridges**: New bridge spawned when pool has none available for WebSocket upgrade
- **Cockpit cache warming**: Pre-fetches critical resources (cockpit.js, CSS) on session creation
- **Auto-reconnect**: Script injection for WebSocket disconnect recovery
- **Health probe**: Cockpit login+shell validation before returning proxy URL
- **Heartbeat retention**: Configurable agent heartbeat window (production scale)
- **Session cleanup**: Cron job removes stale sessions (production scale)
- **Batch upsert**: Optimized adapter sync via batch database operations

## Export Modal & Port Mapping

The export modal enables direct TCP access via chisel (no CLI needed):
- Click "Export" on a port card to expose it via chisel reverse tunnel
- Backend allocates a remote port and sends PortExpose to agent via WebSocket
- User connects tools directly to `tunnel.datadesng.com:<remotePort>`
- Support for Modbus TCP, HTTP, SSH, and custom TCP services
- Verified working: all 7 ports passing (SSH, HTTP, Modbus, Node-RED, Cockpit, mbusd, EtherNet/IP)
- Copy address to clipboard for pasting into Modbus Poll, PuTTY, etc.

## Production & Infrastructure

**Production URLs:**
- Frontend:   https://portal.datadesng.com
- Backend:    https://api.datadesng.com/api
- WebSocket:  wss://api.datadesng.com
- Tunnel CLI: Cloudflare Tunnel for local port forwarding

**Docker Services (bound to 127.0.0.1 for security):**
- PostgreSQL 16: 5432
- PgBouncer (connection pooling): 6432
- Redis 7 (with password): 6379

**Nginx & Security:**
- Reverse proxy for backend API
- SSL/TLS termination via Cloudflare
- Docker ports bound to 127.0.0.1 only (no external access)
- Redis password-protected
- PostgreSQL tuned for production scale

## Recent Security Hardening (Q1 2026)

- **JWT Validation**: Strict token validation on all protected endpoints
- **Tenant Isolation**: Request-scoped tenant context + org membership enforcement
- **Org Membership Checks**: Verify user belongs to target org before data access
- **Cockpit Credentials**: Moved from hardcoded config to env vars (COCKPIT_USER, COCKPIT_PASSWORD)
- **Docker Security**: All service ports bound to 127.0.0.1 (no external exposure)
- **Redis Authentication**: Password-required configuration
- **Audit Logging**: All user actions logged with org + device context

## Obsidian Knowledge Base

Vault: `Z:\NucleusVault\Nucleus\`

Before implementing changes, consult the relevant Obsidian note for context:
- Architecture & overview → `Nucleus/00-Overview.md`
- API endpoints (REST + WS) → `Nucleus/01-API-Endpoints.md`
- Database schema (22 tables) → `Nucleus/02-Database-Schema.md`
- Tunnel/port forwarding system → `Nucleus/03-Tunnel-System.md`
- Rust agent WebSocket protocol → `Nucleus/04-Agent-Protocol.md`
- Frontend routes & components → `Nucleus/05-Frontend-Routes.md`
- Infrastructure (Docker, CF, Nginx) → `Nucleus/06-Infrastructure.md`
- Security (JWT, RBAC, rate limiting) → `Nucleus/07-Security.md`
- Architecture Decision Records → `Nucleus/ADR/`
- Troubleshooting runbooks → `Nucleus/Runbooks/`
- Auto-synced change log → `Nucleus/Changelog/Recent-Changes.md`

**Auto-sync rule**: After making changes to endpoints, database schema, routes,
tunnel system, agent protocol, infrastructure, or security — IMMEDIATELY update
the corresponding Obsidian note in `Z:\NucleusVault\Nucleus\`. This is mandatory,
not optional. Also log the change to `Nucleus/Changelog/Recent-Changes.md`.

## Multi-Agent Tab Roles
- **Master (this tab)**: Orchestration, architecture decisions, cross-cutting features
- **Tab Backend**: NestJS modules, Drizzle migrations, REST + WS API
- **Tab Frontend**: Next.js pages, React components, hooks, Zustand stores
- **Tab Agent/Infra**: Rust agent, Docker, migrations, build scripts
