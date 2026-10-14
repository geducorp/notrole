import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { empresaService } from '../services/EmpresaService';
import { permissaoService } from '../services/PermissaoService';
import { idParamSchema } from './ItemController';

const empresaSchema = z.object({
  apelido: z.string().trim().min(2).max(60),
  razaoSocial: z.string().trim().min(3).max(200),
  cnpj: z
    .string()
    .trim()
    .regex(/^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/, 'Use o formato 00.000.000/0000-00.'),
  logradouro: z.string().trim().min(3).max(200),
  cidade: z.string().trim().min(2).max(100),
  uf: z
    .string()
    .trim()
    .length(2, 'Use a sigla do estado, com 2 letras.')
    .transform((v) => v.toUpperCase()),
  cep: z.string().trim().regex(/^\d{5}-\d{3}$/, 'Use o formato 00000-000.'),
  d4signPastaId: z.string().trim().max(64).nullish(),
  termosAD: z.string().trim().min(2, 'Informe ao menos uma palavra para reconhecer a empresa no AD.').max(200),
  padrao: z.boolean(),
  ativo: z.boolean(),
});

const atualizarEmpresaSchema = empresaSchema.partial();

/** Cadastro: tudo obrigatorio, menos pasta do D4Sign, padrao e ativo. */
const criarEmpresaSchema = empresaSchema.extend({
  padrao: z.boolean().default(false),
  ativo: z.boolean().default(true),
});

const identificarSchema = z.object({ empresaAD: z.string().trim().max(150).optional() });

export class EmpresaController {
  async listar(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await empresaService.listar());
    } catch (erro) {
      next(erro);
    }
  }

  async criar(req: Request, res: Response, next: NextFunction) {
    try {
      const dados = criarEmpresaSchema.parse(req.body);
      const empresa = await empresaService.criar(dados);
      // Uma empresa nova pode passar a reconhecer analistas pelo AD: vale ja.
      permissaoService.esquecer();
      res.status(201).json(empresa);
    } catch (erro) {
      next(erro);
    }
  }

  async atualizar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const dados = atualizarEmpresaSchema.parse(req.body);
      const empresa = await empresaService.atualizar(id, dados);
      // termosAD, ativo e padrao mudam a empresa de cada analista: vale ja.
      permissaoService.esquecer();
      res.json(empresa);
    } catch (erro) {
      next(erro);
    }
  }

  /** Qual empresa corresponde ao campo "Empresa" do AD - usado no formulario. */
  async identificar(req: Request, res: Response, next: NextFunction) {
    try {
      const { empresaAD } = identificarSchema.parse(req.query);
      res.json(await empresaService.identificar(empresaAD));
    } catch (erro) {
      next(erro);
    }
  }
}

export const empresaController = new EmpresaController();
