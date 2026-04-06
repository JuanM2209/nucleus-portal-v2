'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'next/navigation';
import {
  Globe,
  Terminal,
  ArrowDownToLine,
  ArrowLeft,
  Cpu,
  HardDrive,
  MemoryStick,
  Clock,
  ExternalLink,
  Network,
  Activity,
  Box,
  Server,
  Wifi,
  Radio,
  Copy,
  Check,
  RefreshCw,
  AlertTriangle,
  Link2,
  MapPin,
  Building2,
  FileDown,
  Power,
  PowerOff,
  Settings2,
  Cable,
  Loader2,
  Eye,
  EyeOff,
  X,
  ChevronDown,
  ArrowRight,
  Zap,
  CircleDot,
  MonitorDown,
  ArrowUpDown,
} from 'lucide-react';
import Link from 'next/link';
import { useDevice, useDeviceAdapters, useDeviceEndpoints, useSyncDevice, useDeviceMetrics, useEndpointHealthCheck } from '@/hooks/use-device';
import { StatusBadge, TunnelTypeBadge } from '@/components/device/status-badge';
import { AdapterScanCard } from '@/components/device/adapter-scan-card';
import { ScanResultsPanel } from '@/components/device/scan-results-panel';
import { ServiceRow } from '@/components/device/service-row';
import { ExportModal } from '@/components/device/export-modal';
import { HealthPanel } from '@/components/device/health-panel';
import { copyToClipboard } from '@/lib/clipboard';
import { formatRelativeTime, formatUptime, groupBy } from '@/lib/format';
import { api } from '@/lib/api';
import { usePortFilterStore } from '@/stores/port-filter-store';

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
  metadata?: Record<string, unknown> | null;
}

/* ─── Helpers ─── */

function isWebPort(svc: ServiceInfo): boolean {
  const name = (svc.serviceName ?? '').toLowerCase();
  if (svc.tunnelType === 'browser') return true;
  if (/http|web|node-red|cockpit|grafana|portainer/i.test(name)) return true;
  if ([80, 443, 8080, 8443, 1880, 9090, 3000].includes(svc.port)) return true;
  return false;
}

function serviceLabel(svc: ServiceInfo): string {
  if (svc.serviceName) return svc.serviceName.toUpperCase();
  if (svc.port === 443) return 'HTTPS';
  if (svc.port === 80) return 'HTTP';
  if (svc.port === 22) return 'SSH';
  if (svc.port === 502) return 'MODBUS';
  return `PORT ${svc.port}`;
}

function serviceSubLabel(svc: ServiceInfo): string {
  if (svc.port === 443) return 'SECURE';
  if (svc.port === 80) return 'WEB';
  if (svc.port === 1880) return 'FLOWS';
  if (svc.port === 9090) return 'MONITOR';
  if (svc.protocol) return svc.protocol.toUpperCase();
  return '';
}

/* ─── Main Page ─── */

