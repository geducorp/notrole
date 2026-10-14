# Roadmap e limitações conhecidas

O que falta, o que poderia melhorar e as decisões que cada instalação precisa
tomar. Para configurar o sistema, veja [CONFIGURACAO.md](CONFIGURACAO.md).

---

## Antes de usar em produção

- [ ] **Revisar os modelos de termo com o jurídico da sua empresa.** Os arquivos
      em `docs/modelos/` são um ponto de partida (comodato de equipamento para
      colaborador PF). O foro sai como a cidade da sede da empresa comodante.
- [ ] **Termo sem testemunha signatária.** Só o colaborador assina no D4Sign; o
      analista aparece como "Registrado no Notrole por". A base é a Lei
      14.620/2023 (art. 784, §4º do CPC: título assinado eletronicamente com
      integridade conferida pelo provedor dispensa testemunhas). Se o jurídico
      preferir testemunha, restaure o bloco no `.docx` e o signatário em
      `TermoService.signatarios`.
- [ ] **Preencher o campo "Empresa" no AD de cada analista.** Cada analista vê
      só a empresa dele; quem está sem empresa no AD cai na tela "Empresa não
      identificada". Sem `AZURE_GRUPO_ADMIN_ID`, todos são administradores.
- [ ] **`D4SIGN_WEBHOOK_SECRET`:** sem ele o webhook responde 503 e a assinatura
      é detectada pela consulta periódica (até 4 h). Se o Notrole for acessível
      pela internet, preencha e cadastre a URL no painel do D4Sign.
- [ ] **Criar o scope `access_as_user`** e preencher `VITE_AZURE_API_SCOPE`,
      para o frontend mandar o access token em vez do id token.

## Qualidade e operação

- [ ] **Testes automatizados.** É a maior lacuna. Pontos prioritários:
      - `utils/datas.ts` — vencimento e cálculo de atraso;
      - `EmprestimoService` — ciclo completo e disputa pelo mesmo equipamento;
      - `NotificacaoJob` — garantia de não reenviar no mesmo dia;
      - `ContratoService` — preenchimento do `.docx` e trava de campo vazio.
- [ ] **CI** (GitHub Actions) com `npm ci` + `npm run typecheck` + build.
- [ ] **Monitoramento externo.** O watchdog avisa por e-mail, mas roda no
      próprio servidor: se a máquina inteira cair, ninguém avisa. Um Zabbix,
      Uptime Kuma ou similar pode monitorar `/api/ready`.
- [ ] **Contador de cota do D4Sign em memória:** zera quando a API reinicia.
      Persistir no banco evitaria estourar a cota logo após um restart.
- [ ] **Atualizações de dependências principais** (`nodemailer`, `prisma`,
      `exceljs`) com teste de envio e de migração.
- [ ] **Retenção do histórico de e-mails enviados** (`EmailEnviado` cresce
      indefinidamente).

## Melhorias de produto

- [ ] **Assinatura pelo botão no e-mail do Notrole** (link de assinatura do
      D4Sign ou D4Sign Embed). Custa uma requisição a mais por termo.
- [ ] **Termo em PDF gerado pelo próprio sistema**, como alternativa ao D4Sign
      quando não houver necessidade de assinatura digital.
- [ ] **Colunas próprias por tipo de equipamento** (ex.: hostname só em
      notebook).
- [ ] **Reserva antecipada** usando o status `RESERVADO` ("sai na segunda para
      o fulano").
- [ ] **Filtro de período nos relatórios em PDF.**
- [ ] **Paginação nas listagens** (importa a partir de algumas centenas de
      registros).
- [ ] **Perfis por App Roles do Entra ID**, além dos grupos de acesso e de
      administrador.
- [ ] **Internacionalização** (hoje a interface é só em português).

## Limitações conhecidas

- O login é exclusivamente pelo Microsoft Entra ID (não há usuário e senha
  locais).
- A empresa do analista vem do campo "Empresa" do perfil do AD; sem esse
  campo, o analista não usa o sistema.
- A operação automatizada (`scripts/*.ps1`: watchdog, backup, deploy com
  rollback) foi feita para Windows Server + IIS. Em Linux, use o equivalente
  (systemd, nginx, cron); a aplicação em si é Node puro.
- O motor de modelos do próprio D4Sign não é usado: o Notrole preenche o
  `.docx` e envia o documento pronto (ver `docs/modelos/README.md`).
