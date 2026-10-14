import { PrismaClient } from '@prisma/client';
import { env } from './env';

/**
 * Cliente unico do Prisma.
 *
 * O log de 'query' ficava ligado em producao, despejando toda consulta SQL no
 * arquivo de log do PM2. Agora so aparece em desenvolvimento.
 */
const globalParaPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalParaPrisma.prisma ??
  new PrismaClient({
    log: env.ehProducao ? ['warn', 'error'] : ['query', 'info', 'warn', 'error'],
  });

if (!env.ehProducao) globalParaPrisma.prisma = prisma;
