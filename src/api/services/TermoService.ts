import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { formatarData } from '../utils/datas';
import { descricaoDoItem, nomeDoItem } from '../utils/itens';
import { dataPorExtenso, formatarCpf, formatarMoeda } from '../utils/documentos';
import { emprestimoRepository, type EmprestimoCompleto } from '../repositories/EmprestimoRepository';
import { historicoRepository } from '../repositories/HistoricoRepository';
import {
  CHAMADAS_POR_TERMO,
  d4signService,
  D4SignPausadoError,
  FalhaAmbiguaError,
  LimiteDeRequisicoesError,
  type Signatario,
  type SituacaoSignatario,
} from './D4SignService';
import { ContratoService, caminhoModeloEntrega, caminhoModeloPadrao } from './ContratoService';
import { empresaService } from './EmpresaService';
import { enviarConfirmacao, enviarTermoParaAssinar, mensagemDoConvite } from './AvisosDoEmprestimo';

/** Emprestimo (com prazo) e entrega definitiva usam contratos diferentes. */
const contratoDoEmprestimo = new ContratoService(env.D4SIGN_MODELO || caminhoModeloPadrao());
const contratoDaEntrega = new ContratoService(caminhoModeloEntrega());

/**
 * Termos de responsabilidade no D4Sign.
 *
 * REGRA DE OURO: o D4Sign e da empresa inteira e o uso e cobrado,
 * principalmente por documento criado. Tudo aqui foi desenhado para que o
 * Notrole crie NO MAXIMO UM documento por emprestimo e faca o minimo de
 * chamadas possivel.
 *
 * Como isso e garantido
 * ---------------------
 * 1. Retomada por etapa. Gerar um termo sao tres chamadas: criar o documento,
 *    adicionar o signatario, enviar. A etapa concluida e gravada no banco logo
 *    apos cada uma. Se a segunda falhar, a proxima tentativa comeca direto da
 *    segunda - o documento nunca e criado de novo. (A versao anterior recomecava
 *    do zero e criaria um documento novo, cobrado, a cada tentativa.)
 *
 * 2. Falha ambigua para tudo. Se a criacao do documento ficar sem resposta
 *    (timeout, queda de rede), o D4Sign pode ter criado o documento sem que
 *    saibamos. O sistema NAO tenta de novo sozinho: marca o emprestimo para
 *    alguem conferir o painel do D4Sign antes.
 *
 * 3. Desistir e desistir. Esgotadas as tentativas, o emprestimo sai da fila e
 *    so volta se um operador pedir. (Antes ele voltava a cada cinco minutos,
 *    para sempre.)
 *
 * 4. Cota propria abaixo do limite da conta, para nao esgotar a cota de outras
 *    integracoes da empresa (D4SIGN_REQUISICOES_POR_HORA).
 *
 * 5. Consulta de assinatura economica: so em horario comercial, no maximo a
 *    cada D4SIGN_HORAS_ENTRE_CONSULTAS por documento, e so durante
 *    D4SIGN_DIAS_MAX_CONSULTA dias. Pode ser desligada por completo.
 *
 * 6. O operador escolhe, a cada emprestimo, se o termo deve ser enviado. O
 *    emprestimo sem termo nao toca no D4Sign.
 *
 * A rotina que processa a fila acorda a cada cinco minutos, mas so consulta o
 * banco do proprio Notrole. Ela so chama o D4Sign quando ha algo a fazer.
 */

type Etapa = 'CRIADO' | 'SIGNATARIO' | 'ENVIADO';

/** Quantas chamadas faltam para concluir o termo a partir de cada etapa. */
function chamadasRestantes(etapa: string | null): number {
  if (etapa === 'ENVIADO') return 0;
  if (etapa === 'SIGNATARIO') return 1;
  if (etapa === 'CRIADO') return 2;
  return CHAMADAS_POR_TERMO;
}

/**
 * Espera entre enviar (ou reenviar) o termo e conferir se o e-mail de convite
 * saiu. O D4Sign registra o resultado do envio em segundos; a folga evita
 * perguntar antes disso.
 */
const MINUTOS_PARA_CONFERIR_EMAIL = 10;

function minutosAFrente(minutos: number): Date {
  return new Date(Date.now() + minutos * 60_000);
}

/** Texto curto do problema no e-mail de um signatario, para a tela. */
function descreverProblemaDeEmail(s: SituacaoSignatario): string {
  if (/suppression/i.test(s.mensagemEmail)) {
    return 'endereco na lista de supressao do D4Sign (o e-mail nem foi enviado)';
  }
  const detalhe = s.mensagemEmail ? ` - ${s.mensagemEmail.slice(0, 120)}` : '';
  return `${s.statusEmail || 'erro no envio'}${detalhe}`;
}

/** Quantos dos signatarios ja assinaram, e quem falta. */
export interface ProgressoAssinatura {
  assinados: number;
  total: number;
  faltam: string[];
}

/** Sem cota agora: erro amigavel para a tela. */
function erroSemCota(esperaMs: number): AppError {
  return new AppError(
    'A cota de requisicoes do D4Sign desta hora acabou. Tente novamente em ' +
      `${Math.ceil(esperaMs / 60_000)} minuto(s).`,
    429,
    'SEM_COTA',
  );
}

