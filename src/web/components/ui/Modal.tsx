import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  aberto: boolean;
  aoFechar: () => void;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  /** Icone ao lado do titulo. */
  icone?: React.ReactNode;
  largura?: 'sm' | 'md' | 'lg' | 'xl';
  /** Barra de botoes fixa no rodape. */
  rodape?: React.ReactNode;
  children: React.ReactNode;
}

const LARGURAS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
};

/**
 * Janela sobre a tela. Esc fecha. Clicar fora NAO fecha de proposito: a maior
 * parte das janelas tem formulario, e um clique perdido apagaria o que foi
 * digitado.
 */
export function Modal({
  aberto,
  aoFechar,
  titulo,
  descricao,
  icone,
  largura = 'md',
  rodape,
  children,
}: ModalProps) {
  React.useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') aoFechar();
    };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto, aoFechar]);

  if (!aberto) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 animate-aparecer bg-slate-950/50 backdrop-blur-[2px]" />
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          'relative flex max-h-[92vh] w-full animate-subir flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl shadow-slate-950/20',
          'dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/50',
          LARGURAS[largura],
        )}
      >
        <div className="flex items-start gap-3 px-6 pb-4 pt-5">
          {icone && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 ring-1 ring-inset ring-indigo-100 dark:bg-indigo-500/10 dark:text-indigo-300 dark:ring-indigo-500/20">
              {icone}
            </div>
          )}
          <div className="min-w-0 flex-1 pt-0.5">
            <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">{titulo}</h3>
            {descricao && (
              <p className="mt-0.5 truncate text-sm text-slate-500 dark:text-slate-400">{descricao}</p>
            )}
          </div>
          <button
            type="button"
            onClick={aoFechar}
            title="Fechar (Esc)"
            className="-mr-2 -mt-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto px-6 pb-6">{children}</div>

        {rodape && (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-3.5 dark:border-slate-800 dark:bg-slate-950/30">
            {rodape}
          </div>
        )}
      </div>
    </div>
  );
}
