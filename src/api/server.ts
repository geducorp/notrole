import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

import { env } from './config/env';
import { prisma } from './config/prisma';
import rotas from './routes';
import { errorHandler, rotaNaoEncontrada } from './middlewares/errorHandler';
import { iniciarRotinas, pararRotinas } from './jobs';
import { templateService } from './services/TemplateService';
import { configuracaoService } from './services/ConfiguracaoService';

const app = express();
const RAIZ = process.cwd();
const PASTA_DIST = path.join(RAIZ, 'dist');

/**
 * O Express fica atras do proxy/firewall corporativo. Sem isso o
 * express-rate-limit enxerga todo mundo com o mesmo IP.
 */
app.set('trust proxy', 1);

app.use(
  helmet({
    // O bundle do Vite e servido da mesma origem; a politica padrao do helmet
    // bloquearia os scripts com hash. Definimos uma CSP propria, permissiva o
    // suficiente para o React e restrita no resto.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        // O MSAL redireciona para o login da Microsoft e consulta o Graph.
        connectSrc: ["'self'", 'https://login.microsoftonline.com', 'https://graph.microsoft.com'],
        frameSrc: ["'self'", 'https://login.microsoftonline.com'],
        objectSrc: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

/**
 * O `cors()` sem argumento liberava qualquer origem. Como o proprio Express
 * serve o frontend, em producao nao ha origem cruzada nenhuma: a lista so
 * existe para o ambiente de desenvolvimento (Vite na porta 3000).
 */
app.use(
  cors({
    origin: env.corsOrigins.length > 0 ? env.corsOrigins : false,
    credentials: true,
  }),
);

// A importacao de inventario manda o CSV dentro do JSON e aceita arquivos de
// ate 2 MB; com o limite antigo de 1 MB a planilha grande virava erro.
app.use(express.json({ limit: '5mb' }));
// O webhook do D4Sign pode chegar como formulario em vez de JSON, dependendo
// de como a notificacao esta cadastrada no painel deles.
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Teto geral para a API. Rotas sensiveis tem limites proprios em routes/index.
app.use(
  '/api',
  rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { mensagem: 'Muitas requisicoes. Tente novamente em instantes.' },
  }),
);

app.use('/api', rotas);

/**
 * 404 de API precisa vir ANTES do fallback do SPA. No servidor antigo o
 * `app.get('*')` respondia index.html para qualquer coisa, inclusive para
 * /api/rota-que-nao-existe - o front recebia HTML onde esperava JSON e o erro
 * aparecia como "Unexpected token <" em vez de um 404 claro.
 */
app.use('/api', rotaNaoEncontrada);

app.use(express.static(PASTA_DIST, { index: false, maxAge: '1h' }));

app.get('*', (_req, res) => {
  res.sendFile(path.join(PASTA_DIST, 'index.html'));
});

app.use(errorHandler);

async function iniciar() {
  try {
    await prisma.$connect();
    console.log('[server] Conectado ao banco de dados.');

    await templateService.garantirPadroes();
    console.log('[server] Templates de e-mail conferidos.');

    await configuracaoService.carregar();
  } catch (erro) {
    console.error('[server] Nao foi possivel preparar o banco de dados:', erro);
    process.exit(1);
  }

  iniciarRotinas();

  const servidor = app.listen(env.PORT, env.HOST, () => {
    console.log('[server] Notrole API ouvindo em ' + env.HOST + ':' + env.PORT + ' (' + env.NODE_ENV + ').');

    if (!env.grupoAutorizadoId) {
      console.warn(
        '[server] ATENCAO: AZURE_GRUPO_AUTORIZADO_ID nao esta definido. ' +
          'Qualquer conta do tenant consegue acessar o sistema.',
      );
    }
    if (!env.d4signHabilitado) {
      console.warn('[server] D4Sign nao configurado: os emprestimos serao criados ja como ATIVO.');
    }
  });

  // Porta ocupada (um processo antigo que sobrou) ou endereco invalido: sem
  // isso o processo ficava vivo sem escutar nada. Saindo, o watchdog encerra o
  // processo antigo e sobe de novo.
  servidor.on('error', (erro) => {
    console.error('[server] Nao foi possivel escutar em ' + env.HOST + ':' + env.PORT + ':', erro);
    process.exit(1);
  });

  /**
   * Desligamento ordenado: termina as requisicoes em andamento, para as rotinas
   * e desconecta do banco, em vez de cortar uma transacao no meio.
   */
  let encerrando = false;
  const encerrar = async (motivo: string) => {
    if (encerrando) return;
    encerrando = true;
    console.log('[server] ' + motivo + '. Encerrando...');

    // Se algo travar no caminho, sai assim mesmo.
    setTimeout(() => process.exit(0), 15_000).unref();

    await new Promise<void>((resolve) => servidor.close(() => resolve()));
    console.log('[server] Servidor HTTP encerrado.');
    await pararRotinas();
    await prisma.$disconnect();

    process.exit(0);
  };

  process.on('SIGTERM', () => void encerrar('Recebido SIGTERM'));
  process.on('SIGINT', () => void encerrar('Recebido SIGINT'));

  /**
   * No Windows a tarefa agendada nao manda SIGTERM: o Stop-ScheduledTask mata o
   * processo na hora. O deploy e o watchdog pedem a parada criando o arquivo
   * logs\parar-api.sinal (ver scripts\servico\comum.ps1).
   */
  const sinalParar = path.join(RAIZ, 'logs', 'parar-api.sinal');
  setInterval(() => {
    if (fs.existsSync(sinalParar)) void encerrar('Pedido de parada (logs\\parar-api.sinal)');
  }, 1_000).unref();

  process.on('unhandledRejection', (motivo) => {
    console.error('[server] Promise rejeitada sem tratamento:', motivo);
  });

  // Uma excecao sincrona fora de qualquer try deixa o processo em estado
  // desconhecido. Registra e sai; o watchdog sobe de novo em seguida.
  process.on('uncaughtException', (erro) => {
    console.error('[server] Excecao nao tratada. Encerrando para reiniciar limpo:', erro);
    process.exit(1);
  });
}

void iniciar();
