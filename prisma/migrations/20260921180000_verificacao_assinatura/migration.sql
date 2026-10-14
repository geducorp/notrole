-- Controle fino da integracao com o D4Sign.
--
-- O D4Sign e usado pela empresa inteira e cobra por documento. Estas colunas
-- existem para que o Notrole use o minimo possivel.

-- d4signVerificadoEm: quando o sistema perguntou pela ultima vez se o termo foi
-- assinado. O Notrole so e acessivel dentro da rede da empresa, entao o webhook
-- do D4Sign nao chega ate ele - quem pergunta e o Notrole, de forma espacada.
ALTER TABLE "Emprestimo" ADD COLUMN "d4signVerificadoEm" TIMESTAMP(3);

-- d4signEtapa: em que passo a geracao do termo parou (CRIADO, SIGNATARIO,
-- ENVIADO). Garante que uma nova tentativa retome de onde parou em vez de criar
-- um segundo documento, que seria cobrado de novo.
ALTER TABLE "Emprestimo" ADD COLUMN "d4signEtapa" TEXT;
