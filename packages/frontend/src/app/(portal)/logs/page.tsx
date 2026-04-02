'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Search,
  Download,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Filter,
  Loader2,
  AlertTriangle,
  Clock,
  User,
  Monitor,
  Building2,
  Globe,
  Wifi,
  FileSpreadsheet,
  FileJson,
  FileText,
  FileDown,
} from 'lucide-react';
import { useActivityLogs } from '@/hooks/use-logs';

const ACTION_BADGE_STYLES: Record<string, string> = {
  'user.login': 'bg-primary/10 text-primary',
  'user.logout': 'bg-primary/10 text-primary',
  'session.open': 'bg-tertiary/10 text-tertiary',
  'session.export': 'bg-[#06b6d4]/10 text-[#06b6d4]',
  'session.close': 'bg-[#f59e0b]/10 text-[#f59e0b]',
  'session.extend': 'bg-[#f59e0b]/10 text-[#f59e0b]',
  'session.expire': 'bg-error/10 text-error',
  'device.register': 'bg-[#8b5cf6]/10 text-[#8b5cf6]',
  'device.update': 'bg-[#8b5cf6]/10 text-[#8b5cf6]',
  'device.scan': 'bg-[#8b5cf6]/10 text-[#8b5cf6]',
  'device.delete': 'bg-error/10 text-error',
  'discovery.trigger': 'bg-[#06b6d4]/10 text-[#06b6d4]',
  'discovery.complete': 'bg-[#06b6d4]/10 text-[#06b6d4]',
  'admin.create_org': 'bg-error/10 text-error',
  'admin.update_user': 'bg-error/10 text-error',
  'admin.deactivate': 'bg-error/10 text-error',
};

const ACTION_LABELS: Record<string, string> = {
  'user.login': 'Login',
  'user.logout': 'Logout',
  'session.open': 'Session Open',
  'session.export': 'Session Export',
  'session.close': 'Session Close',
  'session.extend': 'Session Extend',
  'session.expire': 'Session Expired',
  'device.register': 'Device Register',
  'device.update': 'Device Update',
  'device.scan': 'Device Scan',
  'device.delete': 'Device Delete',
  'discovery.trigger': 'Discovery',
  'discovery.complete': 'Discovery Done',
  'admin.create_org': 'Create Org',
  'admin.update_user': 'Update User',
  'admin.deactivate': 'Deactivate',
};

const ACTION_TYPE_OPTIONS = [
  'user.login',
  'user.logout',
  'session.open',
  'session.close',
  'session.extend',
  'session.expire',
  'device.register',
  'device.update',
  'device.scan',
  'discovery.trigger',
  'admin.create_org',
  'admin.update_user',
  'admin.deactivate',
];

const PAGE_SIZE = 25;

