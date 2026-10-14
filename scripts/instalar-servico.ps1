<#
.SYNOPSIS
    Deixa o Notrole no ar de forma permanente: IIS + tarefa da API + watchdog.

.DESCRIPTION
    Pode ser rodado quantas vezes quiser: cada passo confere o estado antes de
    mudar. Precisa de PowerShell como administrador.

    O que configura:

      IIS
        - W3SVC em inicio automatico.
        - App pool "Proxy-Notrole" sempre ligado (sem idle timeout nem reciclagem
          periodica).
        - Site "Proxy-Notrole": https *:443 (SNI) com o certificado do
          o dominio informado em -Dominio e http *:80 redirecionando para https.
        - ARR sem a porta no X-Forwarded-For (o express-rate-limit recusa
          "ip:porta") e mantendo o Host original.

      Tarefa "Notrole - API"
        - Roda scripts\servico\iniciar-api.ps1 no boot, como NETWORK SERVICE
          (nao depende de ninguem logado nem da senha de uma conta pessoal).

      Tarefa "Notrole - Watchdog"
        - Roda scripts\servico\watchdog.ps1 a cada minuto, como SYSTEM.

    Substitui o PM2 e a antiga tarefa "Notrole - Inicializacao Automatica".
    O PM2 rodava na conta de quem o iniciou; a tarefa de boot rodava como SYSTEM,
    que tem outro PM2 (vazio). Resultado: depois de um reboot a API nao subia.

.EXAMPLE
    .\scripts\instalar-servico.ps1
#>

[CmdletBinding()]
param(
    [string]$Dominio = 'notrole.exemplo.com.br',
    [int]$PortaApi = 3333
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$raiz = Split-Path -Parent $PSScriptRoot
$nomeSite = 'Proxy-Notrole'
$pastaSite = 'C:\inetpub\wwwroot\notrole'
$tarefaApi = 'Notrole - API'
$tarefaWatchdog = 'Notrole - Watchdog'
$tarefaAntiga = 'Notrole - Inicializacao Automatica'

function Etapa([string]$texto) { Write-Host ''; Write-Host "==> $texto" -ForegroundColor Cyan }

$souAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $souAdmin) { throw 'Rode este script num PowerShell "Executar como administrador".' }

# --- Certificado ------------------------------------------------------------
Etapa "Certificado de $Dominio"
$cert = Get-ChildItem Cert:\LocalMachine\My |
    Where-Object { $_.HasPrivateKey -and $_.NotAfter -gt (Get-Date) -and ($_.DnsNameList.Unicode -contains $Dominio) } |
    Sort-Object NotAfter -Descending | Select-Object -First 1
if (-not $cert) { throw "Nenhum certificado valido com chave privada para $Dominio em LocalMachine\My." }
Write-Host "Usando $($cert.Thumbprint) (vale ate $($cert.NotAfter.ToString('dd/MM/yyyy')))."

# --- IIS ----------------------------------------------------------------------
Etapa 'IIS: servico'
Set-Service W3SVC -StartupType Automatic
Start-Service W3SVC
Import-Module WebAdministration
$appcmd = "$env:windir\System32\inetsrv\appcmd.exe"

Etapa 'IIS: proxy reverso (ARR)'
# O nome do atributo e includePortInXForwardedFor. Com o nome errado o appcmd
# recusava o comando inteiro e o Out-Null escondia o erro.
$saidaArr = & $appcmd set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /includePortInXForwardedFor:"False" /reverseRewriteHostInResponseHeaders:"False" /timeout:"00:02:00" /commit:apphost
if ($LASTEXITCODE -ne 0) { throw "Falha ao configurar o ARR: $saidaArr" }
$variaveis = & $appcmd list config -section:system.webServer/rewrite/allowedServerVariables
if (-not ($variaveis -match 'HTTP_X_FORWARDED_PROTO')) {
    & $appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost | Out-Null
}

Etapa 'IIS: app pool'
if (-not (Test-Path "IIS:\AppPools\$nomeSite")) { New-WebAppPool -Name $nomeSite | Out-Null }
Set-ItemProperty "IIS:\AppPools\$nomeSite" -Name managedRuntimeVersion -Value ''
Set-ItemProperty "IIS:\AppPools\$nomeSite" -Name startMode -Value 'AlwaysRunning'
Set-ItemProperty "IIS:\AppPools\$nomeSite" -Name autoStart -Value $true
Set-ItemProperty "IIS:\AppPools\$nomeSite" -Name processModel.idleTimeout -Value ([TimeSpan]::Zero)
Set-ItemProperty "IIS:\AppPools\$nomeSite" -Name recycling.periodicRestart.time -Value ([TimeSpan]::Zero)

