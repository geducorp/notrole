import type { Prisma, SituacaoItem, TipoMovimentacao } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { estoqueRepository } from '../repositories/EstoqueRepository';
import { itemRepository } from '../repositories/ItemRepository';
import { emprestimoRepository, STATUS_EM_ABERTO } from '../repositories/EmprestimoRepository';
import { nomeDoItem } from '../utils/itens';
import { permissaoService, type UsuarioComPermissao } from './PermissaoService';

/**
 * Movimentacoes do estoque.
 *
 * Toda mudanca de situacao passa por aqui e deixa uma linha no extrato. A
 * situacao do equipamento e a movimentacao andam juntas, na mesma transacao:
 * um estoque que diz uma coisa e um extrato que diz outra e pior do que nao
 * ter controle nenhum.
 *
 * Emprestimo e entrega de equipamento NAO ficam aqui: os dois sao cessoes com
 * termo de comodato e moram no EmprestimoService (modalidade TEMPORARIA ou
 * DEFINITIVA), que tambem move o estoque. Aqui ficam transferencia,
 * manutencao, baixa e os saldos dos acessorios.
 */

interface DadosMovimentacao {
  observacao?: string | null;
  operador?: string;
  /** Perfil de quem esta movimentando; limita a empresa (ver PermissaoService). */
  permissao?: UsuarioComPermissao;
}

/**
 * Situacoes em que o equipamento esta "livre" (nao esta com ninguem) e pode
 * ser transferido, ir para manutencao ou receber baixa.
 */
const SITUACOES_LIVRES: SituacaoItem[] = ['EM_ESTOQUE', 'RESERVADO', 'MANUTENCAO', 'BAIXADO'];

export class EstoqueService {
  // -------------------------------------------------------------------------
  // Itens identificados
  // -------------------------------------------------------------------------

