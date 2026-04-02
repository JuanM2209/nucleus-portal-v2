'use client';

import { useState, useMemo } from 'react';
import { Search, ChevronRight, Cpu, Clock } from 'lucide-react';
import Link from 'next/link';
import { useDevices } from '@/hooks/use-device';
import { useOrganizations, useOrgDevices } from '@/hooks/use-admin';
import { StatusBadge } from '@/components/device/status-badge';
import { formatRelativeTime } from '@/lib/format';

interface OrgInfo {
  readonly id: string;
  readonly name: string;
}

function useDeviceOrgsMap(orgs: readonly OrgInfo[]) {
  const org0 = useOrgDevices(orgs[0]?.id ?? '');
  const org1 = useOrgDevices(orgs[1]?.id ?? '');
  const org2 = useOrgDevices(orgs[2]?.id ?? '');
  const org3 = useOrgDevices(orgs[3]?.id ?? '');
  const org4 = useOrgDevices(orgs[4]?.id ?? '');

  return useMemo(() => {
    const map = new Map<string, Array<{ orgId: string; orgName: string }>>();
    const queries = [org0, org1, org2, org3, org4];
    for (let i = 0; i < Math.min(orgs.length, 5); i++) {
      const orgDevs = queries[i].data?.data ?? [];
      if (Array.isArray(orgDevs)) {
        orgDevs.forEach((d: any) => {
          const existing = map.get(d.id) ?? [];
          map.set(d.id, [...existing, { orgId: orgs[i].id, orgName: orgs[i].name }]);
        });
      }
    }
    return map;
  }, [orgs, org0.data, org1.data, org2.data, org3.data, org4.data]);
}

export default function DevicesPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useDevices({ search, page, limit });
  const { data: orgsData } = useOrganizations();
  const orgs: readonly OrgInfo[] = (orgsData?.data ?? []).map((o: any) => ({ id: o.id, name: o.name }));
  const deviceOrgsMap = useDeviceOrgsMap(orgs);

  const devices = data?.data ?? [];
  const total = data?.meta?.total ?? 0;
  const totalPages = Math.ceil(total / limit);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Nucleus</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            {total} device{total !== 1 ? 's' : ''} in your nucleus
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Search by name, serial number..."
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:ring-2 focus:ring-brand-500 outline-none transition"
        />
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-500 dark:text-gray-400">Loading devices...</span>
            </div>
          </div>
        ) : devices.length === 0 ? (
          <div className="p-12 text-center">
            <Cpu className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">
              {search ? 'No devices match your search.' : 'No devices registered yet.'}
            </p>
          </div>
        ) : (
          <>
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-800">
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Device
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Agent
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Status
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    Last Seen
                  </th>
                  <th className="text-left px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider">
                    ORG
                  </th>
                  <th className="px-6 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-800">
                {devices.map((device: any) => {
                  const assignedOrgs = deviceOrgsMap.get(device.id) ?? [];
                  return (
                    <tr
                      key={device.id}
                      className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition"
                    >
                      <td className="px-6 py-4">
                        <span className="font-medium text-gray-900 dark:text-white">
                          {(device.name || device.serialNumber).replace(/^Nucleus\s+/i, '')}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400 font-mono">
                        {device.agentVersion ?? 'N/A'}
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={device.status} />
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 dark:text-gray-400">
                        {device.lastSeenAt ? (
                          <span className="flex items-center gap-1.5">
                            <Clock className="w-3.5 h-3.5" />
                            {formatRelativeTime(device.lastSeenAt)}
                          </span>
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          {assignedOrgs.length === 0 ? (
                            <span className="text-xs text-gray-400 italic">Unassigned</span>
                          ) : (
                            assignedOrgs.map((o) => (
                              <span
                                key={o.orgId}
                                className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-blue-500/10 text-blue-400 dark:bg-blue-500/10 dark:text-blue-400"
                              >
                                {o.orgName}
                              </span>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link
                          href={`/devices/${device.id}`}
                          className="text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 text-sm font-medium transition"
                        >
                          View <ChevronRight className="w-4 h-4" />
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-6 py-3 border-t border-gray-200 dark:border-gray-800">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Showing {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page <= 1}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Previous
                  </button>
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page >= totalPages}
                    className="px-3 py-1.5 text-sm font-medium rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
