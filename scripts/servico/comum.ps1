<#
.SYNOPSIS
    Funcoes compartilhadas por watchdog.ps1, deploy.ps1 e backup-banco.ps1.
    Uso: . "$PSScriptRoot\comum.ps1" (ou o caminho equivalente).
#>

$script:RaizNotrole = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$script:PastaLogNotrole = Join-Path $script:RaizNotrole 'logs'
$script:PastaAlertas = Join-Path $script:PastaLogNotrole 'alertas'

# Arquivo que o deploy cria enquanto mexe na API. O watchdog nao briga com ele
# (ate MinutosMaximosManutencao; depois disso avisa por e-mail).
$script:ArquivoManutencao = Join-Path $script:PastaLogNotrole 'manutencao.lock'

# Arquivo-sinal para a API se desligar sozinha, de forma ordenada (fecha o HTTP,
# para as rotinas e desconecta do banco). No Windows o Stop-ScheduledTask mata o
# processo na hora, sem SIGTERM.
$script:ArquivoSinalParar = Join-Path $script:PastaLogNotrole 'parar-api.sinal'

function Get-NodeExe {
    $node = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $node) { $node = 'C:\Program Files\nodejs\node.exe' }
    return $node
}

<#
  Processos node.exe que sao a API do Notrole. Filtra pela linha de comando
  para nao derrubar outros sistemas Node deste servidor.
#>
function Get-ProcessosApi {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
        Where-Object { $_.CommandLine -match 'src[/\\]api[/\\]server\.ts|dist-server[/\\]server\.mjs' }
}

<#
  O powershell.exe que roda iniciar-api.ps1 (o "launcher" da tarefa). Serve
  para saber ha quanto tempo a API esta subindo.
#>
function Get-LauncherApi {
    Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
        Where-Object { $_.CommandLine -match 'iniciar-api\.ps1' } |
        Sort-Object CreationDate -Descending | Select-Object -First 1
}

<#
  Pede a API para encerrar de forma ordenada e espera ate $Segundos. Devolve
  $true se ela saiu sozinha. Quem chama decide se mata a forca depois.
#>
function Parar-ApiOrdenado([int]$Segundos = 20) {
    if (-not (Get-ProcessosApi)) { return $true }
    New-Item -ItemType Directory -Force $script:PastaLogNotrole | Out-Null
    Set-Content -Path $script:ArquivoSinalParar -Value (Get-Date -Format o)
    $limite = (Get-Date).AddSeconds($Segundos)
    while ((Get-Date) -lt $limite) {
        Start-Sleep -Seconds 1
        if (-not (Get-ProcessosApi)) { break }
    }
    Remove-Item $script:ArquivoSinalParar -ErrorAction SilentlyContinue
    return (-not (Get-ProcessosApi))
}

function Encerrar-ProcessosApi {
    Get-ProcessosApi | ForEach-Object {
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
        $_.ProcessId
    }
}

<#
  Envia um e-mail pelo SMTP do .env (scripts\servico\alerta.mjs).
  Devolve $true se enviou.
#>
function Enviar-Email([string]$Assunto, [string]$Texto) {
    $script = Join-Path $script:RaizNotrole 'scripts\servico\alerta.mjs'
    try {
        $saida = & (Get-NodeExe) $script $Assunto $Texto 2>&1
        return ($LASTEXITCODE -eq 0)
    }
    catch { return $false }
}

<#
  Alertas com estado: o primeiro aviso de um problema sai na hora; enquanto ele
  continuar, um lembrete a cada $LembreteMinutos; quando resolver, um e-mail de
  "resolvido". Assim um problema que dura uma hora nao gera 60 e-mails.

  O estado fica em logs\alertas\<chave>.json.
#>
function Abrir-Alerta([string]$Chave, [string]$Assunto, [string]$Texto, [int]$LembreteMinutos = 60) {
    New-Item -ItemType Directory -Force $script:PastaAlertas | Out-Null
    $arquivo = Join-Path $script:PastaAlertas "$Chave.json"
    $agora = Get-Date
    $estado = $null
    if (Test-Path $arquivo) {
        try { $estado = Get-Content $arquivo -Raw | ConvertFrom-Json } catch { $estado = $null }
    }

    if ($estado) {
        $ultimo = [datetime]::Parse($estado.ultimoEnvio)
        if (($agora - $ultimo).TotalMinutes -lt $LembreteMinutos) { return }
        $desde = [datetime]::Parse($estado.desde)
        $Assunto = "CONTINUA: $Assunto"
        $Texto = "O problema continua desde $($desde.ToString('dd/MM/yyyy HH:mm')).`n`n$Texto"
    }
    else {
        $estado = [pscustomobject]@{ desde = $agora.ToString('o'); ultimoEnvio = $null; assunto = $Assunto }
    }

    if (Enviar-Email "PROBLEMA: $Assunto" $Texto) {
        $estado.ultimoEnvio = $agora.ToString('o')
    }
    elseif (-not $estado.ultimoEnvio) {
        # Nao conseguiu enviar: tenta de novo na proxima rodada.
        $estado.ultimoEnvio = $agora.AddMinutes(-$LembreteMinutos).ToString('o')
    }
    $estado | ConvertTo-Json | Set-Content -Path $arquivo -Encoding UTF8
}

function Fechar-Alerta([string]$Chave, [string]$Texto) {
    $arquivo = Join-Path $script:PastaAlertas "$Chave.json"
    if (-not (Test-Path $arquivo)) { return }
    try { $estado = Get-Content $arquivo -Raw | ConvertFrom-Json } catch { $estado = $null }
    $assunto = if ($estado -and $estado.assunto) { $estado.assunto } else { $Chave }
    $desde = if ($estado) { [datetime]::Parse($estado.desde).ToString('dd/MM/yyyy HH:mm') } else { '?' }
    if (Enviar-Email "RESOLVIDO: $assunto" "$Texto`n`nO problema tinha comecado em $desde.") {
        Remove-Item $arquivo -ErrorAction SilentlyContinue
    }
}
