-- Progresso da assinatura: quantos dos signatarios ja assinaram.
-- O documento so fica "assinado" quando todos assinam (colaborador e
-- testemunha), e sem mostrar o parcial parecia que a assinatura tinha falhado.
ALTER TABLE "Emprestimo" ADD COLUMN "d4signAssinados" INTEGER;
ALTER TABLE "Emprestimo" ADD COLUMN "d4signSignatarios" INTEGER;
