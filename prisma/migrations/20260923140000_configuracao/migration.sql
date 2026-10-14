-- Ajustes feitos pela tela de Configuracoes. O primeiro e o botao que pausa a
-- integracao com o D4Sign sem precisar editar o .env e reiniciar o servidor.
CREATE TABLE "Configuracao" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Configuracao_pkey" PRIMARY KEY ("chave")
);
