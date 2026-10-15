/**
 * Tipos da interface.
 *
 * Antes eles descreviam o formato do Supabase (campos em snake_case, ids como
 * string, status em portugues) enquanto a API ja respondia no formato do
 * Prisma. Cada tela contornava a diferenca do seu jeito - havia ate
 * `(loan as any).dataEmprestimo || loan.data_emprestimo` no meio do JSX.
 * Agora estes tipos sao o contrato real da API.
 */

/** Como o equipamento e controlado: um a um ou por saldo. */
export type TipoControle = 'ITEM' | 'QUANTIDADE';

export type CondicaoItem = 'NOVO' | 'USADO';

export type SituacaoItem =
  | 'EM_ESTOQUE'
  | 'RESERVADO'
  /** Emprestado com termo de comodato (temporario). */
  | 'EMPRESTADO'
  /** Entregue em definitivo a um colaborador. */
  | 'ENTREGUE'
  | 'MANUTENCAO'
  | 'BAIXADO';

export type TipoMovimentacao =
  | 'ENTRADA'
  | 'CONTAGEM_INICIAL'
  | 'ENTREGA'
  | 'DEVOLUCAO'
  | 'EMPRESTIMO'
  | 'DEVOLUCAO_EMPRESTIMO'
  | 'TRANSFERENCIA'
  | 'MANUTENCAO'
  | 'RETORNO_MANUTENCAO'
  | 'BAIXA'
  | 'AJUSTE';

/** Emprestimo (com prazo) ou entrega definitiva (sem prazo). */
export type ModalidadeCessao = 'TEMPORARIA' | 'DEFINITIVA';

export type StatusEmprestimo = 'AGUARDANDO_ASSINATURA' | 'ATIVO' | 'DEVOLVIDO' | 'CANCELADO';

export type TipoAcao =
  | 'CRIADO'
  | 'TERMO_GERADO'
  | 'TERMO_ASSINADO'
  | 'ATIVADO'
  | 'RENOVADO'
  | 'LEMBRETE_ENVIADO'
  | 'COBRADO'
  | 'DEVOLVIDO'
  | 'CANCELADO';

export type TipoTemplate =
  | 'CONFIRMACAO_EMPRESTIMO'
  | 'CONFIRMACAO_ENTREGA'
  | 'LEMBRETE_PREVIO'
  | 'COBRANCA_ATRASO'
  | 'DEVOLUCAO_CONFIRMADA'
  | 'TERMO_PARA_ASSINAR';

export interface Categoria {
  id: number;
  nome: string;
  controle: TipoControle;
  icone: string | null;
  ordem: number;
  ativo: boolean;
  /** Ganha aba propria no Estoque; senao fica em "Perifericos". */
  secaoPropria: boolean;
  /**
   * Computador (notebook, desktop): exige numero de serie, tem hostname e
   * especificacoes. Sem hostname, fica "pendente de formatacao".
   */
  computador: boolean;
}

/**
 * Equipamento identificado do estoque. Era "Notebook": um notebook de
 * emprestimo e um item da categoria Notebook com paraEmprestimo = true.
 */
export interface Item {
  id: number;
  categoriaId: number;
  empresaId: number;
  /** So notebooks costumam ter nome na rede. */
  hostname: string | null;
  /** Numero de serie do fabricante (Service Tag), usado como patrimonio. */
  patrimonio: string | null;
  /** Especificacoes, so em computador. Memoria e armazenamento em GB. */
  processador: string | null;
  memoriaGb: number | null;
  armazenamentoGb: number | null;
  marca: string | null;
  modelo: string;
  condicao: CondicaoItem;
  situacao: SituacaoItem;
  observacoes: string | null;
  /** O Decimal do banco chega como texto: "4500". */
  valor: string | null;
  dataEntrada: string;
  paraEmprestimo: boolean;
  colaboradorId: number | null;
  entregueEm: string | null;
  categoria: Categoria;
  empresa: Empresa;
  colaborador: Colaborador | null;
  createdAt: string;
  updatedAt: string;
}

/** Ficha do equipamento: dados + extrato. */
export interface ItemDetalhado extends Item {
  emprestimos: Array<Emprestimo & { colaborador: Colaborador }>;
  movimentacoes: Movimentacao[];
}

/** Equipamento controlado por saldo: kit teclado e mouse, headset, adaptador. */
export interface ItemQuantidade {
  id: number;
  categoriaId: number;
  empresaId: number;
  descricao: string;
  quantidade: number;
  estoqueMinimo: number | null;
  valorUnitario: string | null;
  observacoes: string | null;
  categoria: Categoria;
  empresa: Empresa;
}

