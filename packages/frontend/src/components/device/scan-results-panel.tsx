'use client';

import { useState, useMemo } from 'react';
import {
  LayoutGrid,
  List,
  Search,
  ChevronDown,
  ChevronRight,
  ArrowUpDown,
  Filter,
  Download,
} from 'lucide-react';
import { TunnelTypeBadge } from '@/components/device/status-badge';

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

type ViewMode = 'card' | 'table';
type StatusFilter = 'all' | 'online' | 'offline';
type ServiceFilter = 'all' | 'web' | 'industrial';
type SortField = 'ip' | 'latency' | 'ports';
type SortDir = 'asc' | 'desc';

/* ─── Helpers ─── */

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

/* ─── Component ─── */

interface ScanResultsPanelProps {
  endpoints: Endpoint[];
  onExportAll?: () => void;
}

export function ScanResultsPanel({ endpoints, onExportAll }: ScanResultsPanelProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [serviceFilter, setServiceFilter] = useState<ServiceFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField>('ip');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const filtered = useMemo(() => {
    let result = [...endpoints];

    if (statusFilter === 'online') result = result.filter((ep) => ep.isActive);
    if (statusFilter === 'offline') result = result.filter((ep) => !ep.isActive);

    if (serviceFilter === 'web') {
      result = result.filter((ep) =>
        ep.services.some((s) => s.tunnelType === 'browser' || (s.serviceName && /http|web|node-red|cockpit/i.test(s.serviceName))),
      );
    }
    if (serviceFilter === 'industrial') {
      result = result.filter((ep) =>
        ep.services.some((s) => s.serviceName && /modbus|opcua|mqtt|bacnet/i.test(s.serviceName)),
      );
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (ep) =>
          ep.ipAddress.includes(q) ||
          ep.hostname?.toLowerCase().includes(q) ||
          ep.vendor?.toLowerCase().includes(q) ||
          ep.services.some((s) => s.serviceName?.toLowerCase().includes(q)),
      );
    }

    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'ip':
          cmp = ipToNumber(a.ipAddress) - ipToNumber(b.ipAddress);
          break;
        case 'latency':
          cmp = (a.latency ?? 999) - (b.latency ?? 999);
          break;
        case 'ports':
          cmp = a.services.length - b.services.length;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [endpoints, statusFilter, serviceFilter, searchQuery, sortField, sortDir]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  if (endpoints.length === 0) {
    return (
      <div className="bg-surface-container-low rounded-xl p-12 text-center">
        <Search className="w-10 h-10 text-on-surface-variant/20 mx-auto mb-3" />
        <p className="text-on-surface-variant/40">No scan results yet.</p>
        <p className="text-sm text-on-surface-variant/30 mt-1">
          Run a network scan on an adapter to discover hosts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex rounded-xl overflow-hidden">
            <button
              onClick={() => setViewMode('card')}
              className={`p-2 text-sm transition ${
                viewMode === 'card'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-bright'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`p-2 text-sm transition ${
                viewMode === 'table'
                  ? 'bg-primary text-on-primary'
                  : 'bg-surface-container-high text-on-surface-variant hover:bg-surface-bright'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="text-xs px-3 py-2 rounded-xl bg-surface-container-high text-on-surface-variant border-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
          </select>

          {/* Service filter */}
          <select
            value={serviceFilter}
            onChange={(e) => setServiceFilter(e.target.value as ServiceFilter)}
            className="text-xs px-3 py-2 rounded-xl bg-surface-container-high text-on-surface-variant border-none focus:ring-1 focus:ring-primary"
          >
            <option value="all">All Services</option>
            <option value="web">Web Services</option>
            <option value="industrial">Industrial</option>
          </select>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant/30" />
            <input
              type="text"
              placeholder="Search IP or hostname..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-xl bg-surface-container-high text-on-surface placeholder:text-on-surface-variant/30 border-none focus:ring-1 focus:ring-primary"
            />
          </div>
          {onExportAll && (
            <button
              onClick={onExportAll}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-surface-container-high text-on-surface-variant hover:bg-surface-bright transition"
            >
              <Download className="w-3.5 h-3.5" />
              Export
            </button>
          )}
        </div>
      </div>

      {/* Results count */}
      <p className="text-xs text-on-surface-variant/40">
        {filtered.length} of {endpoints.length} host{endpoints.length !== 1 ? 's' : ''}
        {searchQuery && ` matching "${searchQuery}"`}
      </p>

      {/* Card View */}
      {viewMode === 'card' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {filtered.map((ep) => (
            <HostCard key={ep.id} endpoint={ep} />
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <div className="bg-surface-container-low rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-outline-variant/10">
                <SortableHeader
                  label="Host IP"
                  field="ip"
                  activeField={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <th className="text-left px-4 py-3 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-wider">
                  Hostname
                </th>
                <th className="text-left px-4 py-3 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-wider">
                  Status
                </th>
                <SortableHeader
                  label="Latency"
                  field="latency"
                  activeField={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <SortableHeader
                  label="Open Ports"
                  field="ports"
                  activeField={sortField}
                  dir={sortDir}
                  onSort={toggleSort}
                />
                <th className="text-left px-4 py-3 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-wider">
                  Services
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {filtered.map((ep) => (
                <HostTableRow key={ep.id} endpoint={ep} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ─── Sub-components ─── */

function SortableHeader({
  label,
  field,
  activeField,
  dir,
  onSort,
}: {
  label: string;
  field: SortField;
  activeField: SortField;
  dir: SortDir;
  onSort: (f: SortField) => void;
}) {
  const isActive = activeField === field;
  return (
    <th className="text-left px-4 py-3">
      <button
        onClick={() => onSort(field)}
        className="inline-flex items-center gap-1 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-wider hover:text-on-surface-variant transition"
      >
        {label}
        <ArrowUpDown className={`w-3 h-3 ${isActive ? 'text-primary' : 'text-on-surface-variant/20'}`} />
      </button>
    </th>
  );
}

function HostCard({ endpoint }: { endpoint: Endpoint }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="bg-surface-container-low rounded-xl p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${endpoint.isActive ? 'bg-tertiary' : 'bg-on-surface-variant/30'}`} />
            <span className="font-technical text-sm font-bold text-on-surface">
              {endpoint.ipAddress}
            </span>
          </div>
          {endpoint.hostname && (
            <p className="text-xs text-on-surface-variant/40 mt-0.5 ml-4">
              {endpoint.hostname}
            </p>
          )}
        </div>
        {endpoint.latency !== undefined && (
          <span className="text-xs font-technical px-2 py-0.5 rounded-lg bg-surface-container-high text-on-surface-variant">
            {endpoint.latency}ms
          </span>
        )}
      </div>

      {endpoint.macAddress && (
        <p className="text-xs font-technical text-on-surface-variant/30 mb-2">
          {endpoint.macAddress}
          {endpoint.vendor && (
            <span className="ml-2">({endpoint.vendor})</span>
          )}
        </p>
      )}

      {/* Port badges */}
      {endpoint.services.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {endpoint.services.slice(0, expanded ? undefined : 6).map((svc) => (
            <span
              key={svc.id}
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-technical ${
                svc.tunnelType === 'browser'
                  ? 'bg-tertiary/10 text-tertiary'
                  : svc.tunnelType === 'local'
                    ? 'bg-primary/10 text-primary'
                    : 'bg-surface-container-high text-on-surface-variant'
              }`}
            >
              {svc.port}
              {svc.serviceName && (
                <span className="font-body text-[10px] opacity-75">
                  {svc.serviceName}
                </span>
              )}
            </span>
          ))}
          {!expanded && endpoint.services.length > 6 && (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-primary hover:underline"
            >
              +{endpoint.services.length - 6} more
            </button>
          )}
        </div>
      )}

      {endpoint.services.length > 6 && expanded && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-primary hover:underline mb-2"
        >
          Show less
        </button>
      )}

      <div className="text-xs text-on-surface-variant/30">
        {endpoint.services.length} service{endpoint.services.length !== 1 ? 's' : ''}
      </div>
    </div>
  );
}

function HostTableRow({ endpoint }: { endpoint: Endpoint }) {
  return (
    <tr className="hover:bg-surface-container transition">
      <td className="px-4 py-3 font-technical text-sm text-on-surface">
        {endpoint.ipAddress}
      </td>
      <td className="px-4 py-3 text-sm text-on-surface-variant">
        {endpoint.hostname || '--'}
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${endpoint.isActive ? 'bg-tertiary' : 'bg-on-surface-variant/30'}`} />
          <span className="text-xs text-on-surface-variant">
            {endpoint.isActive ? 'Online' : 'Offline'}
          </span>
        </span>
      </td>
      <td className="px-4 py-3 font-technical text-xs text-on-surface-variant">
        {endpoint.latency !== undefined ? `${endpoint.latency}ms` : '--'}
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center px-2 py-0.5 rounded-lg text-xs font-medium bg-surface-container-high text-on-surface-variant">
          {endpoint.services.length}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-on-surface-variant">
        {endpoint.services
          .map((s) => s.serviceName || `port ${s.port}`)
          .slice(0, 4)
          .join(', ')}
        {endpoint.services.length > 4 && ` +${endpoint.services.length - 4}`}
      </td>
    </tr>
  );
}
