import { PublicClientApplication, type Configuration } from '@azure/msal-browser';

/**
 * Configuracao do login com a conta Microsoft.
 *
 * O tenant e o client id estavam escritos no codigo como valor padrao. Agora
 * vem do .env em tempo de build; sem eles o app avisa em vez de tentar logar
 * num tenant errado.
 */
const clientId = import.meta.env.VITE_AZURE_CLIENT_ID;
const tenantId = import.meta.env.VITE_AZURE_TENANT_ID;

if (!clientId || !tenantId) {
  console.error(
    '[msal] VITE_AZURE_CLIENT_ID e VITE_AZURE_TENANT_ID precisam estar definidos no .env ' +
      'antes do build. O login nao vai funcionar sem eles.',
  );
}

export const msalConfig: Configuration = {
  auth: {
    clientId: clientId ?? '',
    authority: `https://login.microsoftonline.com/${tenantId ?? 'common'}`,
    // Precisa bater exatamente com o Redirect URI (SPA) do app registration.
    redirectUri: window.location.origin,
  },
  cache: {
    cacheLocation: 'sessionStorage',
  },
};

/**
 * Scope usado para falar com a API do Notrole.
 *
 * O correto e expor um scope proprio no app registration
 * (Expor uma API > Adicionar escopo > access_as_user) e pedir o access token
 * dele. A versao anterior mandava o `idToken` para a API - que ate valida,
 * porque o audience do id token e o proprio client id, mas nao e para isso que
 * ele serve e nao carrega permissao nenhuma.
 *
 * Enquanto o scope nao estiver criado no portal, VITE_AZURE_API_SCOPE fica
 * vazio e o app continua usando o id token, como antes.
 */
export const API_SCOPE = import.meta.env.VITE_AZURE_API_SCOPE ?? '';

/**
 * O login ja pede o scope da API.
 *
 * Antes o login pedia User.Read (Microsoft Graph) e o token da API era buscado
 * depois, a cada requisicao. Como sao recursos diferentes, essa segunda busca
 * podia exigir consentimento ou nova interacao - e o app entrava num loop de
 * "escolha a conta". Pedindo o scope da API ja no login, o consentimento (se
 * houver) acontece uma vez so, ali, e o token fica em cache.
 *
 * O frontend nunca chama o Graph diretamente (quem consulta o AD e o backend,
 * com permissao de aplicativo), entao User.Read nao faz falta aqui.
 */
export const escopoDeLogin = API_SCOPE ? [API_SCOPE] : ['User.Read'];

export const escoposDaApi = escopoDeLogin;

export const msalInstance = new PublicClientApplication(msalConfig);
