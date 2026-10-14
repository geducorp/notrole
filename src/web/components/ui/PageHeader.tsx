import * as React from 'react';

/** Titulo, descricao e acoes no topo de cada tela. */
export function PageHeader({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: React.ReactNode;
  acoes?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
          {titulo}
        </h2>
        {descricao && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{descricao}</p>}
      </div>
      {acoes && <div className="flex w-full gap-2 sm:w-auto">{acoes}</div>}
    </div>
  );
}
