<#
.SYNOPSIS
    Sobe a API do Notrole e grava o log com data e hora.

.DESCRIPTION
    E a acao da tarefa agendada "Notrole - API" (ver instalar-servico.ps1).
    Nao rode na mao em producao: a tarefa e o watchdog ja cuidam disso, e uma
    segunda instancia duplicaria os e-mails das rotinas (node-cron).

    Roda o backend ja compilado (dist-server\server.mjs, gerado pelo deploy com
    "npm run build:api"). Compilar na hora com o tsx levava ~60 s na partida a
    frio depois de um reboot; o compilado sobe em poucos segundos. Se o
    compilado nao existir, cai para o tsx.

    O processo roda em primeiro plano. Quando o Node termina, este script
    termina com o mesmo codigo de saida, e o watchdog sobe a tarefa de novo no
    minuto seguinte.

    O log e gravado linha a linha (Add-Content abre e fecha o arquivo), entao
    o watchdog consegue rotaciona-lo com a API no ar.
#>

$ErrorActionPreference = 'Continue'

$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $raiz

$pastaLog = Join-Path $raiz 'logs'
$arquivoLog = Join-Path $pastaLog 'api.log'
New-Item -ItemType Directory -Force $pastaLog | Out-Null

function Gravar([string]$linha) {
    $carimbo = Get-Date -Format 'dd/MM/yyyy HH:mm:ss'
    try { Add-Content -Path $arquivoLog -Value "$carimbo $linha" -Encoding UTF8 } catch { }
}

$env:NODE_ENV = 'production'

# Sinal de parada esquecido de uma parada anterior derrubaria a API logo ao subir.
Remove-Item (Join-Path $pastaLog 'parar-api.sinal') -ErrorAction SilentlyContinue

$compilado = Join-Path $raiz 'dist-server\server.mjs'
if (Test-Path $compilado) {
    Gravar "[servico] Iniciando a API compilada (usuario $env:USERNAME, pid do launcher $PID)."
    & node --enable-source-maps dist-server/server.mjs 2>&1 | ForEach-Object { Gravar "$_" }
}
else {
    Gravar "[servico] dist-server\server.mjs nao existe: iniciando pelo tsx (mais lento). Rode o deploy."
    # "node --import tsx" roda tudo num processo so. O "tsx" de linha de comando
    # abre um processo filho, que pode ficar orfao quando a tarefa e encerrada.
    & node --import tsx src/api/server.ts 2>&1 | ForEach-Object { Gravar "$_" }
}
$codigo = $LASTEXITCODE

Gravar "[servico] A API terminou com codigo $codigo."
exit $codigo
