import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownUp,
  Boxes,
  Cable,
  Download,
  FileSpreadsheet,
  Building2,
  Package,
  Plus,
  Search,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { PageHeader } from '@/components/ui/PageHeader';
import { ImportacaoModal } from '@/components/ImportacaoModal';
import { AvisoEstoqueBaixo } from '@/components/AvisoEstoqueBaixo';
import { ItemFichaModal } from '@/components/ItemFichaModal';
import { ItemModal } from '@/components/ItemModal';
import { QuantidadeModal } from '@/components/QuantidadeModal';
import { api, baixarArquivo, ehConflito } from '@/lib/api';
import {
  CLASSE_CONDICAO_ITEM,
  CLASSE_SITUACAO_ITEM,
  especificacoesDoItem,
  formatarDataHora,
  formatarMoeda,
  nomeDoItem,
  pendenteDeFormatacao,
  ROTULO_CONDICAO_ITEM,
  ROTULO_MOVIMENTACAO,
  ROTULO_SITUACAO_ITEM,
  TOM,
} from '@/lib/dominio';
import { iconeDaCategoria } from '@/lib/icones';
import { usePerfil } from '@/lib/perfil';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  Categoria,
  Empresa,
  Item,
  ItemQuantidade,
  Movimentacao,
  ResumoEstoque,
  SetorComEquipamentos,
  SituacaoItem,
} from '@/types';
import { FiltroEmpresa, NomeEmpresa } from '@/components/ui/Empresa';

/**
 * Abas do estoque. Cada equipamento principal (categoria com "secao propria")
 * tem a sua, e ela so aparece quando ja existe equipamento daquele tipo. O resto
 * (perifericos com numero de serie e acessorios por quantidade) fica junto em
 * "Perifericos".
 */
type Aba = 'geral' | 'perifericos' | 'setores' | 'movimentacoes' | `categoria-${number}`;

const abaDaCategoria = (id: number): Aba => `categoria-${id}`;

function categoriaDaAba(aba: Aba): number | null {
  return aba.startsWith('categoria-') ? Number(aba.slice('categoria-'.length)) : null;
}

/**
 * Estoque e o que esta com a TI: na prateleira, reservado ou em manutencao.
 * Entregue e emprestado aparecem em Entregas e Emprestimos (decisao do
 * usuario: "ele nao e estoque"); baixado saiu de circulacao.
 */
const SITUACOES_DO_ESTOQUE: SituacaoItem[] = ['EM_ESTOQUE', 'RESERVADO', 'MANUTENCAO'];

/**
 * Nome da aba no plural, como "Periféricos": Notebook -> Notebooks, Monitor ->
 * Monitores, Celular -> Celulares. A categoria e cadastrada no singular.
 */
function plural(nome: string): string {
  const palavras = nome.trim().split(/\s+/);
  const ultima = palavras.pop() ?? '';
  // "Memória RAM", "TV": sigla no fim fica como esta.
  if (!ultima || /^[A-Z0-9]+$/.test(ultima) || /s$/i.test(ultima)) return nome;
  let noPlural: string;
  if (/ão$/i.test(ultima)) noPlural = ultima.replace(/ão$/i, 'ões');
  else if (/[rz]$/i.test(ultima)) noPlural = `${ultima}es`;
  else if (/m$/i.test(ultima)) noPlural = ultima.replace(/m$/i, 'ns');
  else if (/[aeou]l$/i.test(ultima)) noPlural = ultima.replace(/l$/i, 'is');
  else noPlural = `${ultima}s`;
  return [...palavras, noPlural].join(' ');
}

function contarNoEstoque(resumo: ResumoEstoque | null, categoria: string): number {
  return (resumo?.porCategoriaESituacao ?? [])
    .filter((l) => l.categoria === categoria && SITUACOES_DO_ESTOQUE.includes(l.situacao))
    .reduce((soma, l) => soma + l.total, 0);
}

