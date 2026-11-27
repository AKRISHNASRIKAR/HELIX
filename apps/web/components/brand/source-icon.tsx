/** Type icons for data sources (server safe, stroked 24x24, currentColor). */

const PATHS: Record<string, string[]> = {
  // A sheet with a folded corner and grid rows.
  CSV: ['M6 2h9l5 5v15H6z', 'M15 2v5h5', 'M9 12h8M9 16h8M12 10v9'],
  // The classic database cylinder.
  POSTGRESQL: [
    'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z',
    'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
    'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  ],
  // A server exposing tools: plug into a socket.
  MCP: ['M9 2v5M15 2v5', 'M6 7h12v4a6 6 0 01-12 0z', 'M12 17v5'],
  // Branch graph.
  GITHUB: ['M6 3v12', 'M6 21a3 3 0 100-6 3 3 0 000 6z', 'M18 9a3 3 0 100-6 3 3 0 000 6z', 'M18 9a9 9 0 01-9 9'],
  // Curly braces for an API.
  REST_API: ['M8 3c-2 0-3 1-3 3v3c0 1.5-1 3-2 3 1 0 2 1.5 2 3v3c0 2 1 3 3 3', 'M16 3c2 0 3 1 3 3v3c0 1.5 1 3 2 3-1 0-2 1.5-2 3v3c0 2-1 3-3 3'],
};

export const SOURCE_LABEL: Record<string, string> = {
  POSTGRESQL: 'PostgreSQL',
  CSV: 'CSV upload',
  REST_API: 'REST API',
  GITHUB: 'GitHub',
  MCP: 'MCP server',
};

export function SourceIcon({ type, className = 'h-5 w-5' }: { type: string; className?: string }) {
  const paths = PATHS[type] ?? PATHS.POSTGRESQL ?? [];
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Icon in a tile; a live pulse ring when connected, red dot when failing. */
export function SourceTile({ type, status, size = 'md' }: { type: string; status?: string; size?: 'md' | 'lg' }) {
  const box = size === 'lg' ? 'h-14 w-14 rounded-2xl' : 'h-11 w-11 rounded-xl';
  const icon = size === 'lg' ? 'h-7 w-7' : 'h-5 w-5';
  return (
    <span className={`relative grid shrink-0 place-items-center bg-[var(--accent)] text-[var(--accent-contrast)] shadow-[0_0_24px_-6px_var(--glow-strong)] ${box}`}>
      <SourceIcon type={type} className={icon} />
      {status === 'CONNECTED' && (
        <span className="absolute -right-1 -top-1 inline-flex h-3 w-3" aria-hidden>
          <span className="helix-ping absolute inset-0 rounded-full bg-[var(--status-good)]" />
          <span className="relative h-3 w-3 rounded-full border-2 border-[var(--surface)] bg-[var(--status-good)]" />
        </span>
      )}
      {status === 'ERROR' && (
        <span className="absolute -right-1 -top-1 inline-flex h-3 w-3" aria-hidden>
          <span className="helix-ping absolute inset-0 rounded-full bg-[var(--status-critical)]" />
          <span className="relative h-3 w-3 rounded-full border-2 border-[var(--surface)] bg-[var(--status-critical)]" />
        </span>
      )}
      {status === 'PENDING' && (
        <span className="absolute -right-1 -top-1 h-3 w-3 animate-pulse rounded-full border-2 border-[var(--surface)] bg-[var(--status-warning)]" aria-hidden />
      )}
    </span>
  );
}
