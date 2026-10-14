import { type TipoTemplate } from '@prisma/client';
import { prisma } from '../config/prisma';

/**
 * Templates de e-mail.
 *
 * A tela de Configuracoes deixava o operador editar assunto e corpo, mas salvava
 * tudo no localStorage do navegador. O backend nunca lia nada disso e enviava
 * textos fixos escritos no codigo. Agora os templates vivem no banco e sao a
 * unica fonte de verdade para os dois lados.
 */

export interface VariaveisTemplate {
  nome?: string;
  hostname?: string;
  patrimonio?: string;
  modelo?: string;
  data_emprestimo?: string;
  data_entrega?: string;
  data_prevista?: string;
  data_devolucao?: string;
  dias_atraso?: string;
  /** Na confirmacao: observacao sobre o termo (ex.: "assinado em ..."). Pode ser vazio. */
  instrucoes_termo?: string;
  /** "o empréstimo" ou "a entrega". */
  tipo_cessao?: string;
  /** "Devolução prevista: dd/mm/aaaa" ou o aviso de entrega definitiva. */
  linha_prazo?: string;
}

export const VARIAVEIS_DISPONIVEIS: Record<TipoTemplate, Array<keyof VariaveisTemplate>> = {
  CONFIRMACAO_EMPRESTIMO: [
    'nome',
    'hostname',
    'patrimonio',
    'modelo',
    'data_emprestimo',
    'data_prevista',
    'instrucoes_termo',
  ],
  CONFIRMACAO_ENTREGA: ['nome', 'hostname', 'patrimonio', 'modelo', 'data_entrega', 'instrucoes_termo'],
  LEMBRETE_PREVIO: ['nome', 'hostname', 'modelo', 'data_prevista'],
  COBRANCA_ATRASO: ['nome', 'hostname', 'modelo', 'data_prevista', 'dias_atraso'],
  DEVOLUCAO_CONFIRMADA: ['nome', 'hostname', 'modelo', 'data_devolucao'],
  TERMO_PARA_ASSINAR: ['nome', 'hostname', 'patrimonio', 'modelo', 'tipo_cessao', 'linha_prazo'],
};

// Textos padrao dos e-mails. Iguais aos gravados pela migracao
// 20260922100000_comprovante_devolucao (a primeira versao saiu sem acentos) e
// 20260922130000_email_segundo_termo (aviso do e-mail do D4Sign).
const PADROES: Record<TipoTemplate, { assunto: string; corpo: string }> = {
  CONFIRMACAO_EMPRESTIMO: {
    assunto: 'Confirmação de empréstimo de equipamento - {hostname}',
    corpo: [
      'Olá, {nome}!',
      '',
      'Seu empréstimo está confirmado: o equipamento {hostname} ({modelo}), patrimônio {patrimonio}, está sob sua responsabilidade.',
      '',
      'Data do empréstimo: {data_emprestimo}',
      'Data prevista para devolução: {data_prevista}',
      '{instrucoes_termo}',
      '',
      'Você é responsável pelo equipamento durante o período do empréstimo. Se precisar de mais prazo, procure a TI antes do vencimento.',
      '',
      'Atenciosamente,',
      'Equipe de TI',
    ].join('\n'),
  },
  CONFIRMACAO_ENTREGA: {
    assunto: 'Entrega de equipamento - {hostname}',
    corpo: [
      'Olá, {nome}!',
      '',
      'Registramos a entrega do equipamento {hostname} ({modelo}), patrimônio {patrimonio}, para uso no seu trabalho.',
      '',
      'Data da entrega: {data_entrega}',
      '{instrucoes_termo}',
      '',
      'O equipamento fica sob sua responsabilidade enquanto estiver com você. Em caso de defeito, perda ou desligamento da empresa, procure a TI.',
      '',
      'Atenciosamente,',
      'Equipe de TI',
    ].join('\n'),
  },
  LEMBRETE_PREVIO: {
    // Nao diz "amanha": na sexta o lembrete cobre prazos de sabado a segunda.
    assunto: 'Lembrete: devolução do equipamento {hostname} vence em {data_prevista}',
    corpo: [
      'Olá, {nome}!',
      '',
      'Este é um lembrete de que o prazo para devolução do equipamento {hostname} ({modelo}) vence em {data_prevista}.',
      '',
      'Por favor, compareça à TI para devolver o equipamento ou solicitar a prorrogação do prazo.',
      '',
      'Atenciosamente,',
      'Equipe de TI',
    ].join('\n'),
  },
  COBRANCA_ATRASO: {
    assunto: '[AVISO] Devolução de equipamento em atraso - {dias_atraso} dia(s)',
    corpo: [
      'Olá, {nome}!',
      '',
      'Consta em nosso sistema que o prazo de devolução do equipamento {hostname} ({modelo}) expirou em {data_prevista}, há {dias_atraso} dia(s).',
      '',
      'Por favor, dirija-se ao setor de TI o mais rápido possível para realizar a devolução ou solicitar a renovação do prazo.',
      '',
      'Se você já devolveu o equipamento, desconsidere este aviso.',
      '',
      'Atenciosamente,',
      'Equipe de TI',
    ].join('\n'),
  },
  DEVOLUCAO_CONFIRMADA: {
    assunto: 'Devolução registrada - {hostname}',
    corpo: [
      'Olá, {nome}!',
      '',
      'Registramos a devolução do equipamento {hostname} ({modelo}) em {data_devolucao}.',
      '',
      'O comprovante de devolução segue em anexo. Guarde este e-mail: ele comprova que o equipamento foi devolvido.',
      '',
      'Obrigado pelo cuidado com o equipamento.',
      '',
      'Atenciosamente,',
      'Equipe de TI',
    ].join('\n'),
  },
  TERMO_PARA_ASSINAR: {
    assunto: 'Assine o Termo de Comodato - {hostname}',
    corpo: [
      'Olá, {nome}!',
      '',
      'A TI registrou {tipo_cessao} do equipamento {hostname} ({modelo}), patrimônio {patrimonio}, para você.',
      '{linha_prazo}',
      '',
      'Para concluir, falta só você assinar o Termo de Comodato, que formaliza que o equipamento está sob sua responsabilidade.',
      '',
      'COMO ASSINAR:',
      '1. Você vai receber (ou já recebeu) um e-mail da D4Sign, a plataforma de assinatura eletrônica da empresa, com o assunto parecido com "Assinar documento" e o nome do equipamento.',
      '2. Abra esse e-mail e clique em "Assinar documento".',
      '3. Confira o termo, informe seu CPF e confirme. Leva cerca de 1 minuto e pode ser feito pelo celular.',
      '',
      'Assim que você assinar, o Notrole confirma tudo automaticamente e você recebe um e-mail de confirmação.',
      '',
      'Não recebeu o e-mail da D4Sign? Confira a caixa de spam ou lixo eletrônico. Se não estiver lá, procure a TI.',
      '',
      'Atenciosamente,',
      'Equipe de TI',
    ].join('\n'),
  },
};

