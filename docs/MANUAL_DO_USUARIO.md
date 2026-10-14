# Notrole — Manual do Analista

**Controle do estoque de TI, empréstimos e entregas com termo de comodato**

| | |
|---|---|
| **Versão** | 2.0 — 14/10/2026 |
| **Para quem** | Analistas de TI da empresa que usa o Notrole |
| **Endereço** | o definido pela sua TI (ex.: https://notrole.exemplo.com.br) |
| **Pré-requisitos** | Conta Microsoft corporativa no grupo do Notrole no AD e o campo "Empresa" preenchido no seu perfil do AD |

> **Exemplos.** Nomes de empresas e pessoas citados neste manual ("Empresa
> Exemplo A", "Ana Exemplo da Silva") são fictícios.

---

## Sumário

1. [O que é o Notrole e o que dá para fazer](#1-o-que-é-o-notrole-e-o-que-dá-para-fazer)
2. [Acesso](#2-acesso)
3. [Conhecendo a tela e o Dashboard](#3-conhecendo-a-tela-e-o-dashboard)
4. [Estoque](#4-estoque)
5. [Empréstimos](#5-empréstimos)
6. [Entregas](#6-entregas)
7. [Colaboradores](#7-colaboradores)
8. [Configurações](#8-configurações)
9. [Situações e cores](#9-situações-e-cores)
10. [Perguntas frequentes e problemas comuns](#10-perguntas-frequentes-e-problemas-comuns)
11. [Boas práticas](#11-boas-práticas)
12. [Suporte](#12-suporte)

---

## 1. O que é o Notrole e o que dá para fazer

O Notrole é o sistema da TI para saber **o que a empresa tem, onde está e com
quem está**. Com ele você:

- cadastra os equipamentos e periféricos que chegam;
- empresta equipamentos com prazo de devolução (e o sistema lembra e cobra o
  colaborador sozinho);
- entrega equipamentos em definitivo para o trabalho do dia a dia;
- manda o **termo de comodato** para o colaborador assinar pelo D4Sign, sem papel;
- registra devoluções, manutenções, transferências e baixas;
- tira relatórios em PDF e planilhas em Excel.

Tudo o que alguém faz fica registrado no **extrato** do equipamento, com data,
hora e o nome de quem fez.

### Glossário rápido

| Termo | O que quer dizer |
|---|---|
| **Equipamento** | Item controlado **um a um**, pelo número de série (patrimônio). Ex.: notebook, monitor, celular, impressora. |
| **Periférico** | Item controlado **por quantidade** (saldo na prateleira). Ex.: headset, adaptador, kit teclado e mouse, carregador, memória. |
| **Patrimônio** | O número de série do fabricante (Service Tag). É ele que vai no termo e que identifica o equipamento. |
| **Hostname** | O nome do notebook na rede (ex.: N-EXEMPLO01). Só existe para notebook. |
| **Empréstimo** | Cessão **temporária**, com data prevista de devolução. Tem lembrete e cobrança automática por e-mail. |
| **Entrega** | Cessão **definitiva**, para o colaborador usar no trabalho. Não tem prazo, lembrete nem cobrança. |
| **Termo de comodato** | O contrato que o colaborador assina eletronicamente pelo D4Sign ao receber o equipamento. Só o colaborador assina. |
| **D4Sign** | O serviço de assinatura eletrônica usado pelo Notrole. |
| **Baixa** | Tirar o equipamento de circulação (descarte, perda, venda). O histórico continua guardado. |
| **Excluir** | Apagar o cadastro de vez. Só serve para equipamento cadastrado por engano e sem histórico. |
| **Extrato** | A lista de tudo o que aconteceu com um equipamento, do cadastro até hoje. |

---

## 2. Acesso

### 2.1 Quem pode entrar

- Só entra quem está no **grupo do Notrole no AD** (Active Directory). Se a
  sua conta não estiver no grupo, aparece a tela **"Acesso negado — Você não
  está no grupo autorizado do Notrole. Fale com a TI."**
- Os **administradores** do Notrole (grupo de administradores no AD) veem todas as
  empresas e cuidam das configurações.
- O **analista** vê e movimenta **só o que é da empresa dele**. A empresa é
  lida do campo **"Empresa"** do seu perfil no AD (ex.: "Empresa Exemplo A").

### 2.2 Como entrar

1. Abra o navegador (Edge ou Chrome) e acesse o endereço do Notrole informado pela TI.
2. Clique em **Entrar com a conta Microsoft**.
3. Escolha (ou digite) a sua conta corporativa e conclua o login da Microsoft
   como de costume.
4. Pronto: o Notrole abre no **Dashboard**.

> Você não cria senha no Notrole. O login é sempre o da sua conta Microsoft.

### 2.3 A sua empresa e o que você enxerga

Depois do login, tudo o que aparece já vem filtrado pela sua empresa:
equipamentos, periféricos, empréstimos, entregas, colaboradores, dashboard,
relatórios em PDF e planilhas em Excel. Por isso **não existe filtro de
empresa** na tela do analista (só o administrador tem).

Você confere o seu perfil em **Configurações > Acesso** (ver a
[seção 8](#8-configurações)).

### 2.4 Apareceu "Empresa não identificada"

Essa tela quer dizer que o seu perfil no AD está **sem o campo "Empresa"**, e o
Notrole não sabe qual estoque mostrar. O que fazer:

1. Peça à **equipe de infraestrutura** para preencher o campo **Empresa** do
   seu usuário no AD (com o nome da empresa, como cadastrado no Notrole).
2. Depois de preenchido, espere alguns minutos (pode levar até uns 10 minutos
   para o Notrole perceber a mudança).
3. Clique em **Tentar de novo**. Se ainda não funcionar, clique em **Sair** e
   entre de novo.

### 2.5 Sair

1. No canto inferior esquerdo, ao lado do seu nome, clique no ícone de **sair**
   (seta saindo da porta).
2. Você volta para a tela de login.

### 2.6 Tema claro ou escuro

1. No canto inferior esquerdo, em **TEMA**, clique em **Claro** ou **Escuro**.
2. A escolha fica guardada no seu navegador.

---

## 3. Conhecendo a tela e o Dashboard

### 3.1 Menu lateral e cabeçalho

- **Menu lateral (esquerda):** Dashboard, Estoque, Empréstimos, Entregas,
  Colaboradores e Configurações. O item em destaque é a tela aberta.
- **Embaixo do menu:** a escolha de tema e o seu nome, com o perfil e a empresa
  (ex.: "Analista · Empresa Exemplo A"), e o botão de sair.
- **Topo de cada tela:** o título, uma frase explicando a tela e os botões
  principais (ex.: **Novo equipamento**, **Relatório**, **Exportar para Excel**).
- **Avisos:** as mensagens de sucesso e de erro aparecem por alguns segundos
  num canto da tela.

### 3.2 Dashboard — aba Estoque

O Dashboard é o resumo da sua empresa. Na aba **Estoque** você vê:

- **Em estoque:** quantos equipamentos estão guardados na TI (e quantos estão
  cadastrados no total).
- **Com colaboradores:** quantos estão entregues e quantos estão emprestados.
- **Em manutenção.**
- **Valor em estoque:** a soma do valor dos equipamentos guardados.
- **Estoque baixo** (aviso amarelo): periféricos que chegaram ao estoque mínimo.
- Gráficos: **Equipamentos por categoria**, **Situação dos equipamentos** e
  **Equipamentos por setor** (o que está com as pessoas de cada setor).
- No canto, a lista **Todos os equipamentos** filtra os números por tipo
  (Notebooks, Monitores...).

### 3.3 Dashboard — aba Empréstimos

- **Em aberto:** empréstimos ativos, e quantos equipamentos estão livres para emprestar.
- **Aguardando assinatura:** termos enviados que o colaborador ainda não assinou.
- **Devoluções atrasadas:** empréstimos com o prazo vencido (o sistema cobra por e-mail).
- **Vencendo em 7 dias.**
- **Empréstimos por departamento:** contagem do ano (só empréstimos com prazo, não entregas).

### 3.4 Exportar para Excel

1. No Dashboard, escolha a aba (**Estoque** ou **Empréstimos**).
2. Clique em **Exportar para Excel** (canto superior direito).
3. O navegador baixa um arquivo `.xlsx` com uma aba de **Resumo** e as listas
   detalhadas — só da sua empresa.

---

## 4. Estoque

O **Estoque** mostra só o que está **com a TI**: equipamentos **em estoque**,
**reservados** e **em manutenção**. O que está com colaboradores
(**entregue** ou **emprestado**) não aparece aqui: fica em **Entregas** e
**Empréstimos**. Equipamentos baixados também ficam fora das listas (ver 4.10).

No topo há três botões: **Contagem inicial**, **Relatório** e **Novo
equipamento** (na aba Periféricos, **Novo periférico**).

### 4.1 Visão geral

A **Visão geral** lista todos os equipamentos que estão com a TI, de todos os
tipos, com: equipamento, patrimônio, empresa, condição (Novo/Usado), situação e
valor. Se algum periférico estiver abaixo do mínimo, aparece o aviso amarelo
**Estoque baixo**.

### 4.2 Abas por tipo de equipamento

- Cada **tipo principal** de equipamento (Notebook, Monitor, Celular,
  Impressora...) ganha **uma aba própria**. A aba **aparece sozinha** quando o
  primeiro equipamento daquele tipo é cadastrado.
- O número ao lado do nome da aba é quantos estão com a TI agora.
- As outras abas são **Periféricos** (4.11), **Por setor** (4.12) e
  **Movimentações** (4.13).

### 4.3 Buscar

1. Clique na caixa **Hostname, série ou modelo...**.
2. Digite parte do hostname, do patrimônio (número de série) ou do modelo.
3. A lista se filtra enquanto você digita. Para voltar a ver tudo, apague o texto.

> A busca vale só para a aba aberta. Ao trocar de aba, ela é limpa.

### 4.4 Ficha do equipamento

**Para abrir:** clique na linha do equipamento em qualquer lista do Estoque. Ela
também abre pelo **nome do equipamento** (em azul) nas telas de Empréstimos e
Entregas.

A ficha mostra:

- as etiquetas de **situação**, **condição** e, se for o caso, **Para empréstimo**;
- se estiver com alguém, um quadro azul dizendo **com quem**, desde quando e a
  situação do termo;
- hostname (só notebook), patrimônio, empresa, valor e data de entrada;
- as observações do cadastro;
- o **Extrato**: tudo o que aconteceu, do mais novo para o mais antigo.

Os botões no rodapé mudam conforme a situação:

| Situação do equipamento | Botões |
|---|---|
| Em estoque | Editar, Excluir, **Entregar**, **Transferir**, **Manutenção**, **Baixa** |
| Em manutenção | Editar, Excluir, **Voltou da manutenção**, **Baixa** |
| Emprestado ou entregue | Editar, **Receber de volta** |
| Baixado | Editar, Excluir |

> Se o equipamento for de **outra empresa**, a ficha mostra só a frase "só um
> analista dela pode movimentar", sem botões.

### 4.5 Cadastrar um equipamento

1. Em **Estoque**, clique em **Novo equipamento** (fora da aba Periféricos).
2. Preencha os campos:

| Campo | Como preencher |
|---|---|
| **Categoria** \* | O tipo: Notebook, Monitor, Celular... |
| **Empresa** \* | Já vem travada na sua empresa ("Você cadastra no estoque da sua empresa"). |
| **Marca** \* | Ex.: Dell. |
| **Modelo** \* | Ex.: Latitude 5440. |
| **Patrimônio (número de série)** \* | A Service Tag do fabricante. Vai no termo de comodato e é por ela que o equipamento é conferido. Não pode repetir. |
| **Hostname** | Só aparece para notebook: o nome na rede (ex.: NB-EMPRESTIMO-01). |
| **Condição** | **Novo** ou **Usado**. |
| **Valor** | Valor do equipamento em reais. **Obrigatório para mandar termo de comodato**: sem valor, o empréstimo/entrega com termo não sai. |
| **Data de entrada** | Já vem com a data de hoje; mude se ele chegou em outro dia. |
| **Observações** | Opcional. |
| **Disponível para empréstimo** | Marque se o equipamento pode ser **emprestado com prazo**. Só os marcados aparecem na lista do **Novo empréstimo**. Para **entrega** isso não importa: qualquer equipamento em estoque pode ser entregue. |

3. Clique em **Salvar**. Aparece "Equipamento cadastrado" e o extrato já
   começa com **Entrada no estoque**.

### 4.6 Editar um equipamento

1. Abra a ficha do equipamento (4.4).
2. Clique em **Editar**.
3. Corrija o que precisar e clique em **Salvar**.

> A **empresa** não muda pela edição: para isso use **Transferir** (4.7).

### 4.7 Transferir para outra empresa

Use quando o equipamento passa, de verdade, para o estoque de outra empresa.

1. Abra a ficha de um equipamento **em estoque**.
2. Clique em **Transferir**.
3. Em **Empresa de destino**, escolha a empresa.
4. Se quiser, escreva uma **Observação** (vai para o extrato).
5. Clique em **Confirmar**.

> **Atenção:** depois da transferência o equipamento passa a ser da outra
> empresa e **some das suas listas**. Só um analista da empresa de destino (ou
> o administrador) consegue movimentá-lo. O histórico de empréstimos e
> entregas vai junto com o equipamento.

### 4.8 Manutenção (envio e retorno)

**Enviar para manutenção:**

1. Abra a ficha de um equipamento **em estoque**.
2. Clique em **Manutenção**.
3. Descreva o problema em **Observação** (opcional, mas ajuda muito).
4. Clique em **Confirmar**. A situação passa a **Manutenção** (etiqueta laranja).

**Quando ele voltar:**

1. Abra a ficha do equipamento (ele continua na lista do Estoque, como Manutenção).
2. Clique em **Voltou da manutenção**.
3. Escreva uma observação, se quiser, e clique em **Confirmar**. Ele volta a
   ficar **Em estoque**.

> Um equipamento devolvido **com avaria** num empréstimo ou entrega também vai
> direto para **Manutenção** (ver 5.9).

### 4.9 Dar baixa

Use quando o equipamento **sai de circulação** de verdade: descarte, perda,
roubo, venda.

1. Abra a ficha de um equipamento **em estoque** ou **em manutenção**.
2. Clique em **Baixa**.
3. Escreva o **Motivo da baixa** (obrigatório).
4. Clique em **Confirmar** (botão vermelho).

O equipamento sai das listas, mas **o histórico continua guardado** (ver 4.10).

### 4.10 Excluir e equipamentos baixados

**Excluir** apaga o cadastro **de vez** e **não dá para desfazer**. Serve só
para equipamento **cadastrado por engano**, que ainda não tem nada no extrato
além da entrada.

1. Abra a ficha do equipamento.
2. Clique em **Excluir** (vermelho).
3. Se o equipamento não tiver histórico, confirme em **Excluir de vez**.
4. Se ele **já tiver histórico** (empréstimo, entrega, manutenção...), o
   Notrole não deixa excluir: a janela explica o motivo e oferece o botão
   **Dar baixa**, que guarda o histórico.

> Na dúvida, **prefira a baixa**. Excluir apagaria o registro de quem esteve
> com o equipamento.

**Ver os equipamentos baixados:**

1. Em **Estoque > Visão geral**, desça até o fim da lista.
2. Clique no link discreto **Ver equipamentos baixados (N)**.
3. Clique em um deles para abrir a ficha e ver o extrato.
4. Para voltar, clique em **Voltar ao estoque**.

### 4.11 Periféricos (controle por quantidade)

Periféricos são controlados pelo **saldo** (quantos há na prateleira), e não um
a um. A aba mostra a descrição, a empresa, **Em estoque** (saldo / mínimo), o
valor unitário e os botões **Entrada**, **Saída** e **Ajuste**. Os botões de
categoria (Memória RAM, Headset...) filtram a lista; **Todos** mostra tudo.

> **Estoque mínimo:** quando o saldo chega ao mínimo ou fica abaixo dele, o
> número fica **amarelo** e aparece o aviso **Estoque baixo** no Estoque e no
> Dashboard. É a hora de pedir compra.

#### Cadastrar um periférico

1. Abra a aba **Periféricos** e clique em **Novo periférico**.
2. Preencha:
   - **Descrição** \* (ex.: Kit teclado e mouse Logitech MK270);
   - **Categoria** \* (não muda depois do cadastro);
   - **Empresa** (já vem travada na sua);
   - **Quantidade atual**: conte a prateleira agora;
   - **Estoque mínimo** (opcional): abaixo disto, a tela avisa;
   - **Valor unitário** e **Observações** (opcionais).
3. Clique em **Salvar**.

Para corrigir o cadastro depois, clique na **descrição** do periférico na lista.

#### Entrada (chegou mais)

1. Na linha do periférico, clique em **Entrada**.
2. Informe a **Quantidade** que chegou e, se quiser, uma observação (ex.: número da nota).
3. Clique em **Confirmar**. O saldo aumenta.

#### Saída (saiu da prateleira)

1. Na linha do periférico, clique em **Saída**.
2. Informe a **Quantidade** (não pode passar do disponível) e, se quiser, uma
   observação (ex.: para quem foi).
3. Clique em **Confirmar**. O saldo diminui; ele nunca fica negativo.

#### Ajuste (corrigir o saldo depois de contar)

1. Conte o que há de verdade na prateleira.
2. Na linha do periférico, clique em **Ajuste**.
3. Em **Saldo conferido na prateleira**, informe o número contado.
4. Em **Observação** (obrigatória), explique: conferência, perda, erro de lançamento...
5. Clique em **Confirmar**. O Notrole registra a diferença no extrato.

### 4.12 Por setor

A aba **Por setor** agrupa por departamento os equipamentos que estão **com as
pessoas** (entregues ou emprestados). Para cada pessoa aparece o nome, o e-mail
e os equipamentos; os emprestados levam a marca **emprestado**.

### 4.13 Movimentações

Mostra as **últimas 100 movimentações** da sua empresa, da mais nova para a
mais antiga: entradas, empréstimos, entregas, devoluções, manutenções,
transferências, baixas e ajustes, com data, hora, observação e quem fez.

### 4.14 Contagem inicial (importar uma planilha)

Serve para lançar **de uma vez** o que já está na prateleira (por exemplo, no
primeiro dia de uso).

1. Em **Estoque**, clique em **Contagem inicial**.
2. Em **O que você vai importar**, escolha:
   - **Equipamentos** (um por linha, com número de série); ou
   - **Periféricos** (uma linha por tipo, com o saldo).
3. Clique em **Baixar planilha modelo** e abra o arquivo no Excel.
4. **Apague as duas linhas de exemplo** e preencha uma linha por item:
   - Equipamentos: categoria, empresa, marca, modelo, patrimônio, hostname,
     condição, valor, para_emprestimo (sim/não) e observações;
   - Periféricos: categoria, empresa, descrição, quantidade, estoque_minimo,
     valor_unitario e observações.
   - A **empresa** tem que ser a sua; a **categoria** tem que existir no Notrole.
5. Salve como **CSV** (o Excel pergunta se quer manter o formato: confirme).
6. Volte ao Notrole, clique em **Escolher arquivo** e selecione o CSV.
7. Clique em **Importar**.
8. Confira o resultado: o Notrole diz quantas linhas entraram e mostra, na
   tela, as linhas que ficaram de fora e o motivo (ex.: patrimônio repetido,
   categoria que não existe). Corrija essas linhas e importe só elas de novo.

Cada linha importada ganha no extrato a movimentação **Contagem inicial**.

### 4.15 Relatório em PDF

1. Em **Estoque**, abra a aba que interessa (Visão geral, um tipo, ou
   Periféricos com um filtro de categoria).
2. Clique em **Relatório**.
3. O navegador baixa o PDF `estoque-ti.pdf`, com os mesmos filtros da tela e só
   com a sua empresa.

---

## 5. Empréstimos

O **empréstimo** é a cessão **temporária**, com **data prevista de devolução**.
Exemplo: notebook para uma viagem, ou enquanto o do colaborador está no conserto.

### 5.1 Listar e filtrar

A lista mostra o equipamento, o colaborador (e o departamento), a retirada, o
prazo (e quantas renovações), a situação e os botões de ação.

- **Buscar:** digite hostname, patrimônio, nome ou e-mail do colaborador.
- **Filtrar:** na lista ao lado, escolha **Todos**, **Somente atrasados**,
  **Aguardando assinatura**, **Ativo**, **Devolvido** ou **Cancelado**.
- **Relatório:** baixa o PDF dos empréstimos em aberto.
- Clique no **nome do equipamento** (em azul) para abrir a ficha dele (ver 5.13).

**Botões da coluna Ações** (passe o mouse para ver o nome de cada um):

| Ícone | Nome | Quando aparece |
|---|---|---|
| Relógio | **Ver histórico** | Sempre |
| Documento | **Baixar comprovante de devolução** | Devolvido |
| Calendário | **Renovar prazo** | Ativo |
| Círculo com visto | **Registrar devolução** | Ativo |
| Círculo com X | **Cancelar empréstimo** | Aguardando assinatura ou Ativo |
| Raio | **Ativar sem esperar a assinatura** | Aguardando assinatura |
| Documento com visto | **Verificar assinatura no D4Sign agora** | Termo já enviado ao colaborador |
| Envelope com alerta | **Reenviar convite de assinatura** | Termo já enviado ao colaborador |
| Setas circulares (vermelho) | **Tentar gerar o termo novamente** | Termo com problema |

### 5.2 Novo empréstimo, passo a passo

1. Em **Empréstimos**, clique em **Novo empréstimo**.
2. **Colaborador:** digite pelo menos 3 letras do nome ou do e-mail. O Notrole
   busca no **Active Directory**. Clique na pessoa certa na lista.
   - Se ela já recebeu equipamento antes, **CPF e endereço vêm preenchidos**
     (aparece a faixa verde "CPF e endereço preenchidos com o cadastro anterior.
     Confirme com o colaborador.") e podem aparecer atalhos **Já usou:** com os
     equipamentos que ela usou antes.
   - Para trocar de pessoa, clique no **X** ao lado do nome.
3. **Equipamento:** escolha na lista. Só aparecem equipamentos **em estoque**
   e marcados como **Disponível para empréstimo** (4.5). A lista mostra
   hostname, modelo e valor.
4. **Data prevista de devolução:** escolha a data ou use os atalhos
   **Amanhã**, **7 dias**, **15 dias** ou **30 dias**.
5. **Termo de comodato:** a caixa **Enviar termo de comodato pelo D4Sign** já
   vem marcada. Com ela marcada, preencha:
   - **Empresa (comodante):** fica **travada na empresa do equipamento** — o
     termo sai sempre em nome da empresa dona do equipamento;
   - **Motivo do empréstimo** \* (ex.: "Viagem a trabalho");
   - **CPF** \* do colaborador (o Notrole confere se é válido);
   - **Endereço do colaborador** \* (rua, número, bairro, cidade/UF);
   - **Periféricos emprestados junto** (opcional): clique em **Carregador**,
     **Mouse**, **Mochila** ou escreva em **Outro**. Eles vão escritos no termo.
   - Embaixo aparece **Registrado por: (seu nome)** — o seu nome sai impresso
     no termo. **Só o colaborador assina.**
6. **Observações internas** (opcional): ficam só no Notrole, não vão para o contrato.
7. Clique em **Confirmar empréstimo**.

**Se faltar alguma coisa para o termo** (valor do equipamento, patrimônio, CPF
válido, endereço completo, motivo), o Notrole não deixa confirmar e diz o que
falta ("Faltam dados para o termo..."). Passe o mouse sobre o botão
**Confirmar empréstimo** para ver a lista. Se o equipamento estiver **sem
valor**, aparece um aviso amarelo: cadastre o valor na ficha dele (4.6) e volte.

**Sem termo:** se você desmarcar **Enviar termo de comodato pelo D4Sign**,
nenhum documento é criado: o empréstimo já começa **Ativo** e o colaborador
recebe na hora o e-mail de confirmação. Cada termo gasta 1 envio do pacote do
D4Sign, então use o termo sempre que a política pedir.

Depois de confirmar aparece "Empréstimo registrado — O termo de comodato vai
para o D4Sign em até 5 minutos." O equipamento sai do Estoque na hora (passa a
**Emprestado**), mesmo antes da assinatura.

### 5.3 O que o colaborador recebe e como assina

Quando o termo sai para o D4Sign, o colaborador recebe **dois e-mails**:

1. **Do Notrole:** "Assine o Termo de Comodato - (equipamento)". Explica que é
   o termo do empréstimo (ou da entrega), traz os dados do equipamento e diz
   como assinar.
2. **Do D4Sign:** o **convite de assinatura**, com o botão para abrir o documento.

Para assinar, o colaborador:

1. abre o e-mail do D4Sign e clica no botão para ver o documento;
2. confere os dados e clica para assinar;
3. informa o **código (token)** que o D4Sign manda por e-mail na hora de assinar;
4. conclui a assinatura.

Depois que ele assina, o empréstimo **fica Ativo sozinho** e o colaborador
recebe o e-mail **"Confirmação de empréstimo de equipamento"**.

> Oriente o colaborador a procurar os dois e-mails também na caixa de **spam /
> lixo eletrônico**.

### 5.4 Acompanhar o termo (fila e assinatura)

Enquanto o termo não está assinado, a coluna **Situação** mostra em que pé ele está:

| O que aparece | O que quer dizer | O que fazer |
|---|---|---|
| **Termo na fila** — "Aguardando a próxima rodada da fila (a cada 5 min)." | O termo ainda não foi para o D4Sign. A fila roda a cada 5 minutos. | Esperar. |
| **Termo na fila** — "Aguardando cota do D4Sign. Sai por volta das HH:MM." | O Notrole usa uma cota limitada de chamadas por hora ao D4Sign (cerca de 2 termos por hora). Os termos saem por ordem de chegada; a hora prevista já conta os que estão na frente. | Esperar. Avise o colaborador do horário previsto. |
| **Termo na fila** — "Falha no D4Sign, nova tentativa por volta das HH:MM." | O D4Sign deu erro; o Notrole tenta de novo sozinho. | Esperar. |
| **Aguardando assinatura** — "0 de 1 assinaram" | O convite já foi enviado; falta o colaborador assinar. | Cobrar o colaborador, se demorar. |
| **E-mail não entregue** (vermelho) | O D4Sign não conseguiu entregar o convite (endereço bloqueado na lista de supressão do D4Sign, por exemplo). | Clique em **Reenviar convite** (envelope). Se continuar, fale com o administrador. |
| **Termo com problema** (vermelho) — "Confira o histórico do empréstimo." | O Notrole parou de tentar gerar o termo e pede conferência. | Veja 5.5. |

**O colaborador disse que assinou, mas continua "Aguardando assinatura":**

O Notrole confere as assinaturas sozinho, em horário comercial, mas **sem
pressa** (cada termo é consultado de tempos em tempos, com intervalo de algumas
horas, para economizar a cota do D4Sign). Para não esperar:

1. Clique no botão **Verificar assinatura no D4Sign agora** (documento com visto).
2. O Notrole responde na hora:
   - "Termo assinado! O empréstimo foi ativado." — pronto;
   - "O termo ainda não está concluído." — mostra quantos assinaram;
   - "O e-mail de assinatura não foi entregue." — veja a linha **E-mail não entregue** acima.

**Reenviar o convite:** o botão **Reenviar convite de assinatura** (envelope)
pede ao D4Sign que mande o e-mail de novo. **Não cria outro documento nem gasta
envio do pacote.**

### 5.5 Termo com problema

Quando o Notrole não consegue confirmar se o documento foi criado no D4Sign,
ele **para de tentar sozinho**, para não criar (e pagar) um documento em
duplicidade.

1. Abra o **histórico** do empréstimo (relógio) e leia o motivo.
2. Clique em **Tentar gerar o termo novamente** (setas circulares, vermelho).
3. Leia a pergunta com atenção:
   - Se o Notrole pedir para **conferir o painel do D4Sign** antes, peça ao
     administrador para procurar o documento "Termo de responsabilidade -
     (equipamento) - (colaborador)". Se ele **já existir**, **não** tente de
     novo: use **Ativar sem esperar a assinatura** (5.8).
   - Se não, confirme: o termo volta para a fila, de onde parou.

### 5.6 Histórico

1. Na linha do empréstimo, clique em **Ver histórico** (relógio).
2. Aparece tudo o que aconteceu, em ordem: empréstimo registrado, termo gerado,
   termo assinado, ativado, prazo renovado, lembretes e cobranças enviados,
   devolução ou cancelamento — com data, hora e quem fez ("SISTEMA" quando foi
   automático).

### 5.7 Renovar o prazo

1. Na linha de um empréstimo **Ativo**, clique em **Renovar prazo** (calendário).
2. Em **Novo prazo de devolução**, escolha a data ou use **+7 dias**, **+15 dias**
   ou **+30 dias** (contados a partir do prazo atual).
3. A nova data **precisa ser depois do prazo atual** (o campo abre com o prazo
   atual: mude antes de confirmar).
4. Clique em **Confirmar**. As cobranças de atraso param e o lembrete volta a
   valer para o novo prazo.

### 5.8 Ativar manualmente (sem esperar a assinatura)

Use só em casos especiais (ex.: o termo foi assinado em papel, ou o documento
já existe no D4Sign e não dá para gerar de novo).

1. Na linha do empréstimo **Aguardando assinatura**, clique em **Ativar sem
   esperar a assinatura** (raio).
2. Leia o aviso amarelo: o equipamento passa a constar como em uso **sem a
   assinatura**. Se o termo já foi enviado, ele continua no D4Sign, mas o
   Notrole **deixa de acompanhar**; se ainda não foi, **não será mais enviado**.
3. Clique em **Confirmar**. O colaborador recebe o e-mail de confirmação.

### 5.9 Registrar a devolução

Registre a devolução **na hora em que receber o equipamento**.

1. Na linha do empréstimo **Ativo**, clique em **Registrar devolução** (círculo com visto).
2. Em **Condição do equipamento**, escolha:
   - **Em bom estado** — volta para o estoque como disponível;
   - **Com avaria** — vai para **Manutenção** antes de voltar a uso.
3. Em **Observações da devolução**, escreva o que for importante (ex.: "sem o
   carregador", ou a descrição da avaria). Essa observação **sai no comprovante**
   que o colaborador recebe.
4. Clique em **Confirmar**.

O colaborador recebe por e-mail o **comprovante de devolução** em PDF
("Devolução registrada - (equipamento)"). A situação passa a **Devolvido**.

**Baixar o comprovante depois:** na linha do empréstimo **Devolvido**, clique
em **Baixar comprovante de devolução** (documento). É o mesmo PDF que o
colaborador recebeu.

> A devolução também pode ser feita pela **ficha do equipamento**, no botão
> **Receber de volta** (5.13).

### 5.10 Cancelar um empréstimo

**Cancelar é só para registro errado** (pessoa errada, equipamento errado, o
empréstimo não aconteceu). Se o colaborador **usou e devolveu**, registre a
**devolução** (5.9), e não o cancelamento.

1. Na linha do empréstimo (Aguardando assinatura ou Ativo), clique em
   **Cancelar empréstimo** (círculo com X).
2. Escreva o **Motivo do cancelamento** (obrigatório).
3. Clique em **Cancelar empréstimo** (vermelho). Pode levar alguns segundos,
   porque o Notrole espera a resposta do D4Sign.
4. O equipamento volta a ficar **Em estoque** e o Notrole **cancela o termo no
   D4Sign**.

**Se aparecer um aviso amarelo depois do cancelamento**, o termo **não** foi
cancelado no D4Sign. O aviso explica o caso:

- "O termo já estava assinado no D4Sign e continua válido lá..." — o
  cancelamento vale só no Notrole. Avise o administrador.
- "O termo não foi cancelado no D4Sign (motivo). Cancele o documento (código)
  direto no painel do D4Sign." — peça ao administrador para cancelar o
  documento no painel do D4Sign, informando o código do aviso.

O aviso também fica registrado no **histórico** do empréstimo.

### 5.11 Lembretes e cobranças automáticas

Você não precisa cobrar ninguém por e-mail: o Notrole faz isso sozinho, só para
**empréstimos** (entregas não têm prazo).

| E-mail | Quando sai |
|---|---|
| **Lembrete de vencimento** | Um dia antes do prazo (na sexta-feira, também para os prazos do fim de semana e de segunda). Roda de hora em hora, aos 30 minutos, das 8h às 18h, de segunda a sexta. |
| **Cobrança de atraso** | **Uma vez por dia** enquanto a devolução estiver atrasada. Roda de hora em hora, das 8h às 18h, de segunda a sexta. |

Cada colaborador recebe **no máximo um e-mail de cada tipo por dia**. Os envios
aparecem no **histórico** do empréstimo. Você acompanha as rotinas em
**Configurações > Rotinas** (seção 8).

### 5.12 Atrasado

"Atrasado" não é um status que alguém marca: o Notrole **calcula** sozinho.
Quando o prazo passa e o empréstimo ainda está ativo, a situação aparece em
vermelho como **Atrasado (N dias)**. Use o filtro **Somente atrasados** para
ver todos de uma vez.

### 5.13 Ficha do equipamento a partir do empréstimo

1. Na lista de Empréstimos (ou de Entregas), clique no **nome do equipamento** (em azul).
2. A ficha abre mostrando com quem ele está, desde quando, o prazo e a situação
   do termo, e o extrato.
3. Daqui você pode **Editar** o cadastro ou usar **Receber de volta**, que abre
   a mesma tela de devolução do item 5.9.

---

## 6. Entregas

A **entrega** é a cessão **definitiva**: o equipamento fica com o colaborador
como ferramenta de trabalho, **sem prazo de devolução**, sem lembrete e sem
cobrança. Também tem termo de comodato (modelo próprio para entrega).

| | Empréstimo | Entrega |
|---|---|---|
| Prazo de devolução | Sim | Não |
| Lembrete e cobrança por e-mail | Sim | Não |
| Renovar prazo | Sim | Não |
| Termo de comodato pelo D4Sign | Sim (com motivo) | Sim (sem motivo) |
| Quais equipamentos | Só os marcados "Disponível para empréstimo" | Qualquer um em estoque |
| Situação do equipamento | Emprestado | Entregue |

### 6.1 Lista de entregas

Funciona como a de Empréstimos: busca, filtro de situação, nome do equipamento
clicável (abre a ficha) e os mesmos botões de ação — menos **Renovar prazo**,
que não existe para entrega. A coluna de data é **Entregue em**.

### 6.2 Nova entrega

Você pode começar de dois lugares:

- em **Entregas**, botão **Nova entrega**; ou
- na **ficha** de um equipamento em estoque, botão **Entregar** (o equipamento
  já vem escolhido).

Passo a passo:

1. **Colaborador:** busque no AD por nome ou e-mail (pelo menos 3 letras) e clique na pessoa.
2. **Equipamento:** escolha um equipamento em estoque.
3. Deixe marcado **Enviar termo de comodato pelo D4Sign** e preencha:
   - **Empresa (comodante):** travada na empresa do equipamento;
   - **CPF** \* e **Endereço do colaborador** \*;
   - **Periféricos entregues junto** (Carregador, Mouse, Mochila ou Outro).
4. **Observações internas** (opcional; só no Notrole).
5. Clique em **Confirmar entrega**.

O resto é igual ao empréstimo: o colaborador recebe os dois e-mails (Notrole e
D4Sign), assina, a entrega **fica Ativa sozinha** e ele recebe o e-mail
**"Entrega de equipamento"**. Acompanhe a fila e a assinatura como em 5.4 e 5.5.
Sem termo, a entrega já começa **Ativa**.

### 6.3 Devolução de uma entrega

Use quando o colaborador devolve o equipamento (troca, desligamento, defeito).

1. Na linha da entrega **Ativa**, clique em **Registrar devolução** (círculo com visto).
2. Escolha **Em bom estado** (volta ao estoque) ou **Com avaria** (vai para manutenção).
3. Escreva as observações (saem no comprovante).
4. Clique em **Confirmar**. O colaborador recebe o comprovante por e-mail, que
   também pode ser baixado depois pelo botão **Baixar comprovante de devolução**.

### 6.4 Cancelar uma entrega

Igual ao empréstimo (5.10): **só para registro errado**.

1. Clique em **Cancelar entrega** (círculo com X).
2. Escreva o motivo e clique em **Cancelar entrega**.
3. Se aparecer o **aviso amarelo**, siga a orientação dele (o termo não foi
   cancelado no D4Sign ou já estava assinado).

---

## 7. Colaboradores

### 7.1 Lista

Ninguém precisa ser cadastrado à mão: o colaborador entra no Notrole **sozinho**
no primeiro empréstimo ou entrega, com nome, e-mail, departamento, cargo e
empresa vindos do AD.

A lista mostra as pessoas atendidas pela sua empresa, com departamento, cargo,
CPF (**mascarado**) e o número de empréstimos/entregas. Use a busca por nome,
e-mail ou departamento.

### 7.2 Ficha do colaborador

1. Clique na linha do colaborador.
2. A ficha mostra:
   - departamento, cargo e **Empresa (AD)**;
   - **Dados para o termo de comodato:** CPF e endereço;
   - **Está com esta pessoa:** o que ela tem agora;
   - **Empréstimos e entregas:** o histórico, com a situação de cada um.
3. Para corrigir o **CPF** ou o **endereço**, altere os campos e clique em
   **Salvar dados**. Eles serão usados nos próximos termos.

---

## 8. Configurações

Para o analista, Configurações é uma tela **de consulta**: mostra se as
integrações estão funcionando. **Empresas, categorias do estoque, modelos de
e-mail e o liga/desliga do D4Sign ficam com os administradores.** Clique em
**Detalhes** num cartão para abrir os detalhes; **Fechar** para recolher.

### 8.1 Acesso

Mostra **quem você é** (nome, e-mail), o **perfil** (Analista) e a **empresa**
lida do campo "Empresa" do AD, e a tabela do que o analista e o administrador
podem fazer. Resumo para o analista:

- ver estoque, empréstimos, entregas, colaboradores e dashboard: **só da sua empresa**;
- cadastrar e movimentar equipamentos e periféricos: **só da sua empresa**;
- emprestar, entregar e receber de volta: **só da sua empresa**;
- empresa do termo de comodato: **a do equipamento**;
- importar a planilha de contagem: **só da sua empresa**;
- ver o estado das integrações: **sim**;
- ver os e-mails enviados: **só da sua empresa**;
- ligar/desligar o D4Sign, processar a fila, rodar rotinas, mexer em empresas,
  categorias e modelos de e-mail: **não** (só administrador).

### 8.2 D4Sign

Mostra se a integração está **ligada**, quantos **documentos** saíram no mês,
quantos termos estão **na fila**, quantos **precisam de atenção** e a **cota
restante na hora**. Cada termo usa 3 requisições, e o Notrole se limita a 6
por hora (cerca de 2 termos por hora), para não esgotar a cota da empresa.

> Se a integração estiver **pausada**, os termos novos ficam na fila e só saem
> quando um administrador religar. O formulário de empréstimo/entrega avisa isso.

### 8.3 Rotinas

Mostra o **Lembrete de vencimento** e a **Cobrança de atraso** (ver 5.11): a
última execução, o resultado ("Ninguém em atraso", por exemplo) e a próxima.

### 8.4 E-mail

Mostra o **remetente** dos e-mails do Notrole, o **servidor**, o botão **Testar
conexão** e os **últimos e-mails enviados** da sua empresa. Um círculo verde
quer dizer enviado; um **X vermelho** quer dizer que aquele envio falhou, com o
erro embaixo. O cartão mostra quantas falhas houve.

> O Notrole tenta enviar cada e-mail até 3 vezes antes de marcar falha. Se vir
> falhas repetidas, avise o administrador.

---

## 9. Situações e cores

### 9.1 Situação do equipamento

| Situação | Cor | O que quer dizer | Onde aparece |
|---|---|---|---|
| **Em estoque** | Verde | Guardado na TI, livre para uso. | Estoque |
| **Reservado** | Violeta | Separado, mas ainda com a TI. | Estoque |
| **Emprestado** | Azul | Com um colaborador, em empréstimo com prazo (inclusive enquanto o termo espera assinatura). | Empréstimos |
| **Entregue** | Índigo | Com um colaborador, em entrega definitiva (inclusive enquanto o termo espera assinatura). | Entregas |
| **Manutenção** | Laranja | Em conserto ou com avaria. | Estoque |
| **Baixado** | Cinza | Fora de circulação (descarte, perda, venda). Histórico guardado. | Estoque > Ver equipamentos baixados |

A **condição** (**Novo** / **Usado**) aparece numa etiqueta só com contorno, ao
lado da situação.

### 9.2 Situação do empréstimo ou da entrega

| Situação | Cor | O que quer dizer |
|---|---|---|
| **Termo na fila** | Laranja | O termo ainda não foi para o D4Sign (fila ou cota). |
| **Aguardando assinatura** | Laranja | O convite foi enviado; falta o colaborador assinar. |
| **E-mail não entregue** | Vermelho | O convite do D4Sign não chegou ao colaborador. |
| **Termo com problema** | Vermelho | O Notrole parou de tentar gerar o termo; precisa de conferência. |
| **Ativo** | Azul | O equipamento está com o colaborador, valendo. |
| **Atrasado (N dias)** | Vermelho | Calculado: empréstimo ativo com o prazo vencido. Não existe em entregas. |
| **Devolvido** | Verde | O equipamento voltou. Tem comprovante. |
| **Cancelado** | Cinza | O registro foi cancelado (era um erro). |

---

## 10. Perguntas frequentes e problemas comuns

**O colaborador diz que o convite do D4Sign não chegou.**

1. Veja a **Situação** na lista:
   - **Termo na fila** — o termo ainda não saiu. Leia a linha embaixo: pode ser
     a próxima rodada (até 5 minutos) ou a **cota do D4Sign** ("Sai por volta
     das HH:MM"). Não é erro; é só esperar.
   - **Aguardando assinatura** — o convite foi enviado. Peça para o colaborador
     procurar na caixa de **spam / lixo eletrônico** um e-mail do D4Sign e o
     e-mail "Assine o Termo de Comodato" do Notrole. Se não achar, use
     **Reenviar convite** (não gasta envio do pacote).
   - **E-mail não entregue** (vermelho) — o endereço pode estar na lista de
     supressão do D4Sign. Tente **Reenviar convite**; se não resolver, fale com
     o administrador (o suporte do D4Sign precisa liberar o endereço).

**O colaborador assinou, mas o empréstimo/entrega não ficou Ativo.**
A conferência automática é feita em horário comercial, de tempos em tempos (não
na hora). Clique em **Verificar assinatura no D4Sign agora** (documento com
visto) para conferir na hora (5.4).

**Não acho um equipamento no Estoque.**
- Ele pode estar **com um colaborador**: procure em **Empréstimos** ou **Entregas**.
- Pode ter recebido **baixa**: veja **Ver equipamentos baixados** (4.10).
- Pode ser de **outra empresa** (ou ter sido **transferido**): o analista só vê
  a própria empresa.

**O equipamento não aparece na lista do Novo empréstimo.**
Para empréstimo só aparecem equipamentos **em estoque** e marcados como
**Disponível para empréstimo**. Abra a ficha, clique em **Editar** e marque a
opção (4.5). Para **entrega**, qualquer equipamento em estoque aparece.

**Posso emprestar para um colaborador de outra empresa?**
Sim. O que importa é o **equipamento**: você só empresta/entrega equipamentos
da **sua** empresa, e o termo sai **em nome da empresa do equipamento**, seja
qual for a empresa da pessoa.

**Apareceu um erro dizendo que o registro foi "alterado por outra pessoa".**
Outro analista mexeu no mesmo equipamento ou empréstimo enquanto a sua tela
estava aberta. O Notrole recusa para não gravar por cima. **Recarregue a página
(F5)**, confira a situação atual e, se ainda fizer sentido, faça de novo.

**"Faltam dados para o termo."**
Falta alguma informação que vai no contrato: valor do equipamento, patrimônio,
CPF válido, endereço completo ou o motivo (no empréstimo). Passe o mouse sobre o
botão de confirmar para ver o que falta.

**Apareceu "Empresa não identificada".**
O campo "Empresa" do seu perfil no AD está vazio. Veja a seção 2.4.

**Apareceu "Acesso negado".**
A sua conta não está no grupo do Notrole no AD. Peça a inclusão à TI.

**Cancelei e apareceu um aviso amarelo.**
O termo não foi cancelado no D4Sign (ou já estava assinado). Siga o texto do
aviso e avise o administrador (5.10).

**O e-mail demorou para chegar ao colaborador.**
O servidor de e-mail da empresa às vezes demora para responder. O Notrole
espera e tenta de novo (até 3 vezes). Se o envio falhar, ele aparece com X
vermelho em **Configurações > E-mail**.

**Errei o cadastro de um equipamento.**
Se ele ainda não foi usado, abra a ficha e clique em **Editar** para corrigir,
ou em **Excluir** se o cadastro inteiro foi um engano. Se ele já tem histórico,
corrija pela edição; se precisa tirá-lo de circulação, use **Baixa**.

**O saldo de um periférico está errado.**
Conte a prateleira e use **Ajuste** com uma observação (4.11).

---

## 11. Boas práticas

1. **Confira o patrimônio (número de série)** na etiqueta do equipamento antes
   de cadastrar. Ele vai no termo e é por ele que o equipamento é conferido.
2. **Cadastre o valor** de todo equipamento. Sem valor, não sai termo de comodato.
3. **Confirme CPF e endereço com o colaborador**, mesmo quando vierem
   preenchidos do cadastro anterior.
4. **Use o termo de comodato** sempre que a política pedir. Lembre que cada
   termo gasta 1 envio do pacote do D4Sign.
5. **Registre a devolução na hora** em que receber o equipamento, escolhendo a
   condição certa (bom estado ou com avaria) e anotando o que faltou.
6. **Cancelar é só para erro de registro.** Se o colaborador usou o
   equipamento, registre a devolução.
7. **Prefira a baixa a excluir.** Excluir só para cadastro feito por engano.
8. **Escreva observações claras** em manutenção, baixa, ajuste e devolução:
   elas ficam no extrato e ajudam quem vier depois.
9. **Mantenha o estoque mínimo dos periféricos** cadastrado e faça a contagem
   da prateleira de tempos em tempos (use **Ajuste**).
10. **Avise o colaborador** de que vai receber dois e-mails (Notrole e D4Sign)
    e de que precisa assinar para o empréstimo/entrega valer.

---

## 12. Suporte

- **Dúvidas de uso, erros na tela ou algo que parece errado:** fale com a
  equipe de TI / Sistemas responsável pelo Notrole.
- **Contato do administrador do Notrole:** definido pela sua TI (normalmente
  o mesmo endereço que recebe os alertas automáticos, `ALERTA_EMAIL`).
- **Acesso ao Notrole ou campo "Empresa" do AD:** equipe de infraestrutura.
- **Documento no painel do D4Sign** (cancelar, conferir, liberar e-mail
  bloqueado): administrador do Notrole.

Ao pedir ajuda, informe: o que você estava fazendo, o equipamento (hostname ou
patrimônio), o colaborador, a mensagem que apareceu e, se possível, um print
da tela.

---

*Notrole — Estoque de TI · Manual do Analista · versão 2.0*
