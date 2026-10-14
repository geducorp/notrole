import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

/**
 * Botao padrao. "default" e a acao principal (indigo); "outline" a secundaria;
 * "ghost" para icones e acoes discretas.
 */
const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex select-none items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium',
          'transition-all duration-150 active:scale-[0.98]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-slate-950',
          'disabled:pointer-events-none disabled:opacity-50',
          {
            'bg-indigo-600 text-white shadow-sm shadow-indigo-600/20 hover:bg-indigo-500 dark:shadow-indigo-950/40':
              variant === 'default',
            'border border-slate-200 bg-white text-slate-700 shadow-xs hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-200 dark:hover:border-slate-700 dark:hover:bg-slate-800/80 dark:hover:text-white':
              variant === 'outline',
            'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/70 dark:hover:text-white':
              variant === 'ghost',
            'bg-red-600 text-white shadow-sm shadow-red-600/20 hover:bg-red-500': variant === 'destructive',
            'h-9 px-4': size === 'default',
            'h-8 px-3 text-xs': size === 'sm',
            'h-11 px-6': size === 'lg',
            'h-9 w-9': size === 'icon',
          },
          className,
        )}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button };
