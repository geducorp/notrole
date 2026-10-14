import nodemailer from 'nodemailer';
import type { TipoTemplate } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { templateService, type VariaveisTemplate } from './TemplateService';

/**
 * Envio de e-mails.
 *
 * Diferencas em relacao a versao anterior:
 *  - os textos vem dos templates salvos no banco, editaveis pela tela de
 *    Configuracoes (antes eram fixos no codigo e a tela nao servia para nada);
 *  - todo envio e registrado na tabela EmailEnviado, com sucesso ou erro, para
 *    que se possa responder "o sistema avisou o colaborador?";
 *  - a verificacao de certificado do SMTP e explicita via .env, em vez de um
 *    `rejectUnauthorized: false` solto no meio do codigo.
 */
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  private obterTransporter(): nodemailer.Transporter {
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
        tls: { rejectUnauthorized: env.SMTP_REJECT_UNAUTHORIZED },
        // O SMTP da empresa leva de 11 a 14 s so para responder ao "ola"
        // (medido em 13/10/2026). Com o padrao de 30 s do nodemailer, um
        // momento mais lento derrubava o envio ("Greeting never received").
        connectionTimeout: 60_000,
        greetingTimeout: 60_000,
        socketTimeout: 120_000,
      });
    }
    return this.transporter;
  }

  /**
   * Falha que vale tentar de novo: rede, tempo esgotado ou recusa temporaria
   * do servidor (codigos 4xx). Endereco invalido, autenticacao etc. nao.
   */
  private falhaPassageira(erro: unknown): boolean {
    const e = erro as { code?: string; responseCode?: number; message?: string };
    if (e?.responseCode && e.responseCode >= 400 && e.responseCode < 500) return true;
    if (['ETIMEDOUT', 'ECONNECTION', 'ESOCKET', 'ECONNRESET', 'EDNS', 'ECONNREFUSED'].includes(e?.code ?? '')) {
      return true;
    }
    return /greeting never received|timeout|timed out|connection closed/i.test(e?.message ?? '');
  }

  /** Confere se o servidor SMTP aceita a conexao e as credenciais. */
  async testarConexao(): Promise<{ ok: boolean; erro?: string }> {
    try {
      await this.obterTransporter().verify();
      return { ok: true };
    } catch (erro) {
      return { ok: false, erro: erro instanceof Error ? erro.message : String(erro) };
    }
  }

  /**
   * Monta o e-mail a partir do template e envia. Nunca lanca: uma falha de
   * SMTP nao pode derrubar a operacao de negocio que disparou a notificacao.
   * O resultado fica registrado em EmailEnviado.
   */
  async enviarPorTemplate(opcoes: {
    chave: TipoTemplate;
    destinatario: string;
    variaveis: VariaveisTemplate;
    emprestimoId?: number;
    /** Arquivos anexados ao e-mail (ex: comprovante de devolucao em PDF). */
    anexos?: Array<{ nome: string; conteudo: Buffer; tipo?: string }>;
    /** Padrao 3. O botao de teste usa 1, para responder logo. */
    tentativas?: number;
  }): Promise<{ enviado: boolean; erro?: string }> {
    const { chave, destinatario, variaveis, emprestimoId, anexos } = opcoes;

    const template = await templateService.obter(chave);

    if (!template.ativo) {
      console.log(`[email] Template ${chave} esta desativado; nada foi enviado.`);
      return { enviado: false, erro: 'Template desativado' };
    }

    const assunto = templateService.renderizar(template.assunto, variaveis);
    const corpo = templateService.renderizar(template.corpo, variaveis);

    let sucesso = false;
    let erro: string | undefined;

    // Ate 3 tentativas, com 20 s e 60 s de intervalo, quando a falha e
    // passageira (SMTP lento ou fora por um instante). Todos os envios de
    // negocio rodam em segundo plano, entao a espera nao trava a tela.
    const tentativas = Math.max(1, opcoes.tentativas ?? 3);
    const esperas = [20_000, 60_000];

    for (let tentativa = 1; tentativa <= tentativas && !sucesso; tentativa++) {
      try {
        const info = await this.obterTransporter().sendMail({
          from: `"${env.SMTP_FROM_NAME}" <${env.SMTP_USER}>`,
          to: destinatario,
          subject: assunto,
          text: corpo,
          html: templateService.paraHtml(corpo),
          ...(anexos?.length
            ? {
                attachments: anexos.map((a) => ({
                  filename: a.nome,
                  content: a.conteudo,
                  contentType: a.tipo ?? "application/pdf",
                })),
              }
            : {}),
        });
        sucesso = true;
        erro = undefined;
        console.log(
          `[email] ${chave} enviado para ${destinatario} (${info.messageId})` +
            (tentativa > 1 ? ` na tentativa ${tentativa}` : ''),
        );
      } catch (e) {
        erro = e instanceof Error ? e.message : String(e);
        const vaiRepetir = tentativa < tentativas && this.falhaPassageira(e);
        console.error(
          `[email] Falha ao enviar ${chave} para ${destinatario} (tentativa ${tentativa}/${tentativas}): ${erro}` +
            (vaiRepetir ? ' - tentando de novo.' : ''),
        );
        if (!vaiRepetir) {
          if (tentativa > 1) erro = `${erro} (depois de ${tentativa} tentativas)`;
          break;
        }
        await new Promise((r) => setTimeout(r, esperas[tentativa - 1] ?? 60_000));
      }
    }

    await prisma.emailEnviado
      .create({
        data: {
          destinatario,
          assunto,
          template: chave,
          sucesso,
          erro: erro ?? null,
          emprestimoId: emprestimoId ?? null,
        },
      })
      .catch((e) => console.error('[email] Nao foi possivel registrar o envio:', e));

    return { enviado: sucesso, erro };
  }

  /** Com empresa, so os e-mails das cessoes de equipamentos dela. */
  listarEnviados(limite = 100, empresaId?: number) {
    return prisma.emailEnviado.findMany({
      where: empresaId ? { emprestimo: { item: { empresaId } } } : undefined,
      orderBy: { enviadoEm: 'desc' },
      take: limite,
      include: { emprestimo: { include: { item: true, colaborador: true } } },
    });
  }
}

export const emailService = new EmailService();
