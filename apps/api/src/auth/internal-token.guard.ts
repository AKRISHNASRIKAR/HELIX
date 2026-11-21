import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import type { ApiEnv } from '../config/env';

export const INTERNAL_TOKEN_HEADER = 'x-helix-internal-token';

/** Service-to-service auth for /internal/* (ingestion service, agent runtime). */
@Injectable()
export class InternalTokenGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(config: ConfigService<ApiEnv, true>) {
    this.expected = Buffer.from(config.get('HELIX_INTERNAL_TOKEN', { infer: true }));
  }

  canActivate(ctx: ExecutionContext): boolean {
    const header = ctx.switchToHttp().getRequest<Request>().headers[INTERNAL_TOKEN_HEADER];
    const given = Buffer.from(typeof header === 'string' ? header : '');
    if (given.length !== this.expected.length || !timingSafeEqual(given, this.expected)) {
      throw new UnauthorizedException('Invalid internal token');
    }
    return true;
  }
}
