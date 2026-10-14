import { Boxes, FileText, Laptop, LayoutDashboard, LogOut, PackageCheck, Settings, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';
import { useAuth } from '@/components/AuthContext';
import { usePerfil } from '@/lib/perfil';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
}

const MENU = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'estoque', label: 'Estoque', icon: Boxes },
  { id: 'emprestimos', label: 'Empréstimos', icon: FileText },
  { id: 'entregas', label: 'Entregas', icon: PackageCheck },
  { id: 'colaboradores', label: 'Colaboradores', icon: Users },
  { id: 'configuracoes', label: 'Configurações', icon: Settings },
];

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  const primeira = partes[0]?.[0] ?? '';
  const ultima = partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '';
  return (primeira + ultima).toUpperCase();
}

export function Sidebar({ currentTab, setCurrentTab }: SidebarProps) {
  const { usuario, sair } = useAuth();
  const perfil = usePerfil();

  return (
    <div className="flex h-screen w-64 flex-col border-r border-slate-200/80 bg-white text-slate-600 transition-colors duration-200 dark:border-slate-800/80 dark:bg-slate-950 dark:text-slate-300">
      {/* Cabecalho da aplicacao: marca maior, com um brilho suave atras. */}
      <div className="relative flex h-24 shrink-0 items-center gap-3.5 overflow-hidden border-b border-slate-200/80 px-5 dark:border-slate-800/80">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_80%_90%_at_0%_0%,rgba(99,102,241,0.14),transparent)] dark:bg-[radial-gradient(ellipse_80%_90%_at_0%_0%,rgba(99,102,241,0.22),transparent)]" />
        <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30 ring-1 ring-inset ring-white/20">
          <Laptop className="h-6 w-6 text-white" />
        </div>
        <div className="relative min-w-0 leading-tight">
          <p className="bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-2xl font-bold tracking-tight text-transparent dark:from-white dark:to-indigo-200">
            Notrole
          </p>
          <p className="mt-0.5 truncate text-xs font-medium text-slate-500 dark:text-slate-400">Estoque de TI</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
          Menu
        </p>
        <nav className="space-y-0.5">
          {MENU.map((item) => {
            const Icone = item.icon;
            const ativo = currentTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setCurrentTab(item.id)}
                aria-current={ativo ? 'page' : undefined}
                className={cn(
                  'group relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  ativo
                    ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/10 dark:text-indigo-300'
                    : 'hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-900 dark:hover:text-slate-100',
                )}
              >
                {ativo && (
                  <span className="absolute inset-y-1.5 left-0 w-[3px] rounded-r-full bg-indigo-600 dark:bg-indigo-400" />
                )}
                <Icone
                  className={cn(
                    'h-[18px] w-[18px] transition-colors',
                    ativo
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-400 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300',
                  )}
                />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3 border-t border-slate-200/80 p-3 dark:border-slate-800/80">
        <div className="px-1">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            Tema
          </p>
          <ThemeToggle />
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-slate-50 p-2.5 dark:bg-slate-900/70">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-indigo-500 to-violet-600 text-xs font-semibold text-white">
            {usuario ? iniciais(usuario.nome) : '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
              {usuario?.nome ?? 'Convidado'}
            </p>
            <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {perfil ? (perfil.admin ? 'Administrador' : `Analista${perfil.empresa ? ` · ${perfil.empresa}` : ''}`) : (usuario?.email ?? '')}
            </p>
          </div>
          <button
            onClick={sair}
            title="Sair"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-400"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
