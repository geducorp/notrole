# Controle de estoque de TI

Situação em 22/09/2026. A **etapa 1 está implementada** (falta publicar no
servidor); as etapas seguintes estão no fim do documento.

---

## O problema

Antes do Notrole, não havia controle nenhum do estoque de TI. Os equipamentos
chegam em remessas (duas ou três vezes por ano), ficam numa prateleira e saem
conforme a necessidade. Ninguém sabe, sem ir olhar, quantos notebooks novos
existem, quanto há parado em valor, nem com quem está cada equipamento
entregue.

É um estoque por empresa (o Notrole é multiempresa: cada empresa cadastrada
tem o seu).

Volume: por volta de 12 notebooks novos em estoque hoje, algo parecido em
monitores, 1 celular, mais os usados e os periféricos. Nas remessas chega a
20 ou 30 notebooks. Não é um estoque grande — é um estoque **caro**.

## A decisão de fundo: estoque e ativo são a mesma coisa

Um equipamento não é "estoque" ou "ativo": ele passa por situações. Chegou,
está em estoque, foi entregue a alguém, voltou, foi para manutenção, foi
descartado. "Em estoque" é uma dessas situações.

Por isso o sistema registra **o equipamento e cada movimentação dele**, e não
apenas um contador de quantidades. O controle de estoque é o que se vê hoje; o
controle de ativos aparece depois, dos mesmos dados, sem migração nem retrabalho.

## Dois tipos de item

| | Itens identificados | Itens por quantidade |
| --- | --- | --- |
| Exemplos | Notebook, monitor, celular | Kit teclado e mouse, headset, adaptador, carregador |
| Registro | Um por equipamento, com série/patrimônio (obrigatório só em computador) | Um por tipo, com saldo |
| Tem história própria | Sim | Não |
| Serve para empréstimo com termo | Sim | Não |
| Controle | "Onde está e com quem" | "Tenho 14, restam 3, comprar" |

A divisão é o que evita os dois erros clássicos: cadastrar cabo por cabo (que
ninguém mantém) e perder o rastro de um notebook de R$ 4.500 (que ninguém
perdoa).

## Como o equipamento anda

```
        ENTRADA (compra, contagem inicial, devolução de manutenção)
                                │
                                ▼
                        ┌───────────────┐
        TRANSFERÊNCIA   │  EM ESTOQUE   │   MANUTENÇÃO
     (entre empresas) ◄─┤     empresa   ├─►  (conserto)
                        └───────┬───────┘
                   ENTREGA      │      EMPRÉSTIMO
              (definitiva)      │      (temporário, com termo)
                        ┌───────┴───────┐
                        ▼               ▼
                  COM O COLABORADOR   EMPRESTADO ──► DEVOLUÇÃO ──► estoque
                        │
                        ▼
                      BAIXA (descarte, perda, venda)
```

**Entrega e empréstimo são coisas diferentes** e continuam separadas: a entrega
é definitiva, sem prazo nem cobrança; o empréstimo é temporário, com termo de
comodato, prazo, lembrete e comprovante de devolução — o que o Notrole já faz.

## Quem pode o quê

A empresa do analista vem do campo "Empresa" do perfil dele no AD, o mesmo que
o sistema já usa para escolher a empresa do termo de comodato. Sem cadastro de
usuário paralelo e sem senha no Notrole.

| Perfil | Enxerga | Movimenta | Cadastra categorias |
| --- | --- | --- | --- |
| Analista | Só a empresa dele | Só a empresa dele | Não |
| Administrador | Todas as empresas | Todas | Sim |

O analista vê só a empresa dele, e quem tem a visão de todas as empresas é o
administrador. Analista sem empresa no AD não vê nada até o campo ser
preenchido no AD. Uma transferência entre
empresas é registrada por quem envia.

Administrador é definido por um segundo grupo no AD, no mesmo modelo do grupo
de acesso que já existe.

## Compra

Na entrada de um equipamento: **valor e data são obrigatórios**; fornecedor e
número da nota fiscal ficam opcionais.

O valor já é exigido hoje no termo de comodato, e é ele que responde "quanto
tem parado em estoque" e "quanto valia o equipamento que sumiu". A nota fiscal
em si fica no almoxarifado, é do financeiro, e replicá-la à mão viraria um
campo sempre vazio.

## Contagem inicial

O estoque atual não entra "do zero a partir de agora": o que está na prateleira
hoje é justamente o que precisa de controle.

1. A TI conta o estoque de cada empresa, uma vez, e preenche a planilha
   modelo que o sistema oferece para baixar.
2. A tela de importação lê a planilha e cria os itens com o movimento
   "contagem inicial".
   - Categoria marcada como **Computador** (Notebook) exige o número de
     série e aceita processador, memória e armazenamento (GB). Sem hostname,
     o item aparece como "Pendente de formatação". As outras categorias
     (monitor, celular) entram sem número de série.
   - Número de série e hostname são gravados em maiúsculas. O nome do
     equipamento nas telas é o hostname ou, sem ele, marca + modelo.
3. Os notebooks já cadastrados no Notrole viram itens automaticamente, com o
   histórico de empréstimos preservado.

## Entrega por etapas

Cada etapa entra em uso sozinha; o empréstimo de notebooks continua funcionando
o tempo todo.

