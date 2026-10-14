import axios, { AxiosError } from 'axios';
import { InteractionRequiredAuthError } from '@azure/msal-browser';
import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { API_SCOPE, escoposDaApi, msalInstance } from './msal';

declare module 'axios' {
  interface AxiosRequestConfig {
    /**
     * Nao mostrar o toast de erro desta requisicao: a tela junta as falhas e
     * mostra um aviso so (ex.: Configuracoes, que carrega quatro coisas).
     */
    silencioso?: boolean;
  }
}

/** Formato de erro que a API passa a devolver sempre. */
interface ErroDaApi {
  mensagem?: string;
  codigo?: string;
  referencia?: string;
  campos?: Array<{ campo: string; erro: string }>;
}

export const api = axios.create({
  // Em producao o proprio Express serve o frontend, entao caminho relativo
  // basta. Em desenvolvimento o Vite faz proxy de /api para a porta 3333.
  baseURL: import.meta.env.VITE_API_URL || '/api',
  headers: { 'Content-Type': 'application/json' },
  timeout: 30_000,
});

/**
 * Garante que so UM redirecionamento para a Microsoft aconteca por vez.
 *
 * As telas disparam varias requisicoes em paralelo (Configuracoes faz quatro de
 * uma vez). Sem esta trava, cada uma que precisasse de interacao chamava o seu
 * proprio redirect; o MSAL recusava as seguintes com "interaction_in_progress",
 * essas seguiam sem token, voltavam 401 - e o app entrava em loop.
 */
let redirecionando = false;

function redirecionarParaLogin() {
  if (redirecionando) return;
  redirecionando = true;
  void msalInstance.acquireTokenRedirect({ scopes: escoposDaApi }).catch((erro) => {
    redirecionando = false;
    console.error('[api] Falha ao redirecionar para o login:', erro);
    toast.error('Não foi possível abrir o login da Microsoft.', {
      id: 'erro-redirect-login',
      description: 'Recarregue a página e tente de novo.',
    });
  });
}

/**
 * Erro de autenticacao que ja foi mostrado ao usuario (com toast proprio). O
 * interceptor de resposta deixa passar sem exibir outro aviso.
 */
export class ErroDeSessao extends Error {}

export const MENSAGEM_SESSAO_EXPIRADA =
  'Sua sessão expirou. Clique em Entrar novamente — seus dados continuam no formulário.';

// Um unico aviso de sessao por vez, em vez de um por requisicao.
let avisoDeSessaoAberto = false;

function avisarSessaoExpirada(mensagem: string) {
  if (avisoDeSessaoAberto) return;
  avisoDeSessaoAberto = true;
  toast.error(mensagem, {
    duration: Infinity,
    action: {
      label: 'Entrar novamente',
      onClick: () => {
        avisoDeSessaoAberto = false;
        redirecionarParaLogin();
      },
    },
    onDismiss: () => {
      avisoDeSessaoAberto = false;
    },
  });
}

// ---------------------------------------------------------------------------
// Acesso negado: conta valida, mas fora do grupo do AD autorizado. A API
// responde 403 com codigo NAO_AUTORIZADO em TODA rota; em vez de um toast por
// requisicao, o app troca a tela inteira por "Acesso negado".
// ---------------------------------------------------------------------------
let acessoNegado = false;
const ouvintesDoAcesso = new Set<() => void>();

function marcarAcessoNegado() {
  if (acessoNegado) return;
  acessoNegado = true;
  ouvintesDoAcesso.forEach((ouvinte) => ouvinte());
}

export function useAcessoNegado(): boolean {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintesDoAcesso.add(ouvinte);
      return () => ouvintesDoAcesso.delete(ouvinte);
    },
    () => acessoNegado,
  );
}

// ---------------------------------------------------------------------------
// Sem empresa: analista cujo campo "Empresa" do AD esta vazio ou nao bate com
// nenhuma empresa. A API responde 403 SEM_EMPRESA em toda rota de negocio (so
// o /me responde, com semEmpresa: true). Mesmo tratamento do acesso negado:
// uma tela inteira com o aviso, sem um toast por requisicao.
// ---------------------------------------------------------------------------
let semEmpresa = false;
const ouvintesDaEmpresa = new Set<() => void>();

export function marcarSemEmpresa() {
  if (semEmpresa) return;
  semEmpresa = true;
  ouvintesDaEmpresa.forEach((ouvinte) => ouvinte());
}

