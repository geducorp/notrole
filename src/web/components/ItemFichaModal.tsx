import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Ban,
  FileSignature,
  Loader2,
  Pencil,
  RefreshCw,
  Trash2,
  TriangleAlert,
  UserPlus,
  Wrench,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { EmprestimoAcaoModal } from '@/components/EmprestimoAcaoModal';
import { NewLoanModal } from '@/components/NewLoanModal';
import { api, ehConflito } from '@/lib/api';
import {
  CLASSE_CONDICAO_ITEM,
  CLASSE_SITUACAO_ITEM,
  formatarData,
  formatarDataHora,
  formatarMoeda,
  nomeDoItem,
  ROTULO_CONDICAO_ITEM,
  ROTULO_MOVIMENTACAO,
  ROTULO_SITUACAO_ITEM,
  rotuloSituacaoEmprestimo,
  ehComputador,
  especificacoesDoItem,
  pendenteDeFormatacao,
  TOM,
} from '@/lib/dominio';
import { iconeDaCategoria } from '@/lib/icones';
import { usePerfil } from '@/lib/perfil';
import type { Emprestimo, Empresa, ItemDetalhado, SituacaoItem } from '@/types';
import { NomeEmpresa, nomeCurtoDaEmpresa } from '@/components/ui/Empresa';

/** Acoes de estoque que tem formulario proprio aqui. */
type AcaoDeEstoqueTipo = 'devolucao' | 'transferencia' | 'manutencao' | 'retorno-manutencao' | 'baixa';
type Acao = AcaoDeEstoqueTipo | 'entrega';

const TITULO_ACAO: Record<Acao, string> = {
  entrega: 'Entregar a um colaborador',
  devolucao: 'Receber de volta',
  transferencia: 'Transferir de estoque',
  manutencao: 'Enviar para manutenção',
  'retorno-manutencao': 'Voltou da manutenção',
  baixa: 'Dar baixa',
};

/** Nome curto nos botoes da ficha, para caber na janela. */
const BOTAO_ACAO: Record<Acao, string> = {
  entrega: 'Entregar',
  devolucao: 'Receber de volta',
  transferencia: 'Transferir',
  manutencao: 'Manutenção',
  'retorno-manutencao': 'Voltou da manutenção',
  baixa: 'Baixa',
};

const ICONE_ACAO: Record<Acao, React.ReactNode> = {
  entrega: <UserPlus className="mr-1.5 h-3.5 w-3.5" />,
  devolucao: <ArrowDownToLine className="mr-1.5 h-3.5 w-3.5" />,
  transferencia: <ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />,
  manutencao: <Wrench className="mr-1.5 h-3.5 w-3.5" />,
  'retorno-manutencao': <Wrench className="mr-1.5 h-3.5 w-3.5" />,
  baixa: <Ban className="mr-1.5 h-3.5 w-3.5" />,
};

/**
 * Ficha do equipamento: dados, acoes de estoque e o extrato de tudo o que
 * aconteceu com ele.
 *
 * Entregar e receber de volta passam pela cessao (a mesma do emprestimo): a
 * entrega gera o termo de comodato no D4Sign e a devolucao gera o comprovante.
 */
