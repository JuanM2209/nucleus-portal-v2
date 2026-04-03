'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Search,
  Info,
  ArrowUpRight,
  ArrowDownRight,
  Wifi,
  WifiOff,
  Zap,
  Radar,
  Building2,
  ArrowLeftRight,
  ScrollText,
} from 'lucide-react';
import { NucleusOrb } from '@/components/nucleus-orb';
import { AnimatedBackground } from '@/components/animated-bg';
import { useDashboardStats, useDeviceStats } from '@/hooks/use-dashboard';

interface DayCount {
  day: string;
  count: number;
}

interface ActionCount {
  action: string;
  count: number;
}

interface ActiveSession {
  id: string;
  tunnelType?: string;
  targetPort?: number;
  deviceName?: string;
  userName?: string;
  createdAt?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [deviceSearch, setDeviceSearch] = useState('');

  const { data: dashboardData, isLoading: dashLoading } = useDashboardStats();
  const { data: deviceStats } = useDeviceStats();

  const totalDevices = dashboardData?.devices?.meta?.total ?? 0;
  const onlineCount = deviceStats?.online ?? 0;
  const offlineCount = deviceStats?.offline ?? 0;

  // Tenant-wide sessions from /sessions/all — API returns { success, data: [...] }
  const allSessionsRaw = dashboardData?.allSessions;
  const allSessions: ActiveSession[] = Array.isArray(allSessionsRaw?.data)
    ? allSessionsRaw.data
    : [];
  const activeSessions = allSessions.length;

  const totalOrgs = Array.isArray(dashboardData?.orgs?.data) ? dashboardData.orgs.data.length : 0;
  const totalLogs = dashboardData?.logs?.total ?? 0;

  // Log stats for charts — API returns { success, data: { actionsPerDay, actionCounts, ... } }
  const logStatsRaw = dashboardData?.logStats;
  const logStats = logStatsRaw?.data ?? logStatsRaw ?? {};
  const actionsPerDay: DayCount[] = Array.isArray(logStats?.actionsPerDay) ? logStats.actionsPerDay : [];
  const actionCounts: ActionCount[] = Array.isArray(logStats?.actionCounts) ? logStats.actionCounts : [];

