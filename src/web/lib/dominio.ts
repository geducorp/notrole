import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type {
  CondicaoItem,
  Emprestimo,
  Item,
  ModalidadeCessao,
  SituacaoItem,
  StatusEmprestimo,
  TipoAcao,
  TipoMovimentacao,
  TipoTemplate,
} from '@/types';

/**
 * Rotulos e cores de status, num lugar so.
 *
 * Cada tela tinha o seu proprio `getStatusColor` com um switch diferente, e os
 * valores nem batiam entre si: Notebooks tratava 'EMPRESTADO' e 'DESCARTADO',
 * que nao existem no enum do banco (sao EM_USO e DESCONTINUADO). O resultado
 * era status caindo sempre no cinza "default".
 */

export const ROTULO_SITUACAO_ITEM: Record<SituacaoItem, string> = {
  EM_ESTOQUE: 'Em estoque',
  RESERVADO: 'Reservado',
  EMPRESTADO: 'Emprestado',
  ENTREGUE: 'Entregue',
  MANUTENCAO: 'Manutenção',
  BAIXADO: 'Baixado',
};

export const ROTULO_CONDICAO_ITEM: Record<CondicaoItem, string> = {
  NOVO: 'Novo',
  USADO: 'Usado',
};

export const ROTULO_MOVIMENTACAO: Record<TipoMovimentacao, string> = {
  ENTRADA: 'Entrada no estoque',
  CONTAGEM_INICIAL: 'Contagem inicial',
  ENTREGA: 'Entregue ao colaborador',
  DEVOLUCAO: 'Devolvido ao estoque',
  EMPRESTIMO: 'Emprestado',
  DEVOLUCAO_EMPRESTIMO: 'Empréstimo encerrado',
  TRANSFERENCIA: 'Transferido',
  MANUTENCAO: 'Enviado para manutenção',
  RETORNO_MANUTENCAO: 'Voltou da manutenção',
  BAIXA: 'Baixa',
  AJUSTE: 'Ajuste de saldo',
};

/**
 * Nome do equipamento nas telas. Nem todo item tem hostname: notebooks tem,
 * monitores e headsets nao. Sem hostname, o nome e marca + modelo; o numero
 * de serie tem coluna propria e nao entra no nome.
 */
export function nomeDoItem(item: Pick<Item, 'hostname' | 'marca' | 'modelo'>): string {
  if (item.hostname) return item.hostname;
  return [item.marca, item.modelo].filter(Boolean).join(' ');
}

