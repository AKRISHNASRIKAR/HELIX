import { Module } from '@nestjs/common';
import { RunnerModule } from '../runner/runner.module';
import { AnomaliesController, MonitorsController } from './monitors.controller';
import { MonitoringService } from './monitoring.service';
import { MonitorsService } from './monitors.service';

/** Phase 9: monitors, the background monitoring loop and the anomalies list. */
@Module({
  imports: [RunnerModule],
  controllers: [MonitorsController, AnomaliesController],
  providers: [MonitorsService, MonitoringService],
  exports: [MonitoringService],
})
export class MonitorsModule {}
