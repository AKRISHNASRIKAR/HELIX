import { z } from 'zod';
import { DataSourceStatus, DataSourceType } from '@helix/types';
import { IdSchema, TimestampsSchema } from './common';

export const DataSourceColumnSchema = z.object({
  name: z.string(),
  type: z.string(),
  nullable: z.boolean(),
  description: z.string().optional(),
});

export const DataSourceSchemaSchema = z.object({
  id: IdSchema,
  dataSourceId: IdSchema,
  tableName: z.string(),
  columns: z.array(DataSourceColumnSchema),
  rowCountEstimate: z.number().int().nonnegative().optional(),
  discoveredAt: z.coerce.date(),
});
export type DataSourceSchemaContract = z.infer<typeof DataSourceSchemaSchema>;

export const DataSourceSchema = z
  .object({
    id: IdSchema,
    organizationId: IdSchema,
    name: z.string().min(1),
    type: z.nativeEnum(DataSourceType),
    status: z.nativeEnum(DataSourceStatus),
    /** Connection details minus secrets — credentials live in a secret manager, never here. */
    connectionConfig: z.record(z.string(), z.unknown()),
    lastSyncedAt: z.coerce.date().nullable(),
  })
  .merge(TimestampsSchema);
export type DataSource = z.infer<typeof DataSourceSchema>;
