import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { WsAdapter } from '@nestjs/platform-ws';
import { TunnelProxyService } from './tunnels/tunnel-proxy.service';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';
import type { IncomingMessage, ServerResponse } from 'http';
import * as http from 'http';
import type { Socket } from 'net';

// Prevent backend crashes from unhandled exceptions in bridge/tunnel system.
// Socket errors, WebSocket write failures, and TCP connection resets can throw
// outside of try-catch blocks (e.g., in setTimeout callbacks, event handlers).
// Without these handlers, the entire backend process exits on any unhandled error.
process.on('uncaughtException', (err) => {
  console.error('[nucleus] UNCAUGHT EXCEPTION (process survived):', err.message);
  console.error(err.stack);
});
process.on('unhandledRejection', (reason) => {
  console.error('[nucleus] UNHANDLED REJECTION (process survived):', reason);
});

async function bootstrap() {
  const port = process.env.PORT || 3001;

  // ── Startup validation for critical secrets ──
  const jwtSecret = process.env.JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    console.error('[nucleus] FATAL: JWT_SECRET must be set and at least 32 characters');
    process.exit(1);
  }
  if (/dev.?secret|change.?this|default/i.test(jwtSecret)) {
    console.warn('[nucleus] WARNING: JWT_SECRET appears to be a development placeholder — rotate before production!');
  }

  console.log('[nucleus] Starting backend...');
  console.log(`[nucleus] NODE_ENV=${process.env.NODE_ENV ?? 'not set'}`);
  console.log(`[nucleus] Database: ${process.env.DATABASE_URL ? 'configured' : 'NOT configured'}`);
  console.log(`[nucleus] Redis: ${process.env.REDIS_URL ? 'configured' : 'NOT configured'}`);

  let app;
  try {
    app = await NestFactory.create(AppModule);
  } catch (error) {
    console.error('[nucleus] Failed to create application. Is the database running?');
    console.error(`[nucleus] Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  // HTTP security headers — relaxed for /proxy/* routes (proxied content needs iframe embedding)
  const proxyHelmet = helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: false,
    crossOriginResourcePolicy: false,
  });
  const defaultHelmet = helmet();
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    if (req.url?.startsWith('/proxy/')) {
      proxyHelmet(req, res, next);
      return;
    }
    defaultHelmet(req, res, next);
  });

  // Global exception filter for consistent error responses
  app.useGlobalFilters(new GlobalExceptionFilter());

  // Enable CORS for frontend (local + Cloudflare)
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(',').map(s => s.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    maxAge: 86400,
  });

  // Use WS adapter for WebSocket gateways
  app.useWebSocketAdapter(new WsAdapter(app));

  // Register proxy middleware on the Express instance BEFORE the global prefix,
  // so /proxy/:sessionId/* routes bypass the /api prefix entirely.
  const proxyService = app.get(TunnelProxyService);
  const expressApp = app.getHttpAdapter().getInstance();

  expressApp.all(
    '/proxy/:sessionId',
    (req: IncomingMessage, res: ServerResponse) => proxyService.handleProxy(req, res),
  );
  expressApp.all(
    '/proxy/:sessionId/*',
    (req: IncomingMessage, res: ServerResponse) => proxyService.handleProxy(req, res),
  );

  // Global prefix for REST API (excludes the proxy routes registered above)
  app.setGlobalPrefix('api');

  await app.listen(port);

  // Replace ALL upgrade listeners with a single dispatcher.
  // The NestJS WsAdapter registers its own upgrade handler that calls
  // abortHandshake(400) for non-matching paths (like /comms, /proxy/*),
  // killing the socket even when our handler should process it.
  // Solution: capture the WsAdapter's listeners, remove them, and dispatch
  // to them only for paths they should handle (/ws/agent).
  const server = app.getHttpServer();
  const existingUpgradeListeners = server.listeners('upgrade').slice();
  server.removeAllListeners('upgrade');

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
    // 1. Root /comms WebSocket (no proxy prefix) — requires session token
    if (req.url === '/comms' || req.url?.startsWith('/comms?')) {
      const url = new URL(req.url, 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      proxyService.handleCommsMock(req, socket, head, token);
      return;
    }

    // 2. All proxy WebSocket upgrades — including /proxy/{id}/comms
    //    handleUpgrade() has session-specific /comms relay logic that
    //    correctly resolves the deviceId from the session token.
    if (req.url?.startsWith('/proxy/')) {
      proxyService.handleUpgrade(req, socket, head);
      return;
    }

    // 3. Chisel tunnel proxy — /chisel
    //    Proxies WebSocket upgrade to local chisel server for TCP port forwarding.
    //    Chisel client on device connects via wss://api.datadesng.com/chisel
    if (req.url?.startsWith('/chisel')) {
      const chiselPort = process.env.CHISEL_PORT ?? '2340';
      const proxyReq = http.request({
        hostname: '127.0.0.1',
        port: parseInt(chiselPort, 10),
        path: req.url.replace(/^\/chisel/, '') || '/',
        method: req.method,
        headers: req.headers,
      });
      proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
        // Send the 101 response back to the original client
        const responseHeaders = ['HTTP/1.1 101 Switching Protocols'];
        for (const [key, val] of Object.entries(proxyRes.headers)) {
          if (val) responseHeaders.push(`${key}: ${Array.isArray(val) ? val.join(', ') : val}`);
        }
        responseHeaders.push('', '');
        socket.write(responseHeaders.join('\r\n'));
        if (proxyHead.length > 0) socket.write(proxyHead);
        // Bidirectional pipe
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
        proxySocket.on('error', () => socket.destroy());
        socket.on('error', () => proxySocket.destroy());
      });
      proxyReq.on('error', () => {
        socket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
        socket.destroy();
      });
      proxyReq.end();
      return;
    }

    // 4. Tunnel client WebSocket — /ws/tunnel?token=...
    //    Used by @nucleus/tunnel CLI for local port forwarding
    if (req.url?.startsWith('/ws/tunnel')) {
      proxyService.handleTunnelClientUpgrade(req, socket, head);
      return;
    }

    // 4. Everything else (/ws/agent, etc.) → forward to original WsAdapter handlers
    for (const listener of existingUpgradeListeners) {
      (listener as Function).call(server, req, socket, head);
    }
  });

  // ── Graceful shutdown ──
  // Allow in-flight requests to complete, close WebSocket connections cleanly,
  // and drain database connections before exiting.
  app.enableShutdownHooks();
  const shutdown = async (signal: string) => {
    console.log(`[nucleus] ${signal} received — shutting down gracefully...`);
    try {
      await app.close();
      console.log('[nucleus] Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      console.error('[nucleus] Error during shutdown:', err);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  console.log(`[nucleus] Backend running on http://localhost:${port}`);
  console.log(`[nucleus] CORS origins: ${process.env.CORS_ORIGIN || 'http://localhost:3000'}`);
}

bootstrap().catch((error) => {
  console.error('[nucleus] Unhandled bootstrap error:', error);
  process.exit(1);
});
