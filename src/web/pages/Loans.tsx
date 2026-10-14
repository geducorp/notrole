import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Download,
  FileCheck,
  FileText,
  History,
  MailWarning,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  XCircle,
  Zap,
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
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { PageHeader } from '@/components/ui/PageHeader';
import { Select } from '@/components/ui/Select';
import { NewLoanModal } from '@/components/NewLoanModal';
import { EmprestimoAcaoModal, type AcaoEmprestimo } from '@/components/EmprestimoAcaoModal';
import { HistoricoModal } from '@/components/HistoricoModal';
import { ItemFichaModal } from '@/components/ItemFichaModal';
import { ItemModal } from '@/components/ItemModal';
import { api, baixarArquivo } from '@/lib/api';
import {
  classeSituacaoEmprestimo,
  formatarData,
  ROTULO_STATUS_EMPRESTIMO,
  rotuloSituacaoEmprestimo,
  detalheDaFila,
  conviteNaoEntregue,
  nomeDoItem,
  termoPrecisaDeAtencao,
} from '@/lib/dominio';
import type { Categoria, Empresa, Emprestimo, Item, ModalidadeCessao, StatusEmprestimo } from '@/types';

/**
 * Emprestimos (com prazo) e entregas (definitivas) na mesma tela: as duas sao
 * cessoes com termo de comodato, com o mesmo acompanhamento de assinatura,
 * historico e devolucao. So a entrega nao tem prazo, renovacao nem cobranca.
 */
