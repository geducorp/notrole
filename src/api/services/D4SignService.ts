import axios, { type AxiosInstance } from 'axios';
import { env } from '../config/env';
import { LimitadorDeTaxa } from '../utils/LimitadorDeTaxa';
import { configuracaoService } from './ConfiguracaoService';
import { AppError } from '../utils/AppError';

/** Tentativa de falar com o D4Sign com a integracao pausada. */
export class D4SignPausadoError extends AppError {
  constructor() {
    super(
      'A integracao com o D4Sign esta pausada em Configuracoes. Religue para usar esta opcao.',
      409,
      'D4SIGN_PAUSADO',
    );
  }
}

/**
 * Cliente da API do D4Sign.
 *
 * ATENCAO - CUSTO
 * ---------------
 * A conta do D4Sign e da empresa inteira (nao so do Notrole) e o uso e cobrado,
 * principalmente por documento criado. Por isso:
 *
 *  - Os tres passos de um termo (criar, adicionar signatario, enviar) sao
 *    metodos separados. Quem orquestra e o TermoService, que grava a etapa
 *    concluida depois de cada passo. Assim uma falha no meio nunca leva a criar
 *    um segundo documento para o mesmo emprestimo.
 *
 *  - Toda chamada passa pelo limitador de taxa, inclusive consultas e
 *    cancelamentos.
 *
 *  - Uma falha AMBIGUA ao criar o documento (sem resposta do servidor: timeout,
 *    queda de rede) e sinalizada com FalhaAmbiguaError. Nesse caso o D4Sign
 *    pode ter criado o documento sem conseguirmos saber o uuid, e tentar de novo
 *    poderia gerar uma duplicata cobrada. O TermoService para e pede que alguem
 *    confira no painel antes.
 */

/** Documento ja preenchido pelo Notrole, pronto para subir ao D4Sign. */
export interface DocumentoParaEnvio {
  nome: string;
  arquivo: Buffer;
  /** Pasta da empresa dentro do cofre. */
  pastaId?: string | null;
}

export interface Signatario {
  email: string;
  /** Codigos do D4Sign: 1 = assinar, 5 = assinar como testemunha. */
  papel: 'ASSINAR' | 'TESTEMUNHA';
}

/** Um signatario do documento e a situacao do e-mail de convite dele. */
export interface SituacaoSignatario {
  email: string;
  /** key_signer - necessario para reenviar o convite. Nao e guardado. */
  chave: string;
  assinou: boolean;
  /** email_sent_status do D4Sign; vazio enquanto o envio nao foi processado. */
  statusEmail: string;
  mensagemEmail: string;
  /** O e-mail voltou ou nem saiu (ex.: endereco na lista de supressao). */
  emailComProblema: boolean;
}

/** Resultado do cancelamento de um documento no D4Sign. */
export type ResultadoCancelamento =
  | { cancelado: true }
  | {
      cancelado: false;
      /** O documento ja foi assinado: continua valido no D4Sign. */
      finalizado: boolean;
      motivo: string;
    };

const MIME_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Chamadas que um termo completo consome. */
export const CHAMADAS_POR_TERMO = 3;

/** Sem cota agora: nao e falha, e "tente mais tarde". */
export class LimiteDeRequisicoesError extends Error {
  constructor(public readonly esperaMs: number) {
    super('Limite de requisicoes do D4Sign atingido.');
    this.name = 'LimiteDeRequisicoesError';
  }
}

/**
 * A chamada saiu, mas nao sabemos se o D4Sign a executou. Usado so na criacao
 * do documento, onde repetir pode significar pagar duas vezes.
 */
export class FalhaAmbiguaError extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'FalhaAmbiguaError';
  }
}

const URL_BASE = {
  producao: 'https://secure.d4sign.com.br/api/v1',
  sandbox: 'https://sandbox.d4sign.com.br/api/v1',
} as const;

