import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  Boxes,
  CalendarClock,
  CircleCheck,
  FileSignature,
  FileSpreadsheet,
  Loader2,
  PackageCheck,
  UserRound,
  Wallet,
  Wrench,
ChevronDown,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { PageHeader } from '@/components/ui/PageHeader';
import { useTheme } from '@/components/ThemeProvider';
import { api, baixarArquivo } from '@/lib/api';
import { formatarData, formatarMoeda } from '@/lib/dominio';
import { cn } from '@/lib/utils';
import type { Empresa, MetricasDashboard, ResumoEstoque, SetorComEquipamentos } from '@/types';
import { FiltroEmpresa } from '@/components/ui/Empresa';
import { usePerfil } from '@/lib/perfil';

type Painel = 'estoque' | 'emprestimos';

const VAZIO: MetricasDashboard = {
  inventario: {
    total: 0,
    disponiveis: 0,
    emprestados: 0,
    entregues: 0,
    reservados: 0,
    emManutencao: 0,
    descontinuados: 0,
  },
  emprestimos: { emAberto: 0, aguardandoAssinatura: 0, colaboradoresComEquipamento: 0, disponiveis: 0 },
  alertas: { devolucoesAtrasadas: 0, vencendoEmSeteDias: 0, maioresAtrasos: [] },
  emprestimosPorDepartamento: [],
};

/**
 * Painel inicial, dividido em duas partes de proposito:
 *
 *  - **Estoque**: o patrimonio de TI de todas as empresas - o que tem, onde
 *    esta, quanto vale;
 *  - **Empréstimos**: so os notebooks emprestados com termo de comodato, que
 *    tem prazo, cobranca e assinatura.
 *
 * Antes os dois estavam no mesmo bloco e "emprestado" se confundia com
 * "entregue em definitivo", que sao coisas diferentes.
 */