export interface Movimentacao {
  id: number;
  tipo: TipoMovimentacao;
  data: string;
  itemId: number | null;
  itemQuantidadeId: number | null;
  quantidade: number;
  empresaOrigemId: number | null;
  empresaDestinoId: number | null;
  localOrigemId: number | null;
  localDestinoId: number | null;
  colaboradorId: number | null;
  emprestimoId: number | null;
  usuario: string | null;
  observacao: string | null;
  item?: (Item & { categoria: Categoria }) | null;
  itemQuantidade?: (ItemQuantidade & { categoria: Categoria }) | null;
  colaborador?: Colaborador | null;
}

/** Quem esta com o que, agrupado por setor (tela Estoque > Por setor). */
export interface SetorComEquipamentos {
  departamento: string;
  total: number;
  emprestados: number;
  porCategoria: Array<{ categoria: string; total: number }>;
  pessoas: Array<{
    nome: string;
    email: string;
    departamento: string;
    equipamentos: Array<{
      itemId: number;
      nome: string;
      categoria: string;
      empresa: string;
      forma: 'ENTREGA' | 'EMPRESTIMO';
      desde: string;
    }>;
  }>;
}

export interface ResumoEstoque {
  itens: {
    emEstoque: number;
    emprestados: number;
    entregues: number;
    emManutencao: number;
    reservados: number;
    baixados: number;
  };
  porCategoria: Array<{ categoria: string; total: number }>;
  /** Quantidade e valor por categoria e situacao (sem as baixas). */
  porCategoriaESituacao: Array<{ categoria: string; situacao: SituacaoItem; total: number; valor: string }>;
  valorEmEstoque: string;
  quantidades: { tipos: number; unidades: number };
  abaixoDoMinimo: Array<{
    id: number;
    descricao: string;
    /** Nome da categoria: "Memória RAM", para "8GB" fazer sentido. */
    categoria: string;
    quantidade: number;
    estoqueMinimo: number;
    empresa: string;
  }>;
}

export interface Colaborador {
  id: number;
  nome: string;
  email: string;
  cpf: string | null;
  departamento: string | null;
  cargo: string | null;
  idAD: string | null;
  endereco: string | null;
  empresaAD: string | null;
  ativo: boolean;
}

export interface Emprestimo {
  id: number;
  itemId: number;
  colaboradorId: number;
  modalidade: ModalidadeCessao;
  dataInicio: string;
  /** Vazio na entrega definitiva. */
  dataPrevista: string | null;
  dataDevolucao: string | null;
  status: StatusEmprestimo;
  condicaoDevolucao: string | null;
  observacoes: string | null;
  renovacoes: number;
  d4signDocumentId: string | null;
  d4signStatus: string | null;
  d4signAssinadoEm: string | null;
  d4signTentativas: number;
  d4signProximaTentativa: string | null;
  d4signVerificadoEm: string | null;
  /** O convite de assinatura do D4Sign nao chegou a um signatario (ex.: lista de supressao). */
  d4signAvisoEmail: string | null;
  d4signEmailConferido: boolean;
  /** Quantos dos signatarios ja assinaram (o termo so fecha quando todos assinam). */
  d4signAssinados: number | null;
  d4signSignatarios: number | null;
  /** CRIADO, SIGNATARIO ou ENVIADO: ate onde a geracao do termo chegou. */
  d4signEtapa: string | null;
  criadoPor: string | null;
  empresaId: number | null;
  motivo: string | null;
  acessorios: string | null;
  testemunhaNome: string | null;
  testemunhaEmail: string | null;
  devolucaoRecebidaPorNome: string | null;
  devolucaoRecebidaPorEmail: string | null;
  observacoesDevolucao: string | null;
  empresa: Empresa | null;
  item: Item;
  colaborador: Colaborador;
  /** Calculados pela API - nao existem como coluna no banco. */
  atrasado: boolean;
  diasAtraso: number;
}

export interface ItemHistorico {
  id: number;
  emprestimoId: number;
  acao: TipoAcao;
  detalhes: string | null;
  usuario: string | null;
  dataAcao: string;
}

/** Resultado da busca no Active Directory via Microsoft Graph. */
export interface UsuarioAD {
  idAD: string;
  nome: string;
  email: string;
  departamento: string;
  cargo: string;
  /** Campo "Empresa" do perfil no AD. */
  empresa: string;
}

/** Empresa do grupo em nome da qual o termo de comodato e emitido. */
export interface Empresa {
  id: number;
  apelido: string;
  razaoSocial: string;
  cnpj: string;
  logradouro: string;
  cidade: string;
  uf: string;
  cep: string;
  d4signPastaId: string | null;
  termosAD: string;
  padrao: boolean;
  ativo: boolean;
}

