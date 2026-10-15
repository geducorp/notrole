-- Computador (notebook, desktop): exige numero de serie, tem hostname e
-- especificacoes. As outras categorias (monitor, celular...) nao exigem
-- numero de serie.
ALTER TABLE "Categoria" ADD COLUMN "computador" BOOLEAN NOT NULL DEFAULT false;

UPDATE "Categoria"
SET "computador" = true
WHERE "controle" = 'ITEM' AND "nome" ILIKE '%notebook%';

ALTER TABLE "Item" ADD COLUMN "processador" TEXT;
ALTER TABLE "Item" ADD COLUMN "memoriaGb" INTEGER;
ALTER TABLE "Item" ADD COLUMN "armazenamentoGb" INTEGER;

-- Numero de serie e hostname sempre em maiusculas.
UPDATE "Item" SET "patrimonio" = UPPER("patrimonio") WHERE "patrimonio" <> UPPER("patrimonio");
