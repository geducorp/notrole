<#
.SYNOPSIS
    Mostra o que ja esta configurado no .env e o que falta.

.DESCRIPTION
    Nao exibe nenhum valor: apenas se a variavel esta preenchida e o que
    acontece quando ela nao esta.

.EXAMPLE
    .\scripts\conferir-config.ps1
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$raiz = Split-Path -Parent $PSScriptRoot
$envPath = Join-Path $raiz '.env'

if (-not (Test-Path $envPath)) {
    Write-Host 'Arquivo .env nao encontrado.' -ForegroundColor Red
    exit 1
}

$valores = @{}
foreach ($linha in Get-Content $envPath) {
    if ($linha -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') {
        $valores[$Matches[1]] = $Matches[2].Trim()
    }
}

function Conferir {
    param(
        [string]$Chave,
        [string]$Consequencia,
        [ValidateSet('obrigatorio', 'recomendado', 'opcional')]
        [string]$Peso = 'obrigatorio'
    )

    $preenchido = $valores.ContainsKey($Chave) -and -not [string]::IsNullOrWhiteSpace($valores[$Chave])

    if ($preenchido) {
        Write-Host '  [ok]      ' -ForegroundColor Green -NoNewline
        Write-Host $Chave
        return
    }

    switch ($Peso) {
        'obrigatorio' { Write-Host '  [FALTA]   ' -ForegroundColor Red -NoNewline }
        'recomendado' { Write-Host '  [atencao] ' -ForegroundColor Yellow -NoNewline }
        'opcional'    { Write-Host '  [vazio]   ' -ForegroundColor DarkGray -NoNewline }
    }

    Write-Host $Chave
    Write-Host "            $Consequencia" -ForegroundColor DarkGray
}

Write-Host ''
Write-Host 'Notrole - conferencia da configuracao' -ForegroundColor Green

Write-Host ''
Write-Host 'Basico' -ForegroundColor Cyan
Conferir -Chave 'DATABASE_URL' -Consequencia 'A API nao sobe sem isso.'
Conferir -Chave 'APP_URL' -Consequencia 'Usado em links. Sem isso, cai no padrao localhost.' -Peso recomendado

Write-Host ''
Write-Host 'Microsoft Entra ID' -ForegroundColor Cyan
Conferir -Chave 'AZURE_TENANT_ID' -Consequencia 'A API nao sobe sem isso.'
Conferir -Chave 'AZURE_CLIENT_ID' -Consequencia 'A API nao sobe sem isso.'
Conferir -Chave 'AZURE_CLIENT_SECRET' -Consequencia 'A busca de colaboradores no AD nao funciona.'
Conferir -Chave 'AZURE_GRUPO_AUTORIZADO_ID' -Consequencia 'QUALQUER conta do tenant tem acesso total ao sistema.'

Write-Host ''
Write-Host 'E-mail' -ForegroundColor Cyan
Conferir -Chave 'SMTP_HOST' -Consequencia 'A API nao sobe sem isso.'
Conferir -Chave 'SMTP_USER' -Consequencia 'A API nao sobe sem isso.'
Conferir -Chave 'SMTP_PASS' -Consequencia 'A API nao sobe sem isso.'

Write-Host ''
Write-Host 'D4Sign - termo de responsabilidade' -ForegroundColor Cyan
$d4 = @('D4SIGN_API_KEY', 'D4SIGN_SAFE_ID')
$d4Preenchidos = @($d4 | Where-Object {
    $valores.ContainsKey($_) -and -not [string]::IsNullOrWhiteSpace($valores[$_])
}).Count

$ativo = $valores['D4SIGN_ATIVO']
if ($ativo -eq 'true') { Write-Host '  [LIGADO]  D4SIGN_ATIVO=true - o Notrole envia termos (cada envio e cobrado)' -ForegroundColor Green }
else { Write-Host '  [desligado] D4SIGN_ATIVO - nenhuma chamada ao D4Sign; emprestimos sem termo' -ForegroundColor DarkGray }
Conferir -Chave 'D4SIGN_CRYPT_KEY' -Consequencia 'Opcional: so existe se estiver habilitado na conta do D4Sign.' -Peso opcional
foreach ($chave in $d4) {
    Conferir -Chave $chave -Consequencia 'Integracao desligada: emprestimos nascem ja como ATIVO.' -Peso opcional
}
Conferir -Chave 'D4SIGN_WEBHOOK_SECRET' -Consequencia 'O webhook fica desligado e a assinatura nao ativa o emprestimo sozinha.' -Peso opcional

if ($d4Preenchidos -gt 0 -and $d4Preenchidos -lt 2) {
    Write-Host ''
    Write-Host "  AVISO: $d4Preenchidos de 2 itens obrigatorios do D4Sign preenchidos." -ForegroundColor Yellow
    Write-Host '  A integracao so liga com os dois. Hoje ela esta desligada.' -ForegroundColor Yellow
}

Write-Host ''
Write-Host 'Frontend (aplicadas no build - rode o deploy depois de mudar)' -ForegroundColor Cyan
Conferir -Chave 'VITE_AZURE_CLIENT_ID' -Consequencia 'O login com a Microsoft nao funciona.'
Conferir -Chave 'VITE_AZURE_TENANT_ID' -Consequencia 'O login com a Microsoft nao funciona.'
Conferir -Chave 'VITE_AZURE_API_SCOPE' -Consequencia 'O front manda o id token em vez do access token da API.' -Peso recomendado

$faltando = @()
foreach ($chave in @('DATABASE_URL','AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','AZURE_GRUPO_AUTORIZADO_ID','SMTP_HOST','SMTP_USER','SMTP_PASS','VITE_AZURE_CLIENT_ID','VITE_AZURE_TENANT_ID')) {
    if (-not $valores.ContainsKey($chave) -or [string]::IsNullOrWhiteSpace($valores[$chave])) {
        $faltando += $chave
    }
}

Write-Host ''
if ($faltando.Count -eq 0) {
    Write-Host 'Tudo que e obrigatorio esta preenchido.' -ForegroundColor Green
}
else {
    Write-Host "Faltam $($faltando.Count) item(ns) obrigatorio(s):" -ForegroundColor Red
    foreach ($chave in $faltando) { Write-Host "  - $chave" -ForegroundColor Red }
    Write-Host ''
    Write-Host 'Para preencher: .\scripts\configurar.ps1' -ForegroundColor Cyan
}

Write-Host ''
