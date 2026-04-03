import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function usePreferences() {
  return useQuery({
    queryKey: ['preferences'],
    queryFn: () => api.get<any>('/settings/preferences'),
  });
}

export function useUpdatePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) => api.patch('/settings/preferences', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['preferences'] }),
  });
}

// ── Pending Devices ──

export function usePendingDevices() {
  return useQuery({
    queryKey: ['devices', 'pending'],
    queryFn: () => api.get<any>('/devices/pending'),
    refetchInterval: 10000, // Poll every 10s for new pending devices
  });
}

export function useApproveDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pendingId: string) => api.post(`/devices/pending/${pendingId}/approve`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices', 'pending'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
    },
  });
}

export function useDenyDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (pendingId: string) => api.post(`/devices/pending/${pendingId}/deny`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['devices', 'pending'] });
    },
  });
}

// ── Approval Policy ──

export function useApprovalPolicy() {
  return useQuery({
    queryKey: ['devices', 'approval-policy'],
    queryFn: () => api.get<any>('/devices/approval-policy'),
  });
}

export function useUpdateApprovalPolicy() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (policy: string) => api.patch('/devices/approval-policy', { policy }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices', 'approval-policy'] }),
  });
}

// ── Scan Settings ──

export function useScanSettings() {
  return useQuery({
    queryKey: ['devices', 'scan-settings'],
    queryFn: () => api.get<any>('/devices/scan-settings'),
  });
}

export function useUpdateScanSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { endpointStaleThresholdSeconds?: number; autoScanIntervalSeconds?: number }) =>
      api.patch('/devices/scan-settings', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['devices', 'scan-settings'] }),
  });
}
