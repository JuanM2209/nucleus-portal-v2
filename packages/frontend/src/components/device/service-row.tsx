'use client';

import { useState, useCallback } from 'react';
import {
  Globe,
  Terminal,
  Cpu,
  Radio,
  ExternalLink,
  ArrowDownToLine,
  Copy,
  Check,
  Activity,
  Network,
} from 'lucide-react';
import { TunnelTypeBadge } from '@/components/device/status-badge';
import { ExportModal } from '@/components/device/export-modal';
import { copyToClipboard } from '@/lib/clipboard';
import { api } from '@/lib/api';

/* ─── Types ─── */

interface ServiceInfo {
  id: string;
  port: number;
  protocol: string;
  serviceName: string | null;
  serviceVersion: string | null;
  banner: string | null;
  isTunnelable: boolean;
  tunnelType: 'browser' | 'local' | null;
  lastScannedAt: string;
}

interface ServiceRowProps {
  service: ServiceInfo;
  targetIp: string;
  adapterName: string;
  hostname: string | null;
  deviceId: string;
  healthStatus?: 'alive' | 'degraded' | 'unreachable' | 'unknown';
  latency?: number;
  onHealthCheck?: () => void;
}

/* ─── Helpers ─── */

function serviceIcon(name: string | null, port: number) {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('http') || lower.includes('node-red') || lower.includes('cockpit') || lower.includes('web')) {
    return <Globe className="w-4 h-4" />;
  }
  if (lower.includes('ssh') || lower.includes('telnet')) {
    return <Terminal className="w-4 h-4" />;
  }
  if (lower.includes('modbus') || lower.includes('opcua') || lower.includes('bacnet')) {
    return <Cpu className="w-4 h-4" />;
  }
  if (lower.includes('mqtt')) {
    return <Radio className="w-4 h-4" />;
  }
  if (port === 80 || port === 443 || port === 8080 || port === 1880 || port === 9090) {
    return <Globe className="w-4 h-4" />;
  }
  if (port === 22) return <Terminal className="w-4 h-4" />;
  if (port === 502) return <Cpu className="w-4 h-4" />;
  return <Activity className="w-4 h-4" />;
}

const HEALTH_CONFIG: Record<string, { dot: string; label: string; text: string }> = {
  alive: { dot: 'bg-tertiary', label: 'Alive', text: 'text-tertiary' },
  degraded: { dot: 'bg-error', label: 'Degraded', text: 'text-error' },
  unreachable: { dot: 'bg-error', label: 'Unreachable', text: 'text-error' },
  unknown: { dot: 'bg-on-surface-variant/30', label: 'Unknown', text: 'text-on-surface-variant/40' },
};

/* ─── Component ─── */

export function ServiceRow({
  service,
  targetIp,
  adapterName,
  hostname,
  deviceId,
  healthStatus = 'unknown',
  latency,
  onHealthCheck,
}: ServiceRowProps) {
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [exportModalOpen, setExportModalOpen] = useState(false);

  const localhostEndpoint = `localhost:${service.port}`;
  const remoteEndpoint = `${targetIp}:${service.port}`;
  const health = HEALTH_CONFIG[healthStatus] ?? HEALTH_CONFIG.unknown;

  const handleCopyLocalhost = useCallback(async () => {
    const success = await copyToClipboard(localhostEndpoint);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [localhostEndpoint]);

  const handleOpenBrowser = useCallback(async () => {
    setActionLoading(true);
    try {
      const ip = targetIp === 'localhost' ? '127.0.0.1' : targetIp;
      const res = await api.post<{ success: boolean; data: any }>('/sessions', {
        deviceId,
        targetIp: ip,
        targetPort: service.port,
        tunnelType: 'browser',
        durationMinutes: 60,
      });
      if (res.data?.proxyUrl) {
        window.open(res.data.proxyUrl, '_blank');
      }
    } catch (err: any) {
      alert(`Failed to open session: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }, [deviceId, targetIp, service.port]);

  const handleExportLocal = useCallback(() => {
    setExportModalOpen(true);
  }, []);

  const isBeta = service.port === 9090;

  return (
    <div className="relative bg-surface-container-low rounded-xl p-4">
      {isBeta && (
        <span className="absolute top-2 right-2 text-[8px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-400/15 text-amber-400">
          BETA
        </span>
      )}
      <div className="flex flex-col lg:flex-row lg:items-center gap-4">
        {/* Left: icon + service name */}
        <div className="flex items-center gap-3 min-w-0 lg:w-48">
          <div className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant shrink-0">
            {serviceIcon(service.serviceName, service.port)}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-on-surface truncate">
              {service.serviceName || `Port ${service.port}`}
            </p>
            {service.serviceVersion && (
              <p className="text-xs text-on-surface-variant/40">v{service.serviceVersion}</p>
            )}
          </div>
        </div>

        {/* Center: endpoints */}
        <div className="flex-1 space-y-1.5">
          {/* Remote */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-on-surface-variant/40 w-14 shrink-0 font-bold uppercase">Remote:</span>
            <span className="font-technical text-sm text-on-surface-variant">
              {remoteEndpoint}
            </span>
          </div>
          {/* Local - THE most visible element */}
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-on-surface-variant/40 w-14 shrink-0 font-bold uppercase">Local:</span>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg font-technical text-sm font-bold bg-tertiary/10 text-tertiary">
              <span className="w-2 h-2 rounded-full bg-tertiary shrink-0" />
              {localhostEndpoint}
            </span>
          </div>
          {/* Adapter + host */}
          <div className="flex items-center gap-2 text-xs text-on-surface-variant/40">
            <Network className="w-3 h-3" />
            <span className="font-technical uppercase">{adapterName}</span>
            {hostname && (
              <>
                <span className="text-outline-variant">&middot;</span>
                <span>{hostname}</span>
              </>
            )}
          </div>
        </div>

        {/* Right: health + actions */}
        <div className="flex flex-col items-end gap-2 lg:w-56 shrink-0">
          {/* Health status */}
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${health.dot}`} />
            <span className={`text-xs font-medium ${health.text}`}>{health.label}</span>
            {latency !== undefined && (
              <span className="text-xs font-technical text-on-surface-variant/40">
                ({latency}ms)
              </span>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-1.5">
            {service.tunnelType === 'browser' && (
              <button
                onClick={handleOpenBrowser}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-primary text-on-primary hover:bg-primary-fixed-dim disabled:opacity-50 transition"
              >
                <ExternalLink className="w-3 h-3" />
                Open
              </button>
            )}
            {service.tunnelType === 'local' && (
              <button
                onClick={handleExportLocal}
                disabled={actionLoading}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container-high text-on-surface-variant hover:bg-surface-bright disabled:opacity-50 transition"
              >
                <ArrowDownToLine className="w-3 h-3" />
                Export
              </button>
            )}
            <button
              onClick={handleCopyLocalhost}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container-high text-on-surface-variant hover:bg-surface-bright transition"
            >
              {copied ? (
                <>
                  <Check className="w-3 h-3 text-tertiary" />
                  <span className="text-tertiary">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy
                </>
              )}
            </button>
            {onHealthCheck && (
              <button
                onClick={onHealthCheck}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-surface-container-high text-on-surface-variant hover:bg-surface-bright transition"
              >
                <Activity className="w-3 h-3" />
                Check
              </button>
            )}
          </div>

          {/* Type badge */}
          {service.tunnelType && (
            <TunnelTypeBadge type={service.tunnelType} />
          )}
        </div>
      </div>

      <ExportModal
        isOpen={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        port={service.port}
        serviceName={service.serviceName}
        deviceId={deviceId}
      />
    </div>
  );
}
