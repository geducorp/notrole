<#
.SYNOPSIS
    Publica uma nova versao do Notrole no servidor.

.DESCRIPTION
    Roda na propria pasta do projeto (PowerShell como administrador):

      1. marca manutencao (logs\manutencao.lock): o watchdog nao mexe na API
      2. para a API de forma ordenada
      3. npm install
      4. prisma migrate deploy + generate
      5. npm run typecheck              (falha aqui interrompe o deploy)
      6. compila frontend e backend em pastas novas (dist.novo, dist-server.novo)
      7. troca as pastas: a versao anterior fica em dist.anterior / dist-server.anterior
      8. sobe a API e confere /api/health e /api/ready

    Aconteca o que acontecer, no fim a API e religada (com a versao nova, se
    tudo passou, ou com a que ja estava) e a marca de manutencao e removida.
    Se algo falhar, vai um e-mail para ALERTA_EMAIL.

    A API fica parada do passo 2 ao 8: o processo dela trava arquivos de
    node_modules (a DLL do Prisma), e o npm install e o prisma generate falham
    com EPERM se ela estiver rodando.

.PARAMETER PularMigracao
    Nao executa as migracoes do banco.

.PARAMETER PularInstalacao
    Nao executa o npm install. Util quando so mudou codigo.

.EXAMPLE
    .\scripts\deploy.ps1
#>

[CmdletBinding()]
param(
    [switch]$PularMigracao,
    [switch]$PularInstalacao
)

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
. (Join-Path $PSScriptRoot 'servico\comum.ps1')

$tarefaApi = 'Notrole - API'
$etapaAtual = 'inicio'
$trocouVersao = $false

function Escrever-Etapa([string]$texto) {
    $script:etapaAtual = $texto
    Write-Host ''
    Write-Host "==> $texto" -ForegroundColor Cyan
}

function Exigir-Sucesso {
    if ($LASTEXITCODE -ne 0) { throw "'$etapaAtual' terminou com codigo $LASTEXITCODE." }
}

function Subir-Api {
    if ((Get-ScheduledTask -TaskName $tarefaApi).State -eq 'Disabled') { Enable-ScheduledTask -TaskName $tarefaApi | Out-Null }
    if ((Get-ScheduledTask -TaskName $tarefaApi).State -ne 'Running') { Start-ScheduledTask -TaskName $tarefaApi }
}

function Aguardar-Api([int]$segundos = 120) {
    $limite = (Get-Date).AddSeconds($segundos)
    while ((Get-Date) -lt $limite) {
        Start-Sleep -Seconds 3
        try {
            $saude = Invoke-RestMethod -Uri 'http://127.0.0.1:3333/api/health' -TimeoutSec 5
            $pronto = Invoke-RestMethod -Uri 'http://127.0.0.1:3333/api/ready' -TimeoutSec 5
            if ($saude.status -eq 'ok' -and $pronto.status -eq 'ok') { return $true }
        }
        catch { Write-Host '  aguardando a API subir...' }
    }
    return $false
}

Write-Host 'Notrole - deploy' -ForegroundColor Green
Write-Host "Pasta: $raiz"

if (-not (Test-Path '.env')) {
    Write-Host 'Arquivo .env nao encontrado. Copie .env.example para .env e preencha os valores.' -ForegroundColor Red
    exit 1
}

$souAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $souAdmin) {
    Write-Host 'Abra o PowerShell com "Executar como administrador" e rode o deploy de novo.' -ForegroundColor Red
    exit 1
}

if (-not (Get-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue)) {
    Write-Host "Tarefa '$tarefaApi' nao encontrada. Rode antes: .\scripts\instalar-servico.ps1" -ForegroundColor Red
    exit 1
}

$commit = (git rev-parse --short HEAD 2>$null)
$sucesso = $false
$erro = $null

New-Item -ItemType Directory -Force $PastaLogNotrole | Out-Null
Set-Content -Path $ArquivoManutencao -Value "deploy iniciado em $(Get-Date -Format o) por $env:USERNAME"
Remove-Item (Join-Path $PastaLogNotrole 'watchdog.falhas') -ErrorAction SilentlyContinue