export function Estoque() {
  const perfil = usePerfil();
  const [aba, setAba] = useState<Aba>('geral');
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [resumo, setResumo] = useState<ResumoEstoque | null>(null);

  const [itens, setItens] = useState<Item[]>([]);
  const [quantidades, setQuantidades] = useState<ItemQuantidade[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<Movimentacao[]>([]);
  const [setores, setSetores] = useState<SetorComEquipamentos[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [busca, setBusca] = useState('');
  const [empresaId, setEmpresaId] = useState('');
  /** Atalho de categoria dentro de Perifericos. */
  const [categoriaId, setCategoriaId] = useState('');
  /** Visao geral mostrando os baixados (fora do estoque), em vez do estoque. */
  const [verBaixados, setVerBaixados] = useState(false);

  const [itemModal, setItemModal] = useState<{ aberto: boolean; item: Item | null }>({
    aberto: false,
    item: null,
  });
  const [quantidadeModal, setQuantidadeModal] = useState<{ aberto: boolean; registro: ItemQuantidade | null }>({
    aberto: false,
    registro: null,
  });
  const [fichaDe, setFichaDe] = useState<number | null>(null);
  const [saldoDe, setSaldoDe] = useState<{ registro: ItemQuantidade; tipo: 'entrada' | 'saida' | 'ajuste' } | null>(
    null,
  );
  const [baixando, setBaixando] = useState(false);
  const [importando, setImportando] = useState(false);

  useEffect(() => {
    void Promise.all([
      api.get<Categoria[]>('/estoque/categorias').then(({ data }) => setCategorias(data)),
      api.get<Empresa[]>('/empresas').then(({ data }) => setEmpresas(data.filter((e) => e.ativo))),
    ]).catch(() => undefined);
  }, []);

  const categoriaAberta = categoriaDaAba(aba);

  // Categorias de Perifericos: equipamentos sem secao propria e acessorios.
  const perifericosItem = useMemo(
    () => categorias.filter((c) => c.controle === 'ITEM' && !c.secaoPropria),
    [categorias],
  );
  const perifericosQuantidade = useMemo(() => categorias.filter((c) => c.controle === 'QUANTIDADE'), [categorias]);

  // Equipamentos principais: aba fixa para cada categoria ativa com secao
  // propria, mesmo vazia (antes so aparecia depois do primeiro cadastro, e o
  // estoque zerado nao mostrava onde cadastrar).
  const principais = useMemo(
    () =>
      categorias.filter(
        (c) => c.controle === 'ITEM' && c.secaoPropria && (c.ativo || c.id === categoriaAberta),
      ),
    [categorias, categoriaAberta],
  );

  // Atalhos de Perifericos: equipamento so aparece se houver algum no estoque
  // (mesma conta da lista, sem os entregues); periferico por quantidade, se ativo.
  const chipsPerifericos = useMemo(
    () => [
      ...perifericosItem.filter((c) => contarNoEstoque(resumo, c.nome) > 0),
      ...perifericosQuantidade.filter((c) => c.ativo),
    ],
    [perifericosItem, perifericosQuantidade, resumo],
  );

  // O atalho escolhido sumiu (ex.: o ultimo equipamento foi entregue): volta para "Todos".
  useEffect(() => {
    if (!categoriaId || !resumo) return;
    if (chipsPerifericos.length < 2 || !chipsPerifericos.some((c) => String(c.id) === categoriaId)) {
      setCategoriaId('');
    }
  }, [categoriaId, chipsPerifericos, resumo]);

  // Dentro de Perifericos, o atalho escolhido diz qual das duas listas mostrar.
  const atalho = categorias.find((c) => String(c.id) === categoriaId);
  const mostrarItensPerifericos = !atalho || atalho.controle === 'ITEM';
  const mostrarQuantidades = !atalho || atalho.controle === 'QUANTIDADE';

  // Numero da carga mais recente: ao trocar filtro rapido, a resposta de uma
  // carga anterior que chegue depois e descartada (senao a lista mostrava o
  // filtro antigo).
  const cargaAtual = useRef(0);

  const carregar = useCallback(async () => {
    const minhaCarga = ++cargaAtual.current;
    const vigente = () => minhaCarga === cargaAtual.current;
    setCarregando(true);
    const params = {
      ...(busca.trim() ? { busca: busca.trim() } : {}),
      ...(empresaId ? { empresaId } : {}),
    };
    const paramsItens = { ...params, situacoes: SITUACOES_DO_ESTOQUE.join(',') };
    const paramsGeral = verBaixados ? { ...params, situacoes: 'BAIXADO' } : paramsItens;
    const doAtalho = categoriaId ? { categoriaId } : {};

    const carregarLista = (): Promise<unknown> => {
      if (aba === 'geral') {
        return api.get<Item[]>('/itens', { params: paramsGeral }).then(({ data }) => vigente() && setItens(data));
      }
      if (categoriaAberta !== null) {
        return api
          .get<Item[]>('/itens', { params: { ...paramsItens, categoriaId: categoriaAberta } })
          .then(({ data }) => vigente() && setItens(data));
      }
      if (aba === 'perifericos') {
        return Promise.all([
          mostrarItensPerifericos
            ? api
                .get<Item[]>('/itens', {
                  params: {
                    ...paramsItens,
                    ...doAtalho,
                    secaoPropria: 'false',
                  },
                })
                .then(({ data }) => vigente() && setItens(data))
            : (setItens([]), null),
          mostrarQuantidades
            ? api
                .get<ItemQuantidade[]>('/estoque/quantidades', { params: { ...params, ...doAtalho } })
                .then(({ data }) => vigente() && setQuantidades(data))
            : (setQuantidades([]), null),
        ]);
      }
      if (aba === 'setores') {
        return api
          .get<SetorComEquipamentos[]>('/estoque/por-setor', { params: empresaId ? { empresaId } : {} })
          .then(({ data }) => vigente() && setSetores(data));
      }
      if (aba === 'movimentacoes') {
        return api
          .get<Movimentacao[]>('/estoque/movimentacoes', {
            params: { ...(empresaId ? { empresaId } : {}), limite: 100 },
          })
          .then(({ data }) => vigente() && setMovimentacoes(data));
      }
      return Promise.resolve();
    };

    try {
      const [, resumoResp] = await Promise.all([
        carregarLista(),
        api.get<ResumoEstoque>('/estoque/resumo', { params: empresaId ? { empresaId } : {} }),
      ]);
      if (vigente()) setResumo(resumoResp.data);
    } catch {
      // Mensagem ja exibida pelo interceptor.
    } finally {
      if (vigente()) setCarregando(false);
    }
  }, [aba, categoriaAberta, busca, empresaId, categoriaId, verBaixados, mostrarItensPerifericos, mostrarQuantidades]);

  useEffect(() => {
    const t = setTimeout(() => void carregar(), 300);
    return () => clearTimeout(t);
  }, [carregar]);

  const baixarRelatorio = async () => {
    setBaixando(true);
    try {
      // Mesmos filtros da tela: empresa e categoria (a da aba ou o atalho). Em
      // Perifericos sem atalho, o PDF sai com todas as categorias.
      const categoriaDoFiltro = categoriaAberta !== null ? String(categoriaAberta) : categoriaId;
      const filtros = new URLSearchParams({
        ...(empresaId ? { empresaId } : {}),
        ...(categoriaDoFiltro ? { categoriaId: categoriaDoFiltro } : {}),
      }).toString();
      await baixarArquivo(`/relatorios/pdf/estoque${filtros ? `?${filtros}` : ''}`, 'estoque-ti.pdf');
    } catch {
      // Mensagem ja exibida.
    } finally {
      setBaixando(false);
    }
  };

  // Busca e atalho sao de cada lista; nao passam de uma aba a outra. A lista
  // e limpa na hora: senao a aba nova mostrava a anterior ate a carga chegar.
  const trocarAba = (nova: Aba) => {
    // Clique na aba ja aberta: nada muda, e limpar a lista aqui a deixava em
    // "Carregando..." para sempre (carregar nao roda de novo).
    if (nova === aba) return;
    setAba(nova);
    setCategoriaId('');
    setBusca('');
    setVerBaixados(false);
    setItens([]);
    setQuantidades([]);
    setCarregando(true);
  };

  const nomeDaAberta = plural(categorias.find((c) => c.id === categoriaAberta)?.nome ?? '');
  const listaDeEquipamentos = aba === 'geral' || categoriaAberta !== null;
  const comLista = listaDeEquipamentos || aba === 'perifericos';

  const abas: Array<{ id: Aba; rotulo: string; quantidade?: number; Icone?: LucideIcon; separar?: boolean }> = [
    { id: 'geral', rotulo: 'Visão geral' },
    ...principais.map((c) => ({
      id: abaDaCategoria(c.id),
      rotulo: plural(c.nome),
      // So o que esta com a TI; entregue e emprestado ficam em Entregas e Emprestimos.
      quantidade: contarNoEstoque(resumo, c.nome),
      Icone: iconeDaCategoria(c.icone),
    })),
    { id: 'perifericos', rotulo: 'Periféricos', Icone: Cable },
    { id: 'setores', rotulo: 'Por setor', separar: true },
    { id: 'movimentacoes', rotulo: 'Movimentações' },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={nomeDaAberta ? `Estoque · ${nomeDaAberta}` : aba === 'perifericos' ? 'Estoque · Periféricos' : 'Estoque'}
        descricao={
          perfil && !perfil.admin && perfil.empresa
            ? `Equipamentos de TI da ${perfil.empresa}: o que tem e onde está.`
            : 'Equipamentos de TI de todas as empresas: o que tem e onde está.'
        }
        acoes={
          <>
            <Button variant="outline" onClick={() => setImportando(true)} className="flex-1 sm:flex-none">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Contagem inicial
            </Button>
            <Button variant="outline" onClick={baixarRelatorio} disabled={baixando} className="flex-1 sm:flex-none">
              <Download className="mr-2 h-4 w-4" />
              {baixando ? 'Gerando...' : 'Relatório'}
            </Button>
            {aba === 'perifericos' ? (
              <Button
                onClick={() => setQuantidadeModal({ aberto: true, registro: null })}
                className="flex-1 sm:flex-none"
              >
                <Plus className="mr-2 h-4 w-4" /> Novo periférico
              </Button>
            ) : (
              <Button onClick={() => setItemModal({ aberto: true, item: null })} className="flex-1 sm:flex-none">
                <Plus className="mr-2 h-4 w-4" /> Novo equipamento
              </Button>
            )}
          </>
        }
      />

      <div className="border-b border-slate-200/80 dark:border-slate-800">
        <nav className="-mb-px flex items-end gap-6 overflow-x-auto" aria-label="Seções do estoque">
          {abas.map((a) => (
            <div key={a.id} className="flex items-end gap-6">
              {a.separar && <span aria-hidden className="mb-3 h-4 w-px bg-slate-200 dark:bg-slate-700" />}
              <button
                type="button"
                onClick={() => trocarAba(a.id)}
                aria-current={aba === a.id ? 'page' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-0.5 pb-2.5 text-sm font-medium transition-colors',
                  aba === a.id
                    ? 'border-indigo-500 text-indigo-600 dark:border-indigo-400 dark:text-indigo-300'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800 dark:text-slate-400 dark:hover:border-slate-600 dark:hover:text-slate-200',
                )}
              >
                {a.Icone && <a.Icone className="h-4 w-4 shrink-0" />}
                {a.rotulo}
                {a.quantidade !== undefined && (
                  <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {a.quantidade}
                  </span>
                )}
              </button>
            </div>
          ))}
        </nav>
      </div>

      {/* Os numeros do estoque ficam no Dashboard; aqui so o aviso que pede acao. */}
      {resumo && (aba === 'geral' || aba === 'perifericos') && <AvisoEstoqueBaixo itens={resumo.abaixoDoMinimo} />}

      <div className="space-y-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
          {comLista && (
            <div className="relative flex-1 lg:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder={aba === 'perifericos' ? 'Descrição...' : 'Hostname, série ou modelo...'}
                className="pl-9"
              />
            </div>
          )}
          {/* So o administrador escolhe a empresa: o analista ve sempre a dele (o servidor impoe). */}
          {perfil?.admin && (
            <FiltroEmpresa empresas={empresas} valor={empresaId} aoMudar={setEmpresaId} className="self-start lg:self-auto" />
          )}
        </div>

        {aba === 'perifericos' && (
          <ChipsDeCategoria
            categorias={chipsPerifericos}
            contar={(nome) => contarNoEstoque(resumo, nome)}
            escolhida={categoriaId}
            aoEscolher={setCategoriaId}
          />
        )}
      </div>

      {listaDeEquipamentos && (
        <TabelaEquipamentos
          itens={itens}
          carregando={carregando}
          aoAbrir={(id) => setFichaDe(id)}
          mostrarCategoria={aba === 'geral'}
          vazio={
            busca.trim()
              ? 'Nenhum equipamento encontrado.'
              : verBaixados
                ? 'Nenhum equipamento baixado.'
                : 'Nada em estoque.'
          }
        />
      )}

      {/* Baixados nao sao estoque, mas a ficha deles precisa continuar acessivel. */}
      {aba === 'geral' && (verBaixados || (resumo?.itens.baixados ?? 0) > 0) && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => {
              setVerBaixados((atual) => !atual);
              setItens([]);
              setCarregando(true);
            }}
            className="text-xs text-slate-500 underline-offset-2 hover:text-indigo-600 hover:underline dark:text-slate-400 dark:hover:text-indigo-400"
          >
            {verBaixados ? 'Voltar ao estoque' : `Ver equipamentos baixados (${resumo?.itens.baixados ?? 0})`}
          </button>
        </div>
      )}

      {aba === 'perifericos' && (
        <div className="space-y-6">
          {mostrarQuantidades && (
            <TabelaQuantidades
              registros={quantidades}
              carregando={carregando}
              aoEditar={(registro) => setQuantidadeModal({ aberto: true, registro })}
              aoMovimentar={(registro, tipo) => setSaldoDe({ registro, tipo })}
            />
          )}
          {/*
            Periferico costuma ser por quantidade. Os de categoria "um a um"
            sem secao propria sao excecao: so aparecem aqui se existirem, para
            nao sumirem da tela.
          */}
          {/*
            Com o atalho de uma categoria "um a um", a tabela aparece sempre
            (com carregando e vazio); sem atalho, so se houver algum.
          */}
          {mostrarItensPerifericos && (atalho?.controle === 'ITEM' || itens.length > 0) && (
            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Com número de série</h2>
              <TabelaEquipamentos
                itens={itens}
                carregando={carregando}
                aoAbrir={(id) => setFichaDe(id)}
                mostrarCategoria
              />
            </section>
          )}
        </div>
      )}

      {aba === 'setores' && <PorSetor setores={setores} carregando={carregando} />}

      {aba === 'movimentacoes' && <TabelaMovimentacoes movimentacoes={movimentacoes} carregando={carregando} />}

      <ImportacaoModal
        aberto={importando}
        aoFechar={() => setImportando(false)}
        aoImportar={() => void carregar()}
      />

      <ItemModal
        aberto={itemModal.aberto}
        aoFechar={() => setItemModal({ aberto: false, item: null })}
        aoSalvar={() => void carregar()}
        categorias={categorias}
        empresas={empresas}
        itemParaEditar={itemModal.item}
        empresaPadraoId={perfil?.empresaId}
        empresaTravada={!!perfil && !perfil.admin}
        categoriaPadraoId={categoriaAberta}
      />

      <QuantidadeModal
        aberto={quantidadeModal.aberto}
        aoFechar={() => setQuantidadeModal({ aberto: false, registro: null })}
        aoSalvar={() => void carregar()}
        categorias={categorias}
        empresas={empresas}
        registroParaEditar={quantidadeModal.registro}
        empresaPadraoId={perfil?.empresaId}
        empresaTravada={!!perfil && !perfil.admin}
      />

      <ItemFichaModal
        itemId={fichaDe}
        aoFechar={() => setFichaDe(null)}
        aoMudar={() => void carregar()}
        aoEditar={(item) => {
          setFichaDe(null);
          setItemModal({ aberto: true, item });
        }}
        empresas={empresas}
      />

      {saldoDe && (
        <MovimentarSaldo
          registro={saldoDe.registro}
          tipo={saldoDe.tipo}
          aoFechar={() => setSaldoDe(null)}
          aoConcluir={() => {
            setSaldoDe(null);
            void carregar();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * Atalhos por categoria dentro de Perifericos. As categorias ja chegam
 * filtradas; equipamentos "um a um" mostram quantos estao no estoque.
 */
function ChipsDeCategoria({
  categorias,
  contar,
  escolhida,
  aoEscolher,
}: {
  categorias: Categoria[];
  contar: (categoria: string) => number;
  escolhida: string;
  aoEscolher: (id: string) => void;
}) {
  if (categorias.length < 2) return null;

  const chip = (id: string, rotulo: string, quantidade: number | null, Icone?: LucideIcon) => (
    <button
      key={id || 'todas'}
      type="button"
      onClick={() => aoEscolher(id)}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-all',
        escolhida === id
          ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:border-indigo-500/70 dark:bg-indigo-500/10 dark:text-indigo-300'
          : 'border-slate-200/80 text-slate-600 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-800/40',
      )}
    >
      {Icone && <Icone className="h-3.5 w-3.5 shrink-0" />}
      <span>{rotulo}</span>
      {quantidade !== null && (
        <span
          className={cn(
            'rounded-md px-1.5 py-0.5 text-xs font-semibold tabular-nums',
            escolhida === id
              ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-200'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
          )}
        >
          {quantidade}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex flex-wrap gap-2">
      {chip('', 'Todos', null)}
      {categorias.map((c) =>
        chip(
          String(c.id),
          c.nome,
          c.controle === 'ITEM' ? contar(c.nome) : null,
          iconeDaCategoria(c.icone),
        ),
      )}
    </div>
  );
}

/** Quem está com o quê, agrupado por setor. */
function PorSetor({ setores, carregando }: { setores: SetorComEquipamentos[]; carregando: boolean }) {
  if (carregando) return <p className="py-10 text-center text-sm text-slate-500">Carregando...</p>;

  if (setores.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-800">
        Nenhum equipamento está com colaborador no momento.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {setores.map((setor) => (
        <div
          key={setor.departamento}
          className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:border-slate-800/80 dark:bg-slate-900/40"
        >
          <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-300">
              <Building2 className="h-4 w-4" />
            </div>
            <p className="font-medium text-slate-900 dark:text-slate-100">{setor.departamento}</p>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {setor.porCategoria.map((c) => (
                <Badge key={c.categoria} className={TOM.cinza}>
                  {c.categoria}: {c.total}
                </Badge>
              ))}
              <Badge className={TOM.indigo}>
                {setor.total} {setor.total === 1 ? 'equipamento' : 'equipamentos'}
              </Badge>
            </div>
          </div>

          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {setor.pessoas.map((pessoa) => (
              <li key={pessoa.email} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <div className="min-w-0 sm:w-64">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {pessoa.nome}
                  </p>
                  <p className="truncate text-xs text-slate-500">{pessoa.email}</p>
                </div>
                <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                  {pessoa.equipamentos.map((e) => (
                    <span
                      key={e.itemId}
                      title={`${e.categoria} · ${e.empresa} · desde ${formatarDataHora(e.desde)}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs ring-1 ring-inset',
                        e.forma === 'EMPRESTIMO'
                          ? 'bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-400/10 dark:text-blue-300 dark:ring-blue-400/20'
                          : 'bg-slate-50 text-slate-600 ring-slate-500/20 dark:bg-slate-400/10 dark:text-slate-300 dark:ring-slate-400/20',
                      )}
                    >
                      {e.nome}
                      {e.forma === 'EMPRESTIMO' && <span className="opacity-70">emprestado</span>}
                    </span>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TabelaEquipamentos({
  itens,
  carregando,
  aoAbrir,
  mostrarCategoria = false,
  vazio = 'Nenhum equipamento encontrado.',
}: {
  itens: Item[];
  carregando: boolean;
  aoAbrir: (id: number) => void;
  /** Na secao de uma categoria so, repetir o nome dela em cada linha e ruido. */
  mostrarCategoria?: boolean;
  vazio?: string;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Equipamento</TableHead>
          <TableHead>Patrimônio</TableHead>
          <TableHead>Empresa</TableHead>
          <TableHead>Condição</TableHead>
          <TableHead>Situação</TableHead>
          <TableHead className="text-right">Valor</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {carregando ? (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center text-slate-500">
              Carregando...
            </TableCell>
          </TableRow>
        ) : itens.length === 0 ? (
          <TableRow>
            <TableCell colSpan={6} className="h-24 text-center text-slate-500">
              {vazio}
            </TableCell>
          </TableRow>
        ) : (
          itens.map((item) => {
            const Icone = iconeDaCategoria(item.categoria.icone);
            return (
              <TableRow key={item.id} className="cursor-pointer" onClick={() => aoAbrir(item.id)}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Icone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-medium text-slate-900 dark:text-slate-100">{nomeDoItem(item)}</span>
                        {pendenteDeFormatacao(item) && (
                          <Badge className={cn('shrink-0', TOM.ambar)}>Pendente de formatação</Badge>
                        )}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[
                          mostrarCategoria ? item.categoria.nome : null,
                          // Sem hostname, marca + modelo ja e o titulo: nao repete.
                          item.hostname ? [item.marca, item.modelo].filter(Boolean).join(' ') : null,
                          especificacoesDoItem(item),
                          item.colaborador ? `com ${item.colaborador.nome}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="font-mono text-[13px] text-slate-600 dark:text-slate-300">
                  {item.patrimonio ?? '-'}
                </TableCell>
                <TableCell className="text-slate-600 dark:text-slate-400">
                  <NomeEmpresa apelido={item.empresa.apelido} />
                </TableCell>
                <TableCell>
                  <Badge className={CLASSE_CONDICAO_ITEM[item.condicao]}>
                    {ROTULO_CONDICAO_ITEM[item.condicao]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge className={CLASSE_SITUACAO_ITEM[item.situacao]}>
                    {ROTULO_SITUACAO_ITEM[item.situacao]}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {item.valor ? (
                    formatarMoeda(item.valor)
                  ) : (
                    <span className="text-xs text-amber-600 dark:text-amber-400">sem valor</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function TabelaQuantidades({
  registros,
  carregando,
  aoEditar,
  aoMovimentar,
}: {
  registros: ItemQuantidade[];
  carregando: boolean;
  aoEditar: (registro: ItemQuantidade) => void;
  aoMovimentar: (registro: ItemQuantidade, tipo: 'entrada' | 'saida' | 'ajuste') => void;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Periférico</TableHead>
          <TableHead>Empresa</TableHead>
          <TableHead className="text-center">Em estoque</TableHead>
          <TableHead className="text-right">Valor unitário</TableHead>
          <TableHead className="text-right">Movimentar</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {carregando ? (
          <TableRow>
            <TableCell colSpan={5} className="h-24 text-center text-slate-500">
              Carregando...
            </TableCell>
          </TableRow>
        ) : registros.length === 0 ? (
          <TableRow>
            <TableCell colSpan={5} className="h-24 text-center text-slate-500">
              Nenhum periférico cadastrado.
            </TableCell>
          </TableRow>
        ) : (
          registros.map((r) => {
            const Icone = iconeDaCategoria(r.categoria.icone);
            const baixo = r.estoqueMinimo !== null && r.quantidade <= r.estoqueMinimo;
            return (
              <TableRow key={r.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Icone className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <button
                        type="button"
                        onClick={() => aoEditar(r)}
                        className="truncate font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                      >
                        {r.descricao}
                      </button>
                      <p className="truncate text-xs text-slate-500">{r.categoria.nome}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-slate-600 dark:text-slate-400">
                  <NomeEmpresa apelido={r.empresa.apelido} />
                </TableCell>
                <TableCell className="text-center">
                  <Badge className={baixo ? TOM.ambar : TOM.cinza}>
                    {r.quantidade}
                    {r.estoqueMinimo !== null ? ` / mín. ${r.estoqueMinimo}` : ''}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums text-slate-600 dark:text-slate-400">
                  {r.valorUnitario ? formatarMoeda(r.valorUnitario) : '-'}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => aoMovimentar(r, 'entrada')}>
                      Entrada
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => aoMovimentar(r, 'saida')}>
                      Saída
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => aoMovimentar(r, 'ajuste')}>
                      Ajuste
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

function TabelaMovimentacoes({
  movimentacoes,
  carregando,
}: {
  movimentacoes: Movimentacao[];
  carregando: boolean;
}) {
  if (carregando) {
    return <p className="py-10 text-center text-sm text-slate-500">Carregando...</p>;
  }

  if (movimentacoes.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-200 py-10 text-center text-sm text-slate-500 dark:border-slate-800">
        Nenhuma movimentação registrada ainda.
      </p>
    );
  }

  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200/80 bg-white dark:divide-slate-800 dark:border-slate-800/80 dark:bg-slate-900/40">
      {movimentacoes.map((m) => {
        const alvo = m.item ?? m.itemQuantidade ?? null;
        const nome = m.item
          ? nomeDoItem(m.item)
          : m.itemQuantidade
            ? `${m.itemQuantidade.descricao} (${m.quantidade})`
            : 'Registro removido';
        const Icone = alvo ? iconeDaCategoria(alvo.categoria.icone) : m.item ? Package : ArrowDownUp;

        return (
          <li key={m.id} className="flex items-start gap-3 px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
              <Icone className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {ROTULO_MOVIMENTACAO[m.tipo] ?? m.tipo} · {nome}
              </p>
              <p className="truncate text-xs text-slate-500">
                {[
                  m.colaborador?.nome,
                  m.observacao,
                  formatarDataHora(m.data),
                  m.usuario && m.usuario !== 'SISTEMA' ? m.usuario : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Entrada, saida ou ajuste de saldo de um item por quantidade. */
function MovimentarSaldo({
  registro,
  tipo,
  aoFechar,
  aoConcluir,
}: {
  registro: ItemQuantidade;
  tipo: 'entrada' | 'saida' | 'ajuste';
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [quantidade, setQuantidade] = useState(tipo === 'ajuste' ? String(registro.quantidade) : '1');
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);

  const titulos = {
    entrada: 'Entrada no estoque',
    saida: 'Saída do estoque',
    ajuste: 'Ajuste de saldo',
  };

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    try {
      await api.post(`/estoque/quantidades/${registro.id}/${tipo}`, {
        quantidade: Number(quantidade),
        observacao: observacao.trim() || null,
      });
      toast.success('Estoque atualizado.');
      aoConcluir();
    } catch (erro) {
      // Mensagem ja exibida pelo interceptor. Em conflito (o saldo mudou por
      // outra pessoa), fecha e recarrega para mostrar o saldo atual.
      if (ehConflito(erro)) aoConcluir();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      icone={<Boxes className="h-4 w-4" />}
      titulo={titulos[tipo]}
      descricao={`${registro.descricao} · saldo atual ${registro.quantidade}`}
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
          <Button type="submit" form="form-saldo" disabled={enviando}>
            {enviando ? 'Enviando...' : 'Confirmar'}
          </Button>
        </>
      }
    >
      <form id="form-saldo" onSubmit={enviar} className="space-y-4">
        <Campo
          rotulo={tipo === 'ajuste' ? 'Saldo conferido na prateleira' : 'Quantidade'}
          obrigatorio
          dica={
            tipo === 'ajuste'
              ? 'O sistema registra a diferença para o saldo atual.'
              : tipo === 'saida'
                ? `Disponível: ${registro.quantidade}.`
                : undefined
          }
        >
          <Input
            type="number"
            min={tipo === 'ajuste' ? 0 : 1}
            max={tipo === 'saida' ? registro.quantidade : undefined}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            required
            className="sm:max-w-[10rem]"
          />
        </Campo>

        <Campo
          rotulo="Observação"
          obrigatorio={tipo === 'ajuste'}
          dica={tipo === 'ajuste' ? 'Conferência, perda, erro de lançamento...' : 'Opcional.'}
        >
          <Input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={500}
            required={tipo === 'ajuste'}
          />
        </Campo>
      </form>
    </Modal>
  );
}
