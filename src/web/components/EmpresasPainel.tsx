import React, { useEffect, useState } from 'react';
import { Building2, FolderCheck, FolderX, Pencil, Plus, Star } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Campo } from '@/components/ui/Campo';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { api } from '@/lib/api';
import { TOM } from '@/lib/dominio';
import type { Empresa } from '@/types';
import { LogoEmpresa } from '@/components/ui/Empresa';

/**
 * Empresas em nome das quais o termo de comodato e emitido.
 *
 * A empresa de cada emprestimo e reconhecida pelo campo "Empresa" do perfil do
 * colaborador no AD, usando as palavras-chave de cada uma. Quem nao tem empresa
 * no AD fica com a marcada como padrao.
 *
 * So o conteudo: quem usa decide a moldura (em Configuracoes, uma Secao).
 */
export function EmpresasPainel() {
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  // null = fechado; 'nova' = cadastro; Empresa = edicao.
  const [editando, setEditando] = useState<Empresa | 'nova' | null>(null);

  const carregar = () =>
    api
      .get<Empresa[]>('/empresas')
      .then(({ data }) => setEmpresas(data))
      .catch(() => undefined);

  useEffect(() => {
    void carregar();
  }, []);

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button type="button" size="sm" onClick={() => setEditando('nova')}>
          <Plus className="h-4 w-4" />
          Nova empresa
        </Button>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        {empresas.map((e) => (
          <div
            key={e.id}
            className="group relative rounded-xl border border-slate-200/80 p-4 transition-colors hover:border-slate-300 dark:border-slate-800 dark:hover:border-slate-700"
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-9 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
                  <LogoEmpresa apelido={e.apelido} altura={18} />
                </div>
                <p className="font-medium text-slate-900 dark:text-slate-100">{e.apelido}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                title="Editar"
                onClick={() => setEditando(e)}
                className="-mr-1.5 -mt-1 h-8 w-8 shrink-0"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
              {e.padrao && (
                <Badge className={TOM.violeta} icone={<Star className="h-3 w-3" />}>
                  Padrão
                </Badge>
              )}
              {!e.ativo && <Badge className={TOM.cinza}>Inativa</Badge>}
            </div>

            <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {e.razaoSocial}
              <br />
              CNPJ {e.cnpj}
              <br />
              {e.logradouro}, {e.cidade}/{e.uf}
            </p>

            <div className="mt-3 space-y-1 border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
              <p className="truncate text-slate-500 dark:text-slate-400" title={e.termosAD}>
                No AD: <span className="text-slate-700 dark:text-slate-300">{e.termosAD}</span>
              </p>
              <p
                className={
                  e.d4signPastaId
                    ? 'flex items-center gap-1 text-emerald-600 dark:text-emerald-400'
                    : 'flex items-center gap-1 text-amber-600 dark:text-amber-400'
                }
              >
                {e.d4signPastaId ? <FolderCheck className="h-3.5 w-3.5" /> : <FolderX className="h-3.5 w-3.5" />}
                {e.d4signPastaId ? 'Pasta no D4Sign definida' : 'Sem pasta no D4Sign'}
              </p>
            </div>
          </div>
        ))}
        {empresas.length === 0 && (
          <p className="py-4 text-center text-sm text-slate-500 md:col-span-3">
            Nenhuma empresa cadastrada. Cadastre ao menos uma para emitir termos e controlar o estoque.
          </p>
        )}
      </div>

      {editando && (
        <EditarEmpresa
          empresa={editando === 'nova' ? null : editando}
          aoFechar={() => setEditando(null)}
          aoSalvar={() => {
            setEditando(null);
            void carregar();
          }}
        />
      )}
    </>
  );
}

const EMPRESA_VAZIA: Omit<Empresa, 'id'> = {
  apelido: '',
  razaoSocial: '',
  cnpj: '',
  logradouro: '',
  cidade: '',
  uf: '',
  cep: '',
  d4signPastaId: null,
  termosAD: '',
  padrao: false,
  ativo: true,
};

