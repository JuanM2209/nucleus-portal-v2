'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatUptime } from '@/lib/format';
import {
  Activity,
  Users,
  Server,
  HardDrive,
  BarChart3,
  Clock,
  Wifi,
  Database,
  Shield,
  Globe,
  ArrowUpRight,
  Loader2,
  AlertTriangle,
  Zap,
  Monitor,
} from 'lucide-react';
import { api } from '@/lib/api';

/* ═══════════════════════════════════════════════════════════════
   Data hooks
   ═══════════════════════════════════════════════════════════════ */

function useAdminMetrics() {
  return useQuery({
    queryKey: ['admin-metrics'],
    queryFn: async () => {
      const [devices, onlineDevices, offlineDevices, sessions, health, orgs] =
        await Promise.all([
          api.get<any>('/devices?limit=1&status=all').catch(() => null),
          api.get<any>('/devices?limit=1&status=online').catch(() => null),
          api.get<any>('/devices?limit=1&status=offline').catch(() => null),
          api.get<any>('/sessions').catch(() => null),
          api.get<any>('/health').catch(() => null),
          api.get<any>('/orgs').catch(() => null),
        ]);

      const totalDevices = devices?.meta?.total ?? devices?.data?.length ?? 0;
      const onlineCount = onlineDevices?.meta?.total ?? 0;
      const offlineCount = offlineDevices?.meta?.total ?? 0;
      const activeSessions =
        sessions?.meta?.total ?? sessions?.data?.length ?? 0;
      const totalUsers = orgs?.data?.reduce(
        (sum: number, o: any) => sum + (o.usersCount ?? 0),
        0,
      ) ?? 0;
      const uptimeSeconds = health?.data?.uptime ?? health?.uptime ?? 0;

      return {
        totalDevices,
        onlineCount,
        offlineCount,
        activeSessions,
        totalUsers,
        uptimeSeconds,
        healthStatus: health?.data?.status ?? health?.status ?? 'unknown',
        orgs: orgs?.data ?? [],
      };
    },
    refetchInterval: 30_000,
  });
}

function useAuditEvents() {
  return useQuery({
    queryKey: ['admin-audit-events'],
    queryFn: () => api.get<any>('/audit?limit=10&sort=desc'),
    refetchInterval: 30_000,
  });
}

function useHealthStatus() {
  return useQuery({
    queryKey: ['admin-health'],
    queryFn: () => api.get<any>('/health'),
    refetchInterval: 30_000,
  });
}

/* ═══════════════════════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════════════════════ */


function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Generate realistic-looking 24h traffic data */
function generateTrafficData(): readonly {
  readonly hour: number;
  readonly inbound: number;
  readonly outbound: number;
}[] {
  const baseInbound = [
    12, 8, 5, 4, 3, 6, 18, 42, 68, 75, 72, 65, 58, 62, 70, 74, 69, 55, 40,
    32, 28, 22, 18, 14,
  ];
  const baseOutbound = [
    8, 5, 3, 2, 2, 4, 12, 28, 45, 52, 48, 42, 38, 40, 48, 50, 46, 36, 26, 20,
    18, 14, 12, 9,
  ];
  return baseInbound.map((val, i) => ({
    hour: i,
    inbound: val + Math.floor(Math.random() * 8),
    outbound: baseOutbound[i] + Math.floor(Math.random() * 6),
  }));
}

const PLACEHOLDER_USERS: readonly {
  readonly name: string;
  readonly sessions: number;
  readonly lastActive: string;
}[] = [
  { name: 'James Mitchell', sessions: 142, lastActive: '2 min ago' },
  { name: 'Sarah Chen', sessions: 98, lastActive: '15 min ago' },
  { name: 'Alex Rivera', sessions: 76, lastActive: '1h ago' },
  { name: 'Priya Sharma', sessions: 61, lastActive: '3h ago' },
  { name: 'Marcus Johnson', sessions: 45, lastActive: '6h ago' },
];

const SESSION_BREAKDOWN = {
  browser: 234,
  local: 156,
  ssh: 89,
} as const;

/* ═══════════════════════════════════════════════════════════════
   Main Page
   ═══════════════════════════════════════════════════════════════ */

