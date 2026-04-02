'use client';

import { useState } from 'react';
import {
  ShieldCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { useAuditLogs } from '@/hooks/use-logs';

const ACTION_BADGE_STYLES: Record<string, string> = {
  'user.login': 'bg-primary/10 text-primary',
  'user.logout': 'bg-primary/10 text-primary',
  'session.create': 'bg-tertiary/10 text-tertiary',
  'session.close': 'bg-[#f59e0b]/10 text-[#f59e0b]',
  'device.create': 'bg-[#8b5cf6]/10 text-[#8b5cf6]',
  'device.update': 'bg-[#8b5cf6]/10 text-[#8b5cf6]',
  'org.create': 'bg-error/10 text-error',
  'org.update': 'bg-error/10 text-error',
  'org.delete': 'bg-error/10 text-error',
};

const PAGE_SIZE = 25;

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');

  const { data, isLoading, isError, error } = useAuditLogs({
    page,
    limit: PAGE_SIZE,
    action: actionFilter || undefined,
  });

  const events: readonly any[] = data?.data ?? [];
  const totalCount = data?.meta?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

  return (
    <div className="min-h-full pb-12">
      {/* Header */}
      <div className="pt-8 pb-6 px-2">
        <h1 className="font-headline text-3xl font-extrabold text-on-surface tracking-tight flex items-center gap-3">
          <ShieldCheck className="w-8 h-8 text-primary" />
          Audit Log
        </h1>
        <p className="text-on-surface-variant mt-1">
          Immutable record of security-relevant actions across the platform.
        </p>
      </div>

      <div className="px-2 space-y-4">
        {/* Filter Bar */}
        <div className="flex items-center gap-3">
          <div className="relative">
            <select
              value={actionFilter || 'All'}
              onChange={(e) => {
                setActionFilter(e.target.value === 'All' ? '' : e.target.value);
                setPage(1);
              }}
              className="bg-surface-container-highest rounded-xl pl-3 pr-8 py-2 text-xs text-on-surface font-body focus:outline-none focus:ring-2 focus:ring-primary/40 appearance-none"
            >
              <option value="All">Action: All</option>
              <option value="user.login">User Login</option>
              <option value="user.logout">User Logout</option>
              <option value="session.create">Session Create</option>
              <option value="session.close">Session Close</option>
              <option value="device.create">Device Create</option>
              <option value="device.update">Device Update</option>
              <option value="org.create">Org Create</option>
              <option value="org.update">Org Update</option>
              <option value="org.delete">Org Delete</option>
            </select>
            <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-on-surface-variant pointer-events-none" />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="bg-surface-container-low rounded-xl p-12 flex items-center justify-center gap-3 text-on-surface-variant">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Loading audit events...</span>
          </div>
        )}

        {/* Error */}
        {isError && (
          <div className="bg-error/5 border border-error/20 rounded-xl p-6 flex items-center gap-3 text-error">
            <AlertTriangle className="w-5 h-5 flex-shrink-0" />
            <span className="text-sm">Failed to load audit log: {(error as Error)?.message ?? 'Unknown error'}</span>
          </div>
        )}

        {/* Empty */}
        {!isLoading && !isError && events.length === 0 && (
          <div className="bg-surface-container-low rounded-xl p-12 text-center">
            <ShieldCheck className="w-10 h-10 text-on-surface-variant/30 mx-auto mb-4" />
            <h3 className="font-headline font-bold text-on-surface mb-2">No audit events</h3>
            <p className="text-sm text-on-surface-variant">
              Security-relevant actions will appear here as they occur.
            </p>
          </div>
        )}

        {/* Table */}
        {!isLoading && !isError && events.length > 0 && (
          <div className="bg-surface-container-low rounded-xl overflow-hidden">
            <div className="grid grid-cols-[160px_160px_1fr_1fr_120px] gap-4 px-6 py-3 text-xs font-technical text-on-surface-variant/60 uppercase tracking-wider">
              <span>Time</span>
              <span>Action</span>
              <span>Resource</span>
              <span>User</span>
              <span>IP Address</span>
            </div>

            {events.map((event: any) => (
              <div
                key={event.id}
                className="grid grid-cols-[160px_160px_1fr_1fr_120px] gap-4 px-6 py-3.5 text-sm hover:bg-surface-container-high transition-colors items-center"
              >
                <span className="font-technical text-on-surface-variant text-xs">
                  {new Date(event.createdAt ?? event.timestamp).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                  })}
                </span>
                <span>
                  <span className={`inline-flex text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-full whitespace-nowrap ${
                    ACTION_BADGE_STYLES[event.action] ?? 'bg-surface-container-highest text-on-surface-variant'
                  }`}>
                    {event.action}
                  </span>
                </span>
                <span className="text-on-surface-variant text-xs font-technical truncate">
                  {event.resourceType ?? event.resource ?? '--'}
                  {event.resourceId ? ` / ${event.resourceId}` : ''}
                </span>
                <span className="text-on-surface text-xs truncate">
                  {event.userName ?? event.userId ?? '--'}
                </span>
                <span className="font-technical text-on-surface-variant text-xs">
                  {event.ipAddress ?? '--'}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {!isLoading && !isError && totalCount > PAGE_SIZE && (
          <div className="flex items-center justify-between">
            <span className="text-xs text-on-surface-variant font-technical">
              Showing {(page - 1) * PAGE_SIZE + 1}-{Math.min(page * PAGE_SIZE, totalCount)} of{' '}
              {totalCount} events
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
