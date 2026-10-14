# Operação

Guia do dia a dia do Notrole num servidor Windows com IIS. Os caminhos abaixo
usam a pasta de instalação de **exemplo** `C:\Sistemas\Notrole`; ajuste para a sua.

---

## Onde as coisas estão

| O quê | Onde |
|---|---|
| Código e deploy | `C:\Sistemas\Notrole` |
| Configuração | `C:\Sistemas\Notrole\.env` (fora do git) |
| Frontend compilado | `C:\Sistemas\Notrole\dist` (gerado, fora do git) |
| Backend compilado | `C:\Sistemas\Notrole\dist-server` (gerado, fora do git) |
| Versão anterior | `dist.anterior` e `dist-server.anterior` (guardadas pelo deploy) |
| Log da API | `C:\Sistemas\Notrole\logs\api.log` (rotaciona em 20 MB, 10 gerações) |
| Log do watchdog | `C:\Sistemas\Notrole\logs\watchdog.log` (só registra problemas e correções) |
| Log do backup | `C:\Sistemas\Notrole\logs\backup.log` |
| Backups | `C:\Backups\Notrole` (dump diário às 21h + cópia do `.env`, 30 dias) |
| Proxy reverso | IIS, site `Proxy-Notrole` (443 com certificado, 80 redireciona) → `http://127.0.0.1:3333` |
| Banco de dados | PostgreSQL 18 em `127.0.0.1:5432` (só acesso local), base `notrole_db`, usuário `notrole_app` (dono da base, não superusuário). Para abrir no pgAdmin, use o pgAdmin dentro do servidor. |

## Como o sistema se mantém no ar

Tudo é instalado por `.\scripts\instalar-servico.ps1`. O script pode ser rodado
de novo a qualquer momento: ele confere cada peça e refaz o que estiver faltando.

| Peça | O que faz |
|---|---|
| IIS (`W3SVC`) | Serviço automático. O site `Proxy-Notrole` tem app pool sempre ligado. |
| Tarefa **Notrole - API** | Sobe a API 30 s depois do boot, como `NETWORK SERVICE`. Não depende de ninguém logado. Roda o backend compilado (`dist-server\server.mjs`), que sobe em ~3 s. A API escuta só em `127.0.0.1:3333`: de fora, só pelo IIS. |
| Tarefa **Notrole - Watchdog** | Roda a cada minuto, como `SYSTEM`. Liga o IIS e o site se estiverem parados, sobe a API se ela caiu, reinicia a API se ela parar de responder por 3 minutos (com tolerância enquanto ela está subindo), confere o banco (`/api/ready`), o caminho completo pelo HTTPS, o backup da noite e o espaço em disco. |
| Tarefa **Notrole - Backup do banco** | Todo dia às 21h. |

Depois de um reboot (atualizações do Windows), a API volta em cerca de 1 minuto
sem nenhuma ação manual.

### Alertas por e-mail

O watchdog, o deploy e o backup mandam e-mail para `ALERTA_EMAIL` do `.env`
(vários separados por vírgula), pelo
mesmo SMTP do sistema. Um problema gera **um** e-mail "PROBLEMA", um lembrete
"CONTINUA" por hora enquanto durar e um "RESOLVIDO" quando volta ao normal.

Avisa quando:

- a API caiu, ou travou e foi reiniciada;
- o banco ficou inacessível (a API responde, mas não consulta);
- o site sumiu do IIS, ou o IIS foi parado/desativado (corrige sozinho e avisa);
- o endereço público não responde;
- o backup da noite falhou ou não rodou;
- o disco C: ficou com menos de 10 GB;
- o servidor reiniciou (Windows Update) — aviso informativo, um por boot;
- um deploy falhou.

