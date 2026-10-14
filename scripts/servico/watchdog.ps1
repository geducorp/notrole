<#
.SYNOPSIS
    Vigia o Notrole, corrige sozinho o que estiver parado e avisa por e-mail.

.DESCRIPTION
    Roda de minuto em minuto pela tarefa "Notrole - Watchdog" (conta SYSTEM).
    Em cada rodada confere, nesta ordem:

      1. IIS (W3SVC) em inicio automatico e rodando; app pool e site iniciados.
      2. A tarefa da API rodando. Se nao estiver, sobe (antes encerra qualquer
         processo da API que tenha sobrado segurando a porta).
      3. A API respondendo em /api/health. Se a tarefa esta rodando mas a API
         nao responde ha SegundosSemResposta, reinicia. Enquanto a API esta
         subindo (TOLERANCIA depois do inicio), so espera.
      4. O banco, por /api/ready. Banco fora NAO reinicia a API (nao adiantaria
         e entraria em loop): so avisa.
      5. O caminho completo pelo HTTPS (IIS -> API). Se a API responde direto
         mas nao pelo IIS por 3 rodadas, recicla o app pool (no maximo uma vez
         a cada 10 minutos).
      6. Backup da noite, espaco em disco, deploy esquecido no meio.

    Problemas viram e-mail para ALERTA_EMAIL (ver comum.ps1: um aviso, um
    lembrete por hora enquanto durar e um "resolvido").

    So grava no log quando encontra problema ou faz alguma correcao, para que o
    arquivo seja lido por gente: logs\watchdog.log.
#>

$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'

. (Join-Path $PSScriptRoot 'comum.ps1')

$raiz = $RaizNotrole
$pastaLog = $PastaLogNotrole
$arquivoLog = Join-Path $pastaLog 'watchdog.log'
$arquivoFalhas = Join-Path $pastaLog 'watchdog.falhas'
$arquivoFalhasIis = Join-Path $pastaLog 'watchdog.falhas-iis'
$arquivoUltimaReciclagem = Join-Path $pastaLog 'watchdog.reciclagem'
New-Item -ItemType Directory -Force $pastaLog | Out-Null

$tarefaApi = 'Notrole - API'
$tarefaBackup = 'Notrole - Backup do banco'
$nomeSite = 'Proxy-Notrole'
$urlLocal = 'http://127.0.0.1:3333/api/health'
$urlPronto = 'http://127.0.0.1:3333/api/ready'
# Endereco publico (pelo IIS): vem do APP_URL do .env, ex.: https://notrole.exemplo.com.br.
# Sem APP_URL, a conferencia do caminho completo (passo 5) e pulada.
$urlPublica = $null
$arquivoEnv = Join-Path $raiz '.env'
if (Test-Path $arquivoEnv) {
    $linhaAppUrl = Get-Content $arquivoEnv | Where-Object { $_ -match '^\s*APP_URL\s*=' } | Select-Object -First 1
    if ($linhaAppUrl) {
        $appUrl = ($linhaAppUrl -replace '^\s*APP_URL\s*=\s*', '').Trim().Trim('"').Trim("'").TrimEnd('/')
        if ($appUrl -match '^https?://') { $urlPublica = "$appUrl/api/health" }
    }
}

# A partida a frio da API (logo depois do boot, com antivirus varrendo
# node_modules) ja levou ~70 s. Antes disso o watchdog reiniciava a API no meio
# da subida e ela nunca terminava de subir.
$toleranciaAposBoot = 300
$toleranciaNormal = 180
$segundosSemResposta = 180
$minutosMaximosManutencao = 60
$gbMinimoDisco = 10

function Gravar([string]$linha) {
    Rotacionar $arquivoLog 5MB 5
    Add-Content -Path $arquivoLog -Value "$(Get-Date -Format 'dd/MM/yyyy HH:mm:ss') $linha" -Encoding UTF8
}

<#
  Rotacao por tamanho: arquivo.log -> arquivo.1.log ... arquivo.N.log.
  Funciona com a API no ar porque ela grava linha a linha (abre e fecha).
