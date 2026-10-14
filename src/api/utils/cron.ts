/**
 * Quando uma expressao cron roda: a execucao anterior e a proxima, no fuso
 * informado. Serve so para a tela mostrar o "proximo envio em 23 min"; quem
 * agenda de verdade continua sendo o node-cron.
 *
 * Aceita o formato de 5 campos com *, numeros, faixas (8-18), listas (1,3) e
 * passos (*\/5). Com algo fora disso (nomes de dia, 6 campos) devolve null e a
 * tela so nao mostra o contador.
 */

type Campos = { minuto: Set<number>; hora: Set<number>; dia: Set<number>; mes: Set<number>; semana: Set<number> };

interface Expressao extends Campos {
  diaRestrito: boolean;
  semanaRestrita: boolean;
}

function valoresDoCampo(campo: string, min: number, max: number): Set<number> | null {
  const valores = new Set<number>();
  for (const parte of campo.split(',')) {
    const [faixa, passoTexto] = parte.split('/');
    const passo = passoTexto === undefined ? 1 : Number(passoTexto);
    if (!Number.isInteger(passo) || passo < 1 || faixa === undefined) return null;

    let inicio = min;
    let fim = max;
    if (faixa !== '*') {
      const [a, b] = faixa.split('-');
      inicio = Number(a);
      fim = b !== undefined ? Number(b) : passoTexto !== undefined ? max : inicio;
    }
    if (!Number.isInteger(inicio) || !Number.isInteger(fim) || inicio < min || fim > max) return null;
    for (let v = inicio; v <= fim; v += passo) valores.add(v);
  }
  return valores;
}

function interpretar(expressao: string): Expressao | null {
  const partes = expressao.trim().split(/\s+/);
  if (partes.length !== 5) return null;
  const [m, h, d, me, s] = partes as [string, string, string, string, string];

  const minuto = valoresDoCampo(m, 0, 59);
  const hora = valoresDoCampo(h, 0, 23);
  const dia = valoresDoCampo(d, 1, 31);
  const mes = valoresDoCampo(me, 1, 12);
  const semana = valoresDoCampo(s, 0, 7);
  if (!minuto || !hora || !dia || !mes || !semana) return null;
  if (semana.has(7)) semana.add(0); // 7 tambem e domingo.

  return { minuto, hora, dia, mes, semana, diaRestrito: d !== '*', semanaRestrita: s !== '*' };
}

const DIAS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function relogio(fuso: string) {
  const formato = new Intl.DateTimeFormat('en-US', {
    timeZone: fuso,
    hourCycle: 'h23',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  });
  return (instante: number) => {
    const p: Record<string, string> = {};
    for (const { type, value } of formato.formatToParts(instante)) p[type] = value;
    return {
      minuto: Number(p.minute),
      hora: Number(p.hour),
      dia: Number(p.day),
      mes: Number(p.month),
      semana: DIAS[p.weekday ?? ''] ?? -1,
    };
  };
}

function casa(e: Expressao, t: ReturnType<ReturnType<typeof relogio>>): boolean {
  if (!e.minuto.has(t.minuto) || !e.hora.has(t.hora) || !e.mes.has(t.mes)) return false;
  const noDia = e.dia.has(t.dia);
  const naSemana = e.semana.has(t.semana);
  // Regra do cron: com dia do mes E dia da semana restritos, vale qualquer um.
  return e.diaRestrito && e.semanaRestrita ? noDia || naSemana : noDia && naSemana;
}

const MINUTO = 60_000;
// Uma semana e pouco cobre qualquer agenda de dias uteis.
const LIMITE = 8 * 24 * 60;

export function execucoesDaAgenda(
  expressao: string,
  fuso: string,
  agora = Date.now(),
): { anterior: Date; proxima: Date } | null {
  const e = interpretar(expressao);
  if (!e) return null;

  const horaDe = relogio(fuso);
  const inicioDoMinuto = Math.floor(agora / MINUTO) * MINUTO;

  let proxima: number | null = null;
  for (let i = 1; i <= LIMITE; i += 1) {
    const t = inicioDoMinuto + i * MINUTO;
    if (casa(e, horaDe(t))) {
      proxima = t;
      break;
    }
  }

  let anterior: number | null = null;
  for (let i = 0; i <= LIMITE; i += 1) {
    const t = inicioDoMinuto - i * MINUTO;
    if (casa(e, horaDe(t))) {
      anterior = t;
      break;
    }
  }

  if (proxima === null || anterior === null) return null;
  return { anterior: new Date(anterior), proxima: new Date(proxima) };
}
