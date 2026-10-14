import React, { useEffect, useState } from 'react';
import { addDays, format, max, parseISO } from 'date-fns';
import { CalendarClock, CircleCheck, PackageCheck, TriangleAlert, Wrench, XCircle, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { DateInput } from '@/components/ui/DateInput';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { api, ehConflito } from '@/lib/api';
import { formatarData, hojeParaInputDate, nomeDoItem, paraInputDate } from '@/lib/dominio';
import { cn } from '@/lib/utils';
import type { Emprestimo } from '@/types';

export type AcaoEmprestimo = 'devolucao' | 'renovacao' | 'cancelamento' | 'ativacao';

interface Props {
  acao: AcaoEmprestimo | null;
  emprestimo: Emprestimo | null;
  aoFechar: () => void;
  aoConcluir: () => void;
}

/** Titulos; "cessao" vira "empréstimo" ou "entrega" conforme a modalidade. */
const titulo = (acao: AcaoEmprestimo, cessao: string) =>
  ({
    devolucao: 'Registrar devolução',
    renovacao: 'Renovar prazo',
    cancelamento: `Cancelar ${cessao}`,
    ativacao: `Ativar ${cessao}`,
  })[acao];

const ICONES: Record<AcaoEmprestimo, React.ReactNode> = {
  devolucao: <PackageCheck className="h-4 w-4" />,
  renovacao: <CalendarClock className="h-4 w-4" />,
  cancelamento: <XCircle className="h-4 w-4" />,
  ativacao: <Zap className="h-4 w-4" />,
};

type Condicao = 'BOM' | 'AVARIADO';

const CONDICOES: Array<{
  valor: Condicao;
  titulo: string;
  descricao: string;
  icone: React.ReactNode;
  selecionado: string;
}> = [
  {
    valor: 'BOM',
    titulo: 'Em bom estado',
    descricao: 'Volta para o estoque como disponível.',
    icone: <CircleCheck className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />,
    selecionado:
      'border-emerald-500 bg-emerald-50 ring-emerald-500/20 dark:border-emerald-500/70 dark:bg-emerald-500/10',
  },
  {
    valor: 'AVARIADO',
    titulo: 'Com avaria',
    descricao: 'Vai para manutenção antes de voltar a uso.',
    icone: <Wrench className="h-5 w-5 text-amber-600 dark:text-amber-400" />,
    selecionado:
      'border-amber-500 bg-amber-50 ring-amber-500/20 dark:border-amber-500/70 dark:bg-amber-500/10',
  },
];

/** "yyyy-MM-dd" + n dias, a partir do maior entre o prazo atual e hoje. */
function prazoMais(prazoAtual: string, dias: number): string {
  const base = max([parseISO(prazoAtual), new Date()]);
  return format(addDays(base, dias), 'yyyy-MM-dd');
}

/** Acoes sobre um emprestimo: devolucao, renovacao, cancelamento e ativacao. */
export function EmprestimoAcaoModal({ acao, emprestimo, aoFechar, aoConcluir }: Props) {
  const [condicao, setCondicao] = useState<Condicao>('BOM');
  const [observacoes, setObservacoes] = useState('');
  const [novaData, setNovaData] = useState('');
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!acao || !emprestimo) return;
    setCondicao('BOM');
    setObservacoes('');
    setMotivo('');
    setNovaData(paraInputDate(emprestimo.dataPrevista));
  }, [acao, emprestimo]);

  if (!acao || !emprestimo) return null;

  const entrega = emprestimo.modalidade === 'DEFINITIVA';
  const cessao = entrega ? 'entrega' : 'empréstimo';

  const confirmar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setEnviando(true);

    try {
      if (acao === 'devolucao') {
        await api.post(`/emprestimos/${emprestimo.id}/devolucao`, {
          condicaoNotebook: condicao,
          observacoes: observacoes.trim() || null,
        });
        toast.success(
          condicao === 'AVARIADO'
            ? 'Devolução registrada. O equipamento foi para manutenção.'
            : 'Devolução registrada. O equipamento está disponível de novo.',
          { description: 'O colaborador recebe o comprovante por e-mail.' },
        );
      } else if (acao === 'renovacao') {
        await api.post(`/emprestimos/${emprestimo.id}/renovacao`, { novaDataPrevista: novaData });
        toast.success('Prazo renovado.', { description: `Novo prazo: ${formatarData(parseISO(novaData))}.` });
      } else if (acao === 'cancelamento') {
        // O cancelamento espera o D4Sign (ate 30 s); folga para nao estourar o
        // limite padrao do navegador com o cancelamento ja feito.
        const { data } = await api.post<{ aviso?: string }>(
          `/emprestimos/${emprestimo.id}/cancelamento`,
          { motivo: motivo.trim() },
          { timeout: 90_000 },
        );
        toast.success(entrega ? 'Entrega cancelada.' : 'Empréstimo cancelado.');
        // O documento no D4Sign nao foi cancelado: o operador precisa saber.
        if (data?.aviso) toast.warning(data.aviso, { duration: 15000 });
      } else {
        await api.post(`/emprestimos/${emprestimo.id}/ativacao`, {});
        toast.success(entrega ? 'Entrega ativada.' : 'Empréstimo ativado.');
      }

      aoConcluir();
      aoFechar();
    } catch (erro) {
      // Mensagem ja exibida pelo interceptor. Em conflito (alguem mexeu neste
      // emprestimo antes), recarrega a lista para mostrar a situacao atual.
      if (ehConflito(erro)) {
        aoConcluir();
        aoFechar();
      }
    } finally {
      setEnviando(false);
    }
  };

  const prazoAtual = paraInputDate(emprestimo.dataPrevista);

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      icone={ICONES[acao]}
      titulo={titulo(acao, cessao)}
      descricao={`${nomeDoItem(emprestimo.item)} · ${emprestimo.colaborador.nome}`}
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Voltar
          </Button>
          <Button
            type="submit"
            form="form-acao-emprestimo"
            disabled={enviando}
            variant={acao === 'cancelamento' ? 'destructive' : 'default'}
          >
            {enviando ? 'Enviando...' : acao === 'cancelamento' ? `Cancelar ${cessao}` : 'Confirmar'}
          </Button>
        </>
      }
    >
      <div
        className={cn(
          'mb-5 grid gap-px overflow-hidden rounded-xl border border-slate-200/80 bg-slate-200/80 text-sm dark:border-slate-800 dark:bg-slate-800',
          entrega ? 'grid-cols-1' : 'grid-cols-2',
        )}
      >
        <div className="bg-slate-50 px-3.5 py-2.5 dark:bg-slate-950/60">
          <p className="text-xs text-slate-500 dark:text-slate-400">{entrega ? 'Entregue em' : 'Retirada'}</p>
          <p className="font-medium text-slate-900 dark:text-slate-100">
            {formatarData(emprestimo.dataInicio)}
          </p>
        </div>
        {/* Entrega e definitiva: nao tem prazo. */}
        {!entrega && (
          <div className="bg-slate-50 px-3.5 py-2.5 dark:bg-slate-950/60">
            <p className="text-xs text-slate-500 dark:text-slate-400">Prazo</p>
            <p
              className={cn(
                'font-medium',
                emprestimo.atrasado ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100',
              )}
            >
              {formatarData(emprestimo.dataPrevista)}
              {emprestimo.atrasado && (
                <span className="block text-xs font-normal">
                  {emprestimo.diasAtraso} {emprestimo.diasAtraso === 1 ? 'dia' : 'dias'} de atraso
                </span>
              )}
            </p>
          </div>
        )}
      </div>

      <form id="form-acao-emprestimo" onSubmit={confirmar} className="space-y-5">
        {acao === 'devolucao' && (
          <>
            <Campo rotulo="Condição do equipamento">
              <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
                {CONDICOES.map((c) => {
                  const selecionado = condicao === c.valor;
                  return (
                    <button
                      key={c.valor}
                      type="button"
                      role="radio"
                      aria-checked={selecionado}
                      onClick={() => setCondicao(c.valor)}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border p-3 text-left transition-all',
                        selecionado
                          ? cn('ring-3', c.selecionado)
                          : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:hover:border-slate-700 dark:hover:bg-slate-800/40',
                      )}
                    >
                      <span className="mt-0.5">{c.icone}</span>
                      <span>
                        <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
                          {c.titulo}
                        </span>
                        <span className="block text-xs leading-snug text-slate-500 dark:text-slate-400">
                          {c.descricao}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </Campo>

            <Campo
              rotulo="Observações da devolução"
              dica="Opcional. Aparece no comprovante de devolução que o colaborador recebe por e-mail."
            >
              <Input
                value={observacoes}
                onChange={(e) => setObservacoes(e.target.value)}
                maxLength={500}
                placeholder={condicao === 'AVARIADO' ? 'Descreva a avaria' : 'Alguma observação?'}
              />
            </Campo>
          </>
        )}

        {acao === 'renovacao' && (
          <Campo
            rotulo="Novo prazo de devolução"
            dica="Precisa ser depois do prazo atual. As cobranças de atraso param."
          >
            <DateInput
              value={novaData}
              min={hojeParaInputDate(1)}
              onChange={setNovaData}
              required
              atalhos={[
                { rotulo: '+7 dias', valor: prazoMais(prazoAtual, 7) },
                { rotulo: '+15 dias', valor: prazoMais(prazoAtual, 15) },
                { rotulo: '+30 dias', valor: prazoMais(prazoAtual, 30) },
              ]}
            />
          </Campo>
        )}

        {acao === 'cancelamento' && (
          <Campo
            rotulo="Motivo do cancelamento"
            obrigatorio
            dica="O equipamento volta a ficar disponível e o termo no D4Sign é cancelado."
          >
            <Input
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              required
              minLength={3}
              maxLength={300}
              autoFocus
            />
          </Campo>
        )}

        {acao === 'ativacao' && (
          <div className="flex gap-3 rounded-xl bg-amber-50 p-3.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/20">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>
              {entrega ? 'Esta entrega está esperando' : 'Este empréstimo está esperando'} a assinatura do termo. Ativar agora faz o equipamento
              constar como em uso sem a assinatura.{' '}
              {emprestimo.d4signEtapa === 'ENVIADO'
                ? 'O documento continua no D4Sign, mas o Notrole deixa de acompanhar a assinatura.'
                : 'O termo ainda não foi enviado e não será mais enviado.'}
            </p>
          </div>
        )}
      </form>
    </Modal>
  );
}
