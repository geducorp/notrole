import { AppError } from './AppError';

/**
 * Regras de data do dominio, num lugar so.
 *
 * O sistema trabalha em horario de Brasilia. Um emprestimo previsto para o dia
 * X so e considerado atrasado depois do fim daquele dia - antes isso era
 * comparado direto com `new Date()`, o que marcava como atrasado um emprestimo
 * que vencia no proprio dia.
 */

export function fimDoDia(data: Date): Date {
  const d = new Date(data);
  d.setHours(23, 59, 59, 999);
  return d;
}

export function inicioDoDia(data: Date): Date {
  const d = new Date(data);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function estaAtrasado(dataPrevista: Date, referencia: Date = new Date()): boolean {
  return referencia > fimDoDia(dataPrevista);
}

export function diasDeAtraso(dataPrevista: Date, referencia: Date = new Date()): number {
  if (!estaAtrasado(dataPrevista, referencia)) return 0;
  const msPorDia = 1000 * 60 * 60 * 24;
  const diff = inicioDoDia(referencia).getTime() - inicioDoDia(dataPrevista).getTime();
  return Math.max(1, Math.round(diff / msPorDia));
}

/** True se as duas datas caem no mesmo dia. Usado para nao reenviar e-mail. */
export function mesmoDia(a: Date | null | undefined, b: Date): boolean {
  if (!a) return false;
  return inicioDoDia(a).getTime() === inicioDoDia(b).getTime();
}

export function formatarData(data: Date): string {
  return data.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
}

/**
 * Converte a data enviada pelo formulario ("2026-09-30") para um Date no fim
 * daquele dia. Sem isso o navegador interpreta como meia-noite UTC e, no fuso
 * de Brasilia, o prazo "virava" o dia anterior.
 */
export function dataDeFormulario(valor: string | Date): Date {
  if (valor instanceof Date) return fimDoDia(valor);

  const apenasData = /^\d{4}-\d{2}-\d{2}$/.test(valor);
  if (apenasData) {
    const partes = valor.split('-').map(Number);
    const ano = partes[0] as number;
    const mes = partes[1] as number;
    const dia = partes[2] as number;
    return new Date(ano, mes - 1, dia, 23, 59, 59, 999);
  }

  return fimDoDia(new Date(valor));
}

/**
 * Data de calendario vinda de formulario ("2026-10-09") que NAO e prazo - a
 * data de entrada de um equipamento, por exemplo. Vira meio-dia local daquele
 * dia. `new Date("2026-10-09")` e meia-noite UTC, que em Brasilia e 21h do dia
 * ANTERIOR: a tela mostrava a entrada um dia antes. Meio-dia fica longe das
 * duas viradas de dia, em qualquer fuso do Brasil.
 */
export function diaDeFormulario(valor: string | Date): Date {
  if (valor instanceof Date) return valor;

  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor.trim());
  if (partes && valor.trim().length === 10) {
    return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), 12, 0, 0, 0);
  }

  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) throw new AppError(`Data invalida: ${valor}.`, 422);
  return data;
}

/**
 * Proximo dia util (segunda a sexta) depois da data informada. Feriados nao
 * entram: o sistema nao tem calendario de feriados.
 */
export function proximoDiaUtil(data: Date): Date {
  const d = inicioDoDia(data);
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  return d;
}