#>
function Rotacionar([string]$arquivo, [long]$limite, [int]$geracoes) {
    if (-not (Test-Path $arquivo) -or (Get-Item $arquivo).Length -le $limite) { return }
    $base = [IO.Path]::Combine([IO.Path]::GetDirectoryName($arquivo), [IO.Path]::GetFileNameWithoutExtension($arquivo))
    $ext = [IO.Path]::GetExtension($arquivo)
    Remove-Item "$base.$geracoes$ext" -ErrorAction SilentlyContinue
    for ($i = $geracoes - 1; $i -ge 1; $i--) {
        if (Test-Path "$base.$i$ext") { Move-Item "$base.$i$ext" "$base.$($i + 1)$ext" -Force -ErrorAction SilentlyContinue }
    }
    Move-Item $arquivo "$base.1$ext" -Force -ErrorAction SilentlyContinue
}

function Responde([string]$url, [int]$timeout = 15) {
    try {
        $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeout
        return ($r.StatusCode -eq 200 -and $r.Content -match '"ok"')
    }
    catch { return $false }
}

function Ultimas-LinhasApi([int]$n = 15) {
    $log = Join-Path $pastaLog 'api.log'
    if (Test-Path $log) { return ((Get-Content $log -Tail $n) -join "`n") }
    return '(api.log nao encontrado)'
}

