import React, { useEffect, useState } from 'react';
import { Pencil, Plus, Tags } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { iconeDaCategoria, ICONES_DISPONIVEIS } from '@/lib/icones';
import { cn } from '@/lib/utils';
import type { Categoria, TipoControle } from '@/types';

/**
 * Cadastro das categorias do estoque (o que a TI controla). Fica em
 * Configuracoes porque muda pouco.
 */
export function CategoriasPainel() {
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [editando, setEditando] = useState<Categoria | null>(null);
  const [criando, setCriando] = useState(false);

  const carregar = () =>
    api
      .get<Categoria[]>('/estoque/categorias')
      .then(({ data }) => setCategorias(data))
      .catch(() => undefined);

  useEffect(() => {
    void carregar();
  }, []);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Cada categoria é de <b>equipamentos</b>, controlados um a um pelo número de série (notebook,
        monitor), ou de <b>periféricos</b>, controlados só pela quantidade em estoque (headset,
        adaptador, kit teclado e mouse).
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        {categorias.map((c) => {
          const Icone = iconeDaCategoria(c.icone);
          return (
            <div
              key={c.id}
              className={cn(
                'flex items-center gap-3 rounded-xl border p-3 transition-colors',
                c.ativo
                  ? 'border-slate-200/80 dark:border-slate-800'
                  : 'border-dashed border-slate-200 opacity-60 dark:border-slate-800',
              )}
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                <Icone className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{c.nome}</p>
                <p className="text-xs text-slate-500">
                  {c.controle === 'ITEM' ? 'Equipamento · um a um' : 'Periférico · por quantidade'}
                  {c.controle === 'ITEM' ? (c.secaoPropria ? ' · seção própria' : ' · periférico') : ''}
                  {c.controle === 'ITEM' && c.computador ? ' · computador' : ''}
                  {!c.ativo ? ' · inativa' : ''}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" title="Editar" onClick={() => setEditando(c)}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        })}
      </div>

      <Button variant="outline" size="sm" onClick={() => setCriando(true)}>
        <Plus className="mr-1.5 h-3.5 w-3.5" /> Nova categoria
      </Button>

      {(criando || editando) && (
        <CategoriaModal
          categoria={editando}
          aoFechar={() => {
            setCriando(false);
            setEditando(null);
          }}
          aoSalvar={() => {
            setCriando(false);
            setEditando(null);
            void carregar();
          }}
        />
      )}
    </div>
  );
}

function CategoriaModal({
  categoria,
  aoFechar,
  aoSalvar,
}: {
  categoria: Categoria | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [nome, setNome] = useState(categoria?.nome ?? '');
  const [controle, setControle] = useState<TipoControle>(categoria?.controle ?? 'ITEM');
  const [icone, setIcone] = useState(categoria?.icone ?? 'package');
  const [ativo, setAtivo] = useState(categoria?.ativo ?? true);
  const [secaoPropria, setSecaoPropria] = useState(categoria?.secaoPropria ?? false);
  const [computador, setComputador] = useState(categoria?.computador ?? false);
  const [salvando, setSalvando] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      // Acessorio por quantidade sempre fica em Perifericos.
      const dados = {
        nome: nome.trim(),
        controle,
        icone,
        ativo,
        secaoPropria: controle === 'ITEM' && secaoPropria,
        computador: controle === 'ITEM' && computador,
      };
      if (categoria) await api.put(`/estoque/categorias/${categoria.id}`, dados);
      else await api.post('/estoque/categorias', dados);
      toast.success('Categoria salva.');
      aoSalvar();
    } catch {
      // Mensagem ja exibida pelo interceptor.
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      icone={<Tags className="h-4 w-4" />}
      titulo={categoria ? 'Editar categoria' : 'Nova categoria'}
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="form-categoria" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="form-categoria" onSubmit={enviar} className="space-y-4">
        <Campo rotulo="Nome" obrigatorio>
          <Input value={nome} onChange={(e) => setNome(e.target.value)} required maxLength={60} autoFocus />
        </Campo>

        <Campo
          rotulo="Tipo"
          dica={
            categoria
              ? 'Só dá para mudar enquanto a categoria não tiver equipamento cadastrado.'
              : 'Equipamento: notebook, monitor. Periférico: headset, adaptador.'
          }
        >
          <div role="radiogroup" className="grid grid-cols-2 gap-2">
            {(
              [
                { valor: 'ITEM' as TipoControle, titulo: 'Equipamento', descricao: 'Um a um, com número de série' },
                { valor: 'QUANTIDADE' as TipoControle, titulo: 'Periférico', descricao: 'Só a quantidade em estoque' },
              ]
            ).map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={controle === o.valor}
                onClick={() => setControle(o.valor)}
                className={cn(
                  'rounded-xl border p-3 text-left transition-all',
                  controle === o.valor
                    ? 'border-indigo-500 bg-indigo-50 ring-3 ring-indigo-500/20 dark:border-indigo-500/70 dark:bg-indigo-500/10'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40',
                )}
              >
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{o.titulo}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{o.descricao}</span>
              </button>
            ))}
          </div>
        </Campo>

        <Campo rotulo="Ícone">
          <div className="flex flex-wrap gap-1.5">
            {ICONES_DISPONIVEIS.map((nomeIcone) => {
              const Icone = iconeDaCategoria(nomeIcone);
              return (
                <button
                  key={nomeIcone}
                  type="button"
                  onClick={() => setIcone(nomeIcone)}
                  title={nomeIcone}
                  className={cn(
                    'flex h-9 w-9 items-center justify-center rounded-lg ring-1 ring-inset transition-colors',
                    icone === nomeIcone
                      ? 'bg-indigo-50 text-indigo-600 ring-indigo-300 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/40'
                      : 'text-slate-500 ring-slate-200 hover:bg-slate-50 dark:text-slate-400 dark:ring-slate-800 dark:hover:bg-slate-800/60',
                  )}
                >
                  <Icone className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </Campo>

        {controle === 'ITEM' && (
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={secaoPropria}
              onChange={(e) => setSecaoPropria(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              Seção própria no estoque
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Para equipamentos principais, como notebook e monitor. Sem isso, a categoria fica em
                Periféricos.
              </span>
            </span>
          </label>
        )}

        {controle === 'ITEM' && (
          <label className="flex cursor-pointer items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
            <input
              type="checkbox"
              checked={computador}
              onChange={(e) => setComputador(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span>
              Computador
              <span className="block text-xs text-slate-500 dark:text-slate-400">
                Para notebook e desktop: número de série obrigatório, hostname e especificações
                (processador, memória, armazenamento). Sem hostname, aparece como pendente de formatação.
              </span>
            </span>
          </label>
        )}

        <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
          <input
            type="checkbox"
            checked={ativo}
            onChange={(e) => setAtivo(e.target.checked)}
            className="h-4 w-4 accent-indigo-600"
          />
          Ativa (aparece na hora de cadastrar equipamento)
        </label>
      </form>
    </Modal>
  );
}

