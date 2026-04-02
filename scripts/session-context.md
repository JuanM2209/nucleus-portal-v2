## Nucleus Portal — Session Context

Project: `Z:\nucleus-portal`
Platform: Enterprise Remote Access & Device Management

### Stack
- **Frontend:** Next.js 14 + React 18 + Tailwind + Zustand + TanStack Query
- **Backend:** NestJS 10 + Drizzle ORM + JWT + WebSocket + Zod
- **Database:** PostgreSQL 16 (TimescaleDB) + PgBouncer + Redis 7
- **Agents:** Rust (tokio, tungstenite) — device monitoring + tunnels + comms + mbusd + scanner
- **Tunnel CLI:** Node.js — local TCP port forwarding via WebSocket tunnel
- **DevOps:** Turbo + pnpm workspaces + Docker + Cloudflare Tunnels

### Codebase Snapshot
- **Backend Modules:** 12 core + common (auth, agent-gateway, devices, tunnels, scanner, discovery, audit, logs, orgs, settings, health)
- **Frontend Routes:** 10 main (/login, /dashboard, /devices, /devices/[id], /sessions, /audit, /logs, /admin, /settings, /health)
- **Frontend Stores:** 4 (auth-store, sidebar-store, theme-store, port-filter-store)
- **Frontend Hooks:** 7 modules (use-admin, use-device, use-dashboard, use-logs, use-scanner, use-sessions, use-settings)
- **Shared:** 6 Zod schemas (api/), 5 domain types (domain/), 2 WS protocols (ws/)
- **Database:** 21 tables (tenants, users, roles, devices, exposures, sessions, audit_events, activity_logs, etc.)
- **Rust Agent:** 8 src files + common crate (main.rs, config.rs, connection.rs, health.rs, tunnel.rs, comms.rs, mbusd.rs, scanner.rs)

### Tunnel System Architecture
- **CLI:** nucleus-tunnel --token TOKEN --port PORT → WS → Backend → Agent → Device TCP port
- **Bridge Pool (per exposure):** 1 primary + 5 workers + 1 persistent comms + dynamic on-demand WS
- **Shared Model:** Multiple users/tabs attach to single exposure, auto-cleanup on idle TTL
- **Use Cases:** Modbus Poll, PuTTY, PCCU, ProLink, Node-RED /comms relay

### Production Deployment
- **Frontend:** https://portal.datadesng.com
- **Backend:** https://api.datadesng.com/api
- **Transport:** Cloudflare Tunnel (cloudflared) from local machine
- **Scale:** 3000+ devices, 7+ bridges per exposure, session cleanup cron, graceful shutdown

### Development Ports
Frontend :3000 | Backend :3001 | Postgres :5432 | PgBouncer :6432 | Redis :6379

### Environment Variables (Key 18)
DATABASE_URL, REDIS_URL, JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN, PORT, NODE_ENV,
PORTAL_URL, CORS_ORIGIN, NEXT_PUBLIC_API_URL, NEXT_PUBLIC_WS_URL, NEXT_PUBLIC_TUNNEL_DOMAIN,
TUNNEL_BASE_URL, COCKPIT_USER, COCKPIT_PASSWORD, EXPOSURE_IDLE_TTL_MS,
MAX_EXPOSURES_PER_DEVICE, MAX_ATTACHMENTS_PER_EXPOSURE, MAX_ATTACHMENTS_PER_USER

### Obsidian Vault
Location: `Z:\NucleusVault\Nucleus\`
Contents: 8 main docs + ADR + Runbooks + Changelog
Rule: Update corresponding note immediately after changes to endpoints, schema, routes, tunnel, agent protocol, infra, or security

### Recent Changes (2026-04-01)
- **Agent vr24:** Rust agent with mbusd bundled, Debian slim, --privileged Docker, stale session cleanup, lazy TCP connect, 20s ping keepalive, 5min tcp_stream timeout
- **MBuSD Bridge:** Start/Stop from portal works, direct mbusd execution inside container, stderr capture + crash diagnostics
- **Tunnel CLI (CONFIRMED STABLE):** JSON proxy for Modbus/HTTP ports — Modbus export 2202→2204 stable 10+ minutes continuous polling
- **Persistent bridge auto-reconnect:** When tcp_stream closes, bridge auto-sends new tcp_stream_open — prevents data loss after agent timeout
- **Anti-duplicate tcp_stream_open:** Sets activeRequest before sending to prevent multiple simultaneous TCP connections to mbusd
- **Endpoint Status:** Live inference from adapter state (isUp + agent online) — no more stale "Idle/OFFLINE"
- **Deploy Pipeline:** Docker buildx ARM cross-compile → GitHub Releases (nucleus-agent-releases) → one-line curl install on device
- **Backup:** nucleus-portal-backup-2026-04-01 (private GitHub repo)

### Tunnel Protocol Selection
- **Port 22 (SSH):** Binary frames — avoids base64 corruption of encrypted packets
- **All other ports (Modbus, HTTP, etc):** JSON proxy (tcp_stream_open/data/close) — proven stable

### Known Issues / In Progress
- **SSH via tunnel CLI:** PuTTY connects but "garbled on decryption" after ~20s — binary frames selected for port 22 but lazy TCP connect timing needs tuning
- **Transport latency:** Current stack adds ~100-200ms (WebSocket + Cloudflare + JSON + base64). Plan: direct TCP data channel to reduce to ~10-30ms

### Future: Transport Optimization Plan
- **Phase 1:** Direct TCP data channel (bypass Cloudflare for tunnel data, keep control plane on WS)
- **Phase 2:** Binary frames + yamux multiplexing for all ports in 1 connection
- **Phase 3:** QUIC/UDP transport for latency-critical protocols (Modbus RTU)
- **Scale target:** 10,000 devices, ~100 concurrent active, multi-org, multi-user

### Previous Changes (2026-03-31)
- **Security:** Hardened 18 findings (JWT, RBAC, rate limiting, input validation)
- **Scale:** Production ready for 3000+ devices
- **Backend:** Logs org/target columns, session cleanup cron, heartbeat retention
- **Ops:** Graceful shutdown on exit signals
