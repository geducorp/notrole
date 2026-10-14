import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  FileSignature,
  History,
  Loader2,
  PackagePlus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { DateInput } from '@/components/ui/DateInput';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { useAuth } from '@/components/AuthContext';
import { api, ehConflito } from '@/lib/api';
import {
  cpfValido,
  formatarData,
  formatarMoeda,
  hojeParaInputDate,
  mascararCpf,
  nomeDoItem,
} from '@/lib/dominio';
import { usePerfil } from '@/lib/perfil';
import { cn } from '@/lib/utils';
import type { Colaborador, Emprestimo, Empresa, Item, ModalidadeCessao, UsuarioAD } from '@/types';

/** Resposta de GET /colaboradores/cadastro: so o que o formulario usa. */
type CadastroParaCessao = Pick<Colaborador, 'id' | 'nome' | 'email' | 'idAD' | 'cpf' | 'endereco'> & {
  emprestimos: Emprestimo[];
};

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  aoSalvar: () => void;
  /**
   * TEMPORARIA (padrao): emprestimo, com prazo e motivo. DEFINITIVA: entrega do
   * equipamento como ferramenta de trabalho, sem prazo, com o comodato proprio.
   */
  modalidade?: ModalidadeCessao;
  /** Equipamento ja escolhido (quando a entrega parte da ficha do estoque). */
  itemInicial?: Item | null;
}

/** Acessorios mais comuns; vao como o item 2 do termo de comodato. */
const ACESSORIOS = ['Carregador', 'Mouse', 'Mochila'];

/** Notebook que o colaborador ja usou, para sugerir o mesmo. */
interface UsoAnterior {
  itemId: number;
  nome: string;
  modelo: string;
  ultimaVez: string;
}

