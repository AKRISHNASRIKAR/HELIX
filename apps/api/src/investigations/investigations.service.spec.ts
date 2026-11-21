import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { InvestigationsService } from './investigations.service';
import { PrismaService } from '../prisma/prisma.service';
import { InvestigationRunnerService } from '../runner/investigation-runner.service';

describe('InvestigationsService', () => {
  let service: InvestigationsService;
  const prisma = {
    investigation: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
      findUniqueOrThrow: jest.fn(),
    },
    project: { findFirst: jest.fn() },
    investigationEvent: { create: jest.fn() },
  };
  const runner = { enqueue: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvestigationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: InvestigationRunnerService, useValue: runner },
      ],
    }).compile();
    service = moduleRef.get(InvestigationsService);
  });

  it('always scopes the list to the tenant organization', async () => {
    prisma.investigation.findMany.mockResolvedValue([]);
    await service.findAll('org-1');
    expect(prisma.investigation.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: 'org-1' },
        orderBy: { createdAt: 'desc' },
      }),
    );
  });

  it('refuses to create an investigation for a project in another org', async () => {
    prisma.project.findFirst.mockResolvedValue(null);
    await expect(
      service.create('org-1', 'user-1', { projectId: 'p', question: 'why?' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'p', organizationId: 'org-1' } }),
    );
    expect(runner.enqueue).not.toHaveBeenCalled();
  });

  it('creates a PENDING investigation with a created event and enqueues the run', async () => {
    prisma.project.findFirst.mockResolvedValue({ id: 'p' });
    prisma.investigation.create.mockResolvedValue({ id: 'inv-1' });
    await service.create('org-1', 'user-1', { projectId: 'p', question: 'why?' });
    const data = prisma.investigation.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      organizationId: 'org-1',
      createdByUserId: 'user-1',
      triggerType: 'USER_QUESTION',
    });
    expect(data.events.create.type).toBe('investigation.created');
    expect(runner.enqueue).toHaveBeenCalledWith('inv-1');
  });

  it('returns 409 when cancelling a finished investigation', async () => {
    prisma.investigation.findFirst.mockResolvedValue({ id: 'inv-1', status: 'COMPLETED' });
    prisma.investigation.updateMany.mockResolvedValue({ count: 0 });
    await expect(service.cancel('org-1', 'inv-1', 'user-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(prisma.investigationEvent.create).not.toHaveBeenCalled();
  });
});
