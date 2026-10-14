import { Prisma, type ModalidadeCessao, type StatusEmprestimo } from '@prisma/client';
import { prisma } from '../config/prisma';

const COM_RELACOES = {
  item: { include: { categoria: true } },
  colaborador: true,
  empresa: true,
} satisfies Prisma.EmprestimoInclude;

/** Para reler o emprestimo dentro de uma transacao com as mesmas relacoes. */
export const EMPRESTIMO_COM_RELACOES = COM_RELACOES;

export type EmprestimoCompleto = Prisma.EmprestimoGetPayload<{ include: typeof COM_RELACOES }>;

/** Status em que o equipamento ainda esta com o colaborador. */
export const STATUS_EM_ABERTO: StatusEmprestimo[] = ['AGUARDANDO_ASSINATURA', 'ATIVO'];

export class EmprestimoRepository {
  criar(data: Prisma.EmprestimoCreateInput) {
    return prisma.emprestimo.create({ data, include: COM_RELACOES });
  }

  /**
   * `orderBy: { dataEmprestimo: 'desc' }` apontava para um campo que nunca
   * existiu no schema - o correto e `dataInicio`. A listagem de emprestimos
   * quebrava por causa disso.
   */
  listar(filtro?: {
    status?: StatusEmprestimo;
    colaboradorId?: number;
    itemId?: number;
    modalidade?: ModalidadeCessao;
    /** Empresa do equipamento. */
    empresaId?: number;
  }) {
    const where: Prisma.EmprestimoWhereInput = {};
    if (filtro?.status) where.status = filtro.status;
    if (filtro?.empresaId) where.item = { empresaId: filtro.empresaId };
    if (filtro?.modalidade) where.modalidade = filtro.modalidade;
    if (filtro?.colaboradorId) where.colaboradorId = filtro.colaboradorId;
    if (filtro?.itemId) where.itemId = filtro.itemId;

    return prisma.emprestimo.findMany({
      where,
      include: COM_RELACOES,
      orderBy: { dataInicio: 'desc' },
    });
  }

  buscarPorId(id: number) {
    return prisma.emprestimo.findUnique({ where: { id }, include: COM_RELACOES });
  }

  /**
   * Cessoes em aberto. Sem modalidade, traz emprestimos e entregas; sem
   * empresa, de todas (as rotinas de e-mail usam assim).
   */
  listarEmAberto(modalidade?: ModalidadeCessao, empresaId?: number) {
    return prisma.emprestimo.findMany({
      where: {
        status: { in: STATUS_EM_ABERTO },
        ...(modalidade ? { modalidade } : {}),
        ...(empresaId ? { item: { empresaId } } : {}),
      },
      include: COM_RELACOES,
      orderBy: { dataPrevista: 'asc' },
    });
  }

  listarAtivos() {
    return prisma.emprestimo.findMany({
      where: { status: 'ATIVO', modalidade: 'TEMPORARIA' },
      include: COM_RELACOES,
      orderBy: { dataPrevista: 'asc' },
    });
  }

  /** Emprestimos ativos cujo prazo vence dentro da janela informada. */
  listarAtivosVencendoEntre(inicio: Date, fim: Date) {
    return prisma.emprestimo.findMany({
      where: { status: 'ATIVO', modalidade: 'TEMPORARIA', dataPrevista: { gte: inicio, lte: fim } },
      include: COM_RELACOES,
    });
  }

  listarAtivosVencidosAte(limite: Date) {
    return prisma.emprestimo.findMany({
      where: { status: 'ATIVO', modalidade: 'TEMPORARIA', dataPrevista: { lt: limite } },
      include: COM_RELACOES,
    });
  }

  buscarEmAbertoPorItem(itemId: number) {
    return prisma.emprestimo.findFirst({
      where: { itemId, status: { in: STATUS_EM_ABERTO } },
      include: COM_RELACOES,
    });
  }

  /** Leitura leve, usada entre as etapas da geracao do termo. */
  buscarSituacaoDoTermo(id: number) {
    return prisma.emprestimo.findUnique({
      where: { id },
      select: { status: true, d4signDocumentId: true },
    });
  }

