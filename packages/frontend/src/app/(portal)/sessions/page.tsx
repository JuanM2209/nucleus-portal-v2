'use client';

import { useState, useMemo } from 'react';
import {
  Radio,
  Clock,
  X,
  Timer,
  Globe,
  Monitor,
  Loader2,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { useSessions, useExtendSession, useCloseSession } from '@/hooks/use-sessions';
import { useDevices } from '@/hooks/use-device';

interface Session {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly targetIp?: string;
  readonly targetPort?: number;
  readonly tunnelType?: 'browser' | 'local';
  readonly status: string;
  readonly createdAt?: string;
  readonly requestedAt?: string;
  readonly openedAt?: string;
  readonly expiresAt?: string;
  readonly proxyUrl?: string;
  readonly localEndpoint?: string;
}

export default function SessionsPage() {
  const { data, isLoading, isError, error, isFetching, dataUpdatedAt } = useSessions();
  const sessions: readonly Session[] = data?.data ?? [];
  const { data: devicesData } = useDevices({ limit: 100 });
  const deviceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    const devices = devicesData?.data ?? [];
    if (Array.isArray(devices)) {
      devices.forEach((d: any) => {
        const label = d.name || d.hostname || d.serialNumber;
        if (d.id && label) map.set(d.id, String(label).replace(/^Nucleus\s+/i, ''));
      });
    }
    return map;
  }, [devicesData]);

  return (
    <div className="min-h-full pb-12">
      <div className="pt-8 pb-6 px-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
              Tunnel Sessions
            </h1>
            <p className="text-on-surface-variant mt-1">
              Active remote access sessions and tunnel connections.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {isFetching && !isLoading && (
              <div className="flex items-center gap-1.5 text-xs text-primary">
                <RefreshCw className="w-3 h-3 animate-spin" />
                <span>Refreshing...</span>
              </div>
            )}
            {dataUpdatedAt > 0 && (
              <span className="text-[10px] font-technical text-on-surface-variant/60 uppercase">
                Updated {new Date(dataUpdatedAt).toLocaleTimeString()}
              </span>
            )}
            <span className="flex items-center gap-1.5 bg-tertiary/10 text-tertiary text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse" />
              Auto-refresh 15s
            </span>
          </div>
        </div>
      </div>

      <div className="px-2 space-y-4">
        {/* Loading State */}
        {isLoading && (
          <div className="bg-surface-container-low rounded-xl p-12 flex items-center justify-center gap-3 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading sessions...</span>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="bg-error/5 border border-error/20 rounded-xl p-6 flex items-center gap-3 text-error">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">Failed to load sessions: {(error as Error)?.message ?? 'Unknown error'}</span>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && !isError && sessions.length === 0 && (
          <div className="bg-surface-container-low rounded-xl p-12 text-center">
            <Radio className="w-10 h-10 text-on-surface-variant/30 mx-auto mb-4" />
            <h3 className="font-headline font-bold text-on-surface mb-2">No active tunnel sessions</h3>
            <p className="text-sm text-on-surface-variant max-w-md mx-auto">
              Open a port from a device detail page to establish a tunnel session. Sessions will appear here with live status updates.
            </p>
          </div>
        )}

        {/* Sessions Table */}
        {!isLoading && !isError && sessions.length > 0 && (
          <div className="bg-surface-container-low rounded-xl overflow-hidden">
            <div className="grid grid-cols-[0.8fr_80px_1fr_85px_85px_130px_120px_140px] gap-4 px-6 py-4 text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider border-b border-outline-variant/10">
              <span>Device</span>
              <span>User</span>
              <span>Target</span>
              <span className="text-center">Type</span>
              <span className="text-center">Status</span>
              <span>Started</span>
              <span>Expires</span>
              <span>Actions</span>
            </div>

            {sessions.map((session) => (
              <SessionRow key={session.id} session={session} deviceNameMap={deviceNameMap} />
            ))}
          </div>
        )}

        {/* Summary */}
        {!isLoading && !isError && sessions.length > 0 && (
          <div className="flex items-center gap-4 text-xs text-on-surface-variant font-technical">
            <span>{sessions.length} active session{sessions.length !== 1 ? 's' : ''}</span>
            <span className="text-on-surface-variant/30">|</span>
            <span>
              {sessions.filter((s) => s.tunnelType === 'browser').length} browser,{' '}
              {sessions.filter((s) => s.tunnelType === 'local').length} local
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Session Row ─── */

function SessionRow({ session, deviceNameMap }: { readonly session: Session; readonly deviceNameMap: Map<string, string> }) {
  const [showExtend, setShowExtend] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(60);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const extendMutation = useExtendSession();
  const closeMutation = useCloseSession();

  const expiresDate = session.expiresAt ? new Date(session.expiresAt) : null;
  const expiresValid = expiresDate && !isNaN(expiresDate.getTime());
  const timeLeft = expiresValid ? Math.max(0, expiresDate.getTime() - Date.now()) : null;
  const hoursLeft = timeLeft !== null ? Math.floor(timeLeft / 3_600_000) : null;
  const minutesLeft = timeLeft !== null ? Math.floor((timeLeft % 3_600_000) / 60_000) : null;
  const isExpiringSoon = timeLeft !== null && timeLeft < 3_600_000 && timeLeft > 0;

  function handleExtend() {
    extendMutation.mutate(
      { sessionId: session.id, minutes: extendMinutes },
      { onSuccess: () => setShowExtend(false) },
    );
  }

  function handleClose() {
    closeMutation.mutate(session.id, {
      onSuccess: () => setShowCloseConfirm(false),
    });
  }

  return (
    <div>
      <div className="grid grid-cols-[0.8fr_80px_1fr_85px_85px_130px_120px_140px] gap-4 px-6 py-5 text-sm hover:bg-surface-container-high transition-colors items-center">
        {/* Device */}
        <div className="flex items-center gap-2">
          <Monitor className="w-4 h-4 text-on-surface-variant/40 flex-shrink-0" />
          <span className="text-on-surface font-medium">{session.deviceName ?? deviceNameMap.get(session.deviceId) ?? session.deviceId}</span>
        </div>

        {/* User */}
        <span className="font-technical text-on-surface-variant text-xs">Admin</span>

        {/* Target */}
        <span className="font-technical text-on-surface-variant text-xs">
          {session.targetIp ? `localhost:${session.targetPort ?? '--'}` : '--'}
        </span>

        {/* Type */}
        <span className="flex justify-center">
          <span className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
            session.tunnelType === 'browser'
              ? 'bg-primary/10 text-primary'
              : 'bg-[#8b5cf6]/10 text-[#8b5cf6]'
          }`}>
            {session.tunnelType === 'browser' ? (
              <Globe className="w-3 h-3" />
            ) : (
              <Monitor className="w-3 h-3" />
            )}
            {session.tunnelType ?? 'N/A'}
          </span>
        </span>

        {/* Status */}
        <span className="flex justify-center">
          <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${
            session.status === 'active'
              ? 'bg-tertiary/10 text-tertiary'
              : session.status === 'expired'
              ? 'bg-error/10 text-error'
              : 'bg-surface-container-highest text-on-surface-variant/60'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              session.status === 'active' ? 'bg-tertiary animate-pulse' : 'bg-on-surface-variant/40'
            }`} />
            {session.status}
          </span>
        </span>

        {/* Started */}
        <span className="font-technical text-on-surface-variant text-xs">
          {(() => {
            const raw = session.requestedAt || session.openedAt || session.createdAt;
            if (!raw) return '--';
            const d = new Date(raw);
            return isNaN(d.getTime()) ? '--' : d.toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            });
          })()}
        </span>

        {/* Expires */}
        <span className={`font-technical text-xs ${isExpiringSoon ? 'text-error font-bold' : 'text-on-surface-variant'}`}>
          {expiresValid
            ? hoursLeft !== null && minutesLeft !== null
              ? `${hoursLeft}h ${minutesLeft}m left`
              : expiresDate.toLocaleString(undefined, {
                  month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                })
            : 'No expiry'}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          {session.proxyUrl && (
            <a
              href={session.proxyUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-primary/10 transition-colors"
              title="Open Proxy URL"
            >
              <ExternalLink className="w-3.5 h-3.5 text-primary" />
            </a>
          )}
          <button
            onClick={() => setShowExtend((p) => !p)}
            className="flex items-center gap-1 px-2 py-1 rounded-lg bg-surface-container-highest text-on-surface-variant text-[10px] font-medium hover:bg-surface-bright transition-colors"
            title="Extend session"
          >
            <Timer className="w-3 h-3" /> Extend
          </button>
          {!showCloseConfirm ? (
            <button
              onClick={() => setShowCloseConfirm(true)}
              className="flex items-center gap-1 px-2 py-1 rounded-lg bg-error/10 text-error text-[10px] font-medium hover:bg-error/20 transition-colors"
              title="Close session"
            >
              <X className="w-3 h-3" /> Close
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                onClick={handleClose}
                disabled={closeMutation.isPending}
                className="px-2 py-1 rounded-lg bg-error text-on-error text-[10px] font-bold hover:bg-error/90 transition-colors disabled:opacity-50"
              >
                {closeMutation.isPending ? '...' : 'Confirm'}
              </button>
              <button
                onClick={() => setShowCloseConfirm(false)}
                className="px-2 py-1 rounded-lg bg-surface-container-highest text-on-surface-variant text-[10px] hover:bg-surface-bright transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Extend Panel */}
      {showExtend && (
        <div className="px-6 pb-3">
          <div className="bg-surface-container-high rounded-xl p-4 ml-6 flex items-center gap-4">
            <span className="text-xs text-on-surface-variant">Extend by:</span>
            <select
              value={extendMinutes}
              onChange={(e) => setExtendMinutes(Number(e.target.value))}
              className="bg-surface-container-highest rounded-xl px-3 py-1.5 text-xs text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
            >
              <option value={30}>30 minutes</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
              <option value={240}>4 hours</option>
              <option value={480}>8 hours</option>
            </select>
            <button
              onClick={handleExtend}
              disabled={extendMutation.isPending}
              className="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-4 py-1.5 rounded-xl text-xs hover:shadow-[0_0_20px_rgba(173,198,255,0.4)] transition-all active:scale-95 disabled:opacity-50"
            >
              {extendMutation.isPending ? 'Extending...' : 'Apply'}
            </button>
            <button
              onClick={() => setShowExtend(false)}
              className="text-xs text-on-surface-variant hover:text-on-surface transition-colors"
            >
              Cancel
            </button>
            {extendMutation.isError && (
              <span className="text-xs text-error">
                {(extendMutation.error as Error)?.message ?? 'Failed to extend'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Endpoint info */}
      {session.localEndpoint && (
        <div className="px-6 pb-2">
          <div className="ml-6 text-[10px] font-technical text-on-surface-variant/60">
            Local endpoint: <span className="text-on-surface">{session.localEndpoint}</span>
          </div>
        </div>
      )}
    </div>
  );
}
