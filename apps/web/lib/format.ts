export function formatCurrency(value: number, compact = true): string {
  if (!compact) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
  }
  // Hand-rolled compact form: Intl's compact notation differs between Node and
  // browser ICU versions ("$3K" vs "$3.0K"), which breaks hydration.
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  const units: [number, string][] = [
    [1, ''],
    [1e3, 'K'],
    [1e6, 'M'],
    [1e9, 'B'],
    [1e12, 'T'],
  ];
  let i = units.length - 1;
  while (i > 0 && abs < units[i]![0]) i -= 1;
  let n = Math.round((abs / units[i]![0]) * 10) / 10;
  // 999.96K rounds to 1000K; show it as 1M instead.
  if (n >= 1000 && i < units.length - 1) {
    i += 1;
    n = Math.round((abs / units[i]![0]) * 10) / 10;
  }
  return `${sign}$${Number.isInteger(n) ? n.toFixed(0) : n.toFixed(1)}${units[i]![1]}`;
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

/** A day-level timestamp (UTC midnight, e.g. an anomaly's day) as "Oct 8, 2026", never shifted by the viewer's timezone. */
export function formatUtcDay(value: string | Date | null | undefined): string {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'unknown';
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
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
