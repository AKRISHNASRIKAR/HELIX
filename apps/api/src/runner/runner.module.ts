import { Module } from '@nestjs/common';
import { InvestigationRunnerService } from './investigation-runner.service';

@Module({
  providers: [InvestigationRunnerService],
  exports: [InvestigationRunnerService],
})
export class RunnerModule {}
