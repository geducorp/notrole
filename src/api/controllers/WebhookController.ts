import { timingSafeEqual } from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { env } from '../config/env';
import { emprestimoService } from '../services/EmprestimoService';
import { D4SignPausadoError, LimiteDeRequisicoesError } from '../services/D4SignService';

/**
 * Webhook do D4Sign.
 *
 * Esta rota nao passa pelo middleware do Entra ID: quem chama e o D4Sign, nao
 * um usuario. Em troca, exige o segredo combinado em D4SIGN_WEBHOOK_SECRET.
 * Sem o segredo configurado a rota fica desligada, para nao existir um
 * endpoint publico capaz de ativar emprestimos.
 *
 * O corpo so serve para dizer QUAL documento mudou: o status e reconsultado no
 * D4Sign antes de qualquer transicao (ver EmprestimoService).
 */
const corpoSchema = z.object({
  uuid: z.string().trim().min(1).optional(),
  uuid_document: z.string().trim().min(1).optional(),
  // O D4Sign manda type_post como numero em alguns eventos e texto em outros.
  type_post: z.coerce.string().trim().optional(),
  message: z.string().trim().optional(),
  status: z.coerce.string().trim().optional(),
});

/** Comparacao em tempo constante: nao vaza, pelo tempo de resposta, quanto do segredo bateu. */
function segredoConfere(informado: string | undefined, esperado: string): boolean {
  if (!informado) return false;
  const a = Buffer.from(informado, 'utf8');
  const b = Buffer.from(esperado, 'utf8');
  if (a.length !== b.length) {
    // Compara mesmo assim para nao responder mais rapido quando o tamanho difere.
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

export class WebhookController {
  async d4sign(req: Request, res: Response, next: NextFunction) {
    try {
      if (!env.D4SIGN_WEBHOOK_SECRET) {
        res.status(503).json({ mensagem: 'Webhook desabilitado: segredo nao configurado.' });
        return;
      }

      const cabecalho = req.headers['x-notrole-secret'];
      // A query string continua aceita porque o cadastro de webhook do D4Sign
      // so recebe uma URL, sem cabecalhos customizados - e e assim que
      // docs/CONFIGURACAO.md (2.6) manda cadastrar (.../d4sign?secret=...).
      // Prefira o cabecalho sempre que o chamador permitir: a URL com o
      // segredo pode parar em log de proxy (IIS).
      const informado =
        (typeof cabecalho === 'string' ? cabecalho : undefined) ??
        (typeof req.query.secret === 'string' ? req.query.secret : undefined);

      if (!segredoConfere(informado, env.D4SIGN_WEBHOOK_SECRET)) {
        console.warn('[webhook] Chamada do D4Sign recusada: segredo invalido.');
        res.status(401).json({ mensagem: 'Nao autorizado.' });
        return;
      }

      const corpo = corpoSchema.parse(req.body ?? {});
      const documentId = corpo.uuid ?? corpo.uuid_document;

      if (!documentId) {
        res.status(422).json({ mensagem: 'O corpo do webhook nao traz o uuid do documento.' });
        return;
      }

      try {
        const resultado = await emprestimoService.processarWebhookD4Sign(documentId);
        // Responder 200 mesmo para documento desconhecido evita que o D4Sign
        // fique reenviando indefinidamente uma notificacao que nao nos interessa.
        res.status(200).json(resultado);
      } catch (erro) {
        // Sem cota ou integracao pausada: nao deu para reconsultar. 503 faz o
        // D4Sign tentar de novo mais tarde; a consulta periodica tambem cobre.
        if (erro instanceof LimiteDeRequisicoesError || erro instanceof D4SignPausadoError) {
          res.status(503).json({ mensagem: 'Nao foi possivel confirmar o status no D4Sign agora.' });
          return;
        }
        throw erro;
      }
    } catch (erro) {
      next(erro);
    }
  }
}

export const webhookController = new WebhookController();