$segundosDesdeBoot = ((Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime).TotalSeconds

# --- 0. Logs ------------------------------------------------------------------
Rotacionar (Join-Path $pastaLog 'api.log') 20MB 10

# --- 1. IIS -------------------------------------------------------------------
$problemasIis = @()
$w3 = Get-Service W3SVC -ErrorAction SilentlyContinue
if ($w3) {
    if ($w3.StartType -ne 'Automatic') {
        Set-Service W3SVC -StartupType Automatic
        Gravar "[iis] W3SVC estava com inicio '$($w3.StartType)'. Voltou para Automatico."
        $problemasIis += "O servico do IIS (W3SVC) estava com inicio '$($w3.StartType)'. Voltou para Automatico."
    }
    if ($w3.Status -ne 'Running') {
        try {
            Start-Service W3SVC -ErrorAction Stop
            Gravar '[iis] W3SVC estava parado. Iniciado.'
            $problemasIis += 'O IIS (W3SVC) estava parado e foi iniciado.'
        }
        catch {
            Gravar "[iis] ERRO ao iniciar W3SVC: $($_.Exception.Message)"
            Abrir-Alerta 'iis' 'IIS parado' "O watchdog nao conseguiu iniciar o IIS (W3SVC): $($_.Exception.Message)`nO Notrole esta fora do ar para os usuarios."
        }
    }

    try {
        Import-Module WebAdministration -ErrorAction Stop
        if (-not (Test-Path "IIS:\Sites\$nomeSite")) {
            Gravar "[iis] O site $nomeSite NAO EXISTE no IIS."
            Abrir-Alerta 'iis-site' "Site $nomeSite sumiu do IIS" "O site '$nomeSite' nao existe mais no IIS (foi apagado?). O Notrole esta fora do ar para os usuarios.`n`nPara recriar (PowerShell como administrador):`n  C:\Sistemas\Notrole\scripts\instalar-servico.ps1"
        }
        else {
            Fechar-Alerta 'iis-site' "O site $nomeSite voltou a existir no IIS."
            if ((Get-WebAppPoolState -Name $nomeSite).Value -ne 'Started') {
                Start-WebAppPool -Name $nomeSite
                Gravar "[iis] App pool $nomeSite estava parado. Iniciado."
                $problemasIis += "O app pool $nomeSite estava parado e foi iniciado."
            }
            if ((Get-WebsiteState -Name $nomeSite).Value -ne 'Started') {
                Start-Website -Name $nomeSite
                Gravar "[iis] Site $nomeSite estava parado. Iniciado."
                $problemasIis += "O site $nomeSite estava parado e foi iniciado."
            }
        }
    }
    catch { Gravar "[iis] ERRO ao conferir site/app pool: $($_.Exception.Message)" }
}
else {
    Gravar '[iis] Servico W3SVC nao encontrado.'
    Abrir-Alerta 'iis' 'IIS nao encontrado' 'O servico W3SVC (IIS) nao existe neste servidor. O Notrole esta fora do ar para os usuarios.'
}

if ($problemasIis.Count -gt 0) {
    # Corrigido sozinho, mas alguem mexeu no IIS: vale saber.
    Enviar-Email 'IIS corrigido pelo watchdog' ("O watchdog encontrou e corrigiu:`n- " + ($problemasIis -join "`n- ")) | Out-Null
}
elseif ($w3 -and (Get-Service W3SVC).Status -eq 'Running') {
    Fechar-Alerta 'iis' 'O IIS voltou a rodar.'
}

# --- 6a. Deploy esquecido ------------------------------------------------------
if (Test-Path $ArquivoManutencao) {
    $idade = ((Get-Date) - (Get-Item $ArquivoManutencao).LastWriteTime).TotalMinutes
    if ($idade -lt $minutosMaximosManutencao) {
        # Deploy em andamento: nao mexe na API.
        exit 0
    }
    Gravar "[api] Manutencao iniciada ha $([int]$idade) min e nao terminou."
    Abrir-Alerta 'manutencao' 'Deploy/manutencao esquecido' "Existe o arquivo $ArquivoManutencao ha $([int]$idade) minutos. Um deploy ou manutencao comecou e nao terminou.`nO watchdog vai voltar a cuidar da API normalmente.`n`nSe a manutencao ja acabou, apague o arquivo."
}
else {
    Fechar-Alerta 'manutencao' 'A manutencao terminou.'
}

# --- 2. Tarefa da API ---------------------------------------------------------
$tarefa = Get-ScheduledTask -TaskName $tarefaApi -ErrorAction SilentlyContinue
if (-not $tarefa) {
    Gravar "[api] Tarefa '$tarefaApi' nao existe."
    Abrir-Alerta 'api-tarefa' "Tarefa '$tarefaApi' nao existe" "A tarefa agendada que roda a API sumiu. O Notrole esta fora do ar.`n`nPara reinstalar (PowerShell como administrador):`n  C:\Sistemas\Notrole\scripts\instalar-servico.ps1"
    exit 1
}
Fechar-Alerta 'api-tarefa' "A tarefa '$tarefaApi' voltou a existir."

if ($tarefa.State -eq 'Disabled') {
    Gravar "[api] Tarefa '$tarefaApi' desabilitada. Habilitando."
    Enable-ScheduledTask -TaskName $tarefaApi | Out-Null
    Abrir-Alerta 'api' 'API estava desabilitada' "A tarefa '$tarefaApi' estava desabilitada e o watchdog a habilitou de novo.`nPara parar a API de proposito, use o arquivo de manutencao (ver docs\OPERACAO.md), nao desabilite a tarefa."
    $tarefa = Get-ScheduledTask -TaskName $tarefaApi
}

if ($tarefa.State -ne 'Running') {
    $orfaos = @(Encerrar-ProcessosApi)
    foreach ($p in $orfaos) { Gravar "[api] Processo orfao $p encerrado (segurava a porta)." }
    Start-ScheduledTask -TaskName $tarefaApi
    Gravar '[api] A API nao estava rodando. Tarefa iniciada.'
    Remove-Item $arquivoFalhas -ErrorAction SilentlyContinue
    # Logo depois do boot e normal a tarefa ainda nao ter subido: nao e queda.
    if ($segundosDesdeBoot -ge 300) {
        Abrir-Alerta 'api' 'A API caiu' "A API do Notrole nao estava rodando. O watchdog subiu de novo.`n`nUltimas linhas do api.log:`n$(Ultimas-LinhasApi)"
    }
    exit 0
}

# --- 3. Saude da API ----------------------------------------------------------
if (Responde $urlLocal) {
    if (Test-Path $arquivoFalhas) {
        Gravar '[api] Voltou a responder.'
        Remove-Item $arquivoFalhas -ErrorAction SilentlyContinue
    }
    Fechar-Alerta 'api' 'A API voltou a responder normalmente.'

    # Aviso de reboot (o Windows Update reinicia o servidor sozinho): um e-mail
    # por boot, quando a API ja voltou.
    $boot = (Get-CimInstance Win32_OperatingSystem).LastBootUpTime
    $arquivoBoot = Join-Path $pastaLog 'watchdog.ultimo-boot'
    $bootAvisado = if (Test-Path $arquivoBoot) { (Get-Content $arquivoBoot -Raw).Trim() } else { '' }
    if ($bootAvisado -ne $boot.ToString('o')) {
        Set-Content $arquivoBoot $boot.ToString('o')
        if ($bootAvisado) {
            $quem = Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 1074; StartTime = $boot.AddHours(-1) } -MaxEvents 1 -ErrorAction SilentlyContinue
            $motivo = if ($quem) { $quem.Message -replace '\s+', ' ' } else { '(motivo nao registrado)' }
            Gravar "[boot] Servidor reiniciado as $($boot.ToString('dd/MM HH:mm')). API de volta em $([int]$segundosDesdeBoot) s."
            Enviar-Email 'Servidor reiniciado - Notrole voltou sozinho' "O $env:COMPUTERNAME reiniciou as $($boot.ToString('dd/MM/yyyy HH:mm')) e o Notrole voltou sozinho ($([int]$segundosDesdeBoot) s depois do boot).`n`nMotivo registrado pelo Windows:`n$motivo" | Out-Null
        }
    }
}
else {
    # Ainda subindo? Da tempo para a partida a frio terminar.
    $launcher = Get-LauncherApi
    if ($launcher) {
        $idadeLauncher = ((Get-Date) - $launcher.CreationDate).TotalSeconds
        $tolerancia = if ($segundosDesdeBoot -lt 900) { $toleranciaAposBoot } else { $toleranciaNormal }
        if ($idadeLauncher -lt $tolerancia) { exit 0 }
    }

    # Conta o tempo sem resposta (nao rodadas: a tarefa ja chegou a rodar duas
    # vezes por minuto e 3 "rodadas" viravam 50 segundos).
    $agora = Get-Date
    $desde = $agora
    if (Test-Path $arquivoFalhas) {
        try { $desde = [datetime]::Parse((Get-Content $arquivoFalhas -Raw).Trim()) } catch { $desde = $agora }
    }
    else {
        Set-Content $arquivoFalhas $agora.ToString('o')
    }
    $semResposta = ($agora - $desde).TotalSeconds

    if ($semResposta -lt $segundosSemResposta) {
        Gravar "[api] Rodando mas sem responder ha $([int]$semResposta) s. Aguardando."
        exit 0
    }

    Gravar "[api] Sem responder ha $([int]$semResposta) s. Reiniciando."
    $ultimas = Ultimas-LinhasApi
    Stop-ScheduledTask -TaskName $tarefaApi
    Start-Sleep -Seconds 3
    foreach ($p in @(Encerrar-ProcessosApi)) { Gravar "[api] Processo orfao $p encerrado." }
    Start-ScheduledTask -TaskName $tarefaApi
    Remove-Item $arquivoFalhas -ErrorAction SilentlyContinue
    Abrir-Alerta 'api' 'A API travou e foi reiniciada' "A API estava rodando, mas sem responder ha $([int]$semResposta) segundos. O watchdog a reiniciou.`n`nUltimas linhas do api.log antes do reinicio:`n$ultimas"
    exit 0
}

