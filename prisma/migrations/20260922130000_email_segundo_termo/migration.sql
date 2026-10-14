-- O e-mail de confirmacao passa a avisar que o colaborador vai receber um
-- segundo e-mail, do D4Sign, com o termo para assinar ({instrucoes_termo}).
-- So altera o texto padrao; um texto editado pela TI nao e sobrescrito.
UPDATE "TemplateEmail" SET "updatedAt" = CURRENT_TIMESTAMP,
"corpo" = 'Olá, {nome}!

Confirmamos a retirada do notebook {hostname} ({modelo}), patrimônio {patrimonio}, no setor de T.I.

Data do empréstimo: {data_emprestimo}
Data prevista para devolução: {data_prevista}

{instrucoes_termo}

Você é responsável pelo equipamento durante o período do empréstimo. Se precisar de mais prazo, procure a T.I antes do vencimento.

Atenciosamente,
Equipe de T.I'
WHERE "chave" = 'CONFIRMACAO_EMPRESTIMO' AND "updatedBy" IS NULL;
