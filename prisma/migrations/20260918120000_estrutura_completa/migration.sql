-- Ajusta o schema para o que o codigo realmente precisa.
--
-- Contexto: varios campos usados pelo codigo nunca existiram no banco
-- (Notebook.patrimonio e Notebook.marca no relatorio em PDF, por exemplo), o
-- historico de acoes nunca foi preenchido e os templates de e-mail viviam no
-- localStorage do navegador. Esta migracao acerta tudo isso.
--
-- O banco de producao tinha 1 notebook de teste e nenhum emprestimo quando
-- esta migracao foi escrita, entao o risco de perda de dados e nulo. Ainda
-- assim, a coluna patrimonio e criada em tres passos para nao falhar caso
-- existam registros.

-- CreateEnum
CREATE TYPE "TipoAcao" AS ENUM ('CRIADO', 'TERMO_GERADO', 'TERMO_ASSINADO', 'ATIVADO', 'RENOVADO', 'LEMBRETE_ENVIADO', 'COBRADO', 'DEVOLVIDO', 'CANCELADO');

-- CreateEnum
CREATE TYPE "TipoTemplate" AS ENUM ('CONFIRMACAO_EMPRESTIMO', 'LEMBRETE_PREVIO', 'COBRANCA_ATRASO', 'DEVOLUCAO_CONFIRMADA');

-- DropForeignKey
ALTER TABLE "HistoricoAcoes" DROP CONSTRAINT "HistoricoAcoes_emprestimoId_fkey";

-- AlterTable
ALTER TABLE "Colaborador" ADD COLUMN     "ativo" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cargo" TEXT,
ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "idAD" TEXT;

-- AlterTable
ALTER TABLE "Emprestimo" ADD COLUMN     "condicaoDevolucao" TEXT,
ADD COLUMN     "criadoPor" TEXT,
ADD COLUMN     "d4signAssinadoEm" TIMESTAMP(3),
ADD COLUMN     "d4signStatus" TEXT,
ADD COLUMN     "d4signTentativas" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "d4signProximaTentativa" TIMESTAMP(3),
ADD COLUMN     "lembretePrevioEm" TIMESTAMP(3),
ADD COLUMN     "observacoes" TEXT,
ADD COLUMN     "renovacoes" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ultimaCobrancaEm" TIMESTAMP(3);

-- AlterTable
-- A coluna "acao" era TEXT livre, com os valores documentados apenas num
-- comentario do schema. Vira enum. A tabela esta vazia, entao nao ha conversao
-- de valores a fazer.
ALTER TABLE "HistoricoAcoes" ADD COLUMN     "usuario" TEXT,
DROP COLUMN "acao",
ADD COLUMN     "acao" "TipoAcao" NOT NULL;

-- AlterTable
ALTER TABLE "Notebook" ADD COLUMN     "marca" TEXT,
ADD COLUMN     "observacoes" TEXT;

-- Renomeia serviceTag para patrimonio.
--
-- Em muitas empresas a Service Tag do fabricante e usada como numero de patrimonio:
-- sao a mesma coisa, e a tela sempre chamou esse campo de "Patrimonio" embora
-- gravasse em serviceTag. Renomear preserva os dados; um DROP + ADD, que e o
-- que o Prisma geraria sozinho, perderia o conteudo da coluna.
ALTER TABLE "Notebook" RENAME COLUMN "serviceTag" TO "patrimonio";

-- O indice unico acompanha a coluna renomeada, mas mantem o nome antigo. Ele e
-- recriado com o nome novo mais adiante nesta migracao.
DROP INDEX IF EXISTS "Notebook_serviceTag_key";

-- A coluna era opcional e passa a ser obrigatoria. Se algum equipamento estiver
-- sem patrimonio, usa o hostname como marcador para a migracao nao falhar.
UPDATE "Notebook" SET "patrimonio" = "hostname" WHERE "patrimonio" IS NULL OR "patrimonio" = '';

ALTER TABLE "Notebook" ALTER COLUMN "patrimonio" SET NOT NULL;

-- DropTable
-- Resquicio do login local que antecedeu o SSO com o Entra ID. Guardava senha
-- em texto puro e nenhuma linha do codigo a consultava.
DROP TABLE "Admin";

-- CreateTable
CREATE TABLE "EmailEnviado" (
    "id" SERIAL NOT NULL,
    "destinatario" TEXT NOT NULL,
    "assunto" TEXT NOT NULL,
    "template" "TipoTemplate" NOT NULL,
    "sucesso" BOOLEAN NOT NULL,
    "erro" TEXT,
    "enviadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "emprestimoId" INTEGER,

    CONSTRAINT "EmailEnviado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateEmail" (
    "id" SERIAL NOT NULL,
    "chave" "TipoTemplate" NOT NULL,
    "assunto" TEXT NOT NULL,
    "corpo" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "TemplateEmail_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailEnviado_enviadoEm_idx" ON "EmailEnviado"("enviadoEm");

-- CreateIndex
CREATE INDEX "EmailEnviado_emprestimoId_idx" ON "EmailEnviado"("emprestimoId");

-- CreateIndex
CREATE UNIQUE INDEX "TemplateEmail_chave_key" ON "TemplateEmail"("chave");

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_cpf_key" ON "Colaborador"("cpf");

-- CreateIndex
CREATE UNIQUE INDEX "Colaborador_idAD_key" ON "Colaborador"("idAD");

-- CreateIndex
CREATE INDEX "Colaborador_nome_idx" ON "Colaborador"("nome");

-- CreateIndex
CREATE INDEX "Emprestimo_status_idx" ON "Emprestimo"("status");

-- CreateIndex
CREATE INDEX "Emprestimo_dataPrevista_idx" ON "Emprestimo"("dataPrevista");

-- CreateIndex
CREATE INDEX "Emprestimo_notebookId_idx" ON "Emprestimo"("notebookId");

-- CreateIndex
CREATE INDEX "Emprestimo_colaboradorId_idx" ON "Emprestimo"("colaboradorId");

-- CreateIndex
CREATE INDEX "Emprestimo_d4signProximaTentativa_idx" ON "Emprestimo"("d4signProximaTentativa");

-- CreateIndex
CREATE INDEX "HistoricoAcoes_emprestimoId_idx" ON "HistoricoAcoes"("emprestimoId");

-- CreateIndex
CREATE INDEX "HistoricoAcoes_dataAcao_idx" ON "HistoricoAcoes"("dataAcao");

-- CreateIndex
CREATE UNIQUE INDEX "Notebook_patrimonio_key" ON "Notebook"("patrimonio");

-- CreateIndex
CREATE INDEX "Notebook_status_idx" ON "Notebook"("status");

-- AddForeignKey
-- ON DELETE CASCADE: apagar um emprestimo leva junto o seu historico, em vez
-- de deixar linhas orfas.
ALTER TABLE "HistoricoAcoes" ADD CONSTRAINT "HistoricoAcoes_emprestimoId_fkey" FOREIGN KEY ("emprestimoId") REFERENCES "Emprestimo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailEnviado" ADD CONSTRAINT "EmailEnviado_emprestimoId_fkey" FOREIGN KEY ("emprestimoId") REFERENCES "Emprestimo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
