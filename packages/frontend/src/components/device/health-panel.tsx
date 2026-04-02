'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Activity,
  RefreshCw,
  ToggleLeft,
  ToggleRight,
  Globe,
  Terminal,
  Cpu,
  MemoryStick,
  HardDrive,
  Signal,
  Clock,
} from 'lucide-react';
import { useDeviceHealth, useRunHealthCheck } from '@/hooks/use-scanner';
import { useDeviceMetrics } from '@/hooks/use-device';
import { formatRelativeTime, formatUptime } from '@/lib/format';

/* ─── Types ─── */

type HealthStatus = 'alive' | 'degraded' | 'unreachable' | 'unstable' | 'unknown';

interface ServiceHealth {
  id: string;
  serviceName: string;
  port: number;
  protocol: string;
  status: HealthStatus;
  latency: number | null;
  httpStatusCode: number | null;
  checkType: 'http' | 'tcp' | 'udp';
  lastCheckedAt: string | null;
  message?: string;
}

/* ─── Config ─── */

const STATUS_CONFIG: Record<HealthStatus, { dot: string; label: string; text: string; bar: string }> = {
  alive: {
    dot: 'bg-tertiary',
    label: 'ALIVE',
    text: 'text-tertiary',
    bar: 'bg-tertiary',
  },
  degraded: {
    dot: 'bg-error',
    label: 'DEGRADED',
    text: 'text-error',
    bar: 'bg-error',
  },
  unreachable: {
    dot: 'bg-error',
    label: 'UNREACHABLE',
    text: 'text-error',
    bar: 'bg-error',
  },
  unstable: {
    dot: 'bg-error',
    label: 'UNSTABLE',
    text: 'text-error',
    bar: 'bg-error',
  },
  unknown: {
    dot: 'bg-on-surface-variant/30',
    label: 'UNKNOWN',
    text: 'text-on-surface-variant/40',
    bar: 'bg-on-surface-variant/30',
  },
};

function latencyBarColor(ms: number): string {
  if (ms < 50) return 'bg-tertiary';
  if (ms < 200) return 'bg-primary';
  return 'bg-error';
}

function latencyPercent(ms: number): number {
  return Math.min((ms / 500) * 100, 100);
}

function serviceIcon(name: string, port: number) {
  const lower = name.toLowerCase();
  if (lower.includes('http') || lower.includes('node-red') || lower.includes('cockpit') || lower.includes('web') || port === 80 || port === 443 || port === 1880 || port === 9090 || port === 8080) {
    return <Globe className="w-4 h-4" />;
  }
  if (lower.includes('ssh') || port === 22) return <Terminal className="w-4 h-4" />;
  if (lower.includes('modbus') || port === 502) return <Cpu className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
}

/* ─── Component ─── */

interface HealthPanelProps {
  deviceId: string;
  compact?: boolean;
}

