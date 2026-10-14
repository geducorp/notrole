import React, { useEffect, useState } from 'react';
import { Boxes } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Select } from '@/components/ui/Select';
import { api, ehConflito } from '@/lib/api';
import { moedaParaCampo, normalizarMoeda } from '@/lib/dominio';
import type { Categoria, Empresa, ItemQuantidade } from '@/types';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  categorias: Categoria[];
  empresas: Empresa[];
  registroParaEditar?: ItemQuantidade | null;
  /** Empresa sugerida para um cadastro novo (a do analista). */
  empresaPadraoId?: number | null;
  /** Analista: a empresa e sempre a dele e o campo nao muda. */
  empresaTravada?: boolean;
}

const VAZIO = {
  categoriaId: '',
  empresaId: '',
  descricao: '',
  quantidade: '0',
  estoqueMinimo: '',
  valorUnitario: '',
  observacoes: '',
};

/**
 * Itens controlados por saldo: kit teclado e mouse, headset, adaptador.
 * Aqui so entram categorias marcadas como "por quantidade".
 */
export function QuantidadeModal({
  aberto,
  aoFechar,
  aoSalvar,
  categorias,
  empresas,
  registroParaEditar,
  empresaPadraoId,
  empresaTravada = false,
}: Props) {
  const [campos, setCampos] = useState(VAZIO);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!aberto) return;

    if (registroParaEditar) {
      setCampos({
        categoriaId: String(registroParaEditar.categoriaId),
        empresaId: String(registroParaEditar.empresaId),
        descricao: registroParaEditar.descricao,
        quantidade: String(registroParaEditar.quantidade),
        estoqueMinimo: registroParaEditar.estoqueMinimo !== null ? String(registroParaEditar.estoqueMinimo) : '',
        valorUnitario: moedaParaCampo(registroParaEditar.valorUnitario),
        observacoes: registroParaEditar.observacoes ?? '',
      });
      return;
    }

    setCampos({
      ...VAZIO,
      empresaId: String(empresaPadraoId ?? empresas.find((e) => e.padrao)?.id ?? empresas[0]?.id ?? ''),
      categoriaId: String(categorias.find((c) => c.controle === 'QUANTIDADE')?.id ?? ''),
    });
  }, [aberto, registroParaEditar, empresas, categorias, empresaPadraoId]);

  const alterar = <K extends keyof typeof VAZIO>(campo: K, valor: (typeof VAZIO)[K]) =>
    setCampos((atual) => ({ ...atual, [campo]: valor }));

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setSalvando(true);

    const dados = {
      descricao: campos.descricao.trim(),
      estoqueMinimo: campos.estoqueMinimo === '' ? null : Number(campos.estoqueMinimo),
      valorUnitario: normalizarMoeda(campos.valorUnitario) || null,
      observacoes: campos.observacoes.trim() || null,
    };

    try {
      if (registroParaEditar) {
        // Empresa e categoria nao mudam na edicao (a API recusa): para mudar de
        // empresa existe a transferencia, que fica registrada no extrato.
        await api.put(`/estoque/quantidades/${registroParaEditar.id}`, dados);
        toast.success('Item atualizado.');
      } else {
        await api.post('/estoque/quantidades', {
          ...dados,
          categoriaId: Number(campos.categoriaId),
          empresaId: Number(campos.empresaId),
          quantidade: Number(campos.quantidade),
        });
        toast.success('Item cadastrado.', {
          description: Number(campos.quantidade) > 0 ? 'Saldo registrado como contagem inicial.' : undefined,
        });
      }
      aoSalvar();
      aoFechar();
    } catch (erro) {
      // Mensagem ja exibida pelo interceptor. Em conflito, recarrega a lista.
      if (ehConflito(erro)) aoSalvar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      icone={<Boxes className="h-4 w-4" />}
      titulo={registroParaEditar ? 'Editar periférico' : 'Novo periférico'}
      descricao="Headset, adaptador, kit teclado e mouse: controlados só pela quantidade."
      largura="lg"
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="form-quantidade" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="form-quantidade" onSubmit={enviar} className="space-y-4">
        <Campo rotulo="Descrição" obrigatorio>
          <Input
            value={campos.descricao}
            onChange={(e) => alterar('descricao', e.target.value)}
            required
            maxLength={120}
            placeholder="Kit teclado e mouse Logitech MK270"
            autoFocus
          />
        </Campo>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Categoria"
            obrigatorio
            dica={registroParaEditar ? 'A categoria não muda depois do cadastro.' : undefined}
          >
            <Select
              value={campos.categoriaId}
              onChange={(e) => alterar('categoriaId', e.target.value)}
              disabled={!!registroParaEditar}
            >
              <option value="">Selecione</option>
              {categorias
                .filter((c) => c.controle === 'QUANTIDADE' && (c.ativo || String(c.id) === campos.categoriaId))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
            </Select>
          </Campo>

          <Campo
            rotulo="Empresa"
            obrigatorio
            dica={
              registroParaEditar
                ? 'Para mudar de empresa use a transferência.'
                : empresaTravada
                  ? 'Você cadastra no estoque da sua empresa.'
                  : undefined
            }
          >
            <Select
              value={campos.empresaId}
              onChange={(e) => alterar('empresaId', e.target.value)}
              disabled={!!registroParaEditar || empresaTravada}
            >
              <option value="">Selecione</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.apelido}
                </option>
              ))}
            </Select>
          </Campo>

        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {!registroParaEditar && (
            <Campo rotulo="Quantidade atual" dica="Conte a prateleira agora.">
              <Input
                type="number"
                min={0}
                value={campos.quantidade}
                onChange={(e) => alterar('quantidade', e.target.value)}
              />
            </Campo>
          )}

          <Campo rotulo="Estoque mínimo" dica="Abaixo disto, a tela avisa.">
            <Input
              type="number"
              min={0}
              value={campos.estoqueMinimo}
              onChange={(e) => alterar('estoqueMinimo', e.target.value)}
              placeholder="Opcional"
            />
          </Campo>

          <Campo rotulo="Valor unitário">
            <MoneyInput
              value={campos.valorUnitario}
              onChange={(v) => alterar('valorUnitario', v)}
              maxLength={16}
            />
          </Campo>
        </div>

        <Campo rotulo="Observações">
          <Input
            value={campos.observacoes}
            onChange={(e) => alterar('observacoes', e.target.value)}
            maxLength={500}
            placeholder="Opcional"
          />
        </Campo>

        {registroParaEditar && (
          <p className="rounded-xl bg-slate-50 p-3.5 text-xs text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
            O saldo não é editado aqui: use entrada, saída ou ajuste, que ficam registrados no
            extrato do estoque.
          </p>
        )}
      </form>
    </Modal>
  );
}
