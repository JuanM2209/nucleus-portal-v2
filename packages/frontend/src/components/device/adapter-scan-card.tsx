'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  Network,
  Wifi,
  Radio,
  ChevronDown,
  ChevronRight,
  Search,
  Loader2,
  Globe,
  Terminal,
  Cpu,
  Activity,
  ExternalLink,
  ArrowDownToLine,
  Copy,
  Check,
} from 'lucide-react';
import { useScanNetwork, useScanStatus } from '@/hooks/use-scanner';
import { useAdapterEndpoints } from '@/hooks/use-device';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/clipboard';

/* ─── Types ─── */

interface Adapter {
  id: string;
  name: string;
  macAddress: string | null;
  ipAddress: string | null;
  subnetMask: string | null;
  gateway: string | null;
  mode: string | null;
  isUp: boolean;
}

interface ScanSummary {
  hostsFound: number;
  portsFound: number;
  lastScannedAt: string | null;
}

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

interface Endpoint {
  id: string;
  adapterId: string;
  ipAddress: string;
  macAddress: string | null;
  hostname: string | null;
  vendor: string | null;
  isActive: boolean;
  lastSeenAt: string;
  services: ServiceInfo[];
  latency?: number;
}

type ScanType = 'quick' | 'standard' | 'deep';

/* ─── Helpers ─── */

function adapterIcon(name: string) {
  if (name.startsWith('wlan')) return <Wifi className="w-4 h-4" />;
  if (name.startsWith('wwan')) return <Radio className="w-4 h-4" />;
  return <Network className="w-4 h-4" />;
}

function subnetToCidr(mask: string | null): string | null {
  if (!mask) return null;
  const parts = mask.split('.').map(Number);
  if (parts.length !== 4) return null;
  const bits = parts.reduce((acc, octet) => acc + octet.toString(2).split('1').length - 1, 0);
  return `/${bits}`;
}

function serviceIcon(name: string | null, port: number) {
  const lower = (name ?? '').toLowerCase();
  if (lower.includes('http') || lower.includes('node-red') || lower.includes('cockpit') || lower.includes('web')) {
    return <Globe className="w-3.5 h-3.5" />;
  }
  if (lower.includes('ssh') || lower.includes('telnet')) {
    return <Terminal className="w-3.5 h-3.5" />;
  }
  if (lower.includes('modbus') || lower.includes('opcua') || lower.includes('bacnet') || lower.includes('ethernet/ip')) {
    return <Cpu className="w-3.5 h-3.5" />;
  }
  if ([80, 443, 8080, 1880, 9090].includes(port)) return <Globe className="w-3.5 h-3.5" />;
  if (port === 22) return <Terminal className="w-3.5 h-3.5" />;
  if ([502, 44818].includes(port)) return <Cpu className="w-3.5 h-3.5" />;
  return <Activity className="w-3.5 h-3.5" />;
}

type Classification = 'web' | 'export' | 'internal';

function classifyService(svc: ServiceInfo): Classification {
  if (svc.tunnelType === 'browser') return 'web';
  if (svc.tunnelType === 'local') return 'export';
  // Fallback classification by port
  if ([80, 81, 443, 1880, 8080, 8443, 9090].includes(svc.port)) return 'web';
  if ([22, 502, 44818, 47808, 3389, 5900, 4840].includes(svc.port)) return 'export';
  return 'internal';
}

const CLASSIFICATION_CONFIG: Record<Classification, { label: string; bg: string; text: string }> = {
  web: { label: 'Open in Web', bg: 'bg-tertiary/10', text: 'text-tertiary' },
  export: { label: 'Export to PC', bg: 'bg-primary/10', text: 'text-primary' },
  internal: { label: 'Internal', bg: 'bg-surface-container-highest', text: 'text-on-surface-variant/60' },
};

/* ─── Component ─── */

interface AdapterScanCardProps {
  adapter: Adapter;
  deviceId: string;
  endpointCount: number;
  scanSummary?: ScanSummary;
  /** When true, adapter kernel reports isUp but no endpoints are reachable (no carrier) */
  noLinkOverride?: boolean;
}

