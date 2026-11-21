import { Global, Module } from '@nestjs/common';
import { AgentRuntimeClient } from './agent-runtime.client';
import { IngestionClient } from './ingestion.client';

/** Outbound HTTP clients to the Python services (override these in tests). */
@Global()
@Module({
  providers: [IngestionClient, AgentRuntimeClient],
  exports: [IngestionClient, AgentRuntimeClient],
})
export class ClientsModule {}
