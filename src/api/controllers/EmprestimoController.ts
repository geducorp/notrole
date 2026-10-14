import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { emprestimoService } from '../services/EmprestimoService';
import { termoService } from '../services/TermoService';
import { permissaoService } from '../services/PermissaoService';
import { idParamSchema } from './ItemController';

const dataSchema = z
  .string()
  .trim()
  .min(1, 'A data e obrigatoria.')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Data invalida.');

export const criarEmprestimoSchema = z.object({
  itemId: z.coerce.number().int().positive('Selecione um equipamento.'),
  colaborador: z.object({
    nome: z.string().trim().min(1, 'O nome do colaborador e obrigatorio.').max(150),
    email: z.string().trim().toLowerCase().email('E-mail invalido.'),
    departamento: z.string().trim().max(120).nullish(),
    cargo: z.string().trim().max(120).nullish(),
    cpf: z.string().trim().max(20).nullish(),
    idAD: z.string().trim().max(64).nullish(),
    endereco: z.string().trim().max(300).nullish(),
    empresaAD: z.string().trim().max(150).nullish(),
  }),
  // Emprestimo (TEMPORARIA, com prazo) ou entrega definitiva (sem prazo).
  modalidade: z.enum(['TEMPORARIA', 'DEFINITIVA']).default('TEMPORARIA'),
  dataPrevistaDevolucao: dataSchema.nullish(),
  observacoes: z.string().trim().max(500).nullish(),
  // O D4Sign cobra por documento: o operador decide se este emprestimo leva termo.
  enviarTermo: z.boolean().default(true),
  empresaId: z.coerce.number().int().positive().nullish(),
  motivo: z.string().trim().max(300).nullish(),
  acessorios: z.string().trim().max(200).nullish(),
});

export const devolucaoSchema = z.object({
  condicaoNotebook: z
    .enum(['BOM', 'AVARIADO'], { message: 'Informe se o equipamento voltou BOM ou AVARIADO.' })
    .default('BOM'),
  observacoes: z.string().trim().max(500).nullish(),
});

export const renovacaoSchema = z.object({
  novaDataPrevista: dataSchema,
});

export const cancelamentoSchema = z.object({
  motivo: z.string().trim().min(3, 'Descreva o motivo do cancelamento.').max(300),
});

export const listarEmprestimosSchema = z.object({
  status: z.enum(['AGUARDANDO_ASSINATURA', 'ATIVO', 'DEVOLVIDO', 'CANCELADO']).optional(),
  modalidade: z.enum(['TEMPORARIA', 'DEFINITIVA']).optional(),
  // So o administrador escolhe; o analista sempre ve a empresa dele.
  empresaId: z.coerce.number().int().positive().optional(),
});

export class EmprestimoController {
  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { empresaId, ...filtro } = listarEmprestimosSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(
        await emprestimoService.listar({
          ...filtro,
          empresaId: permissaoService.empresaDoFiltro(permissao, empresaId),
        }),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async buscarPorId(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await emprestimoService.buscarPorId(id, await permissaoService.doUsuario(req.usuario)));
    } catch (erro) {
      next(erro);
    }
  }

  async criar(req: Request, res: Response, next: NextFunction) {
    try {
      const dados = criarEmprestimoSchema.parse(req.body);
      const operador = req.usuario ? { email: req.usuario.email, nome: req.usuario.nome } : undefined;
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.status(201).json(await emprestimoService.criar(dados, operador, permissao));
    } catch (erro) {
      next(erro);
    }
  }

  async registrarDevolucao(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { condicaoNotebook, observacoes } = devolucaoSchema.parse(req.body);
      res.json(
        await emprestimoService.registrarDevolucao(
          id,
          condicaoNotebook,
          observacoes,
          req.usuario ? { email: req.usuario.email, nome: req.usuario.nome } : undefined,
          await permissaoService.doUsuario(req.usuario),
        ),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async renovar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { novaDataPrevista } = renovacaoSchema.parse(req.body);
      res.json(
        await emprestimoService.renovar(
          id,
          novaDataPrevista,
          req.usuario?.email,
          await permissaoService.doUsuario(req.usuario),
        ),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async cancelar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { motivo } = cancelamentoSchema.parse(req.body);
      res.json(
        await emprestimoService.cancelar(
          id,
          motivo,
          req.usuario?.email,
          await permissaoService.doUsuario(req.usuario),
        ),
      );
    } catch (erro) {
      next(erro);
    }
  }

  async ativar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(
        await emprestimoService.ativarManualmente(
          id,
          req.usuario?.email,
          await permissaoService.doUsuario(req.usuario),
        ),
      );
    } catch (erro) {
      next(erro);
    }
  }

  /**
   * Recoloca na fila um termo que o sistema parou de tentar gerar. Pensado para
   * depois que alguem conferiu o painel do D4Sign - ver TermoService.
   */
  async tentarTermoNovamente(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      await emprestimoService.exigirEmpresaDoEmprestimo(
        id,
        await permissaoService.doUsuario(req.usuario),
        'gerar termos de cessoes',
      );
      await termoService.tentarNovamente(id, req.usuario?.email);
      res.status(202).json({ mensagem: 'Termo recolocado na fila.' });
    } catch (erro) {
      next(erro);
    }
  }

  /** Pergunta ao D4Sign, na hora, se o termo deste emprestimo ja foi assinado. */
  async verificarAssinatura(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      await emprestimoService.exigirEmpresaDoEmprestimo(
        id,
        await permissaoService.doUsuario(req.usuario),
        'verificar termos',
      );
      res.json(await termoService.verificarAgora(id));
    } catch (erro) {
      next(erro);
    }
  }

  /** Pede ao D4Sign que reenvie o e-mail de convite para assinatura. */
  async reenviarConvite(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      await emprestimoService.exigirEmpresaDoEmprestimo(
        id,
        await permissaoService.doUsuario(req.usuario),
        'reenviar convites de cessoes',
      );
      res.json(await termoService.reenviarConvite(id, req.usuario?.email));
    } catch (erro) {
      next(erro);
    }
  }

  /** PDF do comprovante de devolucao, o mesmo anexado ao e-mail do colaborador. */
  async comprovanteDevolucao(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const { nome, arquivo } = await emprestimoService.comprovanteDeDevolucao(
        id,
        await permissaoService.doUsuario(req.usuario),
      );
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      res.send(arquivo);
    } catch (erro) {
      next(erro);
    }
  }

  async listarHistorico(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      res.json(await emprestimoService.listarHistorico(id, await permissaoService.doUsuario(req.usuario)));
    } catch (erro) {
      next(erro);
    }
  }
}

export const emprestimoController = new EmprestimoController();