Etapa 'IIS: web.config do proxy'
New-Item -ItemType Directory -Force $pastaSite | Out-Null
$webConfig = @"
<?xml version="1.0" encoding="UTF-8"?>
<!-- Gerado por C:\Sistemas\Notrole\scripts\instalar-servico.ps1. Nao edite aqui. -->
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="Notrole - http para https" stopProcessing="true">
          <match url="(.*)" />
          <conditions><add input="{HTTPS}" pattern="off" /></conditions>
          <action type="Redirect" url="https://{HTTP_HOST}/{R:1}" redirectType="Found" />
        </rule>
        <rule name="Notrole - proxy para a API" stopProcessing="true">
          <match url="(.*)" />
          <serverVariables>
            <set name="HTTP_X_FORWARDED_PROTO" value="https" />
          </serverVariables>
          <action type="Rewrite" url="http://127.0.0.1:$PortaApi/{R:1}" />
        </rule>
      </rules>
    </rewrite>
    <httpErrors existingResponse="PassThrough" />
  </system.webServer>
</configuration>
"@
Set-Content -Path (Join-Path $pastaSite 'web.config') -Value $webConfig -Encoding UTF8

Etapa 'IIS: site e bindings'
if (-not (Get-Website -Name $nomeSite)) {
    New-Website -Name $nomeSite -PhysicalPath $pastaSite -ApplicationPool $nomeSite -Port 80 -HostHeader $Dominio | Out-Null
}
Set-ItemProperty "IIS:\Sites\$nomeSite" -Name physicalPath -Value $pastaSite
Set-ItemProperty "IIS:\Sites\$nomeSite" -Name applicationPool -Value $nomeSite
Set-ItemProperty "IIS:\Sites\$nomeSite" -Name serverAutoStart -Value $true

if (-not (Get-WebBinding -Name $nomeSite -Protocol http -Port 80 -HostHeader $Dominio)) {
    New-WebBinding -Name $nomeSite -Protocol http -Port 80 -HostHeader $Dominio
}
if (-not (Get-WebBinding -Name $nomeSite -Protocol https -Port 443 -HostHeader $Dominio)) {
    New-WebBinding -Name $nomeSite -Protocol https -Port 443 -HostHeader $Dominio -SslFlags 1
}
# Associa (ou troca) o certificado do binding SNI.
$sslAtual = Get-Item "IIS:\SslBindings\!443!$Dominio" -ErrorAction SilentlyContinue
if ($sslAtual -and $sslAtual.Thumbprint -ne $cert.Thumbprint) { Remove-Item "IIS:\SslBindings\!443!$Dominio" }
if (-not $sslAtual -or $sslAtual.Thumbprint -ne $cert.Thumbprint) {
    (Get-WebBinding -Name $nomeSite -Protocol https -Port 443 -HostHeader $Dominio).AddSslCertificate($cert.Thumbprint, 'My')
}

Start-WebAppPool -Name $nomeSite -ErrorAction SilentlyContinue
Start-Website -Name $nomeSite -ErrorAction SilentlyContinue

# --- Pasta de logs -------------------------------------------------------------
Etapa 'Pasta de logs (NETWORK SERVICE precisa gravar)'
$pastaLogs = Join-Path $raiz 'logs'
New-Item -ItemType Directory -Force $pastaLogs | Out-Null
& icacls $pastaLogs /grant '*S-1-5-20:(OI)(CI)M' | Out-Null

# --- Segredos -----------------------------------------------------------------
# O .env herdava "Usuarios: leitura" da pasta, e este servidor tem outros
# usuarios. So SYSTEM, Administradores e a conta da API (NETWORK SERVICE) leem.
Etapa 'Protegendo o .env'
foreach ($arquivoSegredo in @(Get-ChildItem $raiz -Filter '.env*' -File -Force | Where-Object { $_.Name -ne '.env.example' })) {
    & icacls $arquivoSegredo.FullName /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-20:R' | Out-Null
    Write-Host "$($arquivoSegredo.Name) protegido."
}

# --- Firewall -------------------------------------------------------------------
# A API so atende o IIS, na propria maquina (HOST=127.0.0.1). Uma regra abrindo
# a porta para a rede so serviria para contornar o HTTPS.
Etapa "Firewall: porta $PortaApi fechada para a rede"
Get-NetFirewallRule -Direction Inbound -Enabled True -ErrorAction SilentlyContinue |
    Where-Object { ($_ | Get-NetFirewallPortFilter).LocalPort -contains "$PortaApi" } |
    ForEach-Object { Disable-NetFirewallRule -Name $_.Name; Write-Host "Regra '$($_.DisplayName)' desativada." }

