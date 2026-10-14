import type { RequestHandler } from 'express';
import { permissaoService } from '../services/PermissaoService';

/**
 * Rotas que mudam o comportamento do sistema para todo mundo (textos dos
 * e-mails, empresas, D4Sign, rotinas): so para o grupo de administradores do
 * AD. A tela ja esconde esses botoes; isto garante do lado do servidor.
 */
export function somenteAdministrador(acao: string): RequestHandler {
  return async (req, _res, next) => {
    try {
      const permissao = await permissaoService.doUsuario(req.usuario);
      permissaoService.exigirAdministrador(permissao, acao);
      next();
    } catch (erro) {
      next(erro);
    }
  };
}

/**
 * Analista sem empresa no AD nao ve nem mexe em nada (ver o cabecalho do
 * PermissaoService): 403 SEM_EMPRESA em toda rota de negocio. A tela troca a
 * pagina inteira por um aviso em vez de mostrar um erro por requisicao.
 *
 * Usado pelo `negocio` em routes/index.ts, depois da autenticacao. O /me fica
 * de fora de proposito: e por ele que a tela descobre o motivo.
 */
export const exigirEmpresaDoUsuario: RequestHandler = async (req, _res, next) => {
  try {
    permissaoService.exigirEmpresaDefinida(await permissaoService.doUsuario(req.usuario));
    next();
  } catch (erro) {
    next(erro);
  }
};
