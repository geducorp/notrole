import React, { useEffect, useRef, useState } from 'react';
import { PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { DateInput } from '@/components/ui/DateInput';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { MoneyInput } from '@/components/ui/MoneyInput';
import { Select } from '@/components/ui/Select';
import { api, ehConflito } from '@/lib/api';
import { hojeParaInputDate, moedaParaCampo, normalizarMoeda, paraInputDate } from '@/lib/dominio';
import { cn } from '@/lib/utils';
import type { Categoria, CondicaoItem, Empresa, Item } from '@/types';

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  categorias: Categoria[];
  empresas: Empresa[];
  itemParaEditar?: Item | null;
  /** Empresa sugerida para um cadastro novo (a do analista). */
  empresaPadraoId?: number | null;
  /** Analista: a empresa e sempre a dele e o campo nao muda. */
  empresaTravada?: boolean;
  /** Categoria sugerida para um cadastro novo (a da aba aberta no Estoque). */
  categoriaPadraoId?: number | null;
}

/**
 * Formulario em branco. E uma funcao (e nao uma constante) para que a data de
 * entrada seja o "hoje" de quando o modal abre - uma constante guardava o dia em
 * que a pagina foi carregada, e a aba fica aberta por dias.
 */
const vazio = () => ({
  categoriaId: '',
  empresaId: '',
  hostname: '',
  patrimonio: '',
  marca: '',
  modelo: '',
  condicao: 'NOVO' as CondicaoItem,
  valor: '',
  dataEntrada: hojeParaInputDate(),
  paraEmprestimo: false,
  observacoes: '',
});

type Campos = ReturnType<typeof vazio>;

/** Aceita so 'yyyy-mm-dd' puro; qualquer outra coisa vira undefined. */
function dataPura(valor: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(valor) ? valor : undefined;
}

