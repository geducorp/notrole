import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';

/**
 * Tratamento central de erros.
 *
 * Antes cada controller fazia `catch (error) { res.status(500).json({ error:
 * error.message }) }`, o que devolvia mensagem interna do Prisma (incluindo
 * nomes de coluna e trechos de SQL) direto para o navegador.
 */
/** Erros do body-parser (express.json): trazem status/type proprios. */
function erroDoCorpo(erro: unknown): { status: number; type?: string } | null {
  if (!erro || typeof erro !== 'object') return null;
  const { status, statusCode, type } = erro as { status?: unknown; statusCode?: unknown; type?: unknown };
  const codigo = typeof status === 'number' ? status : typeof statusCode === 'number' ? statusCode : null;
  if (codigo === null || codigo < 400 || codigo >= 500) return null;
  return { status: codigo, type: typeof type === 'string' ? type : undefined };
}

export function errorHandler(erro: unknown, req: Request, res: Response, _next: NextFunction) {
  // Corpo invalido ou grande demais chegava aqui como erro 500 generico.
  const corpo = !(erro instanceof AppError) ? erroDoCorpo(erro) : null;
  if (corpo) {
    if (corpo.type === 'entity.parse.failed') {
      res.status(400).json({ mensagem: 'O corpo da requisicao nao e um JSON valido.', codigo: 'JSON_INVALIDO' });
      return;
    }
    if (corpo.type === 'entity.too.large' || corpo.status === 413) {
      res.status(413).json({ mensagem: 'Os dados enviados sao grandes demais.', codigo: 'CORPO_GRANDE_DEMAIS' });
      return;
    }
    if (corpo.type === 'encoding.unsupported' || corpo.type === 'charset.unsupported' || corpo.status === 415) {
      res.status(415).json({ mensagem: 'Codificacao do corpo da requisicao nao suportada.', codigo: 'CODIFICACAO' });
      return;
    }
    res.status(corpo.status).json({ mensagem: 'Requisicao invalida.', codigo: 'REQUISICAO_INVALIDA' });
    return;
  }

  if (erro instanceof AppError) {
    res.status(erro.status).json({ mensagem: erro.mensagem, codigo: erro.codigo });
    return;
  }

  if (erro instanceof ZodError) {
    res.status(422).json({
      mensagem: 'Dados invalidos.',
      codigo: 'VALIDACAO',
      campos: erro.issues.map((i) => ({ campo: i.path.join('.'), erro: i.message })),
    });
    return;
  }

  if (erro instanceof Prisma.PrismaClientKnownRequestError) {
    // P2002: violacao de unicidade. P2025: registro nao encontrado.
    // P2003: violacao de chave estrangeira.
    if (erro.code === 'P2002') {
      const campos = (erro.meta?.target as string[] | undefined)?.join(', ') ?? 'campo';
      res.status(409).json({
        mensagem: `Ja existe um registro com esse ${campos}.`,
        codigo: 'DUPLICADO',
      });
      return;
    }
    if (erro.code === 'P2025') {
      res.status(404).json({ mensagem: 'Registro nao encontrado.', codigo: 'NAO_ENCONTRADO' });
      return;
    }
    if (erro.code === 'P2003') {
      res.status(409).json({
        mensagem: 'Nao e possivel remover: existem registros vinculados a este item.',
        codigo: 'EM_USO',
      });
      return;
    }
  }

  const id = Math.random().toString(36).slice(2, 10);
  console.error(`[erro ${id}] ${req.method} ${req.originalUrl}`, erro);

  res.status(500).json({
    mensagem: 'Erro interno do servidor.',
    codigo: 'ERRO_INTERNO',
    referencia: id,
    ...(env.ehProducao ? {} : { detalhe: erro instanceof Error ? erro.message : String(erro) }),
  });
}

export function rotaNaoEncontrada(req: Request, res: Response) {
  res.status(404).json({
    mensagem: `Rota ${req.method} ${req.originalUrl} nao existe.`,
    codigo: 'ROTA_INVALIDA',
  });
}
