import { z } from 'zod';
import { DeviceListQuerySchema, UpdateDeviceSchema } from '@nucleus/shared';

// Re-export shared schemas for use as validation pipes
export const ListDevicesQuery = DeviceListQuerySchema;
export const UpdateDeviceDto = UpdateDeviceSchema;

export type ListDevicesQueryType = z.infer<typeof ListDevicesQuery>;
export type UpdateDeviceDtoType = z.infer<typeof UpdateDeviceDto>;