/** Horario comercial em Brasilia: segunda a sexta, das 8h as 18h59. */
function emHorarioComercial(agora = new Date()): boolean {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: env.CRON_TIMEZONE,
    weekday: 'short',
    hour: 'numeric',
    hour12: false,
  }).formatToParts(agora);

  const dia = partes.find((p) => p.type === 'weekday')?.value ?? '';
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? '0');

  return !['Sat', 'Sun'].includes(dia) && hora >= 8 && hora < 19;
}

export interface ResultadoFilaTermos {
  pendentes: number;
  gerados: number;
  adiados: number;
  falharam: number;
  cotaRestante: number;
  proximaJanelaEmMinutos: number | null;
  detalhes: string[];
}

export class TermoService {
  // Impede que o cron e um clique no botao processem a fila ao mesmo tempo -
  // os dois poderiam pegar o mesmo emprestimo e criar dois documentos.
  private processando = false;

  /** Chamado logo apos registrar um emprestimo com termo. Nao bloqueia. */
  agendar(): void {
    if (!d4signService.habilitado) return;
    void this.processarPendentes().catch((erro) =>
      console.error('[termo] Falha ao processar a fila:', erro),
    );
  }

  // -------------------------------------------------------------------------
  // Geracao
  // -------------------------------------------------------------------------

  async processarPendentes(): Promise<ResultadoFilaTermos> {
    const resultado: ResultadoFilaTermos = {
      pendentes: 0,
      gerados: 0,
      adiados: 0,
      falharam: 0,
      cotaRestante: 0,
      proximaJanelaEmMinutos: null,
      detalhes: [],
    };

    if (!d4signService.configurado) {
      resultado.detalhes.push('Integracao com o D4Sign nao esta configurada.');
      return resultado;
    }
    if (d4signService.pausado) {
      resultado.detalhes.push('A integracao com o D4Sign esta pausada. Os termos seguem na fila ate ela ser religada.');
      return resultado;
    }

    if (this.processando) {
      resultado.detalhes.push('A fila ja esta sendo processada neste momento.');
      return resultado;
    }

    this.processando = true;

    try {
      const pendentes = await emprestimoRepository.listarComTermoPendente(env.D4SIGN_MAX_TENTATIVAS);
      resultado.pendentes = pendentes.length;

      // Cota que os termos adiados da frente ja vao consumir: a previsao de
      // cada termo conta com os que estao antes dele na fila.
      let cotaDaFrente = 0;

      for (const emprestimo of pendentes) {
        // Pausaram a integracao enquanto a fila rodava: para aqui.
        if (d4signService.pausado) break;

        // Confere a cota do termo INTEIRO antes de comecar, para nunca parar
        // no meio por falta de cota propria.
        const precisa = chamadasRestantes(emprestimo.d4signEtapa);
        if (cotaDaFrente > 0 || d4signService.limitador.disponivel() < precisa) {
          cotaDaFrente += precisa;
          const espera = d4signService.limitador.esperaParaAcumulado(cotaDaFrente);
          await this.adiar(emprestimo, espera, 'Aguardando cota de requisicoes do D4Sign.');
          resultado.adiados += 1;
          continue;
        }

        try {
          if (await this.gerar(emprestimo)) {
            resultado.gerados += 1;
          } else {
            resultado.detalhes.push(`Emprestimo ${emprestimo.id}: nao aguarda mais o termo; geracao interrompida.`);
          }
        } catch (erro) {
          if (erro instanceof D4SignPausadoError) {
            // Nao e falha do termo: ele retoma da etapa em que parou.
            resultado.detalhes.push('A integracao foi pausada no meio da fila; o restante continua na fila.');
            break;
          }

          if (erro instanceof LimiteDeRequisicoesError) {
            await this.adiar(emprestimo, erro.esperaMs, 'Limite de requisicoes do D4Sign atingido.');
            resultado.adiados += 1;
            continue;
          }

          if (erro instanceof FalhaAmbiguaError) {
            await this.pedirConferencia(emprestimo, erro.message);
            resultado.falharam += 1;
            resultado.detalhes.push(`Emprestimo ${emprestimo.id}: ${erro.message}`);
            continue;
          }

          const motivo = erro instanceof Error ? erro.message : String(erro);
          await this.registrarFalha(emprestimo, motivo);
          resultado.falharam += 1;
          resultado.detalhes.push(`Emprestimo ${emprestimo.id}: ${motivo}`);
        }
      }

      resultado.cotaRestante = d4signService.limitador.disponivel();

      if (resultado.adiados > 0) {
        const espera = d4signService.limitador.esperaAteLiberar(CHAMADAS_POR_TERMO);
        resultado.proximaJanelaEmMinutos = Math.ceil(espera / 60_000);
      }

      return resultado;
    } finally {
      this.processando = false;
    }
  }

