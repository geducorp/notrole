import * as React from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classeCampo } from './Input';

interface DateInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange'> {
  value: string;
  onChange: (valor: string) => void;
  /** Botoes de atalho abaixo do campo, ex.: [{ rotulo: '+7 dias', valor: '2026-09-29' }]. */
  atalhos?: Array<{ rotulo: string; valor: string }>;
}

/**
 * Campo de data com o calendario do navegador. Clicar em qualquer ponto do
 * campo abre o calendario; digitar continua funcionando.
 */
export function DateInput({ value, onChange, atalhos, className, ...props }: DateInputProps) {
  const ref = React.useRef<HTMLInputElement>(null);

  const abrirCalendario = () => {
    try {
      ref.current?.showPicker?.();
    } catch {
      // Navegadores antigos: o campo continua aceitando digitacao.
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <input
          ref={ref}
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onClick={abrirCalendario}
          className={cn(
            classeCampo,
            'flex h-9 cursor-pointer py-1 pr-10',
            // Esconde o icone nativo (some no tema escuro em alguns navegadores)
            // e deixa a area dele clicavel por cima do nosso icone.
            '[&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:right-0 [&::-webkit-calendar-picker-indicator]:h-full [&::-webkit-calendar-picker-indicator]:w-10 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0',
            className,
          )}
          {...props}
        />
        <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      </div>

      {atalhos && atalhos.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {atalhos.map((a) => (
            <button
              key={a.rotulo}
              type="button"
              onClick={() => onChange(a.valor)}
              className={cn(
                'rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors',
                value === a.valor
                  ? 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30'
                  : 'text-slate-600 ring-slate-200 hover:bg-slate-50 dark:text-slate-400 dark:ring-slate-800 dark:hover:bg-slate-800/60',
              )}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
