import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Etiqueta de status. A cor vem de `className` (ver CLASSE_STATUS_* em
 * lib/dominio); `icone` e opcional - sem ele, mostra um ponto na cor do texto.
 */
export function Badge({
  className,
  icone,
  title,
  children,
}: {
  className?: string;
  icone?: React.ReactNode;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        className,
      )}
    >
      {icone ?? <span className="h-1.5 w-1.5 rounded-full bg-current opacity-80" />}
      {children}
    </span>
  );
}