  /**
   * Os campos do termo de comodato, a partir do emprestimo.
   *
   * O modelo e o "MINUTA - Comodato Emprestimo PF Padrao" (docs/modelos).
   * Qualquer campo obrigatorio vazio impede a geracao do contrato - ver
   * ContratoService.preencher.
   */
  montarCamposDoTermo(emprestimo: EmprestimoCompleto): Record<string, string> {
    const empresa = emprestimo.empresa;
    if (!empresa) throw new Error('Emprestimo sem empresa comodante definida.');

    const nb = emprestimo.item;
    const acessorios = emprestimo.acessorios?.trim();

    return {
      nome_da_empresa: empresa.razaoSocial,
      cnpj_da_empresa: empresa.cnpj,
      endereco_da_empresa: empresaService.enderecoParaContrato(empresa),
      cep_da_empresa: empresa.cep,
      uf_da_empresa: empresa.uf,
      // Foro do contrato: a comarca da cidade da sede da empresa comodante.
      cidade_da_empresa: empresa.cidade,

      nome_do_usuario: emprestimo.colaborador.nome,
      cpf_do_usuario: emprestimo.colaborador.cpf ? formatarCpf(emprestimo.colaborador.cpf) : '',
      endereco_do_usuario: emprestimo.colaborador.endereco ?? '',
      // O contrato da entrega nao tem motivo; so o do emprestimo.
      ...(emprestimo.modalidade !== 'DEFINITIVA'
        ? { motivo_do_emprestimo: emprestimo.motivo ?? '' }
        : {}),

      // A coluna "Marca" e estreita: nela vai so a marca. O modelo fica na
      // coluna "Item", que e larga. Com "Dell Latitude 5420" em Marca, a celula
      // quebrava em tres linhas e empurrava o contrato para uma segunda pagina.
      item1: descricaoDoItem({ categoria: nb.categoria, modelo: nb.modelo }),
      marca1: nb.marca?.trim() || '-',
      // Sem patrimonio o contrato sairia com lacuna: o ContratoService recusa
      // gerar nesse caso e a mensagem diz qual campo falta.
      patrimonio1: nb.patrimonio ?? '',
      valor1: nb.valor ? formatarMoeda(nb.valor) : '',

      // A segunda linha da tabela leva os acessorios, quando ha - tambem na
      // coluna larga.
      item2: acessorios ?? '',
      marca2: acessorios ? '-' : '',
      patrimonio2: acessorios ? '-' : '',
      valor2: acessorios ? '-' : '',

      // So o modelo do emprestimo tem prazo; o da entrega nao usa este campo.
      ...(emprestimo.dataPrevista ? { data_de_devolucao: formatarData(emprestimo.dataPrevista) } : {}),
      cidade_estado_data: `${empresa.cidade}/${empresa.uf}, ${dataPorExtenso(emprestimo.dataInicio)}`,
      nome_testemunha: emprestimo.testemunhaNome ?? '',
    };
  }

  /** Campos que podem ficar em branco no contrato (a linha dos acessorios). */
  static readonly CAMPOS_OPCIONAIS = ['item2', 'marca2', 'patrimonio2', 'valor2'];

  /**
   * Quem assina: so o colaborador.
   *
   * Ate 13/10/2026 o analista que registrou tambem assinava, como testemunha,
   * e tinha de entrar no D4Sign para cada termo. A testemunha e dispensavel:
   * desde a Lei 14.620/2023 (art. 784, par. 4o do CPC), documento com
   * assinatura eletronica cuja integridade e conferida pelo provedor (o D4Sign)
   * dispensa testemunhas para valer como titulo executivo. O nome do analista
   * continua no contrato, como "Registrado no Notrole por".
   */
  private signatarios(emprestimo: EmprestimoCompleto): Signatario[] {
    return [{ email: emprestimo.colaborador.email, papel: 'ASSINAR' }];
  }

