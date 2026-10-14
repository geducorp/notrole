-- Estoque de T.I.: o Notrole deixa de controlar so notebooks de emprestimo e
-- passa a controlar o estoque de todas as empresas.
--
-- A tabela "Notebook" vira "Item": um notebook passa a ser um item da
-- categoria Notebook. Nada e recriado, so renomeado - os emprestimos, o
-- historico e os termos ja assinados continuam apontando para o mesmo
-- equipamento.

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

CREATE TYPE "TipoControle" AS ENUM ('ITEM', 'QUANTIDADE');
CREATE TYPE "CondicaoItem" AS ENUM ('NOVO', 'USADO');
CREATE TYPE "SituacaoItem" AS ENUM ('EM_ESTOQUE', 'RESERVADO', 'EMPRESTADO', 'ENTREGUE', 'MANUTENCAO', 'BAIXADO');
CREATE TYPE "TipoMovimentacao" AS ENUM (
  'ENTRADA', 'CONTAGEM_INICIAL', 'ENTREGA', 'DEVOLUCAO', 'EMPRESTIMO',
  'DEVOLUCAO_EMPRESTIMO', 'TRANSFERENCIA', 'MANUTENCAO', 'RETORNO_MANUTENCAO',
  'BAIXA', 'AJUSTE'
);

-- ---------------------------------------------------------------------------
-- Categorias e locais
-- ---------------------------------------------------------------------------

