import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { templateService, VARIAVEIS_DISPONIVEIS } from '../services/TemplateService';
import { emailService } from '../services/EmailService';
import { executarCobrancaAgora, executarLembretesAgora } from '../jobs/NotificacaoJob';
import { TAREFA_COBRANCA, TAREFA_LEMBRETE } from '../jobs';
import { ultimaExecucao } from '../jobs/agendador';
import { termoService } from '../services/TermoService';
import { configuracaoService } from '../services/ConfiguracaoService';
import { permissaoService } from '../services/PermissaoService';
import { empresaService } from '../services/EmpresaService';
import { execucoesDaAgenda } from '../utils/cron';
import { env } from '../config/env';

const chaveSchema = z.object({
  chave: z.enum([
    'CONFIRMACAO_EMPRESTIMO',
    'CONFIRMACAO_ENTREGA',
    'LEMBRETE_PREVIO',
    'COBRANCA_ATRASO',
    'DEVOLUCAO_CONFIRMADA',
    'TERMO_PARA_ASSINAR',
  ]),
});

const d4signSchema = z.object({ pausado: z.boolean() });

const atualizarTemplateSchema = z.object({
  assunto: z.string().trim().min(1, 'O assunto e obrigatorio.').max(200),
  corpo: z.string().trim().min(1, 'O corpo da mensagem e obrigatorio.').max(8000),
  ativo: z.boolean().optional(),
});

/**
 * A tela de Configuracoes salvava os templates no localStorage do navegador e
 * o backend os ignorava. Estes endpoints fazem a tela funcionar de verdade.
 */
