import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Bloco que abre e fecha clicando no titulo. Lembra, neste navegador, se o
 * usuario deixou aberto ou fechado.
 */
export function Secao({
  id,
  titulo,
  descricao,
  icone,
  resumo,
  abertaPorPadrao = false,
  destaque,
  children,
}: {
  /** Chave para lembrar o estado. */
  id: string;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  icone?: React.ReactNode;
  /** Aparece a direita do titulo (ex.: um status), mesmo fechada. */
  resumo?: React.ReactNode;
  abertaPorPadrao?: boolean;
  /** Borda de alerta. */
  destaque?: 'aviso' | 'erro';
  children: React.ReactNode;
}) {
  const chave = `notrole-secao-${id}`;
  const [aberta, setAberta] = React.useState<boolean>(() => {
    try {
      const salvo = localStorage.getItem(chave);
      return salvo === null ? abertaPorPadrao : salvo === '1';
    } catch {
      return abertaPorPadrao;
    }
  });

  const alternar = () =>
    setAberta((atual) => {
      try {
        localStorage.setItem(chave, atual ? '0' : '1');
      } catch {
        // Sem armazenamento: so nao lembra.
      }
      return !atual;
    });

  return (
    <section
      className={cn(
        'rounded-2xl border bg-white shadow-xs transition-colors dark:bg-slate-900/50',
        destaque === 'erro'
          ? 'border-red-200 dark:border-red-900/60'
          : destaque === 'aviso'
            ? 'border-amber-200 dark:border-amber-900/60'
            : 'border-slate-200/80 dark:border-slate-800/80',
      )}
    >
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberta}
        className="flex w-full items-center gap-3 rounded-2xl px-5 py-4 text-left transition-colors hover:bg-slate-50/60 sm:px-6 dark:hover:bg-slate-800/20"
      >
        {icone && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 dark:bg-slate-800/80 dark:text-slate-300">
            {icone}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-slate-900 dark:text-slate-50">{titulo}</p>
          {descricao && (
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{descricao}</p>
          )}
        </div>
        {resumo && <div className="hidden shrink-0 sm:block">{resumo}</div>}
        <ChevronDown
          className={cn(
            'h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200',
            aberta && 'rotate-180',
          )}
        />
      </button>

      {aberta && (
        <div className="animate-aparecer border-t border-slate-100 px-5 py-5 sm:px-6 dark:border-slate-800/80">
          {children}
        </div>
      )}
    </section>
  );
}
