import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [devices, sessions, health, orgs, logs] = await Promise.all([
        api.get<any>('/devices?limit=1&status=all'),
        api.get<any>('/sessions'),
        api.get<any>('/health'),
        api.get<any>('/orgs').catch(() => ({ data: [] })),
        api.get<any>('/logs?limit=1').catch(() => ({ data: [], total: 0 })),
      ]);
      return { devices, sessions, health, orgs, logs };
    },
    refetchInterval: 30000,
  });
}

export function useDeviceStats() {
  return useQuery({
    queryKey: ['device-stats'],
    queryFn: async () => {
      const [online, offline] = await Promise.all([
        api.get<any>('/devices?limit=1&status=online'),
        api.get<any>('/devices?limit=1&status=offline'),
      ]);
      return {
        online: online?.meta?.total || 0,
        offline: offline?.meta?.total || 0,
      };
    },
    refetchInterval: 30000,
  });
}