CREATE TABLE "Categoria" (
  "id" SERIAL PRIMARY KEY,
  "nome" TEXT NOT NULL,
  "controle" "TipoControle" NOT NULL,
  "icone" TEXT,
  "ordem" INTEGER NOT NULL DEFAULT 0,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "Categoria_nome_key" ON "Categoria"("nome");

INSERT INTO "Categoria" ("nome", "controle", "icone", "ordem", "updatedAt") VALUES
  ('Notebook', 'ITEM', 'laptop', 1, CURRENT_TIMESTAMP),
  ('Monitor', 'ITEM', 'monitor', 2, CURRENT_TIMESTAMP),
  ('Celular', 'ITEM', 'smartphone', 3, CURRENT_TIMESTAMP),
  ('Impressora', 'ITEM', 'printer', 4, CURRENT_TIMESTAMP),
  ('Memória RAM', 'QUANTIDADE', 'memory-stick', 5, CURRENT_TIMESTAMP),
  ('Kit teclado e mouse', 'QUANTIDADE', 'keyboard', 6, CURRENT_TIMESTAMP),
  ('Headset', 'QUANTIDADE', 'headphones', 7, CURRENT_TIMESTAMP),
  ('Adaptador', 'QUANTIDADE', 'cable', 8, CURRENT_TIMESTAMP),
  ('Carregador', 'QUANTIDADE', 'plug-zap', 9, CURRENT_TIMESTAMP);

CREATE TABLE "Local" (
  "id" SERIAL PRIMARY KEY,
  "nome" TEXT NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Local_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Local_empresaId_nome_key" ON "Local"("empresaId", "nome");

-- Um estoque por empresa, com o nome da cidade dela.
INSERT INTO "Local" ("nome", "empresaId", "updatedAt")
SELECT 'Estoque T.I. - ' || "cidade", "id", CURRENT_TIMESTAMP FROM "Empresa";

-- ---------------------------------------------------------------------------
-- Notebook -> Item
-- ---------------------------------------------------------------------------

ALTER TABLE "Notebook" RENAME TO "Item";
ALTER TABLE "Item" RENAME CONSTRAINT "Notebook_pkey" TO "Item_pkey";
ALTER INDEX "Notebook_hostname_key" RENAME TO "Item_hostname_key";
ALTER INDEX "Notebook_patrimonio_key" RENAME TO "Item_patrimonio_key";
ALTER SEQUENCE "Notebook_id_seq" RENAME TO "Item_id_seq";
DROP INDEX IF EXISTS "Notebook_status_idx";

-- Hostname e patrimonio passam a ser opcionais: um monitor nao tem hostname.
ALTER TABLE "Item" ALTER COLUMN "hostname" DROP NOT NULL;
ALTER TABLE "Item" ALTER COLUMN "patrimonio" DROP NOT NULL;

ALTER TABLE "Item"
  ADD COLUMN "categoriaId" INTEGER,
  ADD COLUMN "empresaId" INTEGER,
  ADD COLUMN "localId" INTEGER,
  ADD COLUMN "condicao" "CondicaoItem" NOT NULL DEFAULT 'NOVO',
  ADD COLUMN "situacao" "SituacaoItem" NOT NULL DEFAULT 'EM_ESTOQUE',
  ADD COLUMN "dataEntrada" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "fornecedor" TEXT,
  ADD COLUMN "notaFiscal" TEXT,
  ADD COLUMN "paraEmprestimo" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "colaboradorId" INTEGER,
  ADD COLUMN "entregueEm" TIMESTAMP(3);

-- Os notebooks que ja existiam sao os do emprestimo: usados, da empresa
-- padrao, guardados no estoque dela.
UPDATE "Item" SET
  "categoriaId" = (SELECT "id" FROM "Categoria" WHERE "nome" = 'Notebook'),
  "empresaId" = COALESCE(
    (SELECT "id" FROM "Empresa" WHERE "padrao" = true ORDER BY "id" LIMIT 1),
    (SELECT "id" FROM "Empresa" ORDER BY "id" LIMIT 1)
  ),
  "condicao" = 'USADO',
  "paraEmprestimo" = true,
  "dataEntrada" = "createdAt",
  "situacao" = CASE "status"::text
    WHEN 'DISPONIVEL'    THEN 'EM_ESTOQUE'::"SituacaoItem"
    WHEN 'RESERVADO'     THEN 'RESERVADO'::"SituacaoItem"
    WHEN 'EM_USO'        THEN 'EMPRESTADO'::"SituacaoItem"
    WHEN 'MANUTENCAO'    THEN 'MANUTENCAO'::"SituacaoItem"
    WHEN 'DESCONTINUADO' THEN 'BAIXADO'::"SituacaoItem"
    ELSE 'EM_ESTOQUE'::"SituacaoItem"
  END;

UPDATE "Item" SET "localId" = (
  SELECT "id" FROM "Local" WHERE "Local"."empresaId" = "Item"."empresaId" ORDER BY "id" LIMIT 1
);

ALTER TABLE "Item" ALTER COLUMN "categoriaId" SET NOT NULL;
ALTER TABLE "Item" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "Item" DROP COLUMN "status";
DROP TYPE "StatusNotebook";

ALTER TABLE "Item"
  ADD CONSTRAINT "Item_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Item_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "Item_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "Item_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Item_situacao_idx" ON "Item"("situacao");
CREATE INDEX "Item_categoriaId_idx" ON "Item"("categoriaId");
CREATE INDEX "Item_empresaId_idx" ON "Item"("empresaId");

-- ---------------------------------------------------------------------------
-- Emprestimo.notebookId -> itemId
-- ---------------------------------------------------------------------------

ALTER TABLE "Emprestimo" RENAME COLUMN "notebookId" TO "itemId";
ALTER TABLE "Emprestimo" RENAME CONSTRAINT "Emprestimo_notebookId_fkey" TO "Emprestimo_itemId_fkey";
ALTER INDEX "Emprestimo_notebookId_idx" RENAME TO "Emprestimo_itemId_idx";

-- ---------------------------------------------------------------------------
-- Itens por quantidade
-- ---------------------------------------------------------------------------

CREATE TABLE "ItemQuantidade" (
  "id" SERIAL PRIMARY KEY,
  "categoriaId" INTEGER NOT NULL,
  "empresaId" INTEGER NOT NULL,
  "localId" INTEGER,
  "descricao" TEXT NOT NULL,
  "quantidade" INTEGER NOT NULL DEFAULT 0,
  "estoqueMinimo" INTEGER,
  "valorUnitario" DECIMAL(12,2),
  "observacoes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ItemQuantidade_categoriaId_fkey" FOREIGN KEY ("categoriaId") REFERENCES "Categoria"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ItemQuantidade_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ItemQuantidade_localId_fkey" FOREIGN KEY ("localId") REFERENCES "Local"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ItemQuantidade_empresaId_categoriaId_descricao_key" ON "ItemQuantidade"("empresaId", "categoriaId", "descricao");
CREATE INDEX "ItemQuantidade_empresaId_idx" ON "ItemQuantidade"("empresaId");

-- ---------------------------------------------------------------------------
-- Movimentacoes
-- ---------------------------------------------------------------------------

CREATE TABLE "Movimentacao" (
  "id" SERIAL PRIMARY KEY,
  "tipo" "TipoMovimentacao" NOT NULL,
  "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "itemId" INTEGER,
  "itemQuantidadeId" INTEGER,
  "quantidade" INTEGER NOT NULL DEFAULT 1,
  "empresaOrigemId" INTEGER,
  "empresaDestinoId" INTEGER,
  "localOrigemId" INTEGER,
  "localDestinoId" INTEGER,
  "colaboradorId" INTEGER,
  "emprestimoId" INTEGER,
  "usuario" TEXT,
  "observacao" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Movimentacao_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Movimentacao_itemQuantidadeId_fkey" FOREIGN KEY ("itemQuantidadeId") REFERENCES "ItemQuantidade"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Movimentacao_colaboradorId_fkey" FOREIGN KEY ("colaboradorId") REFERENCES "Colaborador"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "Movimentacao_emprestimoId_fkey" FOREIGN KEY ("emprestimoId") REFERENCES "Emprestimo"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "Movimentacao_itemId_idx" ON "Movimentacao"("itemId");
CREATE INDEX "Movimentacao_itemQuantidadeId_idx" ON "Movimentacao"("itemQuantidadeId");
CREATE INDEX "Movimentacao_data_idx" ON "Movimentacao"("data");

-- Os notebooks que ja estavam cadastrados entram como contagem inicial, para
-- que todo equipamento tenha um extrato desde o comeco.
INSERT INTO "Movimentacao" ("tipo", "data", "itemId", "empresaDestinoId", "localDestinoId", "usuario", "observacao")
SELECT 'CONTAGEM_INICIAL', "createdAt", "id", "empresaId", "localId", 'SISTEMA',
       'Cadastrado antes do controle de estoque, no módulo de empréstimos.'
FROM "Item";