export function ItemFichaModal({
  itemId,
  aoFechar,
  aoMudar,
  aoEditar,
  empresas,
}: {
  itemId: number | null;
  aoFechar: () => void;
  aoMudar: () => void;
  aoEditar: (item: ItemDetalhado) => void;
  empresas: Empresa[];
}) {
  const perfil = usePerfil();
  const [item, setItem] = useState<ItemDetalhado | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [excluir, setExcluir] = useState(false);
  // Falha ao carregar a ficha: sem isto o spinner girava para sempre.
  const [erroAoCarregar, setErroAoCarregar] = useState(false);

  const carregar = useCallback(async (): Promise<ItemDetalhado | null> => {
    if (itemId === null) return null;
    setErroAoCarregar(false);
    try {
      const { data } = await api.get<ItemDetalhado>(`/itens/${itemId}`);
      setItem(data);
      return data;
    } catch {
      // Mensagem ja exibida pelo interceptor.
      setErroAoCarregar(true);
      return null;
    }
  }, [itemId]);

  useEffect(() => {
    setItem(null);
    setAcao(null);
    setExcluir(false);
    void carregar();
  }, [carregar]);

  if (itemId === null) return null;

  const Icone = iconeDaCategoria(item?.categoria?.icone);

  // Emprestimo ou entrega em aberto deste equipamento, se houver.
  const cessaoAberta: Emprestimo | null = item
    ? ((item.emprestimos.find((e) => e.status === 'ATIVO' || e.status === 'AGUARDANDO_ASSINATURA') as
        | Emprestimo
        | undefined) ?? null)
    : null;

  const acoesDisponiveis: Acao[] = !item
    ? []
    : item.situacao === 'EM_ESTOQUE'
      ? ['entrega', 'transferencia', 'manutencao', 'baixa']
      : item.situacao === 'ENTREGUE' || item.situacao === 'EMPRESTADO'
        ? ['devolucao']
        : item.situacao === 'MANUTENCAO'
          ? ['retorno-manutencao', 'baixa']
          : [];

  // Com algum colaborador, primeiro vem a devolucao; excluir nem aparece.
  const comColaborador = !!item && ['ENTREGUE', 'EMPRESTADO', 'RESERVADO'].includes(item.situacao);
  // A API so exclui o que tem apenas o cadastro no extrato; o resto vai para a baixa.
  const semHistorico =
    !!item &&
    item.emprestimos.length === 0 &&
    item.movimentacoes.every((m) => m.tipo === 'ENTRADA' || m.tipo === 'CONTAGEM_INICIAL');

  // Equipamento de outra empresa: o analista ve a ficha, mas so um analista
  // daquela empresa (ou o administrador) movimenta. Quem garante e a API.
  const deOutraEmpresa =
    !!item && !!perfil && !perfil.admin && perfil.empresaId !== null && item.empresaId !== perfil.empresaId;

  const concluir = async () => {
    // Recarrega e so fecha se o equipamento saiu do Estoque de verdade (baixa,
    // entrega, emprestimo). Em conflito (409) a situacao nao muda e a ficha fica
    // aberta, atualizada. Aberta pela tela de Entregas, editar tambem nao fecha.
    const antes = item?.situacao;
    setAcao(null);
    aoMudar();
    const depois = await carregar();
    const saiu: SituacaoItem[] = ['BAIXADO', 'ENTREGUE', 'EMPRESTADO'];
    if (depois && depois.situacao !== antes && saiu.includes(depois.situacao)) aoFechar();
  };

  // A cessao montada no formato que a tela de devolucao espera.
  const cessaoParaDevolucao: Emprestimo | null =
    item && cessaoAberta ? { ...cessaoAberta, item, atrasado: false, diasAtraso: 0 } : null;

  return (
    <>
      <Modal
        aberto={acao === null && !excluir}
        aoFechar={aoFechar}
        icone={<Icone className="h-4 w-4" />}
        titulo={item ? nomeDoItem(item) : 'Equipamento'}
        descricao={
          // Sem hostname, marca + modelo ja e o titulo: nao repete.
          item
            ? [item.categoria?.nome, item.hostname ? [item.marca, item.modelo].filter(Boolean).join(' ') : null]
                .filter(Boolean)
                .join(' · ')
            : undefined
        }
        largura="xl"
        rodape={
          item &&
          (deOutraEmpresa ? (
            <p className="mr-auto text-xs text-slate-500 dark:text-slate-400">
              Equipamento da {nomeCurtoDaEmpresa(item.empresa.apelido)}: só um analista dela pode movimentar.
            </p>
          ) : (
            <>
              <Button variant="ghost" size="sm" onClick={() => aoEditar(item)} className="mr-auto">
                <Pencil className="mr-1.5 h-3.5 w-3.5" /> Editar
              </Button>
              {!comColaborador && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setExcluir(true)}
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Excluir
                </Button>
              )}
              {acoesDisponiveis.map((a) => (
                <Button
                  key={a}
                  variant={a === 'baixa' ? 'ghost' : 'outline'}
                  size="sm"
                  title={TITULO_ACAO[a]}
                  onClick={() => setAcao(a)}
                >
                  {ICONE_ACAO[a]}
                  {BOTAO_ACAO[a]}
                </Button>
              ))}
            </>
          ))
        }
      >
        {!item && erroAoCarregar ? (
          <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
            <TriangleAlert className="h-5 w-5 text-amber-500" />
            Não foi possível carregar a ficha deste equipamento.
            <Button type="button" variant="outline" size="sm" onClick={() => void carregar()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Tentar de novo
            </Button>
          </div>
        ) : !item ? (
          <div className="flex justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge className={CLASSE_SITUACAO_ITEM[item.situacao]}>
                {ROTULO_SITUACAO_ITEM[item.situacao]}
              </Badge>
              <Badge className={CLASSE_CONDICAO_ITEM[item.condicao]}>
                {ROTULO_CONDICAO_ITEM[item.condicao]}
              </Badge>
              {item.paraEmprestimo && <Badge className={CLASSE_SITUACAO_ITEM.EMPRESTADO}>Para empréstimo</Badge>}
              {pendenteDeFormatacao(item) && (
                <Badge className={TOM.ambar} title="Sem hostname. Ao formatar, informe o hostname em Editar.">
                  Pendente de formatação
                </Badge>
              )}
            </div>

            {cessaoAberta && cessaoParaDevolucao && (
              <div className="flex items-start gap-3 rounded-xl bg-indigo-50 p-3.5 text-sm text-indigo-900 ring-1 ring-inset ring-indigo-600/15 dark:bg-indigo-500/10 dark:text-indigo-200 dark:ring-indigo-400/20">
                <FileSignature className="mt-0.5 h-4 w-4 shrink-0" />
                <p>
                  {cessaoAberta.modalidade === 'DEFINITIVA' ? 'Entregue' : 'Emprestado'} para{' '}
                  <b>{cessaoAberta.colaborador.nome}</b> em {formatarData(cessaoAberta.dataInicio)}
                  {cessaoAberta.dataPrevista ? `, prazo ${formatarData(cessaoAberta.dataPrevista)}` : ''}.
                  <span className="block text-xs opacity-80">
                    Termo: {rotuloSituacaoEmprestimo(cessaoParaDevolucao)}. Acompanhe em{' '}
                    {cessaoAberta.modalidade === 'DEFINITIVA' ? 'Entregas' : 'Empréstimos'}.
                  </span>
                </p>
              </div>
            )}

            {/*
              Em linha que se ajusta: com 4 ou 5 dados, nunca sobra quadrado
              vazio. Hostname e especificacoes so aparecem em computador.
            */}
            <dl className="flex flex-wrap gap-px overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200/80 text-sm dark:border-slate-800 dark:bg-slate-800">
              {(
                [
                  ...(ehComputador(item.categoria) ? [['Hostname', item.hostname ?? '-']] : []),
                  ['Patrimônio', item.patrimonio ?? '-'],
                  ...(ehComputador(item.categoria) && especificacoesDoItem(item)
                    ? [['Especificações', especificacoesDoItem(item)]]
                    : []),
                  ['Empresa', <NomeEmpresa apelido={item.empresa.apelido} />],
                  ['Valor', item.valor ? formatarMoeda(item.valor) : '-'],
                  ['Entrada', formatarData(item.dataEntrada)],
                ] as Array<[string, React.ReactNode]>
              ).map(([rotulo, valor]) => (
                <div key={rotulo} className="min-w-0 flex-1 basis-[9rem] bg-slate-50 px-3.5 py-2.5 dark:bg-slate-950/60">
                  <dt className="text-xs text-slate-500 dark:text-slate-400">{rotulo}</dt>
                  {/* Quebra a linha em vez de cortar: hostname e patrimonio precisam aparecer inteiros. */}
                  <dd className="flex break-all font-medium text-slate-900 dark:text-slate-100">{valor}</dd>
                </div>
              ))}
            </dl>

            {item.observacoes && (
              <p className="rounded-xl bg-slate-50 p-3.5 text-sm text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
                {item.observacoes}
              </p>
            )}

            <div>
              <p className="mb-3 text-sm font-medium text-slate-900 dark:text-slate-100">
                Extrato <span className="font-normal text-slate-500">({item.movimentacoes.length})</span>
              </p>
              {item.movimentacoes.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-200 py-6 text-center text-sm text-slate-500 dark:border-slate-800">
                  Nenhuma movimentação registrada.
                </p>
              ) : (
                <ol className="relative ml-1.5 space-y-4 border-l border-slate-200 pl-6 dark:border-slate-800">
                  {item.movimentacoes.map((m) => (
                    <li key={m.id} className="relative">
                      <span className="absolute -left-[1.84rem] top-1 h-3 w-3 rounded-full bg-indigo-500 ring-4 ring-white dark:ring-slate-900" />
                      <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                        {ROTULO_MOVIMENTACAO[m.tipo] ?? m.tipo}
                        {m.colaborador ? ` · ${m.colaborador.nome}` : ''}
                      </p>
                      {m.observacao && (
                        <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-400">{m.observacao}</p>
                      )}
                      <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                        {formatarDataHora(m.data)}
                        {m.usuario ? ` · ${m.usuario}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        )}
      </Modal>

      {item && excluir && (
        <ExcluirItem
          item={item}
          semHistorico={semHistorico}
          podeDarBaixa={item.situacao !== 'BAIXADO'}
          aoFechar={() => setExcluir(false)}
          aoDarBaixa={() => {
            setExcluir(false);
            setAcao('baixa');
          }}
          aoExcluir={() => {
            setExcluir(false);
            aoMudar();
            aoFechar();
          }}
        />
      )}

      {/* Entrega: a mesma tela do emprestimo, sem prazo, com o comodato da entrega. */}
      {item && (
        <NewLoanModal
          aberto={acao === 'entrega'}
          aoFechar={() => setAcao(null)}
          aoSalvar={() => void concluir()}
          modalidade="DEFINITIVA"
          itemInicial={item}
        />
      )}

      {/* Devolucao de algo emprestado ou entregue com termo: gera o comprovante. */}
      {item && acao === 'devolucao' && cessaoParaDevolucao && (
        <EmprestimoAcaoModal
          acao="devolucao"
          emprestimo={cessaoParaDevolucao}
          aoFechar={() => setAcao(null)}
          aoConcluir={() => void concluir()}
        />
      )}

      {item && acao && acao !== 'entrega' && !(acao === 'devolucao' && cessaoParaDevolucao) && (
        <AcaoDeEstoque
          acao={acao}
          item={item}
          empresas={empresas}
          aoFechar={() => setAcao(null)}
          aoConcluir={() => void concluir()}
        />
      )}
    </>
  );
}

/**
 * Formulario das movimentacoes que nao envolvem colaborador: transferencia,
 * manutencao e baixa. Tambem recebe de volta equipamentos entregues antes de a
 * entrega gerar comodato (sem cessao registrada).
 */
function AcaoDeEstoque({
  acao,
  item,
  empresas,
  aoFechar,
  aoConcluir,
}: {
  acao: AcaoDeEstoqueTipo;
  item: ItemDetalhado;
  empresas: Empresa[];
  aoFechar: () => void;
  aoConcluir: () => void;
}) {
  const [observacao, setObservacao] = useState('');
  const [avariado, setAvariado] = useState(false);
  // Transferencia e sempre para o estoque de outra empresa.
  const outrasEmpresas = empresas.filter((e) => e.id !== item.empresaId);
  const [empresaId, setEmpresaId] = useState(String(outrasEmpresas[0]?.id ?? ''));
  const [enviando, setEnviando] = useState(false);

  const enviar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEnviando(true);
    try {
      const corpo: Record<string, unknown> = { observacao: observacao.trim() || null };
      if (acao === 'devolucao') corpo.condicaoAvariada = avariado;
      if (acao === 'transferencia') {
        corpo.empresaId = Number(empresaId);
      }

      await api.post(`/itens/${item.id}/${acao}`, corpo);
      toast.success('Movimentação registrada.');
      aoConcluir();
    } catch (erro) {
      // Mensagem ja exibida pelo interceptor. Em conflito (o equipamento mudou
      // de situacao enquanto a tela estava aberta), recarrega ficha e lista.
      if (ehConflito(erro)) aoConcluir();
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      titulo={TITULO_ACAO[acao]}
      descricao={nomeDoItem(item)}
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            type="submit"
            form="form-acao-estoque"
            variant={acao === 'baixa' ? 'destructive' : 'default'}
            disabled={enviando}
          >
            {enviando ? 'Enviando...' : 'Confirmar'}
          </Button>
        </>
      }
    >
      <form id="form-acao-estoque" onSubmit={enviar} className="space-y-4">
        {acao === 'devolucao' && (
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-200 p-3.5 dark:border-slate-800">
            <input
              type="checkbox"
              checked={avariado}
              onChange={(e) => setAvariado(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-indigo-600"
            />
            <span className="text-sm">
              <span className="font-medium text-slate-900 dark:text-slate-100">Voltou com avaria</span>
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                Em vez de voltar ao estoque, o equipamento vai para manutenção.
              </span>
            </span>
          </label>
        )}

        {acao === 'transferencia' && (
          <Campo rotulo="Empresa de destino" obrigatorio dica={`Hoje está no estoque da ${nomeCurtoDaEmpresa(item.empresa.apelido)}.`}>
            <Select value={empresaId} onChange={(e) => setEmpresaId(e.target.value)} required>
              {outrasEmpresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.apelido}
                </option>
              ))}
            </Select>
          </Campo>
        )}

        <Campo
          rotulo={acao === 'baixa' ? 'Motivo da baixa' : 'Observação'}
          obrigatorio={acao === 'baixa'}
          dica={
            acao === 'baixa'
              ? 'Descarte, perda ou venda. O equipamento sai de circulação, mas o histórico continua.'
              : 'Opcional. Aparece no extrato do equipamento.'
          }
        >
          <Input
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            maxLength={500}
            required={acao === 'baixa'}
          />
        </Campo>
      </form>
    </Modal>
  );
}

/**
 * Excluir de vez so vale para cadastro feito por engano (nada alem da entrada
 * no extrato). Com historico, a exclusao apagaria quem esteve com o
 * equipamento: a tela explica e oferece a baixa.
 */
function ExcluirItem({
  item,
  semHistorico,
  podeDarBaixa,
  aoFechar,
  aoDarBaixa,
  aoExcluir,
}: {
  item: ItemDetalhado;
  semHistorico: boolean;
  podeDarBaixa: boolean;
  aoFechar: () => void;
  aoDarBaixa: () => void;
  aoExcluir: () => void;
}) {
  const [enviando, setEnviando] = useState(false);

  const confirmar = async () => {
    setEnviando(true);
    try {
      await api.delete(`/itens/${item.id}`);
      toast.success('Equipamento excluído.');
      aoExcluir();
    } catch {
      // Mensagem ja exibida pelo interceptor (ex.: historico criado agora).
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      icone={<Trash2 className="h-4 w-4" />}
      titulo={semHistorico ? 'Excluir equipamento' : 'Este equipamento não pode ser excluído'}
      descricao={nomeDoItem(item)}
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
          {semHistorico ? (
            <Button type="button" variant="destructive" onClick={() => void confirmar()} disabled={enviando}>
              {enviando ? 'Excluindo...' : 'Excluir de vez'}
            </Button>
          ) : (
            podeDarBaixa && (
              <Button type="button" variant="destructive" onClick={aoDarBaixa}>
                <Ban className="mr-1.5 h-3.5 w-3.5" /> Dar baixa
              </Button>
            )
          )}
        </>
      }
    >
      {semHistorico ? (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          O cadastro some do sistema. Use para equipamento cadastrado por engano. Não dá para desfazer.
        </p>
      ) : (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Ele já tem histórico (entregas, empréstimos ou movimentações), e excluir apagaria o registro de quem
          esteve com ele.{' '}
          {podeDarBaixa
            ? 'Dê baixa: ele sai do estoque e das listas, e o histórico continua guardado.'
            : 'Ele já está baixado: fora do estoque, com o histórico guardado.'}
        </p>
      )}
    </Modal>
  );
}
