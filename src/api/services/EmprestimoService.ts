import { type ModalidadeCessao, type Prisma, type SituacaoItem, type StatusEmprestimo } from '@prisma/client';
import { prisma } from '../config/prisma';
import { env } from '../config/env';
import { AppError } from '../utils/AppError';
import { nomeDoItem } from '../utils/itens';
import { estoqueRepository } from '../repositories/EstoqueRepository';
import { dataDeFormulario, diasDeAtraso, estaAtrasado, formatarData } from '../utils/datas';
import {
  EMPRESTIMO_COM_RELACOES,
  emprestimoRepository,
  STATUS_EM_ABERTO,
  type EmprestimoCompleto,
} from '../repositories/EmprestimoRepository';
import { colaboradorRepository } from '../repositories/ColaboradorRepository';
import { itemRepository } from '../repositories/ItemRepository';
import { historicoRepository } from '../repositories/HistoricoRepository';
import { emailService } from './EmailService';
import { enviarConfirmacao } from './AvisosDoEmprestimo';
import { d4signService } from './D4SignService';
import { termoService } from './TermoService';
import { empresaService } from './EmpresaService';
import { cpfValido, formatarCpf } from '../utils/documentos';
import { comprovanteService } from './ComprovanteService';
import { permissaoService, type UsuarioComPermissao } from './PermissaoService';

export interface DadosNovoEmprestimo {
  itemId: number;
  colaborador: {
    nome: string;
    email: string;
    departamento?: string | null;
    cargo?: string | null;
    cpf?: string | null;
    idAD?: string | null;
    /** Endereco residencial, exigido no termo. */
    endereco?: string | null;
    /** Campo "Empresa" do perfil no AD. */
    empresaAD?: string | null;
  };
  /**
   * TEMPORARIA (padrao) e o emprestimo, com prazo. DEFINITIVA e a entrega do
   * equipamento como ferramenta de trabalho: sem prazo, sem cobranca, com o
   * modelo de comodato proprio.
   */
  modalidade?: ModalidadeCessao;
  /** Obrigatorio no emprestimo; ignorado na entrega. */
  dataPrevistaDevolucao?: string | null;
  observacoes?: string | null;
  /**
   * Se o termo de responsabilidade deve ser enviado pelo D4Sign. O D4Sign cobra
   * por documento, entao a decisao e do operador a cada emprestimo. Falso = o
   * emprestimo nasce ativo e nao toca no D4Sign.
   */
  enviarTermo?: boolean;
  /** Empresa comodante. Vazio = identificada pelo AD do colaborador. */
  empresaId?: number | null;
  motivo?: string | null;
  /** Acessorios emprestados junto: "Carregador, Mouse". */
  acessorios?: string | null;
}

/** Quem esta usando o sistema. No termo, sai como "Registrado no Notrole por" (nao assina). */
export interface Operador {
  email: string;
  nome: string;
}

/** Emprestimo com os campos derivados que a interface precisa. */
export type EmprestimoParaInterface = EmprestimoCompleto & {
  atrasado: boolean;
  diasAtraso: number;
};

export class EmprestimoService {
  private decorar(emprestimo: EmprestimoCompleto): EmprestimoParaInterface {
    const emAberto = emprestimo.status === 'ATIVO' || emprestimo.status === 'AGUARDANDO_ASSINATURA';
    // A entrega definitiva nao tem prazo, entao nunca atrasa.
    const prazo = emprestimo.dataPrevista;
    const atrasado = emAberto && prazo !== null && estaAtrasado(prazo);

    return {
      ...emprestimo,
      atrasado,
      // "ATRASADO" nao e um status gravado no banco: seria um dado duplicado
      // que precisaria de alguem para mante-lo em dia. E sempre calculado.
      diasAtraso: atrasado && prazo ? diasDeAtraso(prazo) : 0,
    };
  }

  async listar(filtro?: {
    status?: StatusEmprestimo;
    modalidade?: ModalidadeCessao;
    /** Empresa do equipamento (o analista so ve a dele). */
    empresaId?: number;
  }): Promise<EmprestimoParaInterface[]> {
    const emprestimos = await emprestimoRepository.listar(filtro);
    return emprestimos.map((e) => this.decorar(e));
  }

