import { Injectable, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

/**
 * Thin wrapper around ioredis. Redis backs caching, queues, agent
 * coordination, and short-lived investigation state — it is never the
 * source of truth for persistent data (that's Postgres, see PrismaService).
 */
@Injectable()
export class RedisService extends Redis implements OnModuleDestroy {
  constructor() {
    super(process.env.REDIS_URL ?? 'redis://localhost:6379');
  }

  async onModuleDestroy() {
    this.disconnect();
  }
}
