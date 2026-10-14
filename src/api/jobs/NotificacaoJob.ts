import { nomeDoItem } from '../utils/itens';
import { emprestimoRepository } from '../repositories/EmprestimoRepository';
import { historicoRepository } from '../repositories/HistoricoRepository';
import { emailService } from '../services/EmailService';
import { diasDeAtraso, estaAtrasado, fimDoDia, formatarData, inicioDoDia, mesmoDia, proximoDiaUtil } from '../utils/datas';

/**
 * Rotinas automaticas de notificacao.
 *
 * Por que isto foi reescrito
 * --------------------------
 * O job antigo era agendado com '0 8 * * *' e sem fuso horario. No log do PM2
 * aparecia, todo dia desde 11/09, a mesma linha:
 *
 *   [NODE-CRON] [WARN] missed execution at ... 08:00:00! Possible blocking IO
 *
 * Ou seja: nenhuma cobranca chegou a ser enviada. Alem disso o job:
 *   - rodava todo dia, inclusive sabado e domingo;
 *   - reenviava a mesma cobranca a cada execucao, sem nenhum controle;
 *   - considerava atrasado um emprestimo que vencia no proprio dia;
 *   - nao registrava nada no historico.
 *
 * A estrategia agora e diferente: em vez de depender de um unico disparo
 * diario dar certo, a verificacao roda de hora em hora dentro do horario
 * comercial. Os campos `ultimaCobrancaEm` e `lembretePrevioEm` garantem, por
 * emprestimo, no maximo uma cobranca por dia e um lembrete por prazo, entao
 * executar varias vezes e inofensivo - e se as 08:00 falhar, as 09:00 cobre.
 *
 * Idempotencia (09/10/2026)
 * -------------------------
 * Antes, o campo era conferido na leitura e gravado DEPOIS do envio: o botao
 * "executar agora" e o cron rodando juntos mandavam o mesmo e-mail duas vezes.
 * Agora cada envio e REIVINDICADO antes, com um update condicional no banco
 * (so um processo consegue count === 1); se o envio falhar, a reivindicacao e
 * desfeita para a proxima hora tentar de novo. Alem disso, um trava em memoria
 * impede que a mesma rotina rode duas vezes ao mesmo tempo neste processo.
 */

export interface ResultadoRotina {
  verificados: number;
  enviados: number;
  ignorados: number;
  falhas: number;
  detalhes: string[];
}

function resultadoVazio(): ResultadoRotina {
  return { verificados: 0, enviados: 0, ignorados: 0, falhas: 0, detalhes: [] };
}

/** Rotinas em execucao neste processo (cron ou botao). */
const emExecucao = new Set<'cobranca' | 'lembrete'>();

async function comTrava(
  rotina: 'cobranca' | 'lembrete',
  executar: () => Promise<ResultadoRotina>,
): Promise<ResultadoRotina> {
  if (emExecucao.has(rotina)) {
    const resultado = resultadoVazio();
    resultado.detalhes.push('A rotina ja esta em execucao neste momento (agendamento ou outro clique).');
    return resultado;
  }
  emExecucao.add(rotina);
  try {
    return await executar();
  } finally {
    emExecucao.delete(rotina);
  }
}

export function executarCobrancaAgora(): Promise<ResultadoRotina> {
  return comTrava('cobranca', cobrar);
}

