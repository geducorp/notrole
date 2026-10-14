<#
.SYNOPSIS
    Preenche valores sensiveis do .env sem expor nada na tela.

.DESCRIPTION
    Pede os valores um a um, escondendo o que voce digita, e grava direto no
    .env. Nenhum valor e exibido, copiado para a area de transferencia ou
    gravado em log.

    Enter em branco = mantem o valor atual.

    Antes de alterar, o arquivo atual e copiado para .env.backup-<data-hora>.

.EXAMPLE
    .\scripts\configurar.ps1
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

$backup = Join-Path $raiz (".env.backup-{0}" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item $envPath $backup
Write-Host "Backup criado: $(Split-Path -Leaf $backup)" -ForegroundColor DarkGray

$linhas = [System.Collections.Generic.List[string]](Get-Content $envPath)

function Obter-ValorAtual([string]$chave) {
    foreach ($linha in $linhas) {
        if ($linha -match "^$([regex]::Escape($chave))=(.*)$") { return $Matches[1] }
    }
    return ''
}

function Definir-Valor([string]$chave, [string]$valor) {
    for ($i = 0; $i -lt $linhas.Count; $i++) {
        if ($linhas[$i] -match "^$([regex]::Escape($chave))=") {
            $linhas[$i] = "$chave=$valor"
            return
        }
    }
    $linhas.Add("$chave=$valor")
}

function Perguntar {
    param(
        [string]$Chave,
        [string]$Descricao,
        [switch]$Secreto
    )

    $atual = Obter-ValorAtual $Chave
    $situacao = if ([string]::IsNullOrWhiteSpace($atual)) { 'VAZIO' } else { 'ja preenchido' }

    Write-Host ''
    Write-Host $Chave -ForegroundColor Cyan -NoNewline
    Write-Host "  ($situacao)" -ForegroundColor DarkGray
    Write-Host "  $Descricao" -ForegroundColor Gray

    if ($Secreto) {
        $entrada = Read-Host '  Valor (Enter para manter)' -AsSecureString
        $texto = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
            [Runtime.InteropServices.Marshal]::SecureStringToBSTR($entrada)
        )
    }
    else {
        $texto = Read-Host '  Valor (Enter para manter)'
    }

    if ([string]::IsNullOrWhiteSpace($texto)) {
        Write-Host '  mantido' -ForegroundColor DarkGray
        return
    }

    Definir-Valor $Chave $texto.Trim()
    Write-Host '  gravado' -ForegroundColor Green
}

Write-Host ''
Write-Host 'Notrole - configuracao' -ForegroundColor Green
Write-Host 'O que voce digitar nos campos secretos nao aparece na tela.'

Write-Host ''
Write-Host '--- Microsoft Entra ID ---' -ForegroundColor Yellow

Perguntar -Chave 'AZURE_CLIENT_SECRET' -Secreto -Descricao @'
Segredo do cliente do app registration.
Azure Portal > Entra ID > Registros de aplicativo > Notrole >
Certificados e segredos > Novo segredo do cliente.
Copie o campo "Valor" (nao o "ID do segredo").
'@

Perguntar -Chave 'AZURE_GRUPO_AUTORIZADO_ID' -Descricao @'
Object ID do grupo cujos membros podem usar o sistema.
Entra ID > Grupos > abra o grupo > copie o "ID do objeto".
Deixar vazio libera o sistema para qualquer conta do tenant.
'@

Write-Host ''
Write-Host '--- D4Sign (Enter em tudo para deixar desligado) ---' -ForegroundColor Yellow

Perguntar -Chave 'D4SIGN_API_KEY' -Secreto -Descricao 'Token da API (tokenAPI). D4Sign > seu e-mail > Dev API.'
Perguntar -Chave 'D4SIGN_CRYPT_KEY' -Secreto -Descricao 'Crypt Key. OPCIONAL: so preencha se ela aparecer na tela Dev API.'
Perguntar -Chave 'D4SIGN_SAFE_ID' -Descricao 'UUID do cofre onde os termos ficam guardados (node scripts/d4sign-explorar.mjs).'

Perguntar -Chave 'D4SIGN_WEBHOOK_SECRET' -Secreto -Descricao @'
Senha que voce inventa agora e cadastra tambem no webhook do D4Sign.
E o que permite ao sistema confiar na notificacao de assinatura.
Sugestao: uma sequencia longa e aleatoria.
'@

# UTF-8 SEM BOM. O "-Encoding utf8" do Windows PowerShell 5.1 grava com BOM, e
# o BOM entraria como parte da primeira variavel do arquivo.
$semBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllLines($envPath, $linhas, $semBom)

Write-Host ''
Write-Host 'Arquivo .env atualizado.' -ForegroundColor Green
Write-Host ''
Write-Host 'Proximo passo:' -ForegroundColor Cyan
Write-Host '  .\scripts\deploy.ps1'
Write-Host ''
Write-Host 'Confira depois quais itens ficaram pendentes:' -ForegroundColor Cyan
Write-Host '  .\scripts\conferir-config.ps1'
