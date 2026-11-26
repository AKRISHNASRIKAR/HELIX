import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { InvestigationStatus } from '@helix/database';
import { z } from 'zod';
import { SkipAudit } from '../audit/audit.decorator';
import { InternalTokenGuard } from '../auth/internal-token.guard';
import { Public, ZodBody, ZodQuery } from '../common/decorators';
import { UuidPipe } from '../common/uuid-param.pipe';
import { DataSourcesService } from '../data-sources/data-sources.service';
import { InvestigationsService } from '../investigations/investigations.service';
import { InternalContextService } from './internal-context.service';

const ConnectionQuerySchema = z.object({ organizationId: z.string().uuid() });
const ContextQuerySchema = z.object({
  dataSourceIds: z
    .string()
    .optional()
    .transform((v) =>
      v
        ? v
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(z.string().uuid())),
  sinceDays: z.coerce.number().int().min(1).max(365).default(30),
  excludeInvestigationId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
const ProgressSchema = z.object({
  status: z.nativeEnum(InvestigationStatus).optional(),
  event: z
    .object({
      type: z.string().min(1).max(200),
      payload: z.record(z.unknown()).optional(),
      at: z.coerce.date().optional(),
    })
    .optional(),
});

/**
 * Service-to-service endpoints (spec A). Not behind JWT; callers present the
 * shared HELIX_INTERNAL_TOKEN in `x-helix-internal-token`. Hidden from the
 * public Swagger document.
 */
@ApiExcludeController()
@Public()
@UseGuards(InternalTokenGuard)
@Controller('internal')
export class InternalController {
  constructor(
    private readonly dataSources: DataSourcesService,
    private readonly investigations: InvestigationsService,
    private readonly context: InternalContextService,
  ) {}

  /** Spec 9.4: recent org history (metrics, anomalies, findings) for the context engine. */
  @Get('organizations/:orgId/context')
  organizationContext(
    @Param('orgId', UuidPipe) orgId: string,
    @ZodQuery(ContextQuerySchema) q: z.infer<typeof ContextQuerySchema>,
  ) {
    return this.context.history(orgId, q);
  }

  /** A1: ConnectionSpec with decrypted credentials, for the ingestion service. */
  @Get('data-sources/:id/connection')
  connection(
    @Param('id', UuidPipe) id: string,
    @ZodQuery(ConnectionQuerySchema) q: z.infer<typeof ConnectionQuerySchema>,
  ) {
    return this.dataSources.resolveConnection(q.organizationId, id);
  }

  /** A2: live progress from the Coordinator. Already recorded as InvestigationEvent rows. */
  @Post('investigations/:id/progress')
  @HttpCode(204)
  @SkipAudit()
  async progress(
    @Param('id', UuidPipe) id: string,
    @ZodBody(ProgressSchema) body: z.infer<typeof ProgressSchema>,
  ): Promise<void> {
    await this.investigations.recordProgress(id, body);
  }
}
