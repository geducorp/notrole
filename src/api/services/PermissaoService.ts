import axios from 'axios';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { microsoftGraphService } from './MicrosoftGraphService';
import { empresaService } from './EmpresaService';

/**
 * Quem pode ver e mexer em qual estoque.
 *
 * Regra (decisao do dono do produto, 13/10/2026): cada ANALISTA ve e
 * movimenta so os dados da propria empresa - estoque,
 * cessoes, colaboradores atendidos, extrato, relatorios e dashboard. O
 * ADMINISTRADOR ve e movimenta tudo, escolhe a empresa no filtro das telas e
 * cadastra categorias. Antes o analista enxergava todas as empresas e so
 * movimentava a dele.
 *
 * A empresa do analista vem do campo "Empresa" do perfil dele no AD - o mesmo
 * que ja decide em nome de quem sai o termo de comodato. Nao existe cadastro
 * de usuario no Notrole, e ninguem precisa configurar nada por pessoa.
 *
 * Analista sem empresa (campo vazio no AD, texto que nao bate com nenhuma
 * empresa, ou o Graph falhou na consulta): o sistema FECHA. Toda rota de
 * negocio responde 403 SEM_EMPRESA (middlewares/permissao.ts), e so o /me
 * continua respondendo, para a tela explicar o que fazer. Quando a falha e do
 * Graph o resultado nao vai para o cache, entao a proxima requisicao tenta de
 * novo.
 *
 * Os filtros das listagens usam `empresaDoFiltro` (o analista nunca escolhe
 * empresa: a dele e imposta, seja qual for o empresaId que vier na query) e
 * os detalhes usam `exigirVisivel`.
 */

export const MENSAGEM_SEM_EMPRESA =
  'Sua conta não tem a empresa preenchida no AD (campo Empresa), então o Notrole não sabe ' +
  'qual estoque mostrar. Peça à infraestrutura para preencher e entre de novo.';

export interface UsuarioComPermissao {
  email: string;
  admin: boolean;
  empresaId: number | null;
}

interface Cache {
  valor: UsuarioComPermissao;
  expiraEm: number;
}

const TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, Cache>();
// Ultimo perfil montado sem falha, mesmo vencido: com o Graph oscilando, vale
// mais do que transformar o analista em "sem empresa" (e travar a tela dele).
const ultimoBom = new Map<string, UsuarioComPermissao>();
// Chave = o objeto req.usuario, que e um por requisicao: some com ela.
const porRequisicao = new WeakMap<object, Promise<UsuarioComPermissao>>();

export class PermissaoService {
  /** Resolve perfil e empresa de quem esta logado, com cache curto. */
  async doUsuario(usuario?: { id: string; email: string; grupos: string[] }): Promise<UsuarioComPermissao> {
    if (!usuario) throw new AppError('Nao autenticado.', 401, 'SEM_TOKEN');

    // A mesma requisicao pergunta mais de uma vez (middleware de empresa e o
    // controller). Sem isto, com o Graph falhando (resultado fora do cache),
    // cada pergunta ia ao Graph de novo.
    const daRequisicao = porRequisicao.get(usuario);
    if (daRequisicao) return daRequisicao;
    const resolvendo = this.resolver(usuario);
    porRequisicao.set(usuario, resolvendo);
    resolvendo.catch(() => porRequisicao.delete(usuario));
    return resolvendo;
  }

  private async resolver(usuario: { id: string; email: string; grupos: string[] }): Promise<UsuarioComPermissao> {
    const emCache = cache.get(usuario.email);
    if (emCache && emCache.expiraEm > Date.now()) return emCache.valor;

    const admin = await this.ehAdministrador(usuario);
    const empresa = await this.empresaDoUsuario(usuario.email);
    const valor: UsuarioComPermissao = {
      email: usuario.email,
      admin: admin.valor,
      empresaId: empresa.valor,
    };

    // Resultado montado com falha de consulta vale so para esta requisicao: em
    // cache, uma oscilacao do Graph tiraria o perfil de admin (ou a trava de
    // empresa) por 10 minutos.
    if (admin.confiavel && empresa.confiavel) {
      cache.set(usuario.email, { valor, expiraEm: Date.now() + TTL_MS });
      ultimoBom.set(usuario.email, valor);
      return valor;
    }

    // Consulta falhou: usa o ultimo perfil bom. Sem nenhum, so devolve o valor
    // parcial se ele nao for "sem empresa" - senao uma falha passageira viraria
    // a tela "peca a infraestrutura para preencher o AD", que nao e verdade.
    const anterior = ultimoBom.get(usuario.email);
    if (anterior) {
      console.warn(`[permissao] ${usuario.email}: falha ao consultar o Graph; usando o ultimo perfil conhecido.`);
      return anterior;
    }
    if (this.semEmpresa(valor)) {
      throw new AppError(
        'Não consegui confirmar seu perfil na Microsoft agora. Tente de novo em instantes.',
        503,
        'PERFIL_INDISPONIVEL',
      );
    }
    return valor;
  }

  /** Analista cuja empresa nao foi descoberta: nao ve nem mexe em nada. */
  semEmpresa(permissao: UsuarioComPermissao): boolean {
    return !permissao.admin && permissao.empresaId === null;
  }

