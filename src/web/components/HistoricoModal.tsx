import { useEffect, useState } from 'react';
import { History, Loader2 } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { formatarDataHora, nomeDoItem, rotuloAcao } from '@/lib/dominio';
import { cn } from '@/lib/utils';
import type { Emprestimo, ItemHistorico, TipoAcao } from '@/types';

/** Cor do ponto de cada tipo de acao na linha do tempo. */
const COR_ACAO: Partial<Record<TipoAcao, string>> = {
  CRIADO: 'bg-indigo-500',
  TERMO_GERADO: 'bg-violet-500',
  TERMO_ASSINADO: 'bg-emerald-500',
  ATIVADO: 'bg-blue-500',
  RENOVADO: 'bg-sky-500',
  LEMBRETE_ENVIADO: 'bg-amber-400',
  COBRADO: 'bg-red-500',
  DEVOLVIDO: 'bg-emerald-500',
  CANCELADO: 'bg-slate-400',
};

/**
 * Linha do tempo do emprestimo: criacao, envio do termo, assinatura,
 * renovacao, cobranca automatica, devolucao.
 */
export function HistoricoModal({
  emprestimo,
  aoFechar,
}: {
  emprestimo: Emprestimo | null;
  aoFechar: () => void;
}) {
  const [itens, setItens] = useState<ItemHistorico[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!emprestimo) return;

    setCarregando(true);
    api
      .get<ItemHistorico[]>(`/emprestimos/${emprestimo.id}/historico`)
      .then(({ data }) => setItens(data))
      .catch(() => setItens([]))
      .finally(() => setCarregando(false));
  }, [emprestimo]);

  if (!emprestimo) return null;

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      icone={<History className="h-4 w-4" />}
      titulo="Histórico"
      descricao={`${nomeDoItem(emprestimo.item)} · ${emprestimo.colaborador.nome}`}
      largura="lg"
    >
      {carregando ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
        </div>
      ) : itens.length === 0 ? (
        <p className="py-10 text-center text-sm text-slate-500">Nenhum registro ainda.</p>
      ) : (
        <ol className="relative ml-1.5 space-y-5 border-l border-slate-200 pl-6 dark:border-slate-800">
          {itens.map((item) => (
            <li key={item.id} className="relative">
              <span
                className={cn(
                  'absolute -left-[1.84rem] top-1 h-3 w-3 rounded-full ring-4 ring-white dark:ring-slate-900',
                  COR_ACAO[item.acao] ?? 'bg-slate-400',
                )}
              />
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
                {rotuloAcao(item.acao, emprestimo.modalidade)}
              </p>
              {item.detalhes && (
                <p className="mt-0.5 text-sm leading-relaxed text-slate-600 dark:text-slate-400">
                  {item.detalhes}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
                {formatarDataHora(item.dataAcao)}
                {item.usuario ? ` · ${item.usuario}` : ''}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Modal>
  );
}
