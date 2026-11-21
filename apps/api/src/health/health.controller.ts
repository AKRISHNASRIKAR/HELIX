import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorFunction,
  PrismaHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    const redisCheck: HealthIndicatorFunction = async () => {
      const pong = await this.redis.ping();
      return { redis: { status: pong === 'PONG' ? 'up' : 'down' } };
    };

    return this.health.check([
      () => this.prismaIndicator.pingCheck('postgres', this.prisma),
      redisCheck,
    ]);
  }
}
