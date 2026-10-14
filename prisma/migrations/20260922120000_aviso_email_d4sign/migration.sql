-- Conferencia do envio do convite de assinatura do D4Sign.
ALTER TABLE "Emprestimo" ADD COLUMN "d4signAvisoEmail" TEXT;
ALTER TABLE "Emprestimo" ADD COLUMN "d4signEmailConferido" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Emprestimo" ADD COLUMN "d4signConferirEmailEm" TIMESTAMP(3);

-- Termos ja enviados e ainda nao assinados: conferir o e-mail na proxima rodada.
UPDATE "Emprestimo"
SET "d4signConferirEmailEm" = NOW()
WHERE "status" = 'AGUARDANDO_ASSINATURA' AND "d4signEtapa" = 'ENVIADO';
