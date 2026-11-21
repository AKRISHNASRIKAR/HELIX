export function formatCurrency(value: number, compact = true): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    notation: compact ? 'compact' : 'standard',
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatDelta(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value * 100).toFixed(1)}%`;
}

export function formatShortDate(value: string): string {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function formatRelative(value: string | Date | null | undefined, now = new Date()): string {
  if (!value) return 'never';
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 'unknown';
  const mins = Math.round((now.getTime() - time) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export function formatNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '-';
  return new Intl.NumberFormat('en-US').format(value);
}

/** Renders an arbitrary cell value from a preview grid as short text. */
export function formatCell(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