export function AdapterScanCard({ adapter, deviceId, endpointCount, scanSummary, noLinkOverride }: AdapterScanCardProps) {
  const [showDropdown, setShowDropdown] = useState(false);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const queryClient = useQueryClient();
  const scanMutation = useScanNetwork(deviceId, adapter.id);
  const { data: scanStatusData } = useScanStatus(activeScanId);
  const { data: endpointsData } = useAdapterEndpoints(deviceId, adapter.id);

  const scanStatus = scanStatusData?.data;
  const isScanning = scanMutation.isPending || scanStatus?.status === 'running';
  const scanProgress = scanStatus?.progress ?? 0;
  const hostsFoundDuring = scanStatus?.hostsFound ?? 0;

  // When scan completes, refresh device endpoints + page data so ports appear
  const prevScanning = useRef(false);
  useEffect(() => {
    if (prevScanning.current && !isScanning && scanStatus?.status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['adapter-endpoints'] });
    }
    prevScanning.current = isScanning;
  }, [isScanning, scanStatus?.status, queryClient, deviceId]);

  // Filter out localhost (127.0.0.1) — it's the device itself, not a downstream device
  const endpoints: Endpoint[] = ((endpointsData as any)?.data ?? []).filter(
    (ep: Endpoint) => ep.ipAddress !== '127.0.0.1' && ep.ipAddress !== 'localhost',
  );
  const hasEndpoints = endpoints.length > 0;

  const handleScan = useCallback(
    async (type: ScanType) => {
      setShowDropdown(false);
      try {
        const result = await scanMutation.mutateAsync(type);
        if (result?.data?.scanId) {
          setActiveScanId(result.data.scanId);
        }
      } catch {
        // Error handled by mutation state
      }
    },
    [scanMutation],
  );

  const cidr = subnetToCidr(adapter.subnetMask);

  return (
    <div className="bg-surface-container-low rounded-2xl">
      <div className="p-5">
        {/* Header row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-surface-container-high text-on-surface-variant">
              {adapterIcon(adapter.name)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-technical font-bold text-on-surface uppercase text-sm">
                  {adapter.name}
                </span>
                <span
                  className={`w-2 h-2 rounded-full ${adapter.isUp ? 'bg-tertiary' : noLinkOverride ? 'bg-[#f59e0b]' : 'bg-on-surface-variant/30'}`}
                />
                <span
                  className={`text-xs font-medium ${adapter.isUp ? 'text-tertiary' : noLinkOverride ? 'text-[#f59e0b]' : 'text-on-surface-variant/40'}`}
                >
                  {adapter.isUp ? 'Up' : noLinkOverride ? 'No Link' : 'Down'}
                </span>
              </div>
              {adapter.macAddress && (
                <span className="text-xs font-technical text-on-surface-variant/40">
                  {adapter.macAddress}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {adapter.mode && (() => {
              const profile = (adapter as any).configProfile || (adapter as any).config_profile;
              const mode = adapter.mode.toUpperCase();
              const hasMismatch = profile && (
                (profile.toLowerCase().includes('dhcp') && mode === 'STATIC') ||
                (profile.toLowerCase().includes('static') && mode === 'DHCP')
              );
              return (
                <div className="flex items-center gap-1">
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-lg ${
                    hasMismatch
                      ? 'bg-warning/20 text-warning border border-warning/30'
                      : 'bg-tertiary/10 text-tertiary border border-tertiary/20'
                  }`}
                    title={profile ? `NM Profile: ${profile} | Verified: ${mode}` : `Mode: ${mode}`}
                  >
                    {mode} {hasMismatch ? '\u26A0' : '\u2713'}
                  </span>
                  {hasMismatch && (
                    <span className="text-[10px] text-warning" title={`Profile "${profile}" suggests ${profile.toLowerCase().includes('dhcp') ? 'DHCP' : 'Static'} but actual config is ${mode}`}>
                      mismatch
                    </span>
                  )}
                </div>
              );
            })()}
            {endpointCount > 0 && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                {endpointCount} endpoint{endpointCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>

        {/* IP / Subnet / Gateway */}
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <dt className="text-[9px] text-on-surface-variant/40 font-bold uppercase mb-0.5">IP Address</dt>
            <dd className="text-sm font-technical font-semibold text-on-surface">
              {adapter.ipAddress || '--'}
              {cidr && (
                <span className="text-on-surface-variant/40 font-normal ml-0.5">{cidr}</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] text-on-surface-variant/40 font-bold uppercase mb-0.5">Subnet Mask</dt>
            <dd className="text-sm font-technical text-on-surface">
              {adapter.subnetMask || '--'}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] text-on-surface-variant/40 font-bold uppercase mb-0.5">Gateway</dt>
            <dd className="text-sm font-technical text-on-surface">
              {adapter.gateway || 'None'}
            </dd>
          </div>
        </div>

        {/* Scan progress (shown when scanning) */}
        {isScanning && (
          <div className="mb-4 p-3 rounded-lg bg-surface-container-high">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 text-sm text-on-surface-variant">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                Scanning network...
              </div>
              <div className="flex items-center gap-3 text-xs text-on-surface-variant/40">
                <span>{hostsFoundDuring} host{hostsFoundDuring !== 1 ? 's' : ''} found</span>
                <span className="font-technical">{scanProgress}%</span>
              </div>
            </div>
            <div className="h-1.5 bg-surface-container-lowest rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.min(scanProgress, 100)}%` }}
              />
            </div>
          </div>
        )}

        {/* Scan complete summary */}
        {!isScanning && scanSummary && scanSummary.lastScannedAt && (
          <div className="mb-4 text-xs text-on-surface-variant/40">
            Last scan: {scanSummary.hostsFound} host{scanSummary.hostsFound !== 1 ? 's' : ''},{' '}
            {scanSummary.portsFound} port{scanSummary.portsFound !== 1 ? 's' : ''} found
          </div>
        )}

        {/* ─── Discovered Endpoints (Phase 3) ─── */}
        {hasEndpoints && (
          <div className="mb-4">
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-2 w-full text-left mb-2 group"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-on-surface-variant/40 group-hover:text-primary transition" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-on-surface-variant/40 group-hover:text-primary transition" />
              )}
              <span className="text-xs font-bold text-on-surface-variant/60 uppercase tracking-wider group-hover:text-on-surface-variant transition">
                {endpoints.length} Downstream Device{endpoints.length !== 1 ? 's' : ''}
              </span>
              <div className="h-px flex-1 bg-outline-variant/10" />
              {/* Classification summary badges */}
              <div className="flex items-center gap-1">
                {(() => {
                  const allServices = endpoints.flatMap((ep) => ep.services);
                  const webCount = allServices.filter((s) => classifyService(s) === 'web').length;
                  const exportCount = allServices.filter((s) => classifyService(s) === 'export').length;
                  const internalCount = allServices.filter((s) => classifyService(s) === 'internal').length;
                  return (
                    <>
                      {webCount > 0 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-tertiary/10 text-tertiary">
                          {webCount} web
                        </span>
                      )}
                      {exportCount > 0 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {exportCount} export
                        </span>
                      )}
                      {internalCount > 0 && (
                        <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-surface-container-highest text-on-surface-variant/50">
                          {internalCount} internal
                        </span>
                      )}
                    </>
                  );
                })()}
              </div>
            </button>

            {expanded && (
              <div className="space-y-2 ml-5">
                {endpoints.map((ep) => (
                  <DownstreamEndpoint
                    key={ep.id}
                    endpoint={ep}
                    deviceId={deviceId}
                    adapterIp={adapter.ipAddress}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Scan button with dropdown */}
        <div className="relative">
          <div className="flex">
            <button
              onClick={() => handleScan('standard')}
              disabled={isScanning || !adapter.isUp}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2 rounded-l-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary-fixed-dim disabled:bg-surface-container-high disabled:text-on-surface-variant/30 disabled:cursor-not-allowed transition"
            >
              <Search className="w-4 h-4" />
              {isScanning ? 'Scanning...' : 'Scan Network'}
            </button>
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              disabled={isScanning || !adapter.isUp}
              className="inline-flex items-center px-2 py-2 rounded-r-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary-fixed-dim disabled:bg-surface-container-high disabled:text-on-surface-variant/30 disabled:cursor-not-allowed border-l border-on-primary/20 transition"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          {showDropdown && (
            <div className="absolute right-0 mt-1 w-48 rounded-xl bg-surface-container-high shadow-lg z-10 overflow-hidden">
              {(['quick', 'standard', 'deep'] as ScanType[]).map((type) => (
                <button
                  key={type}
                  onClick={() => handleScan(type)}
                  className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-bright text-on-surface-variant transition"
                >
                  <span className="font-medium capitalize">{type}</span>
                  <span className="block text-xs text-on-surface-variant/40 mt-0.5">
                    {type === 'quick' && 'ARP only, ~5 seconds'}
                    {type === 'standard' && 'ARP + common ports, ~30 seconds'}
                    {type === 'deep' && 'Full port scan, ~2 minutes'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Downstream Endpoint ─── */

function DownstreamEndpoint({
  endpoint,
  deviceId,
  adapterIp,
}: {
  endpoint: Endpoint;
  deviceId: string;
  adapterIp: string | null;
}) {
  const isLocalhost = adapterIp !== null && endpoint.ipAddress === adapterIp;
  const displayIp = isLocalhost ? 'localhost' : endpoint.ipAddress;

  return (
    <div className="bg-surface-container-lowest/60 rounded-lg p-3 border border-outline-variant/5">
      {/* Host header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${endpoint.isActive ? 'bg-tertiary' : 'bg-on-surface-variant/30'}`} />
          <span className="font-technical text-xs font-bold text-on-surface">
            {displayIp}
          </span>
          {endpoint.hostname && (
            <span className="text-[10px] text-on-surface-variant/40">
              {endpoint.hostname}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {endpoint.latency !== undefined && (
            <span className="text-[10px] font-technical text-on-surface-variant/40">
              {endpoint.latency}ms
            </span>
          )}
          <span className="text-[10px] text-on-surface-variant/30">
            {endpoint.services.length} port{endpoint.services.length !== 1 ? 's' : ''}
          </span>
        </div>
      </div>

      {/* Services list */}
      {endpoint.services.length > 0 && (
        <div className="space-y-1">
          {endpoint.services.map((svc) => (
            <DownstreamServiceRow
              key={svc.id}
              service={svc}
              targetIp={endpoint.ipAddress}
              deviceId={deviceId}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Downstream Service Row (Phase 3 + Phase 4) ─── */

function DownstreamServiceRow({
  service,
  targetIp,
  deviceId,
}: {
  service: ServiceInfo;
  targetIp: string;
  deviceId: string;
}) {
  const [actionLoading, setActionLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const classification = classifyService(service);
  const cls = CLASSIFICATION_CONFIG[classification];

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

  const handleExportLocal = useCallback(async () => {
    setActionLoading(true);
    try {
      const ip = targetIp === 'localhost' ? '127.0.0.1' : targetIp;
      const res = await api.post<{ success: boolean; data: any }>('/sessions', {
        deviceId,
        targetIp: ip,
        targetPort: service.port,
        tunnelType: 'local',
        durationMinutes: 60,
      });
      if (res.data?.helperConfig) {
        const config = res.data.helperConfig;
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nucleus-session-${service.port}.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err: any) {
      alert(`Failed to create session: ${err.message}`);
    } finally {
      setActionLoading(false);
    }
  }, [deviceId, targetIp, service.port]);

  const handleCopy = useCallback(async () => {
    const success = await copyToClipboard(`${targetIp}:${service.port}`);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [targetIp, service.port]);

  return (
    <div className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-surface-container-high/50 transition group">
      {/* Icon + port + service name */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="text-on-surface-variant/40 shrink-0">
          {serviceIcon(service.serviceName, service.port)}
        </span>
        <span className="font-technical text-xs font-bold text-on-surface">
          {service.port}
        </span>
        {service.serviceName && (
          <span className="text-[10px] text-on-surface-variant/50 truncate">
            {service.serviceName}
          </span>
        )}
      </div>

      {/* Classification badge */}
      <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded shrink-0 ${cls.bg} ${cls.text}`}>
        {cls.label}
      </span>

      {/* Action buttons */}
      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
        {classification === 'web' && (
          <button
            onClick={handleOpenBrowser}
            disabled={actionLoading}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-tertiary/10 text-tertiary hover:bg-tertiary/20 disabled:opacity-50 transition"
            title="Open in browser via tunnel"
          >
            <ExternalLink className="w-3 h-3" />
            Open
          </button>
        )}
        {classification === 'export' && (
          <button
            onClick={handleExportLocal}
            disabled={actionLoading}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50 transition"
            title="Export tunnel config for local client"
          >
            <ArrowDownToLine className="w-3 h-3" />
            Export
          </button>
        )}
        <button
          onClick={handleCopy}
          className="inline-flex items-center gap-1 px-1.5 py-1 rounded text-[10px] text-on-surface-variant/40 hover:text-on-surface-variant hover:bg-surface-container-highest transition"
          title="Copy endpoint"
        >
          {copied ? (
            <Check className="w-3 h-3 text-tertiary" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </button>
      </div>
    </div>
  );
}