export function HealthPanel({ deviceId, compact = false }: HealthPanelProps) {
  const { data: healthData, isLoading, refetch } = useDeviceHealth(deviceId);
  const { data: metricsData } = useDeviceMetrics(deviceId);
  const healthCheck = useRunHealthCheck(deviceId);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const services: ServiceHealth[] = healthData?.data?.services ?? [];
  const metrics = metricsData?.data;

  const handleRefresh = useCallback(async () => {
    await healthCheck.mutateAsync();
    refetch();
  }, [healthCheck, refetch]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      refetch();
    }, 15000);
    return () => clearInterval(interval);
  }, [autoRefresh, refetch]);

  if (isLoading) {
    return (
      <div className="bg-surface-container-low rounded-xl p-6">
        <div className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="ml-3 text-sm text-on-surface-variant">Loading health data...</span>
        </div>
      </div>
    );
  }

  if (services.length === 0 && !metrics) {
    return (
      <div className="bg-surface-container-low rounded-xl p-6 text-center">
        <Activity className="w-8 h-8 text-on-surface-variant/20 mx-auto mb-2" />
        <p className="text-sm text-on-surface-variant/40">Waiting for device health data...</p>
        <p className="text-[10px] text-on-surface-variant/25 mt-1">Metrics appear once the agent sends its first heartbeat</p>
        <button
          onClick={handleRefresh}
          disabled={healthCheck.isPending}
          className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary text-on-primary hover:bg-primary-fixed-dim disabled:opacity-50 transition"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${healthCheck.isPending ? 'animate-spin' : ''}`} />
          Run Health Check
        </button>
      </div>
    );
  }

  if (compact) {
    return (
      <div className="bg-surface-container-low rounded-xl p-5">
        <h3 className="text-sm font-semibold text-on-surface uppercase tracking-wider mb-4">
          Service Health
        </h3>
        <div className="space-y-2">
          {services.map((svc) => {
            const cfg = STATUS_CONFIG[svc.status] ?? STATUS_CONFIG.unknown;
            return (
              <div key={svc.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <span className="text-sm text-on-surface-variant">
                    {svc.serviceName} ({svc.port})
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
                  {svc.latency !== null && (
                    <span className="text-xs font-technical text-on-surface-variant/40">
                      {svc.latency}ms
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface-container-low rounded-2xl">
      {/* Header */}
      <div className="px-5 pt-5 pb-5 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-on-surface uppercase tracking-wider">
          Service Health
        </h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={healthCheck.isPending}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium bg-primary text-on-primary hover:bg-primary-fixed-dim disabled:opacity-50 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${healthCheck.isPending ? 'animate-spin' : ''}`} />
            Refresh Health
          </button>
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className="inline-flex items-center gap-1.5 text-[11px] text-on-surface-variant/40 hover:text-on-surface-variant transition"
          >
            {autoRefresh ? (
              <ToggleRight className="w-5 h-5 text-primary" />
            ) : (
              <ToggleLeft className="w-5 h-5" />
            )}
            Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* Device Metrics */}
      {metrics && (
        <div className="px-5 pb-5">
          <div className="grid grid-cols-2 gap-4">
            {/* CPU */}
            <MetricGauge
              icon={<Cpu className="w-3.5 h-3.5" />}
              label="CPU"
              value={metrics.cpu != null ? `${metrics.cpu.toFixed(1)}%` : '--'}
              percent={metrics.cpu ?? 0}
              color={metrics.cpu != null && metrics.cpu > 80 ? 'bg-error' : 'bg-tertiary'}
            />
            {/* RAM */}
            <MetricGauge
              icon={<MemoryStick className="w-3.5 h-3.5" />}
              label="RAM"
              value={metrics.memUsed != null && metrics.memTotal
                ? `${formatBytes(metrics.memUsed)} / ${formatBytes(metrics.memTotal)}`
                : '--'}
              percent={metrics.memUsed != null && metrics.memTotal ? (metrics.memUsed / metrics.memTotal) * 100 : 0}
              color={metrics.memUsed != null && metrics.memTotal && (metrics.memUsed / metrics.memTotal) > 0.85 ? 'bg-error' : 'bg-primary'}
            />
            {/* Disk */}
            <MetricGauge
              icon={<HardDrive className="w-3.5 h-3.5" />}
              label="Disk"
              value={metrics.diskUsed != null && metrics.diskTotal
                ? `${formatBytes(metrics.diskUsed)} / ${formatBytes(metrics.diskTotal)}`
                : '--'}
              percent={metrics.diskUsed != null && metrics.diskTotal ? (metrics.diskUsed / metrics.diskTotal) * 100 : 0}
              color={metrics.diskUsed != null && metrics.diskTotal && (metrics.diskUsed / metrics.diskTotal) > 0.9 ? 'bg-error' : 'bg-primary'}
            />
            {/* Uptime — always shown */}
            <div className="bg-surface-container-lowest rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <Clock className="w-3.5 h-3.5 text-on-surface-variant/40" />
                  <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Uptime</span>
                </div>
                <span className="text-xs font-technical text-on-surface font-medium">
                  {metrics.uptime ? formatUptime(metrics.uptime) : '--'}
                </span>
              </div>
              <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-primary/40 transition-all duration-700" style={{ width: '100%' }} />
              </div>
            </div>
          </div>

          {/* Signal Quality — separate row when available */}
          {metrics.signalQuality != null && (
            <div className="mt-4 bg-surface-container-lowest rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <Signal className="w-3.5 h-3.5 text-on-surface-variant/40" />
                  <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">Cellular Signal (wwan0)</span>
                </div>
                <span className="text-xs font-technical text-on-surface font-bold">{metrics.signalQuality}%</span>
              </div>
              <div className="h-2.5 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    metrics.signalQuality < 30 ? 'bg-error' : metrics.signalQuality < 60 ? 'bg-[#f59e0b]' : 'bg-tertiary'
                  }`}
                  style={{ width: `${Math.min(metrics.signalQuality, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <span className="text-[9px] text-on-surface-variant/30">Poor</span>
                <span className="text-[9px] text-on-surface-variant/30 font-medium">
                  {metrics.signalQuality < 30 ? 'Weak' : metrics.signalQuality < 60 ? 'Fair' : metrics.signalQuality < 80 ? 'Good' : 'Excellent'}
                </span>
                <span className="text-[9px] text-on-surface-variant/30">Strong</span>
              </div>
            </div>
          )}

          {metrics.lastHeartbeat && (
            <p className="text-[10px] text-on-surface-variant/30 mt-2 text-right">
              Last heartbeat: {formatRelativeTime(metrics.lastHeartbeat)}
            </p>
          )}
        </div>
      )}

      {/* Service list */}
      <div className="divide-y divide-outline-variant/10">
        {services.map((svc) => (
          <ServiceHealthRow key={svc.id} service={svc} />
        ))}
      </div>
    </div>
  );
}

/* ─── Service Health Row ─── */

/* ─── Metric Gauge ─── */

function MetricGauge({
  icon,
  label,
  value,
  percent,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  percent: number;
  color: string;
}) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="text-on-surface-variant/40">{icon}</span>
          <span className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide">{label}</span>
        </div>
        <span className="text-xs font-technical text-on-surface font-medium">{value}</span>
      </div>
      <div className="h-2 bg-surface-container-high rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

/* ─── Service Health Row ─── */

function ServiceHealthRow({ service }: { service: ServiceHealth }) {
  const cfg = STATUS_CONFIG[service.status] ?? STATUS_CONFIG.unknown;

  return (
    <div className="p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="p-1.5 rounded-lg bg-surface-container-high text-on-surface-variant">
            {serviceIcon(service.serviceName, service.port)}
          </div>
          <div>
            <span className="text-sm font-medium text-on-surface">
              {service.serviceName}
            </span>
            <span className="text-xs font-technical text-on-surface-variant/40 ml-2">
              ({service.port})
            </span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
          <span className={`text-xs font-bold uppercase tracking-wider ${cfg.text}`}>
            {cfg.label}
          </span>
          {service.latency !== null && (
            <span className="text-xs font-technical text-on-surface-variant/40">
              {service.latency}ms
            </span>
          )}
        </div>
      </div>

      {/* Latency bar */}
      {service.latency !== null && (
        <div className="mb-2">
          <div className="h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${latencyBarColor(service.latency)}`}
              style={{ width: `${latencyPercent(service.latency)}%` }}
            />
          </div>
        </div>
      )}

      {/* Details row */}
      <div className="flex items-center gap-4 text-xs text-on-surface-variant/40">
        {service.httpStatusCode !== null && (
          <span>
            HTTP {service.httpStatusCode}
          </span>
        )}
        {service.httpStatusCode === null && (
          <span className="uppercase">{service.checkType} {service.status === 'alive' ? 'Open' : 'Closed'}</span>
        )}
        {service.lastCheckedAt && (
          <span>Last checked: {formatRelativeTime(service.lastCheckedAt)}</span>
        )}
        {service.message && (
          <span className="truncate max-w-xs">{service.message}</span>
        )}
      </div>
    </div>
  );
}