  /** 403 SEM_EMPRESA para o analista sem empresa (ver o cabecalho). */
  exigirEmpresaDefinida(permissao: UsuarioComPermissao) {
    if (this.semEmpresa(permissao)) throw new AppError(MENSAGEM_SEM_EMPRESA, 403, 'SEM_EMPRESA');
  }

  /**
   * Empresa cujos dados quem esta logado pode ver: undefined = todas
   * (administrador); para o analista, a empresa dele.
   */
  empresaVisivel(permissao: UsuarioComPermissao): number | undefined {
    if (permissao.admin) return undefined;
    this.exigirEmpresaDefinida(permissao);
    return permissao.empresaId ?? undefined;
  }

  /**
   * Empresa a usar no filtro de uma listagem. O administrador escolhe (ou
   * nenhuma = todas); o analista sempre ve a dele, e o empresaId que vier na
   * query e ignorado.
   */
  empresaDoFiltro(permissao: UsuarioComPermissao, pedida?: number | null): number | undefined {
    if (permissao.admin) return pedida ?? undefined;
    return this.empresaVisivel(permissao);
  }

  /** Recusa abrir um registro (equipamento, cessao) de outra empresa. */
  exigirVisivel(permissao: UsuarioComPermissao, empresaId: number, oQue = 'este registro') {
    const visivel = this.empresaVisivel(permissao);
    if (visivel === undefined || visivel === empresaId) return;

    throw new AppError(
      `Voce so pode ver dados do estoque da sua empresa, e ${oQue} e de outra empresa.`,
      403,
      'OUTRA_EMPRESA',
    );
  }

  /** Recusa a acao quando o equipamento e de outra empresa. */
  exigirEmpresa(permissao: UsuarioComPermissao, empresaId: number, acao = 'mexer neste equipamento') {
    if (permissao.admin) return;
    // Sem empresa o analista nao chega aqui (middleware); se chegar, fecha.
    this.exigirEmpresaDefinida(permissao);
    if (permissao.empresaId === empresaId) return;

    throw new AppError(
      `Voce so pode ${acao} do estoque da sua empresa. ` +
        'Para mexer no estoque de outra unidade, peca ao analista dela ou a um administrador.',
      403,
      'OUTRA_EMPRESA',
    );
  }

  /** Cadastros que valem para o grupo todo (categorias). */
  exigirAdministrador(permissao: UsuarioComPermissao, acao = 'fazer isso') {
    if (permissao.admin) return;
    if (!env.grupoAdministradoresId) return; // Sem grupo configurado, todos podem.

    throw new AppError(
      `So um administrador do Notrole pode ${acao}.`,
      403,
      'SO_ADMINISTRADOR',
    );
  }

  /** Limpa o cache (usado quando as empresas mudam de configuracao). */
  esquecer() {
    cache.clear();
    ultimoBom.clear();
  }

  /** `confiavel` falso = a consulta falhou e o valor e so o padrao seguro. */
  private async ehAdministrador(
    usuario: { id: string; grupos: string[] },
  ): Promise<{ valor: boolean; confiavel: boolean }> {
    const grupo = env.grupoAdministradoresId;
    // Sem grupo configurado, o sistema segue como antes.
    if (!grupo) return { valor: true, confiavel: true };
    if (usuario.grupos.includes(grupo)) return { valor: true, confiavel: true };

    try {
      return {
        valor: await microsoftGraphService.usuarioPertenceAoGrupo(usuario.id, grupo),
        confiavel: true,
      };
    } catch (erro) {
      console.warn('[permissao] Nao consegui conferir o grupo de administradores:', erro);
      return { valor: false, confiavel: false };
    }
  }

  /** Empresa do Notrole correspondente ao campo "Empresa" do AD. */
  private async empresaDoUsuario(email: string): Promise<{ valor: number | null; confiavel: boolean }> {
    if (!email) return { valor: null, confiavel: true };

    try {
      const token = await this.tokenDoGraph();
      const url =
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(email)}` +
        '?$select=companyName,displayName';

      const resposta = await axios.get(url, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10_000,
      });

      const empresaAD = (resposta.data?.companyName as string | null) ?? null;
      if (!empresaAD) {
        console.warn(`[permissao] ${email} esta sem "Empresa" no AD; sem acesso aos dados ate preencher.`);
        return { valor: null, confiavel: true };
      }

      // Sem cair na empresa padrao: texto que nao bate com nenhuma empresa e
      // tratado como campo vazio (sem acesso), nao como "e da padrao".
      const empresa = await empresaService.identificarSemPadrao(empresaAD);
      if (!empresa) {
        console.warn(
          `[permissao] ${email}: "Empresa" do AD ("${empresaAD}") nao corresponde a nenhuma empresa; sem acesso aos dados.`,
        );
        return { valor: null, confiavel: true };
      }
      return { valor: empresa.id, confiavel: true };
    } catch (erro) {
      console.warn(`[permissao] Nao consegui descobrir a empresa de ${email}:`, erro);
      return { valor: null, confiavel: false };
    }
  }

  /** O token de aplicativo do Graph vive no MicrosoftGraphService. */
  private async tokenDoGraph(): Promise<string> {
    const servico = microsoftGraphService as unknown as { obterToken(): Promise<string> };
    return servico.obterToken();
  }
}

export const permissaoService = new PermissaoService();