export function NewLoanModal({
  aberto,
  aoFechar,
  aoSalvar,
  modalidade = 'TEMPORARIA',
  itemInicial = null,
}: Props) {
  const { usuario } = useAuth();
  const perfil = usePerfil();
  const entrega = modalidade === 'DEFINITIVA';

  const [itens, setItens] = useState<Item[]>([]);
  // Sem isto o aviso "nenhum equipamento" piscava a cada abertura, antes de a lista chegar.
  const [carregandoItens, setCarregandoItens] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [itemId, setItemId] = useState('');
  const [termoBusca, setTermoBusca] = useState('');
  const [resultados, setResultados] = useState<UsuarioAD[]>([]);
  const [colaborador, setColaborador] = useState<UsuarioAD | null>(null);
  const [usosAnteriores, setUsosAnteriores] = useState<UsoAnterior[]>([]);
  const [dataPrevista, setDataPrevista] = useState(hojeParaInputDate(7));
  const [observacoes, setObservacoes] = useState('');
  const [buscando, setBuscando] = useState(false);
  // A lista de resultados do AD fecha ao clicar fora, com Esc ou no X - antes
  // ela ficava aberta ate escolher alguem.
  const [listaAberta, setListaAberta] = useState(false);
  const caixaDeBusca = useRef<HTMLDivElement>(null);
  const [salvando, setSalvando] = useState(false);

  // Termo de comodato
  // null = ainda nao sabemos (carregando ou falhou). Enquanto for null o envio
  // fica bloqueado: sem esta informacao o emprestimo sairia com
  // enviarTermo:false, sem termo de comodato, sem o operador perceber.
  const [d4signAtivo, setD4signAtivo] = useState<boolean | null>(null);
  const [d4signPausado, setD4signPausado] = useState(false);
  const [erroStatusD4sign, setErroStatusD4sign] = useState(false);
  const [enviarTermo, setEnviarTermo] = useState(true);
  const [empresaId, setEmpresaId] = useState('');
  const [motivo, setMotivo] = useState('');
  const [cpf, setCpf] = useState('');
  const [endereco, setEndereco] = useState('');
  const [acessorios, setAcessorios] = useState<string[]>([]);
  const [outroAcessorio, setOutroAcessorio] = useState('');
  const [dadosSalvos, setDadosSalvos] = useState(false);

  /**
   * Cada escolha de colaborador ganha um numero. As respostas que chegam depois
   * de outra escolha (ou de limpar o campo) sao ignoradas - senao a busca do
   * colaborador anterior preenchia CPF e endereco no formulario do proximo.
   */
  const selecaoAtual = useRef(0);
  // A empresa foi preenchida a partir do colaborador (e nao escolhida a mao)?
  const empresaVeioDoColaborador = useRef(false);

  const carregarStatusD4sign = useCallback(() => {
    setD4signAtivo(null);
    setErroStatusD4sign(false);
    api
      .get('/configuracoes/status')
      .then(({ data }) => {
        setD4signAtivo(Boolean(data?.d4sign?.configurado));
        setD4signPausado(Boolean(data?.d4sign?.pausado));
      })
      .catch(() => setErroStatusD4sign(true));
  }, []);

  useEffect(() => {
    if (!aberto) return;

    setItens([]);
    setCarregandoItens(true);
    setItemId(itemInicial ? String(itemInicial.id) : '');
    setTermoBusca('');
    setResultados([]);
    setColaborador(null);
    setUsosAnteriores([]);
    setObservacoes('');
    setDataPrevista(hojeParaInputDate(7));
    setEnviarTermo(true);
    setEmpresaId('');
    setMotivo('');
    setCpf('');
    setEndereco('');
    setAcessorios([]);
    setOutroAcessorio('');
    setDadosSalvos(false);
    selecaoAtual.current += 1;
    empresaVeioDoColaborador.current = false;

    // Emprestimo: so o que esta marcado "para emprestimo". Entrega: qualquer
    // equipamento livre no estoque.
    api
      .get<Item[]>('/itens', {
        params: entrega ? { situacao: 'EM_ESTOQUE' } : { situacao: 'EM_ESTOQUE', paraEmprestimo: 'true' },
      })
      .then(({ data }) => {
        // O equipamento vindo da ficha entra na lista mesmo que o filtro nao o traga.
        setItens(itemInicial && !data.some((i) => i.id === itemInicial.id) ? [itemInicial, ...data] : data);
      })
      .catch(() => undefined)
      .finally(() => setCarregandoItens(false));

    api
      .get<Empresa[]>('/empresas')
      .then(({ data }) => setEmpresas(data.filter((e) => e.ativo)))
      .catch(() => undefined);

    carregarStatusD4sign();
  }, [aberto, entrega, itemInicial, carregarStatusD4sign]);

  useEffect(() => {
    if (termoBusca.trim().length < 3) {
      setResultados([]);
      return;
    }

    const temporizador = setTimeout(async () => {
      setBuscando(true);
      try {
        const { data } = await api.get<UsuarioAD[]>('/colaboradores/ad/search', {
          params: { q: termoBusca.trim() },
        });
        setResultados(data);
        setListaAberta(true);
      } catch {
        setResultados([]);
      } finally {
        setBuscando(false);
      }
    }, 450);

    return () => clearTimeout(temporizador);
  }, [termoBusca]);

  useEffect(() => {
    if (!listaAberta) return;
    const aoClicar = (evento: MouseEvent) => {
      if (caixaDeBusca.current && !caixaDeBusca.current.contains(evento.target as Node)) {
        setListaAberta(false);
      }
    };
    document.addEventListener('mousedown', aoClicar);
    return () => document.removeEventListener('mousedown', aoClicar);
  }, [listaAberta]);

  /**
   * Ao escolher o colaborador: a empresa vem do campo "Empresa" do AD; CPF,
   * endereco e os notebooks que ele ja usou vem do cadastro, se ele ja pegou
   * notebook antes. Assim, na maioria das vezes, o operador so confere.
   */
  const escolherColaborador = async (u: UsuarioAD) => {
    const minhaSelecao = ++selecaoAtual.current;
    const obsoleta = () => minhaSelecao !== selecaoAtual.current;

    setColaborador(u);
    setResultados([]);
    // Dados do colaborador anterior nao podem ficar no formulario deste.
    setCpf('');
    setEndereco('');
    setDadosSalvos(false);
    setUsosAnteriores([]);
    if (empresaVeioDoColaborador.current) {
      setEmpresaId('');
      empresaVeioDoColaborador.current = false;
    }

    try {
      const { data } = await api.get<Empresa | null>('/empresas/identificar', {
        params: { empresaAD: u.empresa || undefined },
      });
      if (obsoleta()) return;
      if (data) {
        setEmpresaId(String(data.id));
        empresaVeioDoColaborador.current = true;
      }
    } catch {
      // Sem empresa identificada o operador escolhe na lista.
    }

    try {
      // Busca exata pelo idAD e pelo e-mail (o servidor tambem reconhece quem
      // trocou de dominio). Funciona para colaborador de qualquer empresa, que
      // pode receber equipamento desta; as cessoes anteriores vem so da
      // empresa de quem esta logado.
      const { data: existente } = await api.get<CadastroParaCessao | null>('/colaboradores/cadastro', {
        params: { email: u.email, ...(u.idAD ? { idAD: u.idAD } : {}) },
      });
      if (obsoleta() || !existente) return;

      if (existente.cpf) setCpf(mascararCpf(existente.cpf));
      if (existente.endereco) setEndereco(existente.endereco);
      setDadosSalvos(Boolean(existente.cpf || existente.endereco));

      const vistos = new Map<number, UsoAnterior>();
      for (const e of existente.emprestimos) {
        if (e.status === 'CANCELADO' || vistos.has(e.itemId)) continue;
        vistos.set(e.itemId, {
          itemId: e.itemId,
          nome: nomeDoItem(e.item),
          modelo: [e.item.marca, e.item.modelo].filter(Boolean).join(' '),
          ultimaVez: e.dataInicio,
        });
      }
      setUsosAnteriores([...vistos.values()].slice(0, 4));
    } catch {
      // Primeiro emprestimo desta pessoa: os campos ficam em branco.
    }
  };

  const limparColaborador = () => {
    selecaoAtual.current += 1; // descarta buscas ainda em andamento
    if (empresaVeioDoColaborador.current) {
      setEmpresaId('');
      empresaVeioDoColaborador.current = false;
    }
    setColaborador(null);
    setTermoBusca('');
    setCpf('');
    setEndereco('');
    setDadosSalvos(false);
    setUsosAnteriores([]);
  };

  // A API so devolve ao analista os equipamentos da empresa dele, entao a
  // lista inteira e selecionavel (o administrador ve todos).
  const selecionaveis = itens;

  const itemEscolhido = useMemo(
    () => itens.find((n) => String(n.id) === itemId) ?? null,
    [itens, itemId],
  );

  /**
   * Para o analista o termo sai sempre em nome da empresa do equipamento (o
   * servidor impoe o mesmo); so o administrador escolhe a empresa comodante.
   */
  const empresaDoTermoTravada = !!perfil && !perfil.admin;
  const empresaDoTermoId = empresaDoTermoTravada
    ? itemEscolhido
      ? String(itemEscolhido.empresaId)
      : ''
    : empresaId;

  const comTermo = d4signAtivo === true && enviarTermo;
  const statusD4signDesconhecido = d4signAtivo === null;
  const empresaEscolhida = empresas.find((e) => String(e.id) === empresaDoTermoId) ?? null;

  const alternarAcessorio = (nome: string) =>
    setAcessorios((atual) =>
      atual.includes(nome) ? atual.filter((a) => a !== nome) : [...atual, nome],
    );

  const listaDeAcessorios = [...acessorios, ...(outroAcessorio.trim() ? [outroAcessorio.trim()] : [])];

  /** O que ainda falta para o termo sair completo. Vazio = pode enviar. */
  const pendenciasDoTermo = useMemo(() => {
    if (!comTermo) return [];
    const p: string[] = [];
    if (itemEscolhido && !itemEscolhido.valor) {
      p.push(`o equipamento ${nomeDoItem(itemEscolhido)} está sem valor cadastrado`);
    }
    if (!empresaDoTermoId) p.push(empresaDoTermoTravada ? 'escolha o equipamento' : 'escolha a empresa');
    if (!entrega && !motivo.trim()) p.push('informe o motivo');
    if (itemEscolhido && !itemEscolhido.patrimonio) {
      p.push(`o equipamento ${nomeDoItem(itemEscolhido)} está sem patrimônio (número de série)`);
    }
    if (!cpf) p.push('informe o CPF');
    else if (!cpfValido(cpf)) p.push('o CPF está inválido');
    if (endereco.trim().length < 10) p.push('informe o endereço completo');
    return p;
  }, [comTermo, itemEscolhido, empresaDoTermoId, empresaDoTermoTravada, motivo, cpf, endereco]);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();

    if (statusD4signDesconhecido) {
      toast.error('Ainda não sabemos se o D4Sign está ativo.', {
        description: 'Aguarde a verificação ou clique em "Tentar de novo" antes de confirmar.',
      });
      return;
    }

    if (!itemId || !colaborador || (!entrega && !dataPrevista)) {
      toast.error(
        entrega
          ? 'Selecione o equipamento e o colaborador.'
          : 'Selecione o equipamento, o colaborador e a data prevista.',
      );
      return;
    }
    if (pendenciasDoTermo.length) {
      toast.error('Faltam dados para o termo', { description: pendenciasDoTermo.join('; ') + '.' });
      return;
    }

    setSalvando(true);
    try {
      await api.post('/emprestimos', {
        itemId: Number(itemId),
        colaborador: {
          nome: colaborador.nome,
          email: colaborador.email,
          departamento: colaborador.departamento || null,
          cargo: colaborador.cargo || null,
          idAD: colaborador.idAD || null,
          empresaAD: colaborador.empresa || null,
          ...(comTermo ? { cpf, endereco: endereco.trim() } : {}),
        },
        modalidade,
        dataPrevistaDevolucao: entrega ? null : dataPrevista,
        observacoes: observacoes.trim() || null,
        enviarTermo: comTermo,
        ...(comTermo
          ? {
              empresaId: Number(empresaDoTermoId),
              motivo: entrega ? null : motivo.trim(),
              acessorios: listaDeAcessorios.join(', ') || null,
            }
          : {}),
      });

      toast.success(
        entrega ? 'Entrega registrada.' : 'Empréstimo registrado.',
        comTermo
          ? { description: 'O termo de comodato vai para o D4Sign em até 5 minutos.' }
          : undefined,
      );
      aoSalvar();
      aoFechar();
    } catch (erro) {
      // Mensagem ja exibida pelo interceptor. Em conflito (o equipamento foi
      // emprestado por outra pessoa), recarrega a lista de fora.
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
      titulo={entrega ? 'Entregar equipamento' : 'Novo empréstimo'}
      descricao={
        entrega
          ? 'Entrega definitiva, para uso no trabalho: sem prazo de devolução.'
          : 'Empréstimo com prazo de devolução, de um equipamento marcado para empréstimo.'
      }
      largura="xl"
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="form-novo-emprestimo"
            disabled={salvando || statusD4signDesconhecido}
            title={pendenciasDoTermo.length ? `Falta: ${pendenciasDoTermo.join('; ')}` : undefined}
          >
            {salvando ? 'Salvando...' : entrega ? 'Confirmar entrega' : 'Confirmar empréstimo'}
          </Button>
        </>
      }
    >
      <form id="form-novo-emprestimo" onSubmit={enviar} className="space-y-5">
        {/* Colaborador */}
        <div className="relative" ref={caixaDeBusca}>
          <Campo rotulo="Colaborador" obrigatorio>
            {colaborador ? (
              <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950/50">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-xs font-semibold text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300">
                  {colaborador.nome
                    .split(/\s+/)
                    .filter(Boolean)
                    .map((p, i, arr) => (i === 0 || i === arr.length - 1 ? p[0] : ''))
                    .join('')
                    .toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                    {colaborador.nome}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    {[colaborador.email, colaborador.departamento, colaborador.empresa]
                      .filter(Boolean)
                      .join(' · ')}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  title="Trocar colaborador"
                  onClick={limparColaborador}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={termoBusca}
                  onChange={(e) => setTermoBusca(e.target.value)}
                  onFocus={() => resultados.length > 0 && setListaAberta(true)}
                  onKeyDown={(e) => {
                    // Esc fecha so a lista (e nao a janela inteira).
                    if (e.key === 'Escape' && listaAberta) {
                      e.preventDefault();
                      e.nativeEvent.stopImmediatePropagation();
                      e.nativeEvent.stopPropagation();
                      setListaAberta(false);
                    }
                  }}
                  placeholder="Buscar no Active Directory por nome ou e-mail"
                  className="pl-9 pr-9"
                  autoFocus
                />
                {buscando ? (
                  <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-slate-400" />
                ) : (
                  termoBusca && (
                    <button
                      type="button"
                      title="Limpar"
                      onClick={() => {
                        setTermoBusca('');
                        setResultados([]);
                        setListaAberta(false);
                      }}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )
                )}
              </div>
            )}
          </Campo>

          {!colaborador && listaAberta && resultados.length > 0 && (
            <div className="absolute z-10 mt-1 max-h-60 w-full animate-aparecer overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-800 dark:bg-slate-900">
              {resultados.map((u) => (
                <button
                  key={u.idAD}
                  type="button"
                  className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-slate-100 dark:hover:bg-slate-800"
                  onClick={() => void escolherColaborador(u)}
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{u.nome}</p>
                  <p className="text-xs text-slate-500">
                    {[u.email, u.departamento].filter(Boolean).join(' · ')}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Notebook */}
        <Campo
          rotulo="Equipamento"
          obrigatorio
          erro={
            carregandoItens || selecionaveis.length > 0
              ? undefined
              : entrega
                ? 'Nenhum equipamento em estoque para entrega.'
                : 'Nenhum equipamento disponível para empréstimo. Marque "Disponível para empréstimo" no cadastro, em Estoque.'
          }
        >
          <Select value={itemId} onChange={(e) => setItemId(e.target.value)} required disabled={carregandoItens}>
            <option value="">
              {carregandoItens
                ? 'Carregando equipamentos...'
                : entrega
                  ? 'Selecione um equipamento em estoque'
                  : 'Selecione um equipamento disponível'}
            </option>
            {itens.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nomeDoItem(nb)} · {[nb.marca, nb.modelo].filter(Boolean).join(' ')}
                {nb.valor ? ` · ${formatarMoeda(nb.valor)}` : ''}
              </option>
            ))}
          </Select>

          {usosAnteriores.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <History className="h-3.5 w-3.5" /> Já usou:
              </span>
              {usosAnteriores.map((u) => {
                const disponivel = selecionaveis.some((n) => n.id === u.itemId);
                const escolhido = itemId === String(u.itemId);
                return (
                  <button
                    key={u.itemId}
                    type="button"
                    disabled={!disponivel}
                    onClick={() => setItemId(String(u.itemId))}
                    title={
                      disponivel
                        ? `${u.modelo} · último empréstimo em ${formatarData(u.ultimaVez)}`
                        : `${u.modelo} · não está disponível agora`
                    }
                    className={cn(
                      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs ring-1 ring-inset transition-colors',
                      escolhido
                        ? 'bg-indigo-50 text-indigo-700 ring-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:ring-indigo-500/30'
                        : 'text-slate-600 ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800/60',
                      'disabled:cursor-not-allowed disabled:opacity-40',
                    )}
                  >
                    {escolhido && <Check className="h-3 w-3" />}
                    {u.nome}
                  </button>
                );
              })}
            </div>
          )}
        </Campo>

        {!entrega && (
          <Campo rotulo="Data prevista de devolução" obrigatorio>
            <DateInput
              value={dataPrevista}
              min={hojeParaInputDate()}
              onChange={setDataPrevista}
              required
              atalhos={[
                { rotulo: 'Amanhã', valor: hojeParaInputDate(1) },
                { rotulo: '7 dias', valor: hojeParaInputDate(7) },
                { rotulo: '15 dias', valor: hojeParaInputDate(15) },
                { rotulo: '30 dias', valor: hojeParaInputDate(30) },
              ]}
            />
          </Campo>
        )}

        {/*
          O D4Sign e da empresa inteira e cobra por envio. A decisao de gerar o
          termo e do operador, emprestimo a emprestimo.
        */}
        {statusD4signDesconhecido && !erroStatusD4sign && (
          <div className="flex items-center gap-2 rounded-xl border border-slate-200 p-4 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            Verificando se o D4Sign está ativo...
          </div>
        )}

        {statusD4signDesconhecido && erroStatusD4sign && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50/60 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/5 dark:text-red-400">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              Não foi possível saber se o D4Sign está ativo. Sem isso não dá para decidir sobre o termo de comodato.
            </span>
            <Button type="button" variant="outline" size="sm" onClick={carregarStatusD4sign}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
              Tentar de novo
            </Button>
          </div>
        )}

        {d4signAtivo === true && (
          <div
            className={cn(
              'rounded-xl border transition-colors',
              enviarTermo
                ? 'border-indigo-200 bg-indigo-50/40 dark:border-indigo-500/25 dark:bg-indigo-500/5'
                : 'border-slate-200 dark:border-slate-800',
            )}
          >
            <label className="flex cursor-pointer items-start gap-3 p-4">
              <input
                type="checkbox"
                checked={enviarTermo}
                onChange={(e) => setEnviarTermo(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-indigo-600"
              />
              <span className="text-sm">
                <span className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                  <FileSignature className="h-4 w-4 text-indigo-500" />
                  Enviar termo de comodato pelo D4Sign
                </span>
                <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                  {enviarTermo
                    ? `Usa 1 envio do pacote do D4Sign${entrega ? ', com o modelo Comodato PF Padrão' : ''}. ` +
                      `${entrega ? 'A entrega fica ativa' : 'O empréstimo fica ativo'} depois que o colaborador assinar.`
                    : 'Nenhum documento será criado. Já começa ativo.'}
                </span>
                {enviarTermo && d4signPausado && (
                  <span className="mt-1.5 block text-xs font-medium text-amber-700 dark:text-amber-400">
                    O D4Sign está pausado em Configurações: o termo fica na fila e só é enviado quando religarem.
                  </span>
                )}
              </span>
            </label>

            {enviarTermo && (
              <div className="space-y-4 border-t border-indigo-100 p-4 dark:border-indigo-500/15">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo
                    rotulo="Empresa (comodante)"
                    obrigatorio
                    dica={
                      empresaDoTermoTravada
                        ? 'O termo sai em nome da empresa do equipamento.'
                        : colaborador && empresaEscolhida
                          ? colaborador.empresa
                            ? `Pelo AD: ${colaborador.empresa}. Troque se for outra.`
                            : 'Sem empresa no AD: usada a padrão. Troque se for outra.'
                          : undefined
                    }
                  >
                    <Select
                      value={empresaDoTermoId}
                      disabled={empresaDoTermoTravada}
                      onChange={(e) => {
                        empresaVeioDoColaborador.current = false;
                        setEmpresaId(e.target.value);
                      }}
                    >
                      <option value="">{empresaDoTermoTravada ? 'A do equipamento' : 'Selecione'}</option>
                      {empresas.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.apelido}
                        </option>
                      ))}
                    </Select>
                  </Campo>

                  {!entrega && (
                    <Campo rotulo="Motivo do empréstimo" obrigatorio>
                      <Input
                        value={motivo}
                        onChange={(e) => setMotivo(e.target.value)}
                        maxLength={300}
                        placeholder="Notebook próprio em manutenção"
                      />
                    </Campo>
                  )}
                </div>

                {colaborador && dadosSalvos && (
                  <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-800 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20">
                    <Check className="h-3.5 w-3.5 shrink-0" />
                    CPF e endereço preenchidos com o cadastro anterior. Confirme com o colaborador.
                  </p>
                )}

                <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
                  <Campo
                    rotulo="CPF"
                    obrigatorio
                    erro={cpf.length === 14 && !cpfValido(cpf) ? 'CPF inválido.' : undefined}
                  >
                    <Input
                      value={cpf}
                      onChange={(e) => setCpf(mascararCpf(e.target.value))}
                      inputMode="numeric"
                      placeholder="000.000.000-00"
                      className={cn(
                        'tabular-nums',
                        cpf.length === 14 && !cpfValido(cpf) && 'border-red-400 focus-visible:border-red-500 focus-visible:ring-red-500/15',
                      )}
                    />
                  </Campo>
                  <Campo rotulo="Endereço do colaborador" obrigatorio>
                    <Input
                      value={endereco}
                      onChange={(e) => setEndereco(e.target.value)}
                      maxLength={300}
                      placeholder="Rua, número - bairro, cidade/UF"
                    />
                  </Campo>
                </div>

                <Campo rotulo={entrega ? 'Periféricos entregues junto' : 'Periféricos emprestados junto'}>
                  <div className="flex flex-wrap items-center gap-2">
                    {ACESSORIOS.map((a) => {
                      const marcado = acessorios.includes(a);
                      return (
                        <button
                          key={a}
                          type="button"
                          role="checkbox"
                          aria-checked={marcado}
                          onClick={() => alternarAcessorio(a)}
                          className={cn(
                            'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm ring-1 ring-inset transition-colors',
                            marcado
                              ? 'bg-indigo-600 text-white ring-indigo-600'
                              : 'bg-white text-slate-700 ring-slate-200 hover:bg-slate-50 dark:bg-slate-950/50 dark:text-slate-300 dark:ring-slate-700 dark:hover:bg-slate-800/60',
                          )}
                        >
                          {marcado && <Check className="h-3.5 w-3.5" />}
                          {a}
                        </button>
                      );
                    })}
                    <Input
                      value={outroAcessorio}
                      onChange={(e) => setOutroAcessorio(e.target.value)}
                      maxLength={60}
                      placeholder="Outro"
                      className="h-8 w-36"
                    />
                  </div>
                </Campo>

                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Registrado por: <b className="font-medium text-slate-700 dark:text-slate-300">{usuario?.nome ?? '-'}</b>{' '}
                  (sai impresso no termo). Só o colaborador assina;{' '}
                  {entrega ? 'a entrega fica ativa' : 'o empréstimo fica ativo'} assim que ele assinar.
                </p>

                {itemEscolhido && !itemEscolhido.valor && (
                  <p className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800 ring-1 ring-inset ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    O equipamento {nomeDoItem(itemEscolhido)} está sem valor cadastrado, e o valor
                    aparece no contrato. Cadastre em Estoque, abrindo a ficha do equipamento, antes de enviar o termo.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <Campo rotulo="Observações internas" dica="Só aparecem no Notrole. Não vão para o contrato.">
          <Input
            value={observacoes}
            onChange={(e) => setObservacoes(e.target.value)}
            maxLength={500}
            placeholder="Opcional"
          />
        </Campo>
      </form>
    </Modal>
  );
}