export class ConfiguracaoController {
  async listarTemplates(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        templates: await templateService.listar(),
        variaveisDisponiveis: VARIAVEIS_DISPONIVEIS,
      });
    } catch (erro) {
      next(erro);
    }
  }

  async atualizarTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const { chave } = chaveSchema.parse(req.params);
      const dados = atualizarTemplateSchema.parse(req.body);
      res.json(await templateService.atualizar(chave, dados, req.usuario?.email));
    } catch (erro) {
      next(erro);
    }
  }

  async restaurarTemplate(req: Request, res: Response, next: NextFunction) {
    try {
      const { chave } = chaveSchema.parse(req.params);
      res.json(await templateService.restaurarPadrao(chave, req.usuario?.email));
    } catch (erro) {
      next(erro);
    }
  }

  /** Envia o template escolhido para o proprio operador, para conferir o texto. */
  async enviarTeste(req: Request, res: Response, next: NextFunction) {
    try {
      const { chave } = chaveSchema.parse(req.params);
      const destinatario = req.usuario?.email;

      if (!destinatario) {
        res.status(400).json({ mensagem: 'Nao foi possivel identificar o seu e-mail no token.' });
        return;
      }

      const resultado = await emailService.enviarPorTemplate({
        chave,
        destinatario,
        // Teste pela tela: responde logo, sem as novas tentativas.
        tentativas: 1,
        variaveis: {
          nome: req.usuario?.nome ?? 'Colaborador de Teste',
          hostname: 'N-EXEMPLO-001',
          patrimonio: 'PAT-0001',
          modelo: 'Dell Latitude 5420',
          data_emprestimo: new Date().toLocaleDateString('pt-BR'),
          data_prevista: new Date().toLocaleDateString('pt-BR'),
          instrucoes_termo:
            '(Aqui entra o aviso de que o colaborador vai receber um segundo e-mail, do D4Sign, ' +
            'com o termo para assinar. Só aparece em empréstimos com termo.)',
          data_devolucao: new Date().toLocaleDateString('pt-BR'),
          dias_atraso: '3',
        },
      });

      res.json({ ...resultado, destinatario });
    } catch (erro) {
      next(erro);
    }
  }

  async testarSmtp(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await emailService.testarConexao());
    } catch (erro) {
      next(erro);
    }
  }

  /** O analista ve so os e-mails das cessoes da empresa dele. */
  async listarEmailsEnviados(req: Request, res: Response, next: NextFunction) {
    try {
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(await emailService.listarEnviados(100, permissaoService.empresaVisivel(permissao)));
    } catch (erro) {
      next(erro);
    }
  }

  /**
   * Dispara as rotinas automaticas sob demanda.
   *
   * O botao "Testar Lembretes" da tela antiga so fazia console.log no
   * navegador; nenhum e-mail saia. Agora ele executa a mesma rotina do cron -
   * com a mesma trava e a mesma reivindicacao por emprestimo (NotificacaoJob):
   * clicar enquanto o cron roda nao duplica e-mail.
   */
  async executarCobranca(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await executarCobrancaAgora());
    } catch (erro) {
      next(erro);
    }
  }

  async executarLembretes(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await executarLembretesAgora());
    } catch (erro) {
      next(erro);
    }
  }

  /**
   * Estado da fila de termos do D4Sign.
   *
   * Mostra quantos termos esperam cota e em quanto tempo a proxima janela abre,
   * para o operador nao precisar adivinhar por que o termo de um emprestimo
   * ainda nao chegou ao colaborador.
   */
  async filaDeTermos(req: Request, res: Response, next: NextFunction) {
    try {
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(await termoService.situacao(permissaoService.empresaVisivel(permissao)));
    } catch (erro) {
      next(erro);
    }
  }

  async processarFilaDeTermos(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json(await termoService.processarPendentes());
    } catch (erro) {
      next(erro);
    }
  }

  /**
   * Quem esta logado e o que pode fazer. A tela usa para esconder o que e so
   * de administrador; o servidor confere de novo em cada rota.
   */
  async eu(req: Request, res: Response, next: NextFunction) {
    try {
      const permissao = await permissaoService.doUsuario(req.usuario);
      const empresa = permissao.empresaId ? await empresaService.buscarPorId(permissao.empresaId) : null;
      res.json({
        email: permissao.email,
        nome: req.usuario?.nome ?? permissao.email,
        admin: permissao.admin,
        empresaId: permissao.empresaId,
        empresa: empresa?.apelido ?? null,
        // Analista sem empresa no AD: as outras rotas respondem 403 SEM_EMPRESA.
        semEmpresa: permissaoService.semEmpresa(permissao),
        grupoAdministradores: Boolean(env.grupoAdministradoresId),
      });
    } catch (erro) {
      next(erro);
    }
  }

  /** Botao liga/desliga do D4Sign. */
  async pausarD4sign(req: Request, res: Response, next: NextFunction) {
    try {
      const { pausado } = d4signSchema.parse(req.body);
      const pausa = await configuracaoService.pausarD4sign(pausado, req.usuario?.email);
      // Religado: o que ficou na fila sai agora, sem esperar a rotina.
      if (!pausado) termoService.agendar();
      res.json(pausa);
    } catch (erro) {
      next(erro);
    }
  }

  /** Estado das integracoes, para a tela mostrar o que esta configurado. */
  async status(_req: Request, res: Response, next: NextFunction) {
    try {
      const rotina = (id: 'lembretes' | 'cobranca', tarefa: string, expressao: string) => {
        const agenda = env.JOBS_HABILITADOS ? execucoesDaAgenda(expressao, env.CRON_TIMEZONE) : null;
        const ultima = ultimaExecucao(tarefa);
        return {
          id,
          expressao,
          anterior: agenda?.anterior.toISOString() ?? null,
          proxima: agenda?.proxima.toISOString() ?? null,
          ultimaExecucao: ultima && { ...ultima, em: ultima.em.toISOString() },
        };
      };
      const pausa = configuracaoService.pausaDoD4sign;

      res.json({
        ambiente: env.NODE_ENV,
        // configurado = ligado no .env e com credenciais: e o que exige o
        // termo no formulario. pausado = desligado pela tela; os termos ficam
        // na fila ate religar.
        d4sign: {
          configurado: env.d4signHabilitado,
          credenciais: env.d4signCredenciais,
          ativo: env.D4SIGN_ATIVO,
          pausado: pausa.pausado,
          alteradoPor: pausa.alteradoPor,
          alteradoEm: pausa.alteradoEm?.toISOString() ?? null,
        },
        entraId: {
          tenantConfigurado: Boolean(env.AZURE_TENANT_ID),
          grupoRestrito: Boolean(env.grupoAutorizadoId),
          grupoAdministradores: Boolean(env.grupoAdministradoresId),
        },
        jobs: {
          habilitados: env.JOBS_HABILITADOS,
          cobranca: env.CRON_COBRANCA,
          lembrete: env.CRON_LEMBRETE,
          fusoHorario: env.CRON_TIMEZONE,
          rotinas: [
            rotina('lembretes', TAREFA_LEMBRETE, env.CRON_LEMBRETE),
            rotina('cobranca', TAREFA_COBRANCA, env.CRON_COBRANCA),
          ],
        },
        smtp: { host: env.SMTP_HOST, porta: env.SMTP_PORT, remetente: env.SMTP_USER },
      });
    } catch (erro) {
      next(erro);
    }
  }
}

export const configuracaoController = new ConfiguracaoController();