  function handleConnect() {
    const trimmed = deviceSearch.trim();
    if (!trimmed) return;
    router.push(`/devices?search=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="min-h-full pb-12 relative">
      {/* Animated mesh background */}
      <AnimatedBackground />

      {/* HERO — Compact with search */}
      <section className="relative z-10">
        {/* Background ambient glow */}
        <div className="absolute -inset-8 bg-gradient-to-br from-primary/4 via-transparent to-tertiary/3 pointer-events-none blur-sm opacity-60" />
        <div className="absolute -top-10 -right-10 w-[500px] h-[500px] bg-primary/3 rounded-full blur-[160px] pointer-events-none" />

        <div className="relative grid grid-cols-1 lg:grid-cols-3 gap-6 items-center pt-0 pb-2 px-8 max-w-[1600px] mx-auto">
          {/* Left: Title + Search (2 cols) */}
          <div className="lg:col-span-2 space-y-7">
            <div>
              <h2 className="font-headline text-3xl lg:text-[2.6rem] font-extrabold text-on-surface tracking-tight leading-[1.15]">
                Secure Remote Access,{' '}
                <span className="bg-gradient-to-r from-primary via-primary to-tertiary bg-clip-text text-transparent">
                  Zero Complexity.
                </span>
              </h2>
              <p className="text-on-surface-variant text-[15px] mt-4 max-w-lg leading-relaxed">
                Connect to any device, anywhere in the world. Real-time telemetry, encrypted tunnels, and full fleet orchestration — all from one portal.
              </p>
            </div>

            <div className="relative max-w-2xl">
              <div className="absolute inset-y-0 left-5 flex items-center pointer-events-none">
                <Search className="w-5 h-5 text-primary" />
              </div>
              <input
                value={deviceSearch}
                onChange={(e) => setDeviceSearch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                className="w-full h-16 bg-surface-container-high/80 backdrop-blur-sm rounded-2xl border border-outline-variant/10 pl-14 pr-40 text-[15px] font-body text-on-surface focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/30 placeholder:text-outline-variant transition-all shadow-lg shadow-black/5"
                placeholder="Search by Device ID, serial number, or alias..."
                type="text"
              />
              <div className="absolute inset-y-0 right-2.5 flex items-center">
                <button
                  onClick={handleConnect}
                  className="bg-gradient-to-br from-primary to-primary-container text-on-primary font-bold px-8 py-2.5 rounded-xl hover:shadow-[0_0_28px_rgba(173,198,255,0.35)] transition-all active:scale-95 text-sm"
                >
                  CONNECT
                </button>
              </div>
            </div>

            <div className="flex items-center gap-6 text-xs text-on-surface-variant/50">
              <span className="flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5" />
                Supports serial, alias, or Nucleus ID
              </span>
              <span className="flex items-center gap-1.5">
                <Zap className="w-3.5 h-3.5 text-tertiary" />
                End-to-end encrypted tunnel
              </span>
            </div>
          </div>

          {/* Right: Nucleus Orb */}
          <div className="lg:col-span-1 flex items-center justify-end pr-4">
            <div
              className="relative"
              style={{
                maskImage: 'radial-gradient(ellipse 65% 65% at 50% 50%, black 50%, transparent 100%)',
                WebkitMaskImage: 'radial-gradient(ellipse 65% 65% at 50% 50%, black 50%, transparent 100%)',
              }}
            >
              <NucleusOrb size={460} />
            </div>
          </div>
        </div>
      </section>

      {/* STAT CARDS — 4 columns */}
      <section className="relative z-10 grid grid-cols-2 lg:grid-cols-4 gap-4 px-8 max-w-[1600px] mx-auto -mt-1">
        {/* Device Overview — Donut */}
        <div className="bg-surface-container-high/60 backdrop-blur-sm rounded-xl p-4 border border-outline-variant/5 hover:border-outline-variant/15 transition-all group">
          <DeviceDonut total={totalDevices || (onlineCount + offlineCount)} online={onlineCount} />
        </div>
        <MetricCard
          label="Organizations"
          value={dashLoading ? '--' : String(totalOrgs)}
          subtext="active organizations"
          trend={totalOrgs > 0 ? 'managed' : 'create one'}
          trendUp={totalOrgs > 0}
          sparkData={[1, 1, 1, 1, 2, 2, 2, 2, totalOrgs, totalOrgs]}
          sparkColor="#adc6ff"
          icon={<Building2 className="w-4 h-4" />}
          iconColor="text-primary"
        />
        <MetricCard
          label="Tunnel Sessions"
          value={dashLoading ? '--' : String(activeSessions)}
          subtext="active connections"
          trend={activeSessions > 0 ? 'live' : 'none active'}
          trendUp={activeSessions > 0}
          sparkData={[0, 1, 2, 1, 3, 2, 4, 3, activeSessions, activeSessions]}
          sparkColor={activeSessions > 0 ? '#4edea3' : '#adc6ff'}
          icon={<ArrowLeftRight className="w-4 h-4" />}
          iconColor={activeSessions > 0 ? 'text-tertiary' : 'text-on-surface-variant'}
          pulse={activeSessions > 0}
        />
        <MetricCard
          label="Activity Logs"
          value={dashLoading ? '--' : totalLogs > 0 ? String(totalLogs) : '0'}
          subtext="total events recorded"
          trend="all time"
          sparkData={actionsPerDay.length >= 5
            ? actionsPerDay.slice(-10).map(d => d.count)
            : [5, 8, 12, 10, 15, 18, 14, 20, 22, totalLogs > 30 ? 30 : totalLogs]}
          sparkColor="#c4b5fd"
          icon={<ScrollText className="w-4 h-4" />}
          iconColor="text-[#c4b5fd]"
        />
      </section>

      {/* MAIN CONTENT — 3 column layout */}
      <section className="relative z-10 grid grid-cols-12 gap-5 px-8 pt-6 max-w-[1600px] mx-auto">

        {/* LEFT: Activity Chart (8 cols) */}
        <div className="col-span-12 lg:col-span-8 bg-surface-container-high/60 backdrop-blur-sm rounded-xl p-6 border border-outline-variant/5">
          <div className="flex items-center justify-between mb-5">
            <div>
              <h3 className="font-headline font-bold text-on-surface text-sm">Portal Activity</h3>
              <p className="text-[11px] text-on-surface-variant mt-0.5">
                {actionsPerDay.length > 0
                  ? `Daily events across all users — last ${actionsPerDay.length} days`
                  : 'Daily events across all users'}
              </p>
            </div>
            <div className="flex items-center gap-5 text-[10px] font-technical text-on-surface-variant">
              <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 rounded bg-tertiary inline-block" /> Events</span>
              {actionCounts.length > 0 && (
                <span className="flex items-center gap-1.5"><span className="w-2 h-0.5 rounded bg-primary inline-block opacity-60" /> {actionCounts.length} action types</span>
              )}
            </div>
          </div>
          <ActivityChart actionsPerDay={actionsPerDay} />
        </div>

        {/* RIGHT: Active Services (4 cols) */}
        <div className="col-span-12 lg:col-span-4 space-y-5">
          <div className="bg-surface-container-high/60 backdrop-blur-sm rounded-xl p-5 border border-outline-variant/5">
            <h3 className="font-headline font-bold text-on-surface text-sm mb-1">Active Services</h3>
            <p className="text-[11px] text-on-surface-variant mb-4">
              {activeSessions > 0 ? `${activeSessions} live tunnel${activeSessions !== 1 ? 's' : ''} across devices` : 'No active tunnels'}
            </p>
            <ActiveServicesPanel sessions={allSessions} actionCounts={actionCounts} />
          </div>
        </div>
      </section>
    </div>
  );
}

/* ===============================================
   METRIC CARD with Sparkline
   =============================================== */

let _sparkUid = 0;
function MetricCard({
  label, value, subtext, trend, trendUp, sparkData, sparkColor, icon, iconColor, pulse,
}: {
  label: string; value: string; subtext: string; trend: string; trendUp?: boolean;
  sparkData: number[]; sparkColor: string; icon: React.ReactNode; iconColor: string; pulse?: boolean;
}) {
  const gradId = useMemo(() => `spk-${++_sparkUid}`, []);

  const { linePath, areaPath } = useMemo(() => {
    const max = Math.max(...sparkData);
    const min = Math.min(...sparkData);
    const range = max - min || 1;
    const w = 120; const h = 36; const padY = 4;
    const pts = sparkData.map((v, i) => ({
      x: (i / (sparkData.length - 1)) * w,
      y: h - padY - ((v - min) / range) * (h - padY * 2),
    }));
    let line = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const cpx = (prev.x + cur.x) / 2;
      line += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${cur.y.toFixed(1)}, ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
    }
    const area = line + ` L ${w} ${h} L 0 ${h} Z`;
    return { linePath: line, areaPath: area };
  }, [sparkData]);

  return (
    <div className="bg-surface-container-high/60 backdrop-blur-sm rounded-xl p-4 border border-outline-variant/5 hover:border-outline-variant/15 transition-all group relative overflow-hidden">
      <div className="absolute bottom-0 left-0 right-0 h-14 opacity-30 group-hover:opacity-50 transition-opacity duration-500">
        <svg viewBox="0 0 120 36" className="w-full h-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={sparkColor} stopOpacity="0.4" />
              <stop offset="100%" stopColor={sparkColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
          <path d={linePath} fill="none" stroke={sparkColor} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
        </svg>
      </div>
      <div className="relative z-10">
        <div className="flex items-center gap-2 mb-3">
          <span className={`${iconColor} opacity-60`}>{icon}</span>
          <span className="text-[11px] text-on-surface-variant font-medium">{label}</span>
          {pulse && <span className="w-1.5 h-1.5 bg-tertiary rounded-full animate-pulse" />}
        </div>
        <p className="text-2xl font-headline font-bold text-on-surface leading-none">{value}</p>
        <div className="flex items-center justify-between mt-2">
          <span className="text-[10px] text-on-surface-variant">{subtext}</span>
          <span className={`text-[10px] font-technical flex items-center gap-0.5 ${trendUp ? 'text-tertiary' : trend === 'action needed' ? 'text-error' : 'text-on-surface-variant/50'}`}>
            {trendUp !== undefined && (trendUp ? <ArrowUpRight className="w-3 h-3" /> : (trend === 'action needed' ? <ArrowDownRight className="w-3 h-3" /> : null))}
            {trend}
          </span>
        </div>
      </div>
    </div>
  );
}

/* ===============================================
   ACTIVITY CHART — Real data from /logs/stats
   =============================================== */

function ActivityChart({ actionsPerDay }: { actionsPerDay: DayCount[] }) {
  // Take last 14 days max for readability
  const data = actionsPerDay.slice(-14);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-52 text-on-surface-variant/40 text-sm">
        No activity data yet — events will appear here as users interact with the portal
      </div>
    );
  }

  const counts = data.map(d => d.count);
  const maxCount = Math.max(...counts, 1);
  const w = 900;
  const h = 160;
  const pad = 12;
  const step = data.length > 1 ? w / (data.length - 1) : w;

  // Build smooth path
  const pts = counts.map((c, i) => ({
    x: data.length > 1 ? i * step : w / 2,
    y: h - pad - (c / maxCount) * (h - pad * 2),
  }));

  let linePath = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1];
    const cur = pts[i];
    const cpx = (prev.x + cur.x) / 2;
    linePath += ` C ${cpx.toFixed(1)} ${prev.y.toFixed(1)}, ${cpx.toFixed(1)} ${cur.y.toFixed(1)}, ${cur.x.toFixed(1)} ${cur.y.toFixed(1)}`;
  }
  const areaPath = linePath + ` L ${w} ${h} L 0 ${h} Z`;

  // Date labels (show ~7 evenly spaced)
  const labelCount = Math.min(data.length, 7);
  const labelStep = Math.max(1, Math.floor((data.length - 1) / (labelCount - 1)));
  const labels: { x: number; text: string }[] = [];
  for (let i = 0; i < data.length; i += labelStep) {
    const d = new Date(data[i].day);
    const text = i === data.length - 1 ? 'Today' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    labels.push({ x: data.length > 1 ? i * step : w / 2, text });
  }
  // Always include last point
  if (labels.length > 0 && labels[labels.length - 1].x < (data.length - 1) * step - step * 0.5) {
    labels.push({ x: (data.length - 1) * step, text: 'Today' });
  }

  return (
    <svg viewBox={`0 0 ${w} ${h + 28}`} className="w-full h-52" preserveAspectRatio="none">
      <defs>
        <linearGradient id="activity-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4edea3" stopOpacity="0.15" />
          <stop offset="100%" stopColor="#4edea3" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(f => (
        <line key={f} x1={0} y1={h * f} x2={w} y2={h * f} stroke="#2d3449" strokeWidth="0.5" strokeDasharray="4 4" />
      ))}
      {/* Y-axis labels */}
      {[0, 0.5, 1].map(f => {
        const val = Math.round(maxCount * (1 - f));
        return (
          <text key={f} x={-4} y={pad + f * (h - pad * 2) + 3} fill="#6b7280" fontSize="8" textAnchor="end" fontFamily="'JetBrains Mono', monospace">
            {val}
          </text>
        );
      })}
      {/* Area + Line */}
      <path d={areaPath} fill="url(#activity-grad)" />
      <path d={linePath} fill="none" stroke="#4edea3" strokeWidth="2" strokeLinecap="round" />
      {/* Dots on line */}
      {pts.map((pt, i) => {
        const isLast = i === pts.length - 1;
        const showDot = isLast || i % Math.max(1, Math.floor(pts.length / 6)) === 0;
        if (!showDot) return null;
        return (
          <g key={i}>
            {isLast && <circle cx={pt.x} cy={pt.y} r="8" fill="#4edea3" opacity="0.15" />}
            <circle cx={pt.x} cy={pt.y} r={isLast ? 4 : 2.5} fill="#4edea3" opacity={isLast ? 1 : 0.5} />
          </g>
        );
      })}
      {/* Date labels */}
      {labels.map((l, i) => (
        <text key={i} x={l.x} y={h + 20} fill="#6b7280" fontSize="9" textAnchor="middle" fontFamily="'JetBrains Mono', monospace">
          {l.text}
        </text>
      ))}
    </svg>
  );
}

/* ===============================================
   ACTIVE SERVICES PANEL — Real session data
   =============================================== */

function ActiveServicesPanel({
  sessions,
  actionCounts,
}: {
  sessions: ActiveSession[];
  actionCounts: ActionCount[];
}) {
  // If there are active sessions, show them as service bars
  if (sessions.length > 0) {
    // Group by tunnel type
    const typeMap = new Map<string, number>();
    for (const s of sessions) {
      const type = s.tunnelType === 'export' ? 'Export (TCP)' : s.tunnelType === 'local' ? 'Local Proxy' : 'Web Proxy';
      typeMap.set(type, (typeMap.get(type) ?? 0) + 1);
    }

    const entries = Array.from(typeMap.entries()).sort((a, b) => b[1] - a[1]);
    const maxCount = Math.max(...entries.map(e => e[1]), 1);

    const colorMap: Record<string, [string, string]> = {
      'Web Proxy': ['bg-primary', 'text-primary'],
      'Export (TCP)': ['bg-tertiary', 'text-tertiary'],
      'Local Proxy': ['bg-[#f59e0b]', 'text-[#f59e0b]'],
    };

    return (
      <div className="space-y-3">
        {entries.map(([type, count]) => {
          const pct = Math.min((count / maxCount) * 100, 100);
          const [bg, text] = colorMap[type] ?? ['bg-primary', 'text-primary'];
          return (
            <div key={type}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-on-surface-variant">{type}</span>
                <span className={`text-[11px] font-technical ${text}`}>{count} active</span>
              </div>
              <div className="w-full h-1 bg-surface-container-lowest rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${bg}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}

        {/* Show recent session details */}
        <div className="pt-2 mt-2 border-t border-outline-variant/10 space-y-2">
          <span className="text-[10px] text-on-surface-variant/50 uppercase tracking-wider">Recent</span>
          {sessions.slice(0, 4).map((s) => (
            <div key={s.id} className="flex items-center justify-between text-[11px]">
              <span className="text-on-surface-variant truncate max-w-[60%]">
                {s.deviceName ?? 'Device'} <span className="text-on-surface-variant/40">:{s.targetPort ?? '?'}</span>
              </span>
              <span className="text-on-surface-variant/50 font-technical">
                {s.userName ?? 'Unknown'}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Fallback: show action type breakdown from logs
  if (actionCounts.length > 0) {
    const top5 = actionCounts.slice(0, 5);
    const maxCount = Math.max(...top5.map(a => a.count), 1);

    const actionColors: Record<string, [string, string]> = {
      'session.create': ['bg-tertiary', 'text-tertiary'],
      'session.close': ['bg-primary', 'text-primary'],
      'port.expose': ['bg-[#f59e0b]', 'text-[#f59e0b]'],
      'port.unexpose': ['bg-error', 'text-error'],
      'device.connect': ['bg-tertiary', 'text-tertiary'],
    };

    return (
      <div className="space-y-3">
        <span className="text-[10px] text-on-surface-variant/50 uppercase tracking-wider">Top Actions (All Time)</span>
        {top5.map((a) => {
          const pct = Math.min((a.count / maxCount) * 100, 100);
          const [bg, text] = actionColors[a.action] ?? ['bg-primary/60', 'text-primary'];
          const label = a.action.replace(/\./g, ' ').replace(/^./, c => c.toUpperCase());
          return (
            <div key={a.action}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[11px] text-on-surface-variant">{label}</span>
                <span className={`text-[11px] font-technical ${text}`}>{a.count}</span>
              </div>
              <div className="w-full h-1 bg-surface-container-lowest rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all duration-700 ${bg}`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // No data at all
  return (
    <div className="flex items-center justify-center h-32 text-on-surface-variant/40 text-xs">
      No active services — open a tunnel session to see data here
    </div>
  );
}

/* ===============================================
   DEVICE DONUT — Compact
   =============================================== */

function DeviceDonut({ total, online }: { total: number; online: number }) {
  const offline = total - online;
  const pct = total > 0 ? (online / total) * 100 : 100;
  const circ = 2 * Math.PI * 40;
  const stroke = (pct / 100) * circ;

  return (
    <div className="flex flex-col items-center gap-5">
      <div className="relative w-32 h-32">
        <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#1e2436" strokeWidth="7" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="#4edea3" strokeWidth="7"
            strokeDasharray={`${stroke} ${circ}`} strokeLinecap="round" className="transition-all duration-1000" />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-headline font-bold text-on-surface">{total || 0}</span>
          <span className="text-[9px] text-on-surface-variant uppercase tracking-wider">Devices</span>
        </div>
      </div>
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs text-on-surface-variant">
            <Wifi className="w-3 h-3 text-tertiary" /> Online
          </span>
          <span className="text-xs font-technical text-tertiary">{online} ({pct.toFixed(0)}%)</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-2 text-xs text-on-surface-variant">
            <WifiOff className="w-3 h-3 text-error/50" /> Offline
          </span>
          <span className="text-xs font-technical text-on-surface-variant">{offline}</span>
        </div>
      </div>
    </div>
  );
}
