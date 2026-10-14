import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/components/ThemeProvider';
import { cn } from '@/lib/utils';

/** Tema claro/escuro, como um seletor de duas opcoes. */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const escuro =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const opcoes = [
    { valor: 'light' as const, rotulo: 'Claro', Icone: Sun, ativo: !escuro },
    { valor: 'dark' as const, rotulo: 'Escuro', Icone: Moon, ativo: escuro },
  ];

  return (
    <div
      role="radiogroup"
      aria-label="Tema"
      className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-900"
    >
      {opcoes.map(({ valor, rotulo, Icone, ativo }) => (
        <button
          key={valor}
          type="button"
          role="radio"
          aria-checked={ativo}
          onClick={() => setTheme(valor)}
          className={cn(
            'flex items-center justify-center gap-1.5 rounded-md py-1 text-xs font-medium transition-all',
            ativo
              ? 'bg-white text-slate-900 shadow-sm dark:bg-slate-700/70 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200',
          )}
        >
          <Icone className="h-3.5 w-3.5" />
          {rotulo}
        </button>
      ))}
    </div>
  );
}
