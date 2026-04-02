import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useSessions() {
  return useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<any>('/sessions'),
    refetchInterval: 15000, // refresh every 15s
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useExtendSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, minutes }: { sessionId: string; minutes: number }) =>
      api.post(`/sessions/${sessionId}/extend`, { additionalMinutes: minutes }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}

export function useCloseSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => api.delete(`/sessions/${sessionId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sessions'] }),
  });
}
