import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, Laptop, Loader2, Package, RefreshCw, Search, TriangleAlert, UserRound } from 'lucide-react';
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
import { api } from '@/lib/api';
import {
  CLASSE_STATUS_EMPRESTIMO,
  cpfValido,
  formatarData,
  mascararCpf,
  nomeDoItem,
  ROTULO_STATUS_EMPRESTIMO,
} from '@/lib/dominio';
import { cn } from '@/lib/utils';
import type { Colaborador, Emprestimo, Item } from '@/types';

type ColaboradorNaLista = Colaborador & { _count?: { emprestimos: number } };
type ColaboradorDetalhe = Colaborador & { emprestimos: Emprestimo[] };

function iniciais(nome: string) {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '') + (partes.length > 1 ? (partes[partes.length - 1]?.[0] ?? '') : '')).toUpperCase();
}

export function Collaborators() {
  const [colaboradores, setColaboradores] = useState<ColaboradorNaLista[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [aberto, setAberto] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get<ColaboradorNaLista[]>('/colaboradores', {
        params: busca.trim() ? { busca: busca.trim() } : undefined,
      });
      setColaboradores(data);
    } catch {
      setColaboradores([]);
    } finally {
      setCarregando(false);
    }
  }, [busca]);

  useEffect(() => {
    const temporizador = setTimeout(() => void carregar(), 350);
    return () => clearTimeout(temporizador);
  }, [carregar]);

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Colaboradores"
        descricao="Quem já retirou algum equipamento. O cadastro é feito sozinho, ao registrar um empréstimo. Clique em uma pessoa para ver a ficha."
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <Input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome, e-mail ou departamento..."
          className="pl-9"
        />
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Colaborador</TableHead>
            <TableHead>Departamento</TableHead>
            <TableHead>CPF</TableHead>
            <TableHead className="text-center">Empréstimos</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {carregando ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                Carregando...
              </TableCell>
            </TableRow>
          ) : colaboradores.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                {busca ? 'Nenhum colaborador encontrado.' : 'Nenhum colaborador cadastrado ainda.'}
              </TableCell>
            </TableRow>
          ) : (
            colaboradores.map((c) => (
              <TableRow key={c.id} className="cursor-pointer" onClick={() => setAberto(c.id)}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {iniciais(c.nome)}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">{c.nome}</p>
                      <p className="truncate text-xs text-slate-500">{c.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-slate-600 dark:text-slate-400">
                  {c.departamento || '-'}
                  {c.cargo && <p className="text-xs text-slate-400 dark:text-slate-500">{c.cargo}</p>}
                </TableCell>
                <TableCell className="text-slate-600 dark:text-slate-400">
                  {c.cpf ?? <span className="text-slate-400 dark:text-slate-600">-</span>}
                </TableCell>
                <TableCell className="text-center font-medium text-slate-700 dark:text-slate-300">
                  {c._count?.emprestimos ?? '-'}
                </TableCell>
                <TableCell>
                  <ChevronRight className="h-4 w-4 text-slate-400" />
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <FichaColaborador id={aberto} aoFechar={() => setAberto(null)} aoSalvar={() => void carregar()} />
    </div>
  );
}

/**
 * Ficha do colaborador: dados do AD, CPF e endereco usados no termo de
 * comodato (editaveis) e todos os notebooks que ele ja pegou.
 */
function FichaColaborador({
  id,
  aoFechar,
  aoSalvar,
}: {
  id: number | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [dados, setDados] = useState<ColaboradorDetalhe | null>(null);
  const [itensComEle, setItensComEle] = useState<Item[]>([]);
  const [cpf, setCpf] = useState('');
  const [endereco, setEndereco] = useState('');
  const [salvando, setSalvando] = useState(false);
  // Falha ao carregar a ficha: sem isto o spinner girava para sempre.
  const [erroAoCarregar, setErroAoCarregar] = useState(false);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (id === null) {
      setDados(null);
      return;
    }
    let ativo = true;
    setDados(null);
    setErroAoCarregar(false);

    // Equipamentos entregues em definitivo (diferente de emprestimo).
    api
      .get<Item[]>('/itens', { params: { colaboradorId: id } })
      .then(({ data }) => ativo && setItensComEle(data))
      .catch(() => ativo && setItensComEle([]));

    api
      .get<ColaboradorDetalhe>(`/colaboradores/${id}`)
      .then(({ data }) => {
        if (!ativo) return;
        setDados(data);
        setCpf(data.cpf ? mascararCpf(data.cpf) : '');
        setEndereco(data.endereco ?? '');
      })
      .catch(() => ativo && setErroAoCarregar(true));

    return () => {
      ativo = false;
    };
  }, [id, tentativa]);

  if (id === null) return null;

  const cpfInvalido = cpf.length > 0 && !cpfValido(cpf);
  const alterado = dados && (cpf !== (dados.cpf ? mascararCpf(dados.cpf) : '') || endereco !== (dados.endereco ?? ''));

  const salvar = async () => {
    if (!dados || cpfInvalido) return;
    setSalvando(true);
    try {
      const { data } = await api.patch<Colaborador>(`/colaboradores/${dados.id}`, {
        cpf: cpf || null,
        endereco: endereco.trim() || null,
      });
      setDados({ ...dados, ...data });
      toast.success('Dados do colaborador salvos.', {
        description: 'Serão usados no próximo termo de comodato.',
      });
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
      icone={<UserRound className="h-4 w-4" />}
      titulo={dados?.nome ?? 'Colaborador'}
      descricao={dados?.email}
      largura="xl"
      rodape={
        <>
          <Button variant="ghost" onClick={aoFechar}>
            Fechar
          </Button>
          <Button onClick={() => void salvar()} disabled={!alterado || cpfInvalido || salvando}>
            {salvando ? 'Salvando...' : 'Salvar dados'}
          </Button>
        </>
      }
    >
      {!dados && erroAoCarregar ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
          <TriangleAlert className="h-5 w-5 text-amber-500" />
          Não foi possível carregar a ficha deste colaborador.
          <Button type="button" variant="outline" size="sm" onClick={() => setTentativa((t) => t + 1)}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Tentar de novo
          </Button>
        </div>
      ) : !dados ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : (
        <div className="space-y-6">
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200/80 text-sm sm:grid-cols-3 dark:border-slate-800 dark:bg-slate-800">
            {[
              ['Departamento', dados.departamento],
              ['Cargo', dados.cargo],
              ['Empresa (AD)', dados.empresaAD],
            ].map(([rotulo, valor]) => (
              <div key={rotulo} className="bg-slate-50 px-3.5 py-2.5 dark:bg-slate-950/60">
                <dt className="text-xs text-slate-500 dark:text-slate-400">{rotulo}</dt>
                <dd className="truncate font-medium text-slate-900 dark:text-slate-100">{valor || '-'}</dd>
              </div>
            ))}
          </dl>

          <div>
            <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              Dados para o termo de comodato
            </p>
            <div className="grid gap-4 sm:grid-cols-[11rem_1fr]">
              <Campo rotulo="CPF" erro={cpfInvalido && cpf.length === 14 ? 'CPF inválido.' : undefined}>
                <Input
                  value={cpf}
                  onChange={(e) => setCpf(mascararCpf(e.target.value))}
                  inputMode="numeric"
                  placeholder="000.000.000-00"
                  className="tabular-nums"
                />
              </Campo>
              <Campo rotulo="Endereço">
                <Input
                  value={endereco}
                  onChange={(e) => setEndereco(e.target.value)}
                  maxLength={300}
                  placeholder="Rua, número - bairro, cidade/UF"
                />
              </Campo>
            </div>
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              Está com esta pessoa{' '}
              <span className="font-normal text-slate-500">({itensComEle.length})</span>
            </p>
            {itensComEle.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500 dark:border-slate-800">
                Nenhum equipamento entregue em definitivo.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 dark:divide-slate-800 dark:border-slate-800">
                {itensComEle.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Package className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                        {nomeDoItem(item)}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {item.categoria.nome} · entregue em {formatarData(item.entregueEm ?? item.dataEntrada)}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
              Empréstimos e entregas{' '}
              <span className="font-normal text-slate-500">({dados.emprestimos.length})</span>
            </p>
            {dados.emprestimos.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500 dark:border-slate-800">
                Nenhum empréstimo registrado.
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200/80 dark:divide-slate-800 dark:border-slate-800">
                {dados.emprestimos.map((e) => (
                  <li key={e.id} className="flex items-center gap-3 px-3.5 py-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      <Laptop className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[13px] font-medium text-indigo-600 dark:text-indigo-400">
                        {nomeDoItem(e.item)}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {[e.item.marca, e.item.modelo].filter(Boolean).join(' ')} ·{' '}
                        {formatarData(e.dataInicio)}
                        {e.dataDevolucao ? ` até ${formatarData(e.dataDevolucao)}` : ''}
                      </p>
                    </div>
                    <Badge className={cn(CLASSE_STATUS_EMPRESTIMO[e.status])}>
                      {ROTULO_STATUS_EMPRESTIMO[e.status]}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
