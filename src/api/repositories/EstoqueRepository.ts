import { Prisma, type TipoMovimentacao } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Categorias, itens por quantidade e movimentacoes.
 *
 * A movimentacao e o extrato do estoque: toda entrada, entrega, devolucao,
 * transferencia, manutencao ou baixa vira uma linha aqui. E dela que sai a
 * resposta para "por onde esse equipamento andou".
 */

export const MOVIMENTACAO_COM_RELACOES = {
  item: { include: { categoria: true } },
  itemQuantidade: { include: { categoria: true } },
  colaborador: true,
} satisfies Prisma.MovimentacaoInclude;

export type MovimentacaoCompleta = Prisma.MovimentacaoGetPayload<{
  include: typeof MOVIMENTACAO_COM_RELACOES;
}>;

export const QUANTIDADE_COM_RELACOES = {
  categoria: true,
  empresa: true,
} satisfies Prisma.ItemQuantidadeInclude;

export type ItemQuantidadeCompleto = Prisma.ItemQuantidadeGetPayload<{
  include: typeof QUANTIDADE_COM_RELACOES;
}>;

export class EstoqueRepository {
  // -------------------------------------------------------------------------
  // Categorias
  // -------------------------------------------------------------------------

  listarCategorias(apenasAtivas = false) {
    return prisma.categoria.findMany({
      where: apenasAtivas ? { ativo: true } : undefined,
      orderBy: [{ ordem: 'asc' }, { nome: 'asc' }],
    });
  }

  buscarCategoria(id: number) {
    return prisma.categoria.findUnique({ where: { id } });
  }

  criarCategoria(data: Prisma.CategoriaCreateInput) {
    return prisma.categoria.create({ data });
  }

  atualizarCategoria(id: number, data: Prisma.CategoriaUpdateInput) {
    return prisma.categoria.update({ where: { id }, data });
  }

  contarUsoDaCategoria(id: number) {
    return Promise.all([
      prisma.item.count({ where: { categoriaId: id } }),
      prisma.itemQuantidade.count({ where: { categoriaId: id } }),
    ]).then(([itens, quantidades]) => itens + quantidades);
  }

  // -------------------------------------------------------------------------
  // Itens por quantidade
  // -------------------------------------------------------------------------

  listarQuantidades(filtro?: { empresaId?: number; categoriaId?: number; busca?: string }) {
    const where: Prisma.ItemQuantidadeWhereInput = {};
    if (filtro?.empresaId) where.empresaId = filtro.empresaId;
    if (filtro?.categoriaId) where.categoriaId = filtro.categoriaId;
    if (filtro?.busca?.trim()) {
      where.descricao = { contains: filtro.busca.trim(), mode: 'insensitive' };
    }

    return prisma.itemQuantidade.findMany({
      where,
      include: QUANTIDADE_COM_RELACOES,
      orderBy: [{ categoria: { ordem: 'asc' } }, { descricao: 'asc' }],
    });
  }

  buscarQuantidade(id: number) {
    return prisma.itemQuantidade.findUnique({ where: { id }, include: QUANTIDADE_COM_RELACOES });
  }

  buscarQuantidadePorDescricao(empresaId: number, categoriaId: number, descricao: string) {
    return prisma.itemQuantidade.findUnique({
      where: { empresaId_categoriaId_descricao: { empresaId, categoriaId, descricao } },
      include: QUANTIDADE_COM_RELACOES,
    });
  }

  /**
   * Cadastra o item por quantidade e, se vier, a movimentacao do saldo inicial
   * - na mesma transacao.
   */
  criarQuantidade(
    data: Prisma.ItemQuantidadeCreateInput,
    movimentacaoInicial?: Omit<Prisma.MovimentacaoUncheckedCreateInput, 'itemQuantidadeId'>,
  ) {
    return prisma.$transaction(async (tx) => {
      const criado = await tx.itemQuantidade.create({ data, include: QUANTIDADE_COM_RELACOES });
      if (movimentacaoInicial) {
        await this.registrarMovimentacao({ ...movimentacaoInicial, itemQuantidadeId: criado.id }, tx);
      }
      return criado;
    });
  }

  atualizarQuantidade(id: number, data: Prisma.ItemQuantidadeUpdateInput) {
    return prisma.itemQuantidade.update({ where: { id }, data, include: QUANTIDADE_COM_RELACOES });
  }

  removerQuantidade(id: number) {
    return prisma.itemQuantidade.delete({ where: { id } });
  }

  /** Itens por quantidade no limite ou abaixo do estoque minimo. */
  listarAbaixoDoMinimo(empresaId?: number) {
    return prisma.$queryRaw<
      Array<{
        id: number;
        descricao: string;
        categoria: string;
        quantidade: number;
        estoqueMinimo: number;
        empresa: string;
      }>
    >`
      SELECT q."id", q."descricao", c."nome" AS categoria, q."quantidade", q."estoqueMinimo",
             e."apelido" AS empresa
      FROM "ItemQuantidade" q
      JOIN "Empresa" e ON e."id" = q."empresaId"
      JOIN "Categoria" c ON c."id" = q."categoriaId"
      WHERE q."estoqueMinimo" IS NOT NULL
        AND q."quantidade" <= q."estoqueMinimo"
        ${empresaId ? Prisma.sql`AND q."empresaId" = ${empresaId}` : Prisma.empty}
      ORDER BY q."quantidade" ASC
    `;
  }

  // -------------------------------------------------------------------------
  // Movimentacoes
  // -------------------------------------------------------------------------

  registrarMovimentacao(
    data: Prisma.MovimentacaoUncheckedCreateInput,
    tx: Prisma.TransactionClient = prisma,
  ) {
    return tx.movimentacao.create({ data });
  }

  /** Movimentacoes que sao historico de verdade (tudo alem de ENTRADA/CONTAGEM_INICIAL). */
  contarMovimentacoesAlemDoCadastro(filtro: { itemId?: number; itemQuantidadeId?: number }) {
    return prisma.movimentacao.count({
      where: { ...filtro, tipo: { notIn: ['ENTRADA', 'CONTAGEM_INICIAL'] } },
    });
  }

  listarMovimentacoes(filtro?: {
    itemId?: number;
    itemQuantidadeId?: number;
    empresaId?: number;
    tipo?: TipoMovimentacao;
    limite?: number;
  }) {
    const where: Prisma.MovimentacaoWhereInput = {};
    if (filtro?.itemId) where.itemId = filtro.itemId;
    if (filtro?.itemQuantidadeId) where.itemQuantidadeId = filtro.itemQuantidadeId;
    if (filtro?.tipo) where.tipo = filtro.tipo;
    if (filtro?.empresaId) {
      where.OR = [
        { empresaOrigemId: filtro.empresaId },
        { empresaDestinoId: filtro.empresaId },
        { item: { empresaId: filtro.empresaId } },
        { itemQuantidade: { empresaId: filtro.empresaId } },
      ];
    }

    return prisma.movimentacao.findMany({
      where,
      include: MOVIMENTACAO_COM_RELACOES,
      orderBy: { data: 'desc' },
      take: filtro?.limite ?? 100,
    });
  }
}

export const estoqueRepository = new EstoqueRepository();
