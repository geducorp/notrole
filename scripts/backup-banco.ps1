<#
.SINOPSE
    Backup do banco do Notrole.

.DESCRICAO
    Gera um dump comprimido do PostgreSQL (formato custom, restauravel com
    pg_restore), guarda em -Destino e apaga os backups mais antigos que
    -DiasParaGuardar. Tambem copia o .env, que nao esta no git e sem o qual o
    sistema nao sobe.

    Os dados de conexao vem do DATABASE_URL do .env: nenhuma senha fica escrita
    aqui nem na tarefa agendada.

    Feito para rodar todo dia pelo Agendador de Tarefas. Para criar a tarefa:
        .\scripts\backup-banco.ps1 -InstalarTarefa

.EXEMPLO
    .\scripts\backup-banco.ps1
    .\scripts\backup-banco.ps1 -Destino D:\Backups\Notrole -DiasParaGuardar 60
    .\scripts\backup-banco.ps1 -InstalarTarefa -Hora 21:30
#>
[CmdletBinding()]
param(
    [string]$Destino = 'C:\Backups\Notrole',
    [int]$DiasParaGuardar = 30,
    [switch]$InstalarTarefa,
    [string]$Hora = '21:00'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot

function Escrever($texto, $cor = 'Gray') { Write-Host $texto -ForegroundColor $cor }

# ---------------------------------------------------------------------------
# Instalacao da tarefa agendada
# ---------------------------------------------------------------------------

if ($InstalarTarefa) {
    $comando = "-NoProfile -ExecutionPolicy Bypass -File `"$PSCommandPath`" -Destino `"$Destino`" -DiasParaGuardar $DiasParaGuardar"
    $acao = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $comando -WorkingDirectory $raiz
    $gatilho = New-ScheduledTaskTrigger -Daily -At $Hora
    $config = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Hours 2)

    Register-ScheduledTask -TaskName 'Notrole - Backup do banco' -Action $acao -Trigger $gatilho `
        -Settings $config -User 'SYSTEM' -RunLevel Highest -Force | Out-Null

    Escrever "Tarefa 'Notrole - Backup do banco' criada: todo dia as $Hora." Green
    Escrever "Destino: $Destino (mantendo $DiasParaGuardar dias)." Gray
    Escrever 'Para rodar agora: Start-ScheduledTask -TaskName "Notrole - Backup do banco"' Gray
    return
}

# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------

# Log em arquivo: a tarefa roda sem console, e sem isso uma falha nao deixava
# rastro. O watchdog confere o resultado da tarefa e avisa por e-mail.
$pastaLog = Join-Path $raiz 'logs'
New-Item -ItemType Directory -Force $pastaLog | Out-Null
$arquivoLog = Join-Path $pastaLog 'backup.log'
if ((Test-Path $arquivoLog) -and (Get-Item $arquivoLog).Length -gt 2MB) { Move-Item $arquivoLog "$arquivoLog.1" -Force }
Start-Transcript -Path $arquivoLog -Append | Out-Null
Escrever "=== Backup iniciado em $(Get-Date -Format 'dd/MM/yyyy HH:mm:ss') ===" Cyan

$envPath = Join-Path $raiz '.env'
if (-not (Test-Path $envPath)) { throw "Arquivo .env nao encontrado em $envPath." }

$linhaUrl = Select-String -Path $envPath -Pattern '^\s*DATABASE_URL\s*=' | Select-Object -First 1
if (-not $linhaUrl) { throw 'DATABASE_URL nao encontrado no .env.' }

$url = ($linhaUrl.Line -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
# postgresql://usuario:senha@host:porta/banco?parametros
$padrao = '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)'
$m = [regex]::Match($url, $padrao)
if (-not $m.Success) { throw 'Nao consegui interpretar o DATABASE_URL do .env.' }

$usuario = [uri]::UnescapeDataString($m.Groups[1].Value)
$senha   = [uri]::UnescapeDataString($m.Groups[2].Value)
$host_   = $m.Groups[3].Value
$porta   = if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' }
$banco   = $m.Groups[5].Value

# Caminho do pg_dump: o do PATH ou, se nao houver, o da instalacao local.
$pgDump = (Get-Command pg_dump -ErrorAction SilentlyContinue).Source
if (-not $pgDump) {
    $pgDump = Get-ChildItem 'C:\Program Files\PostgreSQL\*\bin\pg_dump.exe' -ErrorAction SilentlyContinue |
        Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (-not $pgDump) { throw 'pg_dump nao encontrado. Instale as ferramentas de cliente do PostgreSQL.' }

if (-not (Test-Path $Destino)) {
    New-Item -ItemType Directory -Path $Destino -Force | Out-Null
    # A copia do .env leva segredos: a pasta fica so para administradores.
    & icacls $Destino /inheritance:r /grant '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' | Out-Null
}
$carimbo = Get-Date -Format 'yyyyMMdd-HHmm'
$arquivo = Join-Path $Destino "notrole-$carimbo.dump"

Escrever "Gerando backup de $banco em $host_..." Cyan
$env:PGPASSWORD = $senha
try {
    & $pgDump -h $host_ -p $porta -U $usuario -d $banco -F c -f $arquivo
    if ($LASTEXITCODE -ne 0) { throw "pg_dump terminou com erro $LASTEXITCODE." }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}

if ((Get-Item $arquivo).Length -lt 10KB) { throw "O dump gerado esta vazio ou pequeno demais ($((Get-Item $arquivo).Length) bytes)." }
$tamanho = [math]::Round((Get-Item $arquivo).Length / 1MB, 2)
Escrever "Backup gravado: $arquivo ($tamanho MB)" Green

# O .env nao esta no git e e necessario para subir o sistema.
$copiaEnv = Join-Path $Destino "env-$carimbo.txt"
Copy-Item $envPath $copiaEnv -Force
# O Copy-Item preserva a data do original. Sem isto, todas as copias ficavam
# com a data do .env e, passados DiasParaGuardar, a limpeza apagava todas -
# inclusive a que acabou de ser feita.
(Get-Item $copiaEnv).LastWriteTime = Get-Date
Escrever 'Copia do .env guardada junto.' Gray

# ---------------------------------------------------------------------------
# Limpeza
# ---------------------------------------------------------------------------

# A data vem do nome do arquivo (notrole-yyyyMMdd-HHmm.dump), nao da data de
# modificacao. E os 7 mais recentes de cada tipo nunca sao apagados, mesmo que
# o backup tenha ficado parado por semanas.
$limite = (Get-Date).AddDays(-$DiasParaGuardar)
function Data-DoNome($arquivo) {
    $m = [regex]::Match($arquivo.Name, '(\d{8}-\d{4})')
    if (-not $m.Success) { return $arquivo.LastWriteTime }
    return [datetime]::ParseExact($m.Groups[1].Value, 'yyyyMMdd-HHmm', $null)
}
$antigos = foreach ($padraoNome in 'notrole-*.dump', 'env-*.txt') {
    Get-ChildItem $Destino -Filter $padraoNome -File |
        Sort-Object { Data-DoNome $_ } -Descending |
        Select-Object -Skip 7 |
        Where-Object { (Data-DoNome $_) -lt $limite }
}

foreach ($item in $antigos) { Remove-Item $item.FullName -Force }
if ($antigos) { Escrever "$($antigos.Count) arquivo(s) com mais de $DiasParaGuardar dias removido(s)." Gray }

$total = (Get-ChildItem $Destino -Filter 'notrole-*.dump' -File | Measure-Object).Count
Escrever "Backups guardados: $total." Gray
Escrever ''
Escrever 'Para restaurar:' Yellow
Escrever "  pg_restore -h $host_ -p $porta -U $usuario -d $banco --clean --if-exists `"$arquivo`"" Gray
Stop-Transcript | Out-Null