Para testar o envio: `node C:\Sistemas\Notrole\scripts\servico\alerta.mjs "Teste" "Texto"`.
O estado dos alertas abertos fica em `logs\alertas\`.

> **Não use PM2 nem `npm start` para subir a API em produção.** Uma segunda
> instância duplicaria os e-mails das rotinas automáticas. O PM2 foi
> substituído em 09/10/2026: ele rodava na conta de quem o iniciou, e a tarefa
> de boot rodava como SYSTEM, que tinha outro PM2 (vazio). Depois de um reboot,
> a API não subia.

## Comandos do dia a dia

Os comandos que mexem na tarefa precisam de PowerShell **como administrador**.

Estado da API e do watchdog:

```powershell
Get-ScheduledTask 'Notrole - *' | Select-Object TaskName, State
Invoke-RestMethod http://localhost:3333/api/health   # processo de pé
Invoke-RestMethod http://localhost:3333/api/ready    # e falando com o banco
```

Acompanhar o log em tempo real / últimas 100 linhas:

```powershell
Get-Content C:\Sistemas\Notrole\logs\api.log -Wait -Tail 20
Get-Content C:\Sistemas\Notrole\logs\api.log -Tail 100
```

Reiniciar a API (por exemplo, depois de mexer no `.env`):

```powershell
Stop-ScheduledTask 'Notrole - API'; Start-ScheduledTask 'Notrole - API'
```

Para deixar a API **parada de propósito** (manutenção), crie o arquivo de
manutenção. O watchdog não mexe na API enquanto ele existir, por até 60
minutos; depois disso avisa por e-mail e volta a cuidar da API:

```powershell
Set-Content C:\Sistemas\Notrole\logs\manutencao.lock 'manutencao manual'
Stop-ScheduledTask 'Notrole - API'
# ...e para voltar:
Remove-Item C:\Sistemas\Notrole\logs\manutencao.lock
Start-ScheduledTask 'Notrole - API'
```

> Não desabilite a tarefa da API: o watchdog reabilita e avisa por e-mail. Uma
> tarefa desabilitada esquecida deixava o sistema fora do ar em silêncio.

## Publicar uma nova versão

```powershell
.\scripts\deploy.ps1
```

O deploy marca manutenção, para a API, instala, migra, confere os tipos e
compila em pastas novas (`dist.novo`, `dist-server.novo`). Só se tudo passar ele
troca as pastas e sobe a API, conferindo `/api/health` e `/api/ready`.
**Aconteça o que acontecer, no fim a API é religada** (com a versão nova ou com
a que já estava) e, se algo falhou, vai um e-mail de alerta. A API fica fora por
1 a 2 minutos: prefira publicar fora do expediente.

Quando só mudou código (sem dependência nova), pule o `npm install`:

```powershell
.\scripts\deploy.ps1 -PularInstalacao
```

## Voltar uma versão

O jeito rápido (segundos): volta para a versão compilada que estava no ar antes
do último deploy. Rodar de novo desfaz a volta. Não mexe no banco.

```powershell
.\scripts\voltar-versao.ps1
```

Pelo git, para voltar a um ponto mais antigo:

```powershell
git log --oneline
```

Para voltar ao estado anterior a uma mudança:

```powershell
git checkout <hash-do-commit>
```

Depois rode o deploy de novo. O commit `290a4b5` guarda o estado do sistema
antes da refatoração de setembro de 2026.

## Rotinas automáticas de e-mail

Rodam sozinhas de hora em hora, das 8h às 18h, de segunda a sexta:

- **Lembrete de vencimento** — avisa na véspera do prazo.
- **Cobrança de atraso** — cobra enquanto a devolução não acontece.

Por empréstimo, o lembrete sai **uma vez por prazo** (a renovação zera o
controle e o novo prazo ganha outro lembrete) e a cobrança sai no máximo **uma
vez por dia**. Isso é controlado pelas colunas `lembretePrevioEm` e
`ultimaCobrancaEm`.

Para disparar na hora, use os botões em **Configurações → Rotinas automáticas**.
Eles enviam e-mails de verdade.

O histórico de tudo que foi enviado aparece em **Configurações → Últimos e-mails
enviados**.

## Diagnóstico

### A tela não abre / erro 502 no navegador

O watchdog corrige sozinho em 1 a 3 minutos o que estiver parado. Se o problema
continuar, veja primeiro o que ele registrou e depois o log da API:

```powershell
Get-Content C:\Sistemas\Notrole\logs\watchdog.log -Tail 30
Get-Content C:\Sistemas\Notrole\logs\api.log -Tail 50
Get-ScheduledTask 'Notrole - *' | Select-Object TaskName, State
```

Se a API estiver subindo e caindo em loop, quase sempre é configuração: uma
variável obrigatória faltando no `.env`. A API diz exatamente qual no log.

Se algo foi desmontado (site do IIS apagado, serviço desabilitado, tarefa
removida), rode de novo o instalador, que remonta tudo:

```powershell
.\scripts\instalar-servico.ps1
```

> **Nada mais pode usar a porta 80 ou 443 deste servidor fora do IIS.** Em
> 02/09/2026 um servidor de desenvolvimento passou a ocupar a porta 80. Para
> liberá-la, o IIS foi desabilitado, e o Notrole ficou fora do ar por semanas
> sem ninguém perceber. Um sistema novo deve rodar numa porta própria (3000,
> 5000...) e ganhar um site no IIS que faça o proxy, como o `Proxy-Notrole`.

### A busca de colaborador no AD não retorna nada

Procure por `invalid_client_credential` no log. Se aparecer, o
`AZURE_CLIENT_SECRET` expirou ou está errado.

Segredos do Entra ID têm validade. Gere um novo em **Azure Portal → Entra ID →
Registros de aplicativo → Notrole → Certificados e segredos**, atualize o
`.env` e reinicie a API (`Stop-ScheduledTask 'Notrole - API'; Start-ScheduledTask 'Notrole - API'`).

A partir desta versão isso não derruba mais a aplicação inteira: só a busca no
AD para de funcionar, e a tela mostra uma mensagem explicando o motivo.

### Os e-mails não estão saindo

1. **Configurações → Testar SMTP** confirma se o servidor aceita a conexão.
2. **Configurações → Enviar teste para mim** confirma se o texto e o envio
   funcionam ponta a ponta.
3. A lista de últimos e-mails enviados mostra a mensagem de erro de cada falha.

### A importação da contagem inicial acusa erro em várias linhas

A planilha precisa usar os nomes que existem no sistema: a **categoria** e a
**empresa** têm de estar escritas como aparecem em Configurações, e o **local**
tem de pertencer àquela empresa. O sistema aponta o número da linha e o motivo;
as linhas boas entram, e só as apontadas ficam de fora.

Erros comuns: categoria que ainda não foi cadastrada, empresa escrita diferente
("Acme" em vez de "Acme Comercial"), patrimônio repetido e planilha de
equipamentos usada para item que é controlado por quantidade.

### O e-mail de assinatura do D4Sign não chega

O convite para assinar é enviado pelo **D4Sign**, não pelo Notrole, através do
Amazon SES. Um endereço que já teve erro de entrega fica na **lista de
supressão** da conta do D4Sign e, a partir daí, o e-mail nem sai. Por isso ele
também não aparece no rastreamento de mensagens do Exchange.

- Cerca de 10 minutos depois de enviar o termo, o Notrole confere a situação
  do e-mail (1 requisição). Se não foi entregue, o empréstimo aparece como
  **"E-mail não entregue"**, com o motivo ao passar o mouse.
- **Só o suporte do D4Sign pode tirar o endereço da lista de supressão.** Peça
  a liberação dos domínios da empresa, e não de um endereço por vez.
- Enquanto isso, a pessoa pode assinar pelo painel do D4Sign.
- Depois da liberação, use o botão **Reenviar convite** (envelope com "!").
  Ele não cria documento nem gasta envio. O D4Sign só aceita reenviar 1 minuto
  depois do envio e, a partir daí, com 5, 30 e 60 minutos entre um reenvio e
  outro.

### Alguém que deveria ter acesso recebe "Você não tem permissão"

A pessoa não está no grupo de segurança definido em
`AZURE_GRUPO_AUTORIZADO_ID`. Adicione ao grupo no Entra ID.

A resposta fica em cache por 10 minutos — depois de adicionar, pode levar esse
tempo até liberar, ou reinicie a API para limpar na hora.

### O analista vê a tela "Empresa não identificada"

O analista vê e movimenta só o estoque da empresa do campo "Empresa" do perfil
dele no AD. Se o campo estiver vazio ou com um texto que não corresponde a
nenhuma empresa (Configurações > Empresas, "termos do AD"), ele não vê nenhum
dado: a API responde 403 `SEM_EMPRESA`.

Peça à infraestrutura para preencher o campo. O perfil fica em cache por 10
minutos. Salvar uma empresa em Configurações > Empresas limpa esse cache, e
reiniciar a API também.

### Erro ao excluir um equipamento

Só dá para excluir um equipamento sem movimentação além do cadastro (entrada ou
contagem inicial), por exemplo um cadastrado por engano. Qualquer outro tem
extrato de patrimônio, que não pode sumir: use a **baixa**.

### "Este empréstimo foi alterado por outra pessoa"

Duas pessoas (ou um duplo clique, ou a rotina do D4Sign) mexeram no mesmo
empréstimo ou equipamento ao mesmo tempo. A segunda ação é recusada de
propósito, para o mesmo equipamento nunca ficar com duas pessoas. A tela
recarrega sozinha: confira o estado atual e, se ainda fizer sentido, repita.

## Backup

O que precisa de backup:

1. **O banco de dados** — é onde estão os dados.
2. **O arquivo `.env`** — não está no git, e sem ele o sistema não sobe.

O código está versionado em git. Se o servidor de produção tiver um clone,
mantenha também um remoto fora dele (GitHub, Azure DevOps etc.).

O backup automático roda todo dia às 21h (`scripts\backup-banco.ps1`, tarefa
**Notrole - Backup do banco**): dump do banco e cópia do `.env` em
`C:\Backups\Notrole`, guardando 30 dias (e nunca menos que os 7 mais recentes).
Se ele falhar ou deixar de rodar, o watchdog avisa por e-mail.

> **Os backups ficam no mesmo disco do servidor.** Se a VM for perdida, eles
> vão junto. Garanta um backup da VM ou copie `C:\Backups\Notrole` para fora.

Backup na hora:

```powershell
Start-ScheduledTask 'Notrole - Backup do banco'
```

Restaurar (PowerShell como administrador):

```powershell
Set-Content C:\Sistemas\Notrole\logs\manutencao.lock 'restore'
Stop-ScheduledTask 'Notrole - API'
& 'C:\Program Files\PostgreSQL\18\bin\pg_restore.exe' -h 127.0.0.1 -U <usuario do DATABASE_URL> -d notrole_db --clean --if-exists C:\Backups\Notrole\notrole-AAAAMMDD-HHMM.dump
Remove-Item C:\Sistemas\Notrole\logs\manutencao.lock
Start-ScheduledTask 'Notrole - API'
```
