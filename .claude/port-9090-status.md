# Port 9090 Stabilization Status

## Date: 2026-03-30

## Status: FUNCTIONAL — 6/7 tabs working, Terminal rendering issue pending

## Active Session
- Device: N-1065 (26902cd6-b72b-496e-9326-59517775a95b)
- Port: 9090 (Cockpit v190)
- Proxy URL: https://api.datadesng.com/proxy/7a987bdfe0f68c50b89724b173b9b319/
- Credentials: admin / NN1065TYSSSMTX

## Architecture (Current)
- **6 pool bridges** + 1 comms bridge per exposure
- **Comms bridge**: persistent (no FIFO timeout), connection replacement on reload
- **Cache warm-up**: 20 critical Cockpit resources prefetched sequentially
- **Injected scripts**: URL rewrite (fetch/XHR/WebSocket/EventSource/DOM), CSS retry, auto-reconnect, blank shell recovery
- **All injection scripts**: iframe-safe (`window !== window.top` guard)

## Root Causes Fixed
1. **PostgresError on non-UUID session IDs** — pool/comms bridge IDs like `exposureId-pool-0` failed DB update. Fix: skip DB update for non-UUID IDs.
2. **10s session timeout on 12s RTT cellular** — comms bridge creation failed. Fix: 30s timeout with 2 retries.
3. **60s absolute timeout on comms bridge** — WebSocket died at exactly 60s. Fix: persistent flag skips all timeouts.
4. **FIFO queue blocking on comms bridge** — new WS connections queued forever behind the old one. Fix: persistent bridge replacement evicts old connection.
5. **Stale Cockpit sessions exhausting device** — too many failed attempts left Cockpit in bad state. Fix: close all sessions before creating new ones.
6. **Injection scripts running in iframes** — forceWS and recovery scripts fired in Cockpit module iframes, corrupting transport. Fix: `window !== window.top` guard.
7. **forceWS script corrupting cockpit.transport** — calling `cockpit.spawn()` before transport initialization broke `transport.wait()`. Fix: removed forceWS entirely.
8. **3-bridge pool insufficient** — burst of ~20 concurrent requests caused 500 errors. Fix: 6-bridge pool.
9. **CSS SecurityError** — `l.sheet.cssRules` throws on cross-origin stylesheets. Fix: try-catch wrapper.

## Known Issues
- **Terminal tab**: xterm.js element exists in DOM but renders white/blank. Module loaded (720 bytes HTML), terminal.js loaded. Likely CSS/sizing issue in Cockpit v190 through proxy. All other 6 tabs work perfectly.

## Git
- Branch: `feat/port-9090-stabilization`
- Commit: f7be5f7
- Files changed: 13 (+1501/-227 lines)

## Key Files
- `packages/backend/src/tunnels/tunnel-proxy.service.ts` — Main proxy with URL rewrite, cache, retry, injection
- `packages/backend/src/tunnels/stream-bridge.service.ts` — FIFO bridge pool with persistent flag
- `packages/backend/src/tunnels/exposure.service.ts` — Shared exposure model with ref counting
- `packages/backend/src/agent-gateway/agent-gateway.gateway.ts` — Pool bridge rebuild, session ID handling
