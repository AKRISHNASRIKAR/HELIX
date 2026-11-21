import { Module } from '@nestjs/common';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { InvestigationsModule } from '../investigations/investigations.module';
import { InternalController } from './internal.controller';

@Module({
  imports: [DataSourcesModule, InvestigationsModule],
  controllers: [InternalController],
})
export class InternalModule {}
