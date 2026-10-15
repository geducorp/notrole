import type { CondicaoItem, TipoMovimentacao } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../utils/AppError';
import { diaDeFormulario } from '../utils/datas';
import { ITEM_COM_RELACOES, itemRepository, type FiltroItens } from '../repositories/ItemRepository';
import { estoqueRepository } from '../repositories/EstoqueRepository';
import { emprestimoRepository } from '../repositories/EmprestimoRepository';
import { permissaoService, type UsuarioComPermissao } from './PermissaoService';

export interface DadosItem {
  categoriaId: number;
  empresaId: number;
  hostname?: string | null;
  patrimonio?: string | null;
  marca?: string | null;
  modelo: string;
  condicao?: CondicaoItem;
  observacoes?: string | null;
  valor?: number | null;
  dataEntrada?: string | Date | null;
  paraEmprestimo?: boolean;
  processador?: string | null;
  memoriaGb?: number | null;
  armazenamentoGb?: number | null;
}

/**
 * Movimentacoes que nao contam como historico: so registram a chegada do
 * equipamento. Um item que so tem estas pode ser excluido (cadastro errado);
 * qualquer outra ja e rastreabilidade e exige baixa.
 */
const SO_CADASTRO: TipoMovimentacao[] = ['ENTRADA', 'CONTAGEM_INICIAL'];

export class ItemService {
  listar(filtro?: FiltroItens) {
    return itemRepository.listar(filtro);
  }

  async buscarPorId(id: number, permissao?: UsuarioComPermissao) {
    const item = await itemRepository.buscarPorIdComHistorico(id);
    if (!item) throw AppError.naoEncontrado('Item');
    if (permissao) permissaoService.exigirVisivel(permissao, item.empresaId, 'este equipamento');
    return item;
  }

