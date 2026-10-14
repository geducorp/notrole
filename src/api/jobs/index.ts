import { env } from '../config/env';
import { registrarTarefa, pararTarefas } from './agendador';
import { executarCobrancaAgora, executarLembretesAgora } from './NotificacaoJob';
import { termoService } from '../services/TermoService';
import { d4signService } from '../services/D4SignService';

/**
 * Ponto unico onde as rotinas periodicas sao ligadas.
 *
 * Sao tres:
 *
 * - cobranca-atraso e lembrete-vencimento rodam de hora em hora em horario
 *   comercial. Sao idempotentes (um e-mail por emprestimo por dia), entao
 *   repetir e inofensivo e um disparo perdido se recupera no proximo.
 *
 * - fila-termos roda de 5 em 5 minutos, todos os dias. Existe porque a conta do
 *   D4Sign tem teto de requisicoes por hora: quando a TI empresta varias
 *   maquinas de uma vez, parte dos termos fica na fila esperando cota. Se so
 *   rodasse em horario comercial, um termo que caiu na fila as 18h ficaria
 *   parado ate a manha seguinte sem necessidade.
 */
export function iniciarRotinas(): void {
  if (!env.JOBS_HABILITADOS) {
    console.log('[cron] Rotinas automaticas desligadas por configuracao (JOBS_HABILITADOS=false).');
    return;
  }

  registrarTarefa(TAREFA_COBRANCA, env.CRON_COBRANCA, async () => {
    const r = await executarCobrancaAgora();
    if (r.verificados > 0) {
      console.log(
        `[cron] cobranca-atraso: ${r.verificados} em atraso, ${r.enviados} cobrado(s), ` +
          `${r.ignorados} ja cobrado(s) hoje, ${r.falhas} falha(s).`,
      );
      for (const detalhe of r.detalhes) console.warn(`[cron] cobranca-atraso: ${detalhe}`);
    }
    return resumoDaRotina(r, 'em atraso');
  });

  registrarTarefa(TAREFA_LEMBRETE, env.CRON_LEMBRETE, async () => {
    const r = await executarLembretesAgora();
    if (r.verificados > 0) {
      console.log(
        `[cron] lembrete-vencimento: ${r.verificados} vencendo ate o proximo dia util, ` +
          `${r.enviados} avisado(s), ${r.ignorados} ja avisado(s), ${r.falhas} falha(s).`,
      );
      for (const detalhe of r.detalhes) console.warn(`[cron] lembrete-vencimento: ${detalhe}`);
    }
    return resumoDaRotina(r, 'vencendo até o próximo dia útil');
  });

  // Registrada sempre que o D4Sign esta configurado: a pausa pela tela e
  // conferida a cada execucao (processarPendentes e verificarAssinaturas nao
  // fazem nada com a integracao pausada).
  if (d4signService.configurado) {
    registrarTarefa('fila-termos', env.CRON_TERMOS, async () => {
      const r = await termoService.processarPendentes();
      if (r.pendentes > 0) {
        console.log(
          `[cron] fila-termos: ${r.pendentes} pendente(s), ${r.gerados} gerado(s), ` +
            `${r.adiados} adiado(s), ${r.falharam} com falha. Cota restante: ${r.cotaRestante}.`,
        );
        for (const detalhe of r.detalhes) console.warn(`[cron] fila-termos: ${detalhe}`);
      }

      // Depois de gerar o que der, usa a cota que sobrou para perguntar ao
      // D4Sign se algum termo ja foi assinado. Vem depois de proposito: gerar
      // termo tem prioridade sobre consultar.
      const v = await termoService.verificarAssinaturas();
      if (v.verificados > 0) {
        console.log(`[cron] fila-termos: ${v.verificados} termo(s) consultado(s), ${v.assinados} assinado(s).`);
      }
      if (v.emailsConferidos > 0) {
        console.log(
          `[cron] fila-termos: ${v.emailsConferidos} convite(s) conferido(s), ` +
            `${v.emailsComProblema} com problema no e-mail.`,
        );
      }
    });
  }
}

/** Nomes das tarefas, para a tela buscar a ultima execucao de cada uma. */
export const TAREFA_LEMBRETE = 'lembrete-vencimento';
export const TAREFA_COBRANCA = 'cobranca-atraso';

function resumoDaRotina(
  r: { verificados: number; enviados: number; ignorados: number; falhas: number },
  situacao: string,
): string {
  if (r.verificados === 0) return `Ninguém ${situacao}.`;
  const partes = [`${r.enviados} e-mail(s) enviado(s)`];
  if (r.ignorados > 0) partes.push(`${r.ignorados} já avisado(s)`);
  if (r.falhas > 0) partes.push(`${r.falhas} falha(s)`);
  return partes.join(', ') + '.';
}

export async function pararRotinas(): Promise<void> {
  await pararTarefas();
}
