import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { estoqueRepository } from '../repositories/EstoqueRepository';
import { permissaoService, type UsuarioComPermissao } from './PermissaoService';

/**
 * Importacao da contagem inicial do estoque.
 *
 * O estoque atual nao comeca "do zero a partir de agora": a TI conta o que
 * esta na prateleira, preenche a planilha modelo e importa aqui. Cada linha
 * vira um equipamento (ou um saldo) com a movimentacao CONTAGEM_INICIAL, para
 * que todo item tenha extrato desde o primeiro dia.
 *
 * O arquivo e um CSV com ponto e virgula, que e o que o Excel em portugues
 * gera e le sem perguntar nada.
 */

export type TipoImportacao = 'equipamentos' | 'quantidades';

const COLUNAS: Record<TipoImportacao, string[]> = {
  equipamentos: [
    'categoria',
    'empresa',
    'marca',
    'modelo',
    'patrimonio',
    'hostname',
    'processador',
    'memoria_gb',
    'armazenamento_gb',
    'condicao',
    'valor',
    'para_emprestimo',
    'observacoes',
  ],
  quantidades: [
    'categoria',
    'empresa',
    'descricao',
    'quantidade',
    'estoque_minimo',
    'valor_unitario',
    'observacoes',
  ],
};

const EXEMPLOS: Record<TipoImportacao, string[][]> = {
  equipamentos: [
    [
      'Notebook',
      'Empresa Exemplo A',
      'Dell',
      'Latitude 5440',
      'ABC1234',
      'NB-EMPRESTIMO-01',
      'Intel Core i5',
      '16',
      '512',
      'Novo',
      '4.890,00',
      'sim',
      '',
    ],
    [
      'Monitor',
      'Empresa Exemplo B',
      'Dell',
      'P2422H 24"',
      '',
      '',
      '',
      '',
      '',
      'Novo',
      '890,00',
      'nao',
      'Caixa lacrada',
    ],
  ],
  quantidades: [
    ['Kit teclado e mouse', 'Empresa Exemplo A', 'Logitech MK270', '12', '5', '150,00', ''],
    ['Headset', 'Empresa Exemplo B', 'Logitech H390', '4', '3', '210,00', ''],
  ],
};

/**
 * Colunas que entraram depois (14/10/2026). Planilha baixada antes delas
 * continua valendo: sem a coluna, o campo fica vazio.
 */
const COLUNAS_OPCIONAIS = ['processador', 'memoria_gb', 'armazenamento_gb'];

/** "16", "16GB", "16 GB" -> 16; "1TB", "1 TB" -> 1024; vazio -> null. */
function paraGb(texto: string, nomeDoCampo: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const achado = /^(\d+(?:[.,]\d+)?)\s*(tb|gb)?\b/i.exec(limpo);
  const numero = achado ? Number(achado[1]!.replace(',', '.')) : NaN;
  const gb = achado?.[2]?.toLowerCase() === 'tb' ? numero * 1024 : numero;
  if (!Number.isFinite(gb) || gb <= 0 || !Number.isInteger(gb)) {
    throw new Error(`${nomeDoCampo} "${limpo}" precisa ser em GB, como 16 ou 512 (ou 1 TB)`);
  }
  return gb;
}

export interface ResultadoImportacao {
  criados: number;
  erros: Array<{ linha: number; erro: string }>;
}

/** Texto -> numero, aceitando "4.890,00" e "4890.00". */
function paraNumero(texto: string): number | null {
  const limpo = texto.trim();
  if (!limpo) return null;
  const normalizado = limpo.includes(',')
    ? limpo.replace(/\./g, '').replace(',', '.')
    : limpo.replace(/\.(?=\d{3}\b)/g, '');
  const numero = Number(normalizado.replace(/[^\d.-]/g, ''));
  return Number.isFinite(numero) ? numero : null;
}