export function useSemEmpresa(): boolean {
  return useSyncExternalStore(
    (ouvinte) => {
      ouvintesDaEmpresa.add(ouvinte);
      return () => ouvintesDaEmpresa.delete(ouvinte);
    },
    () => semEmpresa,
  );
}

/** Segundos que faltam para o token vencer (pelo campo "exp" do JWT). */
function segundosAteVencer(token: string): number {
  try {
    const carga = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))) as {
      exp?: number;
    };
    return carga.exp ? carga.exp - Date.now() / 1000 : Infinity;
  } catch {
    return Infinity;
  }
}

/**
 * Token para a API.
 *
 * Sem scope proprio, a API recebe o id token. O MSAL decide se o cache ainda
 * vale olhando o access token do Graph - e devolvia o id token ja VENCIDO
 * quando a aba ficava aberta por mais de uma hora. A API recusava ("Token
 * invalido ou expirado"). Agora, se o id token vence em menos de 5 minutos,
 * pedimos um novo a Microsoft, sem interacao.
 */
async function obterToken(forcarRenovacao = false): Promise<string | null> {
  const conta = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0];
  if (!conta) return null;

  const pedir = (forceRefresh: boolean) =>
    msalInstance.acquireTokenSilent({ scopes: escoposDaApi, account: conta, forceRefresh });

  let resposta = await pedir(forcarRenovacao);
  let token = API_SCOPE ? resposta.accessToken : resposta.idToken;

  if (!forcarRenovacao && segundosAteVencer(token) < 300) {
    resposta = await pedir(true);
    token = API_SCOPE ? resposta.accessToken : resposta.idToken;
  }
  return token;
}

api.interceptors.request.use(async (config) => {
  try {
    const renovar = Boolean((config as { _renovarToken?: boolean })._renovarToken);
    const token = await obterToken(renovar);
    if (token) config.headers.Authorization = `Bearer ${token}`;
  } catch (erro) {
    const metodo = (config.method ?? 'get').toLowerCase();
    const leitura = metodo === 'get' || metodo === 'head';

    if (erro instanceof InteractionRequiredAuthError) {
      if (leitura) {
        // Leitura: nada a perder, pode ir direto para o login.
        redirecionarParaLogin();
        // Cancela esta requisicao: ela voltaria 401 de qualquer forma, e o
        // redirect ja esta a caminho.
        throw new axios.Cancel('Sessao precisa ser renovada; redirecionando para o login.');
      }
      // Gravacao: o redirect apagaria o que o operador digitou no formulario.
      // Avisa e deixa ele decidir quando sair da pagina.
      avisarSessaoExpirada(MENSAGEM_SESSAO_EXPIRADA);
      throw new ErroDeSessao(MENSAGEM_SESSAO_EXPIRADA);
    }

    // Outras falhas do MSAL (rede ate a Microsoft, configuracao): o usuario
    // precisa saber, senao so ve "sessao expirada" sem motivo.
    console.error('[api] Nao foi possivel obter o token:', erro);
    toast.error('Não foi possível confirmar sua sessão com a Microsoft.', {
      id: 'erro-msal',
      description: 'Verifique a conexão e tente de novo. Se continuar, clique em Sair e entre novamente.',
    });
    throw new ErroDeSessao('Nao foi possivel obter o token da Microsoft.');
  }

  return config;
});

/**
 * Mensagens de erro legiveis.
 *
 * O interceptor antigo montava a mensagem como `${data.message}: ${data.error}`
 * e exibia coisas como "undefined: Invalid `prisma.notebook.delete()`
 * invocation" para o operador.
 */
function descreverErro(erro: AxiosError<ErroDaApi>): string {
  if (erro.code === 'ECONNABORTED') return 'A requisicao demorou demais e foi cancelada.';
  if (!erro.response) return 'Nao foi possivel falar com o servidor. Verifique sua conexao.';

  const dados = erro.response.data;

  if (dados?.campos?.length) {
    return dados.campos.map((c) => `${c.campo}: ${c.erro}`).join(' | ');
  }

  if (dados?.mensagem) {
    return dados.referencia ? `${dados.mensagem} (ref. ${dados.referencia})` : dados.mensagem;
  }

  if (erro.response.status === 401) return 'Sua sessao expirou. Entre novamente.';
  if (erro.response.status === 403) return 'Voce nao tem permissao para esta acao.';

  return erro.message;
}