  async buscarPorId(id: number, permissao?: UsuarioComPermissao): Promise<EmprestimoParaInterface> {
    const emprestimo = await emprestimoRepository.buscarPorId(id);
    if (!emprestimo) throw AppError.naoEncontrado('Emprestimo');
    if (permissao) permissaoService.exigirVisivel(permissao, emprestimo.item.empresaId, 'esta cessao');
    return this.decorar(emprestimo);
  }

  /**
   * Confere, ANTES de registrar qualquer coisa, se ha tudo o que o termo de
   * comodato precisa. Um contrato com lacuna nao pode chegar ao D4Sign - e a
   * hora de pedir o dado que falta e agora, com o colaborador na mesa da TI.
   */
  private validarDadosDoTermo(dados: DadosNovoEmprestimo, operador?: Operador) {
    const problemas: string[] = [];

    const cpf = dados.colaborador.cpf?.trim() ?? '';
    if (!cpf) problemas.push('informe o CPF do colaborador');
    else if (!cpfValido(cpf)) problemas.push('o CPF informado e invalido - confira os digitos');

    if ((dados.colaborador.endereco?.trim().length ?? 0) < 10) {
      problemas.push('informe o endereco completo do colaborador');
    }
    // O modelo da entrega nao tem campo de motivo; o do emprestimo tem.
    if (dados.modalidade !== 'DEFINITIVA' && !dados.motivo?.trim()) {
      problemas.push('informe o motivo do emprestimo');
    }
    if (!operador?.nome || !operador.email) {
      problemas.push('nao foi possivel identificar o analista logado, que sai no termo como "Registrado no Notrole por"');
    }

    if (problemas.length) {
      throw new AppError(`Para enviar o termo: ${problemas.join('; ')}.`, 422, 'DADOS_DO_TERMO');
    }
  }