  /**
   * Conclui o termo a partir da etapa em que ele parou. Cada etapa e gravada
   * assim que termina: se o processo cair logo depois, a proxima execucao
   * continua dali, sem repetir o que ja foi feito (e cobrado).
   */
  private async gerar(emprestimoDaFila: EmprestimoCompleto): Promise<boolean> {
    // A fila foi lida antes; o operador pode ter cancelado, devolvido ou
    // ativado o emprestimo nesse meio tempo, ou outro processo pode ter criado
    // o documento. Trabalha sempre sobre o registro atual.
    const emprestimo = await emprestimoRepository.buscarPorId(emprestimoDaFila.id);
    if (!emprestimo) return false;

    let uuid = emprestimo.d4signDocumentId;
    let etapa = (emprestimo.d4signEtapa as Etapa | null) ?? (uuid ? 'CRIADO' : null);

    if (!etapa) {
      // O contrato e montado e conferido ANTES de qualquer chamada ao D4Sign.
      // Se faltar algum dado, falha aqui, sem ter criado nada la.
      const contrato = emprestimo.modalidade === 'DEFINITIVA' ? contratoDaEntrega : contratoDoEmprestimo;
      const { arquivo } = await contrato.preencher(
        this.montarCamposDoTermo(emprestimo),
        TermoService.CAMPOS_OPCIONAIS,
      );

      if (!(await this.aindaAguardandoAssinatura(emprestimo.id, uuid))) return false;

      uuid = await d4signService.criarDocumento({
        nome: `Termo de Comodato - ${nomeDoItem(emprestimo.item)} - ${emprestimo.colaborador.nome}.docx`,
        arquivo,
        pastaId: emprestimo.empresa?.d4signPastaId,
      });

      etapa = 'CRIADO';
      // O uuid e gravado ANTES de qualquer outra coisa: sem ele, a proxima
      // tentativa criaria (e pagaria) um segundo documento. Se a gravacao
      // falhar, o termo vai para conferencia manual em vez de ser repetido.
      try {
        await emprestimoRepository.atualizar(emprestimo.id, {
          d4signDocumentId: uuid,
          d4signEtapa: etapa,
          d4signStatus: 'DOCUMENTO CRIADO',
        });
      } catch (erro) {
        console.error(
          `[termo] Emprestimo ${emprestimo.id}: documento ${uuid} CRIADO no D4Sign mas nao gravado no banco.`,
          erro,
        );
        throw new FalhaAmbiguaError(
          `O documento ${uuid} foi criado no D4Sign, mas nao foi possivel grava-lo no Notrole.`,
        );
      }

      await historicoRepository.registrar(
        emprestimo.id,
        'TERMO_GERADO',
        `Termo de comodato gerado em nome de ${emprestimo.empresa?.apelido} e enviado ao D4Sign (${uuid}).`,
        'SISTEMA',
      );
    }

    if (!uuid) throw new Error('Etapa gravada sem o identificador do documento.');

    if (etapa === 'CRIADO') {
      if (!(await this.aindaAguardandoAssinatura(emprestimo.id, uuid))) return false;
      await d4signService.adicionarSignatarios(uuid, this.signatarios(emprestimo));
      etapa = 'SIGNATARIO';
      await emprestimoRepository.atualizar(emprestimo.id, {
        d4signEtapa: etapa,
        d4signStatus: 'SIGNATARIOS CADASTRADOS',
      });
    }

    if (etapa === 'SIGNATARIO') {
      if (!(await this.aindaAguardandoAssinatura(emprestimo.id, uuid))) return false;
      await d4signService.enviarParaAssinatura(uuid, mensagemDoConvite(emprestimo));
      etapa = 'ENVIADO';
      await emprestimoRepository.atualizar(emprestimo.id, {
        d4signEtapa: etapa,
        d4signStatus: 'ENVIADO PARA ASSINATURA',
        d4signProximaTentativa: null,
        // Confere daqui a pouco se o convite realmente saiu (ver conferirEmail).
        d4signAvisoEmail: null,
        d4signEmailConferido: false,
        d4signConferirEmailEm: minutosAFrente(MINUTOS_PARA_CONFERIR_EMAIL),
      });

      const quem = this.signatarios(emprestimo)
        .map((s) => (s.papel === 'TESTEMUNHA' ? `${s.email} (testemunha)` : s.email))
        .join(' e ');

      await historicoRepository.registrar(
        emprestimo.id,
        'TERMO_GERADO',
        `Termo enviado para assinatura de ${quem}.`,
        'SISTEMA',
      );

      console.log(`[termo] Emprestimo ${emprestimo.id}: termo enviado (${uuid}).`);

      // O convite do D4Sign so diz "assine este documento". Este e-mail do
      // Notrole chega junto e explica do que se trata e como assinar.
      void enviarTermoParaAssinar(emprestimo);
    }
    return true;
  }

  /**
   * Confere, antes de cada chamada ao D4Sign, se o emprestimo ainda espera o
   * termo. Se foi cancelado, devolvido ou ativado no meio da geracao, para
   * aqui e cancela no D4Sign o documento que ja tiver sido criado - senao o
   * colaborador receberia para assinar o termo de um emprestimo que nao
   * espera mais assinatura.
   */
  private async aindaAguardandoAssinatura(emprestimoId: number, uuid: string | null): Promise<boolean> {
    const atual = await emprestimoRepository.buscarSituacaoDoTermo(emprestimoId);
    if (atual?.status === 'AGUARDANDO_ASSINATURA') return true;

    const documento = uuid ?? atual?.d4signDocumentId ?? null;
    const cancelamento = documento ? await d4signService.cancelar(documento) : null;

    if (atual) {
      await emprestimoRepository.atualizar(emprestimoId, { d4signProximaTentativa: null });
      await historicoRepository.registrar(
        emprestimoId,
        'TERMO_GERADO',
        `Geracao do termo interrompida: o emprestimo passou para ${atual.status}.` +
          (!documento || !cancelamento
            ? ''
            : cancelamento.cancelado
              ? ` O documento ${documento} foi cancelado no D4Sign.`
              : ` O documento ${documento} NAO foi cancelado no D4Sign (${cancelamento.motivo}); ` +
                'cancele direto no painel do D4Sign.'),
        'SISTEMA',
      );
    }
    console.warn(`[termo] Emprestimo ${emprestimoId}: geracao interrompida (status ${atual?.status ?? '-'}).`);
    return false;
  }

  /** Sem cota: reprograma SEM contar tentativa - fila andando nao e erro. */
  private async adiar(emprestimo: EmprestimoCompleto, esperaMs: number, motivo: string) {
    const quando = new Date(Date.now() + Math.max(esperaMs, 60_000) + 60_000);
    await emprestimoRepository.atualizar(emprestimo.id, {
      d4signProximaTentativa: quando,
      d4signStatus: `NA FILA: ${motivo}`.slice(0, 200),
    });
  }

