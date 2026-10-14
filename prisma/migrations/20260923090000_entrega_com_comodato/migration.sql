-- Entrega definitiva com termo de comodato.
--
-- A entrega de equipamento a um colaborador passa a gerar comodato no D4Sign,
-- como o emprestimo. Em vez de uma estrutura paralela, ela vira uma cessao da
-- modalidade DEFINITIVA: mesmo termo, mesma fila, mesmo comprovante de
-- devolucao - sem prazo e sem cobranca.

CREATE TYPE "ModalidadeCessao" AS ENUM ('TEMPORARIA', 'DEFINITIVA');

ALTER TABLE "Emprestimo"
  ADD COLUMN "modalidade" "ModalidadeCessao" NOT NULL DEFAULT 'TEMPORARIA';

-- A entrega nao tem prazo.
ALTER TABLE "Emprestimo" ALTER COLUMN "dataPrevista" DROP NOT NULL;

-- E-mail proprio para a entrega (o texto padrao e criado pelo sistema ao subir).
ALTER TYPE "TipoTemplate" ADD VALUE 'CONFIRMACAO_ENTREGA';

-- Nota fiscal e fornecedor sairam do cadastro: a TI nao tem as notas a mao e
-- os campos ficavam sempre vazios.
ALTER TABLE "Item" DROP COLUMN "fornecedor";
ALTER TABLE "Item" DROP COLUMN "notaFiscal";

-- O e-mail de devolucao serve agora para qualquer equipamento, nao so
-- notebook. So muda o texto padrao; um texto editado pela TI fica como esta.
UPDATE "TemplateEmail"
SET "corpo" = REPLACE("corpo", 'devolução do notebook', 'devolução do equipamento'),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "chave" = 'DEVOLUCAO_CONFIRMADA' AND "updatedBy" IS NULL;
