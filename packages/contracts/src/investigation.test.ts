import { describe, expect, it } from 'vitest';
import { InvestigationTriggerType } from '@helix/types';
import { CreateInvestigationSchema, InvestigationSchema } from './investigation';

describe('CreateInvestigationSchema', () => {
  it('defaults triggerType to USER_QUESTION', () => {
    const parsed = CreateInvestigationSchema.parse({
      organizationId: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      question: 'Why did revenue drop yesterday?',
    });

    expect(parsed.triggerType).toBe(InvestigationTriggerType.USER_QUESTION);
  });

  it('rejects an empty question', () => {
    const result = CreateInvestigationSchema.safeParse({
      organizationId: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      question: '',
    });

    expect(result.success).toBe(false);
  });
});

describe('InvestigationSchema', () => {
  it('accepts a fully-populated investigation', () => {
    const now = new Date();
    const result = InvestigationSchema.safeParse({
      id: '33333333-3333-3333-3333-333333333333',
      organizationId: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      createdByUserId: null,
      triggerType: InvestigationTriggerType.ANOMALY_DETECTED,
      question: 'Why did refunds spike?',
      status: 'IN_PROGRESS',
      plan: null,
      rootCauseFindingId: null,
      summary: null,
      overallConfidence: null,
      startedAt: now,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(true);
  });

  it('rejects a confidence value outside [0, 1]', () => {
    const now = new Date();
    const result = InvestigationSchema.safeParse({
      id: '33333333-3333-3333-3333-333333333333',
      organizationId: '11111111-1111-1111-1111-111111111111',
      projectId: '22222222-2222-2222-2222-222222222222',
      createdByUserId: null,
      triggerType: InvestigationTriggerType.USER_QUESTION,
      question: 'Why did refunds spike?',
      status: 'COMPLETED',
      plan: null,
      rootCauseFindingId: null,
      summary: null,
      overallConfidence: 1.5,
      startedAt: now,
      completedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    expect(result.success).toBe(false);
  });
});