function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/** Divide uma linha de CSV respeitando aspas. */
function dividirLinha(linha: string): string[] {
  const campos: string[] = [];
  let atual = '';
  let dentroDeAspas = false;

  for (let i = 0; i < linha.length; i += 1) {
    const c = linha[i];
    if (c === '"' && (dentroDeAspas || atual === '')) {
      // Aspas so delimitam o campo quando abrem no comeco dele. Assim uma
      // aspa solta no meio do texto (P2422H 24") e apenas texto - era o que
      // engolia o resto da linha.
      if (dentroDeAspas && linha[i + 1] === '"') {
        atual += '"';
        i += 1;
      } else {
        dentroDeAspas = !dentroDeAspas;
      }
    } else if (c === ';' && !dentroDeAspas) {
      campos.push(atual);
      atual = '';
    } else {
      atual += c;
    }
  }
  campos.push(atual);
  return campos.map((c) => c.trim());
}

export class ImportacaoService {
  /** CSV de exemplo para a TI preencher durante a contagem. */
  gerarModelo(tipo: TipoImportacao): string {
    const linhas = [COLUNAS[tipo].join(';'), ...EXEMPLOS[tipo].map((e) => e.join(';'))];
    // BOM: sem ele o Excel abre os acentos errados.
    return `﻿${linhas.join('\r\n')}\r\n`;
  }

