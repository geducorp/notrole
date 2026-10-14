import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { itemService } from '../services/ItemService';
import { permissaoService } from '../services/PermissaoService';

export const situacaoItemSchema = z.enum([
  'EM_ESTOQUE',
  'RESERVADO',
  'EMPRESTADO',
  'ENTREGUE',
  'MANUTENCAO',
  'BAIXADO',
]);

export const condicaoItemSchema = z.enum(['NOVO', 'USADO']);

export const idParamSchema = z.object({
  id: z.coerce.number().int().positive('O id deve ser um numero inteiro positivo.'),
});

/**
 * Valor em reais. Aceita numero (4500.5) ou texto no formato brasileiro
 * ("4.500,50"); texto vazio apaga o valor.
 */
export const valorSchema = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (v === null || v === '') return null;
    if (typeof v === 'number') return v;
    return Number(v.replace(/[^\d,]/g, '').replace(',', '.'));
  })
  .refine(
    (v) => v === null || v === undefined || (Number.isFinite(v) && v >= 0),
    'Valor invalido. Use o formato 4.500,00.',
  );

export const criarItemSchema = z.object({
  categoriaId: z.coerce.number().int().positive('Escolha a categoria.'),
  empresaId: z.coerce.number().int().positive('Escolha a empresa.'),
  hostname: z.string().trim().max(64).nullish(),
  // Obrigatorios: os dois vao no termo de comodato, e o patrimonio e como o
  // equipamento e conferido na prateleira.
  patrimonio: z.string().trim().min(1, 'Informe o patrimonio (numero de serie).').max(64),
  marca: z.string().trim().min(1, 'Informe a marca.').max(64),
  modelo: z.string().trim().min(1, 'O modelo e obrigatorio.').max(120),
  condicao: condicaoItemSchema.optional(),
  // Sem "situacao": ela e consequencia das movimentacoes (emprestimo, entrega,
  // manutencao, baixa) e so muda pelo EstoqueService, com extrato. Aceitar
  // aqui deixava marcar EMPRESTADO/BAIXADO sem cessao nem movimentacao.
  // (zod descarta a chave se ela vier no corpo.)
  observacoes: z.string().trim().max(500).nullish(),
  valor: valorSchema,
  dataEntrada: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data de entrada invalida. Use o formato aaaa-mm-dd.')
    .optional(),
  paraEmprestimo: z.boolean().optional(),
});

export const atualizarItemSchema = criarItemSchema.partial();

export const listarItensSchema = z.object({
  busca: z.string().trim().max(120).optional(),
  situacao: situacaoItemSchema.optional(),
  /** Varias situacoes de uma vez, separadas por virgula: "ENTREGUE,EMPRESTADO". */
  situacoes: z
    .string()
    .optional()
    .transform((v) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined))
    .pipe(z.array(situacaoItemSchema).optional()),
  condicao: condicaoItemSchema.optional(),
  categoriaId: z.coerce.number().int().positive().optional(),
  empresaId: z.coerce.number().int().positive().optional(),
  colaboradorId: z.coerce.number().int().positive().optional(),
  paraEmprestimo: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  comColaborador: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  secaoPropria: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export class ItemController {
  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const filtro = listarItensSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(
        await itemService.listar({
          ...filtro,
          empresaId: permissaoService.empresaDoFiltro(permissao, filtro.empresaId),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async buscarPorId(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await itemService.buscarPorId(id, await permissaoService.doUsuario(req.usuario)));
    } catch (erro) {
      next(erro);
    }
  }

  async criar(req: Request, res: Response, next: NextFunction) {
    try {
      const dados = criarItemSchema.parse(req.body);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.status(201).json(await itemService.criar(dados, req.usuario?.email, permissao));
    } catch (erro) {
      next(erro);
    }
  }

  async atualizar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const dados = atualizarItemSchema.parse(req.body);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(await itemService.atualizar(id, dados, permissao));
    } catch (erro) {
      next(erro);
    }
  }

  async remover(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      await itemService.remover(id, await permissaoService.doUsuario(req.usuario));
      res.status(204).send();
    } catch (erro) {
      next(erro);
    }
  }
}

export const itemController = new ItemController();
