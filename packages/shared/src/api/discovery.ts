import { z } from 'zod';
import { TunnelTypeSchema } from './tunnels';

export const AdapterModeSchema = z.enum(['static', 'dhcp', 'both']);
export type AdapterMode = z.infer<typeof AdapterModeSchema>;

export const DeviceAdapterSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  name: z.string(),
  macAddress: z.string().nullable(),
  ipAddress: z.string().nullable(),
  subnetMask: z.string().nullable(),
  gateway: z.string().nullable(),
  mode: AdapterModeSchema.nullable(),
  isUp: z.boolean(),
  updatedAt: z.string().datetime(),
});
export type DeviceAdapter = z.infer<typeof DeviceAdapterSchema>;

export const DiscoveredEndpointSchema = z.object({
  id: z.string().uuid(),
  deviceId: z.string().uuid(),
  adapterId: z.string().uuid(),
  ipAddress: z.string(),
  macAddress: z.string().nullable(),
  hostname: z.string().nullable(),
  vendor: z.string().nullable(),
  firstSeenAt: z.string().datetime(),
  lastSeenAt: z.string().datetime(),
  isActive: z.boolean(),
  services: z.array(z.object({
    id: z.string().uuid(),
    port: z.number(),
    protocol: z.enum(['tcp', 'udp']),
    serviceName: z.string().nullable(),
    serviceVersion: z.string().nullable(),
    banner: z.string().nullable(),
    tunnelType: TunnelTypeSchema.nullable(),
    lastScannedAt: z.string().datetime(),
  })),
});
export type DiscoveredEndpoint = z.infer<typeof DiscoveredEndpointSchema>;

export const TriggerDiscoveryRequestSchema = z.object({
  adapterId: z.string().uuid().optional(),
  scanType: z.enum(['passive', 'active', 'full']).default('passive'),
});
export type TriggerDiscoveryRequest = z.infer<typeof TriggerDiscoveryRequestSchema>;