  /**
   * Cadastra um equipamento e registra a entrada dele no estoque, para que
   * todo item tenha extrato desde o primeiro dia.
   */
  async criar(dados: DadosItem, operador?: string, permissao?: UsuarioComPermissao) {
    if (permissao) permissaoService.exigirEmpresa(permissao, dados.empresaId, 'cadastrar equipamentos');

    const categoria = await estoqueRepository.buscarCategoria(dados.categoriaId);
    if (!categoria) throw AppError.naoEncontrado('Categoria');
    if (categoria.controle !== 'ITEM') {
      throw AppError.conflito(
        `A categoria ${categoria.nome} e controlada por quantidade. ` +
          'Use o estoque por quantidade em vez do cadastro de equipamento.',
      );
    }
    const patrimonio = this.normalizar(dados.patrimonio)?.toUpperCase() ?? null;
    if (categoria.computador && !patrimonio) {
      throw new AppError(`Informe o patrimonio (numero de serie): ${categoria.nome} exige.`, 422);
    }

    // Item e movimentacao de entrada na mesma transacao: estoque e extrato
    // nunca divergem. A situacao inicial e sempre EM_ESTOQUE (default do
    // schema) - ela so muda por movimentacao.
    return prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          categoria: { connect: { id: dados.categoriaId } },
          empresa: { connect: { id: dados.empresaId } },
          hostname: this.normalizar(dados.hostname)?.toUpperCase() ?? null,
          patrimonio,
          // Especificacao so existe em computador.
          ...(categoria.computador ? this.especificacoes(dados) : {}),
          marca: this.normalizar(dados.marca),
          modelo: dados.modelo.trim(),
          condicao: dados.condicao ?? 'NOVO',
          observacoes: this.normalizar(dados.observacoes),
          valor: dados.valor ?? null,
          // "2026-10-09" do formulario vira meio-dia local, nao 21h do dia 8.
          dataEntrada: dados.dataEntrada ? diaDeFormulario(dados.dataEntrada) : new Date(),
          paraEmprestimo: dados.paraEmprestimo ?? false,
        },
        include: ITEM_COM_RELACOES,
      });

      await estoqueRepository.registrarMovimentacao(
        {
          tipo: 'ENTRADA',
          itemId: item.id,
          empresaDestinoId: item.empresaId,
          usuario: operador,
          observacao: null,
        },
        tx,
      );

      return item;
    });
  }

  /**
   * A situacao do equipamento e consequencia do que acontece com ele
   * (emprestimo, entrega, manutencao). Por isso ela nao e editada aqui:
   * quem muda e o EstoqueService, pelas movimentacoes.
   */
  async atualizar(id: number, dados: Partial<DadosItem>, permissao?: UsuarioComPermissao) {
    const atual = await itemRepository.buscarPorId(id);
    if (!atual) throw AppError.naoEncontrado('Item');
    if (permissao) permissaoService.exigirEmpresa(permissao, atual.empresaId, 'editar equipamentos');

    if (dados.empresaId && dados.empresaId !== atual.empresaId) {
      throw AppError.conflito(
        'Para mudar o equipamento de empresa, use a transferencia: ela fica registrada no extrato.',
      );
    }

    // A mesma regra do cadastro: equipamento so vai para categoria por equipamento.
    const categoria = await estoqueRepository.buscarCategoria(dados.categoriaId ?? atual.categoriaId);
    if (!categoria) throw AppError.naoEncontrado('Categoria');
    if (dados.categoriaId && dados.categoriaId !== atual.categoriaId && categoria.controle !== 'ITEM') {
      throw AppError.conflito(
        `A categoria ${categoria.nome} e controlada por quantidade. ` +
          'Um equipamento com numero de serie so pode ficar numa categoria por equipamento.',
      );
    }

    const patrimonio =
      dados.patrimonio !== undefined
        ? (this.normalizar(dados.patrimonio)?.toUpperCase() ?? null)
        : atual.patrimonio;
    if (categoria.computador && !patrimonio) {
      throw new AppError(`Informe o patrimonio (numero de serie): ${categoria.nome} exige.`, 422);
    }

    return itemRepository.atualizar(id, {
      ...(dados.categoriaId ? { categoria: { connect: { id: dados.categoriaId } } } : {}),
      ...(dados.hostname !== undefined
        ? { hostname: this.normalizar(dados.hostname)?.toUpperCase() ?? null }
        : {}),
      ...(dados.patrimonio !== undefined ? { patrimonio } : {}),
      ...(categoria.computador ? this.especificacoes(dados) : {}),
      ...(dados.marca !== undefined ? { marca: this.normalizar(dados.marca) } : {}),
      ...(dados.modelo !== undefined ? { modelo: dados.modelo.trim() } : {}),
      ...(dados.condicao !== undefined ? { condicao: dados.condicao } : {}),
      ...(dados.observacoes !== undefined ? { observacoes: this.normalizar(dados.observacoes) } : {}),
      ...(dados.valor !== undefined ? { valor: dados.valor } : {}),
      ...(dados.dataEntrada ? { dataEntrada: diaDeFormulario(dados.dataEntrada) } : {}),
      ...(dados.paraEmprestimo !== undefined ? { paraEmprestimo: dados.paraEmprestimo } : {}),
    });
  }

  /**
   * Um equipamento com historico nao pode ser apagado: isso apagaria a
   * rastreabilidade de quem esteve com ele. O caminho e dar baixa.
   */
  async remover(id: number, permissao?: UsuarioComPermissao) {
    const item = await itemRepository.buscarPorId(id);
    if (!item) throw AppError.naoEncontrado('Item');
    if (permissao) permissaoService.exigirEmpresa(permissao, item.empresaId, 'excluir equipamentos');

    const emprestimos = await emprestimoRepository.listar({ itemId: id });
    if (emprestimos.length > 0) {
      const emAberto = emprestimos.find(
        (e) => e.status === 'ATIVO' || e.status === 'AGUARDANDO_ASSINATURA',
      );

      if (emAberto) {
        throw AppError.conflito(
          `Este equipamento esta emprestado para ${emAberto.colaborador.nome}. ` +
            'Registre a devolucao antes de remove-lo.',
        );
      }

      throw AppError.conflito(
        `Este equipamento tem ${emprestimos.length} emprestimo(s) no historico e nao pode ser ` +
          'excluido. Use a baixa para tira-lo de circulacao sem perder o historico.',
      );
    }

    if (item.situacao === 'ENTREGUE') {
      throw AppError.conflito(
        `Este equipamento esta com ${item.colaborador?.nome ?? 'um colaborador'}. ` +
          'Registre a devolucao antes de remove-lo.',
      );
    }

    // So o cadastro (ENTRADA/CONTAGEM_INICIAL) pode sumir junto com o item.
    // Com qualquer outra movimentacao, excluir apagaria o extrato - a FK agora
    // e RESTRICT, e a mensagem orienta a baixa.
    return prisma.$transaction(async (tx) => {
      const historico = await tx.movimentacao.count({
        where: { itemId: id, tipo: { notIn: SO_CADASTRO } },
      });
      if (historico > 0) {
        throw AppError.conflito(
          `Este equipamento tem ${historico} movimentacao(oes) no extrato (transferencia, manutencao, ` +
            'entrega...) e nao pode ser excluido. Use a baixa para tira-lo de circulacao sem perder o historico.',
        );
      }
      if ((await tx.emprestimo.count({ where: { itemId: id } })) > 0) {
        throw AppError.conflito(
          'Este equipamento tem cessoes no historico e nao pode ser excluido. Use a baixa.',
        );
      }

      await tx.movimentacao.deleteMany({ where: { itemId: id, tipo: { in: SO_CADASTRO } } });
      return tx.item.delete({ where: { id } });
    });
  }

  private normalizar(valor?: string | null): string | null {
    const texto = valor?.trim();
    return texto ? texto : null;
  }

  /** So os campos de especificacao que vieram (undefined = nao mexe). */
  private especificacoes(dados: Partial<DadosItem>) {
    return {
      ...(dados.processador !== undefined ? { processador: this.normalizar(dados.processador) } : {}),
      ...(dados.memoriaGb !== undefined ? { memoriaGb: dados.memoriaGb ?? null } : {}),
      ...(dados.armazenamentoGb !== undefined ? { armazenamentoGb: dados.armazenamentoGb ?? null } : {}),
    };
  }

}

export const itemService = new ItemService();
