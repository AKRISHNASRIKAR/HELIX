import { describe, expect, it } from 'vitest';
import { normalizeContextRequirements, requirementRows, sortAgents } from './agents';

describe('normalizeContextRequirements', () => {
  it('reads camelCase and snake_case', () => {
    expect(normalizeContextRequirements({ semanticTypes: ['datetime'], includeUpstream: false, maxTokens: 8000 })).toMatchObject({
      semanticTypes: ['datetime'],
      includeUpstream: false,
      maxTokens: 8000,
      dataSourceTypes: null,
    });
    expect(normalizeContextRequirements({ data_source_types: ['MCP', 'GITHUB'], table_keywords: ['deploy'] })).toMatchObject({
      dataSourceTypes: ['MCP', 'GITHUB'],
      tableKeywords: ['deploy'],
    });
    expect(normalizeContextRequirements(null)).toBeNull();
  });
});

describe('requirementRows', () => {
  it('describes requirements in words', () => {
    const rows = requirementRows(
      normalizeContextRequirements({ dataSourceTypes: ['MCP'], includeHistory: true, historyDays: 14, maxTokens: 12000 }),
    );
    expect(rows).toEqual([
      { label: 'Data source types', value: 'MCP' },
      { label: 'Semantic types', value: 'any' },
      { label: 'Table keywords', value: 'none' },
      { label: 'History', value: 'last 14 days' },
      { label: 'Token budget', value: '12,000' },
    ]);
    expect(requirementRows(null)).toEqual([]);
  });
});

describe('sortAgents', () => {
  it('puts the Coordinator first and domain agents in plan order', () => {
    const sorted = sortAgents([
      { type: 'PRODUCT', name: 'Product' },
      { type: 'ZETA', name: 'Zeta' },
      { type: 'ANALYTICS', name: 'Analytics' },
      { type: 'COORDINATOR', name: 'Coordinator' },
      { type: 'FINANCE', name: 'Finance' },
    ]);
    expect(sorted.map((a) => a.type)).toEqual(['COORDINATOR', 'ANALYTICS', 'FINANCE', 'PRODUCT', 'ZETA']);
  });
});
