# Arquitetura e decisões

Este documento explica **por que** o sistema é do jeito que é. Para instalar e
operar, veja [OPERACAO.md](OPERACAO.md).

---

## Uma aplicação, não duas

O Express serve a API em `/api/*` e os arquivos estáticos do React em todo o
resto. Não há um servidor separado para o frontend.

Isso tem duas consequências boas: não existe origem cruzada em produção (o CORS
fica fechado) e só há um processo para monitorar no PM2.

Houve uma tentativa anterior de rodar `vite preview` num segundo processo PM2.
Era redundante e foi removida junto com o `ecosystem.config.js`.

## Camadas do backend

```
rota → controller → service → repository → Prisma
```

- **Controller** valida a entrada com zod e não sabe nada de regra de negócio.
- **Service** concentra a regra. É onde ficam as transações.
- **Repository** é a única camada que fala com o Prisma.

A separação já existia no projeto, mas as camadas vazavam: os repositories
tipavam id como `string` onde a coluna é `Int`, e os controllers devolviam a
mensagem crua do Prisma para o navegador.

## Decisões que valem explicar

### "Atrasado" não é um status no banco

O enum `StatusEmprestimo` tem `AGUARDANDO_ASSINATURA`, `ATIVO`, `DEVOLVIDO` e
`CANCELADO`. "Atrasado" é calculado a cada consulta, comparando `dataPrevista`
com a data de hoje.

Guardar "atrasado" como status exigiria alguém para mantê-lo em dia — na
prática, uma rotina que reescreve linhas todo dia e que, quando falha, deixa o
dado mentindo. A API devolve `atrasado` e `diasAtraso` já calculados, e a
interface usa isso.

### O prazo vence no fim do dia

Um empréstimo previsto para 30/09 só é cobrado a partir de 01/10. O código
anterior comparava `dataPrevista < new Date()`, o que marcava como atrasado, às
08:00, um empréstimo que ainda tinha o dia inteiro pela frente.

A regra está em `src/api/utils/datas.ts`, num lugar só.

### As rotinas rodam de hora em hora, não uma vez por dia

O agendamento original era `0 8 * * *`. O log do PM2 registrou
`missed execution` todos os dias desde 11/09 — nenhuma cobrança chegou a ser
enviada em nenhum momento.

Em vez de depender de um único disparo diário acertar, a verificação roda de
hora em hora em horário comercial. Isso só é seguro porque as rotinas são
idempotentes: `Emprestimo.ultimaCobrancaEm` e `Emprestimo.lembretePrevioEm`
garantem, por empréstimo, no máximo um lembrete por prazo (a renovação zera o
campo) e uma cobrança por dia. Se o disparo das 08:00 falhar, o das 09:00
resolve.

### A reserva do equipamento acontece dentro de uma transação

`EmprestimoService.criar` faz um `updateMany` condicional no `Item`:

```ts
const reserva = await tx.item.updateMany({
  where: { id: dados.itemId, situacao: 'EM_ESTOQUE' },
  data: definitiva ? { situacao: 'ENTREGUE', ... } : { situacao: 'EMPRESTADO' },
});
if (reserva.count === 0) throw AppError.conflito(...);
```

O `where` com o status faz o banco decidir quem ganhou a disputa. Ler o status e
depois gravar, como era antes, permite que dois operadores emprestem o mesmo
equipamento ao mesmo tempo.

### O termo do D4Sign entra numa fila, não é gerado na hora

A conta do D4Sign tem teto de requisições por hora e cada termo custa **três
chamadas**. A TI empresta de 3 a 5 máquinas de uma vez, o que dá de 9 a 15
requisições em sequência — muito acima do limite padrão de 10 por hora.

Na versão anterior a geração era disparada com `void` e o erro só aparecia no
log: o termo simplesmente não existia e ninguém ficava sabendo.

Agora o empréstimo é gravado imediatamente e o termo fica **pendente no próprio
registro** (`d4signDocumentId` nulo, com `d4signProximaTentativa` e
`d4signTentativas`). O `TermoService` consome essa fila respeitando a cota, e a
rotina `fila-termos` roda de 5 em 5 minutos.

A fila mora no banco, e não em memória, por um motivo específico: um termo que
ficou esperando cota precisa sobreviver a um restart do PM2. Em memória, um
reinício às 18h perderia tudo que estava na fila.

Três situações são tratadas de forma diferente de propósito:

| Situação | O que acontece |
|---|---|
| Sem cota | Reprograma, **sem contar tentativa** — fila andando não é erro |
| Erro do D4Sign | Conta tentativa, espera crescente (15, 30, 60... até 4h) |
| Esgotou as tentativas | Marca como `FALHOU`, aparece em vermelho na tela |

Contar falta de cota como tentativa faria o sistema desistir de um termo depois
de algumas horas de movimento perfeitamente normal.

### E-mail e D4Sign ficam fora da transação

São chamadas de rede, lentas e sujeitas a falha. Mantê-las dentro da transação
seguraria a linha do banco pelo tempo de uma requisição HTTP externa — e uma
falha no SMTP desfaria um empréstimo que já aconteceu no mundo real.