  private async registrarFalha(emprestimo: EmprestimoCompleto, motivo: string) {
    const tentativas = emprestimo.d4signTentativas + 1;
    const desistiu = tentativas >= env.D4SIGN_MAX_TENTATIVAS;

    // Espera crescente: 15, 30, 60 minutos...
    const esperaMs = Math.min(15 * 60_000 * 2 ** (tentativas - 1), 4 * 60 * 60_000);

    await emprestimoRepository.atualizar(emprestimo.id, {
      d4signTentativas: tentativas,
      d4signProximaTentativa: desistiu ? null : new Date(Date.now() + esperaMs),
      d4signStatus: (desistiu
        ? `FALHOU: ${motivo}`
        : `ERRO (tentativa ${tentativas}/${env.D4SIGN_MAX_TENTATIVAS}): ${motivo}`
      ).slice(0, 200),
    });

    if (desistiu) {
      await historicoRepository.registrar(
        emprestimo.id,
        'TERMO_GERADO',
        `O sistema parou de tentar gerar o termo apos ${tentativas} tentativas: ${motivo}. ` +
          'Use "Tentar gerar o termo novamente" ou ative o emprestimo manualmente.',
        'SISTEMA',
      );
    }
  }

  /**
   * Falha ambigua na criacao: tira da fila e pede que alguem confira o painel
   * do D4Sign. Repetir no escuro poderia criar um segundo documento cobrado.
   */
  private async pedirConferencia(emprestimo: EmprestimoCompleto, motivo: string) {
    await emprestimoRepository.atualizar(emprestimo.id, {
      d4signTentativas: env.D4SIGN_MAX_TENTATIVAS,
      d4signProximaTentativa: null,
      d4signStatus: `VERIFICAR NO D4SIGN: ${motivo}`.slice(0, 200),
    });

    await historicoRepository.registrar(
      emprestimo.id,
      'TERMO_GERADO',
      `Nao foi possivel confirmar se o documento foi criado no D4Sign: ${motivo} ` +
        'O sistema NAO vai tentar de novo sozinho, para nao gerar um documento em duplicidade. ' +
        'Confira no painel do D4Sign antes de pedir uma nova tentativa.',
      'SISTEMA',
    );
  }

  /**
   * O operador pede para tentar gerar o termo de novo, depois de conferir o
   * painel do D4Sign. Retoma da etapa em que parou.
   */
  async tentarNovamente(emprestimoId: number, operador?: string) {
    const emprestimo = await emprestimoRepository.buscarPorId(emprestimoId);
    if (!emprestimo) throw AppError.naoEncontrado('Emprestimo');

    if (emprestimo.status !== 'AGUARDANDO_ASSINATURA' || emprestimo.d4signEtapa === 'ENVIADO') {
      throw new AppError('Este emprestimo nao tem termo pendente de geracao.', 409);
    }

    await emprestimoRepository.atualizar(emprestimoId, {
      d4signTentativas: 0,
      d4signProximaTentativa: null,
      d4signStatus: 'NA FILA: nova tentativa solicitada pelo operador',
    });

    await historicoRepository.registrar(
      emprestimoId,
      'TERMO_GERADO',
      'Nova tentativa de gerar o termo solicitada pelo operador.',
      operador,
    );

    this.agendar();
  }

  // -------------------------------------------------------------------------
  // Acompanhamento da assinatura
  // -------------------------------------------------------------------------

  /**
   * Aplica uma mudanca de status do termo ao emprestimo. Ponto unico por onde
   * passam a consulta automatica, a consulta manual e o webhook.
   */
  async aplicarStatus(
    emprestimo: EmprestimoCompleto,
    situacao: { status: string; assinado: boolean; cancelado: boolean },
    origem: string,
  ): Promise<void> {
    const agora = new Date();

    if (situacao.assinado) {
      if (emprestimo.d4signAssinadoEm) return;

      const ativou = await prisma.$transaction(async (tx) => {
        // Webhook, consulta automatica e botao podem chegar juntos: so o
        // primeiro registra a assinatura (where d4signAssinadoEm null).
        const marcou = await tx.emprestimo.updateMany({
          where: { id: emprestimo.id, d4signAssinadoEm: null },
          data: {
            d4signStatus: situacao.status,
            d4signAssinadoEm: agora,
            d4signVerificadoEm: agora,
            d4signAvisoEmail: null,
            // Finalizado significa que todos assinaram.
            ...(emprestimo.d4signSignatarios
              ? { d4signAssinados: emprestimo.d4signSignatarios }
              : {}),
          },
        });
        if (marcou.count === 0) return false;

        // So ativa quem AINDA aguarda assinatura no banco. Se o operador
        // cancelou ou devolveu no meio do caminho, a assinatura fica
        // registrada mas o status nao volta para ATIVO. E rotina, nao erro.
        const ativacao = await tx.emprestimo.updateMany({
          where: { id: emprestimo.id, status: 'AGUARDANDO_ASSINATURA' },
          data: { status: 'ATIVO' },
        });

        await historicoRepository.registrar(
          emprestimo.id,
          'TERMO_ASSINADO',
          `Termo de responsabilidade assinado por ${emprestimo.colaborador.nome}.`,
          origem,
          tx,
        );

        if (ativacao.count > 0) {
          await historicoRepository.registrar(
            emprestimo.id,
            'ATIVADO',
            'Emprestimo ativado automaticamente apos a assinatura do termo.',
            'SISTEMA',
            tx,
          );
        }
        return ativacao.count > 0;
      });

      // So agora o emprestimo esta de fato confirmado: o colaborador recebe a
      // confirmacao (antes ela saia na criacao, antes da assinatura).
      if (ativou) {
        const atual = await emprestimoRepository.buscarPorId(emprestimo.id);
        if (atual) {
          void enviarConfirmacao(
            atual,
            `Termo de Comodato assinado eletronicamente em ${formatarData(agora)}.`,
          );
        }
      }
      return;
    }

    if (situacao.cancelado) {
      if (emprestimo.d4signStatus?.startsWith('CANCELADO NO D4SIGN')) return;

      await emprestimoRepository.atualizar(emprestimo.id, {
        d4signStatus: 'CANCELADO NO D4SIGN',
        d4signVerificadoEm: agora,
      });

      await historicoRepository.registrar(
        emprestimo.id,
        'CANCELADO',
        'O termo foi cancelado diretamente no D4Sign. O emprestimo continua aberto ' +
          'aguardando decisao do operador: ativar manualmente ou cancelar.',
        origem,
      );
      return;
    }

    await emprestimoRepository.atualizar(emprestimo.id, {
      d4signStatus: situacao.status,
      d4signVerificadoEm: agora,
    });
  }

