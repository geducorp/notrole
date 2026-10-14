<#
.SYNOPSIS
    Volta o Notrole para a versao compilada anterior ao ultimo deploy.

.DESCRIPTION
    O deploy guarda a versao que estava no ar em dist.anterior e
    dist-server.anterior. Este script troca as pastas de volta e reinicia a API.
    Nao mexe no banco: se o deploy aplicou uma migracao, a versao anterior roda
    sobre o banco novo (o que normalmente funciona, porque as migracoes so
    acrescentam). Para desfazer uma migracao, restaure o backup (OPERACAO.md).

    PowerShell como administrador.
#>

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
. (Join-Path $PSScriptRoot 'servico\comum.ps1')

$tarefaApi = 'Notrole - API'

foreach ($pasta in 'dist', 'dist-server') {
    if (-not (Test-Path "$pasta.anterior")) { throw "Nao existe $pasta.anterior: nao ha versao anterior guardada." }
}

Set-Content -Path $ArquivoManutencao -Value "voltar-versao em $(Get-Date -Format o) por $env:USERNAME"
try {
    if (-not (Parar-ApiOrdenado 20)) { Write-Host 'Encerrando a API a forca.' -ForegroundColor Yellow }
    Stop-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue
    Encerrar-ProcessosApi | Out-Null
    Start-Sleep -Seconds 2

    foreach ($pasta in 'dist', 'dist-server') {
        Remove-Item "$pasta.troca" -Recurse -Force -ErrorAction SilentlyContinue
        if (Test-Path $pasta) { Move-Item $pasta "$pasta.troca" }
        Move-Item "$pasta.anterior" $pasta
        # A versao que saiu vira a "anterior": rodar de novo desfaz a volta.
        if (Test-Path "$pasta.troca") { Move-Item "$pasta.troca" "$pasta.anterior" }
    }
    Write-Host 'Pastas trocadas.' -ForegroundColor Green
}
finally {
    if ((Get-ScheduledTask -TaskName $tarefaApi).State -eq 'Disabled') { Enable-ScheduledTask -TaskName $tarefaApi | Out-Null }
    Start-ScheduledTask -TaskName $tarefaApi
    Remove-Item $ArquivoManutencao -ErrorAction SilentlyContinue
}

foreach ($i in 1..40) {
    Start-Sleep -Seconds 3
    try {
        if ((Invoke-RestMethod 'http://127.0.0.1:3333/api/health' -TimeoutSec 5).status -eq 'ok') {
            Write-Host 'API respondendo com a versao anterior.' -ForegroundColor Green
            exit 0
        }
    } catch { }
}
Write-Host "A API nao respondeu. Veja $raiz\logs\api.log" -ForegroundColor Red
exit 1