  /**
   * Registra um novo emprestimo.
   *
   * A reserva do notebook acontece dentro de uma transacao, com um update
   * condicional. Sem isso, dois operadores clicando ao mesmo tempo
   * conseguiriam emprestar o mesmo equipamento duas vezes.
   */
  async criar(
    dados: DadosNovoEmprestimo,
    operador?: Operador,
    permissao?: UsuarioComPermissao,
  ): Promise<EmprestimoParaInterface> {
    const modalidade: ModalidadeCessao = dados.modalidade ?? 'TEMPORARIA';
    const definitiva = modalidade === 'DEFINITIVA';

    let dataPrevista: Date | null = null;
    if (!definitiva) {
      if (!dados.dataPrevistaDevolucao) {
        throw new AppError('Informe a data prevista de devolucao.', 422);
      }
      dataPrevista = dataDeFormulario(dados.dataPrevistaDevolucao);
      if (dataPrevista.getTime() < Date.now()) {
        throw new AppError('A data prevista de devolucao nao pode estar no passado.', 422);
      }
    }

    // Com termo, o emprestimo so fica ativo depois da assinatura. Sem termo -
    // porque o operador dispensou ou porque o D4Sign esta desligado -, ja nasce
    // ativo e nao toca no D4Sign.
    const comTermo = env.d4signHabilitado && dados.enviarTermo !== false;
    if (comTermo) this.validarDadosDoTermo(dados, operador);

    // O CPF e unico. Sem esta conferencia, digitar o CPF de outra pessoa dava
    // um erro generico do banco.
    if (dados.colaborador.cpf) {
      const dono = await colaboradorRepository.buscarPorCpf(formatarCpf(dados.colaborador.cpf));
      // A mesma pessoa e reconhecida pelo idAD (que nao muda) ou pelo e-mail
      // (que muda quando a empresa troca de dominio).
      const mesmaPessoa =
        dono !== null &&
        ((!!dados.colaborador.idAD && dono.idAD === dados.colaborador.idAD) ||
          dono.email.toLowerCase() === dados.colaborador.email.toLowerCase());
      if (dono && !mesmaPessoa) {
        throw new AppError(
          `O CPF ${formatarCpf(dados.colaborador.cpf)} ja esta cadastrado para ${dono.nome} ` +
            `(${dono.email}). Confira o CPF digitado.`,
          409,
          'CPF_DE_OUTRO_COLABORADOR',
        );
      }
    }

    // A empresa do equipamento e conferida ANTES de gravar o colaborador: um 403
    // nao pode deixar CPF e endereco gravados. A transacao confere de novo.
    let empresaIdDoTermo = dados.empresaId ?? null;
    if (permissao) {
      const item = await itemRepository.buscarPorId(dados.itemId);
      if (!item) throw AppError.naoEncontrado('Equipamento');
      permissaoService.exigirEmpresa(
        permissao,
        item.empresaId,
        definitiva ? 'entregar equipamentos' : 'emprestar equipamentos',
      );
      // Para o analista, o termo sai sempre em nome da empresa do equipamento,
      // seja qual for a empresa que veio do formulario. So o administrador escolhe.
      if (!permissao.admin) empresaIdDoTermo = item.empresaId;
    }

    // A empresa comodante: a escolhida no formulario (ou imposta acima) ou a do
    // AD do colaborador.
    const empresa = empresaIdDoTermo
      ? await empresaService.buscarPorId(empresaIdDoTermo)
      : await empresaService.identificar(dados.colaborador.empresaAD);

    if (comTermo && !empresa) {
      throw new AppError(
        'Nenhuma empresa cadastrada para emitir o termo. Cadastre em Configuracoes > Empresas.',
        422,
        'EMPRESA_NAO_CADASTRADA',
      );
    }

    const colaborador = await colaboradorRepository.criarOuAtualizarPorEmail({
      nome: dados.colaborador.nome,
      email: dados.colaborador.email,
      departamento: dados.colaborador.departamento,
      cargo: dados.colaborador.cargo,
      idAD: dados.colaborador.idAD,
      cpf: dados.colaborador.cpf ? formatarCpf(dados.colaborador.cpf) : null,
      endereco: dados.colaborador.endereco?.trim() || null,
      empresaAD: dados.colaborador.empresaAD?.trim() || null,
    });

    const statusInicial: StatusEmprestimo = comTermo ? 'AGUARDANDO_ASSINATURA' : 'ATIVO';

    const emprestimo = await prisma.$transaction(async (tx) => {
      const item = await tx.item.findUnique({
        where: { id: dados.itemId },
        include: { categoria: true },
      });
      if (!item) throw AppError.naoEncontrado('Equipamento');

      // Cada analista cede equipamento do estoque da propria empresa.
      if (permissao) {
        permissaoService.exigirEmpresa(
          permissao,
          item.empresaId,
          definitiva ? 'entregar equipamentos' : 'emprestar equipamentos',
        );
      }

      // Valor e patrimonio aparecem no contrato. Sem eles, o termo sairia com
      // lacuna - e o D4Sign cobraria o envio de um documento incompleto.
      if (comTermo && !item.valor) {
        throw new AppError(
          `O equipamento ${nomeDoItem(item)} esta sem valor cadastrado, que e exigido no termo. ` +
            'Informe o valor no cadastro do equipamento, em Estoque.',
          422,
          'SEM_VALOR',
        );
      }
      if (comTermo && !item.patrimonio) {
        throw new AppError(
          `O equipamento ${nomeDoItem(item)} esta sem patrimonio (numero de serie), que e exigido no termo. ` +
            'Informe no cadastro do equipamento, em Estoque.',
          422,
          'SEM_PATRIMONIO',
        );
      }

      // Emprestado (com prazo) ou entregue (sem prazo, fica com a pessoa).
      const reserva = await tx.item.updateMany({
        where: { id: dados.itemId, situacao: 'EM_ESTOQUE' },
        data: definitiva
          ? { situacao: 'ENTREGUE', colaboradorId: colaborador.id, entregueEm: new Date() }
          : { situacao: 'EMPRESTADO' },
      });

      if (reserva.count === 0) {
        throw AppError.conflito(
          'O equipamento ' + nomeDoItem(item) + ' nao esta disponivel (situacao atual: ' + item.situacao + ').',
        );
      }

      const criado = await tx.emprestimo.create({
        data: {
          itemId: dados.itemId,
          colaboradorId: colaborador.id,
          modalidade,
          dataPrevista,
          status: statusInicial,
          observacoes: dados.observacoes ?? null,
          criadoPor: operador?.email ?? null,
          empresaId: empresa?.id ?? null,
          motivo: dados.motivo?.trim() || null,
          acessorios: dados.acessorios?.trim() || null,
          testemunhaNome: operador?.nome ?? null,
          testemunhaEmail: operador?.email ?? null,
          // Registra a dispensa, para ficar claro no historico que o termo nao
          // foi esquecido - foi uma escolha.
          ...(env.d4signHabilitado && !comTermo ? { d4signStatus: 'DISPENSADO' } : {}),
        },
        include: { item: { include: { categoria: true } }, colaborador: true, empresa: true },
      });

      await historicoRepository.registrar(
        criado.id,
        'CRIADO',
        'Equipamento ' +
          nomeDoItem(item) +
          (definitiva
            ? ' entregue em definitivo para ' + colaborador.nome + ', sem prazo de devolucao.'
            : ' emprestado para ' +
              colaborador.nome +
              '. Previsao de devolucao: ' +
              (dataPrevista ? formatarData(dataPrevista) : '-') +
              '.') +
          (comTermo && empresa ? ' Termo em nome de ' + empresa.apelido + '.' : ''),
        operador?.email,
        tx,
      );

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: definitiva ? 'ENTREGA' : 'EMPRESTIMO',
          itemId: item.id,
          colaboradorId: colaborador.id,
          emprestimoId: criado.id,
          empresaOrigemId: item.empresaId,
          usuario: operador?.email,
          observacao: dados.motivo?.trim() || null,
        },
        tx,
      );

      return criado;
    });

    // Efeitos colaterais ficam fora da transacao: e-mail e D4Sign sao lentos e
    // uma falha neles nao pode desfazer o emprestimo ja registrado.
    // Com termo, a confirmacao so sai depois da assinatura (TermoService); o
    // e-mail explicando o termo sai junto com o convite do D4Sign.
    if (!comTermo) void enviarConfirmacao(emprestimo);

    // O termo entra numa fila em vez de ser gerado aqui. A conta do D4Sign tem
    // teto de requisicoes por hora e cada termo custa tres chamadas; emprestar
    // varias maquinas de uma vez estoura o limite. Ver TermoService.
    if (comTermo) termoService.agendar();

    return this.decorar(emprestimo);
  }

  /**
   * Chamado pelo webhook do D4Sign quando o documento muda de estado.
   *
   * O corpo do webhook NAO e confiavel para decidir a transicao: o status e
   * reconsultado no D4Sign (1 requisicao) e so o que o D4Sign responder e
   * aplicado. Assim um POST forjado, mesmo com o segredo vazado, nao ativa
   * emprestimo sem assinatura.
   */
  async processarWebhookD4Sign(documentId: string) {
    const emprestimo = await emprestimoRepository.buscarPorDocumentoD4Sign(documentId);
    if (!emprestimo) {
      console.warn('[d4sign] Webhook para documento desconhecido: ' + documentId);
      return { tratado: false };
    }

    const situacao = await d4signService.consultarStatus(documentId);

    // A transicao em si mora no TermoService, que e quem tambem consulta o
    // D4Sign periodicamente. Webhook e consulta chegam ao mesmo lugar.
    await termoService.aplicarStatus(emprestimo, situacao, 'D4SIGN');

    return { tratado: true, assinado: situacao.assinado };
  }

  /**
   * Confere se quem esta logado pode mexer neste emprestimo: cada analista so
   * mexe nas cessoes do estoque da propria empresa (a mesma regra da criacao).
   */
  async exigirEmpresaDoEmprestimo(id: number, permissao: UsuarioComPermissao | undefined, acao: string) {
    const emprestimo = await emprestimoRepository.buscarPorId(id);
    if (!emprestimo) throw AppError.naoEncontrado('Emprestimo');
    if (permissao) permissaoService.exigirEmpresa(permissao, emprestimo.item.empresaId, acao);
    return emprestimo;
  }

  /** Ativa manualmente um emprestimo preso aguardando assinatura. */
  async ativarManualmente(
    id: number,
    operador?: string,
    permissao?: UsuarioComPermissao,
  ): Promise<EmprestimoParaInterface> {
    const emprestimo = await this.exigirEmpresaDoEmprestimo(id, permissao, 'ativar cessoes');

    if (emprestimo.status !== 'AGUARDANDO_ASSINATURA') {
      throw new AppError('So e possivel ativar um emprestimo aguardando assinatura.', 409);
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await this.mudarEmprestimoSeEstiver(tx, id, ['AGUARDANDO_ASSINATURA'], { status: 'ATIVO' });

      await historicoRepository.registrar(
        id,
        'ATIVADO',
        'Ativado manualmente pelo operador, sem aguardar a assinatura do termo.',
        operador,
        tx,
      );

      return tx.emprestimo.findUniqueOrThrow({ where: { id }, include: EMPRESTIMO_COM_RELACOES });
    });

    // Ativou: e agora que o colaborador recebe a confirmacao.
    void enviarConfirmacao(atualizado);

    return this.decorar(atualizado);
  }

  async renovar(
    id: number,
    novaData: string,
    operador?: string,
    permissao?: UsuarioComPermissao,
  ): Promise<EmprestimoParaInterface> {
    const emprestimo = await this.exigirEmpresaDoEmprestimo(id, permissao, 'renovar emprestimos');

    if (emprestimo.status === 'DEVOLVIDO' || emprestimo.status === 'CANCELADO') {
      throw new AppError('Este emprestimo ja foi encerrado.', 409);
    }
    if (emprestimo.modalidade === 'DEFINITIVA' || !emprestimo.dataPrevista) {
      throw new AppError('Uma entrega definitiva nao tem prazo para renovar.', 409);
    }

    const dataPrevista = dataDeFormulario(novaData);
    if (dataPrevista <= emprestimo.dataPrevista) {
      throw new AppError('A nova data precisa ser posterior ao prazo atual.', 422);
    }

    const anterior = formatarData(emprestimo.dataPrevista);

    const atualizado = await prisma.$transaction(async (tx) => {
      // O prazo lido tambem vai no where: duas renovacoes simultaneas nao
      // contam duas vezes nem sobrescrevem uma a outra em silencio.
      await this.mudarEmprestimoSeEstiver(
        tx,
        id,
        STATUS_EM_ABERTO,
        {
          dataPrevista,
          renovacoes: { increment: 1 },
          // Zera o controle de notificacoes para o novo prazo.
          lembretePrevioEm: null,
          ultimaCobrancaEm: null,
        },
        { dataPrevista: emprestimo.dataPrevista },
      );

      await historicoRepository.registrar(
        id,
        'RENOVADO',
        'Prazo alterado de ' + anterior + ' para ' + formatarData(dataPrevista) + '.',
        operador,
        tx,
      );

      return tx.emprestimo.findUniqueOrThrow({ where: { id }, include: EMPRESTIMO_COM_RELACOES });
    });

    return this.decorar(atualizado);
  }

  async registrarDevolucao(
    id: number,
    condicao: string,
    observacoes?: string | null,
    operador?: Operador,
    permissao?: UsuarioComPermissao,
  ): Promise<EmprestimoParaInterface> {
    const emprestimo = await this.exigirEmpresaDoEmprestimo(id, permissao, 'registrar devolucoes');

    if (emprestimo.status === 'DEVOLVIDO') {
      throw new AppError('Este emprestimo ja foi devolvido.', 409);
    }
    if (emprestimo.status === 'CANCELADO') {
      throw new AppError('Este emprestimo foi cancelado.', 409);
    }

    const avariado = condicao.toUpperCase() === 'AVARIADO';
    const dataDevolucao = new Date();

    // A transacao decide quem ganhou: num duplo clique (ou dois operadores) so
    // a primeira devolucao passa pelo updateMany condicional; a segunda leva
    // 409 e nao gera movimentacao, historico nem e-mail.
    const atualizado = await prisma.$transaction(async (tx) => {
      await this.mudarEmprestimoSeEstiver(tx, id, STATUS_EM_ABERTO, {
        status: 'DEVOLVIDO',
        dataDevolucao,
        condicaoDevolucao: condicao.toUpperCase(),
        // Campo proprio: antes a observacao da devolucao sobrescrevia as
        // observacoes internas do emprestimo, que nao sao para o colaborador.
        observacoesDevolucao: observacoes?.trim() || null,
        devolucaoRecebidaPorNome: operador?.nome ?? null,
        devolucaoRecebidaPorEmail: operador?.email ?? null,
      });

      await this.liberarItemDaCessao(tx, emprestimo, {
        situacao: avariado ? 'MANUTENCAO' : 'EM_ESTOQUE',
        // Um equipamento que ja rodou com alguem volta como usado.
        condicao: 'USADO',
        colaboradorId: null,
        entregueEm: null,
      });

      // O extrato do equipamento no estoque acompanha a cessao.
      await estoqueRepository.registrarMovimentacao(
        {
          tipo: emprestimo.modalidade === 'DEFINITIVA' ? 'DEVOLUCAO' : 'DEVOLUCAO_EMPRESTIMO',
          itemId: emprestimo.itemId,
          colaboradorId: emprestimo.colaboradorId,
          emprestimoId: id,
          empresaDestinoId: emprestimo.item.empresaId,
          usuario: operador?.email,
          observacao: avariado ? 'Devolvido com avaria; enviado para manutencao.' : null,
        },
        tx,
      );

      await historicoRepository.registrar(
        id,
        'DEVOLVIDO',
        'Devolvido em ' +
          formatarData(dataDevolucao) +
          '. Condicao: ' +
          condicao +
          '.' +
          (avariado ? ' Equipamento enviado para manutencao.' : ''),
        operador?.email,
        tx,
      );

      return tx.emprestimo.findUniqueOrThrow({ where: { id }, include: EMPRESTIMO_COM_RELACOES });
    });

    // So chega aqui quem efetivamente registrou a devolucao.
    void this.enviarComprovanteDeDevolucao(atualizado).catch((erro) =>
      console.error(`[emprestimo ${id}] Falha ao enviar o comprovante de devolucao:`, erro),
    );

    return this.decorar(atualizado);
  }

  /**
   * E-mail de devolucao com o comprovante em PDF anexado. E o documento que o
   * colaborador guarda para provar que devolveu - substitui a secao de
   * devolucao que havia no termo de comodato. Se o PDF falhar, o e-mail vai
   * assim mesmo: a devolucao ja aconteceu e o colaborador precisa saber.
   */
  private async enviarComprovanteDeDevolucao(emprestimo: EmprestimoCompleto) {
    let anexos: Array<{ nome: string; conteudo: Buffer }> = [];
    try {
      const pdf = await comprovanteService.gerarDevolucao(emprestimo);
      anexos = [{ nome: `Comprovante de devolucao - ${nomeDoItem(emprestimo.item)}.pdf`, conteudo: pdf }];
    } catch (erro) {
      console.error(`[emprestimo ${emprestimo.id}] Falha ao gerar o comprovante de devolucao:`, erro);
    }

    await emailService.enviarPorTemplate({
      chave: 'DEVOLUCAO_CONFIRMADA',
      destinatario: emprestimo.colaborador.email,
      emprestimoId: emprestimo.id,
      variaveis: {
        nome: emprestimo.colaborador.nome,
        hostname: nomeDoItem(emprestimo.item),
        modelo: emprestimo.item.modelo,
        data_devolucao: formatarData(emprestimo.dataDevolucao ?? new Date()),
      },
      anexos,
    });
  }

  /** Comprovante de devolucao para baixar pela tela. */
  async comprovanteDeDevolucao(
    id: number,
    permissao?: UsuarioComPermissao,
  ): Promise<{ nome: string; arquivo: Buffer }> {
    const emprestimo = await emprestimoRepository.buscarPorId(id);
    if (!emprestimo) throw AppError.naoEncontrado('Emprestimo');
    if (permissao) permissaoService.exigirVisivel(permissao, emprestimo.item.empresaId, 'esta cessao');
    if (emprestimo.status !== 'DEVOLVIDO') {
      throw new AppError('Este emprestimo ainda nao foi devolvido.', 409);
    }
    // O nome vai no cabecalho Content-Disposition: aspas ou caracteres fora do
    // latin1 quebravam a resposta (erro 500). Mesmo criterio do PlanilhaService.
    const item = nomeDoItem(emprestimo.item)
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return {
      nome: `comprovante-devolucao-${emprestimo.id}${item ? `-${item}` : ''}.pdf`,
      arquivo: await comprovanteService.gerarDevolucao(emprestimo),
    };
  }

  async cancelar(
    id: number,
    motivo: string,
    operador?: string,
    permissao?: UsuarioComPermissao,
  ): Promise<EmprestimoParaInterface & { aviso?: string }> {
    const emprestimo = await this.exigirEmpresaDoEmprestimo(id, permissao, 'cancelar cessoes');

    if (emprestimo.status === 'DEVOLVIDO' || emprestimo.status === 'CANCELADO') {
      throw new AppError('Este emprestimo ja foi encerrado.', 409);
    }

    const atualizado = await prisma.$transaction(async (tx) => {
      await this.mudarEmprestimoSeEstiver(tx, id, STATUS_EM_ABERTO, { status: 'CANCELADO' });

      await this.liberarItemDaCessao(tx, emprestimo, {
        situacao: 'EM_ESTOQUE',
        colaboradorId: null,
        entregueEm: null,
      });

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: emprestimo.modalidade === 'DEFINITIVA' ? 'DEVOLUCAO' : 'DEVOLUCAO_EMPRESTIMO',
          itemId: emprestimo.itemId,
          emprestimoId: id,
          empresaDestinoId: emprestimo.item.empresaId,
          usuario: operador,
          observacao: `${emprestimo.modalidade === 'DEFINITIVA' ? 'Entrega cancelada' : 'Emprestimo cancelado'}: ${motivo}`,
        },
        tx,
      );

      await historicoRepository.registrar(id, 'CANCELADO', motivo, operador, tx);

      return tx.emprestimo.findUniqueOrThrow({ where: { id }, include: EMPRESTIMO_COM_RELACOES });
    });

    // Rede fora da transacao. Rele o uuid: o termo pode ter sido criado no
    // D4Sign enquanto o operador decidia cancelar.
    const uuid = atualizado.d4signDocumentId ?? emprestimo.d4signDocumentId;
    if (!uuid) return this.decorar(atualizado);

    const resultado = await d4signService.cancelar(uuid);
    if (resultado.cancelado) return this.decorar(atualizado);

    // Nao cancelou no D4Sign: fica no historico e o operador e avisado, para
    // ninguem achar que o documento sumiu de la.
    const aviso = resultado.finalizado
      ? `O termo ja estava assinado no D4Sign e continua valido la (documento ${uuid}). ` +
        'O cancelamento vale so no Notrole.'
      : `O termo nao foi cancelado no D4Sign (${resultado.motivo}). ` +
        `Cancele o documento ${uuid} direto no painel do D4Sign.`;

    try {
      await historicoRepository.registrar(id, 'CANCELADO', aviso, 'SISTEMA');
    } catch (erro) {
      console.error(`[emprestimo ${id}] Falha ao registrar o aviso do D4Sign no historico:`, erro);
    }

    return { ...this.decorar(atualizado), aviso };
  }

  /**
   * Update condicional do emprestimo: so grava se o status no banco ainda for
   * um dos esperados. Count 0 = outra pessoa (ou um duplo clique) chegou
   * antes - 409, e a transacao inteira e desfeita.
   */
  private async mudarEmprestimoSeEstiver(
    tx: Prisma.TransactionClient,
    id: number,
    permitidos: StatusEmprestimo[],
    data: Prisma.EmprestimoUpdateManyMutationInput,
    condicaoExtra: Prisma.EmprestimoWhereInput = {},
  ) {
    const resultado = await tx.emprestimo.updateMany({
      where: { id, status: { in: permitidos }, ...condicaoExtra },
      data,
    });
    if (resultado.count === 0) {
      throw AppError.conflito('Este emprestimo foi alterado por outra pessoa. Atualize a tela.');
    }
  }

  /**
   * Devolve o equipamento da cessao ao estoque, conferindo que ele ainda esta
   * na situacao que a cessao deixou (EMPRESTADO ou ENTREGUE).
   */
  private async liberarItemDaCessao(
    tx: Prisma.TransactionClient,
    emprestimo: EmprestimoCompleto,
    data: Prisma.ItemUncheckedUpdateManyInput,
  ) {
    const esperada: SituacaoItem = emprestimo.modalidade === 'DEFINITIVA' ? 'ENTREGUE' : 'EMPRESTADO';
    const resultado = await tx.item.updateMany({
      where: { id: emprestimo.itemId, situacao: esperada },
      data,
    });
    if (resultado.count === 0) {
      throw AppError.conflito(
        `O equipamento ${nomeDoItem(emprestimo.item)} nao esta mais como ` +
          `${esperada === 'ENTREGUE' ? 'entregue' : 'emprestado'} no estoque. Atualize a tela; ` +
          'se continuar, confira a situacao dele em Estoque.',
      );
    }
  }

  async listarHistorico(id: number, permissao?: UsuarioComPermissao) {
    if (permissao) await this.buscarPorId(id, permissao);
    return historicoRepository.listarPorEmprestimo(id);
  }
}

export const emprestimoService = new EmprestimoService();