  /**
   * Consulta automatica: pergunta ao D4Sign se os termos enviados ja foram
   * assinados. O Notrole so e acessivel na rede interna, entao o webhook do
   * D4Sign nao chega ate ele.
   *
   * Economica de proposito: so em horario comercial, cada documento no maximo a
   * cada D4SIGN_HORAS_ENTRE_CONSULTAS, e so ate D4SIGN_DIAS_MAX_CONSULTA dias.
   * Um termo que leva tres dias para ser assinado custa por volta de oito
   * consultas. Com D4SIGN_CONSULTA_AUTOMATICA=false, zero.
   */
  async verificarAssinaturas(): Promise<{
    verificados: number;
    assinados: number;
    emailsConferidos: number;
    emailsComProblema: number;
  }> {
    const resultado = { verificados: 0, assinados: 0, emailsConferidos: 0, emailsComProblema: 0 };

    if (!d4signService.habilitado || !env.D4SIGN_CONSULTA_AUTOMATICA) return resultado;
    if (!emHorarioComercial()) return resultado;

    const agora = Date.now();
    const verificadoAntesDe = new Date(agora - env.D4SIGN_HORAS_ENTRE_CONSULTAS * 60 * 60_000);
    const criadoDepoisDe = new Date(agora - env.D4SIGN_DIAS_MAX_CONSULTA * 24 * 60 * 60_000);

    const [aguardando, emailsAConferir] = await Promise.all([
      emprestimoRepository.listarAguardandoAssinatura(verificadoAntesDe, criadoDepoisDe),
      emprestimoRepository.listarEmailsAConferir(new Date(agora), criadoDepoisDe),
    ]);
    if (aguardando.length === 0 && emailsAConferir.length === 0) return resultado;

    // Gerar termo tem prioridade: se houver algum na fila, guarda cota para ele.
    const termosNaFila = await emprestimoRepository.contarTermosPendentes(env.D4SIGN_MAX_TENTATIVAS);
    const reserva = termosNaFila > 0 ? CHAMADAS_POR_TERMO : 0;

    // Primeiro o e-mail: um convite que nao chegou trava a assinatura, e
    // quanto antes alguem souber, melhor. E uma conferencia por termo.
    for (const emprestimo of emailsAConferir) {
      if (d4signService.limitador.disponivel() - reserva < 1) break;

      try {
        const { aviso } = await this.conferirSignatarios(emprestimo, 'CONSULTA AUTOMATICA');
        resultado.emailsConferidos += 1;
        if (aviso) resultado.emailsComProblema += 1;
      } catch (erro) {
        if (erro instanceof LimiteDeRequisicoesError) break;
        await emprestimoRepository.atualizar(emprestimo.id, { d4signConferirEmailEm: minutosAFrente(60) });
        console.warn(`[termo] Emprestimo ${emprestimo.id}: ${(erro as Error).message}`);
      }
    }

    for (const emprestimo of aguardando) {
      if (d4signService.limitador.disponivel() - reserva < 1) break;

      try {
        const situacao = await d4signService.consultarStatus(emprestimo.d4signDocumentId!);
        await this.aplicarStatus(emprestimo, situacao, 'CONSULTA AUTOMATICA');
        resultado.verificados += 1;
        if (situacao.assinado) resultado.assinados += 1;
      } catch (erro) {
        if (erro instanceof LimiteDeRequisicoesError) break;
        // Marca como consultado mesmo assim, para nao insistir no mesmo
        // documento no proximo ciclo.
        await emprestimoRepository.atualizar(emprestimo.id, { d4signVerificadoEm: new Date() });
        console.warn(`[termo] Emprestimo ${emprestimo.id}: ${(erro as Error).message}`);
      }
    }

    return resultado;
  }

