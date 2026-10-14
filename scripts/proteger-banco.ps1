<#
.SYNOPSIS
    Tira o Notrole do superusuario do PostgreSQL e fecha o banco para a rede.

.DESCRIPTION
    Rodado em 09/10/2026. Pode ser rodado de novo (confere antes de mudar).
    PowerShell "Executar como administrador", no servidor do Notrole:

        cd C:\Sistemas\Notrole
        .\scripts\proteger-banco.ps1

    O que faz:
      1. Cria o usuario "notrole_app" (sem superusuario) com senha aleatoria e
         passa para ele a posse da base e de todas as tabelas. Ele continua
         rodando as migracoes, porque e o dono.
      2. Troca o DATABASE_URL do .env para esse usuario, em 127.0.0.1
         (o .env antigo fica em .env.backup-<data>).
      3. PostgreSQL so na propria maquina: listen_addresses = 'localhost',
         sem a linha 0.0.0.0/0 no pg_hba.conf e sem a regra de firewall da
         porta 5432. O PostgreSQL e reiniciado (segundos).
      4. Reinicia a API e confere /api/ready.

    Para abrir o banco no pgAdmin depois disso: pgAdmin dentro do servidor,
    conexao em 127.0.0.1. A senha do "postgres" nao muda.
#>

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz
. (Join-Path $PSScriptRoot 'servico\comum.ps1')

$souAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $souAdmin) { throw 'Rode num PowerShell "Executar como administrador".' }

$psql = (Get-ChildItem "$env:ProgramFiles\PostgreSQL\*\bin\psql.exe" | Sort-Object FullName -Descending | Select-Object -First 1).FullName
if (-not $psql) { throw 'psql.exe nao encontrado.' }
$pastaDados = Join-Path (Split-Path (Split-Path $psql)) 'data'
$servicoPg = Get-Service 'postgresql*' | Select-Object -First 1

function Etapa([string]$t) { Write-Host ''; Write-Host "==> $t" -ForegroundColor Cyan }

# --- Conexao atual ---------------------------------------------------------------
$caminhoEnv = Join-Path $raiz '.env'
$linha = (Select-String $caminhoEnv -Pattern '^\s*DATABASE_URL\s*=').Line
$url = ($linha -replace '^\s*DATABASE_URL\s*=\s*', '').Trim().Trim('"').Trim("'")
$m = [regex]::Match($url, '^postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+):?(\d+)?/([^?]+)(\?.*)?$')
if (-not $m.Success) { throw 'Nao consegui interpretar o DATABASE_URL do .env.' }
$usuarioAtual = [uri]::UnescapeDataString($m.Groups[1].Value)
$senhaAtual = [uri]::UnescapeDataString($m.Groups[2].Value)
$porta = if ($m.Groups[4].Success) { $m.Groups[4].Value } else { '5432' }
$banco = $m.Groups[5].Value
$parametros = $m.Groups[6].Value

if ($usuarioAtual -eq 'notrole_app') {
    Write-Host 'O .env ja usa o notrole_app. Pulando as etapas 1 e 2.' -ForegroundColor Yellow
}
else {
    # --- 1. Usuario proprio ------------------------------------------------------------
    Etapa "Criando o usuario notrole_app e passando a posse de $banco"
    $letras = [char[]]'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $senhaNova = -join ($bytes | ForEach-Object { $letras[$_ % $letras.Length] })

    $env:PGPASSWORD = $senhaAtual
    try {
        @"
DO `$`$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'notrole_app') THEN
    CREATE ROLE notrole_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END `$`$;
ALTER ROLE notrole_app WITH LOGIN NOSUPERUSER PASSWORD '$senhaNova';
ALTER DATABASE "$banco" OWNER TO notrole_app;
"@ | & $psql -h 127.0.0.1 -p $porta -U $usuarioAtual -d postgres -v ON_ERROR_STOP=1 -q
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao criar o usuario.' }

        @"
ALTER SCHEMA public OWNER TO notrole_app;
DO `$`$ DECLARE r record; BEGIN
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p','f') LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO notrole_app', r.relname);
  END LOOP;
  FOR r IN SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relkind = 'S' LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO notrole_app', r.relname);
  END LOOP;
  FOR r IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
           WHERE n.nspname = 'public' AND t.typtype IN ('e','d') LOOP
    EXECUTE format('ALTER TYPE public.%I OWNER TO notrole_app', r.typname);
  END LOOP;
