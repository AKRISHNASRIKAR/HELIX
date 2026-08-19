import { Controller, Get, Query } from '@nestjs/common';
import type { Investigation } from '@helix/database';
import { InvestigationsService } from './investigations.service';

@Controller('investigations')
export class InvestigationsController {
  constructor(private readonly investigations: InvestigationsService) {}

  @Get()
  findAll(@Query('organizationId') organizationId?: string): Promise<Investigation[]> {
    return this.investigations.findAll(organizationId);
  }
}
