import PDFDocument from 'pdfkit';
import type { Writable } from 'stream';
import type { SituacaoItem } from '@prisma/client';
import { itemRepository } from '../repositories/ItemRepository';
import { emprestimoRepository } from '../repositories/EmprestimoRepository';
import { diasDeAtraso, estaAtrasado, formatarData } from '../utils/datas';
import { nomeDoItem } from '../utils/itens';

const ROTULO_SITUACAO: Record<SituacaoItem, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  EMPRESTADO: 'Emprestado',
  ENTREGUE: 'Entregue',
  MANUTENCAO: 'Em manutencao',
  BAIXADO: 'Baixado',
};

export class ReportService {
  /**
   * A promessa do PDF termina quando a resposta termina - inclusive se o
   * navegador cancelar o download no meio ('close' sem 'finish') ou a conexao
   * cair ('error'). Antes so 'finish' resolvia, e um download cancelado deixava
   * a promessa pendurada para sempre.
   */
  private aguardarFimDaSaida(saida: Writable, resolve: () => void, reject: (erro: unknown) => void) {
    saida.once('finish', () => resolve());
    saida.once('close', () => resolve());
    saida.once('error', (erro) => reject(erro));
  }

  /**
   * Metricas do dashboard.
   *
   * A versao anterior filtrava por status 'EMPRESTADO', valor que nunca existiu
   * no enum (o correto e EM_USO), entao o cartao "Emprestados" mostrava zero
   * permanentemente. O calculo de atraso tambem comparava a data prevista com
   * o instante atual, marcando como atrasado um emprestimo que vencia no
   * proprio dia.
   */
  async obterMetricasDashboard(empresaId?: number) {
    const [contagemItens, total, todosEmAberto, porDepartamento, disponiveis] = await Promise.all([
      itemRepository.contarPorSituacao(empresaId),
      itemRepository.contarTotal(empresaId),
      // So emprestimo (com prazo): a entrega definitiva nao vence nem atrasa.
      emprestimoRepository.listarEmAberto('TEMPORARIA', empresaId),
      emprestimoRepository.contarPorDepartamento(this.inicioDoAno(), empresaId),
      itemRepository.contarDisponiveisParaEmprestimo(empresaId),
    ]);

    const emAberto = empresaId
      ? todosEmAberto.filter((e) => e.item.empresaId === empresaId)
      : todosEmAberto;
    const colaboradoresComEquipamento = new Set(emAberto.map((e) => e.colaboradorId)).size;

    const porSituacao = (situacao: SituacaoItem) =>
      contagemItens.find((c) => c.situacao === situacao)?._count._all ?? 0;

    const comPrazo = emAberto.filter(
      (e): e is typeof e & { dataPrevista: Date } => e.dataPrevista !== null,
    );
    const atrasados = comPrazo.filter((e) => estaAtrasado(e.dataPrevista));

    const agora = new Date();
    const limiteProximos = new Date(agora);
    limiteProximos.setDate(limiteProximos.getDate() + 7);

    const vencendoEmBreve = comPrazo.filter(
      (e) => !estaAtrasado(e.dataPrevista) && e.dataPrevista <= limiteProximos,
    );

    return {
      inventario: {
        total,
        disponiveis: porSituacao('EM_ESTOQUE'),
        emprestados: porSituacao('EMPRESTADO'),
        entregues: porSituacao('ENTREGUE'),
        reservados: porSituacao('RESERVADO'),
        emManutencao: porSituacao('MANUTENCAO'),
        descontinuados: porSituacao('BAIXADO'),
      },
      emprestimos: {
        emAberto: emAberto.length,
        aguardandoAssinatura: emAberto.filter((e) => e.status === 'AGUARDANDO_ASSINATURA').length,
        colaboradoresComEquipamento,
        disponiveis,
      },
      alertas: {
        devolucoesAtrasadas: atrasados.length,
        vencendoEmSeteDias: vencendoEmBreve.length,
        // Os cinco atrasos mais antigos, para o operador agir direto do painel.
        maioresAtrasos: atrasados
          .sort((a, b) => a.dataPrevista.getTime() - b.dataPrevista.getTime())
          .slice(0, 5)
          .map((e) => ({
            id: e.id,
            colaborador: e.colaborador.nome,
            email: e.colaborador.email,
            hostname: nomeDoItem(e.item),
            dataPrevista: e.dataPrevista,
            diasAtraso: diasDeAtraso(e.dataPrevista),
          })),
      },
      // Esse grafico exibia numeros fixos escritos no codigo
      // (TI 40, Vendas 35, RH 15...). Agora vem do banco.
      emprestimosPorDepartamento: porDepartamento,
    };
  }

  private inicioDoAno(): Date {
    const d = new Date();
    return new Date(d.getFullYear(), 0, 1);
  }