export class D4SignService {
  private http: AxiosInstance | null = null;

  readonly limitador = new LimitadorDeTaxa(env.D4SIGN_REQUISICOES_POR_HORA);

  /** Ligado no .env e com credenciais. */
  get configurado(): boolean {
    return env.d4signHabilitado;
  }

  /** Desligado pelo administrador na tela de Configuracoes. */
  get pausado(): boolean {
    return configuracaoService.d4signPausado;
  }

  /** Pode conversar com o D4Sign agora. */
  get habilitado(): boolean {
    return this.configurado && !this.pausado;
  }

  private cliente(): AxiosInstance {
    // Trava final: com a integracao pausada, nenhuma requisicao sai daqui,
    // venha de onde vier.
    if (this.pausado) throw new D4SignPausadoError();
    if (!this.http) {
      this.http = axios.create({
        baseURL: URL_BASE[env.D4SIGN_AMBIENTE],
        timeout: 30_000,
        // O cryptKey e opcional: so e enviado se a conta tiver um.
        params: {
          tokenAPI: env.D4SIGN_API_KEY,
          ...(env.D4SIGN_CRYPT_KEY ? { cryptKey: env.D4SIGN_CRYPT_KEY } : {}),
        },
      });
    }
    return this.http;
  }

  private descreverErro(erro: unknown): string {
    if (axios.isAxiosError(erro)) {
      const corpo = erro.response?.data;
      const texto = typeof corpo === 'string' ? corpo : JSON.stringify(corpo ?? erro.message);
      return erro.response ? `HTTP ${erro.response.status}: ${texto}` : texto;
    }
    return erro instanceof Error ? erro.message : String(erro);
  }

  private ehLimiteDeRequisicoes(erro: unknown): boolean {
    if (!axios.isAxiosError(erro)) return false;
    if (erro.response?.status === 429) return true;
    const corpo = JSON.stringify(erro.response?.data ?? '');
    return /limit|excedid|too many|rate/i.test(corpo);
  }

  /** Reserva uma chamada ou avisa quanto falta para liberar. */
  private reservar(): void {
    if (!this.limitador.reservar(1)) {
      throw new LimiteDeRequisicoesError(this.limitador.esperaAteLiberar(1));
    }
  }

  private tratarErro(erro: unknown, acao: string): never {
    if (erro instanceof AppError) throw erro;
    if (this.ehLimiteDeRequisicoes(erro)) {
      throw new LimiteDeRequisicoesError(this.limitador.esperaAteLiberar(1));
    }
    const detalhe = this.descreverErro(erro);
    console.error(`[d4sign] Falha ao ${acao}: ${detalhe}`);
    throw new Error(`Falha ao ${acao} no D4Sign: ${detalhe.slice(0, 200)}`);
  }

  // -------------------------------------------------------------------------
  // Passo 1 de 3 - o unico que gera cobranca
  // -------------------------------------------------------------------------

  async criarDocumento(documento: DocumentoParaEnvio): Promise<string> {
    this.reservar();

    // O documento vai PRONTO: o Notrole preenche o modelo Word (ver
    // ContratoService) e o D4Sign so recolhe as assinaturas. O motor de modelos
    // do D4Sign deixava em branco boa parte dos campos do nosso modelo.
    try {
      const resposta = await this.cliente().post(`/documents/${env.D4SIGN_SAFE_ID}/uploadbinary`, {
        base64_binary_file: documento.arquivo.toString('base64'),
        mime_type: MIME_DOCX,
        name: documento.nome,
        ...(documento.pastaId ? { uuid_folder: documento.pastaId } : {}),
      });

      const uuid = (resposta.data?.uuid ?? resposta.data?.uuid_document) as string | undefined;
      if (!uuid) {
        // O D4Sign respondeu, mas sem uuid. Pode ter criado o documento mesmo
        // assim - trata como ambiguo para ninguem repetir no escuro.
        throw new FalhaAmbiguaError(
          `O D4Sign respondeu sem o identificador do documento: ${JSON.stringify(resposta.data).slice(0, 200)}`,
        );
      }

      return uuid;
    } catch (erro) {
      if (erro instanceof FalhaAmbiguaError) throw erro;

      // Sem resposta nenhuma (timeout, queda de rede): o pedido pode ter sido
      // processado do lado de la. Nao arriscamos uma segunda cobranca.
      if (axios.isAxiosError(erro) && !erro.response) {
        throw new FalhaAmbiguaError(
          `Sem resposta do D4Sign ao criar o documento (${erro.code ?? erro.message}). ` +
            'Confira no painel do D4Sign se o documento foi criado antes de tentar de novo.',
        );
      }

      return this.tratarErro(erro, 'criar o documento');
    }
  }

