import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { ApiEnv } from '../config/env';
import type { AuthUser } from '../common/types';

export interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<ApiEnv, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  // Stateless on purpose: org access is re-checked against
  // OrganizationMember on every tenant-scoped request by TenantGuard.
  validate(payload: JwtPayload): AuthUser {
    return { id: payload.sub, email: payload.email };
  }
}
