import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** Current user's sessions (legacy — still used by device detail pages) */
export function useSessions(includeHistory = false) {
  return useQuery({
    queryKey: ['sessions', { history: includeHistory }],
    queryFn: () => api.get<any>(`/sessions${includeHistory ? '?history=true' : ''}`),
    refetchInterval: 15000,
  });
}

/** ALL active sessions across all users in the tenant — for Sessions page */
export function useAllSessions() {
  return useQuery({
    queryKey: ['sessions', 'all'],
    queryFn: () => api.get<any>('/sessions/all'),
    refetchInterval: 15000,
  });
}

/** Full session history (audit trail) — paginated, filterable */
export function useSessionHistory(params: {
  page?: number;
  limit?: number;
  deviceId?: string;
  userId?: string;
  tunnelType?: string;
  status?: string;
}) {
  const searchParams = new URLSearchParams();
  if (params.page) searchParams.set('page', String(params.page));
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.deviceId) searchParams.set('deviceId', params.deviceId);
  if (params.userId) searchParams.set('userId', params.userId);
  if (params.tunnelType) searchParams.set('tunnelType', params.tunnelType);
  if (params.status) searchParams.set('status', params.status);
  const qs = searchParams.toString();
  return useQuery({
    queryKey: ['sessions', 'history', params],
    queryFn: () => api.get<any>(`/sessions/history${qs ? `?${qs}` : ''}`),
    refetchInterval: 30000,
  });
}

export function useCreateSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      deviceId: string;
      targetIp: string;
      targetPort: number;
      tunnelType: 'browser' | 'local';
      durationMinutes?: number;
    }) => api.post('/sessions', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useExtendSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      api.post(`/sessions/${sessionId}/extend`, { additionalMinutes: minutes }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.delete(`/sessions/${sessionId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
  });
}