export function Loans({ modalidade = 'TEMPORARIA' }: { modalidade?: ModalidadeCessao }) {
  const entregas = modalidade === 'DEFINITIVA';
  const [emprestimos, setEmprestimos] = useState<Emprestimo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<StatusEmprestimo | 'ATRASADOS' | ''>('');
  const [modalNovoAberto, setModalNovoAberto] = useState(false);
  const [acao, setAcao] = useState<AcaoEmprestimo | null>(null);
  const [selecionado, setSelecionado] = useState<Emprestimo | null>(null);
  const [historicoDe, setHistoricoDe] = useState<Emprestimo | null>(null);
  const [baixando, setBaixando] = useState(false);
  // Ficha do equipamento: daqui se ve o que foi entregue ou emprestado, que nao
  // aparece no Estoque.
  const [fichaDe, setFichaDe] = useState<number | null>(null);
  const [itemEditado, setItemEditado] = useState<Item | null>(null);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);

  useEffect(() => {
    void Promise.all([
      api.get<Categoria[]>('/estoque/categorias').then(({ data }) => setCategorias(data)),
      api.get<Empresa[]>('/empresas').then(({ data }) => setEmpresas(data.filter((e) => e.ativo))),
    ]).catch(() => undefined);
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const { data } = await api.get<Emprestimo[]>('/emprestimos', {
        params: {
          modalidade,
          ...(filtroStatus && filtroStatus !== 'ATRASADOS' ? { status: filtroStatus } : {}),
        },
      });
      setEmprestimos(data);
    } catch {
      setEmprestimos([]);
    } finally {
      setCarregando(false);
    }
  }, [filtroStatus, modalidade]);

  useEffect(() => {
    setFiltroStatus('');
  }, [modalidade]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();

    return emprestimos.filter((e) => {
      if (filtroStatus === 'ATRASADOS' && !e.atrasado) return false;
      if (!termo) return true;

      return (
        nomeDoItem(e.item).toLowerCase().includes(termo) ||
        (e.item.patrimonio ?? '').toLowerCase().includes(termo) ||
        e.colaborador.nome.toLowerCase().includes(termo) ||
        e.colaborador.email.toLowerCase().includes(termo)
      );
    });
  }, [emprestimos, busca, filtroStatus]);

  const [verificando, setVerificando] = useState<number | null>(null);

  /**
   * Pergunta ao D4Sign, na hora, se o termo foi assinado. O sistema ja faz isso
   * sozinho a cada hora; o botao serve para quando o colaborador avisa que
   * acabou de assinar e nao se quer esperar.
   */
  const verificarAssinatura = async (emprestimo: Emprestimo) => {
    setVerificando(emprestimo.id);
    try {
      const { data } = await api.post<{
        status: string;
        assinado: boolean;
        cancelado: boolean;
        avisoEmail: string | null;
        assinaturas: { assinados: number; total: number; faltam: string[] } | null;
      }>(
        `/emprestimos/${emprestimo.id}/verificar-assinatura`,
        {},
      );
      const parcial = data.assinaturas
        ? `${data.assinaturas.assinados} de ${data.assinaturas.total} assinaram` +
          (data.assinaturas.faltam.length ? `. Falta: ${data.assinaturas.faltam.join(', ')}` : '')
        : undefined;

      if (data.assinado) {
        toast.success(
          emprestimo.modalidade === 'DEFINITIVA'
            ? 'Termo assinado! A entrega foi ativada.'
            : 'Termo assinado! O empréstimo foi ativado.',
        );
      }
      else if (data.cancelado) toast.warning('O termo foi cancelado no D4Sign.');
      else if (data.avisoEmail) {
        toast.error('O e-mail de assinatura não foi entregue.', { description: data.avisoEmail });
      } else {
        toast.info('O termo ainda não está concluído.', {
          description: parcial ?? `Situação no D4Sign: ${data.status}.`,
        });
      }
      void carregar();
    } catch {
      // Mensagem ja exibida pelo interceptor (inclusive falta de cota).
    } finally {
      setVerificando(null);
    }
  };

  /**
   * O sistema parou de tentar gerar o termo e esperou alguém conferir o painel
   * do D4Sign. A confirmação é explícita porque, se o documento já tiver sido
   * criado lá, uma nova tentativa geraria outro - cobrado de novo.
   */
  const tentarTermoNovamente = async (emprestimo: Emprestimo) => {
    const ambiguo = emprestimo.d4signStatus?.startsWith('VERIFICAR NO D4SIGN');

    const confirmado = window.confirm(
      ambiguo
        ? 'ATENÇÃO: não foi possível confirmar se este termo chegou a ser criado no D4Sign.\n\n' +
            'Antes de continuar, abra o painel do D4Sign e procure por um documento chamado\n' +
            `"Termo de responsabilidade - ${nomeDoItem(emprestimo.item)} - ${emprestimo.colaborador.nome}".\n\n` +
            'Se ele JÁ EXISTIR, cancele aqui e use "Ativar sem esperar a assinatura" - ' +
            'uma nova tentativa criaria um segundo documento, cobrado de novo.\n\n' +
            'O documento NÃO existe no painel e quer tentar de novo?'
        : `Tentar gerar o termo de ${emprestimo.colaborador.nome} novamente?\n\n` +
            'O sistema retoma de onde parou, sem criar outro documento.',
    );
    if (!confirmado) return;

    try {
      await api.post(`/emprestimos/${emprestimo.id}/termo/tentar-novamente`, {});
      toast.success('Termo recolocado na fila.');
      void carregar();
    } catch {
      // Mensagem ja exibida pelo interceptor.
    }
  };

  const [reenviando, setReenviando] = useState<number | null>(null);

  /**
   * Pede ao D4Sign que mande de novo o e-mail de assinatura. Não cria
   * documento nem gasta envio do pacote. Quando o endereço está na lista de
   * supressão do D4Sign, só adianta depois que o suporte deles o liberar.
   */
  const reenviarConvite = async (emprestimo: Emprestimo) => {
    const aviso = emprestimo.d4signAvisoEmail;
    const confirmado = window.confirm(
      (aviso
        ? `O e-mail de assinatura não foi entregue:\n${aviso}\n\n` +
          'Se o endereço está na lista de supressão do D4Sign, o reenvio só funciona depois que o ' +
          'suporte do D4Sign liberar o endereço. Enquanto isso, a pessoa pode assinar pelo painel do D4Sign.\n\n'
        : '') + `Reenviar o convite de assinatura do termo de ${emprestimo.colaborador.nome}?`,
    );
    if (!confirmado) return;

    setReenviando(emprestimo.id);
    try {
      const { data } = await api.post<{ reenviadoPara: string[] }>(
        `/emprestimos/${emprestimo.id}/termo/reenviar-convite`,
        {},
      );
      toast.success(`Convite reenviado para ${data.reenviadoPara.join(' e ')}.`);
      void carregar();
    } catch {
      // Mensagem ja exibida pelo interceptor.
    } finally {
      setReenviando(null);
    }
  };

  /** O mesmo PDF que o colaborador recebeu por e-mail na devolucao. */
  const baixarComprovante = async (emprestimo: Emprestimo) => {
    try {
      await baixarArquivo(
        `/emprestimos/${emprestimo.id}/comprovante-devolucao`,
        `comprovante-devolucao-${emprestimo.id}-${nomeDoItem(emprestimo.item)}.pdf`,
      );
    } catch {
      // Mensagem ja exibida pelo interceptor.
    }
  };

  const abrirAcao = (novaAcao: AcaoEmprestimo, emprestimo: Emprestimo) => {
    setSelecionado(emprestimo);
    setAcao(novaAcao);
  };

  const baixarRelatorio = async () => {
    setBaixando(true);
    try {
      await baixarArquivo('/relatorios/pdf/emprestimos', 'emprestimos-em-aberto.pdf');
    } catch {
      // Mensagem ja exibida.
    } finally {
      setBaixando(false);
    }
  };

  const totalAtrasados = emprestimos.filter((e) => e.atrasado).length;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo={entregas ? 'Entregas' : 'Empréstimos'}
        descricao={
          entregas
            ? 'Equipamentos entregues em definitivo, para uso no trabalho, com termo de comodato.'
            : 'Empréstimos com prazo de devolução, lembrete e cobrança de atraso.'
        }
        acoes={
          <>
            {!entregas && (
              <Button variant="outline" onClick={baixarRelatorio} disabled={baixando} className="flex-1 sm:flex-none">
                <Download className="mr-2 h-4 w-4" />
                {baixando ? 'Gerando...' : 'Relatório'}
              </Button>
            )}
            <Button onClick={() => setModalNovoAberto(true)} className="flex-1 sm:flex-none">
              <Plus className="mr-2 h-4 w-4" /> {entregas ? 'Nova entrega' : 'Novo empréstimo'}
            </Button>
          </>
        }
      />


      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Hostname, patrimônio, colaborador ou e-mail..."
            className="pl-9"
          />
        </div>
        <Select
          containerClassName="sm:w-56"
          value={filtroStatus}
          onChange={(e) => setFiltroStatus(e.target.value as StatusEmprestimo | 'ATRASADOS' | '')}
        >
          <option value="">Todos</option>
          {!entregas && (
            <option value="ATRASADOS">
              Somente atrasados{totalAtrasados > 0 ? ` (${totalAtrasados})` : ''}
            </option>
          )}
          {(Object.keys(ROTULO_STATUS_EMPRESTIMO) as StatusEmprestimo[]).map((status) => (
            <option key={status} value={status}>
              {ROTULO_STATUS_EMPRESTIMO[status]}
            </option>
          ))}
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Equipamento</TableHead>
            <TableHead>Colaborador</TableHead>
            <TableHead>{entregas ? 'Entregue em' : 'Retirada'}</TableHead>
            {!entregas && <TableHead>Prazo</TableHead>}
            <TableHead>Situação</TableHead>
            <TableHead className="text-right">Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {carregando ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                Carregando...
              </TableCell>
            </TableRow>
          ) : visiveis.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                {entregas ? 'Nenhuma entrega encontrada.' : 'Nenhum empréstimo encontrado.'}
              </TableCell>
            </TableRow>
          ) : (
            visiveis.map((e) => {
              const emAberto = e.status === 'ATIVO' || e.status === 'AGUARDANDO_ASSINATURA';

              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        title="Abrir a ficha do equipamento"
                        onClick={() => setFichaDe(e.itemId)}
                        className="self-start whitespace-nowrap font-mono text-[13px] font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                      >
                        {nomeDoItem(e.item)}
                      </button>
                      <span className="font-mono text-xs text-slate-500">{e.item.patrimonio ?? '-'}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {e.colaborador.nome}
                      </span>
                      <span className="text-xs text-slate-500">
                        {e.colaborador.departamento || e.colaborador.email}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>{formatarData(e.dataInicio)}</TableCell>
                  {!entregas && (
                    <TableCell>
                      <div className="flex flex-col">
                        <span>{formatarData(e.dataPrevista)}</span>
                        {e.renovacoes > 0 && (
                          <span className="text-xs text-slate-500">
                            {e.renovacoes} renovaç{e.renovacoes === 1 ? 'ão' : 'ões'}
                          </span>
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell>
                    <Badge
                      title={conviteNaoEntregue(e) ? (e.d4signAvisoEmail ?? undefined) : undefined}
                      className={classeSituacaoEmprestimo(e)}
                    >
                      {rotuloSituacaoEmprestimo(e)}
                    </Badge>
                    {e.status === 'AGUARDANDO_ASSINATURA' && !!e.d4signSignatarios && (
                      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                        {e.d4signAssinados ?? 0} de {e.d4signSignatarios} assinaram
                      </p>
                    )}
                    {detalheDaFila(e) && (
                      <p className="mt-1 max-w-[16rem] text-xs text-slate-500 dark:text-slate-400">
                        {detalheDaFila(e)}
                      </p>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Ver histórico"
                        onClick={() => setHistoricoDe(e)}
                        className="h-8 w-8 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
                      >
                        <History className="h-4 w-4" />
                      </Button>

                      {e.status === 'DEVOLVIDO' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Baixar comprovante de devolução"
                          onClick={() => void baixarComprovante(e)}
                          className="h-8 w-8 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
                        >
                          <FileText className="h-4 w-4" />
                        </Button>
                      )}

                      {termoPrecisaDeAtencao(e) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Tentar gerar o termo novamente"
                          onClick={() => void tentarTermoNovamente(e)}
                          className="h-8 w-8 text-red-500 hover:text-red-600 dark:text-red-400"
                        >
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                      )}

                      {e.status === 'AGUARDANDO_ASSINATURA' && e.d4signEtapa === 'ENVIADO' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Verificar assinatura no D4Sign agora"
                          onClick={() => void verificarAssinatura(e)}
                          disabled={verificando === e.id}
                          className="h-8 w-8 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400"
                        >
                          {verificando === e.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <FileCheck className="h-4 w-4" />
                          )}
                        </Button>
                      )}

                      {e.status === 'AGUARDANDO_ASSINATURA' && e.d4signEtapa === 'ENVIADO' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            conviteNaoEntregue(e)
                              ? `E-mail de assinatura não entregue - reenviar convite\n${e.d4signAvisoEmail}`
                              : 'Reenviar convite de assinatura'
                          }
                          onClick={() => void reenviarConvite(e)}
                          disabled={reenviando === e.id}
                          className={
                            conviteNaoEntregue(e)
                              ? 'h-8 w-8 text-red-500 hover:text-red-600 dark:text-red-400'
                              : 'h-8 w-8 text-slate-500 hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400'
                          }
                        >
                          {reenviando === e.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <MailWarning className="h-4 w-4" />
                          )}
                        </Button>
                      )}

                      {e.status === 'AGUARDANDO_ASSINATURA' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="Ativar sem esperar a assinatura"
                          onClick={() => abrirAcao('ativacao', e)}
                          className="h-8 w-8 text-slate-500 hover:text-amber-600 dark:text-slate-400 dark:hover:text-amber-400"
                        >
                          <Zap className="h-4 w-4" />
                        </Button>
                      )}

                      {/* Devolver e renovar so depois de ativo; aguardando assinatura, so cancelar ou ativar. */}
                      {e.status === 'ATIVO' && (
                        <>
                          {!entregas && (
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Renovar prazo"
                              onClick={() => abrirAcao('renovacao', e)}
                              className="h-8 w-8 text-slate-500 hover:text-blue-600 dark:text-slate-400 dark:hover:text-blue-400"
                            >
                              <CalendarClock className="h-4 w-4" />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Registrar devolução"
                            onClick={() => abrirAcao('devolucao', e)}
                            className="h-8 w-8 text-slate-500 hover:text-emerald-600 dark:text-slate-400 dark:hover:text-emerald-400"
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}

                      {emAberto && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title={entregas ? 'Cancelar entrega' : 'Cancelar empréstimo'}
                          onClick={() => abrirAcao('cancelamento', e)}
                          className="h-8 w-8 text-slate-500 hover:text-red-600 dark:text-slate-400 dark:hover:text-red-400"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })
          )}
        </TableBody>
      </Table>

      <NewLoanModal
        aberto={modalNovoAberto}
        aoFechar={() => setModalNovoAberto(false)}
        aoSalvar={() => void carregar()}
        modalidade={modalidade}
      />

      <EmprestimoAcaoModal
        acao={acao}
        emprestimo={selecionado}
        aoFechar={() => setAcao(null)}
        aoConcluir={() => void carregar()}
      />

      <HistoricoModal emprestimo={historicoDe} aoFechar={() => setHistoricoDe(null)} />

      <ItemFichaModal
        itemId={fichaDe}
        aoFechar={() => setFichaDe(null)}
        aoMudar={() => void carregar()}
        aoEditar={(item) => {
          setFichaDe(null);
          setItemEditado(item);
        }}
        empresas={empresas}
      />

      <ItemModal
        aberto={itemEditado !== null}
        aoFechar={() => setItemEditado(null)}
        aoSalvar={() => void carregar()}
        categorias={categorias}
        empresas={empresas}
        itemParaEditar={itemEditado}
      />
    </div>
  );
}