export class TemplateService {
  /** Cria os templates padrao que ainda nao existem. Roda no boot da API. */
  async garantirPadroes(): Promise<void> {
    const chaves = Object.keys(PADROES) as TipoTemplate[];

    // Quem nunca foi editado (updatedBy vazio) acompanha o texto padrao
    // atual; o que o operador editou fica como esta.
    await Promise.all(
      chaves.map((chave) =>
        prisma.templateEmail.updateMany({
          where: { chave, updatedBy: null },
          data: PADROES[chave],
        }),
      ),
    );

    await Promise.all(
      chaves.map((chave) =>
        prisma.templateEmail.upsert({
          where: { chave },
          create: { chave, ...PADROES[chave] },
          update: {},
        }),
      ),
    );
  }

  listar() {
    return prisma.templateEmail.findMany({ orderBy: { chave: 'asc' } });
  }

  async obter(chave: TipoTemplate) {
    const salvo = await prisma.templateEmail.findUnique({ where: { chave } });
    return salvo ?? { chave, ...PADROES[chave], ativo: true, id: 0, updatedAt: new Date(), updatedBy: null };
  }

  atualizar(
    chave: TipoTemplate,
    dados: { assunto: string; corpo: string; ativo?: boolean },
    usuario?: string,
  ) {
    return prisma.templateEmail.upsert({
      where: { chave },
      create: { chave, ...dados, updatedBy: usuario ?? null },
      update: { ...dados, updatedBy: usuario ?? null },
    });
  }

  restaurarPadrao(chave: TipoTemplate, usuario?: string) {
    return prisma.templateEmail.upsert({
      where: { chave },
      create: { chave, ...PADROES[chave], updatedBy: usuario ?? null },
      update: { ...PADROES[chave], ativo: true, updatedBy: usuario ?? null },
    });
  }

  /** Substitui {variavel} pelos valores e converte quebras de linha em HTML. */
  renderizar(texto: string, variaveis: VariaveisTemplate): string {
    return (
      texto
        .replace(/\{(\w+)\}/g, (original, chave: string) => {
          const valor = variaveis[chave as keyof VariaveisTemplate];
          return valor ?? original;
        })
        // Uma variavel vazia (ex.: {instrucoes_termo} num emprestimo sem termo)
        // deixaria um buraco de linhas em branco no meio do e-mail.
        .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    );
  }

  paraHtml(corpo: string): string {
    const escapado = corpo
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    return [
      '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.6">',
      escapado.replace(/\n/g, '<br>'),
      '</div>',
    ].join('');
  }
}

export const templateService = new TemplateService();
