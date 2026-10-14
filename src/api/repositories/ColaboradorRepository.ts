import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';

export class ColaboradorRepository {
  criar(data: Prisma.ColaboradorCreateInput) {
    return prisma.colaborador.create({ data });
  }

  /**
   * Colaborador nao tem empresa: ele e "da empresa X" quando teve cessao de um
   * equipamento dela, esta com um equipamento dela ou recebeu periferico do
   * estoque dela (saida de quantidade com colaborador).
   */
  private atendidoPelaEmpresa(empresaId: number): Prisma.ColaboradorWhereInput {
    return {
      OR: [
        { emprestimos: { some: { item: { empresaId } } } },
        { itens: { some: { empresaId } } },
        {
          movimentacoes: {
            some: { OR: [{ item: { empresaId } }, { itemQuantidade: { empresaId } }] },
          },
        },
      ],
    };
  }

  /** Sem empresa, todos; com empresa, so os atendidos por ela. */
  listar(busca?: string, empresaId?: number) {
    const filtros: Prisma.ColaboradorWhereInput[] = [];

    if (busca?.trim()) {
      const termo = busca.trim();
      filtros.push({
        OR: [
          { nome: { contains: termo, mode: 'insensitive' } },
          { email: { contains: termo, mode: 'insensitive' } },
          { departamento: { contains: termo, mode: 'insensitive' } },
        ],
      });
    }
    if (empresaId) filtros.push(this.atendidoPelaEmpresa(empresaId));

    return prisma.colaborador.findMany({
      where: filtros.length ? { AND: filtros } : {},
      orderBy: { nome: 'asc' },
      include: {
        _count: {
          select: { emprestimos: empresaId ? { where: { item: { empresaId } } } : true },
        },
      },
    });
  }

  buscarPorId(id: number) {
    return prisma.colaborador.findUnique({ where: { id } });
  }

  /** O colaborador foi atendido pela empresa (ver `atendidoPelaEmpresa`)? */
  async atendidoPor(id: number, empresaId: number): Promise<boolean> {
    const achado = await prisma.colaborador.findFirst({
      where: { id, ...this.atendidoPelaEmpresa(empresaId) },
      select: { id: true },
    });
    return achado !== null;
  }

  /**
   * Cadastro de uma pessoa escolhida no AD, para o formulario de cessao
   * preencher CPF e endereco. Busca exata (idAD, depois e-mail, depois a mesma
   * parte antes do @ em outro dominio, se for uma so), nunca por trecho.
   */
  async buscarParaCessao(email: string, idAD?: string | null) {
    const campos = {
      id: true,
      nome: true,
      email: true,
      idAD: true,
      cpf: true,
      endereco: true,
    } satisfies Prisma.ColaboradorSelect;

    if (idAD?.trim()) {
      const peloAD = await prisma.colaborador.findUnique({ where: { idAD: idAD.trim() }, select: campos });
      if (peloAD) return peloAD;
    }

    const emailNormalizado = email.trim().toLowerCase();
    const peloEmail = await prisma.colaborador.findUnique({ where: { email: emailNormalizado }, select: campos });
    if (peloEmail) return peloEmail;

    // Quem trocou de dominio de e-mail e ainda nao tem idAD
    // gravado fica com o e-mail antigo no cadastro.
    const usuario = emailNormalizado.split('@')[0];
    if (!usuario) return null;
    const mesmoUsuario = await prisma.colaborador.findMany({
      where: { email: { startsWith: `${usuario}@`, mode: 'insensitive' } },
      select: campos,
      take: 2,
    });
    return mesmoUsuario.length === 1 ? mesmoUsuario[0]! : null;
  }

  buscarPorEmail(email: string) {
    return prisma.colaborador.findUnique({ where: { email: email.toLowerCase() } });
  }

  buscarPorCpf(cpf: string) {
    return prisma.colaborador.findUnique({ where: { cpf } });
  }

  atualizar(id: number, data: Prisma.ColaboradorUpdateInput) {
    return prisma.colaborador.update({ where: { id }, data });
  }

  /**
   * Garante que o colaborador exista sem duplicar, e mantem nome, e-mail,
   * departamento, cargo e empresa atualizados com o que veio do AD.
   *
   * A chave e o idAD (o object id do Entra ID, que nunca muda), e so depois o
   * e-mail. Buscar so pelo e-mail quebrava quando a pessoa trocava de e-mail
   * (ex.: @empresa-antiga.com.br -> @empresa-nova.com.br): o cadastro antigo nao era
   * encontrado, o upsert tentava criar outro com o mesmo idAD e o emprestimo
   * falhava com "Ja existe um registro com esse idAD".
   */
  async criarOuAtualizarPorEmail(dados: {
    nome: string;
    email: string;
    departamento?: string | null;
    cargo?: string | null;
    idAD?: string | null;
    cpf?: string | null;
    endereco?: string | null;
    empresaAD?: string | null;
  }) {
    const email = dados.email.toLowerCase();
    const atualizaveis = {
      nome: dados.nome,
      ...(dados.departamento ? { departamento: dados.departamento } : {}),
      ...(dados.cargo ? { cargo: dados.cargo } : {}),
      ...(dados.idAD ? { idAD: dados.idAD } : {}),
      ...(dados.cpf ? { cpf: dados.cpf } : {}),
      ...(dados.endereco ? { endereco: dados.endereco } : {}),
      ...(dados.empresaAD ? { empresaAD: dados.empresaAD } : {}),
    };

    const idAD = dados.idAD?.trim() || null;
    if (idAD) {
      const peloAD = await prisma.colaborador.findUnique({ where: { idAD } });
      if (peloAD) {
        // Outro cadastro ja usa o e-mail novo (cadastrado a mao antes de vir do
        // AD): mantem o e-mail antigo neste para nao violar a unicidade, em vez
        // de falhar o emprestimo. O operador ve os dois em Colaboradores.
        const emailOcupado =
          peloAD.email !== email &&
          (await prisma.colaborador.findUnique({ where: { email }, select: { id: true } })) !== null;
        if (emailOcupado) {
          console.warn(
            `[colaborador] idAD ${idAD} (id ${peloAD.id}) mudou de e-mail para ${email}, ` +
              'mas ja existe outro cadastro com esse e-mail. Mantido o e-mail antigo.',
          );
        }
        return prisma.colaborador.update({
          where: { id: peloAD.id },
          data: { ...atualizaveis, ...(emailOcupado ? {} : { email }) },
        });
      }
    }

    return prisma.colaborador.upsert({
      where: { email },
      create: { ...atualizaveis, email },
      update: atualizaveis,
    });
  }

  contarComEmprestimoAtivo() {
    return prisma.colaborador.count({
      where: { emprestimos: { some: { status: { in: ['AGUARDANDO_ASSINATURA', 'ATIVO'] } } } },
    });
  }
}

export const colaboradorRepository = new ColaboradorRepository();