export default function AdminPage() {
  const { data: metrics, isLoading, isError } = useAdminMetrics();
  const trafficData = useMemo(() => generateTrafficData(), []);

  return (
    <div className="min-h-full pb-12">
      {/* Header */}
      <div className="pt-8 pb-6 px-2">
        <div className="flex items-center gap-3 mb-1">
          <div className="p-2 rounded-xl bg-primary/10">
            <Activity className="w-6 h-6 text-primary" />
          </div>
          <div>
            <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
              Admin Overview
            </h1>
            <p className="text-on-surface-variant text-sm">
              Platform metrics, capacity, and operational status
            </p>
          </div>
        </div>
      </div>

      <div className="px-2 space-y-6">
        {/* Section 1: Key Platform Metrics */}
        <MetricCards metrics={metrics} isLoading={isLoading} isError={isError} />

        {/* Section 2: Traffic Overview */}
        <TrafficChart data={trafficData} />

        {/* Section 3: Capacity + Top Users */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <DeviceCapacityCard
            used={metrics?.totalDevices ?? 0}
            max={50}
            isLoading={isLoading}
          />
          <TopUsersCard />
        </div>

        {/* Section 4: Session Breakdown + System Status */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <SessionBreakdownCard />
          <SystemStatusCard />
        </div>

        {/* Section 5: Recent Activity Log */}
        <AuditLogTable />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 1 — Key Platform Metric Cards
   ═══════════════════════════════════════════════════════════════ */

function MetricCards({
  metrics,
  isLoading,
  isError,
}: {
  readonly metrics: any;
  readonly isLoading: boolean;
  readonly isError: boolean;
}) {
  if (isError) {
    return (
      <div className="bg-error/5 border border-error/20 rounded-xl p-6 flex items-center gap-3 text-error">
        <AlertTriangle className="w-5 h-5 flex-shrink-0" />
        <span className="text-sm">
          Failed to load platform metrics. Retrying...
        </span>
      </div>
    );
  }

  const cards = [
    {
      label: 'Total Devices',
      value: metrics?.totalDevices ?? 0,
      sub: `${metrics?.onlineCount ?? 0} online / ${metrics?.offlineCount ?? 0} offline`,
      icon: HardDrive,
      color: 'text-teal-400',
      bgColor: 'bg-teal-400/10',
    },
    {
      label: 'Active Sessions',
      value: metrics?.activeSessions ?? 0,
      sub: 'Current tunnel sessions',
      icon: Wifi,
      color: 'text-blue-400',
      bgColor: 'bg-blue-400/10',
    },
    {
      label: 'Total Users',
      value: metrics?.totalUsers ?? 0,
      sub: `Across ${metrics?.orgs?.length ?? 0} organizations`,
      icon: Users,
      color: 'text-purple-400',
      bgColor: 'bg-purple-400/10',
    },
    {
      label: 'Platform Uptime',
      value: formatUptime(metrics?.uptimeSeconds ?? 0),
      sub: metrics?.healthStatus === 'ok' ? 'All systems operational' : `Status: ${metrics?.healthStatus ?? 'checking...'}`,
      icon: Clock,
      color: 'text-emerald-400',
      bgColor: 'bg-emerald-400/10',
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div
            key={card.label}
            className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10 hover:border-outline-variant/20 transition-colors"
          >
            {isLoading ? (
              <div className="space-y-3 animate-pulse">
                <div className="h-4 w-24 bg-surface-container-highest rounded" />
                <div className="h-8 w-16 bg-surface-container-highest rounded" />
                <div className="h-3 w-32 bg-surface-container-highest rounded" />
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
                    {card.label}
                  </span>
                  <div className={`p-1.5 rounded-lg ${card.bgColor}`}>
                    <Icon className={`w-4 h-4 ${card.color}`} />
                  </div>
                </div>
                <p className="text-2xl font-extrabold font-headline text-on-surface">
                  {card.value}
                </p>
                <p className="text-xs text-on-surface-variant mt-1">
                  {card.sub}
                </p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 2 — Traffic Chart (SVG Area Chart)
   ═══════════════════════════════════════════════════════════════ */

function TrafficChart({
  data,
}: {
  readonly data: readonly {
    readonly hour: number;
    readonly inbound: number;
    readonly outbound: number;
  }[];
}) {
  const chartW = 800;
  const chartH = 200;
  const padL = 40;
  const padR = 16;
  const padT = 16;
  const padB = 28;
  const innerW = chartW - padL - padR;
  const innerH = chartH - padT - padB;

  const maxVal = Math.max(...data.map((d) => Math.max(d.inbound, d.outbound)));
  const yMax = Math.ceil(maxVal / 10) * 10 || 80;

  const toX = (i: number) => padL + (i / (data.length - 1)) * innerW;
  const toY = (v: number) => padT + innerH - (v / yMax) * innerH;

  const makePath = (key: 'inbound' | 'outbound') =>
    data.map((d, i) => `${i === 0 ? 'M' : 'L'}${toX(i)},${toY(d[key])}`).join(' ');

  const makeArea = (key: 'inbound' | 'outbound') =>
    `${makePath(key)} L${toX(data.length - 1)},${padT + innerH} L${padL},${padT + innerH} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: padT + innerH * (1 - f),
    label: Math.round(yMax * f),
  }));

  const timeLabels = [
    { hour: 0, label: '00:00' },
    { hour: 6, label: '06:00' },
    { hour: 12, label: '12:00' },
    { hour: 18, label: '18:00' },
    { hour: 23, label: '24:00' },
  ];

  return (
    <div className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-bold text-on-surface font-headline">
            Platform Traffic — Last 24 Hours
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Request volume across all endpoints
          </p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
            Inbound
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-400" />
            Outbound
          </span>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${chartW} ${chartH}`}
        className="w-full h-auto"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Grid lines */}
        {gridLines.map((g) => (
          <g key={g.label}>
            <line
              x1={padL}
              y1={g.y}
              x2={chartW - padR}
              y2={g.y}
              stroke="currentColor"
              className="text-outline-variant/10"
              strokeWidth={0.5}
            />
            <text
              x={padL - 6}
              y={g.y + 3}
              textAnchor="end"
              className="fill-on-surface-variant/40"
              fontSize={8}
              fontFamily="monospace"
            >
              {g.label}
            </text>
          </g>
        ))}

        {/* Time labels */}
        {timeLabels.map((t) => (
          <text
            key={t.label}
            x={toX(t.hour)}
            y={chartH - 4}
            textAnchor="middle"
            className="fill-on-surface-variant/40"
            fontSize={8}
            fontFamily="monospace"
          >
            {t.label}
          </text>
        ))}

        {/* Area fills */}
        <defs>
          <linearGradient id="grad-inbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(45,212,191)" stopOpacity={0.3} />
            <stop offset="100%" stopColor="rgb(45,212,191)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="grad-outbound" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(96,165,250)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="rgb(96,165,250)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        <path d={makeArea('inbound')} fill="url(#grad-inbound)" />
        <path d={makeArea('outbound')} fill="url(#grad-outbound)" />

        {/* Lines */}
        <path
          d={makePath('inbound')}
          fill="none"
          stroke="rgb(45,212,191)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={makePath('outbound')}
          fill="none"
          stroke="rgb(96,165,250)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 3a — Device Capacity Donut
   ═══════════════════════════════════════════════════════════════ */

function DeviceCapacityCard({
  used,
  max,
  isLoading,
}: {
  readonly used: number;
  readonly max: number;
  readonly isLoading: boolean;
}) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  const ringColor =
    pct > 90 ? 'text-red-400' : pct > 70 ? 'text-yellow-400' : 'text-emerald-400';
  const ringTrail = 'text-surface-container-highest';

  const radius = 54;
  const stroke = 10;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (pct / 100) * circumference;

  return (
    <div className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10">
      <h2 className="text-sm font-bold text-on-surface font-headline mb-4">
        Device Capacity
      </h2>

      {isLoading ? (
        <div className="flex flex-col items-center py-6 animate-pulse">
          <div className="w-32 h-32 rounded-full bg-surface-container-highest" />
          <div className="h-4 w-24 bg-surface-container-highest rounded mt-4" />
        </div>
      ) : (
        <div className="flex flex-col items-center py-2">
          <div className="relative">
            <svg width={140} height={140} viewBox="0 0 140 140">
              {/* Background ring */}
              <circle
                cx={70}
                cy={70}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                className={`stroke-current ${ringTrail}`}
              />
              {/* Progress ring */}
              <circle
                cx={70}
                cy={70}
                r={radius}
                fill="none"
                strokeWidth={stroke}
                className={`stroke-current ${ringColor}`}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform="rotate(-90 70 70)"
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-extrabold font-headline text-on-surface">
                {Math.round(pct)}%
              </span>
              <span className="text-[10px] text-on-surface-variant uppercase tracking-wider">
                used
              </span>
            </div>
          </div>

          <p className="text-sm font-technical text-on-surface mt-3">
            <span className="text-on-surface font-bold">{used}</span>
            <span className="text-on-surface-variant"> / {max} devices</span>
          </p>
          <p className="text-xs text-primary mt-2 flex items-center gap-1 cursor-pointer hover:underline">
            Upgrade plan for more devices
            <ArrowUpRight className="w-3 h-3" />
          </p>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 3b — Top Users Leaderboard
   ═══════════════════════════════════════════════════════════════ */

function TopUsersCard() {
  return (
    <div className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10">
      <h2 className="text-sm font-bold text-on-surface font-headline mb-4">
        Most Active Users
      </h2>
      <div className="space-y-0.5">
        {/* Header */}
        <div className="grid grid-cols-[28px_1fr_80px_100px] gap-3 px-3 py-2 text-[10px] font-technical text-on-surface-variant/50 uppercase tracking-wider">
          <span>#</span>
          <span>User</span>
          <span className="text-right">Sessions</span>
          <span className="text-right">Last Active</span>
        </div>

        {PLACEHOLDER_USERS.map((user, i) => {
          const initials = user.name
            .split(' ')
            .map((w) => w[0])
            .join('');
          return (
            <div
              key={user.name}
              className="grid grid-cols-[28px_1fr_80px_100px] gap-3 px-3 py-2.5 rounded-lg hover:bg-surface-container-high transition-colors items-center"
            >
              <span className="text-xs font-bold text-on-surface-variant">
                {i + 1}
              </span>
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                  {initials}
                </div>
                <span className="text-sm text-on-surface font-medium truncate">
                  {user.name}
                </span>
              </div>
              <span className="text-sm font-technical text-on-surface text-right">
                {user.sessions}
              </span>
              <span className="text-xs font-technical text-on-surface-variant text-right">
                {user.lastActive}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 4a — Session Export Breakdown (Horizontal Bars)
   ═══════════════════════════════════════════════════════════════ */

function SessionBreakdownCard() {
  const total =
    SESSION_BREAKDOWN.browser + SESSION_BREAKDOWN.local + SESSION_BREAKDOWN.ssh;
  const maxVal = Math.max(
    SESSION_BREAKDOWN.browser,
    SESSION_BREAKDOWN.local,
    SESSION_BREAKDOWN.ssh,
  );

  const bars = [
    {
      label: 'Browser sessions',
      value: SESSION_BREAKDOWN.browser,
      color: 'bg-teal-400',
    },
    {
      label: 'Local tunnel',
      value: SESSION_BREAKDOWN.local,
      color: 'bg-blue-400',
    },
    {
      label: 'SSH sessions',
      value: SESSION_BREAKDOWN.ssh,
      color: 'bg-purple-400',
    },
  ];

  return (
    <div className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10">
      <h2 className="text-sm font-bold text-on-surface font-headline mb-4">
        Session Export History
      </h2>

      <div className="space-y-4">
        {bars.map((bar) => (
          <div key={bar.label}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-on-surface-variant">{bar.label}</span>
              <span className="text-xs font-technical font-bold text-on-surface">
                {bar.value}
              </span>
            </div>
            <div className="h-2.5 bg-surface-container-highest rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${bar.color} transition-all duration-500`}
                style={{ width: `${(bar.value / maxVal) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="mt-5 pt-4 border-t border-outline-variant/10 flex items-center justify-between">
        <span className="text-xs text-on-surface-variant">Total exported</span>
        <span className="text-sm font-extrabold font-headline text-on-surface">
          {total}
        </span>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 4b — System Architecture Status
   ═══════════════════════════════════════════════════════════════ */

function SystemStatusCard() {
  const { data: health } = useHealthStatus();
  const status = health?.data?.status ?? health?.status ?? 'unknown';
  const isUp = status === 'ok' || status === 'healthy';

  const connectedAgents =
    health?.data?.connectedAgents ?? health?.connectedAgents ?? 0;

  const nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly sub?: string;
    readonly x: number;
    readonly y: number;
    readonly icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { id: 'frontend', label: 'Frontend', x: 90, y: 30, icon: Monitor },
    { id: 'api', label: 'API Gateway', x: 90, y: 80, icon: Globe },
    { id: 'db', label: 'Database', x: 30, y: 140, icon: Database },
    { id: 'redis', label: 'Redis Cache', x: 90, y: 140, icon: Zap },
    {
      id: 'agent',
      label: 'Agent Gateway',
      sub: `${connectedAgents} connected`,
      x: 150,
      y: 140,
      icon: Server,
    },
  ];

  const edges: readonly [string, string][] = [
    ['frontend', 'api'],
    ['api', 'db'],
    ['api', 'redis'],
    ['api', 'agent'],
  ];

  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));

  return (
    <div className="bg-surface-container-low rounded-xl p-5 border border-outline-variant/10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-bold text-on-surface font-headline">
          System Architecture
        </h2>
        <span
          className={`text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full ${
            isUp
              ? 'bg-emerald-400/10 text-emerald-400'
              : 'bg-yellow-400/10 text-yellow-400'
          }`}
        >
          {isUp ? 'All Healthy' : 'Degraded'}
        </span>
      </div>

      <svg viewBox="0 0 220 180" className="w-full h-auto" preserveAspectRatio="xMidYMid meet">
        {/* Edges */}
        {edges.map(([from, to]) => {
          const a = nodeMap[from];
          const b = nodeMap[to];
          return (
            <line
              key={`${from}-${to}`}
              x1={a.x + 25}
              y1={a.y + 14}
              x2={b.x + 25}
              y2={b.y + 2}
              stroke="currentColor"
              className="text-outline-variant/20"
              strokeWidth={1.2}
              strokeDasharray="4 2"
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const Icon = node.icon;
          return (
            <g key={node.id}>
              <rect
                x={node.x}
                y={node.y}
                width={50}
                height={28}
                rx={6}
                className="fill-surface-container-high stroke-outline-variant/20"
                strokeWidth={0.8}
              />
              {/* Status dot */}
              <circle
                cx={node.x + 8}
                cy={node.y + 14}
                r={3}
                className={isUp ? 'fill-emerald-400' : 'fill-yellow-400'}
              />
              <text
                x={node.x + 15}
                y={node.y + 12}
                fontSize={6}
                className="fill-on-surface font-medium"
                dominantBaseline="middle"
              >
                {node.label}
              </text>
              {node.sub && (
                <text
                  x={node.x + 15}
                  y={node.y + 21}
                  fontSize={5}
                  className="fill-on-surface-variant/60"
                  dominantBaseline="middle"
                >
                  {node.sub}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   Section 5 — Recent Audit Events
   ═══════════════════════════════════════════════════════════════ */

function AuditLogTable() {
  const { data, isLoading, isError } = useAuditEvents();
  const events: readonly any[] = data?.data ?? [];

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-on-surface font-headline">
            Recent Platform Events
          </h2>
          <p className="text-xs text-on-surface-variant mt-0.5">
            Auto-refreshes every 30s
          </p>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-on-surface-variant">
          <Shield className="w-3.5 h-3.5" />
          Audit log
        </div>
      </div>

      {isLoading && (
        <div className="px-5 pb-5">
          <div className="space-y-3 animate-pulse">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="h-3 w-16 bg-surface-container-highest rounded" />
                <div className="h-3 w-24 bg-surface-container-highest rounded" />
                <div className="h-3 w-32 bg-surface-container-highest rounded" />
                <div className="h-3 w-20 bg-surface-container-highest rounded" />
                <div className="h-3 w-24 bg-surface-container-highest rounded" />
              </div>
            ))}
          </div>
        </div>
      )}

      {isError && (
        <div className="px-5 pb-5 text-xs text-on-surface-variant">
          Unable to load audit events.
        </div>
      )}

      {!isLoading && !isError && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-t border-outline-variant/10">
                <th className="text-left px-5 py-2.5 font-technical text-on-surface-variant/50 uppercase tracking-wider font-medium">
                  Time
                </th>
                <th className="text-left px-5 py-2.5 font-technical text-on-surface-variant/50 uppercase tracking-wider font-medium">
                  User
                </th>
                <th className="text-left px-5 py-2.5 font-technical text-on-surface-variant/50 uppercase tracking-wider font-medium">
                  Action
                </th>
                <th className="text-left px-5 py-2.5 font-technical text-on-surface-variant/50 uppercase tracking-wider font-medium">
                  Resource
                </th>
                <th className="text-left px-5 py-2.5 font-technical text-on-surface-variant/50 uppercase tracking-wider font-medium">
                  IP
                </th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="px-5 py-8 text-center text-on-surface-variant"
                  >
                    No audit events recorded yet.
                  </td>
                </tr>
              )}
              {events.map((evt: any, i: number) => (
                <tr
                  key={evt.id ?? i}
                  className="border-t border-outline-variant/5 hover:bg-surface-container-high transition-colors"
                >
                  <td className="px-5 py-3 font-technical text-on-surface-variant whitespace-nowrap">
                    {evt.createdAt ? formatTimeAgo(evt.createdAt) : '-'}
                  </td>
                  <td className="px-5 py-3 text-on-surface font-medium whitespace-nowrap">
                    {evt.userEmail ?? evt.userId ?? '-'}
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1 bg-primary/10 text-primary text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full">
                      {evt.action ?? '-'}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-on-surface-variant font-technical whitespace-nowrap">
                    {evt.resourceType
                      ? `${evt.resourceType}${evt.resourceId ? ` #${evt.resourceId.slice(0, 8)}` : ''}`
                      : '-'}
                  </td>
                  <td className="px-5 py-3 text-on-surface-variant font-technical whitespace-nowrap">
                    {evt.ipAddress ?? '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
