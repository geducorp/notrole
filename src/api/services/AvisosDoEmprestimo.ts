import { type EmprestimoCompleto } from '../repositories/EmprestimoRepository';
import { formatarData } from '../utils/datas';
import { nomeDoItem } from '../utils/itens';
import { emailService } from './EmailService';

/**
 * Os e-mails que o colaborador recebe ao longo de uma cessao (emprestimo ou
 * entrega), num lugar so. Usado pelo EmprestimoService e pelo TermoService.
 *
 * Com termo de comodato, a ordem e:
 *   1. "Termo para assinar" (TERMO_PARA_ASSINAR) - sai junto com o convite do
 *      D4Sign e explica o que e aquele e-mail. Antes, o colaborador recebia so
 *      o convite do D4Sign, sem saber do que se tratava.
 *   2. "Confirmacao" (CONFIRMACAO_EMPRESTIMO / CONFIRMACAO_ENTREGA) - so depois
 *      da assinatura, quando o emprestimo de fato fica ativo.
 * Sem termo, vai so a confirmacao, na hora.
 */

function variaveisBasicas(emprestimo: EmprestimoCompleto) {
  return {
    nome: emprestimo.colaborador.nome,
    hostname: nomeDoItem(emprestimo.item),
    patrimonio: emprestimo.item.patrimonio ?? '-',
    modelo: emprestimo.item.modelo,
  };
}

/** Confirmacao da cessao. `observacaoTermo` vai no lugar de {instrucoes_termo}. */
export function enviarConfirmacao(emprestimo: EmprestimoCompleto, observacaoTermo = '') {
  return emailService.enviarPorTemplate({
    chave: emprestimo.modalidade === 'DEFINITIVA' ? 'CONFIRMACAO_ENTREGA' : 'CONFIRMACAO_EMPRESTIMO',
    destinatario: emprestimo.colaborador.email,
    emprestimoId: emprestimo.id,
    variaveis: {
      ...variaveisBasicas(emprestimo),
      data_emprestimo: formatarData(emprestimo.dataInicio),
      data_entrega: formatarData(emprestimo.dataInicio),
      data_prevista: emprestimo.dataPrevista ? formatarData(emprestimo.dataPrevista) : '-',
      instrucoes_termo: observacaoTermo,
    },
  });
}

/** Explica o convite do D4Sign que o colaborador acabou de receber. */
export function enviarTermoParaAssinar(emprestimo: EmprestimoCompleto) {
  const definitiva = emprestimo.modalidade === 'DEFINITIVA';
  return emailService.enviarPorTemplate({
    chave: 'TERMO_PARA_ASSINAR',
    destinatario: emprestimo.colaborador.email,
    emprestimoId: emprestimo.id,
    variaveis: {
      ...variaveisBasicas(emprestimo),
      tipo_cessao: definitiva ? 'a entrega' : 'o empréstimo',
      linha_prazo: emprestimo.dataPrevista
        ? `Devolução prevista: ${formatarData(emprestimo.dataPrevista)}`
        : 'Entrega definitiva, para uso no seu trabalho (sem prazo de devolução).',
    },
  });
}

/** Mensagem que vai dentro do convite do proprio D4Sign. */
export function mensagemDoConvite(emprestimo: EmprestimoCompleto): string {
  const acao = emprestimo.modalidade === 'DEFINITIVA' ? 'entregue' : 'emprestado';
  return (
    `Termo de Comodato do equipamento ${nomeDoItem(emprestimo.item)} (${emprestimo.item.modelo}), ` +
    `${acao} a você pela equipe de TI. Assine para concluir. Dúvidas: procure a TI.`
  );
}