# --- Desliga o PM2 --------------------------------------------------------------
Etapa 'Removendo o PM2 e a tarefa antiga'
if (Get-ScheduledTask -TaskName $tarefaAntiga -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $tarefaAntiga -Confirm:$false
    Write-Host "Tarefa '$tarefaAntiga' removida."
}
Push-Location $raiz
try {
    & npx --no-install pm2 delete notrole-api 2>&1 | Out-Null
    & npx --no-install pm2 save --force 2>&1 | Out-Null
    & npx --no-install pm2 kill 2>&1 | Out-Null
} catch { }
Pop-Location
# Sobra de API fora das tarefas (PM2 de outra conta, terminal esquecido...).
# Filtra pela linha de comando para nao derrubar outros sistemas Node.
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'src[/\\]api[/\\]server\.ts|dist-server[/\\]server\.mjs' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Processo da API $($_.ProcessId) encerrado." }

# --- Tarefas agendadas ---------------------------------------------------------
function Registrar-Tarefa([string]$nome, [string]$xml) {
    if (Get-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue) {
        Stop-ScheduledTask -TaskName $nome -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $nome -Confirm:$false
    }
    Register-ScheduledTask -TaskName $nome -Xml $xml | Out-Null
    Write-Host "Tarefa '$nome' registrada."
}

$powershell = "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe"
$inicio = (Get-Date).AddMinutes(1).ToString('yyyy-MM-ddTHH:mm:ss')

Etapa "Tarefa '$tarefaApi'"
$xmlApi = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>API do Notrole (porta $PortaApi). Vigiada pela tarefa '$tarefaWatchdog'. Instalada por scripts\instalar-servico.ps1.</Description></RegistrationInfo>
  <Triggers>
    <BootTrigger><Enabled>true</Enabled><Delay>PT30S</Delay></BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>S-1-5-20</UserId><RunLevel>LeastPrivilege</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>5</Priority>
    <RestartOnFailure><Interval>PT1M</Interval><Count>999</Count></RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$powershell</Command>
      <Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$raiz\scripts\servico\iniciar-api.ps1"</Arguments>
      <WorkingDirectory>$raiz</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Registrar-Tarefa $tarefaApi $xmlApi

Etapa "Tarefa '$tarefaWatchdog'"
$xmlWatchdog = @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Confere a cada minuto o IIS e a API do Notrole e corrige o que estiver parado. Log em $raiz\logs\watchdog.log. Instalada por scripts\instalar-servico.ps1.</Description></RegistrationInfo>
  <Triggers>
    <!-- Um gatilho so. Com um BootTrigger repetindo junto, a tarefa rodava duas
         vezes por minuto. O TimeTrigger continua valendo depois do reboot. -->
    <TimeTrigger><Enabled>true</Enabled><StartBoundary>$inicio</StartBoundary><Repetition><Interval>PT1M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></TimeTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author"><UserId>S-1-5-18</UserId><RunLevel>HighestAvailable</RunLevel></Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <Priority>5</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>$powershell</Command>
      <Arguments>-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$raiz\scripts\servico\watchdog.ps1"</Arguments>
      <WorkingDirectory>$raiz</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
"@
Registrar-Tarefa $tarefaWatchdog $xmlWatchdog

# --- Sobe e confere -------------------------------------------------------------
Etapa 'Subindo a API'
Start-ScheduledTask -TaskName $tarefaApi
$ok = $false
foreach ($i in 1..20) {
    Start-Sleep -Seconds 3
    try { if ((Invoke-RestMethod "http://127.0.0.1:$PortaApi/api/health" -TimeoutSec 5).status -eq 'ok') { $ok = $true; break } } catch { }
}
if (-not $ok) { throw "A API nao respondeu. Veja $raiz\logs\api.log" }
Write-Host 'API respondendo.' -ForegroundColor Green

Etapa "Conferindo https://$Dominio"
try {
    $r = Invoke-RestMethod "https://$Dominio/api/health" -TimeoutSec 15
    Write-Host "HTTPS ok: $($r.status)" -ForegroundColor Green
}
catch { Write-Host "HTTPS falhou: $($_.Exception.Message)" -ForegroundColor Red; exit 1 }

Write-Host ''
Write-Host 'Pronto. O Notrole sobe sozinho no boot e e vigiado a cada minuto.' -ForegroundColor Green
