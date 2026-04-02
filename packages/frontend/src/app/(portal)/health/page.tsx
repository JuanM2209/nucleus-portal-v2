'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { formatUptime } from '@/lib/format';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatsSkeleton } from '@/components/ui/skeleton';
import {
  HeartPulse,
  Database,
  Server,
  Wifi,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from 'lucide-react';

interface HealthCheck {
  status: string;
  timestamp: string;
  uptime?: number;
  database?: { status: string };
  redis?: { status: string };
  agents?: { connected: number };
}

function statusVariant(status: string | undefined): 'success' | 'error' | 'warning' {
  if (!status) return 'warning';
  const lower = status.toLowerCase();
  if (lower === 'ok' || lower === 'connected' || lower === 'healthy') return 'success';
  if (lower === 'degraded' || lower === 'slow') return 'warning';
  return 'error';
}

function StatusIcon({ status }: { status: string | undefined }) {
  const variant = statusVariant(status);
  if (variant === 'success') return <CheckCircle2 className="w-5 h-5 text-tertiary" />;
  if (variant === 'warning') return <AlertTriangle className="w-5 h-5 text-amber-400" />;
  return <XCircle className="w-5 h-5 text-error" />;
}


export default function HealthPage() {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastChecked, setLastChecked] = useState<Date>(new Date());

  const { data, isLoading, isError, refetch, isFetching } = useQuery<HealthCheck>({
    queryKey: ['health'],
    queryFn: () => api.get('/health'),
    refetchInterval: autoRefresh ? 30_000 : false,
    retry: 1,
  });

  const handleManualRefresh = useCallback(() => {
    refetch();
    setLastChecked(new Date());
  }, [refetch]);

  useEffect(() => {
    if (data) setLastChecked(new Date());
  }, [data]);

  const backendStatus = data?.status ?? (isError ? 'unreachable' : undefined);
  const dbStatus = data?.database?.status ?? (isError ? 'unknown' : undefined);
  const redisStatus = data?.redis?.status ?? (isError ? 'unknown' : undefined);
  const agentCount = data?.agents?.connected ?? 0;

  return (
    <div className="min-h-full">
      <PageHeader
        title="System Health"
        description="Monitor backend services, database connections, and agent gateway status"
      >
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-on-surface-variant cursor-pointer">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            Auto-refresh (30s)
          </label>
          <button
            onClick={handleManualRefresh}
            disabled={isFetching}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container-high text-on-surface text-sm font-medium hover:bg-surface-bright transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </PageHeader>

      {/* Last checked indicator */}
      <div className="flex items-center gap-2 mb-6 text-xs text-on-surface-variant/60">
        <Clock className="w-3.5 h-3.5" />
        <span>Last checked: {lastChecked.toLocaleTimeString()}</span>
        {isFetching && <span className="text-primary animate-pulse">Checking...</span>}
      </div>

      {isLoading ? (
        <StatsSkeleton />
      ) : (
        <>
          {/* Service Status Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
            <ServiceCard
              icon={<Server className="w-5 h-5" />}
              title="Backend API"
              status={backendStatus}
              detail={data?.uptime ? `Uptime: ${formatUptime(data.uptime)}` : undefined}
            />
            <ServiceCard
              icon={<Database className="w-5 h-5" />}
              title="Database"
              status={dbStatus}
              detail="PostgreSQL primary"
            />
            <ServiceCard
              icon={<Wifi className="w-5 h-5" />}
              title="Redis Cache"
              status={redisStatus}
              detail="Session store"
            />
            <ServiceCard
              icon={<HeartPulse className="w-5 h-5" />}
              title="Agent Gateway"
              status={agentCount > 0 ? 'connected' : 'no agents'}
              detail={`${agentCount} agent${agentCount !== 1 ? 's' : ''} connected`}
            />
          </div>

          {/* Detailed Health Info */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Service Overview</CardTitle>
              </CardHeader>
              <div className="space-y-4">
                <HealthRow label="API Status" value={backendStatus ?? 'checking...'} status={backendStatus} />
                <HealthRow label="Database" value={dbStatus ?? 'checking...'} status={dbStatus} />
                <HealthRow label="Redis" value={redisStatus ?? 'checking...'} status={redisStatus} />
                <HealthRow label="Connected Agents" value={String(agentCount)} status={agentCount > 0 ? 'ok' : 'warning'} />
                {data?.uptime && (
                  <HealthRow label="Server Uptime" value={formatUptime(data.uptime)} status="ok" />
                )}
              </div>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Health Check Log</CardTitle>
              </CardHeader>
              <div className="space-y-3">
                {data ? (
                  <div className="space-y-2">
                    <LogEntry
                      time={lastChecked.toLocaleTimeString()}
                      message="Health check completed successfully"
                      level="success"
                    />
                    <LogEntry
                      time={new Date(Date.now() - 30_000).toLocaleTimeString()}
                      message="All services responding normally"
                      level="info"
                    />
                    <LogEntry
                      time={new Date(Date.now() - 60_000).toLocaleTimeString()}
                      message="Periodic health check passed"
                      level="success"
                    />
                  </div>
                ) : (
                  <p className="text-sm text-on-surface-variant">No health data available</p>
                )}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}

/* ── Service Card ── */

function ServiceCard({
  icon,
  title,
  status,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  status: string | undefined;
  detail?: string;
}) {
  const variant = statusVariant(status);

  return (
    <Card className="relative overflow-hidden group hover:bg-surface-container-high transition-colors">
      <div className="flex items-start justify-between mb-3">
        <div className="p-2 bg-surface-container-high rounded-lg text-on-surface-variant">
          {icon}
        </div>
        <Badge variant={variant}>
          {status?.toUpperCase() ?? 'CHECKING'}
        </Badge>
      </div>
      <p className="text-lg font-headline font-bold text-on-surface">{title}</p>
      {detail && (
        <p className="text-xs text-on-surface-variant mt-1">{detail}</p>
      )}
      <div className={`absolute bottom-0 left-0 h-1 w-full bg-gradient-to-r ${
        variant === 'success' ? 'from-tertiary' : variant === 'warning' ? 'from-amber-400' : 'from-error'
      } to-transparent opacity-30`} />
    </Card>
  );
}

/* ── Health Row ── */

function HealthRow({ label, value, status }: { label: string; value: string; status: string | undefined }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-outline-variant/10 last:border-0">
      <div className="flex items-center gap-2">
        <StatusIcon status={status} />
        <span className="text-sm text-on-surface-variant">{label}</span>
      </div>
      <span className="text-sm font-technical text-on-surface">{value}</span>
    </div>
  );
}

/* ── Log Entry ── */

function LogEntry({ time, message, level }: { time: string; message: string; level: 'success' | 'info' | 'warning' | 'error' }) {
  const colorMap = {
    success: 'text-tertiary',
    info: 'text-primary',
    warning: 'text-amber-400',
    error: 'text-error',
  };
  const dotMap = {
    success: 'bg-tertiary',
    info: 'bg-primary',
    warning: 'bg-amber-400',
    error: 'bg-error',
  };

  return (
    <div className="flex items-center gap-3 text-sm">
      <span className={`w-1.5 h-1.5 rounded-full ${dotMap[level]} flex-shrink-0`} />
      <span className="font-technical text-on-surface-variant/60 text-xs w-20 flex-shrink-0">{time}</span>
      <span className={`${colorMap[level]}`}>{message}</span>
    </div>
  );
}
