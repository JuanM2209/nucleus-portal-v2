# Nucleus Portal

> Enterprise Remote Access & Device Management Platform

Nucleus Portal is a multi-tenant platform for managing remote industrial devices with secure tunneling, network discovery, real-time health monitoring, and comprehensive audit logging.

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Frontend   │────▶│   Backend    │◀────│   Agent     │
│  (Next.js)   │     │  (NestJS)    │     │  (Rust)     │
│  Port 3000   │     │  Port 3001   │     │  Edge Device│
└─────────────┘     └──────┬───────┘     └─────────────┘
                           │
                    ┌──────┴───────┐
                    │              │
              ┌─────┴─────┐ ┌─────┴─────┐
              │ PostgreSQL │ │   Redis   │
              │ TimescaleDB│ │           │
              └───────────┘ └───────────┘
```

## Tech Stack

### Frontend
- **Next.js 14** (App Router) with React 18
- **TypeScript 5.7** for type safety
- **Tailwind CSS** with Industrial Sentinel design system
- **TanStack Query** for server state management
- **Zustand** for client state management
- **Lucide React** for icons

### Backend
- **NestJS 10** with modular architecture
- **Drizzle ORM** with PostgreSQL
- **JWT** authentication with refresh token rotation
- **WebSocket** gateway for agent communication
- **Zod** input validation on all endpoints
- **Rate limiting** via @nestjs/throttler

### Infrastructure
- **PostgreSQL 16** with TimescaleDB extension
- **PgBouncer** for connection pooling
- **Redis 7** for caching
- **Nginx** for reverse proxy
- **Docker Compose** for local development

### Edge Components
- **nucleus-agent** (Rust) - Device-side agent for tunneling & discovery
- **nucleus-helper** (Rust) - Desktop tunnel client via deep linking

## Prerequisites

- Node.js >= 20.0.0
- pnpm >= 9.15.0
- Docker & Docker Compose

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd nucleus-portal
pnpm install
```

### 2. Environment setup

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Start infrastructure

```bash
# Start PostgreSQL, PgBouncer, and Redis
./scripts/dev.sh

# Or manually:
cd infra && docker compose up -d
```

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. Seed initial data (optional)

```bash
pnpm db:seed
```

### 6. Start development servers

```bash
pnpm dev
```