  // -------------------------------------------------------------------------
  // Passo 2 de 3
  // -------------------------------------------------------------------------

  /** Cadastra todos os signatarios numa unica chamada. */
  async adicionarSignatarios(uuid: string, signatarios: Signatario[]): Promise<void> {
    this.reservar();
    try {
      await this.cliente().post(`/documents/${uuid}/createlist`, {
        signers: signatarios.map((s) => ({
          email: s.email,
          // 1 = assinar; 5 = assinar como testemunha.
          act: s.papel === 'TESTEMUNHA' ? '5' : '1',
          // 0 = signatario brasileiro, com CPF: o D4Sign pede o CPF na tela de
          // assinatura e o registra no carimbo da assinatura.
          foreign: '0',
          // 0 = assinatura eletronica padrao do D4Sign, sem certificado
          // ICP-Brasil.
          certificadoicpbr: '0',
          // 0 = assinatura remota, pelo link enviado por e-mail.
          assinatura_presencial: '0',
          // Nenhum campo opcional e enviado. SMS, WhatsApp, selfie, video, PIX
          // e D4Sign Score ficam de fora de proposito: sao recursos que
          // costumam ter custo adicional no D4Sign.
        })),
      });
    } catch (erro) {
      this.tratarErro(erro, 'cadastrar os signatarios');
    }
  }

  // -------------------------------------------------------------------------
  // Passo 3 de 3
  // -------------------------------------------------------------------------

  /** `mensagem` aparece dentro do e-mail de convite do D4Sign. */
  async enviarParaAssinatura(uuid: string, mensagem: string): Promise<void> {
    this.reservar();
    try {
      await this.cliente().post(`/documents/${uuid}/sendtosigner`, {
        message: mensagem,
        skip_email: '0',
        workflow: '0',
      });
    } catch (erro) {
      this.tratarErro(erro, 'enviar o documento para assinatura');
    }
  }

  // -------------------------------------------------------------------------
  // Consulta e cancelamento
  // -------------------------------------------------------------------------

  /**
   * Situacao do documento. Custa 1 requisicao e nao cria nada.
   *
   * Codigos do D4Sign: 1 Processando, 2 Aguardando signatarios, 3 Aguardando
   * assinaturas, 4 Finalizado, 5 Arquivado, 6 Cancelado, 7 Editando.
   */
  async consultarStatus(
    uuid: string,
  ): Promise<{ statusId: string; status: string; assinado: boolean; cancelado: boolean }> {
    this.reservar();
    try {
      const resposta = await this.cliente().get(`/documents/${uuid}`);
      const doc = Array.isArray(resposta.data) ? resposta.data[0] : resposta.data;
      const statusId = String(doc?.statusId ?? '');
      const status = String(doc?.statusName ?? statusId ?? 'desconhecido');

      return {
        statusId,
        status,
        // Arquivado so acontece depois de finalizado, entao tambem conta.
        assinado: statusId === '4' || statusId === '5',
        cancelado: statusId === '6',
      };
    } catch (erro) {
      return this.tratarErro(erro, 'consultar o documento');
    }
  }

