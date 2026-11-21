import { Module } from '@nestjs/common';
import { DataSourcesController } from './data-sources.controller';
import { DataSourcesService } from './data-sources.service';
import { SecretsService } from './secrets.service';

@Module({
  controllers: [DataSourcesController],
  providers: [DataSourcesService, SecretsService],
  exports: [DataSourcesService, SecretsService],
})
export class DataSourcesModule {}