O empréstimo é gravado primeiro; as notificações são disparadas depois, e o
resultado de cada envio fica registrado em `EmailEnviado`.

### Autenticação e autorização são coisas separadas

`autenticar` confirma que o token é válido e foi emitido pelo nosso tenant.
`exigirAcesso` confirma que a pessoa pertence ao grupo de segurança configurado
em `AZURE_GRUPO_AUTORIZADO_ID`.

Antes só existia a primeira metade: qualquer conta do tenant com um token válido
podia apagar notebooks.

O Entra ID nem sempre inclui a claim `groups` no token — depende da configuração
do app registration e do número de grupos do usuário. Quando ela não resolve, a
associação é confirmada pelo Graph (`checkMemberGroups`), com cache de 10
minutos. Se a consulta ao Graph falhar, o acesso é **negado**: um erro de
integração não pode virar porta aberta.

### Cada analista vê só a própria empresa

O **analista** vê e movimenta só os dados da empresa dele. A empresa vem do campo "Empresa" do perfil no AD. O
**administrador** (grupo `AZURE_GRUPO_ADMIN_ID`) vê tudo e escolhe a empresa no
filtro das telas.

- **Listas e somas** (itens, periféricos, extrato, cessões, colaboradores,
  resumo, por setor, dashboard, planilha, PDFs, e-mails enviados, contagens da
  fila de termos): o servidor impõe a empresa do analista com
  `permissaoService.empresaDoFiltro` e ignora o `empresaId` que vier na query.
- **Detalhes** (ficha do item, cessão, histórico, comprovante, colaborador):
  `exigirVisivel` responde 403 `OUTRA_EMPRESA`.
- **Colaborador** não tem empresa. Ele aparece para o analista quando teve
  cessão, está com um equipamento ou recebeu periférico da empresa dele. Para o
  formulário de cessão, `GET /colaboradores/cadastro` acha a pessoa escolhida
  no AD por busca exata, seja de qual empresa for, porque alguém da outra
  unidade pode receber equipamento desta.
- **Termo de comodato:** para o analista, a empresa do termo é sempre a do
  equipamento, imposta pelo servidor. Só o administrador escolhe outra.
- **Analista sem empresa** (campo vazio, texto que não bate com nenhuma
  empresa, ou o Graph falhou): o sistema **fecha**. Toda rota de negócio
  responde 403 `SEM_EMPRESA` (`negocio` em `routes/index.ts`), e a tela mostra
  um aviso. Só o `/me` responde, com `semEmpresa: true`.
- Rotinas, fila de termos e webhook do D4Sign rodam sem usuário e não passam
  por essa regra.

### Templates de e-mail no banco

A tela de Configurações deixava editar assunto e corpo, mas gravava no
`localStorage` do navegador. O backend nunca lia aquilo e mandava textos fixos
escritos no código. Quem editava via o texto novo na tela e o colaborador
recebia o antigo.

Agora ficam na tabela `TemplateEmail`, que é o que o backend lê na hora de
enviar. `TemplateService.garantirPadroes()` roda no boot e cria os textos padrão
sem sobrescrever o que já foi editado.

### Todo envio de e-mail é registrado

A tabela `EmailEnviado` guarda destinatário, assunto, sucesso e erro. Isso torna
possível responder "o sistema avisou essa pessoa?" — pergunta que, antes, não
tinha resposta.

## Fluxo de um empréstimo

```
   operador registra o empréstimo (ou a entrega)
                 │
                 ▼
  equipamento sai de EM_ESTOQUE em transação:
  empréstimo → EMPRESTADO · entrega → ENTREGUE
                 │
      ┌──────────┴──────────┐
      ▼                     ▼
  com termo (D4Sign)     sem termo
      │                     │
      ▼                     ▼
AGUARDANDO_ASSINATURA     ATIVO
      │
      │  D4Sign confirma a assinatura do colaborador
      ▼
    ATIVO
      │
      ├── véspera do prazo → lembrete (um por prazo)
      ├── prazo vencido    → cobrança diária
      ├── renovação        → novo prazo, notificações zeradas
      │   (entrega não tem prazo: sem lembrete nem cobrança)
      ▼
  DEVOLVIDO ── condição "AVARIADO"? → equipamento vai para MANUTENCAO
            └─ caso contrário       → equipamento volta a EM_ESTOQUE

  CANCELADO (antes da devolução)    → equipamento volta a EM_ESTOQUE
```

Cada transição vira uma linha em `HistoricoAcoes`, visível pelo botão de
histórico na tela de Empréstimos.

## O que foi deixado de fora de propósito

- **Testes automatizados.** Não existem. É a maior lacuna que sobra — veja
  [ROADMAP.md](ROADMAP.md).
- **Paginação.** As listagens trazem tudo. Com dezenas ou centenas de
  equipamentos isso é irrelevante; passando disso, precisa mudar.
- **Múltiplas instâncias.** As rotinas usam `node-cron` dentro do processo da
  API. Subir uma segunda instância duplicaria os e-mails. Por isso a tarefa
  `Notrole - API` usa `MultipleInstancesPolicy = IgnoreNew`, e não existe outro
  caminho de subida em produção.