END `$`$;
"@ | & $psql -h 127.0.0.1 -p $porta -U $usuarioAtual -d $banco -v ON_ERROR_STOP=1 -q
        if ($LASTEXITCODE -ne 0) { throw 'Falha ao transferir a posse das tabelas.' }

        $env:PGPASSWORD = $senhaNova
        & $psql -h 127.0.0.1 -p $porta -U notrole_app -d $banco -t -q -c 'SELECT count(*) FROM "_prisma_migrations";' | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'O login com o notrole_app falhou. O .env NAO foi alterado.' }
        Write-Host 'notrole_app criado e testado.' -ForegroundColor Green
    }
    finally { $env:PGPASSWORD = $null }

    # --- 2. .env -------------------------------------------------------------------------
    Etapa 'Atualizando o DATABASE_URL do .env'
    $copia = Join-Path $raiz ".env.backup-$(Get-Date -Format 'yyyyMMdd-HHmm')"
    Copy-Item $caminhoEnv $copia
    $conteudo = [IO.File]::ReadAllText($caminhoEnv)
    $novaUrl = "postgresql://notrole_app:$senhaNova@127.0.0.1:$porta/$banco$parametros"
    $conteudo = [regex]::Replace($conteudo, '(?m)^[ \t]*DATABASE_URL[ \t]*=[^\r\n]*', "DATABASE_URL=`"$novaUrl`"")
    [IO.File]::WriteAllText($caminhoEnv, $conteudo, (New-Object Text.UTF8Encoding $false))
    foreach ($arq in $caminhoEnv, $copia) {
        & icacls $arq /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F' '*S-1-5-20:R' | Out-Null
    }
    Write-Host "Feito. O .env anterior ficou em $(Split-Path $copia -Leaf)." -ForegroundColor Green
}

# --- 3. Banco so na propria maquina ---------------------------------------------------
Etapa 'PostgreSQL so na propria maquina'
$hba = Join-Path $pastaDados 'pg_hba.conf'
$conf = Join-Path $pastaDados 'postgresql.conf'
$carimbo = Get-Date -Format 'yyyyMMdd-HHmm'
Copy-Item $hba "$hba.backup-$carimbo"
Copy-Item $conf "$conf.backup-$carimbo"

$novasHba = Get-Content $hba | ForEach-Object {
    if ($_ -match '^\s*host\s+\S+\s+\S+\s+0\.0\.0\.0/0') { "# Desativado em $carimbo por proteger-banco.ps1 (so acesso local): $_" } else { $_ }
}
Set-Content -Path $hba -Value $novasHba -Encoding ASCII

$textoConf = [IO.File]::ReadAllText($conf)
$textoConf = [regex]::Replace($textoConf, "(?m)^[ \t]*listen_addresses[ \t]*=[^\r\n]*", "listen_addresses = 'localhost'`t`t# era '*'; alterado por proteger-banco.ps1")
[IO.File]::WriteAllText($conf, $textoConf, (New-Object Text.UTF8Encoding $false))

Get-NetFirewallRule -Direction Inbound -Enabled True |
    Where-Object { ($_ | Get-NetFirewallPortFilter).LocalPort -contains $porta } |
    ForEach-Object { Disable-NetFirewallRule -Name $_.Name; Write-Host "Regra de firewall '$($_.DisplayName)' desativada." }

# A API para antes do PostgreSQL reiniciar.
Set-Content -Path $ArquivoManutencao -Value "proteger-banco $(Get-Date -Format o)"
try {
    Parar-ApiOrdenado 20 | Out-Null
    Stop-ScheduledTask -TaskName 'Notrole - API' -ErrorAction SilentlyContinue
    Encerrar-ProcessosApi | Out-Null

    Write-Host "Reiniciando o $($servicoPg.Name)..."
    Restart-Service $servicoPg.Name -Force
    Start-Sleep -Seconds 3
    $escuta = Get-NetTCPConnection -LocalPort ([int]$porta) -State Listen | Select-Object -ExpandProperty LocalAddress -Unique
    Write-Host "PostgreSQL escutando em: $($escuta -join ', ')" -ForegroundColor Green
}
finally {
    # --- 4. Sobe a API --------------------------------------------------------------------
    Etapa 'Subindo a API'
    Start-ScheduledTask -TaskName 'Notrole - API'
    Remove-Item $ArquivoManutencao -ErrorAction SilentlyContinue
}

$ok = $false
foreach ($i in 1..40) {
    Start-Sleep -Seconds 3
    try { if ((Invoke-RestMethod 'http://127.0.0.1:3333/api/ready' -TimeoutSec 5).status -eq 'ok') { $ok = $true; break } } catch { }
}
if (-not $ok) {
    Write-Host "A API nao conectou no banco. Veja $raiz\logs\api.log." -ForegroundColor Red
    Write-Host 'Para voltar: copie o .env.backup-* mais recente por cima do .env e reinicie a API.' -ForegroundColor Yellow
    exit 1
}
Write-Host ''
Write-Host 'Pronto: a API usa o notrole_app e o banco so aceita conexao local.' -ForegroundColor Green