This starts both frontend (http://localhost:3000) and backend (http://localhost:3001) in parallel using Turborepo.

### First-time setup (automated)

```bash
chmod +x scripts/setup.sh
./scripts/setup.sh
```

## Project Structure

```
nucleus-portal/
├── packages/
│   ├── frontend/          # Next.js 14 application
│   │   ├── src/app/       # App Router pages
│   │   ├── src/components/# React components
│   │   ├── src/hooks/     # Custom React hooks
│   │   ├── src/lib/       # Utilities (API client, formatting)
│   │   └── src/stores/    # Zustand state stores
│   ├── backend/           # NestJS API server
│   │   ├── src/auth/      # JWT authentication
│   │   ├── src/devices/   # Device management
│   │   ├── src/tunnels/   # Tunnel proxy & sessions
│   │   ├── src/scanner/   # Network scanning
│   │   ├── src/agent-gateway/ # WebSocket agent gateway
│   │   ├── src/discovery/ # Endpoint discovery
│   │   ├── src/audit/     # Audit logging
│   │   ├── src/orgs/      # Organization management
│   │   └── src/common/    # Shared pipes, guards, DTOs
│   └── shared/            # Shared types, Zod schemas, protocols
├── agent/                 # Rust agent (edge device binary)
│   ├── nucleus-agent/     # Agent binary crate
│   └── nucleus-common/    # Shared types crate
├── helper/                # Rust helper (desktop tunnel client)
│   └── nucleus-helper/    # Helper binary crate
├── infra/                 # Infrastructure configuration
│   ├── docker-compose.yml # Local services
│   ├── db/init.sql        # Database schema & seed
│   └── docker/            # Dockerfiles & nginx config
└── scripts/               # Development & build scripts
```

## Key Features

### Device Management
- Multi-tenant device fleet overview
- Real-time online/offline status
- Device metadata and tagging
- Network adapter monitoring

### Network Discovery & Scanning
- Quick, Standard, and Deep scan profiles
- Host discovery via TCP probes
- Port scanning with service classification
- Banner grabbing and protocol detection

### Secure Tunneling
- **Browser tunnels** - HTTP/HTTPS proxy through the platform
- **Local tunnels** - TCP port forwarding to localhost via desktop helper
- Session management with expiry and extension
- Bandwidth tracking

### Health Monitoring
- Service health checks (TCP + HTTP probes)
- Device heartbeat collection
- System metrics (CPU, memory, disk, uptime)

### Security & Compliance
- Role-based access control (RBAC)
- Comprehensive audit logging
- Input validation on all endpoints
- Rate limiting on authentication
- JWT with refresh token rotation

### Administration
- Organization management
- User and role management
- Activity logging with filters
- User preferences

## API Documentation

### Authentication
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | Authenticate user |
| POST | /api/auth/refresh | Refresh access token |
| POST | /api/auth/logout | Revoke refresh token |

### Devices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/devices | List devices (paginated) |
| GET | /api/devices/:id | Get device details |
| PATCH | /api/devices/:id | Update device |
| DELETE | /api/devices/:id | Deactivate device |

### Discovery & Scanning
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/devices/:id/adapters | List network adapters |
| GET | /api/devices/:id/endpoints | List discovered endpoints |
| POST | /api/devices/:id/adapters/:aid/scan | Start network scan |
| GET | /api/scans/:id | Get scan status |
| POST | /api/devices/:id/health-check | Run health check |

### Tunnels
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/sessions | Create tunnel session |
| GET | /api/sessions | List active sessions |
| POST | /api/sessions/:id/extend | Extend session |
| DELETE | /api/sessions/:id | Close session |

### Organizations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/orgs | List organizations |
| POST | /api/orgs | Create organization |
| PATCH | /api/orgs/:id | Update organization |
| GET | /api/orgs/:id/devices | List org devices |
| GET | /api/orgs/:id/users | List org members |

### System
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/health | System health check |
| GET | /api/audit | Audit event log |
| GET | /api/logs | Activity logs |
| GET | /api/logs/stats | Activity statistics |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| DATABASE_URL | - | PostgreSQL connection string (via PgBouncer on port 6432) |
| REDIS_URL | redis://localhost:6379 | Redis connection string |
| JWT_SECRET | - | JWT signing secret (min 32 chars) |
| JWT_EXPIRES_IN | 15m | Access token expiry |
| REFRESH_TOKEN_EXPIRES_IN | 7d | Refresh token expiry |
| PORT | 3001 | Backend server port |
| NODE_ENV | development | Environment |
| CORS_ORIGIN | http://localhost:3000 | Allowed CORS origins |
| NEXT_PUBLIC_API_URL | http://localhost:3001/api | Frontend API base URL |
| NEXT_PUBLIC_WS_URL | ws://localhost:3001 | Frontend WebSocket URL |
| NEXT_PUBLIC_TUNNEL_DOMAIN | tunnel.localhost | Tunnel proxy domain |

## Building for Production

### Backend
```bash
cd packages/backend
pnpm build
pnpm start:prod
```

### Frontend
```bash
cd packages/frontend
pnpm build
pnpm start
```

### Agent (Cross-compile for ARM)
```bash
./scripts/build-agent.sh
# Output: agent/target/armv7-unknown-linux-musleabihf/release/nucleus-agent
```

## Contributing

1. Create a feature branch
2. Make changes following the code style
3. Ensure all endpoints have Zod validation
4. Update the shared types if adding new APIs
5. Test locally with `pnpm dev`
6. Submit a pull request

## License

Proprietary - All rights reserved.
