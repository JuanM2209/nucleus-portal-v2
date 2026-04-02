import { Injectable, Inject, Logger, OnModuleInit } from '@nestjs/common';
import { DATABASE } from '../database/database.module';
import { accessSessions } from '../database/schema';
import { StreamBridgeService } from './stream-bridge.service';
import { AgentRegistryService } from '../agent-gateway/agent-registry.service';
import { CommsRelayService } from './comms-relay.service';
import { randomBytes } from 'crypto';
import { gunzipSync, brotliDecompressSync, inflateSync } from 'zlib';
import { eq, and, desc } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-var-requires
import httpProxy = require('http-proxy');
import * as http from 'http';
import * as net from 'net';
import * as WebSocket from 'ws';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Socket } from 'net';

/** Cached response entry */
interface CachedResponse {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
  cachedAt: number;
  size: number;
}

/** Extensions that are safe to cache (static assets) */
const CACHEABLE_EXTENSIONS = new Set([
  '.js', '.css', '.map', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico',
  '.woff', '.woff2', '.ttf', '.eot',
]);

/** Max cache size in bytes (50MB) */
const MAX_CACHE_SIZE = 50 * 1024 * 1024;

/** Cache TTL in ms (10 minutes) */
const CACHE_TTL = 10 * 60 * 1000;

/** Max proxy retries for FIFO bridge contention */
const MAX_PROXY_RETRIES = 6; // More retries for cellular link with high latency

/**
 * Client-side URL rewrite script injected into proxied HTML pages.
 * Monkey-patches fetch, XHR, WebSocket, EventSource, History API,
 * and element src/href setters to prepend the /proxy/{token} prefix
 * to root-relative URLs. Self-extracts prefix from window.location.
 *
 * SAFETY: No-ops if not loaded through /proxy/{hex-token}/.
 * Does not affect relative URLs, protocol-relative, absolute, data:, blob:.
 */
const PROXY_REWRITE_SCRIPT = `(function(){
var m=/^\\/proxy\\/([a-f0-9]{16,})\\//i.exec(location.pathname);
if(!m)return;
var P="/proxy/"+m[1];
var H=location.protocol+"//"+location.host;
var WH=(location.protocol==="https:"?"wss:":"ws:")+"//"+location.host;
function rw(u){
if(typeof u!=="string"||!u)return u;
if(u[0]==="/"&&u[1]!=="/"){if(u.indexOf(P+"/")=== 0)return u;return P+u;}
if(u.indexOf(H+"/")=== 0){var p=u.substring(H.length);if(p.indexOf(P+"/")=== 0)return u;return H+P+p;}
if(u.indexOf(WH+"/")=== 0){var w=u.substring(WH.length);if(w.indexOf(P+"/")=== 0)return u;return WH+P+w;}
return u;
}
var _f=window.fetch;
window.fetch=function(i,o){
if(typeof i==="string")i=rw(i);
else if(i instanceof Request){var n=rw(i.url);if(n!==i.url)i=new Request(n,i);}
return _f.call(this,i,o);
};
var _x=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(){
var a=Array.prototype.slice.call(arguments);
if(typeof a[1]==="string")a[1]=rw(a[1]);
return _x.apply(this,a);
};
if(window.WebSocket){
var _W=window.WebSocket;
window.WebSocket=function(u,p){return new _W(rw(u),p);};
window.WebSocket.prototype=_W.prototype;
window.WebSocket.CONNECTING=_W.CONNECTING;
window.WebSocket.OPEN=_W.OPEN;
window.WebSocket.CLOSING=_W.CLOSING;
window.WebSocket.CLOSED=_W.CLOSED;
}
if(window.EventSource){
var _E=window.EventSource;
window.EventSource=function(u,o){return new _E(rw(u),o);};
window.EventSource.prototype=_E.prototype;
}
var _ps=history.pushState,_rs=history.replaceState;
history.pushState=function(s,t,u){return _ps.call(this,s,t,typeof u==="string"?rw(u):u);};
history.replaceState=function(s,t,u){return _rs.call(this,s,t,typeof u==="string"?rw(u):u);};
function pa(C,a){
var d=Object.getOwnPropertyDescriptor(C.prototype,a);
if(!d||!d.set)return;
Object.defineProperty(C.prototype,a,{get:d.get,set:function(v){d.set.call(this,rw(v));},enumerable:d.enumerable,configurable:d.configurable});
}
[HTMLScriptElement,HTMLImageElement,HTMLAudioElement,HTMLVideoElement,HTMLSourceElement,HTMLIFrameElement,HTMLEmbedElement].forEach(function(C){if(C)pa(C,"src");});
[HTMLLinkElement,HTMLAnchorElement,HTMLAreaElement].forEach(function(C){if(C)pa(C,"href");});
if(HTMLFormElement)pa(HTMLFormElement,"action");
})();`;

/** Base delay between retries in ms (multiplied by attempt number) */
const RETRY_BASE_DELAY_MS = 400; // Reduced for cellular — faster retries before Cloudflare gives up

@Injectable()
export class TunnelProxyService implements OnModuleInit {
  private readonly logger = new Logger(TunnelProxyService.name);
  private proxy!: httpProxy;

  /**
   * In-memory cache for static assets proxied through the agent tunnel.
   * Key format: `${targetIp}:${targetPort}${path}`
   * This dramatically speeds up page loads after the first request since
   * large files like vendor.js don't need to traverse the WS tunnel again.
   */
  private readonly responseCache = new Map<string, CachedResponse>();
  private currentCacheSize = 0;
  /** Last known Cockpit content hash — discovered from proxy responses */
  private cockpitContentHash: string | null = null;

  constructor(
    @Inject(DATABASE) private readonly db: any,
    private readonly streamBridge: StreamBridgeService,
    private readonly agentRegistry: AgentRegistryService,
    private readonly commsRelay: CommsRelayService,
  ) {}

