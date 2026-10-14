import * as React from 'react';
import { cn } from '@/lib/utils';
import { normalizarMoeda } from '@/lib/dominio';
import { classeCampo } from './Input';

interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (valor: string) => void;
}

/**
 * Valor em reais. Aceita "2300", "2300,5", "2.300,00" ou "2300.50" e, ao sair
 * do campo, formata como "2.300,00".
 */
export function MoneyInput({ value, onChange, className, onBlur, ...props }: MoneyInputProps) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
        R$
      </span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        onBlur={(e) => {
          onChange(normalizarMoeda(value));
          onBlur?.(e);
        }}
        placeholder="0,00"
        className={cn(classeCampo, 'flex h-9 py-1 pl-10 tabular-nums', className)}
        {...props}
      />
    </div>
  );
}