  buscarPorDocumentoD4Sign(documentId: string) {
    return prisma.emprestimo.findFirst({
      where: { d4signDocumentId: documentId },
      include: COM_RELACOES,
    });
  }

  /**
   * Fila de geracao de termos: emprestimos aguardando assinatura cujo termo
   * ainda nao terminou de ser enviado ao colaborador.
   *
   * Ficam de FORA os que esgotaram as tentativas ou tiveram falha ambigua -
   * esses esperam um operador conferir o painel do D4Sign. Antes eles voltavam
   * para a fila a cada cinco minutos, para sempre, gastando chamadas que a
   * empresa paga.
   *
   * A fila mora no banco, e nao em memoria, para sobreviver a um restart.
   */
  listarComTermoPendente(maxTentativas: number, limite = 20) {
    return prisma.emprestimo.findMany({
      // AND explicito: com "...filtro, OR: [...]" o OR daqui sobrescrevia o OR
      // da etapa, e termos ja ENVIADOS voltavam para a fila (sem custo - gerar()
      // nao faz nada nessa etapa - mas errado).
      where: {
        AND: [
          this.filtroTermoPendente(maxTentativas),
          { OR: [{ d4signProximaTentativa: null }, { d4signProximaTentativa: { lte: new Date() } }] },
        ],
      },
      include: COM_RELACOES,
      orderBy: { createdAt: 'asc' },
      take: limite,
    });
  }

  contarTermosPendentes(maxTentativas: number, empresaId?: number) {
    return prisma.emprestimo.count({
      where: { ...this.filtroTermoPendente(maxTentativas), ...(empresaId ? { item: { empresaId } } : {}) },
    });
  }

  private filtroTermoPendente(maxTentativas: number): Prisma.EmprestimoWhereInput {
    return {
      status: 'AGUARDANDO_ASSINATURA',
      d4signTentativas: { lt: maxTentativas },
      // Nao usar NOT: { d4signStatus: 'DISPENSADO' } - no SQL, NOT (NULL = 'X')
      // e NULL, e todo termo novo (status ainda nulo) ficava fora da fila.
      AND: [
        { OR: [{ d4signEtapa: null }, { d4signEtapa: { not: 'ENVIADO' } }] },
        { OR: [{ d4signStatus: null }, { d4signStatus: { not: 'DISPENSADO' } }] },
      ],
    };
  }

  /** Termos que pararam e esperam alguem conferir o painel do D4Sign. */
  contarTermosPrecisandoAtencao(maxTentativas: number, empresaId?: number) {
    return prisma.emprestimo.count({
      where: {
        ...(empresaId ? { item: { empresaId } } : {}),
        status: 'AGUARDANDO_ASSINATURA',
        d4signTentativas: { gte: maxTentativas },
        OR: [{ d4signEtapa: null }, { d4signEtapa: { not: 'ENVIADO' } }],
      },
    });
  }

