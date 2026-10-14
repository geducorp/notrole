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
      'XYZ9876',
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
    const linhas = conteudo
      .replace(/^﻿/, '')
      .split(/\r?\n/)
      .filter((l) => l.trim());

    if (linhas.length < 2) {
      throw new AppError('A planilha esta vazia: preencha pelo menos uma linha abaixo do cabecalho.', 422);
    }

    const cabecalho = dividirLinha(linhas[0]!).map((c) => semAcento(c).replace(/\s+/g, '_'));
    const esperado = COLUNAS[tipo];
    const faltando = esperado.filter((c) => !cabecalho.includes(c));
    if (faltando.length) {
      throw new AppError(
        `A planilha nao tem as colunas: ${faltando.join(', ')}. Baixe o modelo e preencha sobre ele.`,
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
      const valores = dividirLinha(linhas[i]!);
      const campo = (nome: string) => valores[cabecalho.indexOf(nome)]?.trim() ?? '';
      const numeroDaLinha = i + 1;

      try {
        const categoria = categorias.find((c) => semAcento(c.nome) === semAcento(campo('categoria')));
        if (!categoria) throw new Error(`categoria "${campo('categoria')}" nao existe`);

        const controleEsperado = tipo === 'equipamentos' ? 'ITEM' : 'QUANTIDADE';
        if (categoria.controle !== controleEsperado) {
          throw new Error(
            `a categoria "${categoria.nome}" e controlada por ` +
              (categoria.controle === 'ITEM' ? 'equipamento' : 'quantidade') +
              ', use a outra planilha',
          );
        }

        const empresa = empresas.find((e) => semAcento(e.apelido) === semAcento(campo('empresa')));
        if (!empresa) throw new Error(`empresa "${campo('empresa')}" nao existe`);
        // Cada analista importa para o estoque da propria empresa.
        if (permissao) permissaoService.exigirEmpresa(permissao, empresa.id, 'importar equipamentos');

        if (tipo === 'equipamentos') {
          const modelo = campo('modelo');
          if (!modelo) throw new Error('o modelo e obrigatorio');
          if (!campo('marca')) throw new Error('a marca e obrigatoria');
          if (!campo('patrimonio')) throw new Error('o patrimonio (numero de serie) e obrigatorio');

          const condicao = semAcento(campo('condicao')) === 'usado' ? 'USADO' : 'NOVO';
          const patrimonio = campo('patrimonio') || null;
          const hostname = campo('hostname') ? campo('hostname').toUpperCase() : null;

          if (patrimonio) {
            const existente = await prisma.item.findUnique({ where: { patrimonio } });
            if (existente) throw new Error(`ja existe equipamento com o patrimonio ${patrimonio}`);
          }
          if (hostname) {
            const existente = await prisma.item.findUnique({ where: { hostname } });
            if (existente) throw new Error(`ja existe equipamento com o hostname ${hostname}`);
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
          if (!descricao) throw new Error('a descricao e obrigatoria');

          const quantidade = paraNumero(campo('quantidade')) ?? 0;
          if (quantidade < 0) throw new Error('a quantidade nao pode ser negativa');

          // O banco guarda inteiro: "2,5" dava uma mensagem crua do Prisma.
          const textoMinimo = campo('estoque_minimo');
          const estoqueMinimo = textoMinimo ? paraNumero(textoMinimo) : null;
          if (
            textoMinimo &&
            (estoqueMinimo === null || !/\d/.test(textoMinimo) || !Number.isInteger(estoqueMinimo) || estoqueMinimo < 0)
          ) {
            throw new Error(`o estoque minimo "${textoMinimo}" precisa ser um numero inteiro, zero ou maior`);
          }

          const jaExiste = await estoqueRepository.buscarQuantidadePorDescricao(
            empresa.id,
            categoria.id,
            descricao,
          );
          if (jaExiste) throw new Error(`ja existe "${descricao}" em ${empresa.apelido}`);

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
