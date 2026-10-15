import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { estoqueRepository } from '../repositories/EstoqueRepository';
import { estoqueService } from '../services/EstoqueService';
import { AppError } from '../utils/AppError';
import { idParamSchema, valorSchema } from './ItemController';
import { permissaoService } from '../services/PermissaoService';
import { importacaoService } from '../services/ImportacaoService';

const categoriaSchema = z.object({
  nome: z.string().trim().min(2, 'Informe o nome da categoria.').max(60),
  controle: z.enum(['ITEM', 'QUANTIDADE']),
  icone: z.string().trim().max(40).nullish(),
  ordem: z.coerce.number().int().min(0).optional(),
  ativo: z.boolean().optional(),
  secaoPropria: z.boolean().optional(),
  computador: z.boolean().optional(),
});

const quantidadeSchema = z.object({
  categoriaId: z.coerce.number().int().positive('Escolha a categoria.'),
  empresaId: z.coerce.number().int().positive('Escolha a empresa.'),
  descricao: z.string().trim().min(2, 'Descreva o item.').max(120),
  quantidade: z.coerce.number().int().min(0).optional(),
  estoqueMinimo: z.coerce.number().int().min(0).nullish(),
  // A mesma validacao do valor do equipamento: "1,2,3" virava NaN e erro 500.
  valorUnitario: valorSchema,
  observacoes: z.string().trim().max(500).nullish(),
});

const movimentacaoSchema = z.object({
  observacao: z.string().trim().max(500).nullish(),
});

const devolucaoSchema = movimentacaoSchema.extend({
  condicaoAvariada: z.boolean().optional(),
});

const transferenciaSchema = movimentacaoSchema.extend({
  empresaId: z.coerce.number().int().positive('Escolha a empresa de destino.'),
});

const saldoSchema = movimentacaoSchema.extend({
  quantidade: z.coerce.number().int().positive('A quantidade precisa ser maior que zero.'),
  colaboradorId: z.coerce.number().int().positive().nullish(),
});

const ajusteSchema = movimentacaoSchema.extend({
  quantidade: z.coerce.number().int().min(0),
});

/** Filtros da query string: numero inteiro positivo ou ausente. */
const idOpcional = z.coerce.number().int().positive().optional();

const filtroEmpresaSchema = z.object({ empresaId: idOpcional });

const listarQuantidadesSchema = z.object({
  empresaId: idOpcional,
  categoriaId: idOpcional,
  busca: z.string().trim().max(120).optional(),
});

/** Teto do extrato por consulta: ninguem le mais do que isso numa tela. */
const LIMITE_MAXIMO_MOVIMENTACOES = 500;

const listarMovimentacoesSchema = z.object({
  itemId: idOpcional,
  itemQuantidadeId: idOpcional,
  empresaId: idOpcional,
  limite: z.coerce.number().int().positive().max(LIMITE_MAXIMO_MOVIMENTACOES).optional(),
});

const tipoImportacaoSchema = z.object({
  tipo: z.enum(['equipamentos', 'quantidades']).default('equipamentos'),
});

const importacaoSchema = z.object({
  tipo: z.enum(['equipamentos', 'quantidades']),
  // 2 MB de texto ja cobre milhares de linhas; acima disso e engano.
  conteudo: z.string().min(10, 'Arquivo vazio.').max(2_000_000, 'Arquivo grande demais.'),
});

export class EstoqueController {
  // ---------------------------------------------------------------- Painel
  async resumo(req: Request, res: Response, next: NextFunction) {
    try {
      const { empresaId } = filtroEmpresaSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(await estoqueService.resumo(permissaoService.empresaDoFiltro(permissao, empresaId)));
    } catch (erro) {
      next(erro);
    }
  }

  /** Quem esta com o que, por setor. */
  async porSetor(req: Request, res: Response, next: NextFunction) {
    try {
      const { empresaId } = filtroEmpresaSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(
        await estoqueService.distribuicaoPorSetor(permissaoService.empresaDoFiltro(permissao, empresaId)),
      );
    } catch (erro) {
      next(erro);
    }
  }

