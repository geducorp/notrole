import { cn } from '@/lib/utils';

/**
 * Marca de cada empresa na tela: um selo com as iniciais do apelido, numa cor
 * fixa derivada do proprio nome. Assim qualquer empresa cadastrada em
 * Configuracoes > Empresas ganha uma identidade visual sem precisar de arquivo
 * de logo, e a mesma empresa tem sempre a mesma cor em todas as telas.
 *
 * Quer usar o logo de verdade? Coloque a imagem em src/web/assets/empresas/ e
 * mapeie em LOGOS, pela palavra que aparece no apelido (sem acento, minusculas).
 */
const LOGOS: Record<string, string> = {
  // exemplo: 'exemplo': logoExemplo,  (import logoExemplo from '@/assets/empresas/exemplo.png')
};

/** Paleta dos selos: cores que funcionam no tema claro e no escuro. */
const CORES = [
  'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300',
  'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  'bg-sky-500/15 text-sky-700 dark:text-sky-300',
  'bg-rose-500/15 text-rose-700 dark:text-rose-300',
  'bg-violet-500/15 text-violet-700 dark:text-violet-300',
  'bg-teal-500/15 text-teal-700 dark:text-teal-300',
  'bg-orange-500/15 text-orange-700 dark:text-orange-300',
];

const semAcento = (texto: string) =>
  texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

function logoDa(apelido: string): string | null {
  const nome = semAcento(apelido);
  const chave = Object.keys(LOGOS).find((k) => nome.includes(k));
  return chave ? LOGOS[chave]! : null;
}

/** Cor estavel por nome (hash simples do texto). */
function corDa(apelido: string): string {
  let hash = 0;
  for (const c of semAcento(apelido)) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return CORES[hash % CORES.length]!;
}

/** "Empresa Exemplo A" -> "EA"; "Acme" -> "AC". */
export function iniciaisDaEmpresa(apelido: string): string {
  const palavras = nomeCurtoDaEmpresa(apelido)
    .split(/[\s\-_.]+/)
    .filter((p) => p && !/^(de|da|do|das|dos|e)$/i.test(p));
  if (palavras.length === 0) return '?';
  if (palavras.length === 1) return palavras[0]!.slice(0, 2).toUpperCase();
  return (palavras[0]![0]! + palavras[palavras.length - 1]![0]!).toUpperCase();
}

/** "Acme Comercial" -> "Acme". O nome completo continua nos termos e relatórios. */
export function nomeCurtoDaEmpresa(apelido: string): string {
  return apelido.replace(/\s+(comercial|ltda\.?|s\.?\s?a\.?|eireli|me)$/i, '').trim() || apelido;
}

/** Selo da empresa (logo, se configurado, ou as iniciais), numa caixa de tamanho fixo. */
export function LogoEmpresa({ apelido, altura = 16, className }: { apelido: string; altura?: number; className?: string }) {
  const logo = logoDa(apelido);
  const largura = Math.round(altura * 1.5);

  if (logo) {
    return (
      <span
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
        style={{ width: largura, height: altura }}
        aria-hidden="true"
      >
        <img src={logo} alt="" className="max-h-full max-w-full object-contain" />
      </span>
    );
  }

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded font-semibold leading-none tracking-tight',
        corDa(apelido),
        className,
      )}
      style={{ width: largura, height: altura, fontSize: Math.max(8, Math.round(altura * 0.55)) }}
      aria-hidden="true"
    >
      {iniciaisDaEmpresa(apelido)}
    </span>
  );
}

/** Selo + nome curto: "[EA] Empresa Exemplo A". Com `completo`, mostra o nome inteiro. */
export function NomeEmpresa({
  apelido,
  completo = false,
  className,
}: {
  apelido: string;
  completo?: boolean;
  className?: string;
}) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)} title={apelido}>
      <LogoEmpresa apelido={apelido} />
      <span className="truncate">{completo ? apelido : nomeCurtoDaEmpresa(apelido)}</span>
    </span>
  );
}

/**
 * Filtro de empresa em botoes (Todas | Empresa A | Empresa B ...), no lugar do
 * select: com poucas empresas, cabe numa linha e mostra a escolha de relance.
 */
export function FiltroEmpresa({
  empresas,
  valor,
  aoMudar,
  className,
}: {
  empresas: Array<{ id: number; apelido: string }>;
  valor: string;
  aoMudar: (empresaId: string) => void;
  className?: string;
}) {
  const opcoes = [{ id: '', rotulo: 'Todas', apelido: null as string | null }].concat(
    empresas.map((e) => ({ id: String(e.id), rotulo: nomeCurtoDaEmpresa(e.apelido), apelido: e.apelido })),
  );

  return (
    <div
      role="radiogroup"
      aria-label="Empresa"
      className={cn(
        'inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-xl bg-slate-100 p-1 dark:bg-slate-900',
        className,
      )}
    >
      {opcoes.map((o) => (
        <button
          key={o.id || 'todas'}
          type="button"
          role="radio"
          aria-checked={valor === o.id}
          onClick={() => aoMudar(o.id)}
          className={cn(
            'inline-flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors',
            valor === o.id
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          {o.apelido && <LogoEmpresa apelido={o.apelido} altura={14} />}
          {o.rotulo}
        </button>
      ))}
    </div>
  );
}
