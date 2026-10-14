-- Local de estoque saiu: cada empresa tem um estoque so, entao a empresa ja
-- diz onde o equipamento esta. O campo so pedia informacao repetida.

ALTER TABLE "Item" DROP CONSTRAINT IF EXISTS "Item_localId_fkey";
ALTER TABLE "Item" DROP COLUMN "localId";

ALTER TABLE "ItemQuantidade" DROP CONSTRAINT IF EXISTS "ItemQuantidade_localId_fkey";
ALTER TABLE "ItemQuantidade" DROP COLUMN "localId";

ALTER TABLE "Movimentacao" DROP COLUMN "localOrigemId";
ALTER TABLE "Movimentacao" DROP COLUMN "localDestinoId";

DROP TABLE "Local";
