import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import * as fx from './fixtures';

/** Serves fixture data in place of Postgres-backed endpoints when HELIX_DEMO=1. */
@Controller('health')
export class DemoHealthController {
  @Get()
  check() {
    return { status: 'ok', info: { mode: { status: 'demo' } } };
  }
}

@Controller('investigations')
export class DemoInvestigationsController {
  @Get()
  findAll() {
    return fx.investigations;
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    const found = fx.investigations.find((i) => i.id === id);
    if (!found) throw new NotFoundException();
    return found;
  }
}

@Controller('analytics')
export class DemoAnalyticsController {
  @Get('overview')
  overview() {
    return fx.overview;
  }

  @Get('revenue')
  revenue() {
    return { series: fx.revenueSeries, bySegment: fx.revenueBySegment, channelMix: fx.channelMix };
  }

  @Get('anomalies')
  anomalies() {
    return { items: fx.anomalies, heatmap: fx.anomalyHeatmap };
  }

  @Get('throughput')
  throughput() {
    return fx.throughput;
  }
}

@Controller()
export class DemoPlatformController {
  @Get('agents')
  agents() {
    return fx.agents;
  }

  @Get('data-sources')
  dataSources() {
    return fx.dataSources;
  }
}
