import ExcelJS from 'exceljs';
import type { SituacaoItem } from '@prisma/client';
import { itemRepository } from '../repositories/ItemRepository';
import { estoqueRepository } from '../repositories/EstoqueRepository';
import { emprestimoRepository } from '../repositories/EmprestimoRepository';
import { prisma } from '../config/prisma';
import { estoqueService } from './EstoqueService';
import { reportService } from './ReportService';
import { diasDeAtraso, estaAtrasado } from '../utils/datas';
import { nomeDoItem } from '../utils/itens';

/**
 * Planilha do dashboard, para quando a gerencia pedir os numeros.
 *
 * Um arquivo .xlsx de verdade (nao CSV), com uma aba de resumo e as listas por
 * tras de cada numero, ja filtradas pela empresa escolhida na tela.
 */

export type Painel = 'estoque' | 'emprestimos';

const ROTULO_SITUACAO: Record<SituacaoItem, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  EMPRESTADO: 'Emprestado',
  ENTREGUE: 'Entregue',
  MANUTENCAO: 'Manutenção',
  BAIXADO: 'Baixado',
};

const FORMATO_MOEDA = '"R$" #,##0.00';
const FORMATO_DATA = 'dd/mm/yyyy';

/** Cabecalho em negrito, fundo cinza, filtro e largura das colunas. */
function montarAba(
  livro: ExcelJS.Workbook,
  nome: string,
  colunas: Array<{ titulo: string; chave: string; largura: number; formato?: string }>,
  linhas: Array<Record<string, unknown>>,
) {
  const aba = livro.addWorksheet(nome, { views: [{ state: 'frozen', ySplit: 1 }] });
  aba.columns = colunas.map((c) => ({ header: c.titulo, key: c.chave, width: c.largura, style: c.formato ? { numFmt: c.formato } : {} }));

  const cabecalho = aba.getRow(1);
  cabecalho.font = { bold: true, color: { argb: 'FF1E293B' } };
  cabecalho.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
  cabecalho.alignment = { vertical: 'middle' };
  cabecalho.height = 20;

  for (const linha of linhas) aba.addRow(linha);
  if (linhas.length > 0) {
    aba.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: colunas.length } };
  }
  return aba;
}

function abaDeResumo(livro: ExcelJS.Workbook, titulo: string, filtro: string, linhas: Array<[string, string | number]>) {
  const aba = livro.addWorksheet('Resumo');
  aba.columns = [{ width: 38 }, { width: 22 }];
  aba.addRow([titulo]).font = { bold: true, size: 14 };
  aba.addRow([`${filtro} · gerado em ${new Date().toLocaleString('pt-BR')}`]).font = { color: { argb: 'FF64748B' } };
  aba.addRow([]);
  for (const [rotulo, valor] of linhas) {
    const linha = aba.addRow([rotulo, valor]);
    linha.getCell(1).font = { color: { argb: 'FF334155' } };
    linha.getCell(2).font = { bold: true };
    if (rotulo.toLowerCase().includes('valor')) linha.getCell(2).numFmt = FORMATO_MOEDA;
  }
}

export class PlanilhaService {
  async gerar(
    painel: Painel,
    empresaId?: number,
    tipo?: string,
  ): Promise<{ nome: string; arquivo: Buffer }> {
    const empresa = empresaId ? await prisma.empresa.findUnique({ where: { id: empresaId } }) : null;
    // "tipo" e o nome da categoria escolhida no dashboard; so vale para o
    // painel de estoque.
    const tipoDoEstoque = painel === 'estoque' ? tipo?.trim() || undefined : undefined;
    const filtro =
      (empresa ? empresa.apelido : 'Todas as empresas') + (tipoDoEstoque ? ` · ${tipoDoEstoque}` : '');

    const livro = new ExcelJS.Workbook();
    livro.creator = 'Notrole';
    livro.created = new Date();

    if (painel === 'estoque') await this.estoque(livro, filtro, empresaId, tipoDoEstoque);
    else await this.emprestimos(livro, filtro, empresaId);

    const data = new Date().toISOString().slice(0, 10);
    // Nome de arquivo so com [a-z0-9-]: acento ("Sao Joao") ou aspas no cabecalho
    // Content-Disposition chegam truncados ou quebram o download.
    const limpo = (texto: string) =>
      texto
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-');
    const sufixo = (empresa ? `-${limpo(empresa.apelido)}` : '') + (tipoDoEstoque ? `-${limpo(tipoDoEstoque)}` : '');
    return {
      nome: `notrole-${painel}${sufixo}-${data}.xlsx`,
      arquivo: Buffer.from(await livro.xlsx.writeBuffer()),
    };
  }

