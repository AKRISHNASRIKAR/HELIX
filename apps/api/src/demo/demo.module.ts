import { Module } from '@nestjs/common';
import {
  DemoAnalyticsController,
  DemoHealthController,
  DemoInvestigationsController,
  DemoPlatformController,
} from './demo.controller';

@Module({
  controllers: [
    DemoHealthController,
    DemoInvestigationsController,
    DemoAnalyticsController,
    DemoPlatformController,
  ],
})
export class DemoModule {}
