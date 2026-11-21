import { Module } from '@nestjs/common';
import { RunnerModule } from '../runner/runner.module';
import { InvestigationsController } from './investigations.controller';
import { InvestigationsService } from './investigations.service';

@Module({
  imports: [RunnerModule],
  controllers: [InvestigationsController],
  providers: [InvestigationsService],
  exports: [InvestigationsService],
})
export class InvestigationsModule {}