  /**
   * Cancela o documento. Nunca lanca: devolve se cancelou e, se nao, o motivo,
   * para quem chamou registrar no historico e avisar o operador. Sem cota, nao
   * insiste: o documento fica pendente no D4Sign e alguem cancela pelo painel.
   */
  async cancelar(uuid: string): Promise<ResultadoCancelamento> {
    if (this.pausado) {
      console.warn(`[d4sign] Integracao pausada: cancele ${uuid} pelo painel do D4Sign.`);
      return { cancelado: false, finalizado: false, motivo: 'a integracao com o D4Sign esta pausada' };
    }
    if (!this.limitador.reservar(1)) {
      console.warn(`[d4sign] Sem cota para cancelar ${uuid} agora; cancele pelo painel do D4Sign.`);
      return { cancelado: false, finalizado: false, motivo: 'sem cota de requisicoes do D4Sign agora' };
    }
    try {
      await this.cliente().post(`/documents/${uuid}/cancel`, {
        comment: 'Emprestimo cancelado no Notrole.',
      });
      return { cancelado: true };
    } catch (erro) {
      const detalhe = this.descreverErro(erro);
      console.error(`[d4sign] Falha ao cancelar ${uuid}: ${detalhe}`);
      // Documento ja assinado por todos: o D4Sign recusa com "File finalized".
      const finalizado =
        axios.isAxiosError(erro) && erro.response?.status === 400 && /finaliz/i.test(detalhe);
      return {
        cancelado: false,
        finalizado,
        motivo: finalizado ? 'o documento ja estava assinado (finalizado)' : detalhe.slice(0, 200),
      };
    }
  }

  // -------------------------------------------------------------------------
  // E-mail de convite
  // -------------------------------------------------------------------------

  /**
   * Signatarios do documento e a situacao do e-mail de cada um. Custa 1
   * requisicao. O D4Sign envia pelo Amazon SES e registra aqui o resultado,
   * por exemplo "Bounce" quando o endereco esta na lista de supressao.
   */
  async listarSignatarios(uuid: string): Promise<SituacaoSignatario[]> {
    this.reservar();
    try {
      const resposta = await this.cliente().get(`/documents/${uuid}/list`);
      const dados: unknown[] = Array.isArray(resposta.data) ? resposta.data : [resposta.data];
      const lista = dados.flatMap((d) => {
        const item = d as { list?: unknown[] };
        return Array.isArray(item?.list) ? item.list : [d];
      }) as Array<Record<string, unknown>>;

      return lista
        .filter((s) => typeof s?.email === 'string' && s.email)
        .map((s) => {
          const statusEmail = String(s.email_sent_status ?? '').trim();
          const mensagemEmail = String(s.email_sent_message ?? '').trim();
          return {
            email: String(s.email),
            chave: String(s.key_signer ?? ''),
            assinou: String(s.signed) === '1',
            statusEmail,
            mensagemEmail,
            emailComProblema: /bounce|complaint|reject|fail|erro|suppress/i.test(
              `${statusEmail} ${mensagemEmail}`,
            ),
          };
        });
    } catch (erro) {
      return this.tratarErro(erro, 'consultar os signatarios');
    }
  }

  /**
   * Reenvia o convite de assinatura. Nao gera documento nem envio novo. O
   * D4Sign so aceita reenviar depois de 1 minuto do envio, depois 5, 30 e 60
   * minutos entre um reenvio e outro.
   */
  async reenviarConvite(uuid: string, signatario: { email: string; chave: string }): Promise<void> {
    this.reservar();
    try {
      await this.cliente().post(`/documents/${uuid}/resend`, {
        email: signatario.email,
        key_signer: signatario.chave,
      });
    } catch (erro) {
      this.tratarErro(erro, `reenviar o convite para ${signatario.email}`);
    }
  }
}

export const d4signService = new D4SignService();