export default function LogsPage() {
  const [actionFilter, setActionFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const { data, isLoading, isError, error, isFetching } = useActivityLogs({
    page,
    limit: PAGE_SIZE,
    action: actionFilter || undefined,
  });

  const logs: readonly any[] = data?.data ?? [];
  const totalCount = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  const filteredLogs = searchQuery
    ? logs.filter((log: any) => {
        const q = searchQuery.toLowerCase();
        return (
          (log.userName ?? '').toLowerCase().includes(q) ||
          (log.userEmail ?? '').toLowerCase().includes(q) ||
          (log.deviceName ?? '').toLowerCase().includes(q) ||
          (log.orgName ?? '').toLowerCase().includes(q) ||
          (log.action ?? '').toLowerCase().includes(q) ||
          (log.ipAddress ?? '').includes(q) ||
          JSON.stringify(log.details ?? '').toLowerCase().includes(q)
        );
      })
    : logs;

  const getExportData = useCallback(() => {
    const headers = ['Timestamp', 'User', 'Email', 'Device', 'Organization', 'Action', 'Resource', 'IP Address', 'Details'];
    const rows = filteredLogs.map((log: any) => [
      log.createdAt ?? '',
      log.userName ?? 'System',
      log.userEmail ?? '',
      (log.deviceName ?? log.deviceSerial ?? '').replace(/^Nucleus\s+/i, ''),
      log.orgName ?? '',
      log.action ?? '',
      log.resourceType ?? '',
      log.ipAddress ?? '',
      typeof log.details === 'object' ? JSON.stringify(log.details) : log.details ?? '',
    ]);
    return { headers, rows };
  }, [filteredLogs]);

  const dateStr = new Date().toISOString().slice(0, 10);

  const handleExport = useCallback(async (format: 'csv' | 'json' | 'excel' | 'pdf') => {
    const { headers, rows } = getExportData();
    const filename = `activity-logs-${dateStr}`;

    if (format === 'csv') {
      const csv = [headers, ...rows].map((row) => row.map((v: string) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
      downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
    }

    if (format === 'json') {
      const jsonData = filteredLogs.map((log: any) => ({
        timestamp: log.createdAt,
        user: log.userName ?? 'System',
        email: log.userEmail ?? '',
        device: (log.deviceName ?? log.deviceSerial ?? '').replace(/^Nucleus\s+/i, ''),
        organization: log.orgName ?? '',
        action: log.action,
        resource: log.resourceType ?? '',
        ipAddress: log.ipAddress ?? '',
        details: log.details ?? {},
        ids: { userId: log.userId, deviceId: log.deviceId, orgId: log.orgId, resourceId: log.resourceId },
      }));
      const json = JSON.stringify(jsonData, null, 2);
      downloadBlob(new Blob([json], { type: 'application/json' }), `${filename}.json`);
    }

    if (format === 'excel') {
      const XLSX = await import('xlsx');
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      // Auto-size columns
      ws['!cols'] = headers.map((h, i) => ({
        wch: Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length).slice(0, 50), 10),
      }));
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Activity Logs');
      XLSX.writeFile(wb, `${filename}.xlsx`);
    }

    if (format === 'pdf') {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

      // Title
      doc.setFontSize(16);
      doc.setTextColor(40);
      doc.text('Activity Logs', 14, 15);
      doc.setFontSize(9);
      doc.setTextColor(120);
      doc.text(`Exported ${new Date().toLocaleString()} — ${rows.length} entries`, 14, 21);

      // Table
      autoTable(doc, {
        head: [headers],
        body: rows.map((r) => r.map((v: string) => String(v).slice(0, 60))),
        startY: 26,
        styles: { fontSize: 7, cellPadding: 2 },
        headStyles: { fillColor: [59, 130, 246], textColor: 255, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        margin: { left: 10, right: 10 },
      });

      doc.save(`${filename}.pdf`);
    }
  }, [getExportData, filteredLogs, dateStr]);

  return (
    <div className="min-h-full pb-12">
      {/* Header */}
      <div className="pt-8 pb-6 px-2">
        <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight">
          Activity Logs
        </h1>
        <p className="text-on-surface-variant mt-1">
          Monitor and audit all system activity across your organizations.
        </p>
      </div>

      <div className="px-2 space-y-4">
        {/* Filter Bar */}
        <div className="bg-surface-container-low rounded-xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Filter className="w-4 h-4 text-on-surface-variant/60" />
            <span className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
              Filters
            </span>
            {isFetching && !isLoading && (
              <Loader2 className="w-3 h-3 animate-spin text-primary ml-2" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-outline-variant" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by user, device, org, IP..."
                className="w-full bg-surface-container-highest rounded-xl pl-10 pr-4 py-2 text-sm text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 placeholder:text-outline-variant"
              />
            </div>
            <FilterSelect
              label="Action"
              value={actionFilter || 'All'}
              options={['All', ...ACTION_TYPE_OPTIONS]}
              onChange={(v) => {
                setActionFilter(v === 'All' ? '' : v);
                setPage(1);
              }}
            />
            <ExportDropdown
              disabled={filteredLogs.length === 0}
              onExport={handleExport}
            />
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="bg-surface-container-low rounded-xl p-12 flex items-center justify-center gap-3 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading activity logs...</span>
          </div>
        )}

        {/* Error State */}
        {isError && (
          <div className="bg-error/5 border border-error/20 rounded-xl p-6 flex items-center gap-3 text-error">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">Failed to load logs: {(error as Error)?.message ?? 'Unknown error'}</span>
          </div>
        )}

        {/* Log Table */}
        {!isLoading && !isError && (
          <div className="bg-surface-container-low rounded-xl overflow-hidden">
            <div className="grid grid-cols-[130px_1fr_0.8fr_0.9fr_130px_120px_90px] gap-3 px-5 py-3 text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider border-b border-outline-variant/10">
              <span>Time</span>
              <span>User</span>
              <span>Device</span>
              <span>Org</span>
              <span>Action</span>
              <span>Target</span>
              <span>Resource</span>
            </div>

            {filteredLogs.map((log: any) => {
              const details = typeof log.details === 'object' ? log.details : {};
              const port = details?.port ?? details?.targetPort ?? details?.localPort ?? null;

              return (
                <div key={log.id}>
                  <button
                    onClick={() => setExpandedLogId((prev) => (prev === log.id ? null : log.id))}
                    className="grid grid-cols-[130px_1fr_0.8fr_0.9fr_130px_120px_90px] gap-3 px-5 py-3 w-full text-left text-sm hover:bg-surface-container-high transition-colors items-center"
                  >
                    {/* Time */}
                    <span className="font-technical text-on-surface-variant text-xs flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-on-surface-variant/40 flex-shrink-0" />
                      {formatTimestamp(log.createdAt)}
                    </span>

                    {/* User */}
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-[10px] font-bold text-primary flex-shrink-0">
                        {(log.userName ?? log.userEmail ?? '?')[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <span className="text-on-surface text-xs font-medium block truncate">
                          {log.userName ?? 'System'}
                        </span>
                        {log.userEmail && (
                          <span className="text-on-surface-variant/50 text-[10px] font-technical block truncate">
                            {log.userEmail}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Device */}
                    <div className="flex items-center gap-1.5 min-w-0">
                      {(log.deviceName || log.deviceSerial) ? (
                        <>
                          <Monitor className="w-3.5 h-3.5 text-on-surface-variant/40 flex-shrink-0" />
                          <span className="text-on-surface text-xs font-medium truncate">
                            {(log.deviceName ?? log.deviceSerial ?? '').replace(/^Nucleus\s+/i, '')}
                          </span>
                        </>
                      ) : (
                        <span className="text-on-surface-variant/30 text-xs">--</span>
                      )}
                    </div>

                    {/* Organization (resolved from device → org_devices) */}
                    <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                      {(log.deviceOrgs && log.deviceOrgs.length > 0) ? (
                        <span className="text-on-surface-variant text-[11px] truncate" title={log.deviceOrgs.map((o: any) => o.name).join(', ')}>
                          {log.deviceOrgs.map((o: any) => o.name).join(' · ')}
                        </span>
                      ) : log.orgName ? (
                        <span className="text-on-surface-variant text-[11px] truncate">{log.orgName}</span>
                      ) : (
                        <span className="text-on-surface-variant/30 text-xs">--</span>
                      )}
                    </div>

                    {/* Action */}
                    <ActionBadge action={log.action} />

                    {/* Target IP:Port */}
                    <div className="font-technical text-[11px] min-w-0">
                      {(details?.targetIp || details?.targetPort) ? (
                        <span className="text-on-surface-variant flex items-center gap-1">
                          <Globe className="w-3 h-3 text-on-surface-variant/40 flex-shrink-0" />
                          <span className="truncate">
                            {details.targetIp === '127.0.0.1' || details.targetIp === 'localhost'
                              ? 'localhost'
                              : details.targetIp ?? ''}
                            {details.targetPort ? `:${details.targetPort}` : ''}
                          </span>
                        </span>
                      ) : log.ipAddress ? (
                        <span className="text-on-surface-variant">{log.ipAddress}</span>
                      ) : (
                        <span className="text-on-surface-variant/30">--</span>
                      )}
                    </div>

                    {/* Resource */}
                    <span className="font-technical text-on-surface-variant text-[11px] truncate">
                      {log.resourceType ?? '--'}
                    </span>
                  </button>

                  {/* Expanded Details */}
                  {expandedLogId === log.id && (
                    <div className="px-5 pb-3">
                      <div className="bg-surface-container-high rounded-xl p-4 ml-4 space-y-3">
                        <p className="text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
                          Full Details
                        </p>

                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <DetailItem label="User ID" value={log.userId} />
                          <DetailItem label="Device ID" value={log.deviceId} />
                          <DetailItem label="Org ID" value={log.orgId} />
                          <DetailItem label="Resource ID" value={log.resourceId} />
                          {port && <DetailItem label="Port" value={String(port)} icon={<Wifi className="w-3 h-3" />} />}
                          {details?.targetIp && <DetailItem label="Target IP" value={details.targetIp} icon={<Globe className="w-3 h-3" />} />}
                          {details?.tunnelType && <DetailItem label="Tunnel Type" value={details.tunnelType} />}
                          {details?.proxyUrl && <DetailItem label="Proxy URL" value={details.proxyUrl} />}
                        </div>

                        {Object.keys(details).length > 0 && (
                          <div>
                            <p className="text-[10px] font-technical text-on-surface-variant/50 uppercase tracking-wider mb-1">
                              Raw Details
                            </p>
                            <pre className="bg-surface-container-lowest rounded-lg p-3 text-[11px] font-technical text-on-surface-variant overflow-x-auto">
                              {JSON.stringify(details, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {filteredLogs.length === 0 && (
              <div className="px-6 py-12 text-center text-on-surface-variant">
                {logs.length === 0 ? 'No log entries found.' : 'No log entries match your search.'}
              </div>
            )}
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !isError && totalCount > 0 && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant font-technical">
              Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, totalCount)} of{' '}
              {totalCount} entries
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-2 rounded-xl hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronLeft className="w-4 h-4 text-on-surface-variant" />
              </button>
              {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => {
                let pageNum: number;
                if (totalPages <= 7) {
                  pageNum = i + 1;
                } else if (page <= 4) {
                  pageNum = i + 1;
                } else if (page >= totalPages - 3) {
                  pageNum = totalPages - 6 + i;
                } else {
                  pageNum = page - 3 + i;
                }
                return (
                  <button
                    key={pageNum}
                    onClick={() => setPage(pageNum)}
                    className={`w-8 h-8 rounded-xl text-xs font-medium transition-colors ${
                      pageNum === page
                        ? 'bg-primary/20 text-primary'
                        : 'text-on-surface-variant hover:bg-surface-container-high'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-2 rounded-xl hover:bg-surface-container-high transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ChevronRight className="w-4 h-4 text-on-surface-variant" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ─── */

function DetailItem({
  label,
  value,
  icon,
}: {
  readonly label: string;
  readonly value: string | null | undefined;
  readonly icon?: React.ReactNode;
}) {
  if (!value) return null;
  return (
    <div className="bg-surface-container-lowest rounded-lg px-3 py-2">
      <p className="text-[10px] font-technical text-on-surface-variant/50 uppercase tracking-wider mb-0.5">
        {label}
      </p>
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-on-surface-variant/40">{icon}</span>}
        <span className="text-xs font-technical text-on-surface truncate">{value}</span>
      </div>
    </div>
  );
}

function ActionBadge({ action }: { readonly action: string }) {
  const style = ACTION_BADGE_STYLES[action] ?? 'bg-surface-container-highest text-on-surface-variant';
  const label = ACTION_LABELS[action] ?? action;

  return (
    <span className={`inline-flex text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap ${style}`}>
      {label}
    </span>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  readonly label: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-container-highest rounded-xl pl-3 pr-8 py-2 text-xs text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
      >
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {label}: {ACTION_LABELS[opt] ?? opt}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant pointer-events-none" />
    </div>
  );
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return '--';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '--';
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  return `${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const EXPORT_FORMATS = [
  { key: 'csv' as const, label: 'CSV', desc: 'Spreadsheet compatible', icon: FileText },
  { key: 'excel' as const, label: 'Excel (.xlsx)', desc: 'Microsoft Excel', icon: FileSpreadsheet },
  { key: 'json' as const, label: 'JSON', desc: 'Structured data', icon: FileJson },
  { key: 'pdf' as const, label: 'PDF', desc: 'Print-ready report', icon: FileDown },
];

function ExportDropdown({
  disabled,
  onExport,
}: {
  readonly disabled: boolean;
  readonly onExport: (format: 'csv' | 'json' | 'excel' | 'pdf') => void;
}) {
  const [open, setOpen] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleExport(format: 'csv' | 'json' | 'excel' | 'pdf') {
    setExporting(format);
    try {
      await onExport(format);
    } finally {
      setExporting(null);
      setOpen(false);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((p) => !p)}
        disabled={disabled}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors disabled:opacity-40 ${
          open
            ? 'bg-primary/20 text-primary'
            : 'bg-surface-container-highest text-on-surface-variant hover:bg-surface-container-high'
        }`}
      >
        <Download className="w-3.5 h-3.5" />
        Export
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 bg-surface-container-low border border-outline-variant/20 rounded-xl shadow-xl overflow-hidden min-w-[220px]">
          <div className="px-3 py-2 border-b border-outline-variant/10">
            <span className="text-[10px] font-technical text-on-surface-variant/50 uppercase tracking-wider">
              Export Format
            </span>
          </div>
          {EXPORT_FORMATS.map(({ key, label, desc, icon: Icon }) => (
            <button
              key={key}
              onClick={() => handleExport(key)}
              disabled={!!exporting}
              className="flex items-center gap-3 w-full px-3 py-2.5 text-left hover:bg-surface-container-high transition-colors disabled:opacity-50"
            >
              <Icon className="w-4 h-4 text-primary flex-shrink-0" />
              <div className="min-w-0">
                <span className="text-sm text-on-surface font-medium block">{label}</span>
                <span className="text-[10px] text-on-surface-variant/60">{desc}</span>
              </div>
              {exporting === key && <Loader2 className="w-3 h-3 animate-spin text-primary ml-auto" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
