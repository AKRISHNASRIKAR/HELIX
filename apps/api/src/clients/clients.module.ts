import { Global, Module } from '@nestjs/common';
import { AgentRuntimeClient } from './agent-runtime.client';
import { AnalyticsEngineClient } from './analytics-engine.client';
import { IngestionClient } from './ingestion.client';

/** Outbound HTTP clients to the Python services (override these in tests). */
@Global()
@Module({
  providers: [IngestionClient, AgentRuntimeClient, AnalyticsEngineClient],
  exports: [IngestionClient, AgentRuntimeClient, AnalyticsEngineClient],
})
export class ClientsModule {}
