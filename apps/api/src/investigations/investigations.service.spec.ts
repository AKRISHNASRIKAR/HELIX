import { Test } from '@nestjs/testing';
import { InvestigationsService } from './investigations.service';
import { PrismaService } from '../prisma/prisma.service';

describe('InvestigationsService', () => {
  let service: InvestigationsService;
  const findManyMock = jest.fn();

  beforeEach(async () => {
    findManyMock.mockReset();
    const moduleRef = await Test.createTestingModule({
      providers: [
        InvestigationsService,
        {
          provide: PrismaService,
          useValue: { investigation: { findMany: findManyMock } },
        },
      ],
    }).compile();

    service = moduleRef.get(InvestigationsService);
  });

  it('scopes the query to organizationId when provided', async () => {
    findManyMock.mockResolvedValue([]);

    await service.findAll('org-1');

    expect(findManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
  });

  it('does not filter by organization when none is provided', async () => {
    findManyMock.mockResolvedValue([]);

    await service.findAll();

    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: undefined }));
  });
});
