# Contribuindo com o Notrole

Notas para quem for mexer no código. Em produção, a API roda atrás de um proxy
reverso (na instalação de referência, o IIS) que repassa para `127.0.0.1:3333`.

O modelo central é o **Item**: todo equipamento do estoque é um item de uma
categoria, e um notebook de empréstimo é um item com `paraEmprestimo = true`.
Toda mudança de situação passa por uma `Movimentacao`, na mesma transação —
estoque e extrato nunca divergem.

Antes de propor mudanças, vale ler [docs/ARQUITETURA.md](docs/ARQUITETURA.md) —
ele explica as decisões que parecem estranhas mas têm motivo.

## Regras da casa

**Rode `npm run typecheck` antes de dar qualquer coisa por pronta.** Ele cobre
backend, frontend, o seed e o `vite.config.ts`.

**Nada de segredo no código.** Tudo passa por `src/api/config/env.ts`, que
valida as variáveis com zod e derruba o processo com mensagem clara se faltar
alguma. Nunca versione o `.env`.

**Português nos nomes e nos comentários.** O domínio é em português
(`emprestimo`, `colaborador`, `item`) e o código acompanha. Bibliotecas e
tipos de terceiros mantêm o nome original.

**Ids são `Int`.** O schema usa `autoincrement()`.

**Situação do item e status do empréstimo são enums do Prisma**, sempre em
maiúsculas e sem acento (`EM_ESTOQUE`, `MANUTENCAO`, `AGUARDANDO_ASSINATURA`).
O frontend nunca manda rótulo em português para a API — a tradução mora em
`src/web/lib/dominio.ts`.

**"Atrasado" não é status.** É calculado, e a API devolve `atrasado` e
`diasAtraso` em cada empréstimo. Não crie a coluna.

## Estrutura

```
src/api/   backend  → rota → controller (valida com zod) → service (regra) → repository (Prisma)
src/web/   frontend → pages, components, lib, types. Alias "@/" aponta para src/web.
prisma/    schema, migrações (só estrutura) e seed de exemplo
scripts/   operação no Windows (deploy, watchdog, backup) e utilitários
docs/      arquitetura, operação, configuração, manual e roadmap
```

Só os repositories falam com o Prisma. Regra de negócio fica nos services.

## Ao mexer em cada área

**Datas.** Toda regra de vencimento está em `src/api/utils/datas.ts`. Um prazo
vence no *fim* do dia. Não compare `dataPrevista` com `new Date()` direto.
Datas de formulário (`yyyy-mm-dd`) passam por `diaDeFormulario` /
`dataDeFormulario`: `new Date('2026-10-09')` é meia-noite UTC, ou seja, o dia
anterior no horário de Brasília.

**Rotinas de e-mail** (`src/api/jobs/NotificacaoJob.ts`). Rodam de hora em hora
e precisam continuar idempotentes: `ultimaCobrancaEm` garante no máximo uma
cobrança por empréstimo por dia, e `lembretePrevioEm` um lembrete por prazo (a
renovação zera os dois).

**Templates de e-mail** ficam no banco, não no código. Os textos padrão estão em
`TemplateService`, e `garantirPadroes()` roda no boot sem sobrescrever o que o
operador editou.

**Transações.** Criar empréstimo e registrar devolução mexem em várias tabelas
e usam `prisma.$transaction`. Chamadas de rede (e-mail, D4Sign) ficam **fora**
da transação.

**Toda transição de estado é condicional.** Empréstimo e item mudam com
`updateMany` e o status/situação esperado no `where`; `count === 0` vira 409
("alterado por outra pessoa"). Nunca grave status com `update` só por `id`
depois de ler fora da transação. O banco tem a última trava: índice único
parcial de cessão aberta por item e `CHECK (quantidade >= 0)` (migração
`20261009180000`, fora do `schema.prisma` — se o `prisma migrate dev` propuser
DROP desse índice, remova do SQL gerado).

**O extrato não se apaga.** `Movimentacao → Item` é `RESTRICT`. Só se exclui item
sem movimentação além de ENTRADA/CONTAGEM_INICIAL; o resto vai para baixa.

**Autorização.** `protegido` em `src/api/routes/index.ts` autentica e confere
o grupo do AD; rota nova de negócio usa `negocio`. O webhook do D4Sign é a
exceção: autentica por segredo compartilhado. Operações sobre um empréstimo
existente conferem a empresa do item (`exigirEmpresaDoEmprestimo`). O analista
**vê** só a empresa dele: listagem nova usa `permissaoService.empresaDoFiltro`
e detalhe novo usa `exigirVisivel`. O `negocio` também recusa o analista sem
empresa no AD (403 `SEM_EMPRESA`). Ver docs/ARQUITETURA.md.

**Acentos em regex.** Ao mexer em `normalize('NFD').replace(/[̀-ͯ]/g, '')`,
confira os bytes (`od -c`): alguns editores gravam o intervalo como caracteres
combinantes literais (funciona igual, mas é fácil estragar).

**A API roda em uma instância só.** As rotinas usam `node-cron` dentro do
processo; uma segunda instância duplicaria os e-mails. Na instalação Windows,
a tarefa agendada `Notrole - API` sobe o backend compilado
(`dist-server\server.mjs`) e a tarefa `Notrole - Watchdog` vigia. Não suba com
PM2 nem com `npm start` em produção. Para parar a API de propósito use
`logs\manutencao.lock`, não desabilite a tarefa. Ver
[docs/OPERACAO.md](docs/OPERACAO.md).

## Deploy (Windows)

```powershell
.\scripts\deploy.ps1          # rollback: .\scripts\voltar-versao.ps1
```

Instala, migra, verifica tipos, compila em pastas novas, troca e reinicia.
Sempre religa a API no fim e avisa por e-mail se falhar.

Variáveis `VITE_*` são lidas no momento do build — mudou uma, precisa
recompilar. Mudou algo no `.env` do backend, reinicie a API.

## Commits e pull requests

- Mensagens no padrão `tipo: descrição` (`feat`, `fix`, `docs`, `refactor`,
  `chore`), em português.
- Migração nova: `npx prisma migrate dev --name descricao_curta` numa base de
  teste. Migrações só com estrutura; dados de exemplo vão em `prisma/seed.ts`.
- Antes de abrir o PR: `npm run typecheck` e `npm run build`.

Pendências e ideias estão em [docs/ROADMAP.md](docs/ROADMAP.md).
