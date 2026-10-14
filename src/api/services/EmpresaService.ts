import type { Empresa, Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';

/** Normaliza para comparar sem se importar com maiusculas e acentos. */
function normalizar(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Empresas do grupo em nome das quais o termo de comodato e emitido.
 *
 * A empresa de cada emprestimo vem do campo "Empresa" do perfil do colaborador
 * no AD. Esse campo costuma ter grafias variadas - "Empresa Exemplo", "Empresa Exemplo -
 * Filial Norte", "empresa exemplo ltda" - entao a identificacao e
 * por palavra-chave (Empresa.termosAD), sem diferenciar maiusculas e acentos.
 * Quem esta sem empresa no AD fica com a
 * empresa marcada como padrao. O operador pode trocar no formulario.
 */
export class EmpresaService {
  listar(apenasAtivas = false) {
    return prisma.empresa.findMany({
      where: apenasAtivas ? { ativo: true } : undefined,
      orderBy: [{ padrao: 'desc' }, { apelido: 'asc' }],
    });
  }

  async buscarPorId(id: number): Promise<Empresa> {
    const empresa = await prisma.empresa.findUnique({ where: { id } });
    if (!empresa) throw AppError.naoEncontrado('Empresa');
    return empresa;
  }

  /** Empresa correspondente ao campo "Empresa" do AD, ou a padrao. */
  async identificar(empresaAD?: string | null): Promise<Empresa | null> {
    const empresas = await this.listar(true);
    if (empresas.length === 0) return null;

    return this.correspondente(empresas, empresaAD) ?? empresas.find((e) => e.padrao) ?? empresas[0] ?? null;
  }

  /**
   * So a empresa cujos termosAD batem com o texto do AD, sem cair na padrao.
   * Usado na permissao: cair na padrao prenderia o analista a uma empresa que
   * nao e a dele.
   */
  async identificarSemPadrao(empresaAD?: string | null): Promise<Empresa | null> {
    return this.correspondente(await this.listar(true), empresaAD);
  }

  private correspondente(empresas: Empresa[], empresaAD?: string | null): Empresa | null {
    if (!empresaAD?.trim()) return null;
    const alvo = normalizar(empresaAD);
    return (
      empresas.find((e) =>
        e.termosAD
          .split(',')
          .map(normalizar)
          .filter(Boolean)
          .some((termo) => alvo.includes(termo)),
      ) ?? null
    );
  }

  /** Cadastra uma empresa. Se vier como padrao, as outras deixam de ser. */
  async criar(dados: Prisma.EmpresaCreateInput) {
    if (dados.padrao === true) {
      return prisma.$transaction(async (tx) => {
        await tx.empresa.updateMany({ data: { padrao: false } });
        return tx.empresa.create({ data: dados });
      });
    }
    return prisma.empresa.create({ data: dados });
  }

  async atualizar(id: number, dados: Prisma.EmpresaUpdateInput) {
    await this.buscarPorId(id);

    // So pode haver uma padrao.
    if (dados.padrao === true) {
      return prisma.$transaction(async (tx) => {
        await tx.empresa.updateMany({ where: { id: { not: id } }, data: { padrao: false } });
        return tx.empresa.update({ where: { id }, data: dados });
      });
    }

    return prisma.empresa.update({ where: { id }, data: dados });
  }

  /** "Rua Exemplo, 100 - Centro, Cidade Exemplo" - o formato da sede no termo. */
  enderecoParaContrato(empresa: Empresa): string {
    return `${empresa.logradouro}, ${empresa.cidade}`;
  }
}

export const empresaService = new EmpresaService();
