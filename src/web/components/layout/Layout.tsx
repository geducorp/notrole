import * as React from 'react';
import { Laptop, Menu, X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Button } from '@/components/ui/Button';

interface LayoutProps {
  children: React.ReactNode;
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

export function Layout({ children, currentTab, setCurrentTab }: LayoutProps) {
  const [menuAberto, setMenuAberto] = React.useState(false);
  const conteudo = React.useRef<HTMLElement>(null);

  // Ao trocar de tela: fecha o menu (celular) e volta ao topo.
  React.useEffect(() => {
    setMenuAberto(false);
    conteudo.current?.scrollTo({ top: 0 });
  }, [currentTab]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans text-slate-900 transition-colors duration-200 dark:bg-slate-950 dark:text-slate-50">
      {menuAberto && (
        <div
          className="fixed inset-0 z-40 animate-aparecer bg-slate-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setMenuAberto(false)}
        />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300 ease-in-out lg:relative lg:translate-x-0 ${
          menuAberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar currentTab={currentTab} setCurrentTab={setCurrentTab} />
      </div>

      <main ref={conteudo} className="relative flex flex-1 flex-col overflow-y-auto">
        {/* Brilho discreto no topo, so no tema escuro. */}
        <div className="pointer-events-none absolute inset-x-0 top-0 hidden h-72 bg-[radial-gradient(ellipse_60%_100%_at_50%_0%,rgba(99,102,241,0.09),transparent)] dark:block" />

        <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/80 px-4 backdrop-blur lg:hidden dark:border-slate-800/80 dark:bg-slate-950/80">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600">
              <Laptop className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="font-semibold tracking-tight">Notrole</span>
          </div>
          <Button variant="ghost" size="icon" onClick={() => setMenuAberto(!menuAberto)}>
            {menuAberto ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>
        </header>

        <div className="relative mx-auto flex min-h-full w-full max-w-7xl flex-col p-4 md:p-8">
          <div key={currentTab} className="flex-1 animate-subir">
            {children}
          </div>
          <footer className="mt-auto flex justify-end pt-10">
            <span className="select-none text-[10px] font-medium text-slate-400 dark:text-slate-600">
              by Guilherme Schmoller
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