  private async estoque(livro: ExcelJS.Workbook, filtro: string, empresaId?: number, tipo?: string) {
    const [resumo, todosItens, todosAcessorios, todosSetores] = await Promise.all([
      estoqueService.resumo(empresaId),
      itemRepository.listar(empresaId ? { empresaId } : undefined),
      estoqueRepository.listarQuantidades(empresaId ? { empresaId } : undefined),
      estoqueService.distribuicaoPorSetor(empresaId),
    ]);

    // Filtro por tipo de equipamento (nome da categoria), o mesmo seletor do
    // dashboard. Sem tipo, tudo.
    const doTipo = (categoria: string) => !tipo || categoria.toLowerCase() === tipo.toLowerCase();
    const itens = todosItens.filter((i) => doTipo(i.categoria.nome));
    const acessorios = todosAcessorios.filter((q) => doTipo(q.categoria.nome));
    const setores = todosSetores
      .map((s) => ({
        ...s,
        pessoas: s.pessoas
          .map((p) => ({ ...p, equipamentos: p.equipamentos.filter((e) => doTipo(e.categoria)) }))
          .filter((p) => p.equipamentos.length > 0),
      }))
      .filter((s) => s.pessoas.length > 0);

    if (tipo) {
      const contar = (situacao: string) => itens.filter((i) => i.situacao === situacao).length;
      const valorEmEstoque = itens
        .filter((i) => i.situacao === 'EM_ESTOQUE' && i.valor)
        .reduce((soma, i) => soma + Number(i.valor), 0);
      abaDeResumo(livro, 'Estoque de TI', filtro, [
        ['Equipamentos em estoque', contar('EM_ESTOQUE')],
        ['Entregues a colaboradores', contar('ENTREGUE')],
        ['Emprestados', contar('EMPRESTADO')],
        ['Em manutenção', contar('MANUTENCAO')],
        ['Baixados', contar('BAIXADO')],
        ['Valor parado em estoque', valorEmEstoque],
        ['Periféricos (unidades)', acessorios.reduce((soma, q) => soma + q.quantidade, 0)],
      ]);
    } else {
      abaDeResumo(livro, 'Estoque de TI', filtro, [
        ['Equipamentos em estoque', resumo.itens.emEstoque],
        ['Entregues a colaboradores', resumo.itens.entregues],
        ['Emprestados', resumo.itens.emprestados],
        ['Em manutenção', resumo.itens.emManutencao],
        ['Baixados', resumo.itens.baixados],
        ['Valor parado em estoque', Number(resumo.valorEmEstoque)],
        ['Periféricos (unidades)', resumo.quantidades.unidades],
        ...resumo.porCategoria.map((c): [string, number] => [`Equipamentos · ${c.categoria}`, c.total]),
      ]);
    }

    montarAba(
      livro,
      'Equipamentos',
      [
        { titulo: 'Categoria', chave: 'categoria', largura: 16 },
        { titulo: 'Equipamento', chave: 'nome', largura: 26 },
        { titulo: 'Marca', chave: 'marca', largura: 12 },
        { titulo: 'Modelo', chave: 'modelo', largura: 22 },
        { titulo: 'Patrimônio', chave: 'patrimonio', largura: 16 },
        { titulo: 'Empresa', chave: 'empresa', largura: 18 },
        { titulo: 'Condição', chave: 'condicao', largura: 10 },
        { titulo: 'Situação', chave: 'situacao', largura: 14 },
        { titulo: 'Com', chave: 'com', largura: 28 },
        { titulo: 'Valor', chave: 'valor', largura: 14, formato: FORMATO_MOEDA },
        { titulo: 'Entrada', chave: 'entrada', largura: 12, formato: FORMATO_DATA },
      ],
      itens.map((i) => ({
        categoria: i.categoria.nome,
        nome: nomeDoItem(i),
        marca: i.marca ?? '',
        modelo: i.modelo,
        patrimonio: i.patrimonio ?? '',
        empresa: i.empresa.apelido,
        condicao: i.condicao === 'NOVO' ? 'Novo' : 'Usado',
        situacao: ROTULO_SITUACAO[i.situacao],
        com: i.colaborador?.nome ?? '',
        valor: i.valor ? Number(i.valor) : null,
        entrada: i.dataEntrada,
      })),
    );

    montarAba(
      livro,
      'Periféricos',
      [
        { titulo: 'Categoria', chave: 'categoria', largura: 20 },
        { titulo: 'Descrição', chave: 'descricao', largura: 34 },
        { titulo: 'Empresa', chave: 'empresa', largura: 18 },
        { titulo: 'Saldo', chave: 'saldo', largura: 8 },
        { titulo: 'Mínimo', chave: 'minimo', largura: 8 },
        { titulo: 'Valor unitário', chave: 'unitario', largura: 14, formato: FORMATO_MOEDA },
        { titulo: 'Valor total', chave: 'total', largura: 14, formato: FORMATO_MOEDA },
      ],
      acessorios.map((q) => ({
        categoria: q.categoria.nome,
        descricao: q.descricao,
        empresa: q.empresa.apelido,
        saldo: q.quantidade,
        minimo: q.estoqueMinimo ?? '',
        unitario: q.valorUnitario ? Number(q.valorUnitario) : null,
        total: q.valorUnitario ? Number(q.valorUnitario) * q.quantidade : null,
      })),
    );

    montarAba(
      livro,
      'Por setor',
      [
        { titulo: 'Setor', chave: 'setor', largura: 20 },
        { titulo: 'Colaborador', chave: 'pessoa', largura: 32 },
        { titulo: 'Equipamento', chave: 'equipamento', largura: 26 },
        { titulo: 'Categoria', chave: 'categoria', largura: 16 },
        { titulo: 'Forma', chave: 'forma', largura: 12 },
        { titulo: 'Desde', chave: 'desde', largura: 12, formato: FORMATO_DATA },
      ],
      setores.flatMap((s) =>
        s.pessoas.flatMap((p) =>
          p.equipamentos.map((e) => ({
            setor: s.departamento,
            pessoa: p.nome,
            equipamento: e.nome,
            categoria: e.categoria,
            forma: e.forma === 'EMPRESTIMO' ? 'Empréstimo' : 'Entrega',
            desde: e.desde,
          })),
        ),
      ),
    );
  }

