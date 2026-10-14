import cron, { type ScheduledTask } from 'node-cron';
import { env } from '../config/env';

/**
 * Registro das tarefas periodicas.
 *
 * Fica separado das rotinas em si porque duas coisas diferentes precisam do
 * mesmo cuidado: validar a expressao antes de agendar, fixar o fuso horario e
 * impedir que uma execucao demorada se sobreponha a proxima.
 *
 * O agendamento anterior nao fazia nada disso, e o log do PM2 registrou
 * "missed execution" todos os dias sem que ninguem percebesse.
 */

const tarefas: ScheduledTask[] = [];

/** Ultima execucao automatica de cada tarefa, para a tela de Configuracoes. */
export interface ExecucaoDeTarefa {
  em: Date;
  resumo: string | null;
  erro: string | null;
}

const execucoes = new Map<string, ExecucaoDeTarefa>();

export function ultimaExecucao(nome: string): ExecucaoDeTarefa | null {
  return execucoes.get(nome) ?? null;
}

export function registrarTarefa(
  nome: string,
  expressao: string,
  rotina: () => Promise<string | void>,
): void {
  if (!cron.validate(expressao)) {
    console.error(`[cron] Expressao invalida para ${nome}: "${expressao}". Tarefa nao registrada.`);
    return;
  }

  const tarefa = cron.schedule(
    expressao,
    async () => {
      const em = new Date();
      try {
        const resumo = await rotina();
        execucoes.set(nome, { em, resumo: resumo || null, erro: null });
      } catch (erro) {
        console.error(`[cron] Falha ao executar ${nome}:`, erro);
        execucoes.set(nome, { em, resumo: null, erro: erro instanceof Error ? erro.message : String(erro) });
      }
    },
    {
      // Sem fuso explicito o agendamento segue o relogio do servidor. Deixar
      // isso implicito e uma armadilha se a maquina mudar de regiao.
      timezone: env.CRON_TIMEZONE,
      noOverlap: true,
      name: nome,
    },
  );

  tarefas.push(tarefa);
  console.log(`[cron] ${nome} agendado: "${expressao}" (${env.CRON_TIMEZONE}).`);
}

export async function pararTarefas(): Promise<void> {
  await Promise.all(tarefas.map((t) => t.destroy()));
  tarefas.length = 0;
}