/** 1024 -> "1 TB"; 512 -> "512 GB". */
export function formatarGb(gb: number): string {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

/** "Intel Core i5 · 16 GB RAM · 512 GB": vazio quando nao ha especificacao. */
export function especificacoesDoItem(
  item: Partial<Pick<Item, 'processador' | 'memoriaGb' | 'armazenamentoGb'>>,
): string {
  return [
    item.processador,
    item.memoriaGb ? `${formatarGb(item.memoriaGb)} RAM` : null,
    item.armazenamentoGb ? formatarGb(item.armazenamentoGb) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Computador sem hostname: ainda nao foi formatado e posto na rede. */
export function pendenteDeFormatacao(item: Pick<Item, 'hostname'> & { categoria?: { computador: boolean } | null }): boolean {
  return !!item.categoria?.computador && !item.hostname;
}

/** Paleta das etiquetas de status: texto, fundo e contorno, claro e escuro. */
export const TOM = {
  verde: 'text-emerald-700 bg-emerald-50 ring-emerald-600/20 dark:text-emerald-300 dark:bg-emerald-400/10 dark:ring-emerald-400/20',
  azul: 'text-blue-700 bg-blue-50 ring-blue-600/20 dark:text-blue-300 dark:bg-blue-400/10 dark:ring-blue-400/20',
  violeta: 'text-violet-700 bg-violet-50 ring-violet-600/20 dark:text-violet-300 dark:bg-violet-400/10 dark:ring-violet-400/20',
  ambar: 'text-amber-700 bg-amber-50 ring-amber-600/20 dark:text-amber-300 dark:bg-amber-400/10 dark:ring-amber-400/20',
  vermelho: 'text-red-700 bg-red-50 ring-red-600/20 dark:text-red-300 dark:bg-red-400/10 dark:ring-red-400/20',
  cinza: 'text-slate-600 bg-slate-50 ring-slate-500/20 dark:text-slate-400 dark:bg-slate-400/10 dark:ring-slate-400/20',
  indigo: 'text-indigo-700 bg-indigo-50 ring-indigo-600/20 dark:text-indigo-300 dark:bg-indigo-400/10 dark:ring-indigo-400/20',
} as const;

export const CLASSE_SITUACAO_ITEM: Record<SituacaoItem, string> = {
  EM_ESTOQUE: TOM.verde,
  RESERVADO: TOM.violeta,
  EMPRESTADO: TOM.azul,
  ENTREGUE: TOM.indigo,
  MANUTENCAO: TOM.ambar,
  BAIXADO: TOM.cinza,
};

/**
 * Condicao em contorno, sem cor de fundo: assim nao se confunde com a
 * situacao (Em estoque, Emprestado...), que e o que importa de relance.
 */
export const CLASSE_CONDICAO_ITEM: Record<CondicaoItem, string> = {
  NOVO: 'bg-transparent text-slate-700 ring-slate-300 dark:text-slate-200 dark:ring-slate-600',
  USADO: 'bg-transparent text-slate-500 ring-slate-200 dark:text-slate-400 dark:ring-slate-700',
};

/**
 * Hostname e especificacoes so existem em computador (notebook, desktop). A
 * marca e da categoria (Configuracoes > Categorias), nao do nome.
 */
export function ehComputador(categoria: { computador: boolean } | null | undefined): boolean {
  return categoria?.computador ?? false;
}

export const ROTULO_STATUS_EMPRESTIMO: Record<StatusEmprestimo, string> = {
  AGUARDANDO_ASSINATURA: 'Aguardando assinatura',
  ATIVO: 'Ativo',
  DEVOLVIDO: 'Devolvido',
  CANCELADO: 'Cancelado',
};

export const CLASSE_STATUS_EMPRESTIMO: Record<StatusEmprestimo, string> = {
  AGUARDANDO_ASSINATURA: TOM.ambar,
  ATIVO: TOM.azul,
  DEVOLVIDO: TOM.verde,
  CANCELADO: TOM.cinza,
};

const CLASSE_ATRASADO = TOM.vermelho;

/**
 * "Atrasado" e uma situacao derivada, nao um status guardado no banco: a API
 * devolve `atrasado` e `diasAtraso` calculados a cada consulta.
 */
export function rotuloSituacaoEmprestimo(emprestimo: Emprestimo): string {
  if (emprestimo.atrasado) {
    return `Atrasado (${emprestimo.diasAtraso} ${emprestimo.diasAtraso === 1 ? 'dia' : 'dias'})`;
  }

  // Enquanto o termo não chega ao colaborador, a situação é "na fila" - e não
  // "aguardando assinatura". Confundir as duas faria o operador cobrar uma
  // assinatura que nem chegou a ser pedida.
  if (emprestimo.status === 'AGUARDANDO_ASSINATURA' && emprestimo.d4signEtapa !== 'ENVIADO') {
    return termoPrecisaDeAtencao(emprestimo) ? 'Termo com problema' : 'Termo na fila';
  }

  if (conviteNaoEntregue(emprestimo)) return 'E-mail não entregue';

  return ROTULO_STATUS_EMPRESTIMO[emprestimo.status];
}

/**
 * O sistema parou de tentar gerar o termo e espera alguém conferir o painel do
 * D4Sign. Não volta a tentar sozinho de propósito: o D4Sign cobra por
 * documento, e repetir no escuro poderia criar um em duplicidade.
 */
export function termoPrecisaDeAtencao(emprestimo: Emprestimo): boolean {
  if (emprestimo.status !== 'AGUARDANDO_ASSINATURA' || emprestimo.d4signEtapa === 'ENVIADO') {
    return false;
  }
  const status = emprestimo.d4signStatus ?? '';
  return status.startsWith('FALHOU') || status.startsWith('VERIFICAR NO D4SIGN');
}

/**
 * Linha de apoio do "Termo na fila": por que ainda não saiu e quando deve sair.
 * Sem ela o operador via só "na fila" e achava que o envio tinha falhado.
 *
 * A fila do D4Sign roda de 5 em 5 minutos; a hora prevista é arredondada para
 * a próxima rodada. Devolve null quando o termo não está na fila.
 */
export function detalheDaFila(emprestimo: Emprestimo, agora = new Date()): string | null {
  if (emprestimo.status !== 'AGUARDANDO_ASSINATURA' || emprestimo.d4signEtapa === 'ENVIADO') return null;
  if (termoPrecisaDeAtencao(emprestimo)) return 'Confira o histórico do empréstimo.';

  const status = emprestimo.d4signStatus ?? '';
  const previsto = emprestimo.d4signProximaTentativa ? new Date(emprestimo.d4signProximaTentativa) : null;

  if (previsto && previsto.getTime() > agora.getTime()) {
    const rodada = new Date(Math.ceil(previsto.getTime() / (5 * 60_000)) * 5 * 60_000);
    const hora = rodada.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const quando =
      rodada.toDateString() === agora.toDateString()
        ? `por volta das ${hora}`
        : `${rodada.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} por volta das ${hora}`;
    const motivo = status.startsWith('ERRO')
      ? 'Falha no D4Sign, nova tentativa'
      : 'Aguardando cota do D4Sign. Sai';
    return `${motivo} ${quando}.`;
  }

  // Recém-criado (a fila ainda não passou) ou D4Sign pausado em Configurações.
  return 'Aguardando a próxima rodada da fila (a cada 5 min).';
}

/**
 * O termo foi enviado, mas o D4Sign não conseguiu entregar o e-mail de convite
 * a algum signatário - em geral porque o endereço está na lista de supressão
 * do serviço de e-mail do D4Sign. Sem isso a pessoa nem sabe que tem algo a
 * assinar.
 */
export function conviteNaoEntregue(emprestimo: Emprestimo): boolean {
  return (
    emprestimo.status === 'AGUARDANDO_ASSINATURA' &&
    emprestimo.d4signEtapa === 'ENVIADO' &&
    !!emprestimo.d4signAvisoEmail
  );
}

export function classeSituacaoEmprestimo(emprestimo: Emprestimo): string {
  if (emprestimo.atrasado || termoPrecisaDeAtencao(emprestimo) || conviteNaoEntregue(emprestimo)) {
    return CLASSE_ATRASADO;
  }
  return CLASSE_STATUS_EMPRESTIMO[emprestimo.status];
}

export const ROTULO_ACAO: Record<TipoAcao, string> = {
  CRIADO: 'Empréstimo registrado',
  TERMO_GERADO: 'Termo de responsabilidade',
  TERMO_ASSINADO: 'Termo assinado',
  ATIVADO: 'Empréstimo ativado',
  RENOVADO: 'Prazo renovado',
  LEMBRETE_ENVIADO: 'Lembrete enviado',
  COBRADO: 'Cobrança enviada',
  DEVOLVIDO: 'Devolução registrada',
  CANCELADO: 'Empréstimo cancelado',
};

/** Mesmos rotulos, na palavra certa para a entrega definitiva. */
const ROTULO_ACAO_ENTREGA: Partial<Record<TipoAcao, string>> = {
  CRIADO: 'Entrega registrada',
  ATIVADO: 'Entrega ativada',
  CANCELADO: 'Entrega cancelada',
};

/** Rotulo do historico conforme a modalidade da cessao. */
export function rotuloAcao(acao: TipoAcao, modalidade: ModalidadeCessao): string {
  return (modalidade === 'DEFINITIVA' ? ROTULO_ACAO_ENTREGA[acao] : undefined) ?? ROTULO_ACAO[acao] ?? acao;
}

export const ROTULO_TEMPLATE: Record<TipoTemplate, string> = {
  CONFIRMACAO_EMPRESTIMO: 'Confirmação de empréstimo',
  CONFIRMACAO_ENTREGA: 'Confirmação de entrega',
  LEMBRETE_PREVIO: 'Lembrete de vencimento (1 dia antes)',
  COBRANCA_ATRASO: 'Cobrança de atraso',
  DEVOLUCAO_CONFIRMADA: 'Confirmação de devolução',
  TERMO_PARA_ASSINAR: 'Termo para assinar',
};

export const DESCRICAO_TEMPLATE: Record<TipoTemplate, string> = {
  CONFIRMACAO_EMPRESTIMO:
    'Enviado quando o empréstimo fica ativo: na hora, sem termo; ou depois que o colaborador assina o termo.',
  CONFIRMACAO_ENTREGA:
    'Enviado quando a entrega definitiva fica ativa: na hora, sem termo; ou depois que o colaborador assina o termo.',
  LEMBRETE_PREVIO: 'Enviado automaticamente no dia anterior ao vencimento do prazo.',
  COBRANCA_ATRASO: 'Enviado uma vez por dia enquanto a devolução estiver atrasada.',
  DEVOLUCAO_CONFIRMADA: 'Enviado quando a devolução do equipamento é registrada.',
  TERMO_PARA_ASSINAR:
    'Enviado junto com o convite do D4Sign: explica ao colaborador que é o termo do empréstimo/entrega e como assinar.',
};

export function formatarData(valor: string | Date | null | undefined): string {
  if (!valor) return '-';
  const data = typeof valor === 'string' ? parseISO(valor) : valor;
  if (Number.isNaN(data.getTime())) return '-';
  return format(data, 'dd/MM/yyyy', { locale: ptBR });
}

export function formatarDataHora(valor: string | Date | null | undefined): string {
  if (!valor) return '-';
  const data = typeof valor === 'string' ? parseISO(valor) : valor;
  if (Number.isNaN(data.getTime())) return '-';
  return format(data, "dd/MM/yyyy 'às' HH:mm", { locale: ptBR });
}

/** Converte uma data ISO para o valor aceito por um <input type="date">. */
export function paraInputDate(valor: string | Date | null | undefined): string {
  if (!valor) return '';
  const data = typeof valor === 'string' ? parseISO(valor) : valor;
  if (Number.isNaN(data.getTime())) return '';
  return format(data, 'yyyy-MM-dd');
}

export function hojeParaInputDate(diasAFrente = 0): string {
  const data = new Date();
  data.setDate(data.getDate() + diasAFrente);
  return format(data, 'yyyy-MM-dd');
}

// ---------------------------------------------------------------------------
// Termo de comodato: CPF e dinheiro
// ---------------------------------------------------------------------------

/** "4500" -> "R$ 4.500,00". Vazio -> "-". */
export function formatarMoeda(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '-';
  const numero = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(numero)) return '-';
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

/** Valor do banco ("4500.5") para o campo do formulario ("4.500,50"). */
export function moedaParaCampo(valor: string | null | undefined): string {
  if (!valor) return '';
  const numero = Number(valor);
  return Number.isFinite(numero)
    ? numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';
}

/** Mascara enquanto digita: "12345678909" -> "123.456.789-09". */
export function mascararCpf(valor: string): string {
  const d = valor.replace(/\D/g, '').slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2');
}

/**
 * Confere o digito verificador. O CPF vai para um contrato assinado; um digito
 * trocado na hora de digitar e o tipo de erro que so aparece quando alguem
 * precisa do documento.
 */
export function cpfValido(valor: string): boolean {
  const cpf = valor.replace(/\D/g, '');
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const digito = (base: string, peso: number) => {
    const soma = [...base].reduce((acc, n, i) => acc + Number(n) * (peso - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };
  return digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10]);
}

/**
 * Valor digitado -> "2.300,00". Aceita "2300", "2300,5", "2.300", "2.300,00"
 * e "2300.50". Texto que nao for numero volta como veio, para o operador ver.
 */
export function normalizarMoeda(texto: string): string {
  const limpo = texto.replace(/[^\d.,]/g, '');
  if (!limpo) return '';

  let normalizado: string;
  if (limpo.includes(',')) {
    // Virgula e o separador decimal; pontos sao milhares.
    const [inteiro, ...resto] = limpo.split(',');
    normalizado = `${inteiro!.replace(/\./g, '')}.${resto.join('')}`;
  } else if (/^\d{1,3}(\.\d{3})+$/.test(limpo)) {
    // "2.300" ou "1.234.567": pontos de milhar.
    normalizado = limpo.replace(/\./g, '');
  } else {
    // "2300.50": o ultimo ponto e o decimal.
    const i = limpo.lastIndexOf('.');
    normalizado = i < 0 ? limpo : `${limpo.slice(0, i).replace(/\./g, '')}.${limpo.slice(i + 1)}`;
  }

  const numero = Number(normalizado);
  if (!Number.isFinite(numero)) return texto;
  return numero.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
