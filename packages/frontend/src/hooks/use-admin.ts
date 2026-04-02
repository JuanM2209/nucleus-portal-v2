import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';

// Organizations
export function useOrganizations() {
  return useQuery({
    queryKey: ['organizations'],
    queryFn: () => api.get<any>('/orgs'),
  });
}

export function useCreateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      api.post('/orgs', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useUpdateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: string; data: any }) =>
      api.patch(`/orgs/${orgId}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

export function useDeactivateOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (orgId: string) => api.delete(`/orgs/${orgId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['organizations'] }),
  });
}

// Org members
export function useOrgMembers(orgId: string) {
  return useQuery({
    queryKey: ['org-members', orgId],
    queryFn: () => api.get<any>(`/orgs/${orgId}/users`),
    enabled: !!orgId,
  });
}

export function useAddOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, data }: { orgId: string; data: { userId: string; role: string } }) =>
      api.post(`/orgs/${orgId}/users`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-members'] });
      qc.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

export function useRemoveOrgMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, userId }: { orgId: string; userId: string }) =>
      api.delete(`/orgs/${orgId}/users/${userId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-members'] });
      qc.invalidateQueries({ queryKey: ['organizations'] });
    },
  });
}

// Org devices
export function useOrgDevices(orgId: string) {
  return useQuery({
    queryKey: ['org-devices', orgId],
    queryFn: () => api.get<any>(`/orgs/${orgId}/devices`),
    enabled: !!orgId,
  });
}

export function useAssignDeviceToOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, deviceId }: { orgId: string; deviceId: string }) =>
      api.post(`/orgs/${orgId}/devices`, { deviceId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['org-devices'] });
    },
  });
}

export function useRemoveDeviceFromOrg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ orgId, deviceId }: { orgId: string; deviceId: string }) =>
      api.delete(`/orgs/${orgId}/devices/${deviceId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['organizations'] });
      qc.invalidateQueries({ queryKey: ['devices'] });
      qc.invalidateQueries({ queryKey: ['org-devices'] });
    },
  });
}