  private async emprestimos(livro: ExcelJS.Workbook, filtro: string, empresaId?: number) {
    const [metricas, emAberto, entregas] = await Promise.all([
      reportService.obterMetricasDashboard(empresaId),
      emprestimoRepository.listarEmAberto('TEMPORARIA', empresaId),
      emprestimoRepository.listarEmAberto('DEFINITIVA', empresaId),
    ]);

    const daEmpresa = <T extends { item: { empresaId: number } }>(lista: T[]) =>
      empresaId ? lista.filter((e) => e.item.empresaId === empresaId) : lista;

    abaDeResumo(livro, 'Empréstimos e entregas', filtro, [
      ['Empréstimos em aberto', metricas.emprestimos.emAberto],
      ['Aguardando assinatura do termo', metricas.emprestimos.aguardandoAssinatura],
      ['Devoluções atrasadas', metricas.alertas.devolucoesAtrasadas],
      ['Vencendo em 7 dias', metricas.alertas.vencendoEmSeteDias],
      ['Entregas definitivas em aberto', daEmpresa(entregas).length],
    ]);

    montarAba(
      livro,
      'Empréstimos',
      [
        { titulo: 'Colaborador', chave: 'colaborador', largura: 32 },
        { titulo: 'Setor', chave: 'setor', largura: 18 },
        { titulo: 'Equipamento', chave: 'equipamento', largura: 24 },
        { titulo: 'Retirada', chave: 'retirada', largura: 12, formato: FORMATO_DATA },
        { titulo: 'Prazo', chave: 'prazo', largura: 12, formato: FORMATO_DATA },
        { titulo: 'Situação', chave: 'situacao', largura: 22 },
        { titulo: 'Dias de atraso', chave: 'atraso', largura: 14 },
      ],
      daEmpresa(emAberto).map((e) => {
        const atrasado = e.dataPrevista ? estaAtrasado(e.dataPrevista) : false;
        return {
          colaborador: e.colaborador.nome,
          setor: e.colaborador.departamento ?? '',
          equipamento: nomeDoItem(e.item),
          retirada: e.dataInicio,
          prazo: e.dataPrevista,
          situacao: atrasado
            ? 'Atrasado'
            : e.status === 'AGUARDANDO_ASSINATURA'
              ? 'Aguardando assinatura'
              : 'Ativo',
          atraso: atrasado && e.dataPrevista ? diasDeAtraso(e.dataPrevista) : '',
        };
      }),
    );

    montarAba(
      livro,
      'Entregas',
      [
        { titulo: 'Colaborador', chave: 'colaborador', largura: 32 },
        { titulo: 'Setor', chave: 'setor', largura: 18 },
        { titulo: 'Equipamento', chave: 'equipamento', largura: 24 },
        { titulo: 'Entregue em', chave: 'data', largura: 12, formato: FORMATO_DATA },
        { titulo: 'Termo', chave: 'termo', largura: 22 },
      ],
      daEmpresa(entregas).map((e) => ({
        colaborador: e.colaborador.nome,
        setor: e.colaborador.departamento ?? '',
        equipamento: nomeDoItem(e.item),
        data: e.dataInicio,
        termo: e.status === 'AGUARDANDO_ASSINATURA' ? 'Aguardando assinatura' : 'Assinado ou dispensado',
      })),
    );

    montarAba(
      livro,
      'Por departamento',
      [
        { titulo: 'Departamento', chave: 'departamento', largura: 24 },
        { titulo: 'Empréstimos no ano', chave: 'total', largura: 18 },
      ],
      metricas.emprestimosPorDepartamento,
    );
  }
}

export const planilhaService = new PlanilhaService();
