import type { Prisma, TipoAcao } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * A tabela HistoricoAcoes existia no schema desde o inicio mas nunca recebeu
 * uma linha sequer: nenhum ponto do codigo escrevia nela.
 */
export class HistoricoRepository {
  registrar(
    emprestimoId: number,
    acao: TipoAcao,
    detalhes?: string | null,
    usuario?: string | null,
    tx?: Prisma.TransactionClient,
  ) {
    const cliente = tx ?? prisma;
    return cliente.historicoAcoes.create({
      data: { emprestimoId, acao, detalhes: detalhes ?? null, usuario: usuario ?? 'SISTEMA' },
    });
  }

  listarPorEmprestimo(emprestimoId: number) {
    return prisma.historicoAcoes.findMany({
      where: { emprestimoId },
      orderBy: { dataAcao: 'desc' },
    });
  }

  listarRecentes(limite = 50) {
    return prisma.historicoAcoes.findMany({
      orderBy: { dataAcao: 'desc' },
      take: limite,
      include: {
        emprestimo: { include: { item: true, colaborador: true } },
      },
    });
  }
}

export const historicoRepository = new HistoricoRepository();