**1. Cadastro e situação — FEITO (22/09)**
Categorias, locais, equipamentos e itens por quantidade, por empresa. Os
notebooks que já existiam viraram itens da categoria Notebook, sem perder
empréstimo nem histórico. Planilha modelo e importação da contagem inicial.

**2. Movimentações — FEITO (22/09)**
Entrada, contagem inicial, entrega a colaborador, devolução, empréstimo,
transferência entre empresas, manutenção, baixa e ajuste de saldo. Cada
equipamento tem extrato, e a ficha do colaborador mostra o que está com ele.

**3. Conferência**
Etiquetas com QR Code e conferência de prateleira: aponta a câmera, confirma o
que existe, o sistema aponta as diferenças.

**4. Relatórios e alertas**
Valor total por empresa, equipamentos parados há muito tempo, estoque mínimo
dos periféricos, histórico de consumo.

## Decidido em 22/09

**Categorias são cadastradas pela TI**, não fixas no código. Cada categoria
diz se o controle é por item (com número de série) ou por quantidade. As
iniciais, já carregadas pelo sistema:

| Categoria | Controle |
| --- | --- |
| Notebook | Por item |
| Monitor | Por item |
| Celular | Por item |
| Impressora | Por item |
| Memória RAM | Por quantidade |
| Kit teclado e mouse | Por quantidade |
| Headset | Por quantidade |
| Adaptador | Por quantidade |
| Carregador | Por quantidade |

**Condição do equipamento:** Novo, Usado, Em manutenção, Descartado.

**Sem impressora de etiquetas.** A conferência usa o número de série do próprio
equipamento: a busca aceita o serial digitado e, onde o equipamento tiver código
de barras de fábrica, a câmera do celular pode ler. (A leitura pela câmera exige
que o site esteja em HTTPS — conferir antes da etapa 3.)

**Administrador:** grupo próprio no AD, a ser criado pela TI; enquanto o ID
não estiver configurado, todos os analistas seguem com os mesmos poderes.

## Como ficou (etapa 1)

| Tela | O que faz |
| --- | --- |
| **Estoque → Equipamentos** | Lista com busca, filtro por empresa, categoria e situação. Clicar abre a ficha. |
| **Ficha do equipamento** | Dados, extrato e as ações: entregar, receber de volta, transferir, manutenção e baixa. |
| **Estoque → Por quantidade** | Saldo por item, com aviso de estoque mínimo e os botões de entrada, saída e ajuste. |
| **Estoque → Movimentações** | Tudo o que aconteceu no estoque, em ordem. |
| **Contagem inicial** | Baixa a planilha modelo, preenche e importa. Cada linha com erro é apontada pelo número. |
| **Configurações** | Cadastro das categorias e dos locais. |
| **Colaboradores** | A ficha mostra o que está com a pessoa e os empréstimos com termo. |

A API mudou junto: `/api/notebooks` virou `/api/itens`, e há `/api/estoque/*`
para categorias, locais, saldos, movimentações e importação.

## Decidido depois (até 15/10/2026)

- **Locais** saíram do sistema (migração `20260923120000_remove_local`).
- **Empresa do analista:** o analista vê e movimenta só a empresa do campo
  "Empresa" do AD dele; o filtro de empresa existe só para o administrador. Sem
  empresa no AD, tela "Empresa não identificada" (ver "Quem pode o quê").
- **Telas do Estoque em abas:** Visão geral, uma aba por equipamento principal
  (categoria com "seção própria": Notebook, Monitor, Celular e Impressora já
  vêm marcadas; o administrador marca outras em Configurações → Categorias),
  Periféricos, Por setor e Movimentações. Desde 14/10 a aba de cada categoria
  ativa com seção própria aparece desde o início, mesmo sem cadastro, e o nome
  vai no plural (Notebooks, Monitores, Celulares).
- **Computador** (14/10): categoria marcada como Computador em Configurações →
  Categorias (Notebook já vem marcada) exige número de série e tem hostname e
  especificações (processador, memória, armazenamento). As outras entram sem
  número de série, mas sem ele o equipamento não sai com termo de comodato.
- **Aviso de estoque baixo** (15/10): uma etiqueta por periférico, com
  categoria, descrição e saldo ("Memória RAM 8GB 3 / mín. 5"), no Estoque e no
  Dashboard. A empresa só aparece para o administrador.
- **"Acessório" virou "Periférico"** nos textos e na planilha (no código os
  nomes `acessorios` e `ItemQuantidade` continuam).
- **O Estoque mostra só o que está com a TI** (em estoque, reservado e em
  manutenção). Entregue e emprestado ficam em Entregas e Empréstimos; baixados
  só pelo link "Ver equipamentos baixados".

## Ainda a definir

1. **Estoque mínimo:** quais itens por quantidade merecem alerta e a partir de
   qual saldo. Dá para definir item a item na tela.
2. **Perfil de administrador:** é o grupo do AD em `AZURE_GRUPO_ADMIN_ID`.
   Enquanto o ID não estiver no `.env`, todos são administradores e veem todas as
   empresas (ver [ROADMAP.md](ROADMAP.md)).
3. **Colunas próprias por seção** na lista (por exemplo, coluna de hostname só
   na aba de computador): ainda não feito. Hostname e especificações já
   aparecem só no cadastro e na ficha de computador.
