import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { colaboradorRepository } from '../repositories/ColaboradorRepository';
import { emprestimoRepository } from '../repositories/EmprestimoRepository';
import { microsoftGraphService } from '../services/MicrosoftGraphService';
import { permissaoService, type UsuarioComPermissao } from '../services/PermissaoService';
import { AppError } from '../utils/AppError';
import { cpfValido, formatarCpf } from '../utils/documentos';
import { idParamSchema } from './ItemController';

const buscaSchema = z.object({
  busca: z.string().trim().max(120).optional(),
});

const cadastroSchema = z.object({
  email: z.string().trim().toLowerCase().email('E-mail invalido.'),
  idAD: z.string().trim().max(64).optional(),
});

const buscaADSchema = z.object({
  q: z.string().trim().min(3, 'A busca precisa ter pelo menos 3 caracteres.').max(120),
});

const atualizarSchema = z.object({
  cpf: z
    .string()
    .trim()
    .max(20)
    .nullish()
    .refine((cpf) => !cpf || cpfValido(cpf), 'CPF invalido - confira os digitos.')
    .transform((cpf) => (cpf ? formatarCpf(cpf) : cpf)),
  endereco: z
    .string()
    .trim()
    .max(300)
    .nullish()
    .refine((e) => !e || e.length >= 10, 'Informe o endereco completo.'),
  departamento: z.string().trim().max(120).nullish(),
  cargo: z.string().trim().max(120).nullish(),
  ativo: z.boolean().optional(),
});

/**
 * Colaborador nao tem empresa. O analista ve os colaboradores atendidos pela
 * empresa dele (cessao, equipamento ou periferico de la) e, de cada um, so as
 * cessoes da empresa dele. O administrador ve todos.
 */
async function exigirColaboradorVisivel(id: number, permissao: UsuarioComPermissao) {
  const empresaId = permissaoService.empresaVisivel(permissao);
  if (empresaId === undefined) return;
  if (await colaboradorRepository.atendidoPor(id, empresaId)) return;
  throw new AppError(
    'Este colaborador nao tem equipamento nem historico no estoque da sua empresa.',
    403,
    'OUTRA_EMPRESA',
  );
}

export class ColaboradorController {
  async listar(req: Request, res: Response, next: NextFunction) {
    try {
      const { busca } = buscaSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      res.json(await colaboradorRepository.listar(busca, permissaoService.empresaVisivel(permissao)));
    } catch (erro) {
      next(erro);
    }
  }

  async buscarPorId(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const colaborador = await colaboradorRepository.buscarPorId(id);
      if (!colaborador) throw AppError.naoEncontrado('Colaborador');

      const permissao = await permissaoService.doUsuario(req.usuario);
      await exigirColaboradorVisivel(id, permissao);
      const emprestimos = await emprestimoRepository.listar({
        colaboradorId: id,
        empresaId: permissaoService.empresaVisivel(permissao),
      });
      res.json({ ...colaborador, emprestimos });
    } catch (erro) {
      next(erro);
    }
  }

  /**
   * Cadastro de quem foi escolhido no AD, para o formulario de cessao
   * preencher CPF e endereco. Vale para qualquer pessoa, de qualquer empresa:
   * um colaborador da outra unidade pode receber equipamento desta. Por isso a
   * busca e exata (nao lista ninguem por trecho) e devolve so o necessario; as
   * cessoes anteriores vem filtradas pela empresa de quem pergunta.
   */
  async buscarParaCessao(req: Request, res: Response, next: NextFunction) {
    try {
      const { email, idAD } = cadastroSchema.parse(req.query);
      const permissao = await permissaoService.doUsuario(req.usuario);
      const cadastro = await colaboradorRepository.buscarParaCessao(email, idAD);
      if (!cadastro) {
        res.json(null);
        return;
      }
      const emprestimos = await emprestimoRepository.listar({
        colaboradorId: cadastro.id,
        empresaId: permissaoService.empresaVisivel(permissao),
      });
      res.json({ ...cadastro, emprestimos });
    } catch (erro) {
      next(erro);
    }
  }

  async atualizar(req: Request, res: Response, next: NextFunction) {
    try {
      const { id } = idParamSchema.parse(req.params);
      const dados = atualizarSchema.parse(req.body);
      await exigirColaboradorVisivel(id, await permissaoService.doUsuario(req.usuario));

      // CPF e unico: mensagem clara em vez do erro generico do banco.
      if (dados.cpf) {
        const dono = await colaboradorRepository.buscarPorCpf(dados.cpf);
        if (dono && dono.id !== id) {
          throw new AppError(
            `O CPF ${dados.cpf} ja esta cadastrado para ${dono.nome} (${dono.email}).`,
            409,
            'CPF_DE_OUTRO_COLABORADOR',
          );
        }
      }

      res.json(await colaboradorRepository.atualizar(id, dados));
    } catch (erro) {
      next(erro);
    }
  }

  /**
   * Busca no Active Directory via Microsoft Graph.
   *
   * O controller antigo devolvia 500 generico. Como a causa mais comum e
   * credencial invalida do app registration - exatamente o que derrubava a API
   * antes -, agora essa situacao vem com uma mensagem que diz o que fazer.
   */
  async buscarNoAD(req: Request, res: Response, next: NextFunction) {
    try {
      const { q } = buscaADSchema.parse(req.query);
      res.json(await microsoftGraphService.buscarUsuarios(q));
    } catch (erro) {
      if (erro instanceof Error && /credential|client_secret|invalid_client/i.test(erro.message)) {
        next(
          new AppError(
            'Nao foi possivel consultar o Active Directory: as credenciais do aplicativo no ' +
              'Entra ID estao invalidas ou expiradas. Gere um novo client secret e atualize ' +
              'AZURE_CLIENT_SECRET no arquivo .env.',
            503,
            'AD_INDISPONIVEL',
          ),
        );
        return;
      }
      next(erro);
    }
  }
}

export const colaboradorController = new ColaboradorController();
