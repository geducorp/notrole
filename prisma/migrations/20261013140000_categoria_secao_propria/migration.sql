-- Equipamentos principais ganham aba propria na tela de Estoque; o resto vai
-- para "Perifericos".
ALTER TABLE "Categoria" ADD COLUMN "secaoPropria" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Categoria"
SET "secaoPropria" = true
WHERE "controle" = 'ITEM' AND "nome" IN ('Notebook', 'Monitor', 'Celular', 'Impressora');