  onModuleInit() {
    this.proxy = httpProxy.createProxyServer({
      changeOrigin: true,
      ws: true,
      secure: false,
      xfwd: true,
      // NOTE: Using default http agent (keep-alive). The FIFO bridge handles
      // serialization — multiple TCP connections are queued and processed one at a time.
    });

    this.proxy.on('error', (err: Error, req: IncomingMessage, res: ServerResponse | Socket) => {
      const attempt = (req as any).__proxyAttempt ?? 0;
      const session = (req as any).__proxySession;
      const sessionId = (req as any).__proxySessionId;
      const targetPath = (req as any).__proxyTargetPath;

      // For HTTP requests (not WebSocket), retry on connection errors
      if ('writeHead' in res && typeof res.writeHead === 'function') {
        const isRetryable = /ECONNREFUSED|ECONNRESET|EPIPE|ETIMEDOUT|socket hang up/.test(err.message);
        if (isRetryable && attempt < MAX_PROXY_RETRIES && session && sessionId && targetPath) {
          const nextAttempt = attempt + 1;
          const delay = RETRY_BASE_DELAY_MS * nextAttempt + Math.random() * 200;
          this.logger.warn(
            `Proxy retry ${nextAttempt}/${MAX_PROXY_RETRIES} for ${targetPath} (${err.message}) in ${Math.round(delay)}ms`,
          );
          setTimeout(() => {
            // Re-set the original URL so handleProxy regex matches again
            req.url = `/proxy/${sessionId}${targetPath}`;
            this.proxyWithRetry(req, res as ServerResponse, session, sessionId, targetPath, nextAttempt);
          }, delay);
          return;
        }

        this.logger.error(`Proxy error (attempt ${attempt + 1}): ${err.message} for ${targetPath}`);
        if (!res.headersSent) {
          // Return an auto-retry HTML page instead of a plain 502.
          // Cockpit loads modules in iframes; if the iframe gets a 502 (from
          // Cloudflare tunnel contention), the module is permanently broken
          // until the user manually reloads. This auto-retry page retries
          // the request after a short delay, giving the tunnel time to recover.
          (res as ServerResponse).writeHead(503, {
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            'Retry-After': '2',
          });
          (res as ServerResponse).end(`<!DOCTYPE html><html><head>
<meta http-equiv="refresh" content="2">
<script>setTimeout(function(){location.reload()},2000);</script>
</head><body style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#666">
<div>Loading... <small>(retrying)</small></div>
</body></html>`);
        }
      } else {
        // Socket (WebSocket upgrade) - destroy it
        this.logger.error(`Proxy WS error: ${err.message}`);
        (res as Socket).destroy();
      }
    });

    this.proxy.on('proxyRes', (proxyRes, req, res) => {
      this.logger.debug(`Proxied ${req.method} ${req.url} -> ${proxyRes.statusCode}`);

      // Prevent Cloudflare from caching error responses from the device.
      // A transient 500/502/503 from bridge contention would otherwise get
      // cached by Cloudflare, making the tab permanently broken until the
      // CF cache expires (typically 1-5 min). no-store ensures every retry
      // reaches the origin.
      if (proxyRes.statusCode && proxyRes.statusCode >= 400) {
        proxyRes.headers['cache-control'] = 'no-store, no-cache, must-revalidate';
      }

      // ── Retry 500 responses for GET requests (bridge contention) ──
      // When the FIFO bridge is saturated, it returns 500 for requests it
      // can't process. For idempotent GET requests to cacheable assets,
      // retry transparently instead of showing 500 to the browser.
      const retryAttempt = (req as any).__proxyAttempt ?? 0;
      const retrySession = (req as any).__proxySession;
      const retrySid = (req as any).__proxySessionId;
      const retryPath = (req as any).__proxyTargetPath;

      // Don't retry the root page — a 500 on "/" is likely Cockpit's "protocol-error"
      // (session exhaustion), not bridge contention. Retrying won't help and delays
      // the user seeing the recovery page.
      const isRootPage = retryPath === '/' || retryPath === '';
      if (
        proxyRes.statusCode === 500 &&
        req.method === 'GET' &&
        retryAttempt < MAX_PROXY_RETRIES &&
        retrySession && retrySid && retryPath &&
        this.isCacheablePath(retryPath) &&
        !isRootPage
      ) {
        const nextAttempt = retryAttempt + 1;
        const delay = RETRY_BASE_DELAY_MS * nextAttempt + Math.random() * 100;
        this.logger.warn(
          `Proxy 500 retry ${nextAttempt}/${MAX_PROXY_RETRIES} for ${retryPath} in ${Math.round(delay)}ms`,
        );
        // CRITICAL: Prevent http-proxy from piping the 500 response to the client.
        // We unpipe proxyRes from res and consume the 500 body ourselves.
        proxyRes.unpipe(res);
        proxyRes.resume(); // drain the 500 body
        // Schedule retry — the response hasn't been written to the client yet
        setTimeout(() => {
          if (res.headersSent || res.writableEnded) {
            this.logger.warn(`Response already sent for ${retryPath}, cannot retry`);
            return;
          }
          req.url = `/proxy/${retrySid}${retryPath}`;
          this.proxyWithRetry(req, res, retrySession, retrySid, retryPath, nextAttempt);
        }, delay);
        return;
      }

      // ── Cockpit protocol-error early detection ──
      // When Cockpit returns 500 for the root page, it's a session exhaustion error.
      // Intercept it here and return a friendly recovery page immediately.
      if (proxyRes.statusCode === 500 && isRootPage) {
        this.logger.warn(`Cockpit 500 on root page — likely protocol-error (session ${retrySid})`);
        proxyRes.unpipe(res);
        proxyRes.resume();
        const portalUrl = process.env.PORTAL_URL || 'https://portal.datadesng.com';
        const recoveryHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connecting...</title>
<style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:3rem;border-radius:16px;background:#16213e;box-shadow:0 8px 32px rgba(0,0,0,0.4);max-width:420px;width:90%}
h1{color:#4fc3f7;margin-bottom:0.5rem;font-size:1.4rem}
p{color:#9e9e9e;margin:1rem 0;line-height:1.6;font-size:0.95rem}
.spinner{margin:1.5rem auto;width:36px;height:36px;border:4px solid #4fc3f722;border-top:4px solid #4fc3f7;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.btn{display:inline-block;margin:0.4rem;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;cursor:pointer;border:none;font-size:0.9rem;transition:all 0.2s}
.primary{background:#4fc3f7;color:#1a1a2e}.primary:hover{background:#81d4fa}
.secondary{background:transparent;color:#4fc3f7;border:2px solid #4fc3f744}.secondary:hover{border-color:#4fc3f7}
#status{color:#66bb6a;font-size:0.85rem;min-height:1.2rem}
</style></head><body><div class="card">
<h1>Connecting to Device...</h1>
<p>The device is processing your request. This usually takes a few seconds on the first connection.</p>
<div class="spinner" id="spin"></div>
<div id="status">Retrying automatically...</div>
<div id="btns" style="display:none;margin-top:1rem">
<button class="btn primary" onclick="location.reload()">Retry</button>
<a class="btn secondary" href="${portalUrl}">Portal</a>
</div>
<script>var n=0;function go(){n++;document.getElementById('status').textContent='Attempt '+n+'...';setTimeout(function(){location.reload()},3000);}setTimeout(go,4000);setTimeout(function(){document.getElementById('spin').style.display='none';document.getElementById('btns').style.display='block';document.getElementById('status').textContent='Still connecting — you can retry or go back.';},20000);</script>
</div></body></html>`;
        const buf = Buffer.from(recoveryHtml, 'utf-8');
        if (!res.headersSent) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': String(buf.length), 'Cache-Control': 'no-cache' });
          res.end(buf);
        }
        return;
      }

      // Strip security headers from upstream targets that would block proxy rendering.
      const headersToRemove = [
        'content-security-policy',
        'content-security-policy-report-only',
        'x-frame-options',
        'x-content-type-options',
        'cross-origin-opener-policy',
        'cross-origin-resource-policy',
        'cross-origin-embedder-policy',
      ];
      for (const h of headersToRemove) {
        delete proxyRes.headers[h];
      }

      // Inject safe replacement headers — prevent token leakage via Referer
      proxyRes.headers['referrer-policy'] = 'no-referrer';
      proxyRes.headers['x-content-type-options'] = 'nosniff';

      // ── Rewrite Set-Cookie Path to include /proxy/{token} prefix ──
      // Upstream services (like Cockpit) set cookies with Path=/cockpit.
      // But through our proxy, the browser URL is /proxy/{token}/cockpit/...
      // Without rewriting, the browser won't send the cookie back because
      // /proxy/{token}/cockpit/socket doesn't match Path=/cockpit.
      const proxySessionId = (req as any).__proxySessionId;
      const proxyResSessionId = (req as any).__proxySessionId;
      if (proxyResSessionId && proxyRes.headers['set-cookie']) {
        const prefix = `/proxy/${proxyResSessionId}`;
        const cookies = Array.isArray(proxyRes.headers['set-cookie'])
          ? proxyRes.headers['set-cookie']
          : [proxyRes.headers['set-cookie']];
        proxyRes.headers['set-cookie'] = cookies
          .filter((cookie: string) => {
            // Skip "deleted" cookie headers — Cockpit sends "cockpit=deleted"
            // to clear old sessions. If we rewrite its Path, the browser keeps
            // both the deletion marker AND the real cookie under the same path,
            // sending "cockpit=deleted" first which causes Cockpit to return 403.
            if (/=deleted\b/.test(cookie.split(';')[0])) {
              this.logger.debug(`Set-Cookie SKIP deletion: ${cookie.substring(0, 50)}`);
              return false;
            }
            return true;
          })
          .map((cookie: string) => {
            const rewritten = cookie.replace(/;\s*[Pp]ath=([^;]*)/g, (_match: string, p: string) => {
              return `; Path=${prefix}${p.trim()}`;
            });
            this.logger.log(`Set-Cookie rewrite: ${cookie.substring(0, 60)}... → Path=${prefix}/...`);
            return rewritten;
          });
      }

      // ── Push deploy notification to /comms when POST /flows succeeds ──
      const origUrl = (req as any).__proxyTargetPath || req.url || '';
      if (req.method === 'POST' && origUrl.match(/^\/flows/) && proxyRes.statusCode === 200) {
        // Invalidate cached /flows data so next GET returns fresh state
        const session = (req as any).__proxySession;
        if (session) {
          const flowsCacheKey = `${session.targetIp}:${session.targetPort}/flows`;
          const flowsStateCacheKey = `${session.targetIp}:${session.targetPort}/flows/state`;
          for (const key of [flowsCacheKey, flowsStateCacheKey]) {
            const cached = this.responseCache.get(key);
            if (cached) {
              this.currentCacheSize -= cached.size;
              this.responseCache.delete(key);
            }
          }
        }

        // NOTE: Do NOT broadcast deploy notifications from the backend.
        // Node-RED sends its own notification/runtime-deploy through /comms.
        // A backend broadcast would duplicate it, causing "flows have been updated"
        // banner even for single-user sessions.
      }

      // ── Inject URL rewrite script + <base href> into proxied HTML responses ──
      // The PROXY_REWRITE_SCRIPT monkey-patches fetch, XHR, WebSocket, etc. to
      // prepend /proxy/{token}/ to root-relative URLs. The <base href> handles
      // relative paths. Together they make ANY SPA work through the proxy.
      const sessionId = (req as any).__proxySessionId;
      const contentType = proxyRes.headers['content-type'] || '';
      const isHtmlPage = contentType.includes('text/html');

      if (isHtmlPage && sessionId && 'writeHead' in res && typeof (res as any).writeHead === 'function') {
        const serverRes = res as ServerResponse;
        const chunks: Buffer[] = [];
        const origEnd = serverRes.end.bind(serverRes);

        // Capture the original content-encoding before stripping it
        const contentEncoding = (proxyRes.headers['content-encoding'] || '').toLowerCase();

        // Remove content-length and content-encoding since we're modifying the body
        delete proxyRes.headers['content-length'];
        delete proxyRes.headers['content-encoding'];

        // Buffer chunks until end
        (serverRes as any).write = (chunk: any) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          return true;
        };

        (serverRes as any).end = (chunk: any) => {
          if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          let rawBody = Buffer.concat(chunks);

          // Decompress if the upstream sent compressed content
          if (contentEncoding === 'gzip' || contentEncoding === 'x-gzip') {
            try { rawBody = gunzipSync(rawBody); } catch (e) {
              this.logger.warn(`Failed to gunzip HTML response: ${(e as Error).message}`);
            }
          } else if (contentEncoding === 'br') {
            try { rawBody = brotliDecompressSync(rawBody); } catch (e) {
              this.logger.warn(`Failed to brotli-decompress HTML response: ${(e as Error).message}`);
            }
          } else if (contentEncoding === 'deflate') {
            try { rawBody = inflateSync(rawBody); } catch (e) {
              this.logger.warn(`Failed to inflate HTML response: ${(e as Error).message}`);
            }
          }

          let html = rawBody.toString('utf-8');

          const proxyPrefix = `/proxy/${sessionId}`;

          // Server-side: rewrite static src="/..." and href="/..." in HTML attributes
          // so <script src="/js/app.js"> becomes <script src="/proxy/{token}/js/app.js">
          // (the client-side script only catches dynamic element creation, not static HTML)
          html = html.replace(/((?:src|href|action)\s*=\s*["'])\/(?!\/|proxy\/)/gi, `$1${proxyPrefix}/`);

          // Also rewrite url("/...") in inline styles and CSS
          html = html.replace(/(url\s*\(\s*["']?)\/(?!\/|proxy\/)/gi, `$1${proxyPrefix}/`);

          const rewriteTag = `<script>${PROXY_REWRITE_SCRIPT}</script>`;
          // NOTE: Do NOT inject <base href> — it breaks applications like Cockpit
          // that use relative URLs (e.g., src="index.js") resolved against the
          // current page path (like /cockpit/@localhost/system/).
          // The <base> tag would change the base to /proxy/{id}/ and break those.
          // Instead, we rely on the client-side rewrite script for dynamic URLs
          // and the server-side regex (above) for static HTML attributes.

          // Cockpit script ordering fix: Cockpit v190 loads cockpit.js (the base
          // library providing the `cockpit` global and jQuery) before shell/index.js.
          // Through the tunnel bridge, concurrent script loads can cause cockpit.js
          // to arrive AFTER index.js (or fail with 503 from bridge contention),
          // crashing the shell with "cockpit is not defined".
          //
          // Fix: Block ALL non-cockpit.js scripts, wait for cockpit.js to define
          // the `cockpit` global, and retry loading cockpit.js if it fails.
          // Detect Cockpit "protocol-error" page — happens when the device's
          // cockpit-ws has too many stale sessions. Instead of showing the raw
          // error page, show a user-friendly recovery page with auto-retry.
          if (html.includes('<title>protocol-error</title>') || (proxyRes.statusCode === 500 && html.includes('protocol-error'))) {
            const portalUrl = process.env.PORTAL_URL || 'https://portal.datadesng.com';
            this.logger.warn(`Cockpit protocol-error detected for session ${sessionId} — showing recovery page`);
            const recoveryHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Connection Issue</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:3rem;border-radius:12px;background:#16213e;box-shadow:0 4px 24px rgba(0,0,0,0.3);max-width:450px}
h1{color:#ff8a65;margin-bottom:0.5rem;font-size:1.5rem}p{color:#9e9e9e;margin:1rem 0;line-height:1.6}
.btn{display:inline-block;margin:0.5rem;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;cursor:pointer;border:none;font-size:1rem;transition:all 0.2s}
.retry{background:#4fc3f7;color:#1a1a2e}.retry:hover{background:#81d4fa}
.portal{background:transparent;color:#4fc3f7;border:2px solid #4fc3f7}.portal:hover{background:#4fc3f71a}
.spinner{display:none;margin:1rem auto;width:24px;height:24px;border:3px solid #4fc3f733;border-top:3px solid #4fc3f7;border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
#status{color:#66bb6a;display:none;margin-top:1rem}</style></head>
<body><div class="card"><h1>Connection Issue</h1>
<p>The device is temporarily busy. This usually resolves in a few seconds.</p>
<div class="spinner" id="spinner"></div>
<div id="status"></div>
<div id="buttons">
<button class="btn retry" onclick="retry()">Retry Now</button>
<a class="btn portal" href="${portalUrl}">Back to Portal</a></div>
<script>
var retries=0;
function retry(){
  retries++;
  document.getElementById('spinner').style.display='block';
  document.getElementById('buttons').style.display='none';
  document.getElementById('status').style.display='block';
  document.getElementById('status').textContent='Retrying... (attempt '+retries+')';
  setTimeout(function(){location.reload();},2000);
}
setTimeout(function(){retry();},5000);
</script></div></body></html>`;
            const recoveryBuf = Buffer.from(recoveryHtml, 'utf-8');
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Content-Length': String(recoveryBuf.length),
              'Cache-Control': 'no-cache, no-store',
            });
            res.end(recoveryBuf);
            return;
          }

          const isCockpitShell = html.includes('cockpit') && (html.includes('index.js') || html.includes('shell'));
          // Script blocking removed — was interfering with Cockpit transport initialization.
          // The 6-bridge pool + cache warm-up ensures resources load fast enough that
          // cockpit.js always completes before shell/index.js executes.
          const jqueryWaitScript = '';

          // CSS retry fix: stylesheets that fail with 503 from bridge contention
          // leave the page unstyled. This script retries loading failed <link rel="stylesheet">
          // elements after a short delay, giving the bridge queue time to drain.
          const cssRetryScript = isCockpitShell
            ? `<script>(function(){function retryCSS(){document.querySelectorAll('link[rel="stylesheet"]').forEach(function(l){try{if(!l.sheet||l.sheet.cssRules.length===0){var n=document.createElement('link');n.rel='stylesheet';n.href=l.href;n.onload=function(){l.remove();};l.parentNode.insertBefore(n,l.nextSibling);}}catch(e){}});};setTimeout(retryCSS,2000);setTimeout(retryCSS,5000);})();</script>`
            : '';

          // Auto-reconnect fix: Cockpit shows "Disconnected — Server has closed
          // the connection" when the /cockpit/socket WebSocket drops (Cloudflare idle
          // timeout ~100s). The user must manually click "Reconnect" to recover.
          // This script automatically detects the disconnect dialog and clicks
          // Reconnect after a 3-second delay, making recovery transparent.
          const autoReconnectScript = isCockpitShell
            ? `<script>(function(){if(window!==window.top)return;var attempts=0;var max=10;setInterval(function(){var btns=document.querySelectorAll('button');var reconnectBtn=null;btns.forEach(function(b){if(b.textContent.trim()==='Reconnect'&&b.offsetHeight>0)reconnectBtn=b;});if(reconnectBtn){if(attempts<max){attempts++;console.log('[nucleus] Auto-reconnecting ('+attempts+'/'+max+')');reconnectBtn.click();}else if(attempts===max){attempts++;console.log('[nucleus] Max reconnect attempts — reloading page');location.reload();}}else{attempts=0;}},3000);})();</script>`
            : '';

          // Force WebSocket + shell recovery. Top-frame only.
          // Cockpit v190's transport is lazy — it reads init data from the shell HTML
          // but doesn't open the /cockpit/socket WebSocket until a channel is requested.
          // Through the proxy, the iframe→parent postMessage channel that normally
          // triggers the WebSocket doesn't fire reliably. Fix: after the shell loads,
          // call cockpit.spawn() to force the WebSocket open. Uses jQuery Deferred
          // syntax (.done/.fail) — NOT .then() which breaks on Cockpit's Deferred.
          // If the shell is still blank after 15s despite forceWS, reload the page.
          const shellBootstrap = isCockpitShell
            ? `<script>(function(){if(window!==window.top)return;var forced=false;var t0=Date.now();var iv=setInterval(function(){var age=Date.now()-t0;if(!forced&&typeof cockpit!=='undefined'&&cockpit.spawn){forced=true;try{cockpit.spawn(['true'],{host:'localhost'}).done(function(){console.log('[nucleus] WebSocket connected');}).fail(function(){console.log('[nucleus] WebSocket spawn failed — will retry');forced=false;});}catch(e){forced=false;}}if(age>15000&&document.title==='Cockpit'){clearInterval(iv);console.log('[nucleus] Shell still blank after 15s — reloading');location.reload();}if(document.title!=='Cockpit'&&document.title.indexOf('N-1065')!==-1){clearInterval(iv);}},2000);})();</script>`
            : '';

          const injection = rewriteTag + jqueryWaitScript + cssRetryScript + autoReconnectScript + shellBootstrap;

          // Inject into <head> if present (standard HTML documents)
          if (/<head[\s>]/i.test(html)) {
            html = html.replace(/<head([^>]*)>/i, `<head$1>${injection}`);
          } else if (html.includes('<html')) {
            // No <head> tag — inject after <html...> (e.g., Cockpit shell)
            html = html.replace(/<html([^>]*)>/i, `<html$1><head>${injection}</head>`);
          } else if (html.includes('<!DOCTYPE') || html.includes('<!doctype')) {
            // Minimal HTML — inject at the very beginning after doctype
            html = html.replace(/(<!DOCTYPE[^>]*>)/i, `$1<head>${injection}</head>`);
          } else {
            // Bare HTML fragment — prepend the injection
            html = `<head>${injection}</head>${html}`;
          }

          this.logger.log(`Injected URL rewrite script for proxy session ${sessionId}`);
          const buf = Buffer.from(html, 'utf-8');
          origEnd.call(serverRes, buf, 'utf-8', () => {});
        };

        // Don't do normal caching for rewritten HTML
        return;
      }

      // ── Cache static asset responses ──
      const cacheKey = (req as any).__cacheKey;
      if (cacheKey && proxyRes.statusCode === 200) {
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          const body = Buffer.concat(chunks);
          this.cacheResponse(cacheKey, {
            statusCode: proxyRes.statusCode!,
            headers: { ...proxyRes.headers },
            body,
            cachedAt: Date.now(),
            size: body.length,
          });
        });
      }
    });
  }

  async handleProxy(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const match = req.url?.match(/^\/proxy\/([^/]+)(\/.*)?$/);
    if (!match) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid proxy URL');
      return;
    }

    const sessionId = match[1];
    const targetPath = match[2] || '/';

    const session = await this.lookupActiveSession(sessionId);
    if (!session) {
      const portalUrl = process.env.PORTAL_URL || 'https://portal.datadesng.com';
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session Expired</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:3rem;border-radius:12px;background:#16213e;box-shadow:0 4px 24px rgba(0,0,0,0.3);max-width:400px}
h1{color:#4fc3f7;margin-bottom:0.5rem;font-size:1.5rem}p{color:#9e9e9e;margin:1rem 0}
a{display:inline-block;margin-top:1rem;padding:12px 32px;background:#4fc3f7;color:#1a1a2e;text-decoration:none;border-radius:8px;font-weight:600;transition:background 0.2s}
a:hover{background:#81d4fa}</style></head>
<body><div class="card"><h1>Session Expired</h1><p>This session is no longer active.<br>Please open the port again from the portal.</p><a href="${portalUrl}">Go to Portal</a></div></body></html>`);
      return;
    }

    if (new Date(session.expiresAt) < new Date()) {
      const portalUrl = process.env.PORTAL_URL || 'https://portal.datadesng.com';
      res.writeHead(410, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Session Expired</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:3rem;border-radius:12px;background:#16213e;box-shadow:0 4px 24px rgba(0,0,0,0.3);max-width:400px}
h1{color:#ff8a65;margin-bottom:0.5rem;font-size:1.5rem}p{color:#9e9e9e;margin:1rem 0}
a{display:inline-block;margin-top:1rem;padding:12px 32px;background:#4fc3f7;color:#1a1a2e;text-decoration:none;border-radius:8px;font-weight:600;transition:background 0.2s}
a:hover{background:#81d4fa}</style></head>
<body><div class="card"><h1>Session Expired</h1><p>This session has expired.<br>Please open the port again from the portal.</p><a href="${portalUrl}">Go to Portal</a></div></body></html>`);
      return;
    }

    // ── Block oversized files that can't transfer through the WS tunnel ──
    // Monaco editor.js is ~4MB and takes 7+ minutes through the agent tunnel,
    // causing the page to hang. Return a no-op stub so Node-RED loads without it.
    if (req.method === 'GET' && targetPath.includes('/monaco/dist/editor.js')) {
      this.logger.debug('Skipping editor.js (too large for tunnel) — returning stub');
      res.writeHead(200, { 'Content-Type': 'application/javascript', 'Cache-Control': 'public, max-age=3600' });
      res.end(`// Monaco editor stub — skipped for tunnel performance
(function() {
  var noop = function() { return { dispose: function(){} }; };
  var noopProxy = new Proxy({}, { get: function() { return noop; } });
  window.monaco = window.monaco || {};
  window.monaco.editor = window.monaco.editor || noopProxy;
  window.monaco.languages = window.monaco.languages || noopProxy;
  window.monaco.Uri = window.monaco.Uri || { parse: noop };
  window.monaco.Range = window.monaco.Range || function(){};
  window.monaco.Position = window.monaco.Position || function(){};
  window.monaco.KeyMod = window.monaco.KeyMod || {};
  window.monaco.KeyCode = window.monaco.KeyCode || {};
  window.monaco.MarkerSeverity = window.monaco.MarkerSeverity || {};
})();
`);
      return;
    }

    // ── Cache check for static assets (GET only) ──
    if (req.method === 'GET' && this.isCacheablePath(targetPath)) {
      const cacheKey = `${session.targetIp}:${session.targetPort}${targetPath}`;
      const cached = this.responseCache.get(cacheKey);
      if (cached && (Date.now() - cached.cachedAt) < CACHE_TTL) {
        this.logger.debug(`Cache HIT: ${targetPath} (${cached.size} bytes)`);
        const headers = { ...cached.headers };
        // Add cache indicator header
        headers['x-nucleus-cache'] = 'HIT';
        res.writeHead(cached.statusCode, headers);
        res.end(cached.body);
        return;
      }
    }

    // Proxy with retry — the FIFO bridge can only handle one request at a time,
    // so concurrent requests may get ECONNREFUSED/ECONNRESET. Retry up to
    // MAX_PROXY_RETRIES times with a staggered delay to let the queue drain.
    await this.proxyWithRetry(req, res, session, sessionId, targetPath);
  }

  /**
   * Proxy a request to the target with automatic retries.
   * The FIFO bridge queues requests sequentially, but http-proxy opens TCP
   * connections immediately. When the bridge is busy, the connection may be
   * refused. This method retries with exponential backoff.
   */
  private async proxyWithRetry(
    req: IncomingMessage,
    res: ServerResponse,
    session: any,
    sessionId: string,
    targetPath: string,
    attempt = 0,
  ): Promise<void> {
    const targetUrl = await this.resolveProxyTarget(session);
    if (!targetUrl) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Unable to resolve proxy target for this device');
      return;
    }

    if (attempt === 0) {
      this.logger.log(
        `Proxy ${req.method} /proxy/${sessionId}${targetPath} -> ${targetUrl}${targetPath}`,
      );
    }

    // Rewrite URL to strip /proxy/:sessionId prefix
    req.url = targetPath;

    // Tag request for caching in proxyRes handler
    if (req.method === 'GET' && this.isCacheablePath(targetPath)) {
      const cacheKey = `${session.targetIp}:${session.targetPort}${targetPath}`;
      (req as any).__cacheKey = cacheKey;
    }

    // Tag for retry tracking
    (req as any).__proxyAttempt = attempt;
    (req as any).__proxySession = session;
    (req as any).__proxySessionId = sessionId;
    (req as any).__proxyTargetPath = targetPath;

    // NOTE: Previously stripped cockpit auth cookie for hash-based static assets
    // (/cockpit/$HASH/...) assuming they didn't need auth. However, some Cockpit
    // versions require the session cookie for ALL paths including hash paths.
    // Without the cookie, requests return 401 and the post-login UI is blank.
    // Cookie stripping removed — Cockpit handles its own auth requirements.

    this.proxy.web(req, res, { target: targetUrl });
  }

  /** Dedicated WSS for /comms mock (noServer mode) */
  private commsWss?: WebSocket.Server;

  private getCommsWss(): WebSocket.Server {
    if (!this.commsWss) {
      this.commsWss = new WebSocket.Server({ noServer: true });
    }
    return this.commsWss;
  }

  /**
   * Handle /comms WebSocket — relay to real Node-RED via the tunnel bridge.
   * Called from main.ts upgrade handler for both root /comms and /proxy/:id/comms.
   */
  handleCommsMock(req: IncomingMessage, socket: Socket, head: Buffer, token?: string): void {
    const sessionLookup = token
      ? this.findActiveCommsSessionByToken(token)
      : Promise.resolve(null);

    sessionLookup.then((session) => {
      if (token && !session) {
        // Token provided but invalid — reject
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }
      const wss = this.getCommsWss();
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (session) {
          this.openDirectCommsRelay(ws, session);
        } else {
          this.logger.warn('/comms: no active session — using mock');
          this.handleCommsWebSocketMock(ws);
        }
      });
    }).catch((err) => {
      this.logger.error(`/comms session lookup failed: ${err.message}`);
      socket.destroy();
    });
  }

  /**
   * Handle /ws/tunnel WebSocket connections from @nucleus/tunnel CLI clients.
   * Authenticates via session token, opens a bridge to the device, and relays
   * TCP data bidirectionally between the tunnel client and the remote device port.
   */
  handleTunnelClientUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): void {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // Look up session by token
    this.lookupTunnelSession(token).then(async (session) => {
      if (!session) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      // Create a WebSocket server for this connection
      const wss = new (WebSocket as any).Server({ noServer: true });
      wss.handleUpgrade(req, socket, head, async (ws: WebSocket) => {
        this.logger.log(`Tunnel client connected: device=${session.deviceId}, port=${session.targetPort}`);

        // Fetch device name for CLI display
        let deviceName = session.deviceId.substring(0, 8);
        try {
          const [device] = await this.db
            .select({ name: accessSessions.deviceId }) // placeholder — get from devices table
            .from(accessSessions)
            .where(eq(accessSessions.id, session.id))
            .limit(1);

          // Lookup actual device
          const { devices: devTable } = await import('../database/schema');
          const [dev] = await this.db
            .select({ name: devTable.name, serialNumber: devTable.serialNumber })
            .from(devTable)
            .where(eq(devTable.id, session.deviceId))
            .limit(1);
          if (dev) {
            deviceName = dev.name || dev.serialNumber || deviceName;
          }
        } catch { /* best effort */ }

        const targetIp = session.targetIp || 'localhost';
        const isLocal = targetIp === '127.0.0.1' || targetIp === 'localhost' || targetIp === '0.0.0.0';

        // Send session.ready with device context for CLI display
        ws.send(JSON.stringify({
          type: 'session.ready',
          deviceId: session.deviceId,
          deviceName,
          targetPort: session.targetPort,
          targetIp: isLocal ? 'localhost' : targetIp,
          isLocalPort: isLocal,
        }));

        // Track active connections (connectionId → bridge socket)
        const connections = new Map<number, net.Socket>();
        // Lazily created bridge for this tunnel client (one bridge per CLI session)
        let tunnelBridgePort: number | null = null;
        let bridgeReady: Promise<number> | null = null;

        /**
         * Ensure a bridge exists for this tunnel client session.
         * Creates an agent session + TCP bridge on first call, reuses on subsequent.
         * On failure, resets state so the next stream.open retries bridge creation
         * (fixes intermittent "No bridge available" on cellular handovers).
         */
        const ensureBridge = async (): Promise<number> => {
          if (tunnelBridgePort) {
            // Verify agent is still connected (socket healthy).
            // Don't TCP-probe the bridge port — probe connections trigger
            // handleNewConnection/handleBinaryAgentStream which remap stream IDs.
            // When the probe socket closes, its cleanup deletes the stream mapping
            // that the real connection needs, breaking binary bridges (SSH port 22).
            const agentSocket = this.agentRegistry.getSocket(session.deviceId);
            if (agentSocket?.readyState === 1) {
              return tunnelBridgePort;
            }
            this.logger.warn(`Tunnel bridge: agent socket gone — recreating bridge`);
            tunnelBridgePort = null;
            bridgeReady = null;
          }
          if (bridgeReady) return bridgeReady;

          bridgeReady = (async () => {
            // For local tunnel sessions, ALWAYS create a dedicated bridge.
            // Browser sessions have shared exposures with existing bridges,
            // but local/CLI tunnels need their own agent session + bridge
            // targeting the correct port (not a browser exposure port).
            const agentSocket = this.agentRegistry.getSocket(session.deviceId);
            if (!agentSocket || agentSocket.readyState !== 1) {
              throw new Error('Agent is offline');
            }

            const tunnelSessionId = `tunnel-${session.id.substring(0, 8)}-${Date.now()}`;
            const tunnelStreamId = Math.floor(Math.random() * 0x7FFFFFFF) + 1;
            this.streamBridge.registerPendingSession(session.deviceId, tunnelSessionId);

            agentSocket.send(JSON.stringify({
              type: 'start_session',
              payload: {
                session_id: tunnelSessionId,
                target_ip: session.targetIp || '127.0.0.1',
                target_port: session.targetPort,
                stream_id: tunnelStreamId,
              },
            }));

            this.logger.log(`Tunnel client: requesting agent session ${tunnelSessionId} (stream=${tunnelStreamId}) for ${session.targetIp}:${session.targetPort}`);
            await this.streamBridge.waitForSessionReady(tunnelSessionId, 15_000);

            // Protocol selection:
            // - SSH (22): binary frames — base64 in JSON proxy corrupts encrypted packets
            // - All other (Modbus 2202, HTTP, etc): JSON proxy — handles per-request TCP lifecycle
            const useJsonForTunnel = session.targetPort !== 22;

            const port = await this.streamBridge.createBridge(
              tunnelSessionId, session.deviceId, agentSocket, useJsonForTunnel,
              session.targetIp || '127.0.0.1', session.targetPort,
              useJsonForTunnel ? undefined : tunnelStreamId,
            );

            // Mark as persistent to disable FIFO request timeouts
            this.streamBridge.markPersistent(tunnelSessionId);

            const mode = useJsonForTunnel ? 'json proxy' : 'binary';
            this.logger.log(`Tunnel client bridge ready: port ${port} → ${session.targetIp}:${session.targetPort} (${mode}, persistent)`);
            tunnelBridgePort = port;
            return port;
          })().catch((err) => {
            // Reset on failure so next stream.open retries instead of
            // permanently failing with the cached rejected promise
            this.logger.warn(`Tunnel bridge creation failed: ${err.message} — will retry on next stream.open`);
            bridgeReady = null;
            throw err;
          });

          return bridgeReady;
        };

        ws.on('message', async (data: WebSocket.Data) => {
          try {
            const msg = JSON.parse(data.toString());

            switch (msg.type) {
              case 'session.bind':
                // Client is ready — pre-create bridge eagerly
                this.logger.log(`Tunnel client bound: port=${msg.remotePort || session.targetPort}`);
                ensureBridge().catch(err =>
                  this.logger.warn(`Tunnel bridge pre-create failed: ${err.message}`),
                );
                break;

              case 'stream.open': {
                // Client wants to open a TCP connection to the device
                const connId = msg.connectionId;

                try {
                  const bridgePort = await ensureBridge();

                  // Connect to the bridge and relay data.
                  // Register immediately — net.Socket buffers writes before connect completes.
                  // This prevents a race where stream.data arrives before the 'connect' event
                  // (critical for SSH: PuTTY sends its identification string immediately on TCP connect).
                  const bridgeSocket = net.createConnection({ host: '127.0.0.1', port: bridgePort });
                  connections.set(connId, bridgeSocket);
                  this.logger.debug(`Tunnel stream ${connId} → bridge port ${bridgePort}`);

                  bridgeSocket.on('data', (chunk: Buffer) => {
                    if (ws.readyState === (WebSocket as any).OPEN) {
                      ws.send(JSON.stringify({
                        type: 'stream.data',
                        connectionId: connId,
                        data: chunk.toString('base64'),
                      }));
                    }
                  });

                  bridgeSocket.on('close', () => {
                    connections.delete(connId);
                    if (ws.readyState === (WebSocket as any).OPEN) {
                      ws.send(JSON.stringify({ type: 'stream.close', connectionId: connId }));
                    }
                  });

                  bridgeSocket.on('error', (err: Error) => {
                    this.logger.debug(`Tunnel stream ${connId} error: ${err.message}`);
                    connections.delete(connId);
                  });
                } catch (err: any) {
                  this.logger.error(`Tunnel stream ${connId} bridge failed: ${err.message}`);
                  ws.send(JSON.stringify({ type: 'stream.error', connectionId: connId, error: err.message }));
                }
                break;
              }

              case 'stream.data': {
                const conn = connections.get(msg.connectionId);
                if (conn && !conn.destroyed) {
                  conn.write(Buffer.from(msg.data, 'base64'));
                }
                break;
              }

              case 'stream.close': {
                const conn = connections.get(msg.connectionId);
                if (conn) {
                  conn.end();
                  connections.delete(msg.connectionId);
                }
                break;
              }

              case 'pong':
                break;
            }
          } catch (err) {
            this.logger.debug(`Tunnel client message error: ${(err as Error).message}`);
          }
        });

        ws.on('close', () => {
          this.logger.log(`Tunnel client disconnected: device=${session.deviceId}, port=${session.targetPort}`);
          for (const [, conn] of connections) conn.destroy();
          connections.clear();
        });

        // Keepalive ping every 30s
        const pingInterval = setInterval(() => {
          if (ws.readyState === (WebSocket as any).OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          } else {
            clearInterval(pingInterval);
          }
        }, 30000);

        ws.on('close', () => clearInterval(pingInterval));
      });
    }).catch((err: Error) => {
      this.logger.error(`Tunnel client auth failed: ${err.message}`);
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  }

  private async lookupTunnelSession(token: string) {
    const tunnelPath = `/tunnel/${token}`;
    const [session] = await this.db
      .select()
      .from(accessSessions)
      .where(
        and(
          eq(accessSessions.proxyPath, tunnelPath),
          eq(accessSessions.status, 'active'),
        ),
      )
      .limit(1);
    return session ?? null;
  }

  async handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer): Promise<void> {
    const match = req.url?.match(/^\/proxy\/([^/]+)(\/.*)?$/);
    if (!match) {
      socket.destroy();
      return;
    }

    const sessionId = match[1];
    const targetPath = match[2] || '/';

    const session = await this.lookupActiveSession(sessionId);
    if (!session || new Date(session.expiresAt) < new Date()) {
      socket.destroy();
      return;
    }

    // ── /comms WebSocket — direct relay via agent WS ──
    if (targetPath.startsWith('/comms')) {
      this.logger.log(`/comms direct relay for session ${session.id}`);
      const wss = this.getCommsWss();
      wss.handleUpgrade(req, socket, head, (ws) => {
        this.openDirectCommsRelay(ws, session);
      });
      return;
    }

    // ── /cockpit/socket WebSocket — raw TCP relay via comms bridge ──
    // Cockpit uses a persistent WebSocket at /cockpit/socket for ALL post-login
    // communication (dbus channels, file I/O, terminal streams).
    //
    // Architecture:
    //   Browser ←WSS→ Cloudflare ←HTTPS→ Backend ←TCP→ CommsBridge ←TCP→ Agent ←TCP→ Device:9090
    //
    // The comms bridge is a transparent TCP relay to the device. We forward the
    // raw HTTP Upgrade request through it. The device (Cockpit) performs the WS
    // handshake and responds with 101 Switching Protocols. After that, both sides
    // exchange raw WebSocket frames transparently through the TCP pipe.
    //
    // Key insight: we do NOT accept the WebSocket on the backend side. Instead,
    // we pipe the browser's raw TCP socket directly to the bridge TCP socket.
    // This makes the backend a transparent L4 tunnel — Cockpit and the browser
    // negotiate WebSocket directly, end-to-end.
    if (targetPath.startsWith('/cockpit/socket')) {
      this.handleCockpitSocketUpgrade(req, socket, head, session, targetPath);
      return;
    }

    const targetUrl = await this.resolveProxyTarget(session);
    if (!targetUrl) {
      socket.destroy();
      return;
    }

    this.logger.log(`WebSocket upgrade /proxy/${sessionId}${targetPath} -> ${targetUrl}${targetPath}`);

    req.url = targetPath;
    this.proxy.ws(req, socket, head, { target: targetUrl });
  }

  /**
   * Open a /comms relay for a tunnel session.
   *
   * Cascade:
   * 1. Direct relay via agent's WebSocket (Rust agents with comms_* protocol)
   * 2. Dedicated bridge relay via TCP bridge (Go agents without comms_* support)
   * 3. Mock mode (keeps editor alive without real-time data)
   */
  private openDirectCommsRelay(browserWs: any, session: any): void {
    const commsId = randomBytes(8).toString('hex');
    const deviceId = session.deviceId;
    const targetPort = session.targetPort || 1880;

    // ── Attempt 1: Direct relay via agent WebSocket (Rust agents) ──
    const started = this.commsRelay.openRelay(commsId, deviceId, browserWs, targetPort);
    if (started) {
      // Direct relay initiated. CommsRelayService has a 5s fallback timer —
      // if comms_opened doesn't arrive (Go agent), it starts mock mode.
      // Override that fallback to try bridge relay instead of mock.
      this.overrideCommsRelayFallback(commsId, browserWs, session);
      return;
    }

    // Agent offline — try bridge relay
    this.logger.warn(`/comms direct relay: agent offline — trying bridge`);
    if (!this.tryBridgeCommsRelay(browserWs, session)) {
      this.logger.warn(`/comms: no bridge available — using mock`);
      this.handleCommsWebSocketMock(browserWs);
    }
  }

  /**
   * Override the CommsRelayService fallback timer so that instead of starting
   * mock mode when comms_opened doesn't arrive, it tries bridge relay first.
   * This handles the case where a Go agent (without comms_* support) is connected.
   */
  private overrideCommsRelayFallback(commsId: string, browserWs: any, session: any): void {
    // CommsRelayService starts a 5s timer that falls to mock if comms_opened
    // doesn't arrive. We set a 6s timer to catch that scenario and try bridge
    // relay instead — BUT only if the direct relay was NOT confirmed.
    setTimeout(() => {
      if (browserWs.readyState !== (WebSocket as any).OPEN) return;

      // Check if the direct relay was confirmed (comms_opened received).
      // If confirmed, the relay is working — do NOT override it.
      if (this.commsRelay.isRelayConfirmed(commsId)) {
        this.logger.log(`/comms: direct relay confirmed for ${commsId} — skipping bridge fallback`);
        return;
      }

      const bridgeKey = this.getBridgeLookupKey(session);
      const commsBridgePort = this.streamBridge.getCommsBridgePort(bridgeKey);
      if (commsBridgePort) {
        this.logger.log(`/comms: comms_opened timeout — upgrading from mock to bridge relay (port ${commsBridgePort})`);
        this.setupBridgeRelay(browserWs, commsBridgePort, bridgeKey);
      }
    }, 6_000);
  }

  /**
   * Attempt to relay /comms via the dedicated TCP bridge.
   * Works with Go agents that don't support the comms_* WebSocket protocol.
   * Returns true if bridge relay was started, false if no bridge available.
   */
  private tryBridgeCommsRelay(browserWs: any, session: any): boolean {
    const bridgeKey = this.getBridgeLookupKey(session);
    const commsBridgePort = this.streamBridge.getCommsBridgePort(bridgeKey);
    if (!commsBridgePort) return false;

    this.setupBridgeRelay(browserWs, commsBridgePort, bridgeKey);
    return true;
  }

  /**
   * Set up a WebSocket relay through the dedicated comms TCP bridge.
   * Browser ←WS→ Backend ←WS→ Bridge ←TCP/WS→ Agent ←WS→ Device Node-RED /comms
   */
  private setupBridgeRelay(browserWs: any, bridgePort: number, sessionId: string): void {
    const targetUrl = `ws://127.0.0.1:${bridgePort}/comms`;
    this.logger.log(`/comms bridge relay: browser → ${targetUrl} (session ${sessionId})`);

    const WS = WebSocket.WebSocket || WebSocket;
    const upstream = new (WS as any)(targetUrl);
    let upstreamOpen = false;
    const pendingMessages: WebSocket.Data[] = [];

    upstream.on('open', () => {
      upstreamOpen = true;
      this.logger.log(`/comms bridge relay: upstream connected (session ${sessionId})`);
      for (const msg of pendingMessages) {
        upstream.send(msg);
      }
      pendingMessages.length = 0;
    });

    // Relay: upstream (Node-RED) → browser
    upstream.on('message', (data: WebSocket.Data) => {
      if (browserWs.readyState === (WebSocket as any).OPEN) {
        browserWs.send(data);
      }
    });

    // Relay: browser → upstream (Node-RED)
    browserWs.on('message', (data: WebSocket.Data) => {
      if (upstreamOpen && upstream.readyState === (WebSocket as any).OPEN) {
        upstream.send(data);
      } else {
        pendingMessages.push(data);
      }
    });

    upstream.on('close', (code: number) => {
      this.logger.log(`/comms bridge relay: upstream closed (code=${code}, session ${sessionId})`);
      if (browserWs.readyState === (WebSocket as any).OPEN) {
        try { browserWs.close(code || 1000); } catch(e) { /* ignore */ }
      }
    });

    upstream.on('error', (err: Error) => {
      this.logger.warn(`/comms bridge relay: upstream error: ${err.message} — falling back to mock`);
      try { try { upstream.close(); } catch(e) { /* ignore */ } } catch { /* ignore */ }
      this.handleCommsWebSocketMock(browserWs);
    });

    browserWs.on('close', () => {
      this.logger.log(`/comms bridge relay: browser disconnected (session ${sessionId})`);
      if (upstream.readyState === (WebSocket as any).OPEN || upstream.readyState === (WebSocket as any).CONNECTING) {
        try { upstream.close(); } catch(e) { /* ignore */ }
      }
    });

    browserWs.on('error', (err: Error) => {
      this.logger.error(`/comms bridge relay: browser error: ${err.message}`);
      try { try { upstream.close(); } catch(e) { /* ignore */ } } catch { /* ignore */ }
    });
  }

  /**
   * Handle Cockpit /cockpit/socket WebSocket upgrade via raw TCP tunnel.
   *
   * Cockpit uses a single persistent WebSocket at /cockpit/socket for ALL
   * post-login communication: dbus channels, file I/O, terminal streams.
   *
   * Strategy: Use the comms bridge (persistent TCP connection to the device)
   * as a transparent L4 tunnel. We forward the raw HTTP Upgrade bytes through
   * the bridge. Cockpit on the device handles the WebSocket handshake directly.
   * After the 101 response, both sides exchange raw WS frames through the pipe.
   *
   * This makes the backend a transparent TCP proxy — Cockpit and the browser
   * negotiate WebSocket end-to-end without the backend interpreting frames.
   */
  private async handleCockpitSocketUpgrade(
    req: IncomingMessage,
    browserSocket: Socket,
    head: Buffer,
    session: any,
    targetPath: string,
  ): Promise<void> {
    const sessionId = session.id;
    const bridgeKey = this.getBridgeLookupKey(session);

    // Create an on-demand dedicated bridge for this WebSocket connection.
    // Each browser tab gets its own bridge so WebSockets don't occupy pool slots.
    // The bridge is persistent (no timeout) and destroyed when the WS closes.
    const agentSocket = this.streamBridge.getAgentSocket?.(bridgeKey);
    let bridgePort: number | null = null;
    try {
      bridgePort = await this.streamBridge.createOnDemandWsBridge(
        bridgeKey, session.deviceId, agentSocket, session.targetIp, session.targetPort,
      );
    } catch (e) {
      // Fallback: use pool bridge if on-demand creation fails
      this.logger.warn(`/cockpit/socket: on-demand WS bridge failed (${e}), using pool bridge`);
      bridgePort = this.streamBridge.getBridgePort(bridgeKey);
    }

    if (!bridgePort) {
      this.logger.warn(`/cockpit/socket: no bridge available (session ${sessionId})`);
      browserSocket.destroy();
      return;
    }

    this.logger.log(`/cockpit/socket: dedicated WS bridge port ${bridgePort} (session ${sessionId})`);

    const bridgeSocket = net.createConnection({ host: '127.0.0.1', port: bridgePort });
    (bridgeSocket as any).__isWebSocket = true;
    bridgeSocket.on('connect', () => {
      this.logger.log(`/cockpit/socket: bridge TCP connected (session ${sessionId})`);

      // Reconstruct the HTTP Upgrade request to send through the bridge.
      // The bridge transparently relays bytes to Cockpit on the device.
      //
      // Forward ALL original headers as-is to Cockpit via the bridge.
      // Cockpit validates WebSocket upgrades using:
      //   1. Session cookie (cockpit auth token from login)
      //   2. Origin header (CSRF check — must match or be absent)
      //
      // The browser sends Origin: https://api.datadesng.com which Cockpit
      // will reject as foreign. Solution: strip Origin entirely.
      // Cockpit allows WebSocket upgrades without Origin header.
      //
      // Host must match what Cockpit expects — keep the proxy host since
      // Cockpit's login cookie was set under that host.
      // Build HTTP upgrade request matching what Cockpit expects.
      // During login, http-proxy with changeOrigin:true rewrites Host to the
      // bridge target (127.0.0.1:bridgePort). Cockpit's auth cookie is scoped
      // to that Host. We must match it here.
      //
      // But in the raw TCP relay the browser sends Host: api.datadesng.com.
      // Cockpit sees requests through the bridge with whatever Host we send.
      // The key insight: Cockpit's cookie validation uses the cookie VALUE
      // (a session token), not the Host header. The 403 is likely caused by
      // Cockpit's CSRF Origin check, NOT the cookie.
      //
      // Cockpit CSRF check: if Origin header is present, it must match the
      // Host header. If Origin is absent, it's allowed.
      // Solution: strip Origin AND set Host to what Cockpit expects.
      // Cockpit WebSocket requires:
      //   1. Valid session cookie (from login)
      //   2. Host header matching where Cockpit binds (127.0.0.1:port)
      //   3. Origin header matching Host (CSRF check)
      // Verified by direct curl testing against the device.
      // Build a MINIMAL WebSocket upgrade request with ONLY the headers
      // Cockpit needs. Verified by direct curl testing:
      //   Host + Origin (matching) + Cookie + standard WS headers = 101 ✅
      // Any extra headers (Cloudflare, proxy, browser-specific) may cause 403.
      const cockpitHost = `127.0.0.1:${session.targetPort}`;

      // Extract clean cockpit cookie (filter out 'cockpit=deleted')
      const rawCookie = req.headers.cookie || '';
      const cleanCookie = rawCookie
        .split(';')
        .map((c: string) => c.trim())
        .filter((c: string) => c.startsWith('cockpit=') && !c.startsWith('cockpit=deleted'))
        .join('; ');

      // Extract WebSocket-specific headers from the browser request
      const wsKey = req.headers['sec-websocket-key'] || '';
      const wsVersion = req.headers['sec-websocket-version'] || '13';
      const wsProtocol = req.headers['sec-websocket-protocol'] || '';

      const headers = [
        `GET ${targetPath} HTTP/1.1`,
        `Host: ${cockpitHost}`,
        `Origin: http://${cockpitHost}`,
        `Connection: Upgrade`,
        `Upgrade: websocket`,
        `Sec-WebSocket-Key: ${wsKey}`,
        `Sec-WebSocket-Version: ${wsVersion}`,
      ];
      if (wsProtocol) headers.push(`Sec-WebSocket-Protocol: ${wsProtocol}`);
      if (cleanCookie) headers.push(`Cookie: ${cleanCookie}`);

      const httpRequest = headers.join('\r\n') + '\r\n\r\n';
      this.logger.log(`/cockpit/socket: minimal upgrade → Host=${cockpitHost}, cookie=${cleanCookie ? 'present' : 'ABSENT'}, protocol=${wsProtocol} (session ${sessionId})`);
      bridgeSocket.write(httpRequest);

      // If there's buffered data from the browser (head), send it too
      if (head && head.length > 0) {
        bridgeSocket.write(head);
      }
    });

    // Once the bridge responds, pipe everything bidirectionally
    // The first response will be HTTP 101 Switching Protocols from Cockpit,
    // followed by raw WebSocket frames in both directions
    let bridgeConnected = false;

    bridgeSocket.on('data', (data: Buffer) => {
      if (!bridgeConnected) {
        bridgeConnected = true;
        // Check if we got a 101 response (successful upgrade)
        const responseText = data.toString('utf8', 0, Math.min(500, data.length));
        if (responseText.includes('101')) {
          this.logger.log(`/cockpit/socket: device returned 101 — WebSocket tunnel established (session ${sessionId})`);
        } else {
          this.logger.warn(`/cockpit/socket: device FULL response:\n${responseText} (session ${sessionId})`);
        }
      }
      // Forward device response to browser
      if (!browserSocket.destroyed) {
        browserSocket.write(data);
      }
    });

    browserSocket.on('data', (data: Buffer) => {
      // Forward browser data to device via bridge
      if (!bridgeSocket.destroyed) {
        bridgeSocket.write(data);
      }
    });

    // ── Connection keepalive strategy ──
    // The /cockpit/socket WebSocket goes through a raw TCP relay:
    //   Browser ↔ Cloudflare ↔ Backend ↔ Bridge ↔ Agent ↔ Cockpit
    //
    // Cloudflare terminates idle WebSocket connections after ~100s.
    // TCP keepalive sends OS-level probes that keep the connection alive
    // through Cloudflare's idle timeout detection.
    //
    // We use aggressive 15s keepalive (well under Cloudflare's 100s timeout)
    // on BOTH sockets to keep the full pipe alive.
    browserSocket.setKeepAlive(true, 15_000); // 15s keepalive to browser
    bridgeSocket.setKeepAlive(true, 15_000);  // 15s keepalive to bridge

    // Also set TCP_NODELAY to reduce latency for small WebSocket frames
    browserSocket.setNoDelay(true);
    bridgeSocket.setNoDelay(true);

    // Cleanup interval reference for clearInterval in close handlers
    const pingInterval: any = null; // No app-level ping — TCP keepalive handles it

    // Clean up on close/error
    bridgeSocket.on('close', () => {
      clearInterval(pingInterval);
      this.logger.log(`/cockpit/socket: bridge closed (session ${sessionId})`);
      if (!browserSocket.destroyed) browserSocket.destroy();
    });

    bridgeSocket.on('error', (err: Error) => {
      clearInterval(pingInterval);
      this.logger.warn(`/cockpit/socket: bridge error: ${err.message} (session ${sessionId})`);
      if (!browserSocket.destroyed) browserSocket.destroy();
    });

    browserSocket.on('close', () => {
      clearInterval(pingInterval);
      this.logger.log(`/cockpit/socket: browser disconnected (session ${sessionId})`);
      if (!bridgeSocket.destroyed) bridgeSocket.destroy();
    });

    browserSocket.on('error', (err: Error) => {
      clearInterval(pingInterval);
      this.logger.warn(`/cockpit/socket: browser error: ${err.message} (session ${sessionId})`);
      if (!bridgeSocket.destroyed) bridgeSocket.destroy();
    });
  }

  /** Find an active session by proxy token (for root /comms with token auth) */
  private async findActiveCommsSessionByToken(token: string): Promise<any> {
    const proxyPath = `/proxy/${token}`;
    const [session] = await this.db
      .select()
      .from(accessSessions)
      .where(
        and(
          eq(accessSessions.proxyPath, proxyPath),
          eq(accessSessions.status, 'active'),
        ),
      )
      .orderBy(desc(accessSessions.requestedAt))
      .limit(1);
    return session ?? null;
  }

  /**
   * Fallback mock /comms WebSocket handler.
   * Used when no bridge is available. Keeps Node-RED editor alive but without real-time data.
   */
  private handleCommsWebSocketMock(ws: any): void {
    const keepalive = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify([{ topic: 'hb', data: Date.now() }]));
      }
    }, 15_000);

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.auth) {
          ws.send(JSON.stringify({ auth: 'ok' }));
          setTimeout(() => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify([{ topic: 'notification/runtime-state', data: { state: 'start' } }]));
            }
          }, 100);
        }
      } catch { /* ignore */ }
    });

    ws.on('close', () => clearInterval(keepalive));
    ws.on('error', () => clearInterval(keepalive));
  }

  private async lookupActiveSession(sessionId: string) {
    // The proxyUrl uses a random hex token stored in proxy_path,
    // NOT the session UUID primary key. Look up by proxy_path.
    const proxyPath = `/proxy/${sessionId}`;
    const [session] = await this.db
      .select()
      .from(accessSessions)
      .where(
        and(
          eq(accessSessions.proxyPath, proxyPath),
          eq(accessSessions.status, 'active'),
        ),
      )
      .limit(1);

    return session ?? null;
  }

  /**
   * Get the bridge lookup key for a session.
   * With shared exposures, bridges are keyed by exposureId.
   * Legacy sessions (no exposureId) use session.id.
   */
  private getBridgeLookupKey(session: any): string {
    return session.exposureId || session.id;
  }

  /**
   * Resolves the proxy target URL for a session.
   *
   * Priority:
   * 1. Agent tunnel bridge (local TCP server bridged to remote device via WS)
   * 2. Direct connection (backend can reach the target IP:port directly)
   */
  /** Get total bytes in the response cache */
  getCacheSize(): number {
    let total = 0;
    for (const entry of this.responseCache.values()) {
      total += entry.body.length;
    }
    return total;
  }

  /** Check if a path points to a static asset that can be cached */
  private isCacheablePath(path: string): boolean {
    const clean = path.split('?')[0];
    // Cache the root HTML page
    if (clean === '/') return true;
    // Cache Cockpit content-addressed resources (immutable — hash in path)
    // Paths like /cockpit/$a475.../base1/cockpit.js are keyed by content hash
    // and never change — safe to cache indefinitely.
    if (clean.startsWith('/cockpit/$')) return true;
    // Cache Cockpit static assets (fonts, images, CSS)
    if (clean.startsWith('/cockpit/static/')) return true;
    // Cache Cockpit manifests (component registry)
    if (clean.endsWith('/manifests.json') || clean.endsWith('/manifests.js')) return true;
    // Cache known Node-RED static directories
    if (clean.startsWith('/icons/') || clean.startsWith('/vendor/')) return true;
    // Cache Node-RED API responses that rarely change and are critical for editor load
    if (clean.startsWith('/locales/')) return true;
    if (clean.startsWith('/types/')) return true;
    if (clean.startsWith('/plugins')) return true;
    if (clean === '/red/keymap.json') return true;
    if (clean === '/settings' || clean === '/settings/user') return true;
    // NOTE: /flows, /flows/state, and /nodes are NOT cached — they are mutable
    // (changed by deploy and node installs). Caching them causes stale editor state.
    if (clean === '/theme') return true;
    // Cache by file extension
    const ext = clean.substring(clean.lastIndexOf('.'));
    return CACHEABLE_EXTENSIONS.has(ext);
  }

  /** Cache a response, evicting old entries if size limit exceeded */
  private cacheResponse(key: string, entry: CachedResponse): void {
    // Evict expired entries first
    const now = Date.now();
    for (const [k, v] of this.responseCache) {
      if (now - v.cachedAt > CACHE_TTL) {
        this.currentCacheSize -= v.size;
        this.responseCache.delete(k);
      }
    }

    // Evict oldest entries if cache is too large
    while (this.currentCacheSize + entry.size > MAX_CACHE_SIZE && this.responseCache.size > 0) {
      const oldestKey = this.responseCache.keys().next().value!;
      const oldest = this.responseCache.get(oldestKey)!;
      this.currentCacheSize -= oldest.size;
      this.responseCache.delete(oldestKey);
    }

    // Don't cache if single entry exceeds limit
    if (entry.size > MAX_CACHE_SIZE) return;

    this.responseCache.set(key, entry);
    this.currentCacheSize += entry.size;
    this.logger.log(
      `Cached: ${key} (${(entry.size / 1024).toFixed(1)}KB, total cache: ${(this.currentCacheSize / 1024).toFixed(1)}KB)`,
    );
    // Capture Cockpit content hash from cache keys for future warm-ups
    if (!this.cockpitContentHash) {
      const hashMatch = key.match(/cockpit\/\$([a-f0-9]{20,})\//);
      if (hashMatch) {
        this.cockpitContentHash = hashMatch[1];
        this.logger.log(`Discovered Cockpit content hash: ${this.cockpitContentHash.substring(0, 16)}...`);
      }
    }
  }

  private async resolveProxyTarget(session: any): Promise<string | null> {
    // Use agent tunnel bridge (standard path — always plain HTTP)
    // The bridge relays TCP to the device via the agent. Cockpit on port 9090
    // accepts unencrypted HTTP (AllowUnencrypted=true in cockpit.conf).
    // With shared exposures, bridges are keyed by exposureId.
    const bridgeKey = this.getBridgeLookupKey(session);
    const bridgePort = this.streamBridge.getBridgePort(bridgeKey);
    if (bridgePort) {
      this.logger.debug(
        `Using agent tunnel bridge 127.0.0.1:${bridgePort} for session ${session.id} (exposure=${session.exposureId || 'legacy'})`,
      );
      // Bridge is always plain HTTP — the agent handles TLS to the real target
      return `http://127.0.0.1:${bridgePort}`;
    }

    // Direct proxy fallback — route directly to the device's target IP:port
    if (session.targetIp && session.targetPort) {
      // Note: 9090 (Cockpit) uses plain HTTP when accessed locally via AllowUnencrypted=true
      const isTls = [443, 8443, 9443].includes(session.targetPort);
      const scheme = isTls ? 'https' : 'http';
      const directTarget = `${scheme}://${session.targetIp}:${session.targetPort}`;
      this.logger.debug(
        `Using direct proxy ${directTarget} for session ${session.id}`,
      );
      return directTarget;
    }

    this.logger.warn(
      `No bridge and no target for session ${session.id}. Unreachable.`,
    );
    return null;
  }

  /**
   * Pre-warm the proxy cache for a Cockpit session by fetching critical resources
   * through the bridge sequentially BEFORE the browser hits them.
   *
   * Cockpit loads ~50 resources after login. Through the FIFO bridge, concurrent
   * browser requests cause 503 contention. By pre-fetching the root page (which
   * reveals the content hash) and then the critical CSS/JS files, the proxy cache
   * serves them instantly when the browser requests them.
   *
   * Fire-and-forget — called after session + bridges are ready.
   */
  async warmCockpitCache(sessionId: string, proxyPath: string): Promise<void> {
    const token = proxyPath.replace('/proxy/', '');
    const baseUrl = `http://127.0.0.1:${process.env.PORT || 3001}/proxy/${token}`;

    const fetchWithTimeout = async (url: string, timeoutMs = 8000): Promise<string> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(url, { signal: controller.signal });
        const text = await resp.text();
        return text;
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      // Step 1: Fetch root page to cache the login HTML
      this.logger.log(`Cache warm: fetching root page for session ${sessionId}`);
      const rootHtml = await fetchWithTimeout(baseUrl + '/');

      // Do NOT login to Cockpit — it consumes a session and causes protocol-error.
      // Use the previously discovered content hash if available.
      let shellHtml = '';
      if (this.cockpitContentHash) {
        this.logger.log(`Cache warm: using stored hash ${this.cockpitContentHash.substring(0, 16)}...`);
      }

      // Step 3: Extract the Cockpit content hash — try stored hash first
      const hashSource = shellHtml || rootHtml;
      const hashMatch = hashSource.match(/\/cockpit\/\$([a-f0-9]{20,})\//);
      const hash = hashMatch?.[1] || this.cockpitContentHash;
      if (!hash) {
        // No hash available yet — cache static resources only.
        // The hash will be discovered on the user's first login and used next time.
        this.logger.debug('Cache warm: no Cockpit hash found — caching static resources only');
        const staticPaths = [
          '/cockpit/static/branding.css',
          '/cockpit/static/login.js',
        ];
        for (const path of staticPaths) {
          try { await fetchWithTimeout(baseUrl + path, 8000); } catch { /* ok */ }
        }
        return;
      }
      this.cockpitContentHash = hash; // Store for future use
      this.logger.log(`Cache warm: Cockpit hash=${hash.substring(0, 16)}...`);

      // Step 4: Pre-fetch ALL Cockpit resources sequentially to avoid bridge contention.
      // Without caching, the browser fires ~20+ concurrent requests that overwhelm the
      // 4-bridge FIFO pool, causing 500 errors and broken CSS/JS loading.
      const criticalPaths = [
        // Core libraries (must load first)
        `/cockpit/$${hash}/base1/cockpit.js`,
        `/cockpit/$${hash}/base1/jquery.js`,
        `/cockpit/$${hash}/base1/patternfly.css`,
        // Shell
        `/cockpit/$${hash}/shell/index.js`,
        `/cockpit/$${hash}/shell/index.css`,
        `/cockpit/$${hash}/shell/manifests.json`,
        // Static branding
        `/cockpit/static/branding.css`,
        `/cockpit/static/login.js`,
        // System module (most used)
        `/cockpit/$${hash}/system/system.js`,
        `/cockpit/$${hash}/system/system.css`,
        `/cockpit/$${hash}/system/index.html`,
        // Docker/Containers module
        `/cockpit/$${hash}/docker/docker.js`,
        `/cockpit/$${hash}/docker/docker.css`,
        // Networking module
        `/cockpit/$${hash}/networkmanager/networkmanager.js`,
        `/cockpit/$${hash}/networkmanager/networkmanager.css`,
        // Additional base libraries
        `/cockpit/$${hash}/base1/po.js`,
        `/cockpit/$${hash}/shell/po.js`,
        `/cockpit/$${hash}/performance/performance.js`,
        `/cockpit/$${hash}/domain/domain.js`,
      ];

      let cached = 0;
      for (const path of criticalPaths) {
        try {
          await fetchWithTimeout(baseUrl + path, 10000);
          cached++;
          this.logger.debug(`Cache warm: cached ${path.substring(0, 60)}`);
        } catch (e) {
          this.logger.debug(`Cache warm: failed ${path.substring(0, 40)} (non-critical)`);
        }
      }

      this.logger.log(`Cache warm: completed for session ${sessionId} (${cached}/${criticalPaths.length} resources)`);
    } catch (e) {
      this.logger.warn(`Cache warm: failed for session ${sessionId}: ${e}`);
    }
  }

}
