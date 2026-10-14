import React, { createContext, useContext, useEffect, useState } from 'react';
import { useMsal } from '@azure/msal-react';
import { toast } from 'sonner';
import { escopoDeLogin } from '@/lib/msal';
import type { Usuario } from '@/types';

/**
 * Contexto de autenticacao.
 *
 * O campo `role: 'admin'` era fixo no codigo. Como a tela de Configuracoes so
 * mostrava a gestao de acesso para `role === 'owner'`, aquele bloco nunca
 * aparecia - e ainda assim cadastrava administradores com senha em texto puro
 * no localStorage. A permissao agora e decidida no backend, pelo grupo do
 * Entra ID, entao nao existe mais papel no frontend.
 */
interface ContextoAuth {
  usuario: Usuario | null;
  entrar: () => Promise<boolean>;
  sair: () => void;
  carregando: boolean;
}

const AuthContext = createContext<ContextoAuth | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { instance, accounts, inProgress } = useMsal();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (inProgress !== 'none') return;

    const conta = accounts[0];

    if (conta) {
      setUsuario({
        id: conta.localAccountId,
        email: conta.username,
        nome: conta.name ?? conta.username,
      });
    } else {
      setUsuario(null);
    }

    setCarregando(false);
  }, [inProgress, accounts]);

  /**
   * Abre o login da Microsoft. Se o redirect falhar, avisa e devolve `false`
   * para a tela de login liberar o botao de novo.
   */
  const entrar = async (): Promise<boolean> => {
    try {
      await instance.loginRedirect({ scopes: escopoDeLogin });
      return true;
    } catch (erro) {
      console.error('[auth] Falha no login SSO:', erro);
      toast.error('Não foi possível abrir o login da Microsoft.', {
        description: 'Tente de novo. Se continuar, recarregue a página.',
      });
      return false;
    }
  };

  const sair = () => {
    instance.logoutRedirect().catch((erro) => console.error('[auth] Falha ao sair:', erro));
  };

  return (
    <AuthContext.Provider value={{ usuario, entrar, sair, carregando }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): ContextoAuth {
  const contexto = useContext(AuthContext);
  if (!contexto) throw new Error('useAuth precisa estar dentro de um AuthProvider.');
  return contexto;
}
