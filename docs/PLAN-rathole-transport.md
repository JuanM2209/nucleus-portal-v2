# Plan: Reemplazar Transport Layer con Rathole

## OUTCOME (2026-04-02)

**Rathole was implemented but FAILED.** Rathole requires a public IP with open TCP ports for its control channel (port 2333) and dynamic data ports (10000-19999). Our infrastructure runs behind Cloudflare Tunnel, which only proxies HTTP/WebSocket traffic -- not arbitrary TCP. Without a VPS or public IP with port forwarding, rathole cannot function.

**Chisel was implemented instead.** Chisel tunnels TCP over WebSocket, which passes cleanly through Cloudflare Tunnel. The chisel server runs on port 2340 on the backend host, and NestJS proxies the `/chisel` WebSocket path to it. The agent runs a ChiselManager (`chisel.rs`) that starts/stops chisel client processes for each exposed port.

**Final results:**
- 7/7 ports passing: SSH, HTTP, Modbus TCP, Node-RED, Cockpit, mbusd, EtherNet/IP
- All protocols working identically (native TCP, no base64/JSON encoding)
- Latency: ~55ms (CF Tunnel overhead vs ~30ms direct, but far better than V1's ~230ms)
- No public IP, VPS, or port forwarding required
- No laptop CLI needed -- users connect tools directly to `tunnel.datadesng.com:<remotePort>`

---

## Contexto

El portal Nucleus funciona correctamente: auth, orgs, devices, sessions, audit, UI.
El problema es el **transport layer** (tunnel.rs + stream-bridge + tunnel-proxy) que tiene
bugs recurrentes con cada nuevo port (SSH garbled, Modbus timeout, WebSocket corruption).

**Decisión:** Mantener TODO el frontend y backend de control. Solo reemplazar el pipe de datos
con Rathole — un reverse proxy TCP en Rust, probado, ~500KB, sin bugs de protocolo.

## Arquitectura Final

```
┌─────────────────────────────────────────────────────────────────┐
│                      NUCLEUS PORTAL (sin cambios)               │
│                                                                  │
│  Frontend (Next.js)     Backend (NestJS)                        │
│  ├── /login             ├── auth/                               │
│  ├── /dashboard         ├── devices/                            │
│  ├── /devices           ├── discovery/                          │
│  ├── /devices/[id]      ├── orgs/                               │
│  ├── /sessions          ├── audit/                              │
│  ├── /logs              ├── logs/                               │
│  └── /settings          ├── settings/                           │
│                         ├── agent-gateway/ (WebSocket, control) │
│                         └── tunnels/ (MODIFIED — rathole mgmt)  │
└────────────────────┬────────────────────────────────────────────┘
                     │
          Control Plane (WebSocket, como ahora)
          Solo: heartbeat, discovery, mbusd, scan
          NUEVO: port_expose / port_unexpose commands
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              DEVICE (N-1065, ARM32)                              │
│                                                                  │
│  Docker Container: remote-s                                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  nucleus-agent (Rust)          rathole client (Rust)       │  │
│  │                                                            │  │
│  │  Recibe comandos del portal:   Mantiene tunnel TCP:        │  │
│  │  - heartbeat                   - server:2333 ←→ device     │  │
│  │  - discovery                   - expone ports dinámicos    │  │
│  │  - mbusd start/stop                                        │  │
│  │  - port_expose 502  ───────→  activa port 502 en rathole  │  │
│  │  - port_unexpose 502 ──────→  desactiva port 502          │  │
│  └────────────────────────────────────────────────────────────┘  │
│                                                                  │
│  Servicios locales:                                              │
│  ├── SSH :22        ├── mbusd :2202      ├── Cockpit :9090      │
│  ├── Node-RED :1880 ├── Modbus TCP :502  ├── EtherNet/IP :44818│
│  └── HTTP :80       └── HTTPS :443       └── PLC :9999         │
└─────────────────────────────────────────────────────────────────┘
                     │
          Data Plane (TCP puro via Rathole)
          Sin base64, sin JSON, sin proxy
          ~5ms overhead
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              RATHOLE SERVER (mismo VPS del backend)              │
│                                                                  │
│  Puerto 2333: control channel (rathole ↔ devices)               │
│                                                                  │
│  Puertos dinámicos por device+port:                             │
│  ├── 10001-10099: Device 1 (ports mapped)                       │
│  ├── 10101-10199: Device 2 (ports mapped)                       │
│  └── ...                                                        │
│                                                                  │
│  Port allocation managed by backend API                         │
└─────────────────────────────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────────┐
│              LAPTOP / BROWSER del usuario                       │
│                                                                  │
│  Modbus Poll → api.datadesng.com:10502    (directo, sin CLI)   │
│  PuTTY      → api.datadesng.com:10022    (directo, sin CLI)   │
│  Browser    → https://portal.datadesng.com/proxy/abc123/       │
│               (browser proxy sigue igual para web ports)        │
└─────────────────────────────────────────────────────────────────┘
```

## Qué CAMBIA y qué NO cambia

### NO CAMBIA (mantener exactamente como está)
- Frontend completo (Next.js, todas las rutas, componentes, stores)
- Auth system (JWT, refresh tokens, tenant isolation)
- Device management (CRUD, adapters, endpoints, health)
- Organization management (orgs, users, roles)
- Audit & Activity logs
- Agent heartbeat, discovery, mbusd control
- Scanner (port scan, host discovery)
- Browser proxy para web ports (Node-RED, Cockpit via /proxy/)
- Database schema (21 tables)
- Cloudflare tunnel para el portal web

### CAMBIA
- `tunnel-proxy.service.ts` — tunnel CLI section reemplazado por rathole port management
- `stream-bridge.service.ts` — ya no necesita binary frames ni JSON proxy para tunnel CLI
- `tunnel.rs` (agent) — eliminar handle_data binary relay, agregar rathole config management
- `Export modal` (frontend) — en vez de mostrar `nucleus-tunnel` command, muestra IP:port directo
- Docker container — agregar rathole client binary (~500KB)
- Nuevo: rathole server config en el VPS

### ELIMINAR (código que causa bugs)
- `packages/tunnel-client/` — ya no se necesita nucleus-tunnel CLI
- Binary frame relay en tunnel.rs
- JSON proxy (tcp_stream_open/data/close) para tunnel CLI
- handleBinaryAgentStream en stream-bridge.service.ts
- handleGoAgentStream para tunnel CLI (mantener para browser proxy)

## Prerequisitos (lo que necesitas como usuario)

### 1. Servidor/VPS con IP pública
- Ya tienes: tu máquina Windows donde corre el backend
- Necesitas: abrir puertos TCP en el firewall/router
  - Puerto 2333: control channel de rathole
  - Rango 10000-19999: puertos dinámicos para devices
- Cloudflare: configurar DNS records para los puertos (o usar IP directa)

### 2. Rathole binaries
- Server (x86_64 Linux/Windows): descargar de GitHub releases (~1MB)
- Client (ARM32): cross-compile o descargar release ARM (~500KB)
- URL: https://github.com/rathole-org/rathole/releases

### 3. Docker buildx (ya configurado)
- Para rebuild del agent container con rathole client incluido

## Implementación Paso a Paso

### PASO 1: Instalar Rathole Server (30 min)

**Objetivo:** Rathole server corriendo en tu máquina, escuchando en puerto 2333.

```bash
# Descargar rathole para Windows
curl -L -o rathole.exe https://github.com/rathole-org/rathole/releases/download/v0.5.0/rathole-x86_64-pc-windows-msvc.zip
# Unzip y mover a PATH

# Config inicial (server.toml)
cat > rathole-server.toml << 'EOF'
[server]
bind_addr = "0.0.0.0:2333"

[server.transport]
type = "tcp"

# Services se agregan dinámicamente via backend API
EOF

# Iniciar
rathole --server rathole-server.toml
```

**Verificación:** `netstat -ano | grep 2333` muestra LISTENING

**Posibles Issues:**
- Firewall bloqueando puerto 2333 → abrir en Windows Firewall
- Cloudflare no proxea TCP arbitrario → usar IP directa o Cloudflare Spectrum (enterprise)
- Si estás detrás de NAT → necesitas port forwarding en router

### PASO 2: Agregar Rathole Client al Docker Container (2 horas)

**Objetivo:** El container del agent incluye rathole client binary.

**Archivos a modificar:**
- `infra/docker/Dockerfile.agent` — agregar rathole ARM binary
- `agent/rathole-client.toml.template` — template de config

```dockerfile
# En Dockerfile.agent, agregar:
# Descargar rathole ARM binary
ADD https://github.com/rathole-org/rathole/releases/download/v0.5.0/rathole-arm-unknown-linux-musleabihf.zip /tmp/
RUN unzip /tmp/rathole-arm-unknown-linux-musleabihf.zip -d /usr/local/bin/ && \
    chmod +x /usr/local/bin/rathole && \
    rm /tmp/*.zip
```

**Config template:**
```toml
# rathole-client.toml (generado dinámicamente por el agent)
[client]
remote_addr = "api.datadesng.com:2333"

# Services se agregan/remueven dinámicamente
# [client.services.ssh-DEVICEID]
# local_addr = "127.0.0.1:22"
```

**Posibles Issues:**
- rathole ARM binary puede ser musl o glibc → verificar compatibilidad con Debian slim
- Si rathole no tiene release ARM32 → cross-compile desde source

### PASO 3: Agent Rathole Manager (4 horas)

**Objetivo:** El agent Rust puede iniciar/parar rathole client y agregar/quitar services dinámicamente.

**Nuevo archivo:** `agent/nucleus-agent/src/rathole.rs`

```rust
/// Manages rathole client process and dynamic port configuration.
///
/// When the portal sends `port_expose`, the agent:
/// 1. Adds the service to rathole config
/// 2. Reloads rathole client (SIGHUP or restart)
///
/// When the portal sends `port_unexpose`, the agent:
/// 1. Removes the service from rathole config
/// 2. Reloads rathole client

pub struct RatholeManager {
    config_path: PathBuf,
    child: Option<Child>,
    active_services: HashMap<String, ServiceConfig>,
    server_addr: String,
}

struct ServiceConfig {
    service_name: String,  // "ssh-DEVICEID"
    local_addr: String,    // "127.0.0.1:22"
    remote_port: u16,      // 10022 (assigned by backend)
}

impl RatholeManager {
    /// Start rathole client process
    pub fn start(&mut self) -> Result<()>

    /// Add a port exposure
    pub fn expose_port(&mut self, name: &str, local_addr: &str, remote_port: u16) -> Result<()>

    /// Remove a port exposure
    pub fn unexpose_port(&mut self, name: &str) -> Result<()>

    /// Regenerate config file and reload rathole
    fn reload(&mut self) -> Result<()>

    /// Stop rathole client
    pub fn stop(&mut self)
}
```

**Nuevos mensajes WebSocket:**
```rust
// ServerToAgent
PortExpose { service_name: String, local_addr: String, remote_port: u16 }
PortUnexpose { service_name: String }

// AgentToServer
PortExposed { service_name: String, remote_port: u16 }
PortUnexposeConfirm { service_name: String }
PortError { service_name: String, error: String }
```

**Posibles Issues:**
- Rathole no soporta hot-reload de config → necesita restart del proceso
- Restart causa ~1s de downtime → aceptable para port activation
- Si rathole client pierde conexión al server → auto-reconnect built-in

### PASO 4: Backend Port Allocation Service (4 horas)

**Objetivo:** Backend asigna puertos remotos únicos por device+port y envía comandos al agent.

**Nuevo archivo:** `packages/backend/src/tunnels/port-allocation.service.ts`

```typescript
@Injectable()
export class PortAllocationService {
  // Port range: 10000-19999 (10,000 ports)
  // Allocation: deviceIndex * 100 + portOffset
  // Device 0: 10000-10099
  // Device 1: 10100-10199
  // etc.

  async allocatePort(deviceId: string, targetPort: number): Promise<number>
  async releasePort(deviceId: string, targetPort: number): Promise<void>
  async getActiveAllocations(deviceId: string): Promise<PortAllocation[]>
}
```

**Nuevo tabla DB:**
```sql
CREATE TABLE port_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES devices(id),
  target_port INTEGER NOT NULL,
  remote_port INTEGER NOT NULL UNIQUE,
  service_name VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(device_id, target_port)
);
```

**Modificar:** `devices.controller.ts` — nuevos endpoints:
```
POST /devices/:id/ports/:port/expose   → allocate + send PortExpose to agent
DELETE /devices/:id/ports/:port/expose → send PortUnexpose + release
GET /devices/:id/ports                 → list active port allocations
```

**Posibles Issues:**
- Port conflicts si rathole server ya usa un puerto → check before allocate
- 10,000 ports para 10,000 devices → puede ser insuficiente si cada device expone 10+ ports
  - Solución: rango 10000-60000 (50,000 ports)
- Cleanup de ports cuando device se desconecta → cron job

### PASO 5: Rathole Server Config Management (2 horas)

**Objetivo:** Backend genera y actualiza rathole server config dinámicamente.

**Opción A: Config file + reload**
```typescript
// Backend genera rathole-server.toml con todos los services activos
// y envía SIGHUP al proceso rathole server para recargar
```

**Opción B: Rathole API (si disponible)**
```typescript
// Rathole no tiene API REST — solo config file
// Usamos config file + process restart
```

**Config generada:**
```toml
[server]
bind_addr = "0.0.0.0:2333"

[server.services.ssh-device1]
bind_addr = "0.0.0.0:10022"

[server.services.modbus-device1]
bind_addr = "0.0.0.0:10502"

[server.services.nodered-device1]
bind_addr = "0.0.0.0:11880"
```

**Posibles Issues:**
- Restart del rathole server cierra todas las conexiones activas (~1s)
  - Mitigación: solo restart cuando se agrega/quita un service
  - Los clients reconectan automáticamente
- Config file puede crecer mucho con 10,000 devices
  - Solución: solo incluir devices con ports activos

### PASO 6: Frontend — Actualizar Export Modal (2 horas)

**Objetivo:** Export modal muestra IP:port directo en vez de nucleus-tunnel command.

**Modificar:** `packages/frontend/src/components/device/export-modal.tsx`

**Antes (tunnel CLI):**
```
STEP 1 — RUN IN YOUR TERMINAL
nucleus-tunnel --token abc123 --port 2202 --local-port 2204

STEP 2 — CONNECT
Then connect Modbus Poll to localhost:2204
```

**Después (directo):**
```
CONNECTING...
Port 502 is being exposed on api.datadesng.com:10502

CONNECT YOUR TOOL
Modbus Poll → api.datadesng.com:10502
PuTTY → api.datadesng.com:10022
Browser → Open directly (no CLI needed)

[Copy Address]  [Open in Tool]
```

**Flujo del botón Export:**
1. User clicks "Export" on port 502
2. Frontend calls `POST /devices/:id/ports/502/expose`
3. Backend allocates remote port 10502
4. Backend sends `PortExpose` to agent
5. Agent configures rathole client
6. Rathole client connects to server
7. Backend returns `{ remotePort: 10502, host: "api.datadesng.com" }`
8. Modal shows: "Connect to api.datadesng.com:10502"

**Posibles Issues:**
- Latencia de setup (~2-3s para rathole connect) → mostrar spinner
- Si rathole server no es accesible → error message claro

### PASO 7: Cleanup y Migration (2 horas)

**Eliminar código deprecated:**
- `packages/tunnel-client/` — todo el directorio (nucleus-tunnel CLI)
- `tunnel.rs` → eliminar `handle_data`, `lazy_connect`, binary frame handling
- `stream-bridge.service.ts` → eliminar `handleBinaryAgentStream`, simplificar
- `tunnel-proxy.service.ts` → eliminar tunnel CLI WebSocket handler

**Mantener:**
- Browser proxy (`/proxy/:sessionId/`) para web ports (Node-RED, Cockpit)
- El browser proxy usa tcp_stream internamente — esto NO cambia
- Solo el tunnel CLI (export a laptop) usa rathole

**Posibles Issues:**
- Asegurar que browser proxy sigue funcionando después de limpiar
- Tests de regresión para Node-RED, Cockpit via browser

### PASO 8: Testing Completo (2 horas)

**Test matrix:**

| Port | Protocolo | Tool | Método |
|------|-----------|------|--------|
| 22 | SSH | PuTTY → api:10022 | Directo TCP |
| 80 | HTTP | Browser → api:10080 | Directo TCP |
| 443 | HTTPS | Browser → api:10443 | Directo TCP |
| 502 | Modbus TCP | Modbus Poll → api:10502 | Directo TCP |
| 1880 | Node-RED | Browser → /proxy/ | Browser proxy (sin cambio) |
| 2202 | mbusd RTU→TCP | Modbus Poll → api:12202 | Directo TCP |
| 9090 | Cockpit | Browser → /proxy/ | Browser proxy (sin cambio) |
| 9999 | PLC custom | Tool → api:19999 | Directo TCP |
| 44818 | EtherNet/IP | Tool → api:14818 | Directo TCP |

**Criterio de éxito:**
- Cada port funciona al primer intento (sin debugging)
- SSH session dura 30+ minutos sin desconexión
- Modbus polling dura 30+ minutos sin pérdida de datos
- Latencia < 50ms round-trip (vs ~230ms actual)

## Timeline

| Día | Paso | Horas |
|-----|------|-------|
| 1 AM | Paso 1: Rathole server setup | 0.5h |
| 1 AM | Paso 2: Docker container con rathole | 2h |
| 1 PM | Paso 3: Agent rathole manager | 4h |
| 2 AM | Paso 4: Backend port allocation | 4h |
| 2 PM | Paso 5: Server config management | 2h |
| 2 PM | Paso 6: Frontend export modal | 2h |
| 3 AM | Paso 7: Cleanup deprecated code | 2h |
| 3 PM | Paso 8: Testing matrix | 2h |
| **Total** | | **~18.5h (3 días)** |

## Riesgos y Mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|-------------|---------|------------|
| Rathole no tiene ARM32 binary | Media | Alto | Cross-compile desde source (Rust, ya tenemos toolchain) |
| Firewall bloquea puertos TCP | Alta | Alto | Usar Cloudflare Spectrum o túnel TCP dedicado |
| Rathole restart cierra conexiones | Baja | Medio | Solo restart cuando se agrega/quita service, clients auto-reconnect |
| 10K devices = 10K port ranges | Baja | Medio | Allocar ports on-demand, no pre-allocar todo |
| Browser proxy se rompe al limpiar | Media | Alto | No tocar browser proxy code, solo tunnel CLI |

## Resultado Final

Después de implementar:

| Aspecto | Antes | Después |
|---------|-------|---------|
| Nuevo port | 1-2 días debugging | 0 minutos, solo click "Export" |
| SSH | Garbled on decryption | Funciona perfecto |
| Modbus | Timeout cada ~2min | Conexión permanente |
| Latencia | ~230ms | ~30ms |
| tunnel CLI necesario | Sí | No |
| Código transport | ~2000 líneas custom | ~200 líneas (rathole management) |
| Bugs de protocolo | Frecuentes | Imposibles (TCP puro) |
