import React, { useRef, useState } from 'react';
import { CircleCheck, Download, FileSpreadsheet, TriangleAlert, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { Modal } from '@/components/ui/Modal';
import { api, baixarArquivo } from '@/lib/api';
import { cn } from '@/lib/utils';

type Tipo = 'equipamentos' | 'quantidades';

interface Resultado {
  criados: number;
  erros: Array<{ linha: number; erro: string }>;
}

/**
 * Contagem inicial do estoque: a TI conta a prateleira, preenche a planilha
 * modelo e importa aqui. Cada linha vira um equipamento (ou um saldo) com a
 * movimentacao "contagem inicial".
 */
export function ImportacaoModal({
  aberto,
  aoFechar,
  aoImportar,
}: {
  aberto: boolean;
  aoFechar: () => void;
  aoImportar: () => void;
}) {
  const [tipo, setTipo] = useState<Tipo>('equipamentos');
  const [arquivo, setArquivo] = useState<{ nome: string; conteudo: string } | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [enviando, setEnviando] = useState(false);
  const entradaDeArquivo = useRef<HTMLInputElement>(null);

  const baixarModelo = async () => {
    try {
      await baixarArquivo(`/estoque/modelo-importacao?tipo=${tipo}`, `contagem-${tipo}.csv`);
    } catch {
      // Mensagem ja exibida pelo interceptor.
    }
  };

  const escolherArquivo = (evento: React.ChangeEvent<HTMLInputElement>) => {
    const escolhido = evento.target.files?.[0];
    if (!escolhido) return;

    /**
     * Tenta UTF-8 primeiro (CSV UTF-8 do Excel; o BOM e tratado na API). O
     * "CSV (separado por virgulas)" do Excel em portugues sai em Windows-1252:
     * lido como UTF-8, cada acento vira o caractere de substituicao (U+FFFD).
     * Nesse caso o arquivo e lido de novo como Windows-1252.
     */
    const ler = (codificacao: 'utf-8' | 'windows-1252') => {
      const leitor = new FileReader();
      leitor.onload = () => {
        const conteudo = String(leitor.result ?? '');
        if (codificacao === 'utf-8' && conteudo.includes('�')) {
          ler('windows-1252');
          return;
        }
        setArquivo({ nome: escolhido.name, conteudo });
      };
      leitor.onerror = () => toast.error('Não consegui ler o arquivo.');
      leitor.readAsText(escolhido, codificacao);
    };
    ler('utf-8');
    setResultado(null);
    // Limpa o campo: sem isto, escolher o mesmo arquivo de novo (ja corrigido)
    // nao dispara o onChange.
    evento.target.value = '';
  };

  const importar = async () => {
    if (!arquivo) return;
    setEnviando(true);
    try {
      const { data } = await api.post<Resultado>('/estoque/importacao', {
        tipo,
        conteudo: arquivo.conteudo,
      });
      setResultado(data);

      if (data.criados > 0) {
        toast.success(`${data.criados} registro(s) importado(s).`, {
          description: data.erros.length ? `${data.erros.length} linha(s) ficaram de fora.` : undefined,
        });
        aoImportar();
      } else {
        toast.error('Nenhuma linha foi importada.', { description: 'Veja os erros na tela.' });
      }
    } catch {
      // Mensagem ja exibida pelo interceptor.
    } finally {
      setEnviando(false);
    }
  };

  const fechar = () => {
    setArquivo(null);
    setResultado(null);
    aoFechar();
  };

  return (
    <Modal
      aberto={aberto}
      aoFechar={fechar}
      icone={<FileSpreadsheet className="h-4 w-4" />}
      titulo="Contagem inicial do estoque"
      descricao="Importe o que já está na prateleira, de uma vez."
      largura="xl"
      rodape={
        <>
          <Button variant="ghost" onClick={fechar}>
            Fechar
          </Button>
          <Button onClick={() => void importar()} disabled={!arquivo || enviando}>
            {enviando ? 'Importando...' : 'Importar'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <ol className="space-y-1.5 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-950/50 dark:text-slate-300">
          <li>1. Baixe a planilha modelo e apague as duas linhas de exemplo.</li>
          <li>2. Preencha uma linha por equipamento, contando a prateleira.</li>
          <li>3. Salve como CSV (o Excel pergunta; confirme) e envie aqui.</li>
        </ol>

        <Campo rotulo="O que você vai importar">
          <div role="radiogroup" className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  valor: 'equipamentos' as Tipo,
                  titulo: 'Equipamentos',
                  descricao: 'Notebooks, monitores, celulares: um por linha, com número de série.',
                },
                {
                  valor: 'quantidades' as Tipo,
                  titulo: 'Periféricos',
                  descricao: 'Headsets, adaptadores, kits: uma linha por tipo, com o saldo.',
                },
              ]
            ).map((o) => (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={tipo === o.valor}
                onClick={() => {
                  setTipo(o.valor);
                  setArquivo(null);
                  setResultado(null);
                }}
                className={cn(
                  'rounded-xl border p-3 text-left transition-all',
                  tipo === o.valor
                    ? 'border-indigo-500 bg-indigo-50 ring-3 ring-indigo-500/20 dark:border-indigo-500/70 dark:bg-indigo-500/10'
                    : 'border-slate-200 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40',
                )}
              >
                <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">{o.titulo}</span>
                <span className="block text-xs leading-snug text-slate-500 dark:text-slate-400">
                  {o.descricao}
                </span>
              </button>
            ))}
          </div>
        </Campo>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => void baixarModelo()}>
            <Download className="mr-2 h-4 w-4" /> Baixar planilha modelo
          </Button>
          <Button variant="outline" onClick={() => entradaDeArquivo.current?.click()}>
            <Upload className="mr-2 h-4 w-4" /> {arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
          </Button>
          <input
            ref={entradaDeArquivo}
            type="file"
            accept=".csv,text/csv"
            onChange={escolherArquivo}
            className="hidden"
          />
        </div>

        {arquivo && (
          <p className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 ring-1 ring-inset ring-emerald-600/15 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-400/20">
            <CircleCheck className="h-4 w-4 shrink-0" />
            {arquivo.nome} · {arquivo.conteudo.split(/\r?\n/).filter((l) => l.trim()).length - 1} linha(s)
          </p>
        )}

        {resultado && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {resultado.criados} importado(s), {resultado.erros.length} com problema.
            </p>
            {resultado.erros.length > 0 && (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-xl bg-red-50 p-3.5 text-sm text-red-800 ring-1 ring-inset ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20">
                {resultado.erros.map((e) => (
                  <li key={e.linha} className="flex gap-2">
                    <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      <b>Linha {e.linha}:</b> {e.erro}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {resultado.erros.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                As linhas que deram certo já entraram. Corrija só as linhas com problema numa
                planilha nova e importe de novo.
              </p>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