  /** Botao "Verificar assinatura": uma consulta, na hora. */
  async verificarAgora(emprestimoId: number) {
    if (d4signService.pausado) throw new D4SignPausadoError();
    const emprestimo = await emprestimoRepository.buscarPorId(emprestimoId);
    if (!emprestimo) throw AppError.naoEncontrado('Emprestimo');

    // Encerrado ou ja ativo: nao ha assinatura a esperar, e cada consulta gasta cota.
    if (emprestimo.status !== 'AGUARDANDO_ASSINATURA') {
      throw new AppError(
        'Este emprestimo nao esta aguardando assinatura, entao nao ha o que verificar no D4Sign.',
        409,
      );
    }

    if (emprestimo.d4signEtapa !== 'ENVIADO' || !emprestimo.d4signDocumentId) {
      throw new AppError(
        'O termo deste emprestimo ainda nao foi enviado ao colaborador, entao nao ha o que verificar.',
        409,
      );
    }

    let situacao: Awaited<ReturnType<typeof d4signService.consultarStatus>>;
    try {
      situacao = await d4signService.consultarStatus(emprestimo.d4signDocumentId);
      await this.aplicarStatus(emprestimo, situacao, 'CONSULTA MANUAL');
    } catch (erro) {
      if (erro instanceof LimiteDeRequisicoesError) throw erroSemCota(erro.esperaMs);
      throw erro;
    }

    // Aproveita para ver quem ja assinou e se o convite de cada um saiu. Custa
    // mais 1 requisicao, mas so acontece quando alguem clica no botao - e e
    // justamente o que a pessoa quer saber. Sem cota, fica para a rotina.
    let avisoEmail = emprestimo.d4signAvisoEmail;
    let assinaturas: ProgressoAssinatura | null =
      emprestimo.d4signSignatarios !== null && emprestimo.d4signAssinados !== null
        ? { assinados: emprestimo.d4signAssinados, total: emprestimo.d4signSignatarios, faltam: [] }
        : null;

    if (!situacao.assinado && !situacao.cancelado && d4signService.limitador.disponivel() >= 1) {
      try {
        const conferido = await this.conferirSignatarios(emprestimo, 'CONSULTA MANUAL');
        avisoEmail = conferido.aviso;
        assinaturas = conferido.progresso;
      } catch (erro) {
        console.warn(`[termo] Emprestimo ${emprestimo.id}: ${(erro as Error).message}`);
      }
    }

    return {
      status: situacao.status,
      assinado: situacao.assinado,
      cancelado: situacao.cancelado,
      avisoEmail: situacao.assinado ? null : avisoEmail,
      assinaturas: situacao.assinado ? null : assinaturas,
    };
  }

  /**
   * Pergunta ao D4Sign quem ja assinou e se o e-mail de convite chegou a sair
   * para quem falta. Grava o progresso e o problema (ou limpa). 1 requisicao.
   */
  private async conferirSignatarios(
    emprestimo: EmprestimoCompleto,
    origem: string,
  ): Promise<{ aviso: string | null; progresso: ProgressoAssinatura }> {
    const signatarios = await d4signService.listarSignatarios(emprestimo.d4signDocumentId!);
    const pendentes = signatarios.filter((s) => !s.assinou);
    const comProblema = pendentes.filter((s) => s.emailComProblema);
    const semResultado = pendentes.filter((s) => !s.statusEmail);

    const progresso: ProgressoAssinatura = {
      assinados: signatarios.length - pendentes.length,
      total: signatarios.length,
      faltam: pendentes.map((s) => s.email),
    };

    const aviso = comProblema.length
      ? comProblema
          .map((s) => `${s.email}: ${descreverProblemaDeEmail(s)}`)
          .join(' | ')
          .slice(0, 500)
      : null;

    // Com problema, perguntar de novo nao adianta - so muda com um reenvio.
    // Sem resultado ainda (o D4Sign nao processou o envio), confere mais tarde.
    const conferirDeNovo = !aviso && semResultado.length > 0;

    await emprestimoRepository.atualizar(emprestimo.id, {
      d4signAvisoEmail: aviso,
      d4signEmailConferido: !conferirDeNovo,
      d4signConferirEmailEm: conferirDeNovo ? minutosAFrente(60) : null,
      d4signAssinados: progresso.assinados,
      d4signSignatarios: progresso.total,
    });

    if (progresso.assinados !== emprestimo.d4signAssinados && progresso.assinados > 0) {
      await historicoRepository.registrar(
        emprestimo.id,
        'TERMO_GERADO',
        `${progresso.assinados} de ${progresso.total} assinaram o termo. ` +
          (progresso.faltam.length ? `Falta: ${progresso.faltam.join(', ')}.` : ''),
        origem,
      );
    }

    if (aviso && aviso !== emprestimo.d4signAvisoEmail) {
      console.warn(`[termo] Emprestimo ${emprestimo.id}: convite nao entregue - ${aviso}`);
      await historicoRepository.registrar(
        emprestimo.id,
        'TERMO_GERADO',
        `O e-mail de assinatura do D4Sign NAO foi entregue: ${aviso}. ` +
          'O colaborador pode assinar pelo painel do D4Sign, ou use "Reenviar convite" ' +
          'depois que o endereco for liberado pelo suporte do D4Sign.',
        origem,
      );
    }

    return { aviso, progresso };
  }

