import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { EventType, type AuthenticationResult } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';
import App from './App';
import './index.css';
import { msalInstance } from './lib/msal';

/**
 * Inicializacao do MSAL.
 *
 * A versao anterior so chamava `initialize()`. Faltava tratar o retorno do
 * redirect e definir a conta ativa: ao voltar do login da Microsoft o app
 * podia renderizar antes do MSAL processar o hash da URL, e o usuario caia de
 * volta na tela de login.
 */
async function iniciar() {
  await msalInstance.initialize();

  const resultado = await msalInstance.handleRedirectPromise();
  if (resultado?.account) {
    msalInstance.setActiveAccount(resultado.account);
  } else if (!msalInstance.getActiveAccount()) {
    const [primeiraConta] = msalInstance.getAllAccounts();
    if (primeiraConta) msalInstance.setActiveAccount(primeiraConta);
  }

  msalInstance.addEventCallback((evento) => {
    if (evento.eventType === EventType.LOGIN_SUCCESS && evento.payload) {
      const payload = evento.payload as AuthenticationResult;
      if (payload.account) msalInstance.setActiveAccount(payload.account);
    }
  });

  const raiz = document.getElementById('root');
  if (!raiz) throw new Error('Elemento #root nao encontrado no index.html.');

  createRoot(raiz).render(
    <StrictMode>
      <MsalProvider instance={msalInstance}>
        <App />
      </MsalProvider>
    </StrictMode>,
  );
}

/**
 * Tela de falha na inicializacao.
 *
 * Mostra o erro real. A versao anterior exibia so uma frase generica, e um erro
 * de login devolvido pela Microsoft (que vem com codigo AADSTS e descricao)
 * ficava invisivel para quem precisava corrigi-lo.
 *
 * O texto vem da URL de retorno da Microsoft, entao e inserido com textContent,
 * nunca com innerHTML - senao um link malicioso poderia injetar HTML na pagina.
 */
function mostrarFalha(erro: unknown) {
  const raiz = document.getElementById('root');
  if (!raiz) return;

  const detalhes = erro as { errorCode?: string; errorMessage?: string; message?: string };
  const codigo = detalhes?.errorCode ?? '';
  const mensagem = detalhes?.errorMessage ?? detalhes?.message ?? String(erro);

  const caixa = document.createElement('div');
  caixa.style.cssText =
    'font-family:Segoe UI,Arial,sans-serif;max-width:720px;margin:4rem auto;padding:2rem;' +
    'border:1px solid #e2e8f0;border-radius:12px;color:#0f172a;background:#fff';

  const titulo = document.createElement('h1');
  titulo.style.cssText = 'font-size:1.4rem;margin:0 0 .75rem';
  titulo.textContent = 'Nao foi possivel entrar no Notrole';

  const explicacao = document.createElement('p');
  explicacao.style.cssText = 'color:#475569;margin:0 0 1rem';
  explicacao.textContent =
    'O login com a Microsoft retornou o erro abaixo. Envie esta tela para a equipe de TI.';

  const erroTexto = document.createElement('pre');
  erroTexto.style.cssText =
    'white-space:pre-wrap;word-break:break-word;background:#f1f5f9;padding:1rem;' +
    'border-radius:8px;font-size:.85rem;margin:0 0 1.25rem';
  erroTexto.textContent = (codigo ? `${codigo}\n\n` : '') + mensagem;

  // Limpa o estado do MSAL guardado na aba. Sem isso, uma interacao que ficou
  // pela metade continua travando as tentativas seguintes.
  const botao = document.createElement('button');
  botao.textContent = 'Limpar sessao e tentar novamente';
  botao.style.cssText =
    'background:#4f46e5;color:#fff;border:0;border-radius:8px;padding:.6rem 1.1rem;' +
    'font-size:.95rem;cursor:pointer';
  botao.onclick = () => {
    sessionStorage.clear();
    window.location.replace(window.location.origin);
  };

  caixa.append(titulo, explicacao, erroTexto, botao);
  raiz.replaceChildren(caixa);
}

void iniciar().catch((erro) => {
  console.error('[app] Falha ao inicializar:', erro);
  mostrarFalha(erro);
});
