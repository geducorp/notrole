# Configuração das integrações

Passo a passo do que precisa ser feito nos portais externos.

Para gravar os valores no `.env` sem que eles apareçam na tela, use:

```powershell
.\scripts\configurar.ps1
```

Para ver o que já está preenchido e o que falta:

```powershell
.\scripts\conferir-config.ps1
```

---

## 1. Microsoft Entra ID

O app registration já existe. O que falta é ajustá-lo.

### 1.1 Gerar um novo client secret — **obrigatório**

O segredo anterior estava escrito em texto puro dentro de
`src/api/services/MicrosoftGraphService.ts` e esteve exposto no código. Além
disso, o log do PM2 mostra que ele já não é aceito
(`invalid_client_credential`).

1. **Azure Portal → Microsoft Entra ID → Registros de aplicativo → Notrole**
2. **Certificados e segredos → Novo segredo do cliente**
3. Descrição: `Notrole API`. Validade: 24 meses.
4. Copie o **Valor** (não o "ID do segredo") — ele só aparece uma vez.
5. Rode `.\scripts\configurar.ps1` e cole quando ele pedir `AZURE_CLIENT_SECRET`.
6. **Exclua o segredo antigo** na mesma tela do portal.
7. Anote a data de expiração num lembrete. Quando vencer, a busca no AD para de
   funcionar.

### 1.2 Permissões do Microsoft Graph

Em **Permissões de API**, confirme que existem como *permissões de aplicativo*
(Application, **não** Delegated), com consentimento do administrador concedido:

| Permissão | Para quê |
|---|---|
| `User.Read.All` | Buscar colaboradores no AD |
| `GroupMember.Read.All` | Conferir se a pessoa está no grupo autorizado |

