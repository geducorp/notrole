import dotenv from 'dotenv';
import { z } from 'zod';

// quiet: sem isso o dotenv imprime uma "dica" publicitaria a cada inicializacao,
// que enchia o log do PM2.
dotenv.config({ quiet: true });

/**
 * Toda a configuracao do sistema passa por aqui.
 *
 * Antes desta refatoracao o tenant, o client id e ate o client secret do Azure
 * estavam escritos direto no codigo-fonte. O secret estava invalido e derrubava
 * a API em loop no boot. Agora nada de credencial vive no repositorio e, se
 * faltar alguma variavel obrigatoria, o processo morre com uma mensagem clara
 * em vez de quebrar na primeira requisicao.
 */

const booleanoDeTexto = (padrao: boolean) =>
  z
    .enum(['true', 'false'])
    .default(padrao ? 'true' : 'false')
    .transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('production'),
  PORT: z.coerce.number().int().positive().default(3333),
  // Endereco em que a API escuta. So o IIS (na mesma maquina) deve falar com
  // ela: escutando em todas as interfaces, qualquer um na rede chegava na API
  // por http://<ip-do-servidor>:3333, sem HTTPS e podendo forjar o X-Forwarded-For.
  HOST: z.string().default('127.0.0.1'),
  APP_URL: z.string().url().default('http://localhost:3333'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL e obrigatoria'),

  // Origens liberadas no CORS, separadas por virgula. Vazio = mesma origem
  // apenas (o proprio Express serve o frontend, entao esse e o caso normal).
  CORS_ORIGINS: z.string().default(''),

  // --- Microsoft Entra ID -------------------------------------------------
  AZURE_TENANT_ID: z.string().uuid('AZURE_TENANT_ID deve ser um GUID'),
  AZURE_CLIENT_ID: z.string().uuid('AZURE_CLIENT_ID deve ser um GUID'),
  // Usado pelo Microsoft Graph (busca de colaboradores no AD).
  AZURE_CLIENT_SECRET: z.string().min(1, 'AZURE_CLIENT_SECRET e obrigatorio'),
  // Object ID do grupo de seguranca que tem acesso ao sistema.
  // Se ficar vazio, qualquer usuario autenticado do tenant entra - o que era o
  // comportamento anterior e nao deve ser usado em producao.
  AZURE_GRUPO_AUTORIZADO_ID: z.string().uuid().optional().or(z.literal('')),

  // Object ID do grupo de administradores do Notrole. Quem esta nele movimenta
  // o estoque de todas as empresas e cadastra categorias; os demais
  // analistas so movimentam o estoque da propria empresa (a do AD deles).
  // Vazio: todo mundo continua com os mesmos poderes.
  AZURE_GRUPO_ADMIN_ID: z.string().uuid().optional().or(z.literal('')),

  // --- SMTP ---------------------------------------------------------------
  SMTP_HOST: z.string().min(1, 'SMTP_HOST e obrigatorio'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().min(1, 'SMTP_USER e obrigatorio'),
  SMTP_PASS: z.string().min(1, 'SMTP_PASS e obrigatorio'),
  SMTP_FROM_NAME: z.string().default('Notrole'),
  SMTP_SECURE: booleanoDeTexto(false),
  // Valida o certificado do servidor SMTP. Use 'false' so para um servidor
  // interno com certificado autoassinado - decisao consciente de ambiente.
  SMTP_REJECT_UNAUTHORIZED: booleanoDeTexto(true),

  // --- D4Sign (opcional) --------------------------------------------------
  // Chave geral. Com 'false' o Notrole nao faz NENHUMA chamada ao D4Sign, mesmo
  // com as credenciais preenchidas: os emprestimos nascem ativos, sem termo.
  // Existe para publicar e conferir o sistema antes de liberar os envios, que
  // sao cobrados.
  D4SIGN_ATIVO: booleanoDeTexto(false),
  D4SIGN_API_KEY: z.string().default(''),
  // Opcional: so existe se estiver habilitado na conta do D4Sign.
  D4SIGN_CRYPT_KEY: z.string().default(''),
  // UUID do cofre onde os termos ficam guardados. Dentro dele, cada empresa tem
  // a sua pasta (cadastrada em Configuracoes > Empresas).
  D4SIGN_SAFE_ID: z.string().default(''),
  // Modelo Word do termo, preenchido pelo proprio Notrole. Vazio = o modelo
  // versionado em docs/modelos/termo-comodato-emprestimo.docx.
  D4SIGN_MODELO: z.string().default(''),
  // Segredo compartilhado que o webhook do D4Sign deve apresentar.
  D4SIGN_WEBHOOK_SECRET: z.string().default(''),

  // ATENCAO: a conta do D4Sign e da empresa inteira e o uso e cobrado. Todos os
  // padroes abaixo sao deliberadamente conservadores. Ver docs/CONFIGURACAO.md.

  // 'sandbox' usa o ambiente de testes do D4Sign (sandbox.d4sign.com.br), que
  // nao gera cobranca. Exige uma conta de sandbox propria.
  D4SIGN_AMBIENTE: z.enum(['producao', 'sandbox']).default('producao'),
  // Teto de requisicoes por hora que o NOTROLE se permite usar. O limite da
  // conta e 10, mas ele e compartilhado com qualquer outra integracao que use a
  // mesma conta; ficar abaixo dele evita que o Notrole esgote a cota de outros
  // sistemas da empresa.
  D4SIGN_REQUISICOES_POR_HORA: z.coerce.number().int().positive().default(6),
  // Tentativas antes de desistir de um termo e pedir acao do operador. Baixo de
  // proposito: cada tentativa sao chamadas a API.
  D4SIGN_MAX_TENTATIVAS: z.coerce.number().int().positive().default(3),
  // Consulta automatica da assinatura. Desligada, o operador verifica pelo
  // botao da tela ou ativa o emprestimo manualmente - zero chamadas automaticas.
  D4SIGN_CONSULTA_AUTOMATICA: booleanoDeTexto(true),
  // Intervalo minimo entre duas consultas do mesmo documento.
  D4SIGN_HORAS_ENTRE_CONSULTAS: z.coerce.number().positive().default(4),
  // Depois de tantos dias sem assinatura, o sistema para de perguntar sozinho.
  D4SIGN_DIAS_MAX_CONSULTA: z.coerce.number().int().positive().default(15),

  // --- Rotinas automaticas ------------------------------------------------
  CRON_TIMEZONE: z.string().default('America/Sao_Paulo'),
  // De hora em hora, das 8h as 18h, de segunda a sexta.
  //
  // O agendamento antigo ('0 8 * * *') dependia de um unico disparo diario dar
  // certo - e ele nunca deu: o log do PM2 registrou "missed execution" todos os
  // dias desde 11/09. Como as rotinas sao idempotentes (por emprestimo, no
  // maximo uma cobranca por dia e um lembrete por prazo, controlados por
  // ultimaCobrancaEm e lembretePrevioEm),
  // rodar de hora em hora e inofensivo e faz o sistema se recuperar sozinho de
  // um disparo perdido. Rodava todo dia, inclusive fim de semana; agora nao.
  CRON_COBRANCA: z.string().default('0 8-18 * * 1-5'),
  CRON_LEMBRETE: z.string().default('30 8-18 * * 1-5'),
  // A fila de termos do D4Sign roda de 5 em 5 minutos, todos os dias: um termo
  // que ficou pendente por causa do limite de requisicoes precisa sair assim
  // que houver cota, nao so no proximo dia util.
  CRON_TERMOS: z.string().default('*/5 * * * *'),
  JOBS_HABILITADOS: booleanoDeTexto(true),
});

const resultado = schema.safeParse(process.env);

if (!resultado.success) {
  const problemas = resultado.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');

  console.error(
    `\n[config] Nao foi possivel iniciar: variaveis de ambiente invalidas ou ausentes.\n${problemas}\n\n` +
      `Confira o arquivo .env na raiz do projeto. O modelo esta em .env.example.\n`,
  );
  process.exit(1);
}

const bruto = resultado.data;

export const env = {
  ...bruto,
  ehProducao: bruto.NODE_ENV === 'production',
  corsOrigins: bruto.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  grupoAutorizadoId: bruto.AZURE_GRUPO_AUTORIZADO_ID || null,
  grupoAdministradoresId: bruto.AZURE_GRUPO_ADMIN_ID || null,
  // Precisa da chave geral ligada E das credenciais. O cryptKey nao entra: ele
  // e opcional na API do D4Sign.
  d4signHabilitado: Boolean(bruto.D4SIGN_ATIVO && bruto.D4SIGN_API_KEY && bruto.D4SIGN_SAFE_ID),
  d4signCredenciais: Boolean(bruto.D4SIGN_API_KEY && bruto.D4SIGN_SAFE_ID),
} as const;

export type Env = typeof env;