export interface MetricasDashboard {
  inventario: {
    total: number;
    disponiveis: number;
    emprestados: number;
    entregues: number;
    reservados: number;
    emManutencao: number;
    descontinuados: number;
  };
  emprestimos: {
    emAberto: number;
    aguardandoAssinatura: number;
    colaboradoresComEquipamento: number;
    /** Marcados "para empréstimo" e guardados agora. */
    disponiveis: number;
  };
  alertas: {
    devolucoesAtrasadas: number;
    vencendoEmSeteDias: number;
    maioresAtrasos: Array<{
      id: number;
      colaborador: string;
      email: string;
      hostname: string;
      dataPrevista: string;
      diasAtraso: number;
    }>;
  };
  emprestimosPorDepartamento: Array<{ departamento: string; total: number }>;
}

export interface TemplateEmail {
  id: number;
  chave: TipoTemplate;
  assunto: string;
  corpo: string;
  ativo: boolean;
  updatedAt: string;
  updatedBy: string | null;
}

export interface EmailEnviado {
  id: number;
  destinatario: string;
  assunto: string;
  template: TipoTemplate;
  sucesso: boolean;
  erro: string | null;
  enviadoEm: string;
  emprestimo: Emprestimo | null;
}

/**
 * Estado da fila de termos do D4Sign.
 *
 * A conta tem teto de requisicoes por hora e cada termo consome tres chamadas,
 * entao emprestar varias maquinas de uma vez deixa parte dos termos na fila.
 */
export interface FilaTermos {
  /** Configurado e nao pausado: pode falar com o D4Sign agora. */
  habilitado: boolean;
  configurado: boolean;
  pausado: boolean;
  ambiente: 'producao' | 'sandbox';
  pendentes: number;
  /** Termos que o sistema parou de tentar e aguardam conferencia no painel. */
  precisamAtencao: number;
  /** Termos enviados cujo e-mail de convite nao foi entregue. */
  emailsComProblema: number;
  /** Documentos criados no D4Sign neste mes - cada um e cobrado. */
  documentosNoMes: number;
  cotaRestante: number;
  limitePorHora: number;
  chamadasPorTermo: number;
  termosQueCabemAgora: number;
  proximaJanelaEmMinutos: number;
  consultaAutomatica: boolean;
  horasEntreConsultas: number;
  diasMaxConsulta: number;
}

export interface ResultadoFilaTermos {
  pendentes: number;
  gerados: number;
  adiados: number;
  falharam: number;
  cotaRestante: number;
  proximaJanelaEmMinutos: number | null;
  detalhes: string[];
}

export interface ResultadoRotina {
  verificados: number;
  enviados: number;
  ignorados: number;
  falhas: number;
  detalhes: string[];
}

/** Horarios de uma rotina automatica (lembrete ou cobranca). */
export interface RotinaAgendada {
  id: 'lembretes' | 'cobranca';
  expressao: string;
  /** Horario agendado anterior e o proximo; null com as rotinas desligadas. */
  anterior: string | null;
  proxima: string | null;
  /** Ultima execucao automatica desde que o servidor subiu. */
  ultimaExecucao: { em: string; resumo: string | null; erro: string | null } | null;
}

export interface StatusSistema {
  ambiente: string;
  d4sign: {
    configurado: boolean;
    credenciais: boolean;
    ativo: boolean;
    /** Desligado pelo administrador na tela. */
    pausado: boolean;
    alteradoPor: string | null;
    alteradoEm: string | null;
  };
  entraId: { tenantConfigurado: boolean; grupoRestrito: boolean; grupoAdministradores: boolean };
  jobs: {
    habilitados: boolean;
    cobranca: string;
    lembrete: string;
    fusoHorario: string;
    rotinas: RotinaAgendada[];
  };
  smtp: { host: string; porta: number; remetente: string };
}

/** Quem esta logado e o que pode fazer (GET /me). */
export interface Perfil {
  email: string;
  nome: string;
  /** Membro do grupo de administradores do Notrole no AD. */
  admin: boolean;
  /** Empresa do campo "Empresa" do AD; null quando nao deu para descobrir. */
  empresaId: number | null;
  empresa: string | null;
  grupoAdministradores: boolean;
  /**
   * Analista sem empresa no AD: nao ve nem mexe em nada (a API responde 403
   * SEM_EMPRESA) e o app mostra a tela de aviso.
   */
  semEmpresa?: boolean;
}

export interface Usuario {
  id: string;
  email: string;
  nome: string;
}
