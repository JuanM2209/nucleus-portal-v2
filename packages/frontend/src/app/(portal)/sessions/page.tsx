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
  Users,
  Cpu,
  Network,
  ChevronDown,
  ChevronRight,
  Zap,
  Shield,
} from 'lucide-react';
import { useAllSessions, useExtendSession, useCloseSession } from '@/hooks/use-sessions';

/* ─── Types ─── */

interface ActiveSession {
  readonly id: string;
  readonly deviceId: string;
  readonly deviceName?: string;
  readonly deviceSerial?: string;
  readonly userId?: string | null;
  readonly userName?: string | null;
  readonly userEmail?: string | null;
  readonly targetIp?: string;
  readonly targetPort?: number;
  readonly tunnelType?: 'browser' | 'local' | 'export';
  readonly status: string;
  readonly requestedAt?: string;
  readonly openedAt?: string;
  readonly expiresAt?: string;
  readonly proxyPath?: string;
  readonly proxySubdomain?: string;
  readonly localPort?: number;
  readonly remotePort?: number;
  readonly serviceName?: string;
  readonly localEndpoint?: string;
  readonly userIp?: string;
  readonly organizations?: readonly { readonly id: string; readonly name: string }[];
}

interface DeviceGroup {
  readonly deviceId: string;
  readonly deviceName: string;
  readonly sessions: readonly ActiveSession[];
  readonly portGroups: readonly PortGroup[];
}

interface PortGroup {
  readonly targetPort: number;
  readonly sessions: readonly ActiveSession[];
  readonly types: ReadonlySet<string>;
}

/* ─── Helpers ─── */

function groupByDevice(sessions: readonly ActiveSession[]): readonly DeviceGroup[] {
  const deviceMap = new Map<string, ActiveSession[]>();

  for (const s of sessions) {
    const key = s.deviceId;
    const existing = deviceMap.get(key) ?? [];
    deviceMap.set(key, [...existing, s]);
  }

  return Array.from(deviceMap.entries()).map(([deviceId, deviceSessions]) => {
    const deviceName = deviceSessions[0]?.deviceName ?? deviceSessions[0]?.deviceSerial ?? deviceId.slice(0, 8);

    // Group by port within device
    const portMap = new Map<number, ActiveSession[]>();
    for (const s of deviceSessions) {
      const port = s.targetPort ?? 0;
      const existing = portMap.get(port) ?? [];
      portMap.set(port, [...existing, s]);
    }

    const portGroups: PortGroup[] = Array.from(portMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([targetPort, portSessions]) => ({
        targetPort,
        sessions: portSessions,
        types: new Set(portSessions.map((s) => s.tunnelType ?? 'unknown')),
      }));

    return { deviceId, deviceName: String(deviceName).replace(/^Nucleus\s+/i, ''), sessions: deviceSessions, portGroups };
  });
}

