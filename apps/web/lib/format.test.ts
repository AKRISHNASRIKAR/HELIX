import { describe, expect, it } from 'vitest';
import { formatCell, formatDelta, formatNumber, formatPercent, formatRelative } from './format';

describe('formatRelative', () => {
  const now = new Date('2026-10-14T12:00:00Z');
  it('buckets into minutes, hours and days', () => {
    expect(formatRelative('2026-10-14T11:59:50Z', now)).toBe('just now');
    expect(formatRelative('2026-10-14T11:45:00Z', now)).toBe('15m ago');
    expect(formatRelative('2026-10-14T09:00:00Z', now)).toBe('3h ago');
    expect(formatRelative('2026-10-11T12:00:00Z', now)).toBe('3d ago');
  });
  it('handles missing and invalid timestamps', () => {
    expect(formatRelative(null, now)).toBe('never');
    expect(formatRelative('garbage', now)).toBe('unknown');
  });
});

describe('number formatting', () => {
  it('formats percents, deltas and counts', () => {
    expect(formatPercent(0.1234)).toBe('12.3%');
    expect(formatDelta(0.05)).toBe('+5.0%');
    expect(formatNumber(1234567)).toBe('1,234,567');
    expect(formatNumber(null)).toBe('-');
  });
});

describe('formatCell', () => {
  it('stringifies preview grid values', () => {
    expect(formatCell(null)).toBe('null');
    expect(formatCell(12.5)).toBe('12.5');
    expect(formatCell({ a: 1 })).toBe('{"a":1}');
  });
});
