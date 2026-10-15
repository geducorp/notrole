import { TriangleAlert } from 'lucide-react';
import { nomeCurtoDaEmpresa } from '@/components/ui/Empresa';
import { usePerfil } from '@/lib/perfil';
import { cn } from '@/lib/utils';
import type { ResumoEstoque } from '@/types';

/**
 * Perifericos no limite ou abaixo do estoque minimo, um por etiqueta:
 * categoria + descricao ("Memória RAM 8GB") e o saldo ("3 / mín. 5"). So a
 * descricao nao dizia o que era ("8GB"). A empresa so aparece para o
 * administrador: o analista ve so a dele.
 */
export function AvisoEstoqueBaixo({
  itens,
  className,
}: {
  itens: ResumoEstoque['abaixoDoMinimo'];
  className?: string;
}) {
  const perfil = usePerfil();
  if (itens.length === 0) return null;
  const mostrarEmpresa = !!perfil?.admin;

  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-xl bg-amber-50 p-3.5 ring-1 ring-inset ring-amber-600/15 sm:flex-row sm:items-center sm:gap-4 dark:bg-amber-500/10 dark:ring-amber-400/20',
        className,
      )}
    >
      <p className="flex shrink-0 items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-300">
        <TriangleAlert className="h-4 w-4" />
        Estoque baixo
      </p>
      <ul className="flex flex-wrap gap-2">
        {itens.map((i) => (
          <li
            key={i.id}
            className="flex items-center gap-2 rounded-lg bg-white/70 px-2.5 py-1 text-sm ring-1 ring-inset ring-amber-600/15 dark:bg-slate-950/40 dark:ring-amber-400/15"
          >
            <span className="text-slate-500 dark:text-slate-400">{i.categoria}</span>
            <span className="font-medium text-slate-900 dark:text-slate-100">{i.descricao}</span>
            {mostrarEmpresa && (
              <span className="text-xs text-slate-500 dark:text-slate-400">· {nomeCurtoDaEmpresa(i.empresa)}</span>
            )}
            <span
              className="tabular-nums font-semibold text-amber-700 dark:text-amber-300"
              title={`Restam ${i.quantidade}; o mínimo é ${i.estoqueMinimo}.`}
            >
              {i.quantidade}
              <span className="font-normal text-amber-700/70 dark:text-amber-300/70"> / mín. {i.estoqueMinimo}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