async function cobrar(): Promise<ResultadoRotina> {
  const agora = new Date();
  const resultado = resultadoVazio();

  const ativos = await emprestimoRepository.listarAtivos();

  for (const emprestimo of ativos) {
    // So emprestimo tem prazo; o repositorio ja filtra, isto e so para o tipo.
    const prazo = emprestimo.dataPrevista;
    if (!prazo || !estaAtrasado(prazo, agora)) continue;

    resultado.verificados += 1;

    // Ja foi cobrado hoje: nao insiste.
    if (mesmoDia(emprestimo.ultimaCobrancaEm, agora)) {
      resultado.ignorados += 1;
      continue;
    }

    const email = emprestimo.colaborador?.email;
    if (!email) {
      resultado.falhas += 1;
      resultado.detalhes.push(
        'Emprestimo ' + emprestimo.id + ': colaborador sem e-mail cadastrado.',
      );
      continue;
    }

    // Reivindica o envio de hoje no banco. Se outro processo chegou antes
    // (ou o emprestimo deixou de estar ativo), nao envia.
    const reivindicado = await emprestimoRepository.reivindicarCobranca(emprestimo.id, agora, inicioDoDia(agora));
    if (!reivindicado) {
      resultado.ignorados += 1;
      continue;
    }

    const atraso = diasDeAtraso(prazo, agora);

    const envio = await emailService.enviarPorTemplate({
      chave: 'COBRANCA_ATRASO',
      destinatario: email,
      emprestimoId: emprestimo.id,
      variaveis: {
        nome: emprestimo.colaborador.nome,
        hostname: nomeDoItem(emprestimo.item),
        modelo: emprestimo.item.modelo,
        data_prevista: formatarData(prazo),
        dias_atraso: String(atraso),
      },
    });

    if (envio.enviado) {
      resultado.enviados += 1;
      await historicoRepository.registrar(
        emprestimo.id,
        'COBRADO',
        'Cobranca automatica enviada para ' + email + ' (' + atraso + ' dia(s) de atraso).',
        'SISTEMA',
      );
    } else {
      // Desfaz a reivindicacao: a proxima execucao tenta de novo.
      await emprestimoRepository.desfazerCobranca(emprestimo.id, agora, emprestimo.ultimaCobrancaEm);
      resultado.falhas += 1;
      resultado.detalhes.push('Emprestimo ' + emprestimo.id + ': ' + (envio.erro ?? 'falha no envio'));
    }
  }

  return resultado;
}

/**
 * Janela do lembrete previo: prazos que vencem "no proximo dia util ou
 * antes". De segunda a quinta e so amanha; na sexta vai de sabado ate
 * segunda - assim quem devolve na segunda (ou tem prazo no fim de semana) e
 * avisado na sexta, ja que a rotina nao roda sabado e domingo. Feriados nao
 * sao considerados.
 */
export function janelaDoLembrete(agora: Date): { inicio: Date; fim: Date } {
  const amanha = new Date(agora);
  amanha.setDate(amanha.getDate() + 1);
  return { inicio: inicioDoDia(amanha), fim: fimDoDia(proximoDiaUtil(agora)) };
}

export function executarLembretesAgora(): Promise<ResultadoRotina> {
  return comTrava('lembrete', lembrar);
}

async function lembrar(): Promise<ResultadoRotina> {
  const agora = new Date();
  const resultado = resultadoVazio();

  const { inicio, fim } = janelaDoLembrete(agora);
  const vencendo = await emprestimoRepository.listarAtivosVencendoEntre(inicio, fim);

  for (const emprestimo of vencendo) {
    const prazo = emprestimo.dataPrevista;
    if (!prazo) continue;
    resultado.verificados += 1;

    // Um lembrete por prazo: a renovacao zera o campo. Com a janela da sexta
    // cobrindo o fim de semana, um "por dia" deixaria um disparo manual no
    // sabado repetir o aviso.
    if (emprestimo.lembretePrevioEm) {
      resultado.ignorados += 1;
      continue;
    }

    const email = emprestimo.colaborador?.email;
    if (!email) {
      resultado.falhas += 1;
      resultado.detalhes.push(
        'Emprestimo ' + emprestimo.id + ': colaborador sem e-mail cadastrado.',
      );
      continue;
    }

    const reivindicado = await emprestimoRepository.reivindicarLembrete(emprestimo.id, agora);
    if (!reivindicado) {
      resultado.ignorados += 1;
      continue;
    }

    const envio = await emailService.enviarPorTemplate({
      chave: 'LEMBRETE_PREVIO',
      destinatario: email,
      emprestimoId: emprestimo.id,
      variaveis: {
        nome: emprestimo.colaborador.nome,
        hostname: nomeDoItem(emprestimo.item),
        modelo: emprestimo.item.modelo,
        data_prevista: formatarData(prazo),
      },
    });

    if (envio.enviado) {
      resultado.enviados += 1;
      await historicoRepository.registrar(
        emprestimo.id,
        'LEMBRETE_ENVIADO',
        'Lembrete de vencimento enviado para ' + email + '.',
        'SISTEMA',
      );
    } else {
      await emprestimoRepository.desfazerLembrete(emprestimo.id, agora);
      resultado.falhas += 1;
      resultado.detalhes.push('Emprestimo ' + emprestimo.id + ': ' + (envio.erro ?? 'falha no envio'));
    }
  }

  return resultado;
}