  async importar(
    tipo: TipoImportacao,
    conteudo: string,
    operador?: string,
    permissao?: UsuarioComPermissao,
  ): Promise<ResultadoImportacao> {
    // Guarda o numero da linha no Excel: a mensagem "Linha 24" tem de bater
    // com a planilha. Linha so com separadores (";;;;;;") e vazia: o Excel
    // grava assim as linhas que tiveram formatacao, e cada uma virava erro.
    const linhas = conteudo
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .map((texto, indice) => ({ texto, numero: indice + 1 }))
      .filter((l) => l.texto.replace(/[;"\s]/g, ''));

    if (linhas.length < 2) {
      throw new AppError('A planilha está vazia: preencha pelo menos uma linha abaixo do cabeçalho.', 422);
    }

    const cabecalho = dividirLinha(linhas[0]!.texto).map((c) => semAcento(c).replace(/\s+/g, '_'));
    const esperado = COLUNAS[tipo].filter((c) => !COLUNAS_OPCIONAIS.includes(c));
    const faltando = esperado.filter((c) => !cabecalho.includes(c));
    if (faltando.length) {
      throw new AppError(
        `A planilha não tem as colunas: ${faltando.join(', ')}. Baixe o modelo e preencha sobre ele.`,
        422,
        'CABECALHO_INVALIDO',
      );
    }

    const [categorias, empresas] = await Promise.all([
      estoqueRepository.listarCategorias(),
      prisma.empresa.findMany(),
    ]);

    const resultado: ResultadoImportacao = { criados: 0, erros: [] };

    for (let i = 1; i < linhas.length; i += 1) {
      const valores = dividirLinha(linhas[i]!.texto);
      const campo = (nome: string) =>
        cabecalho.includes(nome) ? (valores[cabecalho.indexOf(nome)]?.trim() ?? '') : '';
      const numeroDaLinha = linhas[i]!.numero;

      try {
        const categoria = categorias.find((c) => semAcento(c.nome) === semAcento(campo('categoria')));
        if (!categoria) throw new Error(`categoria "${campo('categoria')}" não existe`);

        const controleEsperado = tipo === 'equipamentos' ? 'ITEM' : 'QUANTIDADE';
        if (categoria.controle !== controleEsperado) {
          throw new Error(
            `a categoria "${categoria.nome}" é controlada por ` +
              (categoria.controle === 'ITEM' ? 'equipamento' : 'quantidade') +
              ', use a outra planilha',
          );
        }

        const empresa = empresas.find((e) => semAcento(e.apelido) === semAcento(campo('empresa')));
        if (!empresa) throw new Error(`empresa "${campo('empresa')}" não existe`);
        // Cada analista importa para o estoque da propria empresa.
        if (permissao) permissaoService.exigirEmpresa(permissao, empresa.id, 'importar equipamentos');

        if (tipo === 'equipamentos') {
          const modelo = campo('modelo');
          if (!modelo) throw new Error('o modelo é obrigatório');
          if (!campo('marca')) throw new Error('a marca é obrigatória');
          // Numero de serie: obrigatorio so em computador (notebook). Monitor
          // e celular podem entrar sem.
          const patrimonio = campo('patrimonio') ? campo('patrimonio').toUpperCase() : null;
          if (categoria.computador && !patrimonio) {
            throw new Error(`o patrimônio (número de série) é obrigatório para ${categoria.nome}`);
          }

          const condicao = semAcento(campo('condicao')) === 'usado' ? 'USADO' : 'NOVO';
          const hostname = campo('hostname') ? campo('hostname').toUpperCase() : null;
          const especificacoes = categoria.computador
            ? {
                processador: campo('processador') || null,
                memoriaGb: paraGb(campo('memoria_gb'), 'a memória'),
                armazenamentoGb: paraGb(campo('armazenamento_gb'), 'o armazenamento'),
              }
            : {};

          if (patrimonio) {
            const existente = await prisma.item.findUnique({ where: { patrimonio } });
            if (existente) throw new Error(`já existe equipamento com o patrimônio ${patrimonio}`);
          }
          if (hostname) {
            const existente = await prisma.item.findUnique({ where: { hostname } });
            if (existente) throw new Error(`já existe equipamento com o hostname ${hostname}`);
          }

          await prisma.$transaction(async (tx) => {
            const item = await tx.item.create({
              data: {
                categoriaId: categoria.id,
                empresaId: empresa.id,
                marca: campo('marca') || null,
                modelo,
                patrimonio,
                hostname,
                ...especificacoes,
                condicao,
                situacao: 'EM_ESTOQUE',
                valor: paraNumero(campo('valor')),
                paraEmprestimo: ['sim', 's', 'x', 'true', '1'].includes(semAcento(campo('para_emprestimo'))),
                observacoes: campo('observacoes') || null,
              },
            });

            await estoqueRepository.registrarMovimentacao(
              {
                tipo: 'CONTAGEM_INICIAL',
                itemId: item.id,
                empresaDestinoId: empresa.id,
                usuario: operador,
                observacao: 'Importado na contagem inicial do estoque.',
              },
              tx,
            );
          });
        } else {
          const descricao = campo('descricao');
          if (!descricao) throw new Error('a descrição é obrigatória');

          const quantidade = paraNumero(campo('quantidade')) ?? 0;
          if (quantidade < 0) throw new Error('a quantidade não pode ser negativa');

          // O banco guarda inteiro: "2,5" dava uma mensagem crua do Prisma.
          const textoMinimo = campo('estoque_minimo');
          const estoqueMinimo = textoMinimo ? paraNumero(textoMinimo) : null;
          if (
            textoMinimo &&
            (estoqueMinimo === null || !/\d/.test(textoMinimo) || !Number.isInteger(estoqueMinimo) || estoqueMinimo < 0)
          ) {
            throw new Error(`o estoque mínimo "${textoMinimo}" precisa ser um número inteiro, zero ou maior`);
          }

          const jaExiste = await estoqueRepository.buscarQuantidadePorDescricao(
            empresa.id,
            categoria.id,
            descricao,
          );
          if (jaExiste) throw new Error(`já existe "${descricao}" em ${empresa.apelido}`);

          await prisma.$transaction(async (tx) => {
            const registro = await tx.itemQuantidade.create({
              data: {
                categoriaId: categoria.id,
                empresaId: empresa.id,
                descricao,
                quantidade: Math.round(quantidade),
                estoqueMinimo,
                valorUnitario: paraNumero(campo('valor_unitario')),
                observacoes: campo('observacoes') || null,
              },
            });

            if (quantidade > 0) {
              await estoqueRepository.registrarMovimentacao(
                {
                  tipo: 'CONTAGEM_INICIAL',
                  itemQuantidadeId: registro.id,
                  quantidade: Math.round(quantidade),
                  empresaDestinoId: empresa.id,
                  usuario: operador,
                  observacao: 'Importado na contagem inicial do estoque.',
                },
                tx,
              );
            }
          });
        }

        resultado.criados += 1;
      } catch (erro) {
        resultado.erros.push({
          linha: numeroDaLinha,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }

    return resultado;
  }
}

export const importacaoService = new ImportacaoService();
