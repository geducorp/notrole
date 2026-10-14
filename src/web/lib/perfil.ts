import { useEffect, useState } from 'react';
import { api, marcarSemEmpresa } from '@/lib/api';
import type { Perfil } from '@/types';

/**
 * Perfil de quem esta logado (administrador ou analista, e de qual empresa).
 * Buscado uma vez por sessao; as telas so usam para esconder o que a pessoa
 * nao pode fazer - quem garante e o servidor.
 */
let pedido: Promise<Perfil> | null = null;

export function carregarPerfil(): Promise<Perfil> {
  pedido ??= api
    .get<Perfil>('/me')
    .then(({ data }) => {
      // Sem empresa no AD: troca a tela inteira pelo aviso, antes de as
      // paginas pedirem dados que viriam todos com 403.
      if (data.semEmpresa) marcarSemEmpresa();
      return data;
    })
    .catch((erro) => {
      pedido = null;
      throw erro;
    });
  return pedido;
}

export function usePerfil(): Perfil | null {
  const [perfil, setPerfil] = useState<Perfil | null>(null);

  useEffect(() => {
    let ativo = true;
    carregarPerfil()
      .then((p) => ativo && setPerfil(p))
      .catch(() => undefined);
    return () => {
      ativo = false;
    };
  }, []);

  return perfil;
}