function EditarEmpresa({
  empresa,
  aoFechar,
  aoSalvar,
}: {
  /** null = cadastro de empresa nova. */
  empresa: Empresa | null;
  aoFechar: () => void;
  aoSalvar: () => void;
}) {
  const [campos, setCampos] = useState({
    ...(empresa ?? EMPRESA_VAZIA),
    d4signPastaId: empresa?.d4signPastaId ?? '',
  });
  const [salvando, setSalvando] = useState(false);

  const alterar = <K extends keyof typeof campos>(chave: K, valor: (typeof campos)[K]) =>
    setCampos((atual) => ({ ...atual, [chave]: valor }));

  const salvar = async (evento: React.FormEvent) => {
    evento.preventDefault();
    setSalvando(true);
    try {
      const dados = {
        apelido: campos.apelido,
        razaoSocial: campos.razaoSocial,
        cnpj: campos.cnpj,
        logradouro: campos.logradouro,
        cidade: campos.cidade,
        uf: campos.uf,
        cep: campos.cep,
        d4signPastaId: campos.d4signPastaId.trim() || null,
        termosAD: campos.termosAD,
        padrao: campos.padrao,
        ativo: campos.ativo,
      };
      if (empresa) {
        await api.put(`/empresas/${empresa.id}`, dados);
        toast.success('Empresa atualizada.');
      } else {
        await api.post('/empresas', dados);
        toast.success('Empresa cadastrada.');
      }
      aoSalvar();
    } catch {
      // Mensagem ja exibida pelo interceptor.
    } finally {
      setSalvando(false);
    }
  };

  type CampoTexto =
    | 'apelido'
    | 'razaoSocial'
    | 'cnpj'
    | 'logradouro'
    | 'cidade'
    | 'uf'
    | 'cep'
    | 'termosAD'
    | 'd4signPastaId';

  const texto = (rotulo: string, chave: CampoTexto, dica?: string) => (
    <Campo rotulo={rotulo} dica={dica}>
      <Input value={campos[chave]} onChange={(e) => alterar(chave, e.target.value)} />
    </Campo>
  );

  return (
    <Modal
      aberto
      aoFechar={aoFechar}
      icone={<Building2 className="h-4 w-4" />}
      titulo={empresa ? 'Editar empresa' : 'Nova empresa'}
      descricao={empresa?.apelido ?? 'Dados que vão no termo de comodato.'}
      largura="lg"
      rodape={
        <>
          <Button type="button" variant="ghost" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button type="submit" form="form-empresa" disabled={salvando}>
            {salvando ? 'Salvando...' : 'Salvar'}
          </Button>
        </>
      }
    >
      <form id="form-empresa" onSubmit={salvar} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          {texto('Nome curto', 'apelido')}
          {texto('Razão social (vai no contrato)', 'razaoSocial')}
        </div>
        {texto('CNPJ', 'cnpj', 'Formato 00.000.000/0000-00.')}
        {texto('Rua, número e bairro', 'logradouro')}
        <div className="grid grid-cols-[1fr_4.5rem_7.5rem] gap-3">
          {texto('Cidade', 'cidade')}
          {texto('UF', 'uf')}
          {texto('CEP', 'cep')}
        </div>
        {texto(
          'Palavras que identificam a empresa no AD',
          'termosAD',
          'Separadas por vírgula. "exemplo" reconhece, por exemplo, "Empresa Exemplo - Filial Norte".',
        )}
        {texto(
          'Pasta no D4Sign',
          'd4signPastaId',
          'Código da pasta da empresa no cofre de TI. Para descobrir: node scripts/d4sign-explorar.mjs --pastas',
        )}

        <div className="flex gap-6 pt-1 text-sm text-slate-700 dark:text-slate-300">
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={campos.padrao}
              onChange={(e) => alterar('padrao', e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Empresa padrão
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={campos.ativo}
              onChange={(e) => alterar('ativo', e.target.checked)}
              className="h-4 w-4 accent-indigo-600"
            />
            Ativa
          </label>
        </div>
      </form>
    </Modal>
  );
}