# --- 4. Banco de dados --------------------------------------------------------
if (Responde $urlPronto 10) {
    Fechar-Alerta 'banco' 'A API voltou a falar com o banco de dados.'
}
else {
    Gravar '[banco] A API responde, mas nao consegue falar com o banco.'
    $pg = Get-Service 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    $estadoPg = if ($pg) { "$($pg.Name): $($pg.Status)" } else { 'servico do PostgreSQL nao encontrado' }
    Abrir-Alerta 'banco' 'Banco de dados inacessivel' "A API esta no ar, mas nao consegue consultar o PostgreSQL. Os usuarios veem erro em todas as telas.`n`nServico: $estadoPg`n`nUltimas linhas do api.log:`n$(Ultimas-LinhasApi)"
}

# --- 5. Caminho completo pelo IIS --------------------------------------------
if (-not $urlPublica) {
    # APP_URL nao definido no .env: nada a conferir pelo endereco publico.
}
elseif (Responde $urlPublica) {
    Remove-Item $arquivoFalhasIis -ErrorAction SilentlyContinue
    Fechar-Alerta 'publico' "O endereco $urlPublica voltou a responder."
}
else {
    $falhasIis = 1
    if (Test-Path $arquivoFalhasIis) { $falhasIis = [int](Get-Content $arquivoFalhasIis) + 1 }
    Set-Content $arquivoFalhasIis $falhasIis
    Gravar "[iis] API responde direto, mas nao por $urlPublica ($falhasIis)."

    if ($falhasIis -ge 3) {
        $podeReciclar = $true
        if (Test-Path $arquivoUltimaReciclagem) {
            $podeReciclar = ((Get-Date) - (Get-Item $arquivoUltimaReciclagem).LastWriteTime).TotalMinutes -ge 10
        }
        if ($podeReciclar) {
            Gravar '[iis] Reciclando o app pool.'
            try { Restart-WebAppPool -Name $nomeSite } catch { Gravar "[iis] ERRO ao reciclar: $($_.Exception.Message)" }
            Set-Content $arquivoUltimaReciclagem (Get-Date -Format o)
        }
        Abrir-Alerta 'publico' 'Notrole inacessivel pelo endereco publico' "A API responde no proprio servidor, mas $urlPublica nao responde ha $falhasIis minutos.`nCausas comuns: IIS/ARR, certificado, DNS.`nO watchdog reciclou o app pool (no maximo 1 vez a cada 10 min)."
    }
}

