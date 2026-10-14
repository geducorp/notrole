import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { reportService } from '../services/ReportService';
import { planilhaService } from '../services/PlanilhaService';
import { permissaoService } from '../services/PermissaoService';

/** So o administrador escolhe a empresa; o analista sempre ve a dele. */
const filtroSchema = z.object({
  empresaId: z.coerce.number().int().positive().optional(),
});

/** Empresa a usar no relatorio, conforme o perfil (ver PermissaoService). */
async function empresaDoRelatorio(req: Request, pedida?: number) {
  return permissaoService.empresaDoFiltro(await permissaoService.doUsuario(req.usuario), pedida);
}

const planilhaSchema = filtroSchema.extend({
  painel: z.enum(['estoque', 'emprestimos']).default('estoque'),
  /** Nome da categoria (tipo de equipamento) para filtrar o painel de estoque. */
  tipo: z.string().trim().min(1).max(60).optional(),
});

const pdfEstoqueSchema = filtroSchema.extend({
  categoriaId: z.coerce.number().int().positive().optional(),
});

export class ReportController {
  async dashboard(req: Request, res: Response, next: NextFunction) {
    try {
      const { empresaId } = filtroSchema.parse(req.query);
      res.json(await reportService.obterMetricasDashboard(await empresaDoRelatorio(req, empresaId)));
    } catch (erro) {
      next(erro);
    }
  }

  /** Planilha do dashboard (.xlsx), com a empresa escolhida na tela. */
  async planilha(req: Request, res: Response, next: NextFunction) {
    try {
      const { painel, empresaId, tipo } = planilhaSchema.parse(req.query);
      const { nome, arquivo } = await planilhaService.gerar(
        painel,
        await empresaDoRelatorio(req, empresaId),
        tipo,
      );
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
      res.send(arquivo);
    } catch (erro) {
      next(erro);
    }
  }

  async pdfItens(req: Request, res: Response, next: NextFunction) {
    try {
      // Valida antes de mandar qualquer cabecalho, para o erro sair em JSON.
      const filtro = pdfEstoqueSchema.parse(req.query);
      const empresaId = await empresaDoRelatorio(req, filtro.empresaId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="estoque-ti.pdf"');
      await reportService.gerarRelatorioItens(res, { ...filtro, empresaId });
    } catch (erro) {
      // Se o PDF ja comecou a ser transmitido nao da para trocar o status.
      if (res.headersSent) {
        res.end();
        return;
      }
      next(erro);
    }
  }

  async pdfEmprestimos(req: Request, res: Response, next: NextFunction) {
    try {
      const { empresaId } = filtroSchema.parse(req.query);
      const empresa = await empresaDoRelatorio(req, empresaId);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', 'attachment; filename="emprestimos-em-aberto.pdf"');
      await reportService.gerarRelatorioEmprestimos(res, empresa);
    } catch (erro) {
      if (res.headersSent) {
        res.end();
        return;
      }
      next(erro);
    }
  }
}

export const reportController = new ReportController();