  // ------------------------------------------------------------ Categorias
  async listarCategorias(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await estoqueRepository.listarCategorias());
    } catch (erro) {
      next(erro);
    }
  }

  async criarCategoria(req: Request, res: Response, next: NextFunction) {
    try {
      const dados = categoriaSchema.parse(req.body);
      permissaoService.exigirAdministrador(
        await permissaoService.doUsuario(req.usuario),
        'criar categorias',
      );
      // Categoria por quantidade nunca tem aba propria: fica em Perifericos.
      if (dados.controle === 'QUANTIDADE') {
        dados.secaoPropria = false;
        dados.computador = false;
      }
      res.status(201).json(await estoqueRepository.criarCategoria(dados));
    } catch (erro) {
      next(erro);
    }
  }

  async atualizarCategoria(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const dados = categoriaSchema.partial().parse(req.body);
      permissaoService.exigirAdministrador(
        await permissaoService.doUsuario(req.usuario),
        'alterar categorias',
      );

      // Trocar o tipo de controle depois de ter equipamento cadastrado
      // deixaria o saldo e os itens orfaos.
      if (dados.controle || dados.secaoPropria || dados.computador) {
        const atual = await estoqueRepository.buscarCategoria(id);
        if (!atual) throw AppError.naoEncontrado('Categoria');
        // Categoria por quantidade nunca tem aba propria: fica em Perifericos.
        if ((dados.controle ?? atual.controle) === 'QUANTIDADE') {
          dados.secaoPropria = false;
          dados.computador = false;
        }
        if (dados.controle && atual.controle !== dados.controle) {
          const emUso = await estoqueRepository.contarUsoDaCategoria(id);
          if (emUso > 0) {
            throw AppError.conflito(
              `Esta categoria ja tem ${emUso} registro(s). Para mudar o tipo de controle, ` +
                'crie uma categoria nova.',
            );
          }
        }
      }

      res.json(await estoqueRepository.atualizarCategoria(id, dados));
    } catch (erro) {
      next(erro);
    }
  }

  // ---------------------------------------------- Movimentacoes de um item
  async receberDeVolta(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const dados = devolucaoSchema.parse(req.body);
      res.json(
        await estoqueService.receberDeVolta(id, {
          ...dados,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async transferir(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { empresaId, observacao } = transferenciaSchema.parse(req.body);
      res.json(
        await estoqueService.transferir(
          id,
          { empresaId },
          {
            observacao,
            operador: req.usuario?.email,
            permissao: await permissaoService.doUsuario(req.usuario),
          },
        ),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async enviarParaManutencao(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { observacao } = movimentacaoSchema.parse(req.body);
      res.json(
        await estoqueService.enviarParaManutencao(id, {
          observacao,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async retornarDaManutencao(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { observacao } = movimentacaoSchema.parse(req.body);
      res.json(
        await estoqueService.retornarDaManutencao(id, {
          observacao,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async darBaixa(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { observacao } = movimentacaoSchema.parse(req.body);
      res.json(
        await estoqueService.darBaixa(id, {
          observacao,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  // ---------------------------------------------------- Itens por quantidade
  async listarQuantidades(req: Request, res: Response, next: NextFunction) {
    try {
      const filtro = listarQuantidadesSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(
        await estoqueRepository.listarQuantidades({
          ...filtro,
          empresaId: permissaoService.empresaDoFiltro(permissao, filtro.empresaId),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async criarQuantidade(req: Request, res: Response, next: NextFunction) {
    try {
      const { categoriaId, empresaId, quantidade, ...dados } = quantidadeSchema.parse(req.body);

      permissaoService.exigirEmpresa(
        await permissaoService.doUsuario(req.usuario),
        empresaId,
        'cadastrar itens',
      );

      const categoria = await estoqueRepository.buscarCategoria(categoriaId);
      if (!categoria) throw AppError.naoEncontrado('Categoria');
      if (categoria.controle !== 'QUANTIDADE') {
        throw AppError.conflito(
          `A categoria ${categoria.nome} e controlada por equipamento. ` +
            'Cadastre cada equipamento, com numero de serie.',
        );
      }

      // O saldo inicial informado no cadastro ja entra como contagem inicial,
      // na mesma transacao do cadastro: saldo e extrato nunca divergem.
      const criado = await estoqueRepository.criarQuantidade(
        {
          ...dados,
          quantidade: quantidade ?? 0,
          categoria: { connect: { id: categoriaId } },
          empresa: { connect: { id: empresaId } },
        },
        quantidade && quantidade > 0
          ? {
              tipo: 'CONTAGEM_INICIAL',
              quantidade,
              empresaDestinoId: empresaId,
              usuario: req.usuario?.email,
              observacao: 'Saldo informado no cadastro.',
            }
          : undefined,
      );

      res.status(201).json(criado);
    } catch (erro) {
      next(erro);
    }
  }

  async atualizarQuantidade(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { categoriaId, empresaId, quantidade, ...dados } = quantidadeSchema.partial().parse(req.body);

      const registro = await estoqueRepository.buscarQuantidade(id);
      if (!registro) throw AppError.naoEncontrado('Item de estoque');
      permissaoService.exigirEmpresa(
        await permissaoService.doUsuario(req.usuario),
        registro.empresaId,
        'editar itens',
      );

      // O saldo nao e editado direto: muda por entrada, saida ou ajuste, que
      // ficam registrados no extrato.
      if (quantidade !== undefined) {
        throw AppError.conflito('Para mudar o saldo use entrada, saida ou ajuste de estoque.');
      }
      // Trocar empresa ou categoria levaria o saldo (e o extrato) para outro
      // estoque sem movimentacao nenhuma. O mesmo valor de hoje e aceito, para
      // a tela poder mandar o formulario inteiro.
      if (
        (empresaId !== undefined && empresaId !== registro.empresaId) ||
        (categoriaId !== undefined && categoriaId !== registro.categoriaId)
      ) {
        throw new AppError(
          'Empresa e categoria nao mudam na edicao. Para levar o saldo a outra empresa, de saida ' +
            'aqui e entrada la; para outra categoria, cadastre o item nela.',
          422,
        );
      }

      res.json(await estoqueRepository.atualizarQuantidade(id, dados));
    } catch (erro) {
      next(erro);
    }
  }

  async entradaDeQuantidade(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { quantidade, observacao } = saldoSchema.parse(req.body);
      res.json(
        await estoqueService.entradaDeQuantidade(id, quantidade, {
          observacao,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async saidaDeQuantidade(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { quantidade, colaboradorId, observacao } = saldoSchema.parse(req.body);
      res.json(
        await estoqueService.saidaDeQuantidade(id, quantidade, {
          colaboradorId,
          observacao,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async ajustarQuantidade(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { quantidade, observacao } = ajusteSchema.parse(req.body);
      res.json(
        await estoqueService.ajustarQuantidade(id, quantidade, {
          observacao,
          operador: req.usuario?.email,
          permissao: await permissaoService.doUsuario(req.usuario),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async removerQuantidade(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const registro = await estoqueRepository.buscarQuantidade(id);
      if (!registro) throw AppError.naoEncontrado('Item de estoque');
      permissaoService.exigirEmpresa(
        await permissaoService.doUsuario(req.usuario),
        registro.empresaId,
        'excluir itens',
      );
      if (registro.quantidade > 0) {
        throw AppError.conflito(
          `Ainda ha ${registro.quantidade} em estoque. Zere o saldo antes de excluir.`,
        );
      }
      // Com saidas, ajustes ou outras movimentacoes, excluir apagaria o extrato
      // (a FK do saldo ainda e CASCADE). So o cadastro pode sumir.
      const historico = await estoqueRepository.contarMovimentacoesAlemDoCadastro({ itemQuantidadeId: id });
      if (historico > 0) {
        throw AppError.conflito(
          `Este item tem ${historico} movimentacao(oes) no extrato e nao pode ser excluido: ` +
            'isso apagaria o historico. Deixe o saldo zerado (ele continua no extrato) em vez de excluir.',
        );
      }
      await estoqueRepository.removerQuantidade(id);
      res.status(204).send();
    } catch (erro) {
      next(erro);
    }
  }

  // ------------------------------------------------- Contagem inicial (CSV)
  async modeloDeImportacao(req: Request, res: Response, next: NextFunction) {
    try {
      const { tipo } = tipoImportacaoSchema.parse(req.query);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="contagem-${tipo}.csv"`);
      res.send(importacaoService.gerarModelo(tipo));
    } catch (erro) {
      next(erro);
    }
  }

  async importar(req: Request, res: Response, next: NextFunction) {
    try {
      const { tipo, conteudo } = importacaoSchema.parse(req.body);
      res.json(
        await importacaoService.importar(
          tipo,
          conteudo,
          req.usuario?.email,
          await permissaoService.doUsuario(req.usuario),
        ),
      );
    } catch (erro) {
      next(erro);
    }
  }

  // --------------------------------------------------------- Movimentacoes
  async listarMovimentacoes(req: Request, res: Response, next: NextFunction) {
    try {
      const filtro = listarMovimentacoesSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      // Para o analista a empresa vale junto com itemId/itemQuantidadeId: o
      // extrato de um equipamento de outra empresa volta vazio.
      res.json(
        await estoqueRepository.listarMovimentacoes({
          ...filtro,
          empresaId: permissaoService.empresaDoFiltro(permissao, filtro.empresaId),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }
}

export const estoqueController = new EstoqueController();
