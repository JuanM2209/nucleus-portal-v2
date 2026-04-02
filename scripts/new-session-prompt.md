Proyecto: Z:\nucleus-portal — Nucleus Portal (Enterprise IoT Remote Access)

## Boot Context

Lee estos archivos para contexto completo antes de responder:

1. `Z:\nucleus-portal\CLAUDE.md` — Arquitectura, módulos, rutas, stack
2. `Z:\nucleus-portal\scripts\session-context.md` — Resumen compacto del proyecto
3. `Z:\NucleusVault\Nucleus\01-API-Endpoints.md` — 40+ endpoints REST + WS
4. `Z:\NucleusVault\Nucleus\02-Database-Schema.md` — 20 tablas PostgreSQL
5. `Z:\NucleusVault\Nucleus\04-Agent-Protocol.md` — 30+ mensajes WS (Rust agent)

## Estado Producción

- Frontend: https://portal.datadesng.com → localhost:3000 (Next.js dev via Cloudflare Tunnel)
- Backend: https://api.datadesng.com → localhost:3001 (NestJS via Cloudflare Tunnel)
- Cloudflare Tunnel: `agente-rs-public` (ID: 8825530a-d505-4d9e-bd15-bbc1b85c1f15)
- Config: C:\Users\JML\.cloudflared\config.yml
- Agent Docker: ghcr.io/juanm2209/nucleus-agent:r19

## Procesos Locales

```bash
# Verificar servicios
curl -s http://localhost:3001/api/health   # Backend health
curl -s http://localhost:3000/ -o /dev/null -w "%{http_code}"  # Frontend
docker ps                                   # Postgres, PgBouncer, Redis
cloudflared tunnel list                     # Cloudflare tunnels
netstat -ano | grep -E ":3000|:3001"       # Procesos Node.js
```

## Dispositivos Conocidos

- N-1065 — Device principal, IP 192.168.41.1 (Cockpit :9090, Node-RED :1880)
- Serial en: /data/nucleus/factory/nucleus_serial_number

## Issues Conocidos

- Frontend corre en DEV mode (pnpm dev), no production build
- Si el spinner aparece negro/gigante → cache .next corrupta → kill proceso + rm -rf .next + restart
- Cloudflare tunnels corren desde esta máquina Windows (no VPS remoto)
- Org delete es HARD DELETE (cascade orgDevices + orgUsers)
- Slug duplicado en org → ConflictException 409

## Obsidian Vault

Todas las notas en Z:\NucleusVault\Nucleus\ (00-Overview hasta 07-Security + ADR + Runbooks + Changelog).
Después de hacer cambios, actualizar la nota correspondiente.

---

Confirma que leíste los 5 archivos y da un resumen de 1 línea de cada uno.
