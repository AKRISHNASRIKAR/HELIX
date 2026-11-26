import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { extname } from 'node:path';
import { diskStorage } from 'multer';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { ApiQueries, Tenant, ZodBody, ZodQuery } from '../common/decorators';
import type { TenantContext } from '../common/types';
import { UuidPipe } from '../common/uuid-param.pipe';
import { validateEnv } from '../config/env';
import { TenantScoped } from '../tenant/tenant.guard';
import {
  CreateDataSourceInput,
  CreateDataSourceSchema,
  UpdateDataSourceInput,
  UpdateDataSourceSchema,
} from './data-source-types';
import { DataSourceDetail, DataSourceListItem, DataSourcesService } from './data-sources.service';

const PreviewQuerySchema = z.object({
  table: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
const ProfileQuerySchema = z.object({ table: z.string().min(1) });
const UploadBodySchema = z.object({ name: z.string().trim().min(1).max(200).optional() });

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Multer storage is configured at decoration time, before Nest's DI exists,
 * so the upload dir is read from the same validated env the app boots with.
 */
function uploadStorage() {
  return diskStorage({
    destination: (_req, _file, cb) => {
      try {
        const dir = validateEnv(process.env).HELIX_UPLOAD_DIR;
        mkdirSync(dir, { recursive: true });
        cb(null, dir);
      } catch (err) {
        cb(err as Error, '');
      }
    },
    // uuid file names: the user's original name never touches the filesystem.
    filename: (_req, _file, cb) => cb(null, `${randomUUID()}.csv`),
  });
}

@ApiTags('data-sources')
@TenantScoped()
@Controller('data-sources')
export class DataSourcesController {
  constructor(private readonly dataSources: DataSourcesService) {}

  @Get()
  @ApiOperation({ summary: 'List data sources in the organization' })
  list(@Tenant() t: TenantContext): Promise<DataSourceListItem[]> {
    return this.dataSources.list(t.organizationId);
  }

  @Post()
  @ApiOperation({
    summary: 'Register a POSTGRESQL, MCP or GITHUB data source',
    description:
      '`type` selects the config shape (missing type = POSTGRESQL). Stores credentials ' +
      'encrypted, then attempts a connection. Responds 201 either way; status is CONNECTED ' +
      '(schemas discovered) or ERROR (statusMessage explains why).',
  })
  @Audit({ action: 'data_source.create', resourceType: 'data_source' })
  create(
    @Tenant() t: TenantContext,
    @ZodBody(CreateDataSourceSchema) body: CreateDataSourceInput,
  ): Promise<DataSourceDetail> {
    return this.dataSources.create(t.organizationId, body);
  }

  @Post('upload')
  @ApiOperation({ summary: 'Upload a CSV file as a data source (max 50MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' }, name: { type: 'string' } },
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadStorage(),
      limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
      fileFilter: (_req, file, cb) => {
        if (extname(file.originalname).toLowerCase() !== '.csv') {
          cb(new BadRequestException('Only .csv files are accepted'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  @Audit({ action: 'data_source.upload', resourceType: 'data_source' })
  upload(
    @Tenant() t: TenantContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() rawBody: unknown,
  ): Promise<DataSourceDetail> {
    if (!file) throw new BadRequestException('A .csv file is required in the "file" field');
    const parsed = UploadBodySchema.safeParse(rawBody ?? {});
    const name = (parsed.success && parsed.data.name) || file.originalname;
    return this.dataSources.createCsv(t.organizationId, {
      name,
      fileId: file.filename.replace(/\.csv$/, ''),
      originalName: file.originalname,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Data source detail with discovered schemas (never credentials)' })
  detail(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<DataSourceDetail> {
    return this.dataSources.detail(t.organizationId, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename, or change config/credentials (triggers a reconnect)',
    description:
      'config is merged into the existing config and validated for the source type; ' +
      'credentials replace the stored ones. POSTGRESQL, MCP and GITHUB only.',
  })
  @Audit({ action: 'data_source.update', resourceType: 'data_source' })
  update(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @ZodBody(UpdateDataSourceSchema) body: UpdateDataSourceInput,
  ): Promise<DataSourceDetail> {
    return this.dataSources.update(t.organizationId, id, body);
  }

  @Post(':id/sync')
  @HttpCode(200)
  @ApiOperation({ summary: 'Re-run schema discovery' })
  @Audit({ action: 'data_source.sync', resourceType: 'data_source' })
  sync(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<DataSourceDetail> {
    return this.dataSources.sync(t.organizationId, id);
  }

  @Get(':id/preview')
  @ApiOperation({ summary: 'First rows of a table (proxied to the ingestion service)' })
  @ApiQueries(
    { name: 'table', required: true },
    { name: 'limit', description: '1-500, default 50' },
  )
  preview(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @ZodQuery(PreviewQuerySchema) q: z.infer<typeof PreviewQuerySchema>,
  ) {
    return this.dataSources.preview(t.organizationId, id, q.table, q.limit);
  }

  @Get(':id/profile')
  @ApiOperation({ summary: 'Column profile of a table (proxied to the ingestion service)' })
  @ApiQueries({ name: 'table', required: true })
  profile(
    @Tenant() t: TenantContext,
    @Param('id', UuidPipe) id: string,
    @ZodQuery(ProfileQuerySchema) q: z.infer<typeof ProfileQuerySchema>,
  ) {
    return this.dataSources.profile(t.organizationId, id, q.table);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a data source (and its uploaded file, for CSV)' })
  @Audit({ action: 'data_source.delete', resourceType: 'data_source' })
  async remove(@Tenant() t: TenantContext, @Param('id', UuidPipe) id: string): Promise<void> {
    await this.dataSources.remove(t.organizationId, id);
  }
}
