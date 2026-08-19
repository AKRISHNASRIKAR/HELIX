import { PrismaClient } from '@prisma/client';

export * from '@prisma/client';

/**
 * Single shared PrismaClient instance per process. In dev, Next.js/Nest hot
 * reload can otherwise spawn a new client (and a new connection pool) per
 * reload — stash it on `globalThis` to avoid exhausting Postgres connections.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
