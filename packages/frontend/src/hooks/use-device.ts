import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDevice(deviceId: string) {
  return useQuery({
    queryKey: ['device', deviceId],
    queryFn: () => api.get<{ success: boolean; data: any; meta?: any }>(`/devices/${deviceId}`),
    enabled: !!deviceId,
  });
}

export function useDevices(params?: { search?: string; page?: number; limit?: number; status?: string }) {
  return useQuery({
    queryKey: ['devices', params],
    queryFn: () => {
      const searchParams = new URLSearchParams();
      if (params?.search) searchParams.set('search', params.search);
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.limit) searchParams.set('limit', String(params.limit));
      if (params?.status) searchParams.set('status', params.status);
      return api.get<{ success: boolean; data: any; meta?: any }>(`/devices?${searchParams.toString()}`);
    },
  });
}

export function useDeviceAdapters(deviceId: string) {
  return useQuery({
    queryKey: ['device-adapters', deviceId],
    queryFn: () => api.get<{ success: boolean; data: any; meta?: any }>(`/devices/${deviceId}/adapters`),
    enabled: !!deviceId,
  });
}

export function useDeviceEndpoints(deviceId: string) {
  return useQuery({
    queryKey: ['device-endpoints', deviceId],
    queryFn: () => api.get<{ success: boolean; data: any; meta?: any }>(`/devices/${deviceId}/endpoints`),
    enabled: !!deviceId,
    refetchInterval: 3000,
  });
}

export function useAdapterEndpoints(deviceId: string, adapterId: string) {
  return useQuery({
    queryKey: ['adapter-endpoints', deviceId, adapterId],
    queryFn: () => api.get(`/devices/${deviceId}/adapters/${adapterId}/endpoints`),
    enabled: !!deviceId && !!adapterId,
  });
}

/** Device system metrics (CPU, RAM, disk, signal, uptime) — refreshes every 5s */
export function useDeviceMetrics(deviceId: string) {
  return useQuery({
    queryKey: ['device-metrics', deviceId],
    queryFn: () => api.get<{ success: boolean; data: any }>(`/devices/${deviceId}/metrics`),
    enabled: !!deviceId,
    refetchInterval: 5000,
  });
}

/** Run endpoint health check — verifies reachability of discovered IPs */
export function useEndpointHealthCheck(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ success: boolean; data: any }>(`/devices/${deviceId}/endpoints/health-check`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device-endpoints', deviceId] });
    },
  });
}

/** Force agent to send fresh heartbeat + adapter data */
export function useSyncDevice(deviceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post(`/devices/${deviceId}/sync`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['device-adapters', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['device-metrics', deviceId] });
      queryClient.invalidateQueries({ queryKey: ['device-endpoints', deviceId] });
    },
  });
}
