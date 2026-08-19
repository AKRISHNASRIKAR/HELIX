import pino, { type Logger, type LoggerOptions } from 'pino';

export type { Logger };

export interface CreateLoggerOptions {
  service: string;
  level?: string;
  pretty?: boolean;
}

/**
 * One consistent logger shape across every Node service so logs can be
 * correlated in a shared log pipeline later (Loki/ELK/etc — see
 * infrastructure/monitoring). Every log line carries `service` for filtering.
 */
export function createLogger({ service, level, pretty }: CreateLoggerOptions): Logger {
  const options: LoggerOptions = {
    level: level ?? process.env.LOG_LEVEL ?? 'info',
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  const usePretty = pretty ?? process.env.NODE_ENV !== 'production';
  if (usePretty) {
    return pino({
      ...options,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
      },
    });
  }

  return pino(options);
}