Sem o consentimento do administrador (o botão "Conceder consentimento do
administrador" na mesma tela), elas ficam marcadas mas não valem.

### 1.3 O grupo que libera o acesso — **obrigatório**

Sem isso, qualquer conta do tenant entra e pode apagar equipamentos.

O sistema confere a associação **pelo Entra ID**, usando o Object ID do grupo.
Isso muda um pouco o caminho conforme onde você cria o grupo:

**Se você criar direto no Entra ID (mais simples, recomendado):**

1. **Azure Portal → Microsoft Entra ID → Grupos → Novo grupo**
2. Tipo de grupo: **Segurança**. Nome: por exemplo `Notrole - Operadores`.
3. Adicione os membros da TI.
4. Abra o grupo e copie o **ID do objeto**.
5. `.\scripts\configurar.ps1` → cole em `AZURE_GRUPO_AUTORIZADO_ID`.

**Se você criar no Active Directory local (aquele do "Membro de"):**

Funciona também, **desde que o grupo seja sincronizado para o Entra ID pelo
Entra Connect**. Grupos criados no AD local só aparecem na nuvem se estiverem
dentro de uma OU incluída no escopo da sincronização.

1. Crie o grupo no **Usuários e Computadores do Active Directory**, do tipo
   **Segurança — Global** (ou Universal), numa OU que já sincroniza.
2. Adicione os membros.
3. Espere a sincronização (o ciclo padrão é de 30 minutos) ou force com
   `Start-ADSyncSyncCycle -PolicyType Delta` no servidor do Entra Connect.
4. Confirme que ele apareceu: **Azure Portal → Entra ID → Grupos**, procure pelo
   nome. A origem deve aparecer como "Windows Server AD".
5. Abra o grupo e copie o **ID do objeto** — é esse, o da nuvem, que o sistema
   usa. Não é o SID do AD local.
6. `.\scripts\configurar.ps1` → cole em `AZURE_GRUPO_AUTORIZADO_ID`.

> Se o grupo não aparecer no Entra ID depois da sincronização, ele está fora do
> escopo do Entra Connect. Nesse caso o caminho mais rápido é criar o grupo
> direto no Entra ID.

**Opcional, mas evita uma consulta por acesso:** em **Registros de aplicativo →
Notrole → Configuração do token → Adicionar declaração de grupos**, escolha
*Grupos de segurança*. Com isso o grupo vem dentro do próprio token. Sem isso o
sistema pergunta ao Graph e guarda a resposta por 10 minutos — funciona igual,
só gasta uma chamada a mais.

### 1.4 Expor um scope próprio da API — recomendado

Hoje o frontend manda o *id token* para a API. Ele valida, mas não é o token
certo para isso.

1. **Expor uma API → Adicionar um escopo**
2. Se pedir, aceite o Application ID URI padrão (`api://<client-id>`).
3. Nome do escopo: `access_as_user`. Quem pode consentir: administradores e
   usuários.
4. Em **Aplicativos cliente autorizados**, adicione o próprio client id e marque
   o escopo recém-criado.
5. No `.env`, preencha `VITE_AZURE_API_SCOPE` com
   `api://<client-id>/access_as_user` e rode o deploy (é uma variável de build).

Enquanto estiver vazio, o sistema continua funcionando com o id token.

### 1.5 Redirect URI

Em **Autenticação**, a plataforma deve ser **Aplicativo de página única (SPA)** e
o Redirect URI precisa ser exatamente o endereço pelo qual as pessoas acessam o
sistema — o mesmo que aparece na barra do navegador, sem barra no final.

---

## 2. D4Sign

**Como funciona:** o Notrole preenche o termo de comodato a partir do modelo
Word versionado no projeto (`docs/modelos/termo-comodato-emprestimo.docx`, ou
`termo-comodato-entrega.docx` na entrega) e envia o documento **pronto** ao
D4Sign, na pasta da empresa, com o colaborador como único signatário. O motor de modelos do D4Sign **não é usado** —
veja o porquê em [docs/modelos/README.md](modelos/README.md).

A integração tem uma **chave geral**, `D4SIGN_ATIVO`, que vem desligada
(`false`). Desligada, o Notrole não faz nenhuma chamada ao D4Sign e os
empréstimos nascem ativos, sem termo. Ligue só depois do teste da seção 2.4.

Referência oficial: [Introdução à API](https://docapi.d4sign.com.br/docs/introdu%C3%A7%C3%A3o-a-api).

### 2.1 Chave de API

1. D4Sign → **Minha conta** (canto superior direito) → **Gerenciar conta** →
   aba **Dev (API)** → **Nova chave API**.
2. Copie o **tokenAPI** e, se aparecer, o **cryptKey** (opcional).
3. `.\scripts\configurar.ps1` → cole em `D4SIGN_API_KEY` e `D4SIGN_CRYPT_KEY`.

A chave dá acesso à conta inteira do D4Sign da empresa. Ela fica só no `.env`
do servidor, que não vai para o git.

> O acesso à aba Dev (API) depende do perfil: só o administrador da conta, com
> plano compatível, vê e libera as chaves (resposta do suporte do D4Sign,
> 21/09/2026).

### 2.2 Cofre e pastas

Os termos vão para o cofre configurado em `D4SIGN_SAFE_ID` (por exemplo, um
cofre "TI"), cada um na pasta da empresa comodante (uma pasta por empresa).
As pastas de cada empresa ficam em **Configurações → Empresas**, no
próprio Notrole.

Para listar cofres e pastas:

```powershell
node scripts/d4sign-explorar.mjs
node scripts/d4sign-explorar.mjs --pastas
```

Só leitura: nenhum documento é criado.

### 2.3 Empresas

As empresas são cadastradas em **Configurações → Empresas** (botão **Nova
empresa**), com razão social, CNPJ, endereço, palavras do AD e pasta no D4Sign.
As migrações não inserem empresas; para experimentar, `npm run db:seed` cria
duas empresas fictícias.

A empresa de cada empréstimo é reconhecida pelo campo **Empresa** do perfil do
colaborador no AD, por palavra-chave (ex.: `acme`), sem
diferenciar maiúsculas e acentos — assim "Acme - Filial Norte" e "ACME
indústria ltda" caem na mesma empresa. Quem está sem empresa no AD fica
com a **padrão**. O operador pode trocar no formulário.

Para ver as grafias que existem no AD:

```powershell
node scripts/verificar-entra.mjs --empresas
```

### 2.4 Testar antes de ligar

```powershell
npx tsx scripts/d4sign-teste-contrato.ts
```

Gera `teste-contrato.docx` na pasta do projeto, preenchido com dados de exemplo.
**Não fala com o D4Sign.** Abra no Word e confira o contrato.

Para ver como fica dentro do D4Sign:

```powershell
npx tsx scripts/d4sign-teste-contrato.ts --enviar-rascunho
```

Sobe o contrato como **rascunho** na pasta da empresa padrão: sem signatário,
sem envio, ninguém recebe nada, e não consome o pacote. Depois, cancele com o
comando que o script mostra.

Com o contrato conferido, ligue a integração no `.env` do servidor:

```
D4SIGN_ATIVO=true
```

e reinicie a API (PowerShell como administrador):
`Stop-ScheduledTask 'Notrole - API'; Start-ScheduledTask 'Notrole - API'`.

### 2.5 O formulário de empréstimo

Com a integração ligada, o formulário de novo empréstimo mostra a opção **Enviar
termo de comodato pelo D4Sign** (marcada por padrão). Com ela marcada, pede:

- **Empresa** — para o analista, é sempre a empresa do equipamento (o servidor
  impõe); só o administrador escolhe outra;
- **Motivo do empréstimo**;
- **CPF** e **endereço** do colaborador — informados na hora da retirada, com o
  colaborador na mesa da TI. Ficam salvos: no próximo empréstimo já vêm
  preenchidos para conferir. O CPF tem o dígito verificador conferido;
- **Acessórios** — carregador, mouse, mochila ou outro; vão como item 2 do
  contrato.

O **valor** e o **patrimônio** do equipamento precisam estar cadastrados
(Estoque → ficha do equipamento): eles aparecem no contrato. O cadastro só
exige o patrimônio em categoria marcada como Computador (Notebook); monitor,
celular e outros podem entrar sem, mas aí não saem com termo.

**Só o colaborador assina** no D4Sign; o termo não tem testemunha signatária
(Lei 14.620/2023, art. 784 §4º do CPC). O nome do analista logado sai impresso
no termo como "REGISTRADO NO NOTROLE POR: <analista>", sem linha de
assinatura. Revise o modelo com o seu jurídico antes de usar
(ver [ROADMAP.md](ROADMAP.md)).

Se faltar qualquer dado, o empréstimo **não é registrado** e o formulário diz o
que falta. Nenhum contrato com lacuna chega ao D4Sign.

### 2.6 Como o sistema fica sabendo que o termo foi assinado

**Não precisa configurar nada.**

Numa instalação típica, o Notrole só é acessível dentro da rede da empresa
(DNS interno, sem endereço público). Por isso o webhook do D4Sign — que é o D4Sign chamando o Notrole pela internet —
não consegue chegar.

Em vez de esperar o aviso, **o Notrole pergunta**. A rotina `fila-termos` roda a
cada 5 minutos: gera os termos pendentes e, com a cota que sobrar, consulta os
documentos que aguardam assinatura — só em horário comercial e, para cada
documento, no máximo a cada 4 horas e por até 15 dias. Quando o D4Sign responde
"Finalizado" (todos assinaram), o empréstimo vira ATIVO sozinho.

Na tela de Empréstimos há o botão **Verificar assinatura**, para quando o
colaborador avisa que acabou de assinar.

A rota de webhook continua no código e desligada. Se um dia o Notrole for
publicado na internet, basta preencher `D4SIGN_WEBHOOK_SECRET` e cadastrar
`https://<endereço-público>/api/webhooks/d4sign?secret=<segredo>` no D4Sign.

### 2.7 Custo e uso da conta — **leia antes de ligar**

A conta do D4Sign é **da empresa inteira** (não só do Notrole) e o uso é
**cobrado**, principalmente por documento criado. O Notrole foi ajustado para
gastar o mínimo:

| Proteção | Como funciona |
|---|---|
| **Um documento por empréstimo, no máximo** | Gerar o termo são 3 passos (criar, adicionar signatário, enviar). Cada passo concluído é gravado no banco na hora. Se algo falhar no meio, a nova tentativa continua de onde parou — o documento **nunca** é criado duas vezes. |
| **O operador decide** | No formulário de novo empréstimo há a opção "Enviar termo de responsabilidade pelo D4Sign". Desmarcada, nenhum documento é criado. |
| **Falha duvidosa para tudo** | Se o D4Sign não responder ao criar o documento (queda de rede, timeout), ele pode ter criado sem avisar. O sistema **não tenta de novo sozinho** e pede que alguém confira o painel antes. |
| **Desistir é desistir** | Depois de 3 tentativas, o sistema para. Só volta a tentar se um operador pedir. |
| **Cota própria abaixo da conta** | O Notrole se limita a 6 requisições por hora, abaixo das 10 da conta, para não esgotar a cota de outras integrações da empresa. |
| **Consulta de assinatura econômica** | Só em horário comercial, cada documento no máximo a cada 4 horas, e só durante 15 dias. Um termo que leva três dias para ser assinado custa por volta de oito consultas (que não criam documento). |
| **Nada pendente, nada gasto** | A rotina acorda a cada 5 minutos, mas só lê o banco do próprio Notrole. Ela só chama o D4Sign quando há algo a fazer. |

Em **Configurações → Termos de responsabilidade** aparece quantos documentos o
Notrole criou no mês, para acompanhar o gasto.

Todos os limites ficam no `.env`:

```
D4SIGN_REQUISICOES_POR_HORA=6
D4SIGN_MAX_TENTATIVAS=3
D4SIGN_CONSULTA_AUTOMATICA=true
D4SIGN_HORAS_ENTRE_CONSULTAS=4
D4SIGN_DIAS_MAX_CONSULTA=15
```

Para **zerar as consultas automáticas**, use `D4SIGN_CONSULTA_AUTOMATICA=false`:
o operador passa a conferir pelo botão "Verificar assinatura" (1 consulta por
clique) ou ativa o empréstimo manualmente (nenhuma chamada).

**Testes sem custo:** o D4Sign tem um ambiente de testes (sandbox), que não gera
cobrança. Com uma conta de sandbox, use `D4SIGN_AMBIENTE=sandbox` e as
credenciais dela para testar à vontade.

**Pergunta para quem administra o contrato (Márcio):** confirmar (1) se a
cobrança é só por documento enviado ou também por chamada de API, e (2) se
existe outra integração usando a API com esta mesma conta. As respostas dizem se
dá para afrouxar algum desses limites.


## 3. SMTP

A validação do certificado do servidor SMTP é uma opção explícita:

```
SMTP_REJECT_UNAUTHORIZED=true
```

Deixe `true`. Use `false` só se o seu servidor SMTP interno (ex.: um Exchange
local) tiver certificado autoassinado: a conexão continua cifrada, mas sem
validar o certificado. É uma decisão de ambiente, por isso fica no `.env`.

Para conferir: **Configurações → Testar SMTP**, dentro do sistema.

---

## Checklist

- [ ] Novo client secret gerado, antigo revogado, `AZURE_CLIENT_SECRET` preenchido
- [ ] `User.Read.All` e `GroupMember.Read.All` como permissões de aplicativo, **com consentimento concedido**
- [ ] Grupo criado (no Entra ID, ou no AD local e sincronizado) e `AZURE_GRUPO_AUTORIZADO_ID` preenchido com o Object ID da nuvem
- [ ] Redirect URI do tipo SPA batendo com o endereço de acesso
- [ ] Scope `access_as_user` criado e `VITE_AZURE_API_SCOPE` preenchido (recomendado)
- [ ] Chave de API do D4Sign gravada e `D4SIGN_SAFE_ID` conferido
- [ ] `.\scripts\deploy.ps1` executado (a migração cadastra as empresas)
- [ ] Valor cadastrado nos notebooks
- [ ] Contrato de teste conferido (`npx tsx scripts/d4sign-teste-contrato.ts`)
- [ ] `D4SIGN_ATIVO=true` e API reiniciada

## Fontes

- [Introdução à API D4Sign](https://ajuda.d4sign.com.br/introdu%C3%A7%C3%A3o-%C3%A0-api-d4sign-leia-antes-de-come%C3%A7ar)
- [Endpoints de configuração de documentos](https://docapi.d4sign.com.br/docs/endpoints-2)
- [Endpoints dos cofres](https://docapi.d4sign.com.br/docs/endpoints)
- [Cadastrar signatários](https://ajuda.d4sign.com.br/cadastrar-signat%C3%A1rios-api)