  /**
   * Relatorio de inventario em PDF.
   *
   * Usava `nb.marca` e `nb.patrimonio`, campos que nao existiam no schema, e o
   * download quebrava com erro 500.
   */
  async gerarRelatorioItens(
    saida: Writable,
    filtro: { empresaId?: number; categoriaId?: number } = {},
  ): Promise<void> {
    const itens = await itemRepository.listar({
      ...(filtro.empresaId ? { empresaId: filtro.empresaId } : {}),
      ...(filtro.categoriaId ? { categoriaId: filtro.categoriaId } : {}),
    });
    const emAberto = await emprestimoRepository.listarEmAberto(undefined, filtro.empresaId);

    const responsavelPorItem = new Map(emAberto.map((e) => [e.itemId, e]));

    return new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });

      doc.pipe(saida);
      this.aguardarFimDaSaida(saida, resolve, reject);
      doc.on('error', reject);

      doc.fontSize(18).font('Helvetica-Bold').text('Relatorio de Estoque de TI', { align: 'center' });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#666666')
        .text('Notrole | Gerado em ' + formatarData(new Date()), { align: 'center' });
      doc.fillColor('#000000');
      doc.moveDown(1.2);

      const resumo = itens.reduce<Record<string, number>>((acc, item) => {
        acc[item.situacao] = (acc[item.situacao] ?? 0) + 1;
        return acc;
      }, {});

      doc.fontSize(11).font('Helvetica-Bold').text('Resumo');
      doc.font('Helvetica').fontSize(10);
      doc.text('Total de equipamentos: ' + itens.length);
      for (const [situacao, quantidade] of Object.entries(resumo)) {
        doc.text('  ' + (ROTULO_SITUACAO[situacao as SituacaoItem] ?? situacao) + ': ' + quantidade);
      }
      doc.moveDown(1);

      doc.fontSize(11).font('Helvetica-Bold').text('Equipamentos');
      doc.moveDown(0.5);

      if (itens.length === 0) {
        doc.font('Helvetica').fontSize(10).text('Nenhum equipamento cadastrado.');
      }

      itens.forEach((nb, indice) => {
        // Quebra de pagina antes de um item que nao caberia inteiro.
        if (doc.y > 720) doc.addPage();

        doc
          .font('Helvetica-Bold')
          .fontSize(10)
          .text(
            indice + 1 + '. ' + nomeDoItem(nb) + '  -  ' + [nb.marca, nb.modelo].filter(Boolean).join(' '),
          );

        doc.font('Helvetica').fontSize(9).fillColor('#333333');
        doc.text('    Categoria: ' + nb.categoria.nome + '   |   Empresa: ' + nb.empresa.apelido);
        doc.text('    Patrimonio / Service Tag: ' + (nb.patrimonio ?? '-'));
        doc.text(
          '    Situacao: ' +
            (ROTULO_SITUACAO[nb.situacao] ?? nb.situacao) +
            '   |   Condicao: ' +
            (nb.condicao === 'NOVO' ? 'Novo' : 'Usado') +
            (nb.valor ? '   |   Valor: R$ ' + nb.valor.toString() : ''),
        );
        if (nb.colaborador) doc.text('    Entregue para: ' + nb.colaborador.nome);

        const emprestimo = responsavelPorItem.get(nb.id);
        if (emprestimo && emprestimo.dataPrevista) {
          const atraso = diasDeAtraso(emprestimo.dataPrevista);
          doc.text(
            '    Com: ' +
              emprestimo.colaborador.nome +
              ' (' +
              (emprestimo.colaborador.departamento ?? 'sem departamento') +
              ')',
          );
          doc.text(
            '    Devolucao prevista: ' +
              formatarData(emprestimo.dataPrevista) +
              (atraso > 0 ? '   ATRASADO ha ' + atraso + ' dia(s)' : ''),
          );
        }

        if (nb.observacoes) doc.text('    Obs.: ' + nb.observacoes);

        doc.fillColor('#000000').moveDown(0.6);
      });

      doc.end();
    });
  }

  /**
   * Relatorio dos emprestimos em aberto, com destaque para os atrasados. Com
   * empresa, so os equipamentos dela.
   */
  async gerarRelatorioEmprestimos(saida: Writable, empresaId?: number): Promise<void> {
    // So emprestimos (com prazo); as entregas definitivas ficam no relatorio
    // do estoque, na coluna de quem esta com cada equipamento.
    const emAberto = await emprestimoRepository.listarEmAberto('TEMPORARIA', empresaId);

    return new Promise<void>((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });

      doc.pipe(saida);
      this.aguardarFimDaSaida(saida, resolve, reject);
      doc.on('error', reject);

      doc.fontSize(18).font('Helvetica-Bold').text('Emprestimos em Aberto', { align: 'center' });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .font('Helvetica')
        .fillColor('#666666')
        .text('Notrole | Gerado em ' + formatarData(new Date()), { align: 'center' });
      doc.fillColor('#000000').moveDown(1.2);

      if (emAberto.length === 0) {
        doc.fontSize(10).text('Nenhum emprestimo em aberto no momento.');
        doc.end();
        return;
      }

      const atrasados = emAberto.filter((e) => e.dataPrevista && estaAtrasado(e.dataPrevista));
      doc.fontSize(10).font('Helvetica');
      doc.text('Total em aberto: ' + emAberto.length);
      doc.text('Em atraso: ' + atrasados.length);
      doc.moveDown(1);

      emAberto
        .sort((a, b) => (a.dataPrevista?.getTime() ?? 0) - (b.dataPrevista?.getTime() ?? 0))
        .forEach((e, indice) => {
          if (doc.y > 720) doc.addPage();

          const atraso = e.dataPrevista ? diasDeAtraso(e.dataPrevista) : 0;

          doc.font('Helvetica-Bold').fontSize(10);
          if (atraso > 0) doc.fillColor('#b91c1c');
          doc.text(indice + 1 + '. ' + e.colaborador.nome + '  -  ' + nomeDoItem(e.item));
          doc.fillColor('#000000');

          doc.font('Helvetica').fontSize(9).fillColor('#333333');
          doc.text('    ' + e.colaborador.email + '   |   ' + (e.colaborador.departamento ?? 'sem departamento'));
          doc.text(
            '    Retirada: ' +
              formatarData(e.dataInicio) +
              '   |   Prevista: ' +
              (e.dataPrevista ? formatarData(e.dataPrevista) : '-'),
          );
          doc.text(
            '    Situacao: ' + (atraso > 0 ? 'ATRASADO ha ' + atraso + ' dia(s)' : e.status),
          );
          doc.fillColor('#000000').moveDown(0.6);
        });

      doc.end();
    });
  }
}

export const reportService = new ReportService();