  /**
   * O colaborador devolveu um equipamento entregue SEM termo (entregas feitas
   * antes do comodato de entrega existir). As entregas com termo sao devolvidas
   * pela cessao, em Emprestimos e entregas, que gera o comprovante.
   */
  async receberDeVolta(itemId: number, dados: DadosMovimentacao & { condicaoAvariada?: boolean } = {}) {
    const item = await itemRepository.buscarPorId(itemId);
    if (!item) throw AppError.naoEncontrado('Item');
    if (item.situacao !== 'ENTREGUE') {
      throw AppError.conflito('Este equipamento nao esta entregue a ninguem.');
    }
    this.conferirEmpresa(dados, item.empresaId, 'receber equipamentos de volta');

    // Entrega com termo (cessao em aberto) e devolvida pela cessao: e ela que
    // encerra o comodato e gera o comprovante. Receber por aqui deixaria a
    // cessao aberta com o equipamento de volta na prateleira.
    const cessao = await emprestimoRepository.buscarEmAbertoPorItem(itemId);
    if (cessao) throw this.erroCessaoEmAberto(cessao.id, cessao.colaborador.nome);

    const situacao: SituacaoItem = dados.condicaoAvariada ? 'MANUTENCAO' : 'EM_ESTOQUE';

    return prisma.$transaction(async (tx) => {
      // Confere de novo dentro da transacao: a cessao pode ter sido criada
      // entre a leitura acima e aqui.
      const aberta = await tx.emprestimo.findFirst({
        where: { itemId, status: { in: STATUS_EM_ABERTO } },
        include: { colaborador: true },
      });
      if (aberta) throw this.erroCessaoEmAberto(aberta.id, aberta.colaborador.nome);

      await this.atualizarItemSeEstiver(
        tx,
        itemId,
        ['ENTREGUE'],
        { situacao, colaboradorId: null, entregueEm: null, condicao: 'USADO' },
        { colaboradorId: item.colaboradorId },
      );

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: 'DEVOLUCAO',
          itemId,
          colaboradorId: item.colaboradorId,
          empresaDestinoId: item.empresaId,
          usuario: dados.operador,
          observacao: dados.observacao?.trim() || null,
        },
        tx,
      );

      return tx.item.findUniqueOrThrow({ where: { id: itemId } });
    });
  }

  /** Leva o equipamento para o estoque de outra empresa. */
  async transferir(
    itemId: number,
    destino: { empresaId: number },
    dados: DadosMovimentacao = {},
  ) {
    const item = await this.itemLivre(itemId, 'transferir');
    this.conferirEmpresa(dados, item.empresaId, 'transferir equipamentos');

    if (item.empresaId === destino.empresaId) {
      throw AppError.conflito('O equipamento ja esta no estoque dessa empresa.');
    }

    return prisma.$transaction(async (tx) => {
      // A empresa de origem tambem vai no where: o extrato registra de onde o
      // equipamento saiu, e isso precisa ser verdade no momento da gravacao.
      await this.atualizarItemSeEstiver(tx, itemId, SITUACOES_LIVRES, { empresaId: destino.empresaId }, {
        empresaId: item.empresaId,
      });

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: 'TRANSFERENCIA',
          itemId,
          empresaOrigemId: item.empresaId,
          empresaDestinoId: destino.empresaId,
          usuario: dados.operador,
          observacao: dados.observacao?.trim() || null,
        },
        tx,
      );

      return tx.item.findUniqueOrThrow({ where: { id: itemId } });
    });
  }

  async enviarParaManutencao(itemId: number, dados: DadosMovimentacao = {}) {
    const item = await this.itemLivre(itemId, 'enviar para manutencao');
    this.conferirEmpresa(dados, item.empresaId, 'enviar equipamentos para manutencao');
    if (item.situacao === 'MANUTENCAO') {
      throw AppError.conflito('Este equipamento ja esta em manutencao.');
    }

    return this.mudarSituacao(
      item,
      'MANUTENCAO',
      'MANUTENCAO',
      dados,
      SITUACOES_LIVRES.filter((s) => s !== 'MANUTENCAO'),
    );
  }

  async retornarDaManutencao(itemId: number, dados: DadosMovimentacao = {}) {
    const item = await itemRepository.buscarPorId(itemId);
    if (!item) throw AppError.naoEncontrado('Item');
    if (item.situacao !== 'MANUTENCAO') {
      throw AppError.conflito('Este equipamento nao esta em manutencao.');
    }
    this.conferirEmpresa(dados, item.empresaId, 'dar baixa ou retorno de manutencao');

    return this.mudarSituacao(item, 'EM_ESTOQUE', 'RETORNO_MANUTENCAO', dados, ['MANUTENCAO']);
  }

  /** Descarte, perda ou venda: sai de circulacao sem perder o historico. */
  async darBaixa(itemId: number, dados: DadosMovimentacao = {}) {
    const item = await this.itemLivre(itemId, 'dar baixa');
    this.conferirEmpresa(dados, item.empresaId, 'dar baixa em equipamentos');
    if (item.situacao === 'BAIXADO') throw AppError.conflito('Este equipamento ja recebeu baixa.');
    if (!dados.observacao?.trim()) {
      throw new AppError('Informe o motivo da baixa (descarte, perda, venda).', 422);
    }

    return this.mudarSituacao(
      item,
      'BAIXADO',
      'BAIXA',
      dados,
      SITUACOES_LIVRES.filter((s) => s !== 'BAIXADO'),
    );
  }

  /**
   * Muda a situacao so se o equipamento AINDA estiver numa das situacoes
   * permitidas (e na mesma empresa) no momento da gravacao. A conferencia
   * feita antes, fora da transacao, serve para a mensagem; quem decide e o
   * where do updateMany - o mesmo padrao da reserva no emprestimo.
   */
  private async mudarSituacao(
    item: { id: number; empresaId: number },
    situacao: SituacaoItem,
    tipo: TipoMovimentacao,
    dados: DadosMovimentacao,
    permitidas: SituacaoItem[],
  ) {
    return prisma.$transaction(async (tx) => {
      await this.atualizarItemSeEstiver(tx, item.id, permitidas, { situacao }, { empresaId: item.empresaId });

      await estoqueRepository.registrarMovimentacao(
        {
          tipo,
          itemId: item.id,
          empresaOrigemId: item.empresaId,
          usuario: dados.operador,
          observacao: dados.observacao?.trim() || null,
        },
        tx,
      );

      return tx.item.findUniqueOrThrow({ where: { id: item.id } });
    });
  }

  /**
   * Update condicional do item: so grava se a situacao no banco ainda for uma
   * das esperadas. Count 0 = alguem mexeu no equipamento depois que a tela
   * foi aberta (ou foi um duplo clique) - 409, sem movimentacao duplicada.
   */
  private async atualizarItemSeEstiver(
    tx: Prisma.TransactionClient,
    itemId: number,
    permitidas: SituacaoItem[],
    data: Prisma.ItemUncheckedUpdateManyInput,
    condicaoExtra: Prisma.ItemWhereInput = {},
  ) {
    const resultado = await tx.item.updateMany({
      where: { id: itemId, situacao: { in: permitidas }, ...condicaoExtra },
      data,
    });
    if (resultado.count === 0) {
      throw AppError.conflito('Este equipamento foi alterado por outra pessoa. Atualize a tela.');
    }
  }

  private erroCessaoEmAberto(emprestimoId: number, colaborador: string) {
    return AppError.conflito(
      `Este equipamento tem uma cessao com termo em aberto (n. ${emprestimoId}, ${colaborador}). ` +
        'Registre a devolucao em Emprestimos e entregas: ela encerra o termo e gera o comprovante.',
    );
  }

  /** So mexe no estoque da propria empresa (administrador mexe em todas). */
  private conferirEmpresa(dados: DadosMovimentacao, empresaId: number, acao: string) {
    if (dados.permissao) permissaoService.exigirEmpresa(dados.permissao, empresaId, acao);
  }

  /** Recusa mexer em equipamento emprestado ou entregue. */
  private async itemLivre(itemId: number, acao: string) {
    const item = await itemRepository.buscarPorId(itemId);
    if (!item) throw AppError.naoEncontrado('Item');

    if (item.situacao === 'EMPRESTADO') {
      throw AppError.conflito(
        `Nao da para ${acao}: o equipamento esta emprestado. Registre a devolucao antes.`,
      );
    }
    if (item.situacao === 'ENTREGUE') {
      throw AppError.conflito(
        `Nao da para ${acao}: o equipamento esta com ${item.colaborador?.nome ?? 'um colaborador'}. ` +
          'Registre a devolucao ao estoque antes.',
      );
    }

    return item;
  }

  // -------------------------------------------------------------------------
  // Itens por quantidade
  // -------------------------------------------------------------------------

  /** Entrada de saldo (compra ou reposicao). */
  async entradaDeQuantidade(
    id: number,
    quantidade: number,
    dados: DadosMovimentacao & { tipo?: TipoMovimentacao } = {},
  ) {
    if (quantidade <= 0) throw new AppError('A quantidade precisa ser maior que zero.', 422);

    const registro = await estoqueRepository.buscarQuantidade(id);
    if (!registro) throw AppError.naoEncontrado('Item de estoque');
    this.conferirEmpresa(dados, registro.empresaId, 'dar entrada no estoque');

    return prisma.$transaction(async (tx) => {
      // increment e atomico no banco: duas entradas simultaneas somam as duas.
      const atualizado = await tx.itemQuantidade.update({
        where: { id },
        data: { quantidade: { increment: quantidade } },
      });

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: dados.tipo ?? 'ENTRADA',
          itemQuantidadeId: id,
          quantidade,
          empresaDestinoId: registro.empresaId,
          usuario: dados.operador,
          observacao: dados.observacao?.trim() || null,
        },
        tx,
      );

      return atualizado;
    });
  }

  /** Saida de saldo: entrega a um colaborador ou uso interno. */
  async saidaDeQuantidade(
    id: number,
    quantidade: number,
    dados: DadosMovimentacao & { colaboradorId?: number | null } = {},
  ) {
    if (quantidade <= 0) throw new AppError('A quantidade precisa ser maior que zero.', 422);

    const registro = await estoqueRepository.buscarQuantidade(id);
    if (!registro) throw AppError.naoEncontrado('Item de estoque');

    this.conferirEmpresa(dados, registro.empresaId, 'dar saida no estoque');

    if (registro.quantidade < quantidade) {
      throw AppError.conflito(
        `Saldo insuficiente: ha ${registro.quantidade} em estoque e a saida e de ${quantidade}.`,
      );
    }

    return prisma.$transaction(async (tx) => {
      // O saldo e conferido no proprio update: duas saidas ao mesmo tempo nao
      // conseguem, juntas, deixar o saldo negativo.
      const baixa = await tx.itemQuantidade.updateMany({
        where: { id, quantidade: { gte: quantidade } },
        data: { quantidade: { decrement: quantidade } },
      });
      if (baixa.count === 0) {
        throw AppError.conflito(
          'Saldo insuficiente: outra movimentacao mudou o saldo deste item. Atualize a tela.',
        );
      }

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: 'ENTREGA',
          itemQuantidadeId: id,
          quantidade,
          colaboradorId: dados.colaboradorId ?? null,
          empresaOrigemId: registro.empresaId,
          usuario: dados.operador,
          observacao: dados.observacao?.trim() || null,
        },
        tx,
      );

      return tx.itemQuantidade.findUniqueOrThrow({ where: { id } });
    });
  }

  /** Correcao de saldo depois de uma conferencia de prateleira. */
  async ajustarQuantidade(id: number, novaQuantidade: number, dados: DadosMovimentacao = {}) {
    if (novaQuantidade < 0) throw new AppError('A quantidade nao pode ser negativa.', 422);

    const registro = await estoqueRepository.buscarQuantidade(id);
    if (!registro) throw AppError.naoEncontrado('Item de estoque');

    this.conferirEmpresa(dados, registro.empresaId, 'ajustar o estoque');

    const diferenca = novaQuantidade - registro.quantidade;
    if (diferenca === 0) throw AppError.conflito('O saldo informado e igual ao atual.');
    const motivo = dados.observacao?.trim();
    if (!motivo) {
      throw new AppError('Explique o motivo do ajuste (conferencia, perda, erro de lancamento).', 422);
    }

    return prisma.$transaction(async (tx) => {
      // Otimista: o ajuste foi calculado sobre o saldo lido. Se ele mudou no
      // meio do caminho, a diferenca registrada no extrato estaria errada.
      const ajuste = await tx.itemQuantidade.updateMany({
        where: { id, quantidade: registro.quantidade },
        data: { quantidade: novaQuantidade },
      });
      if (ajuste.count === 0) {
        throw AppError.conflito(
          'O saldo deste item mudou desde que a tela foi aberta. Atualize a tela e confira de novo.',
        );
      }

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: 'AJUSTE',
          itemQuantidadeId: id,
          quantidade: Math.abs(diferenca),
          empresaDestinoId: registro.empresaId,
          usuario: dados.operador,
          observacao:
            `${diferenca > 0 ? 'Sobra' : 'Falta'} de ${Math.abs(diferenca)} ` +
            `(de ${registro.quantidade} para ${novaQuantidade}). ${motivo}`,
        },
        tx,
      );

      return tx.itemQuantidade.findUniqueOrThrow({ where: { id } });
    });
  }

  // -------------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------------

  /**
   * Quem esta com o quê, agrupado por setor.
   *
   * Junta as duas formas de um equipamento sair do estoque: a entrega
   * definitiva (item.colaboradorId) e o emprestimo em aberto. Responde
   * "quantos notebooks o Financeiro tem" e "o que esta com o Fulano".
   */
  async distribuicaoPorSetor(empresaId?: number) {
    const [entregues, emprestimos] = await Promise.all([
      itemRepository.listar({ comColaborador: true, ...(empresaId ? { empresaId } : {}) }),
      // Entregas ja aparecem pelo item (colaboradorId); aqui so os emprestimos.
      emprestimoRepository.listarEmAberto('TEMPORARIA', empresaId),
    ]);

    interface EquipamentoDaPessoa {
      itemId: number;
      nome: string;
      categoria: string;
      empresa: string;
      forma: 'ENTREGA' | 'EMPRESTIMO';
      desde: Date;
    }

    const pessoas = new Map<
      number,
      { nome: string; email: string; departamento: string; equipamentos: EquipamentoDaPessoa[] }
    >();

    const registrar = (
      colaborador: { id: number; nome: string; email: string; departamento: string | null },
      equipamento: EquipamentoDaPessoa,
    ) => {
      const atual = pessoas.get(colaborador.id) ?? {
        nome: colaborador.nome,
        email: colaborador.email,
        departamento: colaborador.departamento?.trim() || 'Sem departamento',
        equipamentos: [],
      };
      atual.equipamentos.push(equipamento);
      pessoas.set(colaborador.id, atual);
    };

    for (const item of entregues) {
      if (!item.colaborador) continue;
      registrar(item.colaborador, {
        itemId: item.id,
        nome: nomeDoItem(item),
        categoria: item.categoria.nome,
        empresa: item.empresa.apelido,
        forma: 'ENTREGA',
        desde: item.entregueEm ?? item.updatedAt,
      });
    }

    for (const emprestimo of emprestimos) {
      if (empresaId && emprestimo.item.empresaId !== empresaId) continue;
      registrar(emprestimo.colaborador, {
        itemId: emprestimo.itemId,
        nome: nomeDoItem(emprestimo.item),
        categoria: emprestimo.item.categoria.nome,
        empresa: emprestimo.empresa?.apelido ?? '-',
        forma: 'EMPRESTIMO',
        desde: emprestimo.dataInicio,
      });
    }

    const setores = new Map<string, Array<(typeof pessoas extends Map<number, infer V> ? V : never)>>();
    for (const pessoa of pessoas.values()) {
      const lista = setores.get(pessoa.departamento) ?? [];
      lista.push(pessoa);
      setores.set(pessoa.departamento, lista);
    }

    return [...setores.entries()]
      .map(([departamento, lista]) => {
        const equipamentos = lista.flatMap((p) => p.equipamentos);
        const porCategoria = new Map<string, number>();
        for (const e of equipamentos) porCategoria.set(e.categoria, (porCategoria.get(e.categoria) ?? 0) + 1);

        return {
          departamento,
          pessoas: lista
            .map((p) => ({ ...p, equipamentos: p.equipamentos.sort((a, b) => a.nome.localeCompare(b.nome)) }))
            .sort((a, b) => a.nome.localeCompare(b.nome)),
          total: equipamentos.length,
          emprestados: equipamentos.filter((e) => e.forma === 'EMPRESTIMO').length,
          porCategoria: [...porCategoria.entries()]
            .map(([categoria, total]) => ({ categoria, total }))
            .sort((a, b) => b.total - a.total),
        };
      })
      .sort((a, b) => b.total - a.total);
  }

  async resumo(empresaId?: number) {
    const [porSituacao, porCategoria, porCategoriaESituacao, categorias, valor, quantidades, abaixoDoMinimo] =
      await Promise.all([
        itemRepository.contarPorSituacao(empresaId),
        itemRepository.contarPorCategoria(empresaId),
        itemRepository.contarPorCategoriaESituacao(empresaId),
        // Todas, inclusive inativas: so dao nome aos itens. Com so as ativas,
        // os itens de uma categoria desativada viravam "Sem categoria".
        estoqueRepository.listarCategorias(),
        itemRepository.somarValorEmEstoque(empresaId),
        estoqueRepository.listarQuantidades(empresaId ? { empresaId } : undefined),
        estoqueRepository.listarAbaixoDoMinimo(empresaId),
      ]);

    const contar = (situacao: SituacaoItem) =>
      porSituacao.find((s) => s.situacao === situacao)?._count._all ?? 0;

    return {
      itens: {
        emEstoque: contar('EM_ESTOQUE'),
        emprestados: contar('EMPRESTADO'),
        entregues: contar('ENTREGUE'),
        emManutencao: contar('MANUTENCAO'),
        reservados: contar('RESERVADO'),
        baixados: contar('BAIXADO'),
      },
      porCategoria: porCategoria.map((c) => ({
        categoria: categorias.find((cat) => cat.id === c.categoriaId)?.nome ?? 'Sem categoria',
        total: c._count._all,
      })),
      porCategoriaESituacao: porCategoriaESituacao.map((c) => ({
        categoria: categorias.find((cat) => cat.id === c.categoriaId)?.nome ?? 'Sem categoria',
        situacao: c.situacao,
        total: c._count._all,
        valor: c._sum.valor?.toString() ?? '0',
      })),
      valorEmEstoque: valor._sum.valor?.toString() ?? '0',
      quantidades: {
        tipos: quantidades.length,
        unidades: quantidades.reduce((soma, q) => soma + q.quantidade, 0),
      },
      abaixoDoMinimo,
    };
  }
}

export const estoqueService = new EstoqueService();