export function Dashboard() {
  const { theme } = useTheme();
  const perfil = usePerfil();
  const escuro =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const [metricas, setMetricas] = useState<MetricasDashboard>(VAZIO);
  const [estoque, setEstoque] = useState<ResumoEstoque | null>(null);
  const [setores, setSetores] = useState<SetorComEquipamentos[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [empresaId, setEmpresaId] = useState('');
  const [exportando, setExportando] = useState(false);

  // Um painel por vez: tudo na mesma tela obrigava a rolar ate o fim.
  const [painel, setPainel] = useState<Painel>(() => {
    try {
      return localStorage.getItem('notrole-dashboard') === 'emprestimos' ? 'emprestimos' : 'estoque';
    } catch {
      return 'estoque';
    }
  });

  // Tipo de equipamento dos cartoes do estoque ('' = todos). Lembrado neste navegador.
  const [tipo, setTipo] = useState(() => {
    try {
      return localStorage.getItem('notrole-dashboard-tipo') ?? '';
    } catch {
      return '';
    }
  });

  const escolherTipo = (novo: string) => {
    setTipo(novo);
    try {
      localStorage.setItem('notrole-dashboard-tipo', novo);
    } catch {
      // So conveniencia.
    }
  };

  const escolherPainel = (novo: Painel) => {
    setPainel(novo);
    try {
      localStorage.setItem('notrole-dashboard', novo);
    } catch {
      // Sem armazenamento: so nao lembra a escolha.
    }
  };

  useEffect(() => {
    api
      .get<Empresa[]>('/empresas')
      .then(({ data }) => setEmpresas(data.filter((e) => e.ativo)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    // Ao trocar de empresa rapido, a resposta da empresa anterior pode chegar
    // depois: `ativo` vira false no cleanup e ela e descartada.
    let ativo = true;
    setCarregando(true);
    const params = empresaId ? { empresaId } : {};
    void Promise.all([
      api.get<MetricasDashboard>('/relatorios/dashboard', { params }).then(({ data }) => ativo && setMetricas(data)),
      api.get<ResumoEstoque>('/estoque/resumo', { params }).then(({ data }) => ativo && setEstoque(data)),
      api
        .get<SetorComEquipamentos[]>('/estoque/por-setor', { params })
        .then(({ data }) => ativo && setSetores(data)),
    ])
      .catch(() => undefined)
      .finally(() => {
        if (ativo) setCarregando(false);
      });
    return () => {
      ativo = false;
    };
  }, [empresaId]);

  // O analista ve so a empresa dele (o servidor impoe), sem filtro na tela.
  const nomeDaEmpresa =
    perfil && !perfil.admin
      ? (perfil.empresa ?? '')
      : (empresas.find((e) => String(e.id) === empresaId)?.apelido ?? 'Todas as empresas');

  // Numeros do estoque, ja filtrados pelo tipo escolhido.
  const tiposDisponiveis = [...new Set((estoque?.porCategoriaESituacao ?? []).map((l) => l.categoria))].sort();
  const tipoValido = tipo && tiposDisponiveis.includes(tipo) ? tipo : '';
  const linhasDoTipo = (estoque?.porCategoriaESituacao ?? []).filter((l) => !tipoValido || l.categoria === tipoValido);
  const contar = (...situacoes: string[]) =>
    linhasDoTipo.filter((l) => situacoes.includes(l.situacao)).reduce((soma, l) => soma + l.total, 0);
  const numeros = {
    emEstoque: contar('EM_ESTOQUE'),
    entregues: contar('ENTREGUE'),
    emprestados: contar('EMPRESTADO'),
    emManutencao: contar('MANUTENCAO'),
    reservados: contar('RESERVADO'),
    cadastrados: linhasDoTipo.reduce((soma, l) => soma + l.total, 0),
    valorEmEstoque: linhasDoTipo
      .filter((l) => l.situacao === 'EM_ESTOQUE')
      .reduce((soma, l) => soma + Number(l.valor), 0),
  };

  const exportar = async () => {
    setExportando(true);
    try {
      // Mesmos filtros da tela. O tipo (categoria) ainda e ignorado pela API.
      const params = new URLSearchParams({
        painel,
        ...(empresaId ? { empresaId } : {}),
        ...(painel === 'estoque' && tipoValido ? { tipo: tipoValido } : {}),
      });
      // Data local no nome: toISOString() usa UTC e, depois das 21h, dava o dia seguinte.
      await baixarArquivo(
        `/relatorios/planilha?${params.toString()}`,
        `notrole-${painel}-${format(new Date(), 'yyyy-MM-dd')}.xlsx`,
      );
    } catch {
      // Mensagem ja exibida pelo interceptor.
    } finally {
      setExportando(false);
    }
  };

  const estiloTooltip = {
    backgroundColor: escuro ? '#0f172a' : '#ffffff',
    border: `1px solid ${escuro ? '#1e293b' : '#e2e8f0'}`,
    borderRadius: '0.75rem',
    color: escuro ? '#f8fafc' : '#0f172a',
  };

  const dadosPizza = [
    { nome: 'Em estoque', valor: numeros.emEstoque, cor: '#10b981' },
    { nome: 'Entregues', valor: numeros.entregues, cor: '#6366f1' },
    { nome: 'Emprestados', valor: numeros.emprestados, cor: '#3b82f6' },
    { nome: 'Manutenção', valor: numeros.emManutencao, cor: '#f59e0b' },
    { nome: 'Reservados', valor: numeros.reservados, cor: '#8b5cf6' },
  ].filter((i) => i.valor > 0);

  const porSetor = setores.slice(0, 8).map((s) => ({ setor: s.departamento, total: s.total }));

  return (
    <div className="space-y-8">
      <PageHeader
        titulo="Dashboard"
        descricao={
          painel === 'estoque'
            ? 'Estoque de TI: o que tem, com quem está e quanto vale.'
            : 'Empréstimos com prazo e entregas com termo de comodato.'
        }
        acoes={
          <Button variant="outline" onClick={() => void exportar()} disabled={exportando} className="flex-1 sm:flex-none">
            {exportando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
            Exportar para Excel
          </Button>
        }
      />

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="flex gap-1.5">
          {(
            [
              { valor: 'estoque' as Painel, rotulo: 'Estoque', icone: <Boxes className="h-4 w-4" /> },
              { valor: 'emprestimos' as Painel, rotulo: 'Empréstimos', icone: <FileSignature className="h-4 w-4" /> },
            ]
          ).map((o) => (
            <button
              key={o.valor}
              type="button"
              onClick={() => escolherPainel(o.valor)}
              className={cn(
                'inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                painel === o.valor
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800/60',
              )}
            >
              {o.icone}
              {o.rotulo}
            </button>
          ))}
        </div>
        {perfil?.admin && (
          <FiltroEmpresa empresas={empresas} valor={empresaId} aoMudar={setEmpresaId} className="self-start sm:ml-auto sm:self-auto" />
        )}
      </div>

      {/* ------------------------------------------------------------ Estoque */}
      {painel === 'estoque' && (
      <section className="space-y-4">
        <Titulo
          icone={<Boxes className="h-4 w-4" />}
          texto="Estoque"
          complemento={nomeDaEmpresa}
          acao={
            <SeletorDeTipo tipos={tiposDisponiveis} valor={tipoValido} aoMudar={escolherTipo} />
          }
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Indicador
            titulo="Em estoque"
            valor={numeros.emEstoque}
            carregando={carregando}
            icone={<CircleCheck className="h-4 w-4" />}
            tom="verde"
            rodape={`de ${numeros.cadastrados} cadastrado(s)${tipoValido ? '' : ', de todos os tipos'}`}
          />
          <Indicador
            titulo="Com colaboradores"
            valor={numeros.entregues + numeros.emprestados}
            carregando={carregando}
            icone={<UserRound className="h-4 w-4" />}
            tom="indigo"
            rodape={`${numeros.entregues} entregue(s) · ${numeros.emprestados} emprestado(s)`}
          />
          <Indicador
            titulo="Em manutenção"
            valor={numeros.emManutencao}
            carregando={carregando}
            icone={<Wrench className="h-4 w-4" />}
            tom="ambar"
          />
          <IndicadorTexto
            titulo="Valor em estoque"
            valor={formatarMoeda(numeros.valorEmEstoque)}
            carregando={carregando}
            icone={<Wallet className="h-4 w-4" />}
            tom="cinza"
            rodape={tipoValido ? `Soma dos ${plural(tipoValido).toLowerCase()} guardados` : 'Soma dos equipamentos guardados'}
          />
        </div>

        {estoque && estoque.abaixoDoMinimo.length > 0 && (
          <Card className="border-amber-200 p-4 dark:border-amber-900/60">
            <p className="mb-2 flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-4 w-4" /> Estoque baixo
            </p>
            <ul className="space-y-1 text-sm text-slate-600 dark:text-slate-300">
              {estoque.abaixoDoMinimo.map((i) => (
                <li key={i.id}>
                  {i.descricao} — restam <b>{i.quantidade}</b> (mínimo {i.estoqueMinimo}) na {i.empresa}
                </li>
              ))}
            </ul>
          </Card>
        )}

        <div className="grid gap-4 lg:grid-cols-7">
          <Card className="lg:col-span-4">
            <CardHeader>
              <CardTitle className="text-base">Equipamentos por categoria</CardTitle>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Tudo o que está cadastrado, menos o que recebeu baixa.
              </p>
            </CardHeader>
            <CardContent className="pl-2">
              <div className="h-[280px] w-full">
                {!estoque || estoque.porCategoria.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-slate-500">
                    {carregando ? 'Carregando...' : 'Nenhum equipamento cadastrado.'}
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={estoque.porCategoria}>
                      <XAxis dataKey="categoria" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                      <Tooltip
                        cursor={{ fill: escuro ? '#1e293b' : '#f1f5f9' }}
                        contentStyle={estiloTooltip}
                        formatter={(valor) => [Number(valor ?? 0), 'Equipamentos']}
                      />
                      <Bar dataKey="total" fill="#6366f1" radius={[6, 6, 0, 0]} maxBarSize={56} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-base">Situação dos equipamentos</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-[280px] w-full items-center justify-center">
                {dadosPizza.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    {carregando ? 'Carregando...' : 'Nenhum equipamento cadastrado.'}
                  </p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={dadosPizza}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={85}
                        paddingAngle={4}
                        dataKey="valor"
                        nameKey="nome"
                      >
                        {dadosPizza.map((item) => (
                          <Cell key={item.nome} fill={item.cor} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={estiloTooltip} />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
              {dadosPizza.length > 0 && (
                <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs">
                  {dadosPizza.map((item) => (
                    <div key={item.nome} className="flex items-center gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: item.cor }} />
                      <span className="text-slate-600 dark:text-slate-300">
                        {item.nome} ({item.valor})
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Equipamentos por setor</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              O que está com as pessoas de cada setor, entregue ou emprestado.
            </p>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[260px] w-full">
              {porSetor.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {carregando ? 'Carregando...' : 'Nenhum equipamento está com colaborador.'}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={porSetor} layout="vertical" margin={{ left: 20 }}>
                    <XAxis type="number" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="setor"
                      stroke="#888888"
                      fontSize={12}
                      tickLine={false}
                      axisLine={false}
                      width={120}
                    />
                    <Tooltip
                      cursor={{ fill: escuro ? '#1e293b' : '#f1f5f9' }}
                      contentStyle={estiloTooltip}
                      formatter={(valor) => [Number(valor ?? 0), 'Equipamentos']}
                    />
                    <Bar dataKey="total" fill="#8b5cf6" radius={[0, 6, 6, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
      )}

      {/* ------------------------------------------------------- Empréstimos */}
      {painel === 'emprestimos' && (
      <section className="space-y-4">
        <Titulo
          icone={<FileSignature className="h-4 w-4" />}
          texto="Empréstimos"
          complemento={nomeDaEmpresa}
        />

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Indicador
            titulo="Em aberto"
            valor={metricas.emprestimos.emAberto}
            carregando={carregando}
            icone={<PackageCheck className="h-4 w-4" />}
            tom="azul"
            rodape={
              `${metricas.emprestimos.colaboradoresComEquipamento} colaborador(es) · ` +
              `${metricas.emprestimos.disponiveis} livre(s) para emprestar`
            }
          />
          <Indicador
            titulo="Aguardando assinatura"
            valor={metricas.emprestimos.aguardandoAssinatura}
            carregando={carregando}
            icone={<FileSignature className="h-4 w-4" />}
            tom="violeta"
            rodape="Termo enviado, sem todas as assinaturas"
          />
          <Indicador
            titulo="Devoluções atrasadas"
            valor={metricas.alertas.devolucoesAtrasadas}
            carregando={carregando}
            icone={<AlertTriangle className="h-4 w-4" />}
            tom="vermelho"
            destaque={metricas.alertas.devolucoesAtrasadas > 0}
            rodape="Cobrança automática por e-mail"
          />
          <Indicador
            titulo="Vencendo em 7 dias"
            valor={metricas.alertas.vencendoEmSeteDias}
            carregando={carregando}
            icone={<CalendarClock className="h-4 w-4" />}
            tom="ambar"
          />
        </div>

        {metricas.alertas.maioresAtrasos.length > 0 && (
          <Card className="border-red-200 dark:border-red-900/50">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-500" />
                Atrasos mais antigos
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {metricas.alertas.maioresAtrasos.map((item) => (
                  <li key={item.id} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-900 dark:text-slate-100">
                        {item.colaborador}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        {item.hostname} · prazo {formatarData(item.dataPrevista)}
                      </p>
                    </div>
                    <span className="ml-3 shrink-0 rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-400/10 dark:text-red-400">
                      {item.diasAtraso} {item.diasAtraso === 1 ? 'dia' : 'dias'}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empréstimos por departamento</CardTitle>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Contagem do ano corrente. Só empréstimos com prazo, não entregas definitivas.
            </p>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[280px] w-full">
              {metricas.emprestimosPorDepartamento.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-slate-500">
                  {carregando ? 'Carregando...' : 'Nenhum empréstimo registrado neste ano.'}
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={metricas.emprestimosPorDepartamento}>
                    <XAxis dataKey="departamento" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
                    <Tooltip
                      cursor={{ fill: escuro ? '#1e293b' : '#f1f5f9' }}
                      contentStyle={estiloTooltip}
                      formatter={(valor) => [Number(valor ?? 0), 'Empréstimos']}
                    />
                    <Bar dataKey="total" fill="#3b82f6" radius={[6, 6, 0, 0]} maxBarSize={56} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** "Notebook" -> "Notebooks", "Celular" -> "Celulares". Nomes compostos ficam como estao. */
function plural(nome: string): string {
  if (/\s/.test(nome)) return nome;
  if (/[aeiou]$/i.test(nome)) return `${nome}s`;
  if (/[rsz]$/i.test(nome)) return `${nome}es`;
  if (/m$/i.test(nome)) return `${nome.slice(0, -1)}ns`;
  return nome;
}

/**
 * Escolhe o tipo de equipamento dos cartoes do estoque. Vale para os quatro
 * numeros e para o grafico de situacao: escolhendo "Notebooks", tudo passa a
 * falar so de notebook.
 */
function SeletorDeTipo({
  tipos,
  valor,
  aoMudar,
}: {
  tipos: string[];
  valor: string;
  aoMudar: (tipo: string) => void;
}) {
  if (tipos.length === 0) return null;
  return (
    <label className="relative inline-flex items-center">
      <span className="sr-only">Tipo de equipamento</span>
      <select
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white py-1.5 pl-3 pr-8 text-sm font-medium text-slate-700 shadow-xs transition-colors hover:border-slate-300 focus-visible:border-indigo-500 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-indigo-500/15 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-slate-700"
      >
        <option value="">Todos os equipamentos</option>
        {tipos.map((t) => (
          <option key={t} value={t}>
            {plural(t)}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 h-4 w-4 text-slate-400" />
    </label>
  );
}

function Titulo({
  icone,
  texto,
  complemento,
  acao,
}: {
  icone: React.ReactNode;
  texto: string;
  complemento?: string;
  /** Aparece a direita, depois da linha. */
  acao?: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
        {icone}
      </div>
      <h3 className="font-semibold tracking-tight text-slate-900 dark:text-slate-100">{texto}</h3>
      {complemento && (
        <span className="text-xs text-slate-400 dark:text-slate-500">· {complemento}</span>
      )}
      <div className="ml-2 h-px flex-1 bg-slate-200/70 dark:bg-slate-800" />
      {acao}
    </div>
  );
}

const TOM_ICONE = {
  indigo: 'bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10 dark:text-indigo-400',
  verde: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400',
  azul: 'bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-400',
  violeta: 'bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-400',
  vermelho: 'bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400',
  ambar: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-400',
  cinza: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

function Indicador(props: {
  titulo: string;
  valor: number;
  icone: React.ReactNode;
  tom?: keyof typeof TOM_ICONE;
  carregando: boolean;
  rodape?: string;
  destaque?: boolean;
}) {
  return <IndicadorTexto {...props} valor={String(props.valor)} />;
}

function IndicadorTexto({
  titulo,
  valor,
  icone,
  tom = 'cinza',
  carregando,
  rodape,
  destaque,
}: {
  titulo: string;
  valor: string;
  icone: React.ReactNode;
  tom?: keyof typeof TOM_ICONE;
  carregando: boolean;
  rodape?: string;
  destaque?: boolean;
}) {
  return (
    <Card className={cn('p-5', destaque && 'border-red-200 dark:border-red-900/60')}>
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{titulo}</p>
        <div className={cn('flex h-8 w-8 items-center justify-center rounded-lg', TOM_ICONE[tom])}>{icone}</div>
      </div>
      <div className="mt-2 text-3xl font-semibold tracking-tight tabular-nums text-slate-900 dark:text-slate-50">
        {carregando ? <Loader2 className="h-7 w-7 animate-spin text-slate-300 dark:text-slate-600" /> : valor}
      </div>
      <p className="mt-1 min-h-4 text-xs text-slate-500 dark:text-slate-400">{!carregando && rodape}</p>
    </Card>
  );
}
