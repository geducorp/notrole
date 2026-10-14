-- Comprovante de devolucao e textos dos e-mails com acentuacao.

-- Quem recebeu o equipamento: aparece no comprovante de devolucao em PDF que o
-- colaborador recebe por e-mail. A secao de devolucao saiu do termo de
-- comodato, porque o documento assinado no D4Sign fica lacrado e nao da para
-- preenche-la depois; o comprovante e o que o colaborador guarda.
ALTER TABLE "Emprestimo" ADD COLUMN "devolucaoRecebidaPorNome" TEXT,
ADD COLUMN "devolucaoRecebidaPorEmail" TEXT,
-- Observacao feita na devolucao, que vai no comprovante. Antes ela sobrescrevia
-- "observacoes", que e anotacao interna do emprestimo e nao deve chegar ao
-- colaborador.
ADD COLUMN "observacoesDevolucao" TEXT;

-- Os textos padrao dos e-mails foram gravados sem acento ("Ola", "devolucao").
-- Corrige so os que ninguem editou pela tela de Configuracoes (updatedBy nulo):
-- um texto ajustado pela TI nao e sobrescrito.

UPDATE "TemplateEmail" SET "updatedAt" = CURRENT_TIMESTAMP,
"assunto" = 'Confirmação de empréstimo de notebook - {hostname}',
"corpo" = 'Olá, {nome}!

Confirmamos a retirada do notebook {hostname} ({modelo}), patrimônio {patrimonio}, no setor de T.I.

Data do empréstimo: {data_emprestimo}
Data prevista para devolução: {data_prevista}

Você é responsável pelo equipamento durante o período do empréstimo. Se precisar de mais prazo, procure a T.I antes do vencimento.

Atenciosamente,
Equipe de T.I'
WHERE "chave" = 'CONFIRMACAO_EMPRESTIMO' AND "updatedBy" IS NULL;

UPDATE "TemplateEmail" SET "updatedAt" = CURRENT_TIMESTAMP,
"assunto" = 'Lembrete: devolução do notebook {hostname} vence amanhã',
"corpo" = 'Olá, {nome}!

Este é um lembrete de que o prazo para devolução do notebook {hostname} ({modelo}) vence em {data_prevista}.

Por favor, compareça à T.I para devolver o equipamento ou solicitar a prorrogação do prazo.

Atenciosamente,
Equipe de T.I'
WHERE "chave" = 'LEMBRETE_PREVIO' AND "updatedBy" IS NULL;

UPDATE "TemplateEmail" SET "updatedAt" = CURRENT_TIMESTAMP,
"assunto" = '[AVISO] Devolução de notebook em atraso - {dias_atraso} dia(s)',
"corpo" = 'Olá, {nome}!

Consta em nosso sistema que o prazo de devolução do notebook {hostname} ({modelo}) expirou em {data_prevista}, há {dias_atraso} dia(s).

Por favor, dirija-se ao setor de T.I o mais rápido possível para realizar a devolução ou solicitar a renovação do prazo.

Se você já devolveu o equipamento, desconsidere este aviso.

Atenciosamente,
Equipe de T.I'
WHERE "chave" = 'COBRANCA_ATRASO' AND "updatedBy" IS NULL;

UPDATE "TemplateEmail" SET "updatedAt" = CURRENT_TIMESTAMP,
"assunto" = 'Devolução registrada - {hostname}',
"corpo" = 'Olá, {nome}!

Registramos a devolução do notebook {hostname} ({modelo}) em {data_devolucao}.

O comprovante de devolução segue em anexo. Guarde este e-mail: ele comprova que o equipamento foi devolvido.

Obrigado pelo cuidado com o equipamento.

Atenciosamente,
Equipe de T.I'
WHERE "chave" = 'DEVOLUCAO_CONFIRMADA' AND "updatedBy" IS NULL;
