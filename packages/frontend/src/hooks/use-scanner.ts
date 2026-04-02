import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useScanNetwork(deviceId: string, adapterId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scanType: 'quick' | 'standard' | 'deep') =>
      api.post<{ success: boolean; data: any; meta?: any }>(`/devices/${deviceId}/adapters/${adapterId}/scan`, { scanType }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-endpoints', deviceId] });
    },
  });
}

export function useScanStatus(scanId: string | null) {
  return useQuery({
    queryKey: ['scan-status', scanId],
    queryFn: () => api.get<{ success: boolean; data: any; meta?: any }>(`/scans/${scanId}`),
    enabled: !!scanId,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      // Poll every 800ms while scanning for snappier progress bar
      return status === 'running' ? 800 : false;
    },
  });
}

export function useDeviceHealth(deviceId: string) {
  return useQuery({
    queryKey: ['device-health', deviceId],
    queryFn: () => api.get<{ success: boolean; data: any; meta?: any }>(`/devices/${deviceId}/health`),
    enabled: !!deviceId,
    refetchInterval: 30000,
  });
}

export function useRunHealthCheck(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/devices/${deviceId}/health-check`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-health', deviceId] });
    },
  });
}
