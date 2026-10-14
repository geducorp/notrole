import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt, { type JwtHeader, type SigningKeyCallback } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { microsoftGraphService } from '../services/MicrosoftGraphService';

/**
 * Validacao do token do Entra ID.
 *
 * O que mudou em relacao a versao anterior:
 *  - tenant e client id vinham escritos no codigo; agora vem do .env;
 *  - em caso de falha o token INTEIRO era gravado em jwt-error.log, e o arquivo
 *    ficava no disco do servidor. Isso foi removido: registramos so o motivo;
 *  - havia um `fs.appendFileSync` de debug a cada inicializacao do cliente JWKS;
 *  - o middleware autenticava mas nao autorizava. Qualquer conta do tenant com
 *    um token valido podia apagar notebooks. Agora existe `exigirAcesso`.
 */

export interface UsuarioAutenticado {
  id: string;
  email: string;
  nome: string;
  grupos: string[];
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
    }
  }
}

const jwks = jwksClient({
  jwksUri: `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/discovery/v2.0/keys`,
  cache: true,
  cacheMaxAge: 12 * 60 * 60 * 1000,
  rateLimit: true,
});

function obterChave(header: JwtHeader, callback: SigningKeyCallback) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) return callback(err);
    callback(null, key?.getPublicKey());
  });
}

/**
 * O Entra ID emite tokens v1.0 (issuer sts.windows.net) e v2.0 conforme a
 * configuracao do app registration. Aceitamos os dois, e tambem o audience no
 * formato "api://<client-id>" usado quando a API expoe um scope proprio.
 */
const ISSUERS_ACEITOS: [string, ...string[]] = [
  `https://sts.windows.net/${env.AZURE_TENANT_ID}/`,
  `https://login.microsoftonline.com/${env.AZURE_TENANT_ID}/v2.0`,
];

const AUDIENCES_ACEITOS: [string, ...string[]] = [
  env.AZURE_CLIENT_ID,
  `api://${env.AZURE_CLIENT_ID}`,
];

function verificarToken(token: string): Promise<jwt.JwtPayload> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      obterChave,
      { audience: AUDIENCES_ACEITOS, issuer: ISSUERS_ACEITOS, algorithms: ['RS256'] },
      (erro, decodificado) => {
        if (erro) return reject(erro);
        if (!decodificado || typeof decodificado === 'string') {
          return reject(new Error('Payload do token em formato inesperado'));
        }
        resolve(decodificado);
      },
    );
  });
}

export async function autenticar(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      // Registrado de proposito: quando o frontend nao consegue obter o token,
      // a requisicao chega aqui sem cabecalho. Sem esta linha, o log do
      // servidor ficava limpo e o problema parecia estar em outro lugar.
      console.warn(`[auth] Requisicao sem token: ${req.method} ${req.originalUrl}`);
      throw new AppError('Token nao fornecido.', 401, 'SEM_TOKEN');
    }

    const token = header.slice('Bearer '.length).trim();
    if (!token) throw new AppError('Token mal formatado.', 401, 'TOKEN_INVALIDO');

    const payload = await verificarToken(token).catch((erro: Error) => {
      // Registramos apenas o motivo. O token e credencial e nao vai para log.
      console.warn(`[auth] Token rejeitado: ${erro.message}`);
      throw new AppError('Token invalido ou expirado.', 401, 'TOKEN_INVALIDO');
    });

    const email =
      (payload.preferred_username as string) ??
      (payload.upn as string) ??
      (payload.email as string) ??
      '';

    req.usuario = {
      id: (payload.oid as string) ?? (payload.sub as string) ?? '',
      email,
      nome: (payload.name as string) ?? email,
      grupos: Array.isArray(payload.groups) ? (payload.groups as string[]) : [],
    };

    next();
  } catch (erro) {
    next(erro);
  }
}

// Memoria curta para nao consultar o Graph a cada requisicao do mesmo usuario.
const cacheDeAcesso = new Map<string, { permitido: boolean; expiraEm: number }>();
const TTL_CACHE_MS = 10 * 60 * 1000;

/**
 * Exige que o usuario pertenca ao grupo de seguranca configurado.
 *
 * O Entra ID so inclui a claim `groups` no token se o app registration estiver
 * configurado para isso, e a omite quando o usuario pertence a muitos grupos.
 * Por isso, quando a claim nao resolve, confirmamos a associacao pelo Graph.
 */
export async function exigirAcesso(req: Request, _res: Response, next: NextFunction) {
  try {
    const usuario = req.usuario;
    if (!usuario) throw new AppError('Nao autenticado.', 401, 'SEM_TOKEN');

    const grupoId = env.grupoAutorizadoId;
    if (!grupoId) {
      // Sem grupo configurado o sistema fica aberto a todo o tenant. Avisamos
      // alto e claro para que isso nao passe despercebido em producao.
      if (env.ehProducao) {
        console.warn(
          '[auth] AZURE_GRUPO_AUTORIZADO_ID nao configurado: qualquer conta do tenant tem acesso total.',
        );
      }
      return next();
    }

    if (usuario.grupos.includes(grupoId)) return next();

    const cacheado = cacheDeAcesso.get(usuario.id);
    if (cacheado && cacheado.expiraEm > Date.now()) {
      if (cacheado.permitido) return next();
      throw AppError.naoAutorizado('Voce nao tem permissao para acessar o Notrole.');
    }

    let pertence: boolean;
    try {
      pertence = await microsoftGraphService.usuarioPertenceAoGrupo(usuario.id, grupoId);
    } catch {
      // Falha do Graph: nega ESTA requisicao, mas sem cache - a proxima tenta de novo.
      console.warn(`[auth] Acesso negado para ${usuario.email}: nao foi possivel conferir o grupo agora.`);
      throw AppError.naoAutorizado(
        'Nao foi possivel confirmar seu acesso ao Notrole agora. Tente novamente em instantes.',
      );
    }
    cacheDeAcesso.set(usuario.id, { permitido: pertence, expiraEm: Date.now() + TTL_CACHE_MS });

    if (!pertence) {
      console.warn(`[auth] Acesso negado para ${usuario.email}: fora do grupo autorizado.`);
      throw AppError.naoAutorizado('Voce nao tem permissao para acessar o Notrole.');
    }

    next();
  } catch (erro) {
    next(erro);
  }
}

/**
 * Atalho usado nas rotas: autentica e, em seguida, confere o grupo.
 *
 * E um unico middleware em vez de um array porque o Express perde a inferencia
 * de tipos de req/res quando se mistura array e funcao na mesma chamada.
 */
export const protegido: RequestHandler = (req, res, next) => {
  void autenticar(req, res, (erro?: unknown) => {
    if (erro) return next(erro);
    void exigirAcesso(req, res, next);
  });
};
