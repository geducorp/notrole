import * as React from 'react';
import { cn } from '@/lib/utils';

/** Rotulo + campo + dica/erro, no mesmo padrao em todos os formularios. */
export function Campo({
  rotulo,
  obrigatorio,
  dica,
  erro,
  className,
  children,
}: {
  rotulo: React.ReactNode;
  obrigatorio?: boolean;
  dica?: React.ReactNode;
  erro?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">
        {rotulo}
        {obrigatorio && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {erro ? (
        <p className="text-xs text-red-600 dark:text-red-400">{erro}</p>
      ) : (
        dica && <p className="text-xs text-slate-500 dark:text-slate-400">{dica}</p>
      )}
    </div>
  );
}
