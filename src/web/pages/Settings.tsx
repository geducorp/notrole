import { useEffect, useRef, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  FileSignature,
  Loader2,
  Lock,
  Mail,
  MailCheck,
  Minus,
  Play,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Tags,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { PageHeader } from '@/components/ui/PageHeader';
import { Secao } from '@/components/ui/Secao';
import { EmpresasPainel } from '@/components/EmpresasPainel';
import { CategoriasPainel } from '@/components/EstoquePainel';
import { api, erroJaAvisado, mensagemDeErro } from '@/lib/api';
import { DESCRICAO_TEMPLATE, formatarDataHora, ROTULO_TEMPLATE, TOM } from '@/lib/dominio';
import { usePerfil } from '@/lib/perfil';
import { classeCampo } from '@/components/ui/Input';
import { cn } from '@/lib/utils';
import type {
  EmailEnviado,
  FilaTermos,
  Perfil,
  ResultadoFilaTermos,
  ResultadoRotina,
  RotinaAgendada,
  StatusSistema,
  TemplateEmail,
  TipoTemplate,
} from '@/types';

type Cartao = 'acesso' | 'd4sign' | 'rotinas' | 'email';
type Tom = 'verde' | 'ambar' | 'vermelho' | 'cinza';

const CHAVE_CARTAO = 'notrole-config-cartao';

const ROTINAS: Record<RotinaAgendada['id'], { titulo: string; descricao: string }> = {
  lembretes: { titulo: 'Lembrete de vencimento', descricao: 'Avisa o colaborador um dia antes do prazo.' },
  cobranca: { titulo: 'Cobrança de atraso', descricao: 'Cobra quem passou do prazo, uma vez por dia.' },
};

/**
 * Traduz o agendamento das rotinas ("0 8-18 * * 1-5") para gente:
 * "De hora em hora, das 8h às 18h, de segunda a sexta".
 */
function descreverAgenda(cron: string): string {
  const [minuto, hora, , , dias] = cron.trim().split(/\s+/);
  if (!minuto || !hora || !dias || !/^\d+$/.test(minuto)) return cron;

  const quandoDias =
    dias === '1-5' ? 'de segunda a sexta' : dias === '*' ? 'todos os dias' : `nos dias ${dias}`;
  const faixa = /^(\d+)-(\d+)$/.exec(hora);

  if (faixa) {
    const noMinuto = Number(minuto) === 0 ? '' : `, aos ${minuto} minutos`;
    return `De hora em hora${noMinuto}, das ${faixa[1]}h às ${faixa[2]}h, ${quandoDias}`;
  }
  if (/^\d+$/.test(hora)) return `Às ${hora}h${minuto.padStart(2, '0')}, ${quandoDias}`;
  return cron;
}

/** "em 45 s", "em 23 min", "em 2 h 10 min", "em 3 dias". */
function emQuanto(ms: number): string {
  if (ms <= 0) return 'agora';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `em ${s} s`;
  const min = Math.ceil(s / 60);
  if (min < 60) return `em ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `em ${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
  const d = Math.round(h / 24);
  return `em ${d} dia${d > 1 ? 's' : ''}`;
}

/** "há 5 min", "há 2 h", "ontem", "há 3 dias". */
function haQuanto(iso: string, agora: number): string {
  const min = Math.floor((agora - Date.parse(iso)) / 60_000);
  if (min < 1) return 'agora há pouco';
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'ontem' : `há ${d} dias`;
}

/** "14:30" se for hoje, "seg., 08:00" se for outro dia. */
function horario(iso: string, agora: number): string {
  const data = new Date(iso);
  const hoje = new Date(agora).toDateString() === data.toDateString();
  return data.toLocaleString('pt-BR', {
    ...(hoje ? {} : { weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

function progresso(rotina: RotinaAgendada, agora: number): number {
  if (!rotina.anterior || !rotina.proxima) return 0;
  const inicio = Date.parse(rotina.anterior);
  const fim = Date.parse(rotina.proxima);
  return fim > inicio ? Math.min(1, Math.max(0, (agora - inicio) / (fim - inicio))) : 0;
}

function lerCartao(): Cartao | null {
  try {
    const salvo = localStorage.getItem(CHAVE_CARTAO);
    return salvo === 'acesso' || salvo === 'd4sign' || salvo === 'rotinas' || salvo === 'email' ? salvo : null;
  } catch {
    return null;
  }
}

export function Settings() {
  const perfil = usePerfil();
  const admin = perfil?.admin ?? false;

  const [templates, setTemplates] = useState<TemplateEmail[]>([]);
  const [variaveis, setVariaveis] = useState<Record<string, string[]>>({});
  const [rascunhos, setRascunhos] = useState<Record<string, { assunto: string; corpo: string }>>({});
  const [templateAtivo, setTemplateAtivo] = useState<TipoTemplate | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusSistema | null>(null);
  const [emails, setEmails] = useState<EmailEnviado[]>([]);
  const [fila, setFila] = useState<FilaTermos | null>(null);
  const [executando, setExecutando] = useState<string | null>(null);
  const [cartao, setCartao] = useState<Cartao | null>(lerCartao);
  const [agora, setAgora] = useState(() => Date.now());
  const ultimaRecarga = useRef(0);
  const painelDetalhes = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void carregarTudo();
  }, []);

  // Relogio dos contadores das rotinas.
  useEffect(() => {
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(relogio);
  }, []);

  // Passou o horario de uma rotina: busca o novo horario e o resultado dela.
  useEffect(() => {
    const passou = status?.jobs.rotinas?.some((r) => r.proxima && Date.parse(r.proxima) + 15_000 < agora);
    if (passou && agora - ultimaRecarga.current > 60_000) {
      ultimaRecarga.current = agora;
      void recarregarStatus();
      void recarregarEmails();
    }
  }, [agora, status]);

  const abrirCartao = (qual: Cartao) => {
    const novo = cartao === qual ? null : qual;
    setCartao(novo);
    try {
      if (novo) localStorage.setItem(CHAVE_CARTAO, novo);
      else localStorage.removeItem(CHAVE_CARTAO);
    } catch {
      // So conveniencia.
    }
    if (novo) {
      requestAnimationFrame(() => painelDetalhes.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    }
  };

  async function carregarTudo() {
    setCarregando(true);
    try {
      // allSettled: se uma das quatro falhar, as outras aparecem mesmo assim.
      // As requisicoes sao silenciosas e as falhas viram um toast so.
      const [respTemplates, respStatus, respEmails, respFila] = await Promise.allSettled([
        api.get<{ templates: TemplateEmail[]; variaveisDisponiveis: Record<string, string[]> }>(
          '/configuracoes/templates',
          { silencioso: true },
        ),
        api.get<StatusSistema>('/configuracoes/status', { silencioso: true }),
        api.get<EmailEnviado[]>('/configuracoes/emails', { silencioso: true }),
        api.get<FilaTermos>('/configuracoes/termos/fila', { silencioso: true }),
      ]);

      if (respFila.status === 'fulfilled') setFila(respFila.value.data);
      if (respTemplates.status === 'fulfilled') {
        const { templates, variaveisDisponiveis } = respTemplates.value.data;
        setTemplates(templates);
        setTemplateAtivo((atual) => atual ?? templates[0]?.chave ?? null);
        setVariaveis(variaveisDisponiveis);
        setRascunhos(Object.fromEntries(templates.map((t) => [t.chave, { assunto: t.assunto, corpo: t.corpo }])));
      }
      if (respStatus.status === 'fulfilled') setStatus(respStatus.value.data);
      if (respEmails.status === 'fulfilled') setEmails(respEmails.value.data);

      const falhas = (
        [
          ['modelos de e-mail', respTemplates],
          ['status do sistema', respStatus],
          ['e-mails enviados', respEmails],
          ['fila de termos', respFila],
        ] as const
      ).filter(([, r]) => r.status === 'rejected');

      // Sessao expirada e acesso negado ja tem aviso proprio.
      const relevantes = falhas.filter(([, r]) => r.status === 'rejected' && !erroJaAvisado(r.reason));
      if (relevantes.length) {
        const primeira = relevantes[0]![1];
        toast.error(`Não foi possível carregar: ${relevantes.map(([nome]) => nome).join(', ')}.`, {
          description: primeira.status === 'rejected' ? mensagemDeErro(primeira.reason) : undefined,
        });
      }
    } finally {
      setCarregando(false);
    }
  }

  const alterarRascunho = (chave: TipoTemplate, campo: 'assunto' | 'corpo', valor: string) =>
    setRascunhos((atual) => ({ ...atual, [chave]: { ...atual[chave]!, [campo]: valor } }));

  const salvar = async (template: TemplateEmail) => {
    const rascunho = rascunhos[template.chave];
    if (!rascunho) return;

    setSalvando(template.chave);
    try {
      const { data } = await api.put<TemplateEmail>(`/configuracoes/templates/${template.chave}`, {
        assunto: rascunho.assunto,
        corpo: rascunho.corpo,
        ativo: template.ativo,
      });
      setTemplates((atual) => atual.map((t) => (t.chave === data.chave ? data : t)));
      toast.success('Modelo salvo.', { description: 'Os próximos e-mails já usam este texto.' });
    } catch {
      // Mensagem ja exibida.
    } finally {
      setSalvando(null);
    }
  };

  const restaurar = async (chave: TipoTemplate) => {
    if (!window.confirm('Voltar este e-mail para o texto padrão do sistema?')) return;

    try {
      const { data } = await api.post<TemplateEmail>(`/configuracoes/templates/${chave}/restaurar`, {});
      setTemplates((atual) => atual.map((t) => (t.chave === chave ? data : t)));
      setRascunhos((atual) => ({ ...atual, [chave]: { assunto: data.assunto, corpo: data.corpo } }));
      toast.success('Texto padrão restaurado.');
    } catch {
      // Mensagem ja exibida.
    }
  };

  const enviarTeste = async (chave: TipoTemplate) => {
    setExecutando(`teste-${chave}`);
    try {
      const { data } = await api.post<{ enviado: boolean; destinatario: string; erro?: string }>(
        `/configuracoes/templates/${chave}/teste`,
        {},
      );
      if (data.enviado) toast.success('E-mail de teste enviado.', { description: data.destinatario });
      else toast.error('Não foi possível enviar o teste.', { description: data.erro ?? 'Erro desconhecido.' });
      void recarregarEmails();
    } catch {
      // Mensagem ja exibida.
    } finally {
      setExecutando(null);
    }
  };

  const recarregarStatus = async () => {
    try {
      const { data } = await api.get<StatusSistema>('/configuracoes/status');
      setStatus(data);
    } catch {
      // Silencioso.
    }
  };

  const recarregarEmails = async () => {
    try {
      const { data } = await api.get<EmailEnviado[]>('/configuracoes/emails');
      setEmails(data);
    } catch {
      // Silencioso: e so a lista de auditoria.
    }
  };

  const recarregarFila = async () => {
    try {
      const { data } = await api.get<FilaTermos>('/configuracoes/termos/fila');
      setFila(data);
    } catch {
      // Silencioso.
    }
  };

  const processarFila = async () => {
    setExecutando('fila');
    try {
      const { data } = await api.post<ResultadoFilaTermos>('/configuracoes/termos/fila', {});

      if (data.gerados > 0) toast.success(`${data.gerados} termo(s) enviado(s) para assinatura.`);
      if (data.adiados > 0) {
        toast.info(`${data.adiados} termo(s) continuam na fila.`, {
          description: `A cota do D4Sign libera em ${data.proximaJanelaEmMinutos ?? '?'} min e o sistema tenta sozinho.`,
        });
      }
      if (data.gerados === 0 && data.adiados === 0 && data.falharam === 0 && data.detalhes.length === 0) {
        toast.info('Nenhum termo pendente.');
      }
      for (const detalhe of data.detalhes) toast.warning(detalhe);

      void recarregarFila();
    } catch {
      // Mensagem ja exibida.
    } finally {
      setExecutando(null);
    }
  };

  const alternarD4sign = async () => {
    if (!status) return;
    const pausar = !status.d4sign.pausado;
    const pergunta = pausar
      ? 'Pausar a integração com o D4Sign?\n\nNenhum termo novo é enviado e nada é consultado até religar. ' +
        'Os empréstimos e entregas com termo continuam sendo registrados e ficam na fila.'
      : 'Religar o D4Sign?\n\nOs termos que estiverem na fila começam a ser enviados agora.';
    if (!window.confirm(pergunta)) return;

    setExecutando('d4sign');
    try {
      await api.put('/configuracoes/d4sign', { pausado: pausar });
      toast.success(pausar ? 'D4Sign pausado.' : 'D4Sign religado.', {
        description: pausar ? 'Nenhuma chamada ao D4Sign até religar.' : 'A fila de termos volta a andar.',
      });
      await Promise.all([recarregarStatus(), recarregarFila()]);
    } catch {
      // Mensagem ja exibida.
    } finally {
      setExecutando(null);
    }
  };

  const testarSmtp = async () => {
    setExecutando('smtp');
    try {
      const { data } = await api.get<{ ok: boolean; erro?: string }>('/configuracoes/smtp/teste');
      if (data.ok) toast.success('Servidor de e-mail respondendo.');
      else toast.error('Falha no servidor de e-mail.', { description: data.erro });
    } catch {
      // Mensagem ja exibida.
    } finally {
      setExecutando(null);
    }
  };

  const executarRotina = async (rotina: 'cobranca' | 'lembretes') => {
    const nome = rotina === 'cobranca' ? 'cobrança de atrasos' : 'lembretes de vencimento';
    if (!window.confirm(`Rodar a rotina de ${nome} agora? E-mails reais serão enviados.`)) return;

    setExecutando(rotina);
    try {
      // Cada e-mail pode levar ate 1 minuto no SMTP (lento): o limite padrao de 30 s nao basta.
      const { data } = await api.post<ResultadoRotina>(`/configuracoes/rotinas/${rotina}`, {}, { timeout: 180_000 });

      if (data.enviados > 0) toast.success(`${data.enviados} e-mail(s) enviado(s).`);
      else if (data.ignorados > 0) toast.info(`Nada a enviar: ${data.ignorados} já foram avisados hoje.`);
      else toast.info('Nenhum caso se enquadrou nesta rotina agora.');

      for (const detalhe of data.detalhes) toast.warning(detalhe);
      void recarregarEmails();
    } catch {
      // Mensagem ja exibida.
    } finally {
      setExecutando(null);
    }
  };

  const template = templates.find((t) => t.chave === templateAtivo) ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        titulo="Configurações"
        descricao={
          admin
            ? 'Estado das integrações, empresas, categorias e textos dos e-mails.'
            : 'Estado das integrações e dos e-mails. Clique num cartão para ver os detalhes.'
        }
      />

      {status ? (
        <>
          <CartoesDeStatus
            status={status}
            fila={fila}
            emails={emails}
            perfil={perfil}
            agora={agora}
            aberto={cartao}
            aoAbrir={abrirCartao}
          />

          {cartao && (
            <div
              ref={painelDetalhes}
              className="scroll-mt-4 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs dark:border-slate-800/80 dark:bg-slate-900/50"
            >
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                    {TITULO_CARTAO[cartao]}
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">{DESCRICAO_CARTAO[cartao]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => abrirCartao(cartao)}
                  title="Fechar"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {cartao === 'acesso' && <DetalhesAcesso status={status} perfil={perfil} />}

              {cartao === 'd4sign' && (
                <DetalhesD4Sign
                  status={status}
                  fila={fila}
                  admin={admin}
                  executando={executando}
                  aoAlternar={() => void alternarD4sign()}
                  aoProcessar={() => void processarFila()}
                />
              )}

              {cartao === 'rotinas' && (
                <DetalhesRotinas
                  status={status}
                  agora={agora}
                  admin={admin}
                  executando={executando}
                  aoExecutar={(r) => void executarRotina(r)}
                />
              )}

              {cartao === 'email' && (
                <DetalhesEmail
                  status={status}
                  emails={emails}
                  testando={executando === 'smtp'}
                  aoTestar={() => void testarSmtp()}
                />
              )}
            </div>
          )}
        </>
      ) : (
        carregando && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[9.5rem] animate-pulse rounded-2xl bg-slate-200/60 dark:bg-slate-800/40" />
            ))}
          </div>
        )
      )}

      {perfil && !admin && (
        <div className="flex items-start gap-3 rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Empresas, categorias do estoque, modelos de e-mail e o liga/desliga do D4Sign ficam com os
            administradores do Notrole (grupo de administradores no AD).
          </p>
        </div>
      )}

      {admin && (
        <div className="space-y-3">
          <Secao
            id="empresas"
            icone={<Building2 className="h-4 w-4" />}
            titulo="Empresas"
            descricao="Em nome de quem o termo de comodato é emitido."
          >
            <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">
              A empresa é reconhecida pelo campo "Empresa" do perfil do colaborador no AD. Quem está sem
              empresa no AD fica com a padrão.
            </p>
            <EmpresasPainel />
          </Secao>

          <Secao
            id="categorias"
            icone={<Tags className="h-4 w-4" />}
            titulo="Categorias do estoque"
            descricao="Os tipos de equipamento que a TI controla."
          >
            <CategoriasPainel />
          </Secao>

          <Secao
            id="modelos-email"
            icone={<Mail className="h-4 w-4" />}
            titulo="Modelos de e-mail"
            descricao="Textos que o colaborador recebe em cada etapa do empréstimo."
          >
            {carregando ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-wrap gap-1.5">
                  {templates.map((t) => {
                    const r = rascunhos[t.chave];
                    const alterado = r && (r.assunto !== t.assunto || r.corpo !== t.corpo);
                    return (
                      <button
                        key={t.chave}
                        type="button"
                        onClick={() => setTemplateAtivo(t.chave)}
                        className={cn(
                          'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                          templateAtivo === t.chave
                            ? 'bg-indigo-600 text-white shadow-sm'
                            : 'text-slate-600 ring-1 ring-inset ring-slate-200 hover:bg-slate-50 dark:text-slate-300 dark:ring-slate-800 dark:hover:bg-slate-800/60',
                        )}
                      >
                        {ROTULO_TEMPLATE[t.chave]}
                        {alterado && (
                          <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-amber-400 align-middle" />
                        )}
                      </button>
                    );
                  })}
                </div>

                {template && (
                  <EditorTemplate
                    template={template}
                    rascunho={rascunhos[template.chave]}
                    variaveis={variaveis[template.chave] ?? []}
                    salvando={salvando === template.chave}
                    testando={executando === `teste-${template.chave}`}
                    aoAlterar={(campo, valor) => alterarRascunho(template.chave, campo, valor)}
                    aoSalvar={() => void salvar(template)}
                    aoRestaurar={() => void restaurar(template.chave)}
                    aoTestar={() => void enviarTeste(template.chave)}
                  />
                )}
              </div>
            )}
          </Secao>
        </div>
      )}

      {status && (
        <p className="text-center text-xs text-slate-400 dark:text-slate-600">
          Ambiente: {status.ambiente === 'production' ? 'produção' : status.ambiente}
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cartoes de status
// ---------------------------------------------------------------------------

const TITULO_CARTAO: Record<Cartao, string> = {
  acesso: 'Acesso e permissões',
  d4sign: 'D4Sign',
  rotinas: 'Rotinas automáticas',
  email: 'Servidor de e-mail',
};

const DESCRICAO_CARTAO: Record<Cartao, string> = {
  acesso: 'Quem entra no Notrole e o que cada perfil pode fazer.',
  d4sign: 'Assinatura dos termos de comodato: liga/desliga, fila e cota de requisições.',
  rotinas: 'Lembretes de vencimento e cobranças de atraso por e-mail.',
  email: 'Por onde o Notrole envia os e-mails e o que foi enviado por último.',
};

/**
 * Os quatro cartoes seguem o mesmo desenho: o que e, se esta tudo bem (a
 * etiqueta colorida), a informacao que importa agora e um detalhe. Clicando,
 * abre o painel com os detalhes e as acoes.
 */
function CartoesDeStatus({
  status,
  fila,
  emails,
  perfil,
  agora,
  aberto,
  aoAbrir,
}: {
  status: StatusSistema;
  fila: FilaTermos | null;
  emails: EmailEnviado[];
  perfil: Perfil | null;
  agora: number;
  aberto: Cartao | null;
  aoAbrir: (cartao: Cartao) => void;
}) {
  // --- Acesso
  const acesso = {
    estado: status.entraId.grupoRestrito
      ? { tom: 'verde' as Tom, rotulo: 'Restrito' }
      : { tom: 'ambar' as Tom, rotulo: 'Aberto' },
    principal: perfil ? (perfil.admin ? 'Você é administrador' : 'Você é analista') : 'Carregando perfil...',
    detalhe: !perfil
      ? ''
      : perfil.admin
        ? 'Vê e mexe em tudo, em todas as empresas'
        : perfil.empresa
          ? `Vê e movimenta só o estoque da ${perfil.empresa}`
          : 'Empresa não identificada no AD: sem acesso aos dados',
  };

  // --- D4Sign
  const d = status.d4sign;
  const problemas = (fila?.precisamAtencao ?? 0) + (fila?.emailsComProblema ?? 0);
  const d4sign = !d.credenciais
    ? { estado: { tom: 'cinza' as Tom, rotulo: 'Sem credenciais' }, principal: 'Empréstimos sem termo', detalhe: 'Credenciais do D4Sign não configuradas' }
    : !d.ativo
      ? { estado: { tom: 'cinza' as Tom, rotulo: 'Desligado' }, principal: 'Empréstimos sem termo', detalhe: 'Desligado no servidor (D4SIGN_ATIVO)' }
      : d.pausado
        ? {
            estado: { tom: 'ambar' as Tom, rotulo: 'Pausado' },
            principal: fila?.pendentes ? `${fila.pendentes} termo(s) esperando` : 'Nenhum termo esperando',
            detalhe: d.alteradoEm ? `Pausado ${haQuanto(d.alteradoEm, agora)}` : 'Pausado pela tela',
          }
        : {
            estado: problemas > 0 ? { tom: 'vermelho' as Tom, rotulo: 'Atenção' } : { tom: 'verde' as Tom, rotulo: 'Ligado' },
            principal:
              problemas > 0
                ? `${problemas} precisa(m) de atenção`
                : fila?.pendentes
                  ? `${fila.pendentes} termo(s) na fila`
                  : `${fila?.documentosNoMes ?? 0} documento(s) no mês`,
            detalhe: fila ? `Cota: ${fila.cotaRestante} de ${fila.limitePorHora} requisições nesta hora` : '',
          };

  // --- Rotinas
  const proxima = status.jobs.habilitados
    ? [...(status.jobs.rotinas ?? [])]
        .filter((r) => r.proxima)
        .sort((a, b) => Date.parse(a.proxima!) - Date.parse(b.proxima!))[0]
    : undefined;
  const rotinas = {
    estado: status.jobs.habilitados ? { tom: 'verde' as Tom, rotulo: 'Ligadas' } : { tom: 'cinza' as Tom, rotulo: 'Desligadas' },
    principal: proxima?.proxima ? `Próximo envio ${emQuanto(Date.parse(proxima.proxima) - agora)}` : 'Sem envio automático',
    detalhe: proxima?.proxima
      ? `${ROTINAS[proxima.id].titulo} · ${horario(proxima.proxima, agora)}`
      : 'Desligadas no servidor (JOBS_HABILITADOS)',
  };

  // --- E-mail
  const recentes = emails.slice(0, 20);
  const falhas = recentes.filter((e) => !e.sucesso).length;
  const ultimo = emails[0];
  const email = {
    estado:
      falhas > 0
        ? { tom: 'vermelho' as Tom, rotulo: `${falhas} falha(s)` }
        : ultimo
          ? { tom: 'verde' as Tom, rotulo: 'Funcionando' }
          : { tom: 'cinza' as Tom, rotulo: 'Sem envios' },
    principal: ultimo ? `Último envio ${haQuanto(ultimo.enviadoEm, agora)}` : 'Nenhum e-mail enviado',
    detalhe: `Envia como ${status.smtp.remetente}`,
  };

  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <CartaoStatus id="acesso" icone={ShieldCheck} titulo="Acesso" {...acesso} aberto={aberto === 'acesso'} aoAbrir={aoAbrir} />
      <CartaoStatus id="d4sign" icone={FileSignature} titulo="D4Sign" {...d4sign} aberto={aberto === 'd4sign'} aoAbrir={aoAbrir} />
      <CartaoStatus
        id="rotinas"
        icone={CalendarClock}
        titulo="Rotinas"
        {...rotinas}
        rodape={proxima ? <BarraDeProgresso fracao={progresso(proxima, agora)} /> : undefined}
        aberto={aberto === 'rotinas'}
        aoAbrir={aoAbrir}
      />
      <CartaoStatus id="email" icone={MailCheck} titulo="E-mail" {...email} aberto={aberto === 'email'} aoAbrir={aoAbrir} />
    </div>
  );
}

function CartaoStatus({
  id,
  icone: Icone,
  titulo,
  estado,
  principal,
  detalhe,
  rodape,
  aberto,
  aoAbrir,
}: {
  id: Cartao;
  icone: LucideIcon;
  titulo: string;
  estado: { tom: Tom; rotulo: string };
  principal: string;
  detalhe: string;
  rodape?: React.ReactNode;
  aberto: boolean;
  aoAbrir: (cartao: Cartao) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => aoAbrir(id)}
      aria-expanded={aberto}
      className={cn(
        'group flex h-full flex-col rounded-2xl border bg-white p-4 text-left shadow-xs transition-all dark:bg-slate-900/50',
        aberto
          ? 'border-indigo-300 ring-2 ring-indigo-500/15 dark:border-indigo-500/50'
          : 'border-slate-200/80 hover:border-slate-300 hover:shadow-sm dark:border-slate-800/80 dark:hover:border-slate-700',
      )}
    >
      <div className="flex w-full items-center gap-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">
          <Icone className="h-4 w-4" />
        </div>
        <p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700 dark:text-slate-300">{titulo}</p>
        <Etiqueta {...estado} />
      </div>

      <p className="mt-3.5 truncate text-[15px] font-semibold text-slate-900 dark:text-slate-100">{principal}</p>
      <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{detalhe || ' '}</p>

      {rodape && <div className="mt-3 w-full">{rodape}</div>}

      <span className="mt-auto flex w-full items-center justify-end pt-3 text-xs font-medium text-slate-400 transition-colors group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300">
        {aberto ? 'Fechar' : 'Detalhes'}
        <ChevronDown className={cn('ml-1 h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
      </span>
    </button>
  );
}

function Etiqueta({ tom, rotulo }: { tom: Tom; rotulo: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
        TOM[tom],
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {rotulo}
    </span>
  );
}

function BarraDeProgresso({ fracao }: { fracao: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className="h-full rounded-full bg-indigo-500 transition-[width] duration-1000 ease-linear"
        style={{ width: `${Math.round(fracao * 1000) / 10}%` }}
      />
    </div>
  );
}

function Interruptor({
  ligado,
  desabilitado,
  rotulo,
  aoAlternar,
}: {
  ligado: boolean;
  desabilitado?: boolean;
  rotulo: string;
  aoAlternar: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      title={rotulo}
      disabled={desabilitado}
      onClick={aoAlternar}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        ligado ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700',
      )}
    >
      <span
        className={cn(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
          ligado ? 'translate-x-[22px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Detalhes de cada cartao
// ---------------------------------------------------------------------------

const PERMISSOES: Array<{ acao: string; analista: string | boolean; admin: boolean }> = [
  { acao: 'Ver estoque, empréstimos, entregas, colaboradores e dashboard', analista: 'Só da sua empresa', admin: true },
  { acao: 'Cadastrar e movimentar equipamentos e periféricos', analista: 'Só da sua empresa', admin: true },
  { acao: 'Emprestar, entregar e receber de volta', analista: 'Só da sua empresa', admin: true },
  { acao: 'Escolher a empresa do termo de comodato', analista: 'A do equipamento', admin: true },
  { acao: 'Importar a planilha de contagem', analista: 'Só da sua empresa', admin: true },
  { acao: 'Ver o estado das integrações', analista: true, admin: true },
  { acao: 'Ver os e-mails enviados', analista: 'Só da sua empresa', admin: true },
  { acao: 'Ligar/desligar o D4Sign, processar a fila e rodar rotinas', analista: false, admin: true },
  { acao: 'Empresas, categorias do estoque e modelos de e-mail', analista: false, admin: true },
];

function Permitido({ valor }: { valor: string | boolean }) {
  if (valor === true) return <Check className="mx-auto h-4 w-4 text-emerald-600 dark:text-emerald-400" />;
  if (valor === false) return <Minus className="mx-auto h-4 w-4 text-slate-300 dark:text-slate-600" />;
  return <span className="text-xs text-amber-700 dark:text-amber-400">{valor}</span>;
}

function DetalhesAcesso({ status, perfil }: { status: StatusSistema; perfil: Perfil | null }) {
  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)]">
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Você</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">{perfil?.nome ?? '-'}</dd>
            <dd className="text-xs text-slate-500 dark:text-slate-400">{perfil?.email}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Perfil</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {perfil ? (perfil.admin ? 'Administrador' : 'Analista') : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">Empresa (campo "Empresa" do AD)</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {perfil?.empresa ?? 'Não identificada'}
            </dd>
            {perfil && !perfil.admin && !perfil.empresa && (
              <dd className="text-xs text-slate-500 dark:text-slate-400">
                Sem empresa no AD o analista não vê nenhum dado; peça à infraestrutura para preencher o campo.
              </dd>
            )}
          </div>
        </dl>

        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-500 dark:bg-slate-950/50 dark:text-slate-400">
                <th className="px-3 py-2 text-left font-medium">O que dá para fazer</th>
                <th className="w-32 px-3 py-2 text-center font-medium">Analista</th>
                <th className="w-28 px-3 py-2 text-center font-medium">Administrador</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {PERMISSOES.map((p) => (
                <tr key={p.acao}>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{p.acao}</td>
                  <td className="px-3 py-2 text-center">
                    <Permitido valor={p.analista} />
                  </td>
                  <td className="px-3 py-2 text-center">
                    <Permitido valor={p.admin} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <ul className="space-y-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        <li>
          {status.entraId.grupoRestrito
            ? 'Só quem está no grupo do Notrole no AD consegue entrar.'
            : 'Qualquer conta da empresa entra. Defina AZURE_GRUPO_AUTORIZADO_ID no servidor.'}
        </li>
        <li>
          Administrador é quem está no grupo de administradores do Notrole no AD e vê todas as empresas. O
          analista vê e movimenta só a empresa do campo "Empresa" do perfil dele no AD.
        </li>
        <li>Tudo o que alguém movimenta fica registrado no extrato, com o nome de quem fez.</li>
      </ul>

      {!status.entraId.grupoAdministradores && (
        <Aviso tom="ambar">
          O grupo de administradores não está configurado (AZURE_GRUPO_ADMIN_ID): hoje todos têm acesso de
          administrador.
        </Aviso>
      )}
    </div>
  );
}

function DetalhesD4Sign({
  status,
  fila,
  admin,
  executando,
  aoAlternar,
  aoProcessar,
}: {
  status: StatusSistema;
  fila: FilaTermos | null;
  admin: boolean;
  executando: string | null;
  aoAlternar: () => void;
  aoProcessar: () => void;
}) {
  const d = status.d4sign;

  if (!d.configurado) {
    return (
      <Aviso tom="ambar">
        {!d.credenciais
          ? 'As credenciais do D4Sign não estão no servidor. '
          : 'O D4Sign está desligado no servidor (D4SIGN_ATIVO=false). '}
        Enquanto isso, os empréstimos e entregas começam ativos, sem termo de comodato.
      </Aviso>
    );
  }

  return (
    <div className="space-y-5">
      <div
        className={cn(
          'flex items-start gap-4 rounded-xl border p-4',
          d.pausado
            ? 'border-amber-200 bg-amber-50/50 dark:border-amber-500/25 dark:bg-amber-500/5'
            : 'border-slate-200/80 dark:border-slate-800',
        )}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-900 dark:text-slate-100">
            {d.pausado ? 'Integração pausada' : 'Integração ligada'}
          </p>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
            {d.pausado
              ? 'O Notrole não faz nenhuma chamada ao D4Sign. Empréstimos e entregas com termo continuam sendo registrados e o termo espera na fila até religar.'
              : 'Os termos saem sozinhos pela fila. Se algo sair do normal (documento repetido, cobrança inesperada), pause aqui: para na hora, sem mexer no servidor.'}
          </p>
          {d.alteradoPor && d.alteradoEm && (
            <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
              {d.pausado ? 'Pausado' : 'Religado'} por {d.alteradoPor} em {formatarDataHora(d.alteradoEm)}
            </p>
          )}
          {!admin && (
            <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">Só administradores ligam e desligam.</p>
          )}
        </div>
        {executando === 'd4sign' ? (
          <Loader2 className="mt-1 h-5 w-5 animate-spin text-slate-400" />
        ) : (
          <Interruptor
            ligado={!d.pausado}
            desabilitado={!admin}
            rotulo={d.pausado ? 'Religar o D4Sign' : 'Pausar o D4Sign'}
            aoAlternar={aoAlternar}
          />
        )}
      </div>

      {fila && (
        <PainelFilaTermos
          fila={fila}
          processando={executando === 'fila'}
          podeProcessar={admin && !d.pausado}
          aoProcessar={aoProcessar}
        />
      )}
    </div>
  );
}

function DetalhesRotinas({
  status,
  agora,
  admin,
  executando,
  aoExecutar,
}: {
  status: StatusSistema;
  agora: number;
  admin: boolean;
  executando: string | null;
  aoExecutar: (rotina: 'cobranca' | 'lembretes') => void;
}) {
  return (
    <div className="space-y-3">
      {!status.jobs.habilitados && (
        <Aviso tom="ambar">
          As rotinas estão desligadas no servidor (JOBS_HABILITADOS=false). Nenhum lembrete ou cobrança sai
          sozinho.
        </Aviso>
      )}

      {(status.jobs.rotinas ?? []).map((r) => {
        const info = ROTINAS[r.id];
        const ultima = r.ultimaExecucao;
        return (
          <div key={r.id} className="rounded-xl border border-slate-200/80 p-4 dark:border-slate-800">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{info.titulo}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400">{info.descricao}</p>
                <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{descreverAgenda(r.expressao)}</p>
              </div>
              {admin && (
                <Button variant="outline" size="sm" onClick={() => aoExecutar(r.id)} disabled={executando === r.id}>
                  {executando === r.id ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Play className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  Rodar agora
                </Button>
              )}
            </div>

            {r.proxima && (
              <div className="mt-4 space-y-1.5">
                <BarraDeProgresso fracao={progresso(r, agora)} />
                <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-xs">
                  <span className="text-slate-500 dark:text-slate-400">
                    {ultima ? (
                      <>
                        Última: {horario(ultima.em, agora)} ·{' '}
                        {ultima.erro ? (
                          <span className="text-red-600 dark:text-red-400">falhou: {ultima.erro}</span>
                        ) : (
                          (ultima.resumo ?? 'concluída')
                        )}
                      </>
                    ) : (
                      'Ainda não rodou desde que o servidor iniciou'
                    )}
                  </span>
                  <span className="font-medium text-slate-700 dark:text-slate-300">
                    Próxima: {horario(r.proxima, agora)} ({emQuanto(Date.parse(r.proxima) - agora)})
                  </span>
                </div>
              </div>
            )}
          </div>
        );
      })}

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Cada colaborador recebe no máximo um e-mail de cada tipo por dia, mesmo rodando na mão. Só entram
        empréstimos com prazo; entregas não recebem lembrete nem cobrança.
      </p>
    </div>
  );
}

function DetalhesEmail({
  status,
  emails,
  testando,
  aoTestar,
}: {
  status: StatusSistema;
  emails: EmailEnviado[];
  testando: boolean;
  aoTestar: () => void;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200/80 p-4 sm:flex-row sm:items-center dark:border-slate-800">
        <dl className="grid min-w-0 flex-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-xs text-slate-500 dark:text-slate-400">Remetente</dt>
            <dd className="truncate font-medium text-slate-900 dark:text-slate-100">{status.smtp.remetente}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-slate-500 dark:text-slate-400">Servidor</dt>
            <dd className="truncate font-mono text-[13px] text-slate-700 dark:text-slate-300">
              {status.smtp.host}:{status.smtp.porta}
            </dd>
          </div>
        </dl>
        <Button variant="outline" size="sm" onClick={aoTestar} disabled={testando}>
          {testando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <MailCheck className="mr-1.5 h-3.5 w-3.5" />}
          Testar conexão
        </Button>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Últimos e-mails enviados
        </p>
        {emails.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">Nenhum e-mail enviado ainda.</p>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {emails.slice(0, 20).map((email) => (
              <li key={email.id} className="flex items-start gap-3 py-2.5 text-sm">
                {email.sucesso ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium text-slate-900 dark:text-slate-100">{email.assunto}</p>
                  <p className="truncate text-xs text-slate-500">
                    {email.destinatario} · {formatarDataHora(email.enviadoEm)}
                  </p>
                  {email.erro && <p className="mt-0.5 text-xs text-red-600 dark:text-red-400">{email.erro}</p>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EditorTemplate({
  template,
  rascunho,
  variaveis,
  salvando,
  testando,
  aoAlterar,
  aoSalvar,
  aoRestaurar,
  aoTestar,
}: {
  template: TemplateEmail;
  rascunho?: { assunto: string; corpo: string };
  variaveis: string[];
  salvando: boolean;
  testando: boolean;
  aoAlterar: (campo: 'assunto' | 'corpo', valor: string) => void;
  aoSalvar: () => void;
  aoRestaurar: () => void;
  aoTestar: () => void;
}) {
  const alterado = rascunho && (rascunho.assunto !== template.assunto || rascunho.corpo !== template.corpo);

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">{DESCRICAO_TEMPLATE[template.chave]}</p>

      <div className="space-y-1.5">
        <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Assunto</label>
        <Input value={rascunho?.assunto ?? ''} onChange={(e) => aoAlterar('assunto', e.target.value)} maxLength={200} />
      </div>

      <div className="space-y-1.5">
        <label className="block text-[13px] font-medium text-slate-700 dark:text-slate-300">Mensagem</label>
        <textarea
          className={cn(classeCampo, 'min-h-[220px] py-2.5 font-mono text-[13px] leading-relaxed')}
          value={rascunho?.corpo ?? ''}
          onChange={(e) => aoAlterar('corpo', e.target.value)}
          maxLength={8000}
        />
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-slate-500">Variáveis (clique para copiar):</span>
          {variaveis.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(`{${v}}`);
                toast.success(`{${v}} copiado.`);
              }}
              className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-indigo-500/15 dark:hover:text-indigo-300"
            >
              {`{${v}}`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between dark:border-slate-800">
        <span className="text-xs text-slate-500">
          {template.updatedBy
            ? `Alterado por ${template.updatedBy} em ${formatarDataHora(template.updatedAt)}`
            : 'Texto padrão do sistema'}
        </span>
        <div className="flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" onClick={aoRestaurar}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Texto padrão
          </Button>
          <Button variant="outline" size="sm" onClick={aoTestar} disabled={testando}>
            {testando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />}
            Enviar teste para mim
          </Button>
          <Button size="sm" onClick={aoSalvar} disabled={!alterado || salvando}>
            <Save className="mr-1.5 h-3.5 w-3.5" />
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Fila dos termos do D4Sign.
 *
 * Existe porque a conta tem um teto de requisicoes por hora e cada termo
 * consome tres chamadas. Emprestando quatro ou cinco maquinas de uma vez, parte
 * dos termos fica esperando cota - e o operador precisa enxergar isso, em vez
 * de achar que o colaborador recebeu um documento que ainda nem saiu.
 */
function PainelFilaTermos({
  fila,
  processando,
  podeProcessar,
  aoProcessar,
}: {
  fila: FilaTermos;
  processando: boolean;
  podeProcessar: boolean;
  aoProcessar: () => void;
}) {
  const temPendentes = fila.pendentes > 0;
  const emprestimosPorHora = Math.floor(fila.limitePorHora / fila.chamadasPorTermo);

  return (
    <div className="space-y-4">
      {fila.ambiente === 'sandbox' && (
        <Aviso tom="violeta">
          Ambiente de <b>testes</b> (sandbox) do D4Sign: nada aqui gera cobrança.
        </Aviso>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Numero rotulo="Documentos neste mês" valor={fila.documentosNoMes} />
        <Numero rotulo="Na fila" valor={fila.pendentes} destaque={temPendentes ? 'aviso' : undefined} />
        <Numero
          rotulo="Precisam de atenção"
          valor={fila.precisamAtencao + fila.emailsComProblema}
          destaque={fila.precisamAtencao + fila.emailsComProblema > 0 ? 'erro' : undefined}
        />
        <Numero rotulo="Cota restante na hora" valor={fila.cotaRestante} />
      </div>

      {fila.precisamAtencao > 0 && (
        <Aviso tom="vermelho">
          {fila.precisamAtencao} termo(s) pararam e o sistema <b>não vai tentar sozinho</b>, para não
          arriscar criar documento em duplicidade. Nas telas de Empréstimos e Entregas eles aparecem como
          "Termo com problema", com as opções de tentar de novo ou ativar manualmente.
        </Aviso>
      )}

      {fila.emailsComProblema > 0 && (
        <Aviso tom="vermelho">
          {fila.emailsComProblema} termo(s) foram enviados, mas o <b>e-mail de assinatura não foi
          entregue</b>. Em geral é porque o endereço está na lista de supressão do D4Sign, e só o suporte
          deles pode liberar. Nas telas de Empréstimos e Entregas eles aparecem como "E-mail não entregue",
          com a opção de reenviar o convite.
        </Aviso>
      )}

      {temPendentes && !fila.pausado && fila.termosQueCabemAgora === 0 && (
        <Aviso tom="ambar">
          A cota desta hora acabou. Os {fila.pendentes} termo(s) na fila saem sozinhos em cerca de{' '}
          {fila.proximaJanelaEmMinutos} minuto(s). Não é preciso fazer nada.
        </Aviso>
      )}

      <ul className="space-y-1.5 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
        <li>
          Cada termo usa {fila.chamadasPorTermo} requisições. O Notrole se limita a {fila.limitePorHora} por
          hora ({emprestimosPorHora} termo(s)), abaixo do teto da conta, para não esgotar a cota de outras
          integrações da empresa.
        </li>
        <li>
          {fila.consultaAutomatica
            ? `A assinatura é conferida sozinha em horário comercial, no máximo a cada ${fila.horasEntreConsultas}h por documento e por até ${fila.diasMaxConsulta} dias.`
            : 'A conferência automática da assinatura está desligada. Use o botão "Verificar assinatura" nas telas de Empréstimos e Entregas.'}
        </li>
        <li>Sem nada pendente, o Notrole não faz nenhuma chamada ao D4Sign.</li>
      </ul>

      {podeProcessar && (
        <Button variant="outline" size="sm" onClick={aoProcessar} disabled={processando}>
          {processando ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="mr-1.5 h-3.5 w-3.5" />
          )}
          Processar fila agora
        </Button>
      )}
    </div>
  );
}

function Aviso({ tom, children }: { tom: 'vermelho' | 'ambar' | 'violeta'; children: React.ReactNode }) {
  const cores = {
    vermelho: 'bg-red-50 text-red-800 ring-red-600/15 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-400/20',
    ambar: 'bg-amber-50 text-amber-800 ring-amber-600/15 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-400/20',
    violeta: 'bg-violet-50 text-violet-800 ring-violet-600/15 dark:bg-violet-500/10 dark:text-violet-300 dark:ring-violet-400/20',
  };
  return <p className={cn('rounded-xl p-3.5 text-sm ring-1 ring-inset', cores[tom])}>{children}</p>;
}

function Numero({ rotulo, valor, destaque }: { rotulo: string; valor: number; destaque?: 'aviso' | 'erro' }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3.5 dark:bg-slate-950/50">
      <p className="text-xs text-slate-500 dark:text-slate-400">{rotulo}</p>
      <p
        className={cn(
          'mt-0.5 text-2xl font-semibold tabular-nums',
          destaque === 'erro'
            ? 'text-red-600 dark:text-red-400'
            : destaque === 'aviso'
              ? 'text-amber-600 dark:text-amber-400'
              : 'text-slate-900 dark:text-slate-100',
        )}
      >
        {valor}
      </p>
    </div>
  );
}