# --- 6b. Backup da noite -------------------------------------------------------
$infoBackup = Get-ScheduledTaskInfo -TaskName $tarefaBackup -ErrorAction SilentlyContinue
if (-not $infoBackup) {
    Abrir-Alerta 'backup' 'Tarefa de backup nao existe' "A tarefa '$tarefaBackup' nao existe. O banco do Notrole esta sem backup.`n`nPara criar: C:\Sistemas\Notrole\scripts\backup-banco.ps1 -InstalarTarefa" 1440
}
else {
    $horasDesdeBackup = ((Get-Date) - $infoBackup.LastRunTime).TotalHours
    # 267009 = ainda rodando.
    if ($infoBackup.LastTaskResult -ne 0 -and $infoBackup.LastTaskResult -ne 267009) {
        Abrir-Alerta 'backup' 'Backup do banco falhou' "O ultimo backup ($($infoBackup.LastRunTime.ToString('dd/MM/yyyy HH:mm'))) terminou com codigo $($infoBackup.LastTaskResult).`nVeja C:\Sistemas\Notrole\logs\backup.log." 1440
    }
    elseif ($horasDesdeBackup -gt 26) {
        Abrir-Alerta 'backup' 'Backup do banco atrasado' "O ultimo backup rodou ha $([int]$horasDesdeBackup) horas ($($infoBackup.LastRunTime.ToString('dd/MM/yyyy HH:mm')))." 1440
    }
    else {
        Fechar-Alerta 'backup' "O backup voltou a rodar ($($infoBackup.LastRunTime.ToString('dd/MM/yyyy HH:mm')))."
    }
}

# --- 6c. Disco ------------------------------------------------------------------
$disco = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
$livreGb = [math]::Round($disco.FreeSpace / 1GB, 1)
if ($livreGb -lt $gbMinimoDisco) {
    Abrir-Alerta 'disco' 'Pouco espaco em disco' "O disco C: do $env:COMPUTERNAME esta com $livreGb GB livres (minimo: $gbMinimoDisco GB).`nSem espaco o banco para e o Notrole cai." 720
}
else {
    Fechar-Alerta 'disco' "O disco C: voltou a ter $livreGb GB livres."
}