# A partir daqui, falha de comando externo (npm, npx) e conferida pelo codigo de
# saida. Com 'Stop', o aviso que o npm escreve no stderr viraria erro quando o
# deploy e rodado remotamente (Invoke-Command).
$ErrorActionPreference = 'Continue'

try {
    Escrever-Etapa 'Parando a API'
    if (Parar-ApiOrdenado 20) { Write-Host 'API encerrada de forma ordenada.' }
    else { Write-Host 'A API nao encerrou sozinha em 20 s; encerrando a forca.' -ForegroundColor Yellow }
    Stop-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue
    Encerrar-ProcessosApi | Out-Null
    # Da um instante para o Windows soltar os handles dos arquivos.
    Start-Sleep -Seconds 3

    if (-not $PularInstalacao) {
        Escrever-Etapa 'Instalando dependencias'
        npm install --no-audit --no-fund
        Exigir-Sucesso
    }

    if (-not $PularMigracao) {
        Escrever-Etapa 'Aplicando migracoes do banco'
        npx prisma migrate deploy
        Exigir-Sucesso
    }

    Escrever-Etapa 'Gerando o Prisma Client'
    npx prisma generate
    Exigir-Sucesso

    # Fica ANTES do build de proposito: e o passo que teria apontado, meses
    # atras, os 15 erros de campos inexistentes que so apareciam como erro 500.
    Escrever-Etapa 'Verificando tipos (backend + frontend)'
    npm run typecheck
    Exigir-Sucesso

    Escrever-Etapa 'Compilando o frontend'
    Remove-Item dist.novo -Recurse -Force -ErrorAction SilentlyContinue
    npx vite build --outDir dist.novo --emptyOutDir
    Exigir-Sucesso

    Escrever-Etapa 'Compilando o backend'
    Remove-Item dist-server.novo -Recurse -Force -ErrorAction SilentlyContinue
    npx esbuild src/api/server.ts --bundle --platform=node --target=node20 --format=esm --packages=external --sourcemap --log-level=warning --outfile=dist-server.novo/server.mjs
    Exigir-Sucesso

    Escrever-Etapa 'Trocando para a versao nova'
    foreach ($pasta in 'dist', 'dist-server') {
        Remove-Item "$pasta.anterior" -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $pasta) { Move-Item $pasta "$pasta.anterior" -ErrorAction Stop }
        Move-Item "$pasta.novo" $pasta -ErrorAction Stop
    }
    $trocouVersao = $true

    Escrever-Etapa 'Subindo a API'
    Subir-Api
    if (-not (Aguardar-Api 120)) {
        throw 'A API nao respondeu em /api/health e /api/ready em 2 minutos.'
    }
    Write-Host 'API respondendo, banco ok.' -ForegroundColor Green
    $sucesso = $true
}
catch {
    $erro = $_.Exception.Message
    Write-Host ''
    Write-Host "FALHA em: $etapaAtual" -ForegroundColor Red
    Write-Host $erro -ForegroundColor Red
}
finally {
    # Sempre religa a API e libera o watchdog, mesmo com Ctrl+C ou erro.
    try { Subir-Api } catch { Write-Host "Nao consegui religar a tarefa: $($_.Exception.Message)" -ForegroundColor Red }
    Remove-Item $ArquivoManutencao -ErrorAction SilentlyContinue
}

if ($sucesso) {
    Write-Host ''
    Write-Host "Deploy concluido ($commit)." -ForegroundColor Green
    Write-Host 'Para voltar a versao anterior, se precisar: .\scripts\voltar-versao.ps1' -ForegroundColor Gray
    exit 0
}

$situacao = if ($trocouVersao) {
    'A versao NOVA foi colocada no ar, mas a API nao respondeu. Para voltar a anterior: .\scripts\voltar-versao.ps1'
} else {
    'A versao que ja estava no ar foi religada (nada foi trocado).'
}
Write-Host ''
Write-Host $situacao -ForegroundColor Yellow
Write-Host "Log da API: Get-Content $raiz\logs\api.log -Tail 50" -ForegroundColor Yellow

Enviar-Email "PROBLEMA: deploy falhou em '$etapaAtual'" "O deploy do Notrole (commit $commit) falhou na etapa '$etapaAtual'.`n`nErro: $erro`n`n$situacao" | Out-Null
exit 1
