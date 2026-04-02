# Nucleus Portal — Session Context Document
> Generated: March 26, 2026 | For use in new Claude Code sessions

## Repositories

| Repo | URL | Visibility |
|------|-----|-----------|
| **Portal** | `github.com/JuanM2209/nucleus-portal` | Private |
| **Agent** | `github.com/JuanM2209/nucleus-agent` | Public |

## Project Overview

Enterprise Remote Access & Device Management Platform for industrial edge devices.
Monorepo: Next.js 14 + NestJS 10 + Rust agent + mbusd Modbus bridge.

### Architecture
```
Browser -> Cloudflare -> Backend (NestJS, port 3001) -> WebSocket -> Agent (Rust vr19) -> Device
                         Frontend (Next.js, port 3000)
```

### Production URLs
- Portal: `https://portal.datadesng.com`
- API: `https://api.datadesng.com/api`
- WebSocket: `wss://api.datadesng.com/ws/agent`
- Both served via Cloudflare Tunnel from local machine

### Credentials
- Portal login: `admin@nucleus.local` / `Admin123!`
- Node-RED on N-1065: `user` / `nucleus`

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 14, React 18, Tailwind, Zustand, TanStack Query |
| Backend | NestJS 10, Drizzle ORM, JWT, WebSocket, Zod |
| Database | PostgreSQL 16 + TimescaleDB, PgBouncer, Redis 7 |
| Agent | Rust (tokio, tungstenite), ARM32 cross-compiled |
| DevOps | Docker, Cloudflare Tunnel, pnpm workspaces |

## Device Under Test: N-1065

- **ID**: `26902cd6-b72b-496e-9326-59517775a95b`
- **Agent**: vr19 (Rust), Docker container `remote-s`
- **Docker flags**: `--privileged --network host -v /dev:/dev`
- **Connection**: Cellular (wwan0), drops every ~4-5 min, reconnects in ~10s

### Network Adapters
| Adapter | IP | Role |
|---------|-----|------|
| eth0 | 10.10.1.1/24 | Industrial LAN (PLCs, Modbus) |
| eth1 | 192.168.8.99/24 | Local LAN |
| wlan0 | 10.42.0.1/24 | WiFi AP |
| wwan0 | 10.4.198.132/29 | Cellular WAN (uplink) |

### Discovered Services
| IP | Port | Service | Classification |
|----|------|---------|---------------|
| 127.0.0.1 | 1880 | Node-RED | Direct Web Access (browser tunnel) |
| 127.0.0.1 | 9090 | Cockpit | Direct Web Access |
| 127.0.0.1 | 22 | SSH | PC Import Required |
| 10.10.1.11 | 80/443 | HTTP/HTTPS (PLC) | Direct Web Access |
| 10.10.1.11 | 502 | Modbus TCP | PC Import Required |
| 10.10.1.11 | 44818 | EtherNet/IP | PC Import Required |

### mbusd Bridge
- Binary: `/usr/local/bin/mbusd` (v0.2.3 ARM32) in Docker container
- Serial port: `/dev/ttymxc5`
- Default: `mbusd -d -v 2 -p /dev/ttymxc5 -s 9600 -m 8n1 -P 2202`
- Controlled from portal: Start/Stop/Configure via WebSocket

## Bugs Fixed (This Session)

| # | Bug | Fix |
|---|-----|-----|
| 1 | /comms WebSocket wrong handler | Only match bare `/comms` for mock |
| 2 | Go agent no /comms support | Built Rust agent vr19 |
| 3 | tcp_stream race condition | Wait for data write before reading TCP |
| 4 | Primary session closed on TCP EOF | Don't open TCP in handle_session_open |
| 5 | Backend closed active sessions on reconnect | Only close same-port sessions >5min old |
| 6 | Duplicate deploy notification | Removed backend broadcast |
| 7 | Fallback timer replaced confirmed /comms relay | Check isRelayConfirmed() |
| 8 | /flows cached after deploy | Removed from cache |
| 9 | Rustls crypto provider crash | Added ring::default_provider() |
| 10 | Agent didn't understand start_session | Added serde aliases |
| 11 | WebSocket constructor crash | Fixed ws module import |
| 12 | Circular DI in DevicesModule | forwardRef on both modules |

## Tunnel Architecture

### HTTP: Browser -> Device
```
Browser -> Cloudflare -> Backend proxy (/proxy/{token}/)
  -> StreamBridge (4 pool bridges, round-robin)
  -> Agent WS (tcp_stream_open/data/close per request)
  -> Device TCP -> Node-RED -> reverse path
```

### /comms: Real-time WebSocket
```
Browser <-WS-> Backend <-AgentWS-> Agent <-WS-> Device Node-RED /comms
```

### mbusd Control
```
Portal UI -> POST /devices/:id/bridge/start -> WS "mbusd_start" -> Agent -> spawns mbusd
```

## Docker Commands for N-1065

### Update Agent
```bash
curl -fsSL -L https://github.com/JuanM2209/nucleus-agent/releases/download/vr19/nucleus-agent-vr19.tar -o /tmp/nucleus-agent-vr19.tar && docker load < /tmp/nucleus-agent-vr19.tar && docker stop remote-s; docker rm remote-s && docker run -d --name remote-s --restart unless-stopped --privileged --network host -v /data/nucleus:/data/nucleus:ro -v /dev:/dev -e AGENT_SERVER_URL=wss://api.datadesng.com/ws/agent -e AGENT_TOKEN=26902cd6-b72b-496e-9326-59517775a95b nucleus-agent:vr19
```

### Start Backend
```bash
cd Z:/nucleus-portal/packages/backend
DATABASE_URL=postgres://nucleus:nucleus_dev@localhost:5432/nucleus JWT_SECRET=dev-secret-nucleus-portal-2026 PORT=3001 CORS_ORIGIN="http://localhost:3000,https://portal.datadesng.com" TUNNEL_BASE_URL="https://api.datadesng.com" pnpm exec nest start --watch
```

### Start Frontend
```bash
cd Z:/nucleus-portal/packages/frontend && pnpm dev
```

## Known Limitations

1. Cellular drops every ~4-5 min. Agent reconnects in ~10s, sessions rebuild automatically.
2. Node-RED load time: ~15-30s on cellular (93 resources). Cache helps after first load.
3. `[object Blob]` error in console: cosmetic, doesn't affect functionality.
