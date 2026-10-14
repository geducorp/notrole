import { Prisma, type CondicaoItem, type SituacaoItem } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Equipamentos identificados do estoque (antiga tabela Notebook).
 *
 * Um notebook de emprestimo e um item da categoria Notebook com
 * `paraEmprestimo = true`: o mesmo cadastro serve ao estoque e ao emprestimo,
 * para que nao existam dois registros do mesmo equipamento.
 */

export const ITEM_COM_RELACOES = {
  categoria: true,
  empresa: true,
  colaborador: true,
} satisfies Prisma.ItemInclude;

export type ItemCompleto = Prisma.ItemGetPayload<{ include: typeof ITEM_COM_RELACOES }>;

export interface FiltroItens {
  busca?: string;
  situacao?: SituacaoItem;
  /** Qualquer uma destas (ignorado se `situacao` vier). */
  situacoes?: SituacaoItem[];
  condicao?: CondicaoItem;
  categoriaId?: number;
  empresaId?: number;
  paraEmprestimo?: boolean;
  /** Itens que estao com algum colaborador. */
  comColaborador?: boolean;
  colaboradorId?: number;
  /** false = so os perifericos (categorias sem aba propria no Estoque). */
  secaoPropria?: boolean;
}

export class ItemRepository {
  criar(data: Prisma.ItemCreateInput) {
    return prisma.item.create({ data, include: ITEM_COM_RELACOES });
  }

  listar(filtro?: FiltroItens) {
    return prisma.item.findMany({
      where: this.montarFiltro(filtro),
      include: ITEM_COM_RELACOES,
      orderBy: [{ categoria: { ordem: 'asc' } }, { hostname: 'asc' }, { id: 'asc' }],
    });
  }

  contar(filtro?: FiltroItens) {
    return prisma.item.count({ where: this.montarFiltro(filtro) });
  }

  private montarFiltro(filtro?: FiltroItens): Prisma.ItemWhereInput {
    const where: Prisma.ItemWhereInput = {};

    if (filtro?.situacao) where.situacao = filtro.situacao;
    else if (filtro?.situacoes?.length) where.situacao = { in: filtro.situacoes };
    if (filtro?.condicao) where.condicao = filtro.condicao;
    if (filtro?.categoriaId) where.categoriaId = filtro.categoriaId;
    if (filtro?.empresaId) where.empresaId = filtro.empresaId;
    if (filtro?.paraEmprestimo !== undefined) where.paraEmprestimo = filtro.paraEmprestimo;
    if (filtro?.comColaborador) where.colaboradorId = { not: null };
    if (filtro?.colaboradorId) where.colaboradorId = filtro.colaboradorId;
    if (filtro?.secaoPropria !== undefined) where.categoria = { secaoPropria: filtro.secaoPropria };

    if (filtro?.busca?.trim()) {
      const busca = filtro.busca.trim();
      where.OR = [
        { hostname: { contains: busca, mode: 'insensitive' } },
        { patrimonio: { contains: busca, mode: 'insensitive' } },
        { modelo: { contains: busca, mode: 'insensitive' } },
        { marca: { contains: busca, mode: 'insensitive' } },
        { colaborador: { nome: { contains: busca, mode: 'insensitive' } } },
      ];
    }

    return where;
  }

  buscarPorId(id: number) {
    return prisma.item.findUnique({ where: { id }, include: ITEM_COM_RELACOES });
  }

  /** Inclui o emprestimo em aberto e as ultimas movimentacoes. */
  buscarPorIdComHistorico(id: number) {
    return prisma.item.findUnique({
      where: { id },
      include: {
        ...ITEM_COM_RELACOES,
        emprestimos: {
          include: { colaborador: true },
          orderBy: { dataInicio: 'desc' },
          take: 10,
        },
        movimentacoes: {
          include: { colaborador: true },
          orderBy: { data: 'desc' },
          take: 30,
        },
      },
    });
  }

  atualizar(id: number, data: Prisma.ItemUpdateInput) {
    return prisma.item.update({ where: { id }, data, include: ITEM_COM_RELACOES });
  }

  atualizarSituacao(id: number, situacao: SituacaoItem) {
    return prisma.item.update({ where: { id }, data: { situacao } });
  }

  remover(id: number) {
    return prisma.item.delete({ where: { id } });
  }

  contarPorSituacao(empresaId?: number) {
    return prisma.item.groupBy({
      by: ['situacao'],
      where: empresaId ? { empresaId } : undefined,
      _count: { _all: true },
    });
  }

  contarPorCategoria(empresaId?: number) {
    return prisma.item.groupBy({
      by: ['categoriaId'],
      where: { ...(empresaId ? { empresaId } : {}), situacao: { not: 'BAIXADO' } },
      _count: { _all: true },
    });
  }

  /**
   * Quantidade e valor por categoria e situacao. O dashboard filtra por tipo
   * de equipamento (so notebooks, so monitores) sem voltar ao servidor.
   */
  contarPorCategoriaESituacao(empresaId?: number) {
    return prisma.item.groupBy({
      by: ['categoriaId', 'situacao'],
      where: { ...(empresaId ? { empresaId } : {}), situacao: { not: 'BAIXADO' } },
      _count: { _all: true },
      _sum: { valor: true },
    });
  }

  /** Marcados para emprestimo e guardados: o que da para emprestar agora. */
  contarDisponiveisParaEmprestimo(empresaId?: number) {
    return prisma.item.count({
      where: { ...(empresaId ? { empresaId } : {}), situacao: 'EM_ESTOQUE', paraEmprestimo: true },
    });
  }

  /** Quanto vale o que esta parado em estoque. */
  somarValorEmEstoque(empresaId?: number) {
    return prisma.item.aggregate({
      where: { situacao: 'EM_ESTOQUE', ...(empresaId ? { empresaId } : {}) },
      _sum: { valor: true },
    });
  }

  contarTotal(empresaId?: number) {
    return prisma.item.count({
      where: { situacao: { not: 'BAIXADO' }, ...(empresaId ? { empresaId } : {}) },
    });
  }
}

export const itemRepository = new ItemRepository();