function formatDuration(ms: number): string {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getTypeColor(type: string): string {
  switch (type) {
    case 'browser': return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
    case 'export': return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
    case 'local': return 'bg-violet-500/10 text-violet-400 border-violet-500/20';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/20';
  }
}

function getTypeIcon(type: string) {
  switch (type) {
    case 'browser': return Globe;
    case 'export': return ExternalLink;
    case 'local': return Monitor;
    default: return Network;
  }
}

/* ─── Page ─── */

export default function SessionsPage() {
  const { data, isLoading, isError, error, isFetching, dataUpdatedAt } = useAllSessions();
  const sessions: readonly ActiveSession[] = data?.data ?? [];
  const deviceGroups = useMemo(() => groupByDevice(sessions), [sessions]);

  // Stats
  const totalSessions = sessions.length;
  const browserCount = sessions.filter((s) => s.tunnelType === 'browser').length;
  const exportCount = sessions.filter((s) => s.tunnelType === 'export').length;
  const localCount = sessions.filter((s) => s.tunnelType === 'local').length;
  const uniqueDevices = deviceGroups.length;
  const uniqueUsers = new Set(sessions.filter((s) => s.userId).map((s) => s.userId)).size;

  return (
    <div className="min-h-full pb-12">
      {/* Header */}
      <div className="pt-8 pb-6 px-2">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
              Active Sessions
            </h1>
            <p className="text-on-surface-variant mt-1">
              Real-time overview of all tunnel connections across your organization.
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
              Live
            </span>
          </div>
        </div>
      </div>

      <div className="px-2 space-y-5">
        {/* Stats Bar */}
        {!isLoading && !isError && totalSessions > 0 && (
          <div className="grid grid-cols-5 gap-3">
            <StatCard icon={Zap} label="Active Sessions" value={totalSessions} color="text-primary" />
            <StatCard icon={Cpu} label="Devices" value={uniqueDevices} color="text-tertiary" />
            <StatCard icon={Users} label="Users" value={uniqueUsers} color="text-[#8b5cf6]" />
            <StatCard icon={Globe} label="Browser" value={browserCount} color="text-blue-400" />
            <StatCard icon={ExternalLink} label="Export" value={exportCount} color="text-emerald-400" />
          </div>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="bg-surface-container-low rounded-2xl p-16 flex items-center justify-center gap-3 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading sessions...</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="bg-error/5 border border-error/20 rounded-2xl p-6 flex items-center gap-3 text-error">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">Failed to load sessions: {(error as Error)?.message ?? 'Unknown error'}</span>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && totalSessions === 0 && (
          <div className="bg-surface-container-low rounded-2xl p-16 text-center">
            <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-surface-container-highest flex items-center justify-center">
              <Radio className="w-8 h-8 text-on-surface-variant/30" />
            </div>
            <h3 className="font-headline font-bold text-on-surface text-lg mb-2">No active sessions</h3>
            <p className="text-sm text-on-surface-variant max-w-md mx-auto">
              Open a port from a device detail page to establish a tunnel session. Active sessions will appear here grouped by device.
            </p>
          </div>
        )}

        {/* Device Groups */}
        {!isLoading && !isError && deviceGroups.map((group) => (
          <DeviceCard key={group.deviceId} group={group} />
        ))}
      </div>
    </div>
  );
}

/* ─── Stat Card ─── */

function StatCard({ icon: Icon, label, value, color }: {
  readonly icon: React.ElementType;
  readonly label: string;
  readonly value: number;
  readonly color: string;
}) {
  return (
    <div className="bg-surface-container-low rounded-2xl p-4 flex items-center gap-3">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color} bg-current/10`}>
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-2xl font-headline font-extrabold text-on-surface">{value}</p>
        <p className="text-[10px] font-technical text-on-surface-variant/60 uppercase tracking-wider">{label}</p>
      </div>
    </div>
  );
}

/* ─── Device Card ─── */

function DeviceCard({ group }: { readonly group: DeviceGroup }) {
  const [expanded, setExpanded] = useState(true);
  const sessionCount = group.sessions.length;
  const portCount = group.portGroups.length;

  // Collect unique tunnel types
  const allTypes = new Set(group.sessions.map((s) => s.tunnelType ?? 'unknown'));

  // Collect org names from the first session that has them
  const orgNames = group.sessions.find((s) => s.organizations && s.organizations.length > 0)?.organizations ?? [];

  return (
    <div className="bg-surface-container-low rounded-2xl overflow-hidden border border-outline-variant/5">
      {/* Device Header */}
      <button
        onClick={() => setExpanded((p) => !p)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-container-high/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Monitor className="w-5 h-5 text-primary" />
          </div>
          <div className="text-left">
            <h2 className="font-headline font-bold text-on-surface text-base">{group.deviceName}</h2>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-technical text-on-surface-variant/50">
                {portCount} port{portCount !== 1 ? 's' : ''} · {sessionCount} session{sessionCount !== 1 ? 's' : ''}
              </p>
              {orgNames.length > 0 && (
                <span className="text-[10px] font-technical text-on-surface-variant/40">
                  — {orgNames.map((o) => o.name).join(' · ')}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Type badges */}
          <div className="flex items-center gap-1.5">
            {Array.from(allTypes).map((type) => {
              const TypeIcon = getTypeIcon(type);
              return (
                <span
                  key={type}
                  className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getTypeColor(type)}`}
                >
                  <TypeIcon className="w-2.5 h-2.5" />
                  {type}
                </span>
              );
            })}
          </div>
          {/* Active indicator */}
          <span className="flex items-center gap-1.5 text-[10px] font-bold text-tertiary uppercase tracking-wider">
            <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
            Active
          </span>
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-on-surface-variant/40" />
          ) : (
            <ChevronRight className="w-4 h-4 text-on-surface-variant/40" />
          )}
        </div>
      </button>

      {/* Port Groups */}
      {expanded && (
        <div className="border-t border-outline-variant/5">
          {group.portGroups.map((pg) => (
            <PortGroupRow key={pg.targetPort} portGroup={pg} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Port Group Row ─── */

function PortGroupRow({ portGroup }: { readonly portGroup: PortGroup }) {
  const { targetPort, sessions } = portGroup;
  const [showActions, setShowActions] = useState<string | null>(null);

  return (
    <div className="border-b border-outline-variant/5 last:border-b-0">
      {/* Port Header */}
      <div className="px-6 py-3 bg-surface-container-high/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-surface-container-highest flex items-center justify-center">
              <Network className="w-3.5 h-3.5 text-on-surface-variant/60" />
            </div>
            <div>
              <span className="font-technical text-sm font-bold text-on-surface">
                Port {targetPort}
              </span>
              {sessions[0]?.serviceName && (
                <span className="ml-2 text-[10px] font-technical text-on-surface-variant/50 uppercase">
                  {sessions[0].serviceName}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-technical text-on-surface-variant/50">
              {sessions.length} connection{sessions.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* Sessions under this port */}
      <div className="divide-y divide-outline-variant/5">
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            showActions={showActions === session.id}
            onToggleActions={() => setShowActions((prev) => (prev === session.id ? null : session.id))}
          />
        ))}
      </div>
    </div>
  );
}

/* ─── Session Row ─── */

function SessionRow({ session, showActions, onToggleActions }: {
  readonly session: ActiveSession;
  readonly showActions: boolean;
  readonly onToggleActions: () => void;
}) {
  const [showExtend, setShowExtend] = useState(false);
  const [extendMinutes, setExtendMinutes] = useState(60);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const extendMutation = useExtendSession();
  const closeMutation = useCloseSession();

  const tunnelType = session.tunnelType ?? 'unknown';
  const TypeIcon = getTypeIcon(tunnelType);

  // Expiry calculations
  const expiresDate = session.expiresAt ? new Date(session.expiresAt) : null;
  const expiresValid = expiresDate && !isNaN(expiresDate.getTime());
  const timeLeft = expiresValid ? Math.max(0, expiresDate.getTime() - Date.now()) : null;
  const isExpiringSoon = timeLeft !== null && timeLeft < 3_600_000 && timeLeft > 0;

  // Uptime
  const startDate = session.openedAt ?? session.requestedAt;
  const uptime = startDate ? Date.now() - new Date(startDate).getTime() : null;

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
    <div className="px-6 py-3 hover:bg-surface-container-high/20 transition-colors">
      <div className="flex items-center gap-4">
        {/* Type badge */}
        <span className={`inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border ${getTypeColor(tunnelType)}`}>
          <TypeIcon className="w-2.5 h-2.5" />
          {tunnelType}
        </span>

        {/* User */}
        <div className="flex items-center gap-2 min-w-[140px]">
          {session.userName || session.userEmail ? (
            <>
              <div className="w-6 h-6 rounded-full bg-primary/15 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                {(session.userName ?? session.userEmail ?? '?')[0].toUpperCase()}
              </div>
              <div className="min-w-0">
                <span className="text-xs font-medium text-on-surface block truncate">
                  {session.userName ?? 'Unknown'}
                </span>
                {session.userEmail && (
                  <span className="text-[10px] text-on-surface-variant/50 font-technical block truncate">
                    {session.userEmail}
                  </span>
                )}
              </div>
            </>
          ) : (
            <span className="text-xs text-on-surface-variant/40 font-technical">System</span>
          )}
        </div>

        {/* Target */}
        <div className="font-technical text-xs text-on-surface-variant min-w-[160px]">
          {tunnelType === 'export' && session.remotePort
            ? (
              <span className="flex items-center gap-1">
                <span className="text-on-surface font-medium">:{session.remotePort}</span>
                <span className="text-on-surface-variant/40">→</span>
                <span>:{session.targetPort}</span>
              </span>
            )
            : session.targetIp
            ? `${session.targetIp}:${session.targetPort ?? '--'}`
            : '--'}
        </div>

        {/* Started */}
        <div className="flex items-center gap-1.5 min-w-[100px]">
          <Clock className="w-3 h-3 text-on-surface-variant/30" />
          <span className="text-[11px] font-technical text-on-surface-variant">
            {formatTime(session.openedAt ?? session.requestedAt)}
          </span>
        </div>

        {/* Uptime */}
        <div className="min-w-[70px]">
          <span className="text-[11px] font-technical text-on-surface-variant/60">
            {uptime !== null && uptime > 0 ? formatDuration(uptime) : '--'}
          </span>
        </div>

        {/* Expires */}
        <div className="min-w-[80px]">
          <span className={`text-[11px] font-technical ${isExpiringSoon ? 'text-error font-bold' : 'text-on-surface-variant/60'}`}>
            {timeLeft !== null ? `${formatDuration(timeLeft)} left` : 'No expiry'}
          </span>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 ml-auto">
          {session.localEndpoint && (
            <span className="text-[10px] font-technical text-on-surface-variant/40 mr-1">
              {session.localEndpoint}
            </span>
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
        <div className="mt-3 ml-8">
          <div className="bg-surface-container-high rounded-xl p-3 flex items-center gap-3">
            <span className="text-xs text-on-surface-variant">Extend by:</span>
            <select
              value={extendMinutes}
              onChange={(e) => setExtendMinutes(Number(e.target.value))}
              className="bg-surface-container-highest rounded-lg px-2.5 py-1 text-xs text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
            >
              <option value={30}>30 min</option>
              <option value={60}>1 hour</option>
              <option value={120}>2 hours</option>
              <option value={240}>4 hours</option>
              <option value={480}>8 hours</option>
            </select>
            <button
              onClick={handleExtend}
              disabled={extendMutation.isPending}
              className="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-3 py-1 rounded-lg text-xs hover:shadow-[0_0_16px_rgba(173,198,255,0.3)] transition-all active:scale-95 disabled:opacity-50"
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
              <span className="text-xs text-error ml-2">
                {(extendMutation.error as Error)?.message ?? 'Failed'}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
