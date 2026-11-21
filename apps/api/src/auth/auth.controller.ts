import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Audit } from '../audit/audit.decorator';
import { CurrentUser, Public, ZodBody } from '../common/decorators';
import type { AuthUser } from '../common/types';
import { AuthResult, AuthService, MeResult } from './auth.service';

const SignupSchema = z.object({
  email: z.string().trim().email(),
  name: z.string().trim().min(1).max(200),
  password: z.string().min(8).max(256),
});
const LoginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1).max(256),
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create an account and receive an access token' })
  @Audit({
    action: 'user.signup',
    resourceType: 'user',
    resourceId: (res: AuthResult) => res.user.id,
  })
  signup(@ZodBody(SignupSchema) body: z.infer<typeof SignupSchema>): Promise<AuthResult> {
    return this.auth.signup(body);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange email/password for an access token' })
  @Audit({
    action: 'auth.login',
    resourceType: 'user',
    resourceId: (res: AuthResult) => res.user.id,
  })
  login(@ZodBody(LoginSchema) body: z.infer<typeof LoginSchema>): Promise<AuthResult> {
    return this.auth.login(body);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current user and organization memberships' })
  me(@CurrentUser() user: AuthUser): Promise<MeResult> {
    return this.auth.me(user.id);
  }
}
