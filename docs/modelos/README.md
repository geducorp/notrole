# Modelo do termo de comodato

`termo-comodato-emprestimo.docx` é o contrato que o Notrole preenche e envia ao
D4Sign para assinatura: um instrumento particular de comodato de equipamento
para colaborador pessoa física, sem a seção final "Termo de devolução".

> **Modelo de exemplo.** O texto é um ponto de partida genérico. Antes de usar,
> revise as cláusulas com o jurídico da sua empresa. O foro sai como a cidade
> da sede da empresa comodante (campo `Cidade da Empresa`).

## Por que a seção de devolução saiu

Ela era para ser preenchida à mão, no papel, na hora da devolução. No fluxo
digital isso não tem como acontecer: depois que o colaborador assina no D4Sign,
o documento fica lacrado e ninguém consegue voltar nele para escrever a data e
assinar. A seção ficaria em branco para sempre.

A devolução é registrada no Notrole, que envia ao colaborador um e-mail com o
**comprovante de devolução em PDF** anexado - esse é o documento que ele guarda
para provar que devolveu. Retirar a seção também fez o contrato preenchido
voltar a caber numa página.

## Quem preenche é o Notrole, não o D4Sign

O plano inicial era cadastrar este arquivo como modelo no D4Sign e deixar o
motor de modelos deles preencher os campos. Nos testes, o D4Sign
preenchia sempre a tabela de itens e a cidade/data, e deixava **em branco**
todo o resto: dados da empresa, do colaborador, motivo, data de devolução e
testemunha. Foram descartados, um a um: formato do corpo da requisição, grafia
das chaves, negrito, posição do campo no texto e a opção "Obrigatório" do
modelo. A causa não foi encontrada.

Por isso o Notrole passou a preencher o contrato ele mesmo
(`src/api/services/ContratoService.ts`) e a enviar o documento pronto ao
D4Sign (`uploadbinary`). O D4Sign só recolhe as assinaturas. O custo é o mesmo:
subir um documento não consome o pacote; o envio para assinatura conta 1.

Vantagens de ter saído do motor do D4Sign:

- a formatação do Word é respeitada (campo em negrito sai em negrito);
- o contrato é conferido **antes** de ir para o D4Sign: se qualquer campo
  ficar sem valor, o documento não é gerado;
- o modelo fica versionado junto com o código, e não só dentro do D4Sign.

## Como editar o contrato

1. Abra este arquivo no Word e edite normalmente.
2. Os campos são escritos como `${“Nome do Campo”}`. Pode formatar (negrito,
   itálico) à vontade.
3. Salve por cima deste arquivo, com o mesmo nome.
4. Na pasta do projeto, confira: `npx tsx scripts/d4sign-teste-contrato.ts`
   gera `teste-contrato.docx` preenchido com dados de exemplo. Abra e confira.
5. Faça o deploy.

Os documentos não guardam metadados de autoria (`docProps`) nem propriedades
de SharePoint: se editar no Word, confira em Arquivo > Informações >
Inspecionar documento antes de versionar.

Se você **criar um campo novo**, o Notrole precisa saber o que colocar nele —
senão ele se recusa a gerar o contrato, de propósito. Peça para incluir o campo
em `TermoService.montarCamposDoTermo`.

## Campos

| No Word | De onde vem |
|---|---|
| Nome da Empresa | Razão social da empresa (Configurações > Empresas) |
| CNPJ da Empresa | CNPJ da empresa |
| Endereço da Empresa | Rua, número e bairro + cidade da empresa |
| UF da Empresa | Sigla do estado da empresa |
| CEP da Empresa | CEP da empresa |
| Cidade da Empresa | Cidade da sede (usada como foro do contrato) |
| Nome do Usuário | Nome do colaborador, vindo do AD |
| CPF do Usuário | Informado na retirada; fica salvo no cadastro |
| Endereço do Usuário | Informado na retirada; fica salvo no cadastro |
| Motivo do Emprestimo | Informado no formulário de empréstimo |
| Item1 | "Notebook" + modelo (ex: "Notebook Latitude 5420") |
| Marca1 | Marca do notebook (ex: "Dell") |
| Patrimônio1 | Patrimônio / Service Tag |
| Valor1 | Valor do notebook (cadastro do notebook) |
| Item2 | Acessórios, quando houver (ex: "Carregador, Mouse"); em branco se não |
| Marca2, Patrimônio2, Valor2 | "-" quando há acessórios; em branco se não |
| Data de Devolucao | Prazo do empréstimo |
| Cidade, Estado, Data | Cidade/UF da empresa + data por extenso |
| Nome Testemunha | Analista logado que registrou o empréstimo. Sai como "REGISTRADO NO NOTROLE POR:", sem linha de assinatura; o analista não é signatário no D4Sign (ver ROADMAP.md). O nome do campo ficou o mesmo para não mexer no preenchimento. |


## Modelo da entrega definitiva

`termo-comodato-entrega.docx` é o comodato por prazo indeterminado, usado quando um
equipamento é entregue em definitivo a um colaborador (sem prazo de devolução).
Tem os mesmos campos do modelo do empréstimo, menos motivo e prazo. Como no outro,
a seção "Termo de devolução" não existe: a
devolução gera o comprovante em PDF. O Notrole escolhe o modelo pela modalidade da
cessão (empréstimo ou entrega).
