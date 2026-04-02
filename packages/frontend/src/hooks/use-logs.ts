import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useActivityLogs(params: {
  page?: number;
  limit?: number;
  orgId?: string;
  userId?: string;
  action?: string;
  startDate?: string;
  endDate?: string;
}) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== '') searchParams.set(key, String(val));
  });

  return useQuery({
    queryKey: ['activity-logs', params],
    queryFn: () => api.get<any>(`/logs?${searchParams.toString()}`),
  });
}

export function useLogStats(params: { orgId?: string; startDate?: string; endDate?: string }) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== '') searchParams.set(key, String(val));
  });

  return useQuery({
    queryKey: ['log-stats', params],
    queryFn: () => api.get<any>(`/logs/stats?${searchParams.toString()}`),
  });
}

export function useAuditLogs(params: { page?: number; limit?: number; action?: string }) {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== '') searchParams.set(key, String(val));
  });

  return useQuery({
    queryKey: ['audit-logs', params],
    queryFn: () => api.get<any>(`/audit?${searchParams.toString()}`),
  });
}
