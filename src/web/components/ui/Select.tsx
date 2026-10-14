import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { classeCampo } from './Input';

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  /** Classes do contorno (largura, por exemplo). Padrao: largura total. */
  containerClassName?: string;
}

/** Select nativo (funciona bem em qualquer navegador) com o visual dos campos. */
const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, containerClassName, children, ...props }, ref) => (
    <div className={cn('relative w-full', containerClassName)}>
      <select
        ref={ref}
        className={cn(classeCampo, 'h-9 cursor-pointer appearance-none pr-9', className)}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
    </div>
  ),
);
Select.displayName = 'Select';

export { Select };
