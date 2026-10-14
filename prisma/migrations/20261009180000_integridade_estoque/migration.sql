-- Integridade do estoque (09/10/2026).
--
-- 1. O extrato de um equipamento nao pode sumir junto com ele. A FK
--    Movimentacao -> Item era ON DELETE CASCADE: excluir um item apagava todo o
--    historico de quem esteve com ele. Agora e RESTRICT; o ItemService so
--    permite excluir item que tem apenas ENTRADA/CONTAGEM_INICIAL e apaga essas
--    linhas explicitamente, na mesma transacao, antes do item.
ALTER TABLE "Movimentacao" DROP CONSTRAINT "Movimentacao_itemId_fkey";
ALTER TABLE "Movimentacao" ADD CONSTRAINT "Movimentacao_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. No maximo UMA cessao em aberto por equipamento. A reserva condicional do
--    item (updateMany com situacao no where) ja impede a disputa; este indice e
--    a ultima trava, no banco. "Em aberto" = STATUS_EM_ABERTO do
--    EmprestimoRepository (AGUARDANDO_ASSINATURA, ATIVO).
--    ATENCAO: indice parcial nao e representavel no schema.prisma. Se alguem
--    rodar `prisma migrate dev`, o Prisma vai propor um DROP deste indice na
--    migracao gerada - remova essa linha antes de aplicar.
CREATE UNIQUE INDEX "Emprestimo_itemId_em_aberto_key"
  ON "Emprestimo"("itemId")
  WHERE "status" IN ('AGUARDANDO_ASSINATURA', 'ATIVO');

-- 3. Saldo de item por quantidade nunca negativo (a saida ja confere no
--    update condicional; isto e a trava no banco).
ALTER TABLE "ItemQuantidade"
  ADD CONSTRAINT "ItemQuantidade_quantidade_nao_negativa" CHECK ("quantidade" >= 0);
