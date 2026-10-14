import * as msal from '@azure/msal-node';
import axios from 'axios';
import { env } from '../config/env';

export interface UsuarioAD {
  idAD: string;
  nome: string;
  email: string;
  departamento: string;
  cargo: string;
  /** Campo "Empresa" do perfil (companyName). Define a empresa do termo. */
  empresa: string;
}

/**
 * Integracao com o Microsoft Graph (busca de colaboradores no AD e conferencia
 * de grupo).
 *
 * Dois problemas graves foram corrigidos aqui:
 *
 * 1. O clientSecret estava escrito em texto puro no codigo-fonte. Agora vem do
 *    .env. O segredo que estava versionado deve ser revogado no portal.
 *
 * 2. O cliente MSAL era construido no topo do modulo, e o controller importava
 *    o servico no topo tambem. Com o segredo invalido, o `new
 *    ConfidentialClientApplication` lancava ClientAuthError durante o import e
 *    derrubava o processo inteiro - a API entrava em crash-loop no boot, como
 *    se via no log do PM2. A construcao agora e preguicosa e o erro fica
 *    contido na funcionalidade que depende dele.
 */
export class MicrosoftGraphService {
  private cliente: msal.ConfidentialClientApplication | null = null;
  private tokenEmCache: { valor: string; expiraEm: number } | null = null;

  private obterCliente(): msal.ConfidentialClientApplication {
    if (!this.cliente) {
      this.cliente = new msal.ConfidentialClientApplication({
        auth: {
          clientId: env.AZURE_CLIENT_ID,
          authority: `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}`,
          clientSecret: env.AZURE_CLIENT_SECRET,
        },
      });
    }
    return this.cliente;
  }

  private async obterToken(): Promise<string> {
    if (this.tokenEmCache && this.tokenEmCache.expiraEm > Date.now() + 60_000) {
      return this.tokenEmCache.valor;
    }

    const resposta = await this.obterCliente().acquireTokenByClientCredential({
      scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!resposta?.accessToken) {
      throw new Error('O Azure AD nao retornou um token de aplicacao.');
    }

    this.tokenEmCache = {
      valor: resposta.accessToken,
      expiraEm: resposta.expiresOn?.getTime() ?? Date.now() + 5 * 60_000,
    };

    return resposta.accessToken;
  }

  /** Em OData, aspa simples se escapa duplicando. Sem isso a busca e injetavel. */
  private escaparOData(valor: string): string {
    return valor.replace(/'/g, "''");
  }

  async buscarUsuarios(termo: string): Promise<UsuarioAD[]> {
    if (!termo || termo.trim().length < 3) return [];

    const filtro = this.escaparOData(termo.trim());
    const token = await this.obterToken();

    const url =
      'https://graph.microsoft.com/v1.0/users' +
      `?$filter=startswith(displayName,'${filtro}') or startswith(userPrincipalName,'${filtro}')` +
      '&$select=id,displayName,userPrincipalName,mail,department,jobTitle,companyName' +
      '&$top=15';

    const resposta = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
    });

    const usuarios = (resposta.data?.value ?? []) as Array<Record<string, string | null>>;

    return usuarios.map((u) => ({
      idAD: u.id ?? '',
      nome: u.displayName ?? '',
      email: (u.mail ?? u.userPrincipalName ?? '').toLowerCase(),
      departamento: u.department ?? '',
      cargo: u.jobTitle ?? '',
      empresa: u.companyName ?? '',
    }));
  }

  /**
   * Confere a associacao a um grupo pelo Graph.
   *
   * Usado quando a claim `groups` nao vem no token - o Entra ID a omite se o
   * app registration nao estiver configurado para emiti-la, ou se o usuario
   * pertencer a grupos demais.
   *
   * Falha na consulta (Graph fora do ar, timeout) LANCA erro em vez de
   * devolver false: quem chama nega o acesso, mas sem guardar a negativa em
   * cache - senao uma oscilacao do Graph barrava o analista por 10 minutos.
   */
  async usuarioPertenceAoGrupo(idUsuario: string, idGrupo: string): Promise<boolean> {
    if (!idUsuario || !idGrupo) return false;

    try {
      const token = await this.obterToken();
      const resposta = await axios.post(
        `https://graph.microsoft.com/v1.0/users/${idUsuario}/checkMemberGroups`,
        { groupIds: [idGrupo] },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
      );

      return ((resposta.data?.value ?? []) as string[]).includes(idGrupo);
    } catch (erro) {
      const detalhe = axios.isAxiosError(erro)
        ? JSON.stringify(erro.response?.data ?? erro.message)
        : String(erro);
      console.error(`[graph] Falha ao conferir grupo do usuario ${idUsuario}: ${detalhe}`);
      // Na duvida, quem chama nega. Um erro de integracao nao pode virar porta
      // aberta - nem negativa guardada em cache.
      throw new Error(`Falha ao conferir o grupo no Microsoft Graph: ${detalhe.slice(0, 200)}`);
    }
  }
}

export const microsoftGraphService = new MicrosoftGraphService();
