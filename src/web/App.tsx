import { Component, useEffect, useState, type ErrorInfo, type ReactNode } from 'react';
import { Building2, CircleCheck, CircleX, Info, Loader2, RefreshCw, TriangleAlert } from 'lucide-react';
import { Toaster } from 'sonner';
import { Layout } from '@/components/layout/Layout';
import { ThemeProvider, useTheme } from '@/components/ThemeProvider';
import { AuthProvider, useAuth } from '@/components/AuthContext';
import { Dashboard } from '@/pages/Dashboard';
import { Estoque } from '@/pages/Estoque';
import { Loans } from '@/pages/Loans';
import { Collaborators } from '@/pages/Collaborators';
import { Settings } from '@/pages/Settings';
import { Login } from '@/pages/Login';
import { Button } from '@/components/ui/Button';
import { useAcessoNegado, useSemEmpresa } from '@/lib/api';
import { carregarPerfil } from '@/lib/perfil';

/**
 * Erro de renderizacao numa pagina nao pode derrubar o app inteiro (tela
 * branca). Mostra um aviso com "Recarregar"; a chave (a aba) zera o estado ao
 * trocar de aba.
 */
class LimiteDeErro extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state: { erro: Error | null } = { erro: null };

  static getDerivedStateFromError(erro: Error) {
    return { erro };
  }

  componentDidCatch(erro: Error, info: ErrorInfo) {
    console.error('[app] Erro ao exibir a pagina:', erro, info.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-200 p-10 text-center dark:border-slate-800">
        <TriangleAlert className="h-6 w-6 text-amber-500" />
        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
          Algo deu errado ao exibir esta tela.
        </p>
        <p className="max-w-md text-xs text-slate-500 dark:text-slate-400">
          Recarregue a página. Se o problema continuar, avise a TI informando o que você estava fazendo.
        </p>
        <Button type="button" variant="outline" onClick={() => window.location.reload()}>
          <RefreshCw className="mr-1.5 h-4 w-4" />
          Recarregar
        </Button>
      </div>
    );
  }
}

/** Conta valida, mas fora do grupo do AD que pode usar o Notrole. */
function AcessoNegado() {
  const { usuario, sair } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
        <CircleX className="mx-auto h-8 w-8 text-red-500" />
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Acesso negado</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Você não está no grupo autorizado do Notrole. Fale com a TI.
        </p>
        {usuario && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Conectado como {usuario.email}</p>
        )}
        <Button type="button" variant="outline" onClick={sair}>
          Sair e entrar com outra conta
        </Button>
      </div>
    </div>
  );
}

/**
 * Analista sem empresa no AD: o Notrole nao sabe qual estoque mostrar e a API
 * recusa os dados (403 SEM_EMPRESA). Em vez de telas vazias com um erro por
 * requisicao, um aviso so, com o que fazer.
 */
function SemEmpresa() {
  const { usuario, sair } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md space-y-4 rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-xl shadow-slate-900/5 dark:border-slate-800 dark:bg-slate-900">
        <Building2 className="mx-auto h-8 w-8 text-amber-500" />
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-50">Empresa não identificada</h1>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Sua conta não tem a empresa preenchida no AD (campo Empresa), então o Notrole não sabe qual
          estoque mostrar. Peça à infraestrutura para preencher e entre de novo.
        </p>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Depois de preenchido, pode levar alguns minutos para o Notrole reconhecer a mudança.
        </p>
        {usuario && (
          <p className="text-xs text-slate-500 dark:text-slate-400">Conectado como {usuario.email}</p>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Tentar de novo
          </Button>
          <Button type="button" variant="outline" onClick={sair}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  );
}

type Aba = 'dashboard' | 'estoque' | 'emprestimos' | 'entregas' | 'colaboradores' | 'configuracoes';

function Conteudo() {
  const [aba, setAba] = useState<Aba>('dashboard');
  const { usuario, carregando } = useAuth();
  const acessoNegado = useAcessoNegado();
  const semEmpresa = useSemEmpresa();
  // O perfil diz logo de cara se falta a empresa (ver lib/perfil.ts).
  const [perfilConferido, setPerfilConferido] = useState(false);

  useEffect(() => {
    if (!usuario) return;
    let ativo = true;
    carregarPerfil()
      .catch(() => undefined)
      .finally(() => ativo && setPerfilConferido(true));
    return () => {
      ativo = false;
    };
  }, [usuario]);

  if (carregando || (usuario && !perfilConferido && !acessoNegado)) {
    return (
      <div className="flex h-screen w-full items-center justify-center gap-2 bg-slate-50 text-sm text-slate-500 dark:bg-slate-950 dark:text-slate-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando...
      </div>
    );
  }

  if (!usuario) return <Login />;
  if (acessoNegado) return <AcessoNegado />;
  if (semEmpresa) return <SemEmpresa />;

  const paginas: Record<Aba, React.ReactNode> = {
    dashboard: <Dashboard />,
    estoque: <Estoque />,
    emprestimos: <Loans key="emprestimos" modalidade="TEMPORARIA" />,
    entregas: <Loans key="entregas" modalidade="DEFINITIVA" />,
    colaboradores: <Collaborators />,
    configuracoes: <Settings />,
  };

  return (
    <Layout currentTab={aba} setCurrentTab={(nova) => setAba(nova as Aba)}>
      <LimiteDeErro key={aba}>{paginas[aba]}</LimiteDeErro>
    </Layout>
  );
}

/**
 * Notificacoes (toasts) com o visual do sistema: cartao neutro com o icone
 * colorido, em vez dos blocos de cor chapada do padrao do sonner.
 */
function Notificacoes() {
  const { theme } = useTheme();
  const icone = (Icone: typeof CircleCheck, cor: string) => (
    <span className={`flex h-7 w-7 items-center justify-center rounded-full ${cor}`}>
      <Icone className="h-4 w-4" />
    </span>
  );

  return (
    <Toaster
      theme={theme}
      position="top-right"
      closeButton
      // Uma embaixo da outra, sem empilhar: empilhadas, o texto da de tras
      // aparecia por baixo da da frente.
      expand
      visibleToasts={4}
      gap={10}
      icons={{
        success: icone(CircleCheck, 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'),
        error: icone(CircleX, 'bg-red-500/10 text-red-600 dark:text-red-400'),
        warning: icone(TriangleAlert, 'bg-amber-500/10 text-amber-600 dark:text-amber-400'),
        info: icone(Info, 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400'),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group relative flex w-[360px] items-start gap-3 rounded-xl border border-slate-200/80 bg-white p-3.5 pr-9 font-sans shadow-lg shadow-slate-900/10 dark:border-slate-800 dark:bg-slate-900 dark:shadow-black/40',
          icon: 'mt-0.5 flex shrink-0 [&>*]:shrink-0',
          content: 'flex min-w-0 flex-1 flex-col gap-0.5 pt-1',
          title: 'text-sm font-medium leading-snug text-slate-900 dark:text-slate-50',
          description: 'text-xs leading-snug text-slate-500 dark:text-slate-400',
          closeButton:
            'absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200 [&>svg]:h-3.5 [&>svg]:w-3.5',
          actionButton:
            'rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500',
        },
      }}
    />
  );
}

export default function App() {
  return (
    <ThemeProvider defaultTheme="dark" storageKey="notrole-theme">
      <AuthProvider>
        <Conteudo />
        <Notificacoes />
      </AuthProvider>
    </ThemeProvider>
  );
}
