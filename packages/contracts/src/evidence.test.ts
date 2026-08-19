import { describe, expect, it } from 'vitest';
import { EvidenceSourceType } from '@helix/types';
import { EvidenceSchema } from './evidence';

describe('EvidenceSchema', () => {
  const base = {
    id: '11111111-1111-1111-1111-111111111111',
    investigationId: '22222222-2222-2222-2222-222222222222',
    agentTaskId: '33333333-3333-3333-3333-333333333333',
    sourceType: EvidenceSourceType.METRIC,
    source: { description: '30-day refund total, transactions table' },
    summary: 'Refunds increased 24% over the trailing 30 days.',
    data: { changePercent: 24 },
    confidence: 0.99,
    collectedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  it('accepts a well-formed evidence record', () => {
    expect(EvidenceSchema.safeParse(base).success).toBe(true);
  });

  it('requires a source description', () => {
    const result = EvidenceSchema.safeParse({ ...base, source: {} });
    expect(result.success).toBe(false);
  });

  it('rejects confidence above 1', () => {
    const result = EvidenceSchema.safeParse({ ...base, confidence: 1.2 });
    expect(result.success).toBe(false);
  });
});