  /**
   * Termos ja enviados e ainda nao assinados, elegiveis para a consulta
   * automatica: nao consultados desde verificadoAntesDe e criados depois de
   * criadoDepoisDe (passado o prazo, o sistema para de perguntar sozinho).
   */
  listarAguardandoAssinatura(verificadoAntesDe: Date, criadoDepoisDe: Date, limite = 20) {
    return prisma.emprestimo.findMany({
      where: {
        status: 'AGUARDANDO_ASSINATURA',
        d4signEtapa: 'ENVIADO',
        d4signAssinadoEm: null,
        createdAt: { gte: criadoDepoisDe },
        AND: [
          { OR: [{ d4signVerificadoEm: null }, { d4signVerificadoEm: { lt: verificadoAntesDe } }] },
          // Termo cancelado direto no D4Sign (marca gravada pelo
          // TermoService.aplicarStatus) nao muda mais: consultar so gasta cota.
          // OR com null pelo mesmo motivo do filtroTermoPendente.
          {
            OR: [
              { d4signStatus: null },
              { d4signStatus: { not: { startsWith: 'CANCELADO NO D4SIGN' } } },
            ],
          },
        ],
      },
      include: COM_RELACOES,
      orderBy: [{ d4signVerificadoEm: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: limite,
    });
  }

  /** Termos enviados cujo e-mail de convite ainda precisa ser conferido. */
  listarEmailsAConferir(agora: Date, criadoDepoisDe: Date, limite = 20) {
    return prisma.emprestimo.findMany({
      where: {
        status: 'AGUARDANDO_ASSINATURA',
        d4signEtapa: 'ENVIADO',
        d4signAssinadoEm: null,
        d4signEmailConferido: false,
        createdAt: { gte: criadoDepoisDe },
        d4signConferirEmailEm: { lte: agora },
      },
      include: COM_RELACOES,
      orderBy: { d4signConferirEmailEm: 'asc' },
      take: limite,
    });
  }

  contarAvisosDeEmail(empresaId?: number) {
    return prisma.emprestimo.count({
      where: {
        status: 'AGUARDANDO_ASSINATURA',
        d4signAvisoEmail: { not: null },
        ...(empresaId ? { item: { empresaId } } : {}),
      },
    });
  }

  /** Documentos criados no D4Sign desde a data - cada um e cobrado. */
  contarDocumentosCriadosDesde(desde: Date) {
    return prisma.emprestimo.count({
      where: { d4signDocumentId: { not: null }, createdAt: { gte: desde } },
    });
  }

  /**
   * Reivindica a cobranca de hoje ANTES de enviar: so grava se o emprestimo
   * continua ativo e ainda nao foi cobrado hoje. true = este processo envia.
   */
  async reivindicarCobranca(id: number, agora: Date, inicioDeHoje: Date): Promise<boolean> {
    const r = await prisma.emprestimo.updateMany({
      where: {
        id,
        status: 'ATIVO',
        OR: [{ ultimaCobrancaEm: null }, { ultimaCobrancaEm: { lt: inicioDeHoje } }],
      },
      data: { ultimaCobrancaEm: agora },
    });
    return r.count === 1;
  }

  /** Envio falhou: devolve o valor anterior, se ninguem mexeu depois. */
  desfazerCobranca(id: number, reivindicadoEm: Date, anterior: Date | null) {
    return prisma.emprestimo.updateMany({
      where: { id, ultimaCobrancaEm: reivindicadoEm },
      data: { ultimaCobrancaEm: anterior },
    });
  }

  /** Um lembrete previo por prazo (a renovacao zera o campo). */
  async reivindicarLembrete(id: number, agora: Date): Promise<boolean> {
    const r = await prisma.emprestimo.updateMany({
      where: { id, status: 'ATIVO', lembretePrevioEm: null },
      data: { lembretePrevioEm: agora },
    });
    return r.count === 1;
  }

  desfazerLembrete(id: number, reivindicadoEm: Date) {
    return prisma.emprestimo.updateMany({
      where: { id, lembretePrevioEm: reivindicadoEm },
      data: { lembretePrevioEm: null },
    });
  }

  atualizar(id: number, data: Prisma.EmprestimoUpdateInput) {
    return prisma.emprestimo.update({ where: { id }, data, include: COM_RELACOES });
  }

  contarPorStatus() {
    return prisma.emprestimo.groupBy({ by: ['status'], _count: { _all: true } });
  }

  /**
   * Quantos emprestimos cada departamento teve no periodo. Alimenta o grafico
   * do dashboard, que ate entao exibia numeros fixos escritos no codigo.
   */
  /** Emprestimos (com prazo) do periodo, por departamento (e empresa do equipamento). */
  async contarPorDepartamento(desde: Date, empresaId?: number) {
    const linhas = await prisma.emprestimo.findMany({
      where: {
        dataInicio: { gte: desde },
        modalidade: 'TEMPORARIA',
        ...(empresaId ? { item: { empresaId } } : {}),
      },
      select: { colaborador: { select: { departamento: true } } },
    });

    const acumulado = new Map<string, number>();
    for (const linha of linhas) {
      const departamento = linha.colaborador?.departamento?.trim() || 'Nao informado';
      acumulado.set(departamento, (acumulado.get(departamento) ?? 0) + 1);
    }

    return [...acumulado.entries()]
      .map(([departamento, total]) => ({ departamento, total }))
      .sort((a, b) => b.total - a.total);
  }
}

export const emprestimoRepository = new EmprestimoRepository();
