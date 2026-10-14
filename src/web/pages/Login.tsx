import { useState } from 'react';
import { Laptop } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { useAuth } from '@/components/AuthContext';

export function Login() {
  const [entrando, setEntrando] = useState(false);
  const { entrar } = useAuth();

  const acessar = async () => {
    setEntrando(true);
    const redirecionou = await entrar();
    // Se deu certo a pagina vai para a Microsoft; se falhou (o erro ja foi
    // avisado), libera o botao para tentar de novo.
    if (!redirecionou) setEntrando(false);
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-50 p-4 dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_50%_0%,rgba(99,102,241,0.15),transparent)]" />
      <div className="relative w-full max-w-md animate-subir">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-indigo-500/30">
            <Laptop className="h-6 w-6 text-white" />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">Notrole</h1>
          <p className="text-slate-500 dark:text-slate-400">
            Estoque de TI, empréstimos e entregas
          </p>
        </div>

        <Card className="shadow-xl shadow-slate-900/5 dark:shadow-black/30">
          <CardHeader className="space-y-1">
            <CardTitle className="text-center text-xl">Login corporativo</CardTitle>
            <CardDescription className="text-center">
              Acesse com a sua conta da Microsoft.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <Button
              variant="outline"
              className="h-11 w-full gap-2.5"
              onClick={acessar}
              disabled={entrando}
            >
              <svg viewBox="0 0 23 23" className="h-5 w-5" aria-hidden="true">
                <path fill="#f35325" d="M1 1h10v10H1z" />
                <path fill="#81bc06" d="M12 1h10v10H12z" />
                <path fill="#05a6f0" d="M1 12h10v10H1z" />
                <path fill="#ffba08" d="M12 12h10v10H12z" />
              </svg>
              {entrando ? 'Aguardando a Microsoft...' : 'Entrar com a conta Microsoft'}
            </Button>
          </CardContent>
        </Card>

        <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400">
          O acesso é restrito aos colaboradores autorizados da equipe de TI.
        </p>
      </div>
    </div>
  );
}