  /**
   * Botao "Reenviar convite": pede ao D4Sign que mande de novo o e-mail de
   * assinatura. Nao cria documento nem gasta envio do pacote. Se algum
   * signatario teve problema no e-mail, reenvia so para ele; senao, para todos
   * os que ainda nao assinaram.
   */
  async reenviarConvite(emprestimoId: number, operador?: string) {
    if (d4signService.pausado) throw new D4SignPausadoError();
    const emprestimo = await emprestimoRepository.buscarPorId(emprestimoId);
    if (!emprestimo) throw AppError.naoEncontrado('Emprestimo');

    const uuid = emprestimo.d4signDocumentId;
    if (emprestimo.status !== 'AGUARDANDO_ASSINATURA' || emprestimo.d4signEtapa !== 'ENVIADO' || !uuid) {
      throw new AppError('Este emprestimo nao tem termo aguardando assinatura.', 409);
    }

    // 1 consulta + pelo menos 1 reenvio.
    if (d4signService.limitador.disponivel() < 2) {
      throw erroSemCota(d4signService.limitador.esperaAteLiberar(2));
    }

    const enviados: string[] = [];
    try {
      const pendentes = (await d4signService.listarSignatarios(uuid)).filter((s) => !s.assinou && s.chave);
      if (pendentes.length === 0) {
        throw new AppError('Todos os signatarios ja assinaram. Use "Verificar assinatura".', 409);
      }
      const alvo = pendentes.some((s) => s.emailComProblema)
        ? pendentes.filter((s) => s.emailComProblema)
        : pendentes;

      for (const signatario of alvo) {
        await d4signService.reenviarConvite(uuid, signatario);
        enviados.push(signatario.email);
      }
    } catch (erro) {
      if (erro instanceof AppError) throw erro;
      if (erro instanceof LimiteDeRequisicoesError && enviados.length === 0) {
        throw erroSemCota(erro.esperaMs);
      }
      if (enviados.length === 0) {
        throw new AppError(
          `O D4Sign recusou o reenvio: ${(erro as Error).message}. ` +
            'Ele so aceita reenviar 1 minuto apos o envio, depois com 5, 30 e 60 minutos entre um reenvio e outro.',
          502,
        );
      }
      console.warn(`[termo] Emprestimo ${emprestimoId}: reenvio parcial - ${(erro as Error).message}`);
    }

    await emprestimoRepository.atualizar(emprestimoId, {
      d4signAvisoEmail: null,
      d4signEmailConferido: false,
      d4signConferirEmailEm: minutosAFrente(MINUTOS_PARA_CONFERIR_EMAIL),
    });

    await historicoRepository.registrar(
      emprestimoId,
      'TERMO_GERADO',
      `Convite de assinatura reenviado pelo D4Sign para ${enviados.join(' e ')}.`,
      operador,
    );

    return { reenviadoPara: enviados };
  }

  // -------------------------------------------------------------------------
  // Painel
  // -------------------------------------------------------------------------

  /**
   * Com empresa, as contagens de termos sao so dela. A cota e o total do mes
   * sao da conta do D4Sign, que e uma so para o grupo.
   */
  async situacao(empresaId?: number) {
    const inicioDoMes = new Date();
    inicioDoMes.setDate(1);
    inicioDoMes.setHours(0, 0, 0, 0);

    const [pendentes, precisamAtencao, documentosNoMes, emailsComProblema] = await Promise.all([
      emprestimoRepository.contarTermosPendentes(env.D4SIGN_MAX_TENTATIVAS, empresaId),
      emprestimoRepository.contarTermosPrecisandoAtencao(env.D4SIGN_MAX_TENTATIVAS, empresaId),
      emprestimoRepository.contarDocumentosCriadosDesde(inicioDoMes),
      emprestimoRepository.contarAvisosDeEmail(empresaId),
    ]);

    const cota = d4signService.limitador.disponivel();

    return {
      habilitado: d4signService.habilitado,
      configurado: d4signService.configurado,
      pausado: d4signService.pausado,
      ambiente: env.D4SIGN_AMBIENTE,
      pendentes,
      precisamAtencao,
      emailsComProblema,
      documentosNoMes,
      cotaRestante: cota,
      limitePorHora: env.D4SIGN_REQUISICOES_POR_HORA,
      chamadasPorTermo: CHAMADAS_POR_TERMO,
      termosQueCabemAgora: Math.floor(cota / CHAMADAS_POR_TERMO),
      proximaJanelaEmMinutos:
        cota >= CHAMADAS_POR_TERMO
          ? 0
          : Math.ceil(d4signService.limitador.esperaAteLiberar(CHAMADAS_POR_TERMO) / 60_000),
      consultaAutomatica: env.D4SIGN_CONSULTA_AUTOMATICA,
      horasEntreConsultas: env.D4SIGN_HORAS_ENTRE_CONSULTAS,
      diasMaxConsulta: env.D4SIGN_DIAS_MAX_CONSULTA,
    };
  }
}

export const termoService = new TermoService();