export function ItemModal({
  aberto,
  aoFechar,
  aoSalvar,
  categorias,
  empresas,
  itemParaEditar,
  empresaPadraoId,
  empresaTravada = false,
  categoriaPadraoId,
}: Props) {
  const [campos, setCampos] = useState<Campos>(vazio);
  const [salvando, setSalvando] = useState(false);
  // Data de entrada como foi carregada na edicao: so mandamos a data de volta se
  // o operador mudou, para nao regravar (e deslocar) a data por fuso.
  const dataEntradaOriginal = useRef('');

  useEffect(() => {
    if (!aberto) return;

    if (itemParaEditar) {
      dataEntradaOriginal.current = paraInputDate(itemParaEditar.dataEntrada);
      setCampos({
        categoriaId: String(itemParaEditar.categoriaId),
        empresaId: String(itemParaEditar.empresaId),
        hostname: itemParaEditar.hostname ?? '',
        patrimonio: itemParaEditar.patrimonio ?? '',
        marca: itemParaEditar.marca ?? '',
        modelo: itemParaEditar.modelo,
        condicao: itemParaEditar.condicao,
        valor: moedaParaCampo(itemParaEditar.valor),
        dataEntrada: dataEntradaOriginal.current,
        paraEmprestimo: itemParaEditar.paraEmprestimo,
        observacoes: itemParaEditar.observacoes ?? '',
      });
      return;
    }

    const empresa = empresaPadraoId ?? empresas.find((e) => e.padrao)?.id ?? empresas[0]?.id;
    dataEntradaOriginal.current = '';
    setCampos({
      ...vazio(),
      empresaId: empresa ? String(empresa) : '',
      categoriaId: String(categoriaPadraoId ?? categorias.find((c) => c.controle === 'ITEM')?.id ?? ''),
    });
  }, [aberto, itemParaEditar, empresas, categorias, empresaPadraoId, categoriaPadraoId]);

  const alterar = <K extends keyof Campos>(campo: K, valor: Campos[K]) =>
    setCampos((atual) => ({ ...atual, [campo]: valor }));

  const categoria = categorias.find((c) => String(c.id) === campos.categoriaId) ?? null;
  // Hostname so faz sentido para equipamento que entra na rede.
  const pedeHostname = categoria?.nome.toLowerCase().includes('notebook') ?? false;

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    if (!campos.categoriaId || !campos.empresaId) {
      toast.error('Escolha a categoria e a empresa.');
      return;
    }

    // Na edicao, a data so vai se mudou; no cadastro, vai sempre que preenchida.
    const dataMudou = !itemParaEditar || campos.dataEntrada !== dataEntradaOriginal.current;

    const dados = {
      categoriaId: Number(campos.categoriaId),
      empresaId: Number(campos.empresaId),
      hostname: campos.hostname.trim() || null,
      patrimonio: campos.patrimonio.trim() || null,
      marca: campos.marca.trim() || null,
      modelo: campos.modelo.trim(),
      condicao: campos.condicao,
      valor: normalizarMoeda(campos.valor) || null,
      dataEntrada: dataMudou ? dataPura(campos.dataEntrada) : undefined,
      paraEmprestimo: campos.paraEmprestimo,
      observacoes: campos.observacoes.trim() || null,
    };

    setSalvando(true);
    try {
      if (itemParaEditar) {
        await api.put(`/itens/${itemParaEditar.id}`, dados);
        toast.success('Equipamento atualizado.');
      } else {
        await api.post('/itens', dados);
        toast.success('Equipamento cadastrado.', { description: 'Entrada registrada no estoque.' });
      }
      aoSalvar();
      aoFechar();
    } catch (erro) {
      // Mensagem ja exibida pelo interceptor. Em conflito, recarrega a lista
      // (o formulario continua aberto com o que foi digitado).
      if (ehConflito(erro)) aoSalvar();
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={aoFechar}
      icone={<PackagePlus className="h-4 w-4" />}
      titulo={itemParaEditar ? 'Editar equipamento' : 'Novo equipamento'}
      descricao={itemParaEditar ? undefined : 'Um registro por equipamento, com número de série.'}
      largura="xl"
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="form-item" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="form-item" onSubmit={enviar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Categoria" obrigatorio>
            <Select
              value={campos.categoriaId}
              onChange={(e) => alterar('categoriaId', e.target.value)}
              disabled={!!itemParaEditar}
            >
              <option value="">Selecione</option>
              {categorias
                .filter((c) => c.controle === 'ITEM' && (c.ativo || String(c.id) === campos.categoriaId))
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
              itemParaEditar
                ? 'Use a transferência para mudar.'
                : empresaTravada
                  ? 'Você cadastra no estoque da sua empresa.'
                  : undefined
            }
          >
            <Select
              value={campos.empresaId}
              onChange={(e) => alterar('empresaId', e.target.value)}
              disabled={!!itemParaEditar || empresaTravada}
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

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Marca" obrigatorio>
            <Input
              value={campos.marca}
              onChange={(e) => alterar('marca', e.target.value)}
              required
              maxLength={64}
              placeholder="Dell"
            />
          </Campo>
          <Campo rotulo="Modelo" obrigatorio>
            <Input
              value={campos.modelo}
              onChange={(e) => alterar('modelo', e.target.value)}
              required
              maxLength={120}
              placeholder="Latitude 5440"
            />
          </Campo>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Campo
            rotulo="Patrimônio (número de série)"
            obrigatorio
            dica="Service Tag do fabricante. Vai no termo de comodato e é por ele que o equipamento é conferido."
          >
            <Input
              value={campos.patrimonio}
              onChange={(e) => alterar('patrimonio', e.target.value)}
              required
              maxLength={64}
              placeholder="7XK2L93"
              className="font-mono"
            />
          </Campo>
          {pedeHostname && (
            <Campo rotulo="Hostname" dica="Nome na rede.">
              <Input
                value={campos.hostname}
                onChange={(e) => alterar('hostname', e.target.value)}
                maxLength={64}
                placeholder="NB-EMPRESTIMO-01"
                className="font-mono"
              />
            </Campo>
          )}
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Condição">
            <div role="radiogroup" className="grid grid-cols-2 gap-2">
              {(['NOVO', 'USADO'] as CondicaoItem[]).map((condicao) => (
                <button
                  key={condicao}
                  type="button"
                  role="radio"
                  aria-checked={campos.condicao === condicao}
                  onClick={() => alterar('condicao', condicao)}
                  className={cn(
                    'h-9 rounded-lg border text-sm font-medium transition-all',
                    campos.condicao === condicao
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700 ring-3 ring-indigo-500/20 dark:border-indigo-500/70 dark:bg-indigo-500/10 dark:text-indigo-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-400 dark:hover:bg-slate-800/40',
                  )}
                >
                  {condicao === 'NOVO' ? 'Novo' : 'Usado'}
                </button>
              ))}
            </div>
          </Campo>

          <Campo rotulo="Valor" dica="Exigido no termo de comodato.">
            <MoneyInput value={campos.valor} onChange={(v) => alterar('valor', v)} maxLength={16} />
          </Campo>

          <Campo rotulo="Data de entrada">
            <DateInput value={campos.dataEntrada} onChange={(v) => alterar('dataEntrada', v)} />
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

        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
          <input
            type="checkbox"
            checked={campos.paraEmprestimo}
            onChange={(e) => alterar('paraEmprestimo', e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-indigo-600"
          />
          <span className="text-sm">
            <span className="font-medium text-slate-900 dark:text-slate-100">
              Disponível para empréstimo
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              Aparece na lista de equipamentos que podem ser emprestados a colaboradores, com termo
              de comodato.
            </span>
          </span>
        </label>
      </form>
    </Modal>
  );
}