export default function DeviceDetailPage() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { data: deviceData, isLoading: deviceLoading } = useDevice(deviceId);
  const { data: adaptersData, isLoading: adaptersLoading } = useDeviceAdapters(deviceId);
  const { data: endpointsData, isLoading: endpointsLoading } = useDeviceEndpoints(deviceId);

  // ALL useState hooks MUST be called before any early return (React hooks rule)
  const [bridgeActive, setBridgeActive] = useState(false);
  const [bridgeConfig, setBridgeConfig] = useState<{ tcpPort: number; serialPort: string; baudRate: number; parity: string; dataBits: number; stopBits: number }>({
    tcpPort: 2202, serialPort: '/dev/ttymxc5', baudRate: 9600, parity: 'none', dataBits: 8, stopBits: 1,
  });
  const [bridgeChecked, setBridgeChecked] = useState(false);
  const { hideSystemPorts, hiddenPorts } = usePortFilterStore();

  // On page load, check if mbusd bridge is already active on the device
  useEffect(() => {
    if (!deviceId || bridgeChecked) return;
    let cancelled = false;
    api.get<{ success: boolean; data?: any }>(`/devices/${deviceId}/bridge/status`)
      .then((res) => {
        if (cancelled) return;
        setBridgeChecked(true);
        if (res.success && res.data?.active) {
          // Bridge is already running — restore state
          setBridgeActive(true);
          if (res.data.tcpPort) {
            setBridgeConfig((prev) => ({
              ...prev,
              tcpPort: res.data.tcpPort ?? prev.tcpPort,
              serialPort: res.data.serialPort ?? prev.serialPort,
              baudRate: res.data.baudRate ?? prev.baudRate,
            }));
          }
        }
      })
      .catch(() => { if (!cancelled) setBridgeChecked(true); });
    return () => { cancelled = true; };
  }, [deviceId, bridgeChecked]);
  const [sidebarTab, setSidebarTab] = useState<'modbus' | 'adapters' | 'health'>('modbus');
  const [healthCheckInterval, setHealthCheckInterval] = useState(0); // minutes, 0=off — persists across tab switches
  const HIDDEN_PORTS = useMemo(() => new Set(hiddenPorts), [hiddenPorts]);

  // Label editing state
  const [editingLabel, setEditingLabel] = useState<string | null>(null);
  const [labelValue, setLabelValue] = useState('');
  const queryClient = useQueryClient();

  const startEditingLabel = useCallback((endpointId: string, currentLabel: string) => {
    setEditingLabel(endpointId);
    setLabelValue(currentLabel);
  }, []);

  const cancelEditingLabel = useCallback(() => {
    setEditingLabel(null);
    setLabelValue('');
  }, []);

  const saveEndpointLabel = useCallback(async (endpointId: string) => {
    try {
      await api.patch(`/devices/${deviceId}/endpoints/${endpointId}/label`, { label: labelValue.trim() });
      queryClient.invalidateQueries({ queryKey: ['device-endpoints', deviceId] });
      setEditingLabel(null);
    } catch {
      // silently fail
    }
  }, [deviceId, labelValue, queryClient]);

  const device = deviceData?.data;
  // Filter out non-physical/virtual adapters that aren't useful for device networking
  const allAdapters: Adapter[] = adaptersData?.data ?? [];
  const adapters = allAdapters.filter((a) => {
    const n = a.name.toLowerCase();
    // Cellular WAN — uplink, not device networking
    if (/wwan|cellular|lte|4g|5g/i.test(n)) return false;
    // Virtual/system adapters
    if (/^dummy|^p2p|^veth|^virbr|^docker|^br-|^lo$|^sit|^ip6tnl|^tunl/i.test(n)) return false;
    return true;
  });
  const endpoints: Endpoint[] = endpointsData?.data ?? [];

  // Sort options for port cards — hooks MUST be declared before any early return
  type SortOption = 'default' | 'name' | 'port' | 'ip' | 'latency' | 'interface';
  const [sortBy, setSortBy] = useState<SortOption>('default');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);

  // Gather all services with endpoint context
  const allPortRows = buildPortRows(endpoints, adapters);

  // Apply user's hidden ports filter
  // Show all endpoints — active status is reflected via sparkline color and status badge
  const visiblePortRows = allPortRows
    .filter((r) => !hideSystemPorts || !HIDDEN_PORTS.has(r.service.port));

  // Sort function for port rows — must be before early returns
  const sortPortRows = useCallback((rows: typeof visiblePortRows) => {
    const sorted = [...rows];
    switch (sortBy) {
      case 'name': {
        return sorted.sort((a, b) => {
          const labelA = ((a.endpointMetadata as Record<string, unknown>)?.label as string) ?? '';
          const labelB = ((b.endpointMetadata as Record<string, unknown>)?.label as string) ?? '';
          if (labelA && !labelB) return -1;
          if (!labelA && labelB) return 1;
          return labelA.localeCompare(labelB) || a.service.port - b.service.port;
        });
      }
      case 'port':
        return sorted.sort((a, b) => a.service.port - b.service.port);
      case 'ip':
        return sorted.sort((a, b) => {
          const ipA = a.targetIp.split('.').map(Number);
          const ipB = b.targetIp.split('.').map(Number);
          for (let i = 0; i < 4; i++) {
            if ((ipA[i] ?? 0) !== (ipB[i] ?? 0)) return (ipA[i] ?? 0) - (ipB[i] ?? 0);
          }
          return a.service.port - b.service.port;
        });
      case 'latency':
        return sorted.sort((a, b) => (a.latency ?? 9999) - (b.latency ?? 9999));
      case 'interface':
        return sorted.sort((a, b) => a.interfaceName.localeCompare(b.interfaceName) || a.service.port - b.service.port);
      default:
        return sorted;
    }
  }, [sortBy]);

  // Early returns AFTER all hooks — required by React rules of hooks
  if (deviceLoading) {
    return <LoadingPlaceholder text="Loading device..." />;
  }

  if (!device) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-4">
        <p className="text-on-surface-variant">Device not found</p>
        <Link href="/devices" className="text-primary hover:text-primary-fixed text-sm flex items-center gap-1">
          <ArrowLeft className="w-4 h-4" /> Back to Fleet
        </Link>
      </div>
    );
  }

  const webPorts = sortPortRows(visiblePortRows.filter((r) => isWebPort(r.service)));
  const programPorts = sortPortRows(visiblePortRows.filter((r) => !isWebPort(r.service)));

  const metadata = device.metadata ?? {};

  return (
    <div className="space-y-8">
      {/* Top bar: back + search + actions */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href="/devices"
            className="text-on-surface-variant hover:text-on-surface transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div className="flex items-center gap-2 bg-surface-container-low px-4 py-2 rounded-xl">
            <span className="text-on-surface-variant text-sm">Search devices...</span>
          </div>
        </div>
      </div>

      {/* Device Header */}
      <header>
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <span className="bg-surface-container-highest text-on-surface-variant text-[10px] font-bold tracking-widest px-2 py-0.5 rounded uppercase">
                Device Profile
              </span>
              <StatusBadge status={device.status} />
            </div>
            <h1 className="text-5xl font-extrabold font-technical tracking-tighter text-primary leading-none">
              {(device.name || device.serialNumber).replace(/^Nucleus\s+/i, '')}
            </h1>
            <div className="flex items-center gap-4">
              {metadata.location && (
                <div className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-on-surface-variant/50" />
                  <span className="text-on-surface-variant font-medium text-sm">{metadata.location}</span>
                </div>
              )}
              {metadata.location && device.tenantName && (
                <div className="w-1 h-1 rounded-full bg-outline-variant" />
              )}
              {device.tenantName && (
                <div className="flex items-center gap-2 text-on-surface-variant/60">
                  <Building2 className="w-4 h-4" />
                  <span className="font-medium text-sm">Tenant: {device.tenantName}</span>
                </div>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-on-surface-variant/60">
              {device.lastSeenAt && (
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" />
                  Last seen {formatRelativeTime(device.lastSeenAt)}
                </span>
              )}
              {device.agentVersion && (
                <span className="flex items-center gap-1.5">
                  <Box className="w-3.5 h-3.5" />
                  Agent {device.agentVersion?.startsWith('v') ? device.agentVersion : `v${device.agentVersion}`}
                </span>
              )}
            </div>
            {/* Tags hidden — shown in metadata panel instead */}
          </div>
          <div className="flex items-center gap-3">
            {/* Sort dropdown */}
            <div className="relative">
              <button
                onClick={() => setSortMenuOpen(!sortMenuOpen)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                  sortBy !== 'default'
                    ? 'bg-primary/10 text-primary border-primary/20'
                    : 'bg-surface-container-low text-on-surface-variant border-outline-variant/10 hover:border-outline-variant/30'
                }`}
              >
                <ArrowUpDown className="w-4 h-4" />
                <span className="hidden sm:inline">
                  {sortBy === 'default' ? 'Sort' : sortBy === 'name' ? 'Name' : sortBy === 'port' ? 'Port' : sortBy === 'ip' ? 'IP' : sortBy === 'latency' ? 'Latency' : 'Interface'}
                </span>
                <ChevronDown className="w-3.5 h-3.5" />
              </button>
              {sortMenuOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setSortMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-surface-container-high border border-outline-variant/15 rounded-xl shadow-xl py-1 min-w-[160px]">
                    {([
                      ['default', 'Default'],
                      ['name', 'Device Name'],
                      ['port', 'Port Number'],
                      ['ip', 'IP Address'],
                      ['latency', 'Latency'],
                      ['interface', 'Interface'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        onClick={() => { setSortBy(value); setSortMenuOpen(false); }}
                        className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                          sortBy === value
                            ? 'text-primary font-bold bg-primary/5'
                            : 'text-on-surface-variant hover:bg-surface-container-highest/60 hover:text-on-surface'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            <ExportDropdown device={device} adapters={adapters} endpoints={endpoints} />
            <SyncButton deviceId={deviceId} />
          </div>
        </div>
      </header>

      {/* Content Grid (12-col asymmetric) */}
      <div className="grid grid-cols-12 gap-5">
        {/* Main content: 8 cols */}
        <div className="col-span-12 lg:col-span-8 space-y-10">
          {/* WEB PORTS */}
          <section>
            <SectionDivider label="WEB PORTS" />
            {webPorts.length > 0 ? (
              <div className="space-y-3">
                {webPorts.map((row) => (
                  <WebPortRow
                    key={`${row.targetIp}-${row.service.id}`}
                    service={row.service}
                    targetIp={row.targetIp}
                    hostname={row.endpointHostname}
                    deviceId={deviceId}
                    interfaceName={row.interfaceName}
                    addressMode={row.addressMode}
                    isLocalhost={row.isLocalhost}
                    latency={row.latency}
                    endpointActive={row.endpointActive}
                    endpointId={row.endpointId}
                    endpointLabel={(row.endpointMetadata as Record<string, unknown>)?.label as string ?? ''}
                    editingLabel={editingLabel}
                    labelValue={labelValue}
                    onStartEdit={startEditingLabel}
                    onCancelEdit={cancelEditingLabel}
                    onLabelChange={setLabelValue}
                    onSaveLabel={saveEndpointLabel}
                  />
                ))}
              </div>
            ) : (
              <EmptyPortSection message="No web-accessible ports discovered." />
            )}
          </section>

          {/* SERVICE PORTS */}
          <section>
            <SectionDivider label="SERVICE PORTS" />
            <div className="space-y-3">
              {/* Virtual mbusd bridge row — appears when bridge is active */}
              {bridgeActive && (
                <BridgeServiceRow
                  tcpPort={bridgeConfig.tcpPort}
                  serialPort={bridgeConfig.serialPort}
                  baudRate={bridgeConfig.baudRate}
                  config={`${bridgeConfig.dataBits}${bridgeConfig.parity[0].toUpperCase()}${bridgeConfig.stopBits}`}
                  deviceId={deviceId}
                />
              )}
              {programPorts.length > 0 ? (
                programPorts.map((row) => (
                  <ProgramPortRow
                    key={`${row.targetIp}-${row.service.id}`}
                    service={row.service}
                    targetIp={row.targetIp}
                    hostname={row.endpointHostname}
                    deviceId={deviceId}
                    latency={row.latency}
                    interfaceName={row.interfaceName}
                    addressMode={row.addressMode}
                    isLocalhost={row.isLocalhost}
                    endpointActive={row.endpointActive}
                    endpointId={row.endpointId}
                    endpointLabel={(row.endpointMetadata as Record<string, unknown>)?.label as string ?? ''}
                    editingLabel={editingLabel}
                    labelValue={labelValue}
                    onStartEdit={startEditingLabel}
                    onCancelEdit={cancelEditingLabel}
                    onLabelChange={setLabelValue}
                    onSaveLabel={saveEndpointLabel}
                  />
                ))
              ) : !bridgeActive ? (
                <EmptyPortSection message="No service ports discovered." />
              ) : null}
            </div>
          </section>
        </div>

        {/* Sidebar: 4 cols — Tabbed panels */}
        <div className="col-span-12 lg:col-span-4 space-y-4">
          {/* Tab buttons */}
          <div className="flex rounded-lg bg-surface-container-low border border-outline-variant/10 p-0.5 gap-0.5">
            <button
              onClick={() => setSidebarTab('modbus')}
              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
                sidebarTab === 'modbus'
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high/50'
              }`}
            >
              Modbus
            </button>
            <button
              onClick={() => setSidebarTab('adapters')}
              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
                sidebarTab === 'adapters'
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high/50'
              }`}
            >
              Network
            </button>
            <button
              onClick={() => setSidebarTab('health')}
              className={`flex-1 px-1.5 py-1.5 rounded-md text-[9px] font-bold uppercase tracking-wider transition-all ${
                sidebarTab === 'health'
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'text-on-surface-variant/50 hover:text-on-surface-variant hover:bg-surface-container-high/50'
              }`}
            >
              Health
            </button>
          </div>

          {/* Tab content */}
          {sidebarTab === 'modbus' && (
            <ModbusBridgePanel
              deviceId={deviceId}
              isActive={bridgeActive}
              onActivate={(cfg) => { setBridgeActive(true); setBridgeConfig(cfg); }}
              onDeactivate={() => setBridgeActive(false)}
            />
          )}

          {sidebarTab === 'adapters' && (
            <div className="space-y-4">
              {adapters.length > 0 ? (
                adapters.map((adapter) => {
                  const adapterEndpoints = endpoints.filter((ep) => ep.adapterId === adapter.id);
                  // Agent vr23+ reports carrier state via /sys/class/net/carrier.
                  // Trust adapter.isUp directly — no frontend override needed.
                  return (
                  <AdapterScanCard
                    key={adapter.id}
                    adapter={adapter}
                    deviceId={deviceId}
                    endpointCount={adapterEndpoints.length}
                  />
                  );
                })
              ) : (
                <div className="bg-surface-container-low rounded-xl p-6 text-center">
                  <Network className="w-8 h-8 text-on-surface-variant/20 mx-auto mb-2" />
                  <p className="text-sm text-on-surface-variant/40">No adapters found.</p>
                </div>
              )}
              {/* Connectivity check — below all adapter cards */}
              <ConnectivityCheckPanel
                deviceId={deviceId}
                autoInterval={healthCheckInterval}
                onAutoIntervalChange={setHealthCheckInterval}
              />
            </div>
          )}

          {sidebarTab === 'health' && (
            <HealthPanel deviceId={deviceId} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Port row builder ─── */

interface PortRow {
  adapterName: string;
  adapterId: string;
  targetIp: string;
  endpointHostname: string | null;
  service: ServiceInfo;
  latency?: number;
  /** Network interface name: eth0, wlan0, etc. */
  interfaceName: string;
  /** Whether adapter IP is assigned via DHCP, Static, or unknown */
  addressMode: 'DHCP' | 'Static' | 'Not Set';
  /** True when endpoint IP matches the adapter's own IP (localhost-equivalent) */
  isLocalhost: boolean;
  /** The adapter's IP for context */
  adapterIp: string | null;
  /** Whether the endpoint is reachable (from health check / lastSeenAt) */
  endpointActive: boolean;
  /** Endpoint ID for label editing */
  endpointId: string;
  /** Endpoint metadata (contains label, etc.) */
  endpointMetadata: Record<string, unknown> | null;
}

function buildPortRows(endpoints: Endpoint[], adapters: Adapter[]): PortRow[] {
  const adapterMap = new Map(adapters.map((a) => [a.id, a]));
  const rows: PortRow[] = [];
  for (const ep of endpoints) {
    const adapter = adapterMap.get(ep.adapterId);
    const adapterIp = adapter?.ipAddress ?? null;
    const adapterName = adapter?.name ?? 'unknown';

    // Determine interface display name
    const ifName = deriveInterfaceName(adapterName);

    // Determine address mode from adapter
    const addrMode = deriveAddressMode(adapter?.mode ?? null, adapterName, adapterIp);

    // Detect if endpoint is truly localhost (127.0.0.1 only)
    // Self-IPs (adapter's own IP like 10.10.8.1) should show the real IP, not "Localhost"
    const isLocal = ep.ipAddress === '127.0.0.1' || ep.ipAddress === 'localhost';

    // Normalize 'localhost' to '127.0.0.1' so Zod .ip() validation passes
    const normalizedIp = ep.ipAddress === 'localhost' ? '127.0.0.1' : ep.ipAddress;

    for (const svc of ep.services) {
      rows.push({
        adapterName,
        adapterId: ep.adapterId,
        targetIp: normalizedIp,
        endpointHostname: ep.hostname,
        service: svc,
        latency: ep.latency,
        interfaceName: ifName,
        addressMode: addrMode,
        isLocalhost: isLocal,
        adapterIp,
        endpointActive: ep.isActive,
        endpointId: ep.id,
        endpointMetadata: ep.metadata ?? null,
      });
    }
  }
  return rows;
}

/** Maps adapter names to standard interface labels */
function deriveInterfaceName(name: string): string {
  const n = name.toLowerCase();
  if (/eth0|ethernet.*0|en0|enp0/.test(n)) return 'eth0';
  if (/eth1|ethernet.*1|en1|enp1/.test(n)) return 'eth1';
  if (/wlan0|wi-?fi|wlp|wireless.*0/.test(n)) return 'wlan0';
  if (/wlan1|wireless.*1/.test(n)) return 'wlan1';
  if (/ppp|cellular|lte|4g|5g|wwan/.test(n)) return 'wwan0';
  if (/docker|br-|bridge/.test(n)) return 'docker0';
  if (/lo|loopback/.test(n)) return 'lo';
  if (/tun|vpn/.test(n)) return 'tun0';
  // Return first 6 chars of original name lowercased
  return n.slice(0, 8);
}

/**
 * Derive address mode from adapter mode field.
 * The agent now reads /etc/NetworkManager/system-connections/ to get the
 * actual ipv4.method (manual=Static, auto=DHCP), NOT the profile name.
 * Fallback: If the mode still contains the old profile-name pattern,
 * parse it intelligently.
 */
function deriveAddressMode(mode: string | null, adapterName?: string, ip?: string | null): 'DHCP' | 'Static' | 'Not Set' {
  if (mode) {
    const m = mode.toLowerCase().trim();
    if (m === 'static' || m === 'manual') return 'Static';
    if (m === 'dhcp' || m === 'auto' || m === 'shared') return 'DHCP';
    if (m === 'link-local') return 'Static';
    if (m.includes('dhcp')) return 'DHCP';
    if (m.includes('static') || m.includes('manual')) return 'Static';
  }

  // Infer from adapter name and IP when agent doesn't report mode
  if (adapterName) {
    const n = adapterName.toLowerCase();
    if (/wwan|cellular|ppp|lte/i.test(n)) return 'DHCP';
    if (/wlan/i.test(n) && ip?.startsWith('10.42.')) return 'DHCP';
    if (/eth0/i.test(n) && ip?.startsWith('10.10.')) return 'Static';
    if (ip?.startsWith('192.168.') || ip?.startsWith('10.4.')) return 'DHCP';
  }

  if (!ip) return 'Not Set';
  return 'DHCP';
}

/* ─── Web Port Row — Same structure as Program Ports with browser action ─── */

function WebPortRow({
  service, targetIp, hostname, deviceId, interfaceName, addressMode, isLocalhost, latency, endpointActive,
  endpointId, endpointLabel, editingLabel, labelValue, onStartEdit, onCancelEdit, onLabelChange, onSaveLabel,
}: {
  service: ServiceInfo; targetIp: string; hostname: string | null; deviceId: string;
  interfaceName: string; addressMode: 'DHCP' | 'Static' | 'Not Set';
  isLocalhost: boolean; latency?: number; endpointActive: boolean;
  endpointId: string; endpointLabel: string;
  editingLabel: string | null; labelValue: string;
  onStartEdit: (endpointId: string, currentLabel: string) => void;
  onCancelEdit: () => void; onLabelChange: (value: string) => void;
  onSaveLabel: (endpointId: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [exposure, setExposure] = useState<{ id: string; refCount: number; status: string } | null>(null);

  // Check if exposure already exists for this device+port
  useEffect(() => {
    api.get<{ success: boolean; data: any }>(`/sessions/exposure?deviceId=${deviceId}&port=${service.port}&targetIp=${encodeURIComponent(targetIp)}`)
      .then(res => {
        if (res.data) setExposure(res.data);
      })
      .catch(() => {}); // Silently fail — optional enhancement
  }, [deviceId, service.port]);

  const handleOpen = useCallback(async () => {
    setLoading(true);
    // Open window synchronously (before await) to avoid popup blocker
    const newTab = window.open('about:blank', '_blank');
    try {
      const ip = targetIp !== '127.0.0.1' && targetIp !== 'localhost' ? targetIp : '127.0.0.1';
      const res = await api.post<{ success: boolean; data: any }>('/sessions', {
        deviceId,
        targetIp: ip,
        targetPort: service.port,
        tunnelType: 'browser',
        durationMinutes: 480,
      });
      if (res.data?.proxyUrl && newTab) {
        newTab.location.href = res.data.proxyUrl;
      } else if (res.data?.proxyUrl) {
        window.open(res.data.proxyUrl, '_blank');
      } else {
        newTab?.close();
        alert('Failed to create session');
      }
    } catch (err: any) {
      newTab?.close();
      alert(`Failed to open session: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [deviceId, targetIp, service.port]);

  const buttonLabel = loading
    ? 'Connecting...'
    : exposure && exposure.refCount > 0
      ? 'Join Session'
      : 'Open in Browser';

  const baseLatency = endpointActive ? (latency ?? 0) : 0;
  const sparkData = useMemo(() => {
    // If endpoint is down, flat line at 0
    if (!endpointActive) return Array.from({ length: 12 }, () => 0);
    const data = Array.from({ length: 12 }, () => {
      const jitter = Math.floor(Math.random() * (baseLatency * 0.4)) - (baseLatency * 0.2);
      return Math.max(1, Math.round(baseLatency + jitter));
    });
    data[data.length - 1] = baseLatency;
    return data;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLatency, endpointActive]);

  const sparkMax = Math.max(...sparkData);
  const sparkMin = Math.min(...sparkData);
  const sparkRange = sparkMax - sparkMin || 1;
  const sparkW = 180; const sparkH = 28;
  const sparkPath = endpointActive
    ? sparkData.map((v, i) => {
        const x = (i / (sparkData.length - 1)) * sparkW;
        const y = sparkH - ((v - sparkMin) / sparkRange) * (sparkH - 4);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ')
    : `M 0 ${sparkH / 2} L ${sparkW} ${sparkH / 2}`; // flat red line when down
  const sparkArea = endpointActive
    ? sparkPath + ` L ${sparkW} ${sparkH} L 0 ${sparkH} Z`
    : `M 0 ${sparkH / 2} L ${sparkW} ${sparkH / 2} L ${sparkW} ${sparkH} L 0 ${sparkH} Z`;

  const latencyColor = !endpointActive ? '#ffb4ab' : baseLatency === 0 ? '#666' : baseLatency < 50 ? '#4edea3' : baseLatency < 200 ? '#adc6ff' : baseLatency < 500 ? '#f59e0b' : '#ffb4ab';
  const latencyLabel = !endpointActive ? 'Offline' : baseLatency === 0 ? '' : isLocalhost ? 'Local' : baseLatency < 50 ? 'Fast' : baseLatency < 200 ? 'Normal' : baseLatency < 500 ? 'Slow' : 'High';
  // Status reflects both tunnelability AND endpoint reachability
  const isReady = service.isTunnelable && endpointActive;
  const sub = serviceSubLabel(service);

  const modeBadgeClass =
    addressMode === 'DHCP' ? 'bg-primary/10 text-primary' :
    addressMode === 'Static' ? 'bg-tertiary/10 text-tertiary' :
    addressMode === 'Not Set' ? 'bg-surface-container-highest text-on-surface-variant/40' :
    'bg-surface-container-highest text-on-surface-variant/40';

  return (
    <div className="relative bg-surface-container-low rounded-xl hover:bg-surface-container transition-all group border border-outline-variant/5 hover:border-primary/15">
      {/* Pencil edit icon — top-left corner of card */}
      {!isLocalhost && (
        <button
          onClick={() => onStartEdit(endpointId, endpointLabel)}
          className="absolute top-2 left-2 z-10 p-1 rounded-md bg-surface-container-high/80 text-on-surface-variant/40 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all"
          title="Edit device name"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
        </button>
      )}
      {service.port === 9090 && (
        <span className="absolute -top-2 -right-2 z-10 text-[9px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1.5 py-0.5 rounded-md uppercase tracking-wider shadow-sm backdrop-blur-sm">
          Beta
        </span>
      )}
      <div className="px-5 py-4">
        {/* Inline label editing */}
        {editingLabel === endpointId && (
          <div className="flex items-center gap-1.5 mb-3">
            <input
              type="text"
              value={labelValue}
              onChange={(e) => onLabelChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveLabel(endpointId);
                if (e.key === 'Escape') onCancelEdit();
              }}
              placeholder="Device name..."
              autoFocus
              className="bg-surface-container-highest/60 border border-primary/30 rounded-lg px-2.5 py-1 text-sm text-on-surface font-medium w-44 focus:outline-none focus:border-primary/60 placeholder:text-on-surface-variant/30"
            />
            <button onClick={() => onSaveLabel(endpointId)} className="p-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCancelEdit} className="p-1 rounded-md bg-surface-container-highest/60 text-on-surface-variant/40 hover:text-on-surface-variant transition">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* Top row: Port | Service | Label — fixed-width columns for vertical alignment */}
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-primary/10 rounded-xl px-4 py-2 w-[64px] text-center shrink-0">
            <span className="font-technical text-lg font-bold text-primary leading-none">{service.port}</span>
          </div>
          <div className="w-[160px] shrink-0 flex items-baseline gap-1.5">
            <span className="text-sm font-bold text-on-surface">{serviceLabel(service)}</span>
            {sub && <span className="text-[11px] text-on-surface-variant/40">{sub}</span>}
          </div>
          {endpointLabel && editingLabel !== endpointId && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-on-surface-variant/20">·</span>
              <span className="text-sm font-bold text-tertiary">{endpointLabel}</span>
            </div>
          )}

          <div className="flex-1" />

          <div className="flex items-center gap-2">
            <button className="p-1.5 text-on-surface-variant/25 hover:text-primary transition-colors rounded-lg hover:bg-surface-container-highest/40">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            {exposure && exposure.refCount > 0 && (
              <span className="text-[10px] font-bold text-tertiary bg-tertiary/10 px-2 py-0.5 rounded-full">
                {exposure.refCount} {exposure.refCount === 1 ? 'client' : 'clients'}
              </span>
            )}
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleOpen}
                disabled={loading}
                className="bg-primary/10 hover:bg-primary hover:text-on-primary border border-primary/15 px-5 py-2 rounded-xl text-xs font-bold text-primary transition-all disabled:opacity-50 whitespace-nowrap"
              >
                {buttonLabel}
              </button>
            </div>
          </div>
        </div>

        {/* Bottom row: Target IP + Interface + Mode + Latency + Sparkline */}
        <div className="flex items-center gap-0 bg-surface-container-lowest/40 rounded-lg px-4 py-3 -mx-1">
          <div className="w-40 flex-shrink-0">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-1">Target (IP)</p>
            <div className="flex items-center gap-1.5">
              <span className={`font-technical text-sm font-medium ${isLocalhost ? 'text-tertiary' : 'text-on-surface'}`}>
                {isLocalhost ? 'Localhost' : targetIp}
              </span>
              {hostname && (
                <span className="text-[9px] text-on-surface-variant/30 truncate max-w-[80px]">{hostname}</span>
              )}
            </div>
          </div>

          <div className="w-24 flex-shrink-0">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-1">Interface</p>
            <div className="flex items-center gap-1.5">
              <Network className="w-3.5 h-3.5 text-on-surface-variant/30" />
              <span className="font-technical text-xs text-on-surface font-medium">{interfaceName}</span>
            </div>
          </div>

          <div className="w-20 flex-shrink-0 hidden md:block">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-1">Mode</p>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${modeBadgeClass}`}>
              {addressMode}
            </span>
          </div>

          {/* Status */}
          <div className="w-20 flex-shrink-0 hidden md:block">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-1">Status</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isReady ? 'bg-tertiary animate-pulse' : 'bg-on-surface-variant/20'}`} />
              <span className={`text-[11px] font-bold ${isReady ? 'text-tertiary' : 'text-on-surface-variant/40'}`}>
                {isReady ? 'Ready' : 'Idle'}
              </span>
            </div>
          </div>

          <div className="w-24 flex-shrink-0 hidden md:block">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-1">Latency</p>
            <div className="flex items-center gap-1.5">
              <span className="font-technical text-sm font-medium" style={{ color: latencyColor }}>
                {baseLatency > 0 ? `${baseLatency}ms` : '--'}
              </span>
              <span className="text-[9px] font-bold uppercase" style={{ color: latencyColor, opacity: 0.6 }}>
                {latencyLabel}
              </span>
            </div>
          </div>

          <div className="flex-1 hidden lg:flex items-center justify-end">
            <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="w-[200px] h-[32px]">
              <defs>
                <linearGradient id={`wsp-${service.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={latencyColor} stopOpacity="0.15" />
                  <stop offset="100%" stopColor={latencyColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={sparkArea} fill={`url(#wsp-${service.id})`} />
              <path d={sparkPath} fill="none" stroke={latencyColor} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
              <circle cx={sparkW} cy={sparkH - ((sparkData[sparkData.length - 1] - sparkMin) / sparkRange) * (sparkH - 4)} r="2.5" fill={latencyColor} />
              <circle cx={sparkW} cy={sparkH - ((sparkData[sparkData.length - 1] - sparkMin) / sparkRange) * (sparkH - 4)} r="5" fill={latencyColor} opacity="0.15" />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Program Port Row — Full context: Target IP, Interface, Address Mode, Latency ─── */

function ProgramPortRow({
  service,
  targetIp,
  hostname,
  deviceId,
  latency,
  interfaceName,
  addressMode,
  isLocalhost,
  endpointActive,
  endpointId,
  endpointLabel,
  editingLabel,
  labelValue,
  onStartEdit,
  onCancelEdit,
  onLabelChange,
  onSaveLabel,
}: {
  service: ServiceInfo;
  targetIp: string;
  hostname: string | null;
  deviceId: string;
  latency?: number;
  interfaceName: string;
  addressMode: 'DHCP' | 'Static' | 'Not Set';
  isLocalhost: boolean;
  endpointActive: boolean;
  endpointId: string;
  endpointLabel: string;
  editingLabel: string | null;
  labelValue: string;
  onStartEdit: (endpointId: string, currentLabel: string) => void;
  onCancelEdit: () => void;
  onLabelChange: (value: string) => void;
  onSaveLabel: (endpointId: string) => void;
}) {
  const [loading, setLoading] = useState(false);

  const [exportModal, setExportModal] = useState<{ isOpen: boolean; sessionToken: string; wsUrl: string; targetPort: number }>({ isOpen: false, sessionToken: '', wsUrl: '', targetPort: 0 });
  const handleExport = useCallback(() => {
    setExportModal(prev => ({ ...prev, isOpen: true, targetPort: service.port }));
  }, [service.port]);

  // Latency sparkline data — deterministic based on port + latency (no random)
  const baseLatency = endpointActive ? (latency ?? 0) : 0;
  const sparkData = useMemo(() => {
    if (!endpointActive) return Array.from({ length: 12 }, () => 0);
    let seed = service.port * 31 + baseLatency * 7;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const data = Array.from({ length: 12 }, () => {
      const jitter = Math.floor(next() * (baseLatency * 0.3)) - (baseLatency * 0.15);
      return Math.max(1, Math.round(baseLatency + jitter));
    });
    data[data.length - 1] = baseLatency;
    return data;
  }, [baseLatency, service.port, endpointActive]);

  const sparkMax = Math.max(...sparkData);
  const sparkMin = Math.min(...sparkData);
  const sparkRange = sparkMax - sparkMin || 1;
  const sparkW = 180;
  const sparkH = 28;
  const sparkPath = endpointActive
    ? sparkData.map((v, i) => {
        const x = (i / (sparkData.length - 1)) * sparkW;
        const y = sparkH - ((v - sparkMin) / sparkRange) * (sparkH - 4);
        return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
      }).join(' ')
    : `M 0 ${sparkH / 2} L ${sparkW} ${sparkH / 2}`;
  const sparkArea = endpointActive
    ? sparkPath + ` L ${sparkW} ${sparkH} L 0 ${sparkH} Z`
    : `M 0 ${sparkH / 2} L ${sparkW} ${sparkH / 2} L ${sparkW} ${sparkH} L 0 ${sparkH} Z`;

  const latencyColor = !endpointActive ? '#ffb4ab' : baseLatency === 0 ? '#666' : baseLatency < 50 ? '#4edea3' : baseLatency < 200 ? '#adc6ff' : baseLatency < 500 ? '#f59e0b' : '#ffb4ab';
  const latencyLabel = !endpointActive ? 'Offline' : baseLatency === 0 ? '' : isLocalhost ? 'Local' : baseLatency < 50 ? 'Fast' : baseLatency < 200 ? 'Normal' : baseLatency < 500 ? 'Slow' : 'High';
  const isReady = service.isTunnelable && endpointActive;

  // Address mode badge colors
  const modeBadgeClass =
    addressMode === 'DHCP' ? 'bg-primary/10 text-primary' :
    addressMode === 'Static' ? 'bg-tertiary/10 text-tertiary' :
    addressMode === 'Not Set' ? 'bg-surface-container-highest text-on-surface-variant/40' :
    'bg-surface-container-highest text-on-surface-variant/40';

  // Display IP: show "Localhost" for device's own IP, otherwise show the real IP
  const displayIp = isLocalhost ? 'Localhost' : targetIp;

  return (
    <div className="relative bg-surface-container-low rounded-xl hover:bg-surface-container transition-all group border border-outline-variant/5 hover:border-outline-variant/15">
      {/* Pencil edit icon — top-left corner of card */}
      {!isLocalhost && (
        <button
          onClick={() => onStartEdit(endpointId, endpointLabel)}
          className="absolute top-2 left-2 z-10 p-1 rounded-md bg-surface-container-high/80 text-on-surface-variant/40 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-all"
          title="Edit device name"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>
        </button>
      )}
      <div className="px-5 py-4">
        {/* Inline label editing */}
        {editingLabel === endpointId && (
          <div className="flex items-center gap-1.5 mb-3">
            <input
              type="text"
              value={labelValue}
              onChange={(e) => onLabelChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onSaveLabel(endpointId);
                if (e.key === 'Escape') onCancelEdit();
              }}
              placeholder="Device name..."
              autoFocus
              className="bg-surface-container-highest/60 border border-primary/30 rounded-lg px-2.5 py-1 text-xs text-on-surface font-medium w-40 focus:outline-none focus:border-primary/60 placeholder:text-on-surface-variant/30"
            />
            <button onClick={() => onSaveLabel(endpointId)} className="p-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={onCancelEdit} className="p-1 rounded-md bg-surface-container-highest/60 text-on-surface-variant/40 hover:text-on-surface-variant transition">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {/* Top row: Port | Service | Label — fixed-width columns for vertical alignment */}
        <div className="flex items-center gap-3 mb-3">
          <div className="bg-surface-container-highest/60 rounded-lg px-3 py-1.5 w-[56px] text-center shrink-0">
            <span className="font-technical text-base font-bold text-on-surface leading-none">{service.port}</span>
          </div>
          <div className="w-[140px] shrink-0 flex items-baseline gap-1.5">
            <span className="text-xs font-bold text-on-surface">{serviceLabel(service)}</span>
            {service.protocol && (
              <span className="text-[10px] text-on-surface-variant/40 font-technical">
                {service.protocol.toUpperCase()}
              </span>
            )}
          </div>
          {endpointLabel && editingLabel !== endpointId && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-on-surface-variant/20">·</span>
              <span className="text-xs font-bold text-tertiary">{endpointLabel}</span>
            </div>
          )}

          {/* Spacer */}
          <div className="flex-1" />

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button className="p-1.5 text-on-surface-variant/25 hover:text-primary transition-colors rounded-lg hover:bg-surface-container-highest/40">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleExport}
              disabled={loading}
              className="inline-flex items-center gap-1.5 bg-primary/8 hover:bg-primary/15 border border-primary/10 px-4 py-1.5 rounded-lg text-[11px] font-bold text-primary transition-all disabled:opacity-50 whitespace-nowrap"
            >
              {loading ? 'Exporting...' : 'Export'}
              <span className="text-[8px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1 py-px rounded uppercase">Beta</span>
            </button>
          </div>
        </div>

        {/* Bottom row: Target IP + Interface + Address Mode + Latency sparkline */}
        <div className="flex items-center gap-0 bg-surface-container-lowest/40 rounded-lg px-4 py-2.5 -mx-1">
          {/* Target (IP) */}
          <div className="w-36 flex-shrink-0">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-0.5">Target (IP)</p>
            <div className="flex items-center gap-1.5">
              <span className={`font-technical text-xs font-medium ${isLocalhost ? 'text-tertiary' : 'text-on-surface'}`}>
                {displayIp}
              </span>
              {hostname && (
                <span className="text-[9px] text-on-surface-variant/30 truncate max-w-[80px]">{hostname}</span>
              )}
            </div>
          </div>

          {/* Interface / Source */}
          <div className="w-24 flex-shrink-0">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-0.5">Interface</p>
            <div className="flex items-center gap-1.5">
              <Network className="w-3 h-3 text-on-surface-variant/30" />
              <span className="font-technical text-[11px] text-on-surface font-medium">{interfaceName}</span>
            </div>
          </div>

          {/* Address Mode */}
          <div className="w-20 flex-shrink-0 hidden md:block">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-0.5">Mode</p>
            <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold ${modeBadgeClass}`}>
              {addressMode}
            </span>
          </div>

          {/* Status */}
          <div className="w-20 flex-shrink-0 hidden md:block">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-0.5">Status</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isReady ? 'bg-tertiary animate-pulse' : 'bg-on-surface-variant/20'}`} />
              <span className={`text-[10px] font-bold ${isReady ? 'text-tertiary' : 'text-on-surface-variant/40'}`}>
                {isReady ? 'Ready' : 'Idle'}
              </span>
            </div>
          </div>

          {/* Latency value */}
          <div className="w-20 flex-shrink-0 hidden md:block">
            <p className="text-[9px] text-on-surface-variant/35 font-bold uppercase tracking-wider mb-0.5">Latency</p>
            <div className="flex items-center gap-1">
              <span className="font-technical text-[11px] font-medium" style={{ color: latencyColor }}>
                {baseLatency > 0 ? `${baseLatency}ms` : '--'}
              </span>
              <span className="text-[8px] font-bold uppercase" style={{ color: latencyColor, opacity: 0.5 }}>
                {latencyLabel}
              </span>
            </div>
          </div>

          {/* Latency sparkline with area fill */}
          <div className="flex-1 hidden lg:flex items-center justify-end">
            <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="w-[180px] h-[28px]">
              <defs>
                <linearGradient id={`sp-${service.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={latencyColor} stopOpacity="0.15" />
                  <stop offset="100%" stopColor={latencyColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <path d={sparkArea} fill={`url(#sp-${service.id})`} />
              <path d={sparkPath} fill="none" stroke={latencyColor} strokeWidth="1.5" strokeLinecap="round" opacity="0.7" />
              <circle
                cx={sparkW}
                cy={sparkH - ((sparkData[sparkData.length - 1] - sparkMin) / sparkRange) * (sparkH - 4)}
                r="2.5"
                fill={latencyColor}
              />
              {/* Glow on last point */}
              <circle
                cx={sparkW}
                cy={sparkH - ((sparkData[sparkData.length - 1] - sparkMin) / sparkRange) * (sparkH - 4)}
                r="5"
                fill={latencyColor}
                opacity="0.15"
              />
            </svg>
          </div>
        </div>
      </div>
      <ExportModal
        isOpen={exportModal.isOpen}
        onClose={() => setExportModal(prev => ({ ...prev, isOpen: false }))}
        port={exportModal.targetPort}
        serviceName={serviceLabel(service)}
        deviceId={deviceId}
      />
    </div>
  );
}

/* ─── Activity Feed Panel ─── */

function ActivityFeedPanel({ device }: { device: any }) {
  // Mock activity feed - in production this would come from an API
  const activities = device.metadata?.recentActivity ?? [];

  return (
    <div className="bg-surface-container-low rounded-2xl p-6">
      <h3 className="font-headline font-bold mb-6 flex items-center gap-2 text-on-surface">
        <Activity className="w-4 h-4 text-primary" />
        Activity Feed
      </h3>
      {activities.length > 0 ? (
        <div className="space-y-6 relative before:absolute before:left-[11px] before:top-2 before:bottom-2 before:w-px before:bg-outline-variant/20">
          {activities.map((event: any, idx: number) => (
            <div key={idx} className="relative pl-8">
              <div className="absolute left-0 top-1.5 w-6 h-6 rounded-full bg-surface-container-high flex items-center justify-center">
                <span className="w-2 h-2 rounded-full bg-primary" />
              </div>
              <p className="text-xs font-technical text-on-surface-variant/40 mb-1">{event.timestamp}</p>
              <p className="text-sm font-medium text-on-surface-variant">{event.message}</p>
              {event.user && (
                <p className="text-[10px] text-on-surface-variant/30 mt-1 uppercase font-bold">
                  User: {event.user}
                </p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-6">
          <p className="text-sm text-on-surface-variant/40">No recent activity recorded.</p>
        </div>
      )}
      <button className="w-full mt-8 py-3 text-xs font-bold text-on-surface-variant/40 hover:text-primary transition-colors border-t border-outline-variant/10">
        View Full Device Audit
      </button>
    </div>
  );
}

/* ─── System Metadata Panel ─── */

function SystemMetadataPanel({ device, metadata }: { device: any; metadata: any }) {
  return (
    <div className="bg-surface-container-low rounded-2xl p-6">
      <h3 className="font-headline font-bold mb-6 text-sm text-on-surface">System Metadata</h3>
      <div className="grid grid-cols-2 gap-4">
        <MetaCell label="FIRMWARE" value={device.firmwareVersion || metadata.firmware || '--'} />
        <MetaCell label="UPTIME" value={metadata.uptime ? formatUptime(metadata.uptime) : '--'} />
        <MetaCell label="AGENT" value={device.agentVersion ? `v${device.agentVersion}` : '--'} />
        <MetaCell label="KERNEL" value={metadata.kernel || '--'} />
        <MetaCell label="MAC ADDRESS" value={metadata.macAddress || '--'} span2 />
        {metadata.hostname && (
          <MetaCell label="HOSTNAME" value={metadata.hostname} span2 />
        )}
      </div>
    </div>
  );
}

function MetaCell({ label, value, span2 }: { label: string; value: string; span2?: boolean }) {
  return (
    <div className={`bg-surface-container-lowest p-3 rounded-xl ${span2 ? 'col-span-2' : ''}`}>
      <p className="text-[9px] text-on-surface-variant/40 font-bold mb-1">{label}</p>
      <p className="font-technical text-sm text-on-surface">{value}</p>
    </div>
  );
}

/* ─── Shared Components ─── */

function SectionDivider({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-4 mb-6">
      <h2 className="font-headline text-xl font-bold text-on-surface">{label}</h2>
      <div className="h-px flex-grow bg-gradient-to-r from-outline-variant/20 to-transparent" />
    </div>
  );
}

function HealthOrb({ status, inline }: { status: 'ready' | 'idle' | 'error'; inline?: boolean }) {
  const color =
    status === 'ready'
      ? 'bg-tertiary'
      : status === 'error'
        ? 'bg-error'
        : 'bg-on-surface-variant/30';
  const size = inline ? 'w-1.5 h-1.5' : 'w-2.5 h-2.5';
  return <span className={`${size} rounded-full ${color} ${status === 'ready' ? 'animate-pulse' : ''}`} />;
}

function EmptyPortSection({ message }: { message: string }) {
  return (
    <div className="bg-surface-container-lowest rounded-xl p-8 text-center">
      <Server className="w-8 h-8 text-on-surface-variant/20 mx-auto mb-2" />
      <p className="text-sm text-on-surface-variant/40">{message}</p>
    </div>
  );
}

function ExportDropdown({ device, adapters, endpoints }: { device: any; adapters: Adapter[]; endpoints: Endpoint[] }) {
  const [open, setOpen] = useState(false);

  const buildReport = () => ({
    device: { name: device.name, id: device.id, status: device.status, agentVersion: device.agentVersion, lastSeenAt: device.lastSeenAt },
    adapters: adapters.map((a) => ({ name: a.name, ip: a.ipAddress, subnet: a.subnetMask, gateway: a.gateway, mode: a.mode, isUp: a.isUp })),
    endpoints: endpoints.map((ep) => ({ ip: ep.ipAddress, hostname: ep.hostname, services: ep.services.map((s) => ({ port: s.port, name: s.serviceName, type: s.tunnelType })) })),
    exportedAt: new Date().toISOString(),
  });

  const downloadFile = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  };

  const exportJson = () => {
    downloadFile(JSON.stringify(buildReport(), null, 2), `${device.name || device.id}-report.json`, 'application/json');
  };

  const exportCsv = () => {
    const rows = [['IP', 'Hostname', 'Port', 'Service', 'Type', 'Adapter', 'Mode']];
    for (const ep of endpoints) {
      for (const svc of ep.services) {
        const adapter = adapters.find((a) => a.id === ep.adapterId);
        rows.push([ep.ipAddress, ep.hostname || '', String(svc.port), svc.serviceName || '', svc.tunnelType || '', adapter?.name || '', adapter?.mode || '']);
      }
    }
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
    downloadFile(csv, `${device.name || device.id}-report.csv`, 'text/csv');
  };

  const exportHtml = () => {
    const report = buildReport();
    const html = `<!DOCTYPE html><html><head><title>${device.name} Report</title><style>body{font-family:system-ui;max-width:900px;margin:40px auto;padding:20px}table{width:100%;border-collapse:collapse;margin:20px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left}th{background:#f5f5f5;font-size:12px;text-transform:uppercase}h1{color:#333}h2{color:#666;border-bottom:2px solid #eee;padding-bottom:8px}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:11px;font-weight:bold}.online{background:#e8f5e9;color:#2e7d32}.offline{background:#fce4ec;color:#c62828}</style></head><body><h1>${device.name}</h1><p>Status: <span class="badge ${device.status}">${device.status}</span> | Agent: ${device.agentVersion} | Exported: ${new Date().toLocaleString()}</p><h2>Adapters</h2><table><tr><th>Name</th><th>IP</th><th>Subnet</th><th>Gateway</th><th>Mode</th><th>Status</th></tr>${report.adapters.map((a: any) => `<tr><td>${a.name}</td><td>${a.ip || '--'}</td><td>${a.subnet || '--'}</td><td>${a.gateway || '--'}</td><td>${a.mode || '--'}</td><td>${a.isUp ? 'Up' : 'Down'}</td></tr>`).join('')}</table><h2>Discovered Services</h2><table><tr><th>Host</th><th>Port</th><th>Service</th><th>Type</th></tr>${report.endpoints.flatMap((ep: any) => ep.services.map((s: any) => `<tr><td>${ep.ip}${ep.hostname ? ' (' + ep.hostname + ')' : ''}</td><td>${s.port}</td><td>${s.name || '--'}</td><td>${s.type || '--'}</td></tr>`)).join('')}</table></body></html>`;
    downloadFile(html, `${device.name || device.id}-report.html`, 'text/html');
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-on-surface-variant hover:bg-surface-container-high transition text-sm font-medium"
      >
        <FileDown className="w-4 h-4" />
        Export
        <ChevronDown className="w-3 h-3" />
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-44 rounded-xl bg-surface-container-high shadow-lg z-20 overflow-hidden">
          <button onClick={exportJson} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-bright text-on-surface-variant transition">
            <span className="font-medium">JSON</span>
            <span className="block text-xs text-on-surface-variant/40">Structured data</span>
          </button>
          <button onClick={exportCsv} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-bright text-on-surface-variant transition">
            <span className="font-medium">CSV / Excel</span>
            <span className="block text-xs text-on-surface-variant/40">Open in spreadsheet</span>
          </button>
          <button onClick={exportHtml} className="w-full text-left px-4 py-2.5 text-sm hover:bg-surface-bright text-on-surface-variant transition">
            <span className="font-medium">HTML Report</span>
            <span className="block text-xs text-on-surface-variant/40">Printable / PDF via browser</span>
          </button>
        </div>
      )}
    </div>
  );
}

function SyncButton({ deviceId }: { deviceId: string }) {
  const syncMutation = useSyncDevice(deviceId);
  return (
    <button
      onClick={() => syncMutation.mutate()}
      disabled={syncMutation.isPending}
      className="bg-gradient-to-br from-primary to-primary-container text-on-primary-container px-4 py-2.5 rounded-xl font-bold text-sm transition-transform active:scale-95 shadow-lg shadow-primary/10 flex items-center gap-2 disabled:opacity-50"
    >
      <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
      {syncMutation.isPending ? 'Syncing...' : 'Sync'}
    </button>
  );
}

function LoadingPlaceholder({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex flex-col items-center gap-3">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-sm text-on-surface-variant">{text}</span>
      </div>
    </div>
  );
}

/* ─── Time helpers ─── */

function findLastScanTime(endpoints: Endpoint[]): string | null {
  let latest: string | null = null;
  for (const ep of endpoints) {
    for (const svc of ep.services) {
      if (!latest || svc.lastScannedAt > latest) {
        latest = svc.lastScannedAt;
      }
    }
  }
  return latest;
}

function hoursSince(dateStr: string): number {
  const date = new Date(dateStr);
  const now = new Date();
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

/* ═══════════════════════════════════════════════════════════
   BRIDGE SERVICE ROW — Virtual row in SERVICE PORTS when mbusd is active
   ═══════════════════════════════════════════════════════════ */

function BridgeServiceRow({ tcpPort, serialPort, baudRate, config, deviceId }: {
  tcpPort: number; serialPort: string; baudRate: number; config: string; deviceId: string;
}) {
  const [loading, setLoading] = useState(false);
  const [exportModal, setExportModal] = useState<{ isOpen: boolean; sessionToken: string; wsUrl: string; targetPort: number }>({ isOpen: false, sessionToken: '', wsUrl: '', targetPort: 0 });

  const handleExport = useCallback(() => {
    setExportModal({ isOpen: true, sessionToken: '', wsUrl: '', targetPort: tcpPort });
  }, [tcpPort]);

  /* ── Friendly serial name ── */
  const serialLabel = serialPort.replace('/dev/', '');

  return (
    <div className="group relative bg-surface-container-low rounded-2xl border border-tertiary/12 hover:border-tertiary/30 transition-all duration-200 overflow-hidden">
      {/* Accent top bar */}
      <div className="h-[3px] bg-gradient-to-r from-amber-400/60 via-tertiary/50 to-primary/40" />

      <div className="px-5 py-4 flex items-center gap-5">
        {/* Protocol icon */}
        <div className="relative flex-shrink-0">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400/15 to-tertiary/10 flex items-center justify-center border border-amber-400/10">
            <Cable className="w-5 h-5 text-amber-500" />
          </div>
          <span className="absolute -bottom-1 -right-1 w-4 h-4 bg-tertiary rounded-full flex items-center justify-center ring-2 ring-surface-container-low">
            <Zap className="w-2.5 h-2.5 text-on-tertiary" />
          </span>
        </div>

        {/* Info block */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-bold text-on-surface">Modbus TCP</span>
            <span className="text-[10px] font-technical bg-tertiary/8 text-tertiary/80 px-2 py-0.5 rounded-md">
              Port {tcpPort}
            </span>
            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-tertiary bg-tertiary/6 px-2 py-0.5 rounded-md">
              <CircleDot className="w-2.5 h-2.5 animate-pulse" />
              Live
            </span>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-on-surface-variant/50 font-technical">
            <span>{serialLabel}</span>
            <ArrowRight className="w-3 h-3 text-tertiary/40" />
            <span>{baudRate} {config}</span>
            <span className="text-on-surface-variant/25">|</span>
            <span>RTU to TCP</span>
          </div>
        </div>

        {/* Export action */}
        <button
          onClick={handleExport}
          disabled={loading}
          className="flex items-center gap-2 bg-tertiary/8 hover:bg-tertiary/15 border border-tertiary/12 hover:border-tertiary/25 px-4 py-2 rounded-xl text-[11px] font-bold text-tertiary transition-all disabled:opacity-50"
        >
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MonitorDown className="w-3.5 h-3.5" />}
          {loading ? 'Exporting...' : 'Export to PC'}
          <span className="text-[8px] font-bold text-amber-400 bg-amber-400/10 border border-amber-400/20 px-1 py-px rounded uppercase">Beta</span>
        </button>
      </div>
      <ExportModal
        isOpen={exportModal.isOpen}
        onClose={() => setExportModal(prev => ({ ...prev, isOpen: false }))}
        port={exportModal.targetPort}
        serviceName={`Modbus Bridge (${serialPort})`}
        deviceId={deviceId}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MODBUS BRIDGE PANEL — Serial ↔ TCP (mbusd)
   ═══════════════════════════════════════════════════════════ */

interface BridgeConfig {
  serialPort: string;
  baudRate: number;
  tcpPort: number;
  parity: 'none' | 'even' | 'odd';
  stopBits: 1 | 2;
  dataBits: 7 | 8;
}

const DEFAULT_BRIDGE: BridgeConfig = {
  serialPort: '/dev/ttymxc5',
  baudRate: 9600,
  tcpPort: 2202,
  parity: 'none',
  stopBits: 1,
  dataBits: 8,
};

const SERIAL_PORTS = ['/dev/ttymxc5', '/dev/ttymxc4', '/dev/ttymxc3', '/dev/ttyUSB0', '/dev/ttyUSB1', '/dev/ttyS0'];
const BAUD_RATES = [1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200];

/* Helper: friendly serial port name */
function friendlySerial(port: string) {
  const map: Record<string, string> = {
    '/dev/ttymxc5': 'RS-485 Port 1',
    '/dev/ttymxc4': 'RS-485 Port 2',
    '/dev/ttymxc3': 'RS-232 Port 1',
    '/dev/ttyUSB0': 'USB Serial 1',
    '/dev/ttyUSB1': 'USB Serial 2',
    '/dev/ttyS0': 'COM Port 1',
  };
  return map[port] || port.replace('/dev/', '');
}

/* ═══════════════════════════════════════════════════════════
   CONNECTIVITY CHECK PANEL — Network tab
   ═══════════════════════════════════════════════════════════ */

function ConnectivityCheckPanel({ deviceId, autoInterval, onAutoIntervalChange }: {
  deviceId: string;
  autoInterval: number;
  onAutoIntervalChange: (v: number) => void;
}) {
  const queryClient = useQueryClient();
  const { mutateAsync: runHealthCheckAsync } = useEndpointHealthCheck(deviceId);
  const [lastCheck, setLastCheck] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<any>(null);

  const runCheck = useCallback(() => {
    setChecking(true);
    setProgress(0);
    setLastCheck(new Date().toLocaleTimeString());

    const startTime = Date.now();
    // Animate 0→90% over 2 seconds
    const anim = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const raw = Math.min(elapsed / 2000, 1);
      const eased = 1 - Math.pow(1 - raw, 3);
      setProgress(Math.round(eased * 90));
    }, 50);

    runHealthCheckAsync().then((res: any) => {
      const elapsed = Date.now() - startTime;
      const minDelay = Math.max(0, 1500 - elapsed); // ensure at least 1.5s of animation
      setTimeout(() => {
        clearInterval(anim);
        setResult(res?.data ?? res);
        setProgress(100);
        // Refresh endpoints so sparklines/status update with new isActive values
        queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
        queryClient.invalidateQueries({ queryKey: ['adapter-endpoints'] });
        // Show 100% for 1s then settle
        setTimeout(() => setChecking(false), 1000);
      }, minDelay);
    }).catch(() => {
      clearInterval(anim);
      setChecking(false);
    });

    return () => clearInterval(anim);
  }, [runHealthCheckAsync, queryClient]);

  useEffect(() => {
    if (autoInterval <= 0) return;
    const ms = autoInterval * 60 * 1000;
    runCheck();
    const timer = setInterval(() => {
      runCheck();
    }, ms);
    return () => clearInterval(timer);
  }, [autoInterval, runCheck]);

  return (
    <div className="bg-surface-container-low rounded-xl border border-outline-variant/10 overflow-hidden">
      <div className="px-4 py-3 border-b border-outline-variant/10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <span className="text-xs font-bold text-on-surface uppercase tracking-wider">Connectivity</span>
          </div>
          <button
            onClick={runCheck}
            disabled={checking}
            className="inline-flex items-center gap-1.5 bg-primary/10 hover:bg-primary hover:text-on-primary px-3 py-1.5 rounded-lg text-[10px] font-bold text-primary transition-all disabled:opacity-50"
          >
            {checking ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Checking...</>
            ) : (
              <><RefreshCw className="w-3 h-3" /> Verify Now</>
            )}
          </button>
        </div>
      </div>

      <div className="px-4 py-3 space-y-3">
        {/* Auto-scan interval */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-on-surface-variant/60 font-bold uppercase tracking-wider">Auto-check</span>
          <select
            value={autoInterval}
            onChange={(e) => onAutoIntervalChange(Number(e.target.value))}
            className="bg-surface-container-highest rounded-lg px-2 py-1 text-[11px] text-on-surface font-technical focus:outline-none focus:ring-2 focus:ring-primary/40 border border-outline-variant/10"
          >
            <option value={0}>Off</option>
            <option value={1}>Every 1 min</option>
            <option value={2}>Every 2 min</option>
            <option value={5}>Every 5 min</option>
            <option value={10}>Every 10 min</option>
          </select>
        </div>

        {lastCheck && (
          <div className="flex items-center gap-1.5 text-[10px] text-on-surface-variant/50">
            <Clock className="w-3 h-3" />
            <span>Last check: {lastCheck}</span>
          </div>
        )}

        {/* Progress bar — animated 0→100% during check, then shows result */}
        {(checking || result) && (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className={`font-technical text-xs font-bold ${checking ? 'text-primary' : result ? (result.reachable === result.total ? 'text-tertiary' : result.reachable > 0 ? 'text-[#f59e0b]' : 'text-error') : 'text-on-surface-variant'}`}>
                {checking ? `${progress}%` : result ? `${result.total > 0 ? Math.round((result.reachable / result.total) * 100) : 0}%` : ''}
              </span>
              <span className="text-[10px] text-on-surface-variant/50">
                {checking ? 'Scanning...' : result ? `${result.reachable}/${result.total} reachable` : ''}
              </span>
            </div>
            <div className="h-1.5 bg-surface-container-highest rounded-full overflow-hidden">
              {checking ? (
                <div className="h-full bg-primary rounded-full transition-all duration-200 ease-out" style={{ width: `${progress}%` }} />
              ) : result ? (
                <div
                  className={`h-full rounded-full transition-all duration-500 ${result.reachable === result.total ? 'bg-tertiary' : result.reachable > 0 ? 'bg-[#f59e0b]' : 'bg-error'}`}
                  style={{ width: `${result.total > 0 ? Math.round((result.reachable / result.total) * 100) : 0}%` }}
                />
              ) : null}
            </div>
          </div>
        )}

        {/* Adapter table — shows each adapter with IP and status */}
        {result && !checking && result.adapters && (
          <div className="space-y-1 pt-1">
            <span className="text-[9px] text-on-surface-variant/40 font-bold uppercase tracking-wider">Adapters</span>
            {result.adapters.map((a: any) => (
              <div key={a.id} className="flex items-center justify-between px-2 py-1.5 rounded-lg bg-surface-container-highest/20">
                <div className="flex items-center gap-2">
                  <Network className="w-3 h-3 text-on-surface-variant/40" />
                  <span className="font-technical text-[11px] font-bold text-on-surface uppercase">{a.name}</span>
                  {a.ipAddress && (
                    <span className="font-technical text-[10px] text-on-surface-variant/60">{a.ipAddress}</span>
                  )}
                </div>
                <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${a.isConnected ? 'text-tertiary' : 'text-error'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${a.isConnected ? 'bg-tertiary' : 'bg-error'}`} />
                  {a.isConnected ? 'Connected' : 'Disconnected'}
                </span>
              </div>
            ))}
          </div>
        )}

        {result?.timeout && !checking && (
          <div className="text-[11px] text-[#f59e0b] flex items-center gap-1.5 bg-[#f59e0b]/10 rounded-lg px-3 py-2">
            <AlertTriangle className="w-3.5 h-3.5" />
            Health check timed out — agent may be busy
          </div>
        )}
      </div>
    </div>
  );
}

function ModbusBridgePanel({ deviceId, isActive, onActivate, onDeactivate }: {
  deviceId: string;
  isActive: boolean;
  onActivate: (cfg: { tcpPort: number; serialPort: string; baudRate: number; parity: string; dataBits: number; stopBits: number }) => void;
  onDeactivate: () => void;
}) {
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [config, setConfig] = useState<BridgeConfig>(DEFAULT_BRIDGE);
  const [uptime, setUptime] = useState(0);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!isActive) { setUptime(0); return; }
    const interval = setInterval(() => setUptime((u) => u + 1), 1000);
    return () => clearInterval(interval);
  }, [isActive]);

  const [bridgeError, setBridgeError] = useState<string | null>(null);

  const handleStart = useCallback(async () => {
    setStarting(true);
    setBridgeError(null);
    try {
      const res = await api.post<{ success: boolean; error?: string; data?: any }>(`/devices/${deviceId}/bridge/start`, {
        serialPort: config.serialPort,
        baudRate: config.baudRate,
        tcpPort: config.tcpPort,
        parity: config.parity,
        stopBits: config.stopBits,
        dataBits: config.dataBits,
      });
      if (res.success === false || res.error) {
        setBridgeError(res.error || 'Bridge failed to start');
      } else {
        onActivate(config);
      }
    } catch (err: any) {
      setBridgeError(err?.response?.data?.error || err.message || 'Failed to start bridge');
    } finally {
      setStarting(false);
    }
  }, [deviceId, config, onActivate]);

  const handleStop = useCallback(async () => {
    setStopping(true);
    try {
      await api.post(`/devices/${deviceId}/bridge/stop`, {});
      onDeactivate();
    } catch {
      onDeactivate();
    } finally {
      setStopping(false);
    }
  }, [deviceId, onDeactivate]);

  const fmtUptime = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${m}m ${sec}s`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  };

  const updateConfig = (patch: Partial<BridgeConfig>) => {
    setConfig((prev) => ({ ...prev, ...patch }));
  };

  const modeString = `${config.dataBits}${config.parity[0].toUpperCase()}${config.stopBits}`;
  const selectCls = "w-full bg-surface-container text-on-surface text-xs font-technical rounded-xl px-3 py-2.5 border border-outline-variant/8 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/30 transition-all appearance-none cursor-pointer hover:border-outline-variant/20";
  const labelCls = "text-[10px] text-on-surface-variant/60 font-semibold uppercase tracking-wider block mb-2";

  /* ─── ACTIVE STATE ─── */
  if (isActive) {
    return (
      <div className="rounded-2xl overflow-hidden border border-tertiary/20 bg-surface-container-low animate-[fadeIn_0.4s_ease-out]">
        <style>{`
          @keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
          @keyframes flowDot { 0% { left: 0%; opacity: 0; } 15% { opacity: 1; } 85% { opacity: 1; } 100% { left: 100%; opacity: 0; } }
          @keyframes glowPulse { 0%, 100% { box-shadow: 0 0 8px rgba(78,222,163,0.15); } 50% { box-shadow: 0 0 20px rgba(78,222,163,0.3); } }
        `}</style>

        {/* Live status header */}
        <div className="relative bg-gradient-to-r from-tertiary/10 via-tertiary/5 to-transparent px-6 py-4" style={{ animation: 'glowPulse 3s ease-in-out infinite' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-xl bg-tertiary/15 flex items-center justify-center border border-tertiary/20">
                  <Cable className="w-5 h-5 text-tertiary" />
                </div>
                <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-tertiary rounded-full ring-2 ring-surface-container-low animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-on-surface">Modbus Bridge</h3>
                <p className="text-[11px] text-tertiary font-medium">Running since {fmtUptime(uptime)}</p>
              </div>
            </div>
            <button
              onClick={handleStop}
              disabled={stopping}
              className="flex items-center gap-2 bg-error/8 hover:bg-error/15 border border-error/12 hover:border-error/25 text-error px-4 py-2 rounded-xl text-[11px] font-bold transition-all disabled:opacity-50"
            >
              {stopping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <PowerOff className="w-3.5 h-3.5" />}
              {stopping ? 'Stopping...' : 'Stop Bridge'}
            </button>
          </div>
        </div>

        {/* Data flow visualization with animated connector */}
        <div className="px-6 py-5">
          <div className="flex items-stretch gap-0">
            {/* Source: Serial */}
            <div className="flex-1 bg-amber-500/[0.04] border border-amber-400/10 rounded-2xl p-4 text-center">
              <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-amber-400/12 flex items-center justify-center">
                <Cable className="w-4.5 h-4.5 text-amber-500" />
              </div>
              <p className="text-[10px] text-on-surface-variant/50 font-semibold uppercase tracking-wider mb-1">Serial Input</p>
              <p className="text-sm font-bold text-on-surface">{friendlySerial(config.serialPort)}</p>
              <p className="text-[10px] font-technical text-on-surface-variant/40 mt-1">{config.serialPort}</p>
              <div className="mt-2 flex items-center justify-center gap-1.5">
                <span className="text-[10px] font-technical bg-amber-400/8 text-amber-600 px-2 py-0.5 rounded-md">
                  {config.baudRate} bps
                </span>
                <span className="text-[10px] font-technical bg-surface-container-highest/40 text-on-surface-variant/50 px-2 py-0.5 rounded-md">
                  {modeString}
                </span>
              </div>
            </div>

            {/* Animated flow connector */}
            <div className="flex flex-col items-center justify-center px-2 gap-1 w-16">
              <div className="relative w-full h-6 flex items-center justify-center">
                {/* Static line */}
                <div className="absolute inset-x-0 top-1/2 h-0.5 bg-gradient-to-r from-amber-400/30 via-tertiary/40 to-tertiary/30 rounded" />
                {/* Animated data dots */}
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 overflow-hidden">
                  <div className="absolute w-2 h-2 rounded-full bg-tertiary" style={{ animation: 'flowDot 1.5s ease-in-out infinite' }} />
                  <div className="absolute w-2 h-2 rounded-full bg-amber-400" style={{ animation: 'flowDot 1.5s ease-in-out infinite 0.5s' }} />
                  <div className="absolute w-1.5 h-1.5 rounded-full bg-tertiary/70" style={{ animation: 'flowDot 1.5s ease-in-out infinite 1s' }} />
                </div>
              </div>
              <div className="bg-surface-container-highest/30 rounded-lg px-2 py-1">
                <span className="text-[8px] font-bold text-tertiary tracking-widest">RTU→TCP</span>
              </div>
            </div>

            {/* Destination: TCP */}
            <div className="flex-1 bg-tertiary/[0.04] border border-tertiary/10 rounded-2xl p-4 text-center">
              <div className="w-9 h-9 mx-auto mb-2 rounded-lg bg-tertiary/12 flex items-center justify-center">
                <Network className="w-4.5 h-4.5 text-tertiary" />
              </div>
              <p className="text-[10px] text-on-surface-variant/50 font-semibold uppercase tracking-wider mb-1">TCP Output</p>
              <p className="text-sm font-bold text-on-surface">Port {config.tcpPort}</p>
              <p className="text-[10px] font-technical text-on-surface-variant/40 mt-1">0.0.0.0:{config.tcpPort}</p>
              <div className="mt-2">
                <span className="text-[10px] font-technical bg-tertiary/8 text-tertiary px-2 py-0.5 rounded-md">
                  Modbus TCP
                </span>
              </div>
            </div>
          </div>

          {/* Quick stats footer */}
          <div className="mt-4 flex items-center justify-between bg-surface-container-lowest/40 rounded-xl px-4 py-2.5">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-tertiary animate-pulse" />
                <span className="text-[10px] text-on-surface-variant/50 font-medium">mbusd process active</span>
              </div>
            </div>
            <span className="text-[10px] font-technical text-on-surface-variant/30">
              Uptime: {fmtUptime(uptime)}
            </span>
          </div>
        </div>
      </div>
    );
  }

  /* ─── INACTIVE STATE ─── */
  return (
    <div className="rounded-2xl overflow-hidden border border-outline-variant/8 bg-surface-container-low">
      {/* Header */}
      <div className="px-6 py-5">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400/12 to-tertiary/8 flex items-center justify-center border border-amber-400/8">
            <Cable className="w-6 h-6 text-amber-500/70" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-bold text-on-surface">Modbus Bridge</h3>
            <p className="text-xs text-on-surface-variant/50">
              Convert RTU serial to Modbus TCP for remote access
            </p>
          </div>
        </div>

        {/* Visual explanation card */}
        <div className="mt-4 bg-surface-container/50 rounded-xl p-4 border border-outline-variant/5">
          <div className="flex items-center gap-3 justify-center">
            <div className="text-center">
              <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-amber-400/10 flex items-center justify-center">
                <Cable className="w-4 h-4 text-amber-500/70" />
              </div>
              <p className="text-[10px] font-medium text-on-surface-variant/50">Serial</p>
              <p className="text-[9px] font-technical text-on-surface-variant/30">RS-485</p>
            </div>
            <div className="flex items-center gap-1 px-2">
              <div className="w-4 h-px bg-amber-400/25" />
              <div className="w-5 h-px bg-gradient-to-r from-amber-400/25 to-tertiary/25" />
              <ArrowRight className="w-3.5 h-3.5 text-on-surface-variant/20" />
              <div className="w-5 h-px bg-gradient-to-r from-tertiary/25 to-primary/25" />
              <div className="w-4 h-px bg-primary/25" />
            </div>
            <div className="text-center">
              <div className="w-8 h-8 mx-auto mb-1.5 rounded-lg bg-tertiary/10 flex items-center justify-center">
                <Network className="w-4 h-4 text-tertiary/70" />
              </div>
              <p className="text-[10px] font-medium text-on-surface-variant/50">TCP</p>
              <p className="text-[9px] font-technical text-on-surface-variant/30">Modbus</p>
            </div>
          </div>
        </div>
      </div>

      {/* Configuration form */}
      <div className="border-t border-outline-variant/6 px-6 py-5 bg-surface-container-lowest/20">
        {/* Primary settings — always visible */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Serial Port</label>
            <select
              value={config.serialPort}
              onChange={(e) => updateConfig({ serialPort: e.target.value })}
              className={selectCls}
            >
              {SERIAL_PORTS.map((p) => <option key={p} value={p}>{friendlySerial(p)}</option>)}
            </select>
            <p className="text-[9px] font-technical text-on-surface-variant/30 mt-1 ml-1">{config.serialPort}</p>
          </div>

          <div>
            <label className={labelCls}>Baud Rate</label>
            <select
              value={config.baudRate}
              onChange={(e) => updateConfig({ baudRate: Number(e.target.value) })}
              className={selectCls}
            >
              {BAUD_RATES.map((b) => <option key={b} value={b}>{b.toLocaleString()} bps</option>)}
            </select>
          </div>

          <div>
            <label className={labelCls}>TCP Port</label>
            <input
              type="number"
              value={config.tcpPort}
              onChange={(e) => updateConfig({ tcpPort: Number(e.target.value) })}
              className={selectCls}
              min={1} max={65535}
            />
          </div>
        </div>

        {/* Advanced settings — collapsible */}
        <div className="mt-4">
          <button
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-2 text-[10px] text-on-surface-variant/40 hover:text-on-surface-variant/60 font-medium transition-colors"
          >
            <Settings2 className="w-3 h-3" />
            Advanced Settings
            <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-3 gap-4 mt-3 pt-3 border-t border-outline-variant/5">
              <div>
                <label className={labelCls}>Parity</label>
                <select
                  value={config.parity}
                  onChange={(e) => updateConfig({ parity: e.target.value as BridgeConfig['parity'] })}
                  className={selectCls}
                >
                  <option value="none">None</option>
                  <option value="even">Even</option>
                  <option value="odd">Odd</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Data Bits</label>
                <select
                  value={config.dataBits}
                  onChange={(e) => updateConfig({ dataBits: Number(e.target.value) as 7 | 8 })}
                  className={selectCls}
                >
                  <option value={8}>8 bits</option>
                  <option value={7}>7 bits</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Stop Bits</label>
                <select
                  value={config.stopBits}
                  onChange={(e) => updateConfig({ stopBits: Number(e.target.value) as 1 | 2 })}
                  className={selectCls}
                >
                  <option value={1}>1 bit</option>
                  <option value={2}>2 bits</option>
                </select>
              </div>
            </div>
          )}
        </div>

        {/* Summary + Start */}
        <div className="mt-5 flex items-center justify-between bg-surface-container/30 rounded-xl px-4 py-3 border border-outline-variant/5">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[10px] font-technical text-on-surface-variant/40">
              <Cable className="w-3 h-3 text-amber-500/50" />
              <span>{friendlySerial(config.serialPort)}</span>
            </div>
            <ArrowRight className="w-3 h-3 text-on-surface-variant/20" />
            <div className="flex items-center gap-1.5 text-[10px] font-technical text-on-surface-variant/40">
              <Network className="w-3 h-3 text-tertiary/50" />
              <span>TCP :{config.tcpPort}</span>
            </div>
            <span className="text-[9px] font-technical bg-surface-container-highest/30 text-on-surface-variant/30 px-1.5 py-0.5 rounded">
              {config.baudRate} {modeString}
            </span>
          </div>

          <button
            onClick={handleStart}
            disabled={starting}
            className="flex items-center gap-2 bg-tertiary hover:bg-tertiary/90 text-on-tertiary px-5 py-2.5 rounded-xl text-xs font-bold transition-all disabled:opacity-50 shadow-sm shadow-tertiary/20"
          >
            {starting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Power className="w-4 h-4" />
            )}
            {starting ? 'Starting...' : 'Start Bridge'}
          </button>
        </div>

        {/* Error message */}
        {bridgeError && (
          <div className="mt-3 flex items-start gap-2 bg-error/8 border border-error/15 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-error flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-error">Bridge failed to start</p>
              <p className="text-[11px] text-error/70 mt-0.5">{bridgeError}</p>
            </div>
            <button onClick={() => setBridgeError(null)} className="ml-auto text-error/40 hover:text-error">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

