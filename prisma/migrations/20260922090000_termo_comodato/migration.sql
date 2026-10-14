-- Dados do termo de comodato gerado pelo Notrole.
--
-- O termo e o modelo Word "MINUTA - Comodato Emprestimo PF Padrao", preenchido
-- pelo proprio Notrole (ver src/api/services/ContratoService.ts). Estas colunas
-- guardam o que o contrato precisa e o sistema ainda nao tinha.

-- Valor do bem (Clausula Primeira do contrato).
ALTER TABLE "Notebook" ADD COLUMN "valor" DECIMAL(12,2);

-- Endereco do colaborador, informado na retirada e guardado para os proximos
-- emprestimos; e a empresa como consta no perfil do AD.
ALTER TABLE "Colaborador" ADD COLUMN "endereco" TEXT,
ADD COLUMN "empresaAD" TEXT;

-- Empresa comodante, motivo, acessorios e testemunha de cada emprestimo.
ALTER TABLE "Emprestimo" ADD COLUMN "empresaId" INTEGER,
ADD COLUMN "motivo" TEXT,
ADD COLUMN "acessorios" TEXT,
ADD COLUMN "testemunhaNome" TEXT,
ADD COLUMN "testemunhaEmail" TEXT;

-- Empresas do grupo em nome das quais o termo e emitido.
CREATE TABLE "Empresa" (
    "id" SERIAL NOT NULL,
    "apelido" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "cnpj" TEXT NOT NULL,
    "logradouro" TEXT NOT NULL,
    "cidade" TEXT NOT NULL,
    "uf" TEXT NOT NULL,
    "cep" TEXT NOT NULL,
    "d4signPastaId" TEXT,
    "termosAD" TEXT NOT NULL,
    "padrao" BOOLEAN NOT NULL DEFAULT false,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Empresa_apelido_key" ON "Empresa"("apelido");
CREATE UNIQUE INDEX "Empresa_cnpj_key" ON "Empresa"("cnpj");

ALTER TABLE "Emprestimo" ADD CONSTRAINT "Emprestimo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- As empresas NAO sao inseridas aqui: cada instalacao cadastra as suas em
-- Configuracoes > Empresas (ou roda o seed de exemplo: npm run db:seed).
-- termosAD: palavras que identificam a empresa no campo "Empresa" do perfil do
-- AD, que costuma ter varias grafias ("Empresa Exemplo - Filial", "empresa
-- exemplo ltda"...). A comparacao ignora maiusculas e acentos.
