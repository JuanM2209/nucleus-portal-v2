# Agent Tab — Rust + Infra

> Scope: agent/, helper/, infra/. For full project context see /z/nucleus-portal/CLAUDE.md

## Rust Agent (agent/)
- **nucleus-agent**: Main binary — WebSocket client to backend, health metrics via sysinfo
- **nucleus-common**: Shared types (messages.rs, types.rs)

### Build
```bash
cd /z/nucleus-portal/agent
cargo build                        # debug
cargo build --release              # release (opt-level z, LTO, strip)
bash ../scripts/build-agent-v27.sh # cross-compile ARM + publish GitHub release
```

### Run
```bash
cargo run -- --config agent.example.toml
```

### Source
```
agent/
├── nucleus-agent/src/
│   ├── main.rs         Entry + tokio runtime
│   ├── config.rs       TOML config loading
│   ├── connection.rs   WebSocket connection + reconnect loop
│   ├── health.rs       CPU/mem/disk metrics (sysinfo)
│   ├── tunnel.rs       TCP port tunneling + bidirectional relay
│   ├── chisel.rs       ChiselManager — chisel client for port expose/unexpose
│   ├── comms.rs        CommsManager — WS relay to device Node-RED /comms
│   ├── mbusd.rs        MbusdManager — Modbus serial-to-TCP bridge control
│   ├── scanner.rs      Two-phase subnet scan (ARP + TCP port scan)
│   └── arp_discovery.rs ARP sweep (pnet L2) + MAC OUI vendor lookup
└── nucleus-common/src/
    ├── lib.rs          Module exports
    ├── messages.rs     WS message types (AgentMessage, ServerMessage)
    └── types.rs        Common types (DeviceInfo, HealthMetrics)
```

### Key Conventions
- tokio async — all IO is async/await
- WebSocket protocol defined in `nucleus-common/src/messages.rs`
- Must match backend `agent-gateway/` expectations
- Config via TOML (`agent.example.toml`) — never hardcode credentials
- Reconnect with exponential backoff on connection drop
- ARP discovery uses pnet crate for raw L2 sockets — requires --privileged Docker flag
- Two-phase scan: ARP sweep first, then TCP port scan only on discovered hosts
- Chisel manages reverse TCP tunnels over WebSocket (via Cloudflare Tunnel)

### Agent Version History

| Version | Tag | Key Changes |
|---------|-----|-------------|
| V24 | vr24 | Lazy TCP, stale session cleanup, mbusd bundled, keepalive ping 20s |
| V25 | vr25 | Auto-scanner on connect, scan settings UI, chisel TCP transport |
| V26 | vr26 | ARP discovery (pnet), MAC vendor OUI, two-phase scan, deep port scan (44 ports) |
| V27 | vr27 | Fix /24 subnet scan off-by-one (host_count 255 > 254), support /22-/24 subnets |

### Current Version: V27 (v0.27.0)

- Docker image: `nucleus-agent:vr27`
- GitHub Release: `JuanM2209/nucleus-agent-releases` v2.7.0
- Install: `curl -fsSL https://raw.githubusercontent.com/JuanM2209/nucleus-deploy/main/install.sh | bash`
- Docker flags: `--privileged --pid=host --network host`
- Env vars: `AGENT_SERVER_URL`, `AGENT_TOKEN`, `CHISEL_AUTH`, `CHISEL_SERVER_URL`

### Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| tokio | 1.50 | Async runtime |
| tokio-tungstenite | 0.24 | WebSocket client |
| sysinfo | 0.31 | System metrics (CPU, mem, disk) |
| serde / serde_json | 1.0 | JSON serialization |
| tracing | 0.1 | Structured logging |
| toml | 0.8 | Config file parsing |
| pnet | 0.35 | Raw packet ARP discovery |
| pnet_datalink | 0.35 | L2 network interface access |
| rustls | 0.23 | TLS for WebSocket |

## Rust Helper (helper/)
- **nucleus-helper**: Desktop client — handles tunnel connections for support sessions

### Build
```bash
cd /z/nucleus-portal/helper
cargo build --release
```

## Infrastructure (infra/)

### Start
```bash
cd /z/nucleus-portal
bash scripts/dev.sh           # starts all infra via docker compose
```

### Stop
```bash
docker compose -f infra/docker-compose.yml down
```

### Services
| Service    | Port | Image                          |
|------------|------|--------------------------------|
| Postgres   | 5432 | timescale/timescaledb:pg16     |
| PgBouncer  | 6432 | pgbouncer/pgbouncer            |
| Redis      | 6379 | redis:7-alpine                 |

### DB Init
- Schema + seed: `infra/db/init.sql` (auto-run on first Postgres start)
- Drizzle migrations: `pnpm db:migrate` from project root

### Docker Builds
```bash
docker build -f infra/docker/Dockerfile.backend -t nucleus-backend .
docker build -f infra/docker/Dockerfile.frontend -t nucleus-frontend .
```
