import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

/** Classes comuns a campos de texto, selects e areas de texto. */
export const classeCampo = cn(
  'w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-xs transition-colors',
  'placeholder:text-slate-400 dark:placeholder:text-slate-500',
  'hover:border-slate-300 dark:hover:border-slate-700',
  'focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-indigo-500/15',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-100',
);

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        classeCampo,
        'flex h-9 py-1 file:border-0 file:bg-transparent file:text-sm file:font-medium',
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Input.displayName = 'Input';

export { Input };
