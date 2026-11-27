import { describe, expect, it } from 'vitest';
import { formatCell, formatCurrency, formatDelta, formatNumber, formatPercent, formatRelative, formatUtcDay } from './format';

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

describe('formatUtcDay', () => {
  it('shows the UTC day without shifting it into the viewer timezone', () => {
    expect(formatUtcDay('2026-10-08T00:00:00.000Z')).toBe('Oct 8, 2026');
    expect(formatUtcDay(null)).toBe('unknown');
    expect(formatUtcDay('nope')).toBe('unknown');
  });
});

describe('formatCurrency', () => {
  it('formats compact amounts the same on server and browser', () => {
    expect(formatCurrency(0)).toBe('$0');
    expect(formatCurrency(12.34)).toBe('$12.3');
    expect(formatCurrency(3000)).toBe('$3K');
    expect(formatCurrency(3049)).toBe('$3K');
    expect(formatCurrency(19944.04)).toBe('$19.9K');
    expect(formatCurrency(884312)).toBe('$884.3K');
    expect(formatCurrency(1_250_000)).toBe('$1.3M');
    expect(formatCurrency(-12621.7)).toBe('-$12.6K');
  });

  it('promotes to the next unit instead of showing 1000K', () => {
    expect(formatCurrency(999_960)).toBe('$1M');
    expect(formatCurrency(999.96)).toBe('$1K');
  });

  it('keeps the standard form when not compact', () => {
    expect(formatCurrency(12621.71, false)).toBe('$12,622');
  });
});