/**
 * Com `responseType: 'blob'` (downloads), o corpo do erro chega como Blob e a
 * mensagem da API se perdia. Converte de volta para o JSON de erro.
 */
async function lerErroEmBlob(erro: AxiosError<ErroDaApi>): Promise<void> {
  const resposta = erro.response;
  if (!resposta || !(resposta.data instanceof Blob)) return;
  try {
    const texto = await (resposta.data as Blob).text();
    resposta.data = JSON.parse(texto) as ErroDaApi;
  } catch {
    resposta.data = {} as ErroDaApi;
  }
}

/** A resposta foi um 409 (registro alterado por outra pessoa, situacao mudou)? */
export function ehConflito(erro: unknown): boolean {
  return axios.isAxiosError(erro) && erro.response?.status === 409;
}

api.interceptors.response.use(
  (resposta) => resposta,
  async (erro: AxiosError<ErroDaApi>) => {
    // Requisicao cancelada pelo proprio interceptor: o redirect ja esta em curso.
    if (axios.isCancel(erro)) return Promise.reject(erro);
    // Falha de sessao ja avisada pelo interceptor de requisicao.
    if (erro instanceof ErroDeSessao) return Promise.reject(erro);

    await lerErroEmBlob(erro);

    console.error('[api]', erro.response?.status, erro.config?.url, erro.response?.data ?? erro.message);

    /**
     * 401 NAO faz mais logout automatico.
     *
     * Era isso que alimentava o loop de "escolha a conta": qualquer falha ao
     * obter o token virava requisicao sem token, a API respondia 401, o app
     * chamava logoutRedirect, a Microsoft pedia a conta, o usuario entrava de
     * novo e tudo se repetia. Agora o usuario ve o aviso e decide.
     */
    if (erro.response?.status === 401) {
      // Primeiro 401 de uma requisicao: tenta de novo com um token recem-pedido
      // a Microsoft. So se falhar de novo o usuario ve o aviso.
      const original = erro.config as (typeof erro.config & { _renovarToken?: boolean }) | undefined;
      if (original && !original._renovarToken) {
        original._renovarToken = true;
        return api.request(original);
      }

      avisarSessaoExpirada(descreverErro(erro));
      return Promise.reject(erro);
    }

    // Fora do grupo do AD: troca a tela, sem um toast por requisicao. Os
    // outros 403 (outra empresa, so administrador) seguem com o toast.
    if (erro.response?.status === 403 && erro.response.data?.codigo === 'NAO_AUTORIZADO') {
      marcarAcessoNegado();
      return Promise.reject(erro);
    }
    // Sem empresa no AD: tambem troca a tela (ver marcarSemEmpresa).
    if (erro.response?.status === 403 && erro.response.data?.codigo === 'SEM_EMPRESA') {
      marcarSemEmpresa();
      return Promise.reject(erro);
    }

    if (!erro.config?.silencioso) toast.error(descreverErro(erro));
    return Promise.reject(erro);
  },
);

/**
 * O erro ja tem aviso proprio (sessao expirada, redirect em curso, acesso
 * negado ao Notrole)? A tela nao deve avisar de novo.
 */
export function erroJaAvisado(erro: unknown): boolean {
  if (erro instanceof ErroDeSessao || axios.isCancel(erro)) return true;
  if (!axios.isAxiosError(erro)) return false;
  const status = erro.response?.status;
  const codigo = (erro.response?.data as ErroDaApi | undefined)?.codigo;
  return status === 401 || (status === 403 && (codigo === 'NAO_AUTORIZADO' || codigo === 'SEM_EMPRESA'));
}

/** Mensagem legivel de qualquer erro vindo de `api` (para avisos montados pela tela). */
export function mensagemDeErro(erro: unknown): string {
  if (axios.isAxiosError(erro)) return descreverErro(erro as AxiosError<ErroDaApi>);
  return erro instanceof Error ? erro.message : String(erro);
}


/**
 * Baixa qualquer arquivo da API (PDF do relatorio, CSV do modelo de contagem).
 * Em erro, o interceptor ja converteu o corpo (Blob) para JSON e mostrou a
 * mensagem real da API.
 */
export async function baixarArquivo(caminho: string, nomeDoArquivo: string): Promise<void> {
  const resposta = await api.get(caminho, { responseType: 'blob' });

  const url = URL.createObjectURL(resposta.data as Blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nomeDoArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
