import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../config/prisma';
import type { RequestHandler } from 'express';
import { protegido } from '../middlewares/auth';
import { exigirEmpresaDoUsuario, somenteAdministrador } from '../middlewares/permissao';
import { itemController } from '../controllers/ItemController';
import { estoqueController } from '../controllers/EstoqueController';
import { emprestimoController } from '../controllers/EmprestimoController';
import { colaboradorController } from '../controllers/ColaboradorController';
import { reportController } from '../controllers/ReportController';
import { configuracaoController } from '../controllers/ConfiguracaoController';
import { webhookController } from '../controllers/WebhookController';
import { empresaController } from '../controllers/EmpresaController';

const rotas = Router();

/**
 * Todas as rotas de negocio exigem token do Entra ID E pertencer ao grupo
 * autorizado (ver middlewares/auth.ts). Antes bastava um token valido de
 * qualquer conta do tenant para apagar notebooks.
 *
 * As duas excecoes sao a rota de saude e o webhook do D4Sign, que se autentica
 * por segredo compartilhado porque quem chama e um servico, nao uma pessoa.
 *
 * Alem disso, as rotas de negocio usam `negocio`: o analista sem empresa no AD
 * leva 403 SEM_EMPRESA em tudo (ver PermissaoService). So o /me usa
 * `protegido` puro, para a tela saber o motivo e mostrar o aviso.
 */

const negocio: RequestHandler = (req, res, next) => {
  protegido(req, res, (erro?: unknown) => {
    if (erro) return next(erro);
    void exigirEmpresaDoUsuario(req, res, next);
  });
};

// --- Publicas --------------------------------------------------------------

// Liveness: o processo esta de pe. E o que o watchdog usa para decidir se
// reinicia a API, por isso nao depende do banco (com o banco fora, reiniciar a
// API nao resolve e entraria em loop).
rotas.get('/health', (_req, res) => {
  res.json({ status: 'ok', servico: 'notrole-api', horario: new Date().toISOString() });
});

// Readiness: a API consegue de fato atender, ou seja, consulta o banco. O
// watchdog usa para mandar o alerta de "banco inacessivel".
rotas.get('/ready', async (_req, res) => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, rejeitar) => setTimeout(() => rejeitar(new Error('tempo esgotado')), 3_000)),
    ]);
    res.json({ status: 'ok', banco: 'ok' });
  } catch (erro) {
    res.status(503).json({ status: 'erro', banco: (erro as Error).message });
  }
});

// O D4Sign pode reenviar a mesma notificacao varias vezes; o limite evita que
// um erro do lado deles vire uma enxurrada de requisicoes.
const limiteWebhook = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

rotas.post('/webhooks/d4sign', limiteWebhook, (req, res, next) =>
  webhookController.d4sign(req, res, next),
);

// --- Estoque: equipamentos identificados -----------------------------------

rotas.get('/itens', negocio, (req, res, next) => itemController.listar(req, res, next));
rotas.get('/itens/:id', negocio, (req, res, next) => itemController.buscarPorId(req, res, next));
rotas.post('/itens', negocio, (req, res, next) => itemController.criar(req, res, next));
rotas.put('/itens/:id', negocio, (req, res, next) => itemController.atualizar(req, res, next));
rotas.delete('/itens/:id', negocio, (req, res, next) => itemController.remover(req, res, next));

// Movimentacoes de um equipamento.
rotas.post('/itens/:id/devolucao', negocio, (req, res, next) =>
  estoqueController.receberDeVolta(req, res, next),
);
rotas.post('/itens/:id/transferencia', negocio, (req, res, next) =>
  estoqueController.transferir(req, res, next),
);
rotas.post('/itens/:id/manutencao', negocio, (req, res, next) =>
  estoqueController.enviarParaManutencao(req, res, next),
);
rotas.post('/itens/:id/retorno-manutencao', negocio, (req, res, next) =>
  estoqueController.retornarDaManutencao(req, res, next),
);
rotas.post('/itens/:id/baixa', negocio, (req, res, next) =>
  estoqueController.darBaixa(req, res, next),
);

// --- Estoque: itens por quantidade, categorias e extrato -----------

rotas.get('/estoque/resumo', negocio, (req, res, next) =>
  estoqueController.resumo(req, res, next),
);
rotas.get('/estoque/por-setor', negocio, (req, res, next) =>
  estoqueController.porSetor(req, res, next),
);
rotas.get('/estoque/modelo-importacao', negocio, (req, res, next) =>
  estoqueController.modeloDeImportacao(req, res, next),
);
rotas.post('/estoque/importacao', negocio, (req, res, next) =>
  estoqueController.importar(req, res, next),
);

rotas.get('/estoque/movimentacoes', negocio, (req, res, next) =>
  estoqueController.listarMovimentacoes(req, res, next),
);

rotas.get('/estoque/categorias', negocio, (req, res, next) =>
  estoqueController.listarCategorias(req, res, next),
);
rotas.post('/estoque/categorias', negocio, (req, res, next) =>
  estoqueController.criarCategoria(req, res, next),
);
rotas.put('/estoque/categorias/:id', negocio, (req, res, next) =>
  estoqueController.atualizarCategoria(req, res, next),
);

rotas.get('/estoque/quantidades', negocio, (req, res, next) =>
  estoqueController.listarQuantidades(req, res, next),
);
rotas.post('/estoque/quantidades', negocio, (req, res, next) =>
  estoqueController.criarQuantidade(req, res, next),
);
rotas.put('/estoque/quantidades/:id', negocio, (req, res, next) =>
  estoqueController.atualizarQuantidade(req, res, next),
);
rotas.delete('/estoque/quantidades/:id', negocio, (req, res, next) =>
  estoqueController.removerQuantidade(req, res, next),
);
rotas.post('/estoque/quantidades/:id/entrada', negocio, (req, res, next) =>
  estoqueController.entradaDeQuantidade(req, res, next),
);
rotas.post('/estoque/quantidades/:id/saida', negocio, (req, res, next) =>
  estoqueController.saidaDeQuantidade(req, res, next),
);
rotas.post('/estoque/quantidades/:id/ajuste', negocio, (req, res, next) =>
  estoqueController.ajustarQuantidade(req, res, next),
);

// --- Colaboradores ---------------------------------------------------------

// A busca no AD e o cadastro ficam antes de '/:id' de proposito: como '/ad/search' casaria
// com o padrao '/:id', inverter a ordem faria o Express tentar interpretar
// "ad" como um id.
rotas.get('/colaboradores/ad/search', negocio, (req, res, next) =>
  colaboradorController.buscarNoAD(req, res, next),
);
rotas.get('/colaboradores/cadastro', negocio, (req, res, next) =>
  colaboradorController.buscarParaCessao(req, res, next),
);
rotas.get('/colaboradores', negocio, (req, res, next) =>
  colaboradorController.listar(req, res, next),
);
rotas.get('/colaboradores/:id', negocio, (req, res, next) =>
  colaboradorController.buscarPorId(req, res, next),
);
rotas.patch('/colaboradores/:id', negocio, (req, res, next) =>
  colaboradorController.atualizar(req, res, next),
);

// --- Emprestimos -----------------------------------------------------------

rotas.get('/emprestimos', negocio, (req, res, next) =>
  emprestimoController.listar(req, res, next),
);
rotas.post('/emprestimos', negocio, (req, res, next) => emprestimoController.criar(req, res, next));
rotas.get('/emprestimos/:id', negocio, (req, res, next) =>
  emprestimoController.buscarPorId(req, res, next),
);
rotas.get('/emprestimos/:id/historico', negocio, (req, res, next) =>
  emprestimoController.listarHistorico(req, res, next),
);
rotas.get('/emprestimos/:id/comprovante-devolucao', negocio, (req, res, next) =>
  emprestimoController.comprovanteDevolucao(req, res, next),
);
rotas.post('/emprestimos/:id/devolucao', negocio, (req, res, next) =>
  emprestimoController.registrarDevolucao(req, res, next),
);
rotas.post('/emprestimos/:id/renovacao', negocio, (req, res, next) =>
  emprestimoController.renovar(req, res, next),
);
rotas.post('/emprestimos/:id/ativacao', negocio, (req, res, next) =>
  emprestimoController.ativar(req, res, next),
);
rotas.post('/emprestimos/:id/termo/tentar-novamente', negocio, (req, res, next) =>
  emprestimoController.tentarTermoNovamente(req, res, next),
);
rotas.post('/emprestimos/:id/verificar-assinatura', negocio, (req, res, next) =>
  emprestimoController.verificarAssinatura(req, res, next),
);
rotas.post('/emprestimos/:id/termo/reenviar-convite', negocio, (req, res, next) =>
  emprestimoController.reenviarConvite(req, res, next),
);
rotas.post('/emprestimos/:id/cancelamento', negocio, (req, res, next) =>
  emprestimoController.cancelar(req, res, next),
);

// --- Empresas --------------------------------------------------------------

// '/identificar' antes de '/:id', pelo mesmo motivo da busca no AD acima.
rotas.get('/empresas/identificar', negocio, (req, res, next) =>
  empresaController.identificar(req, res, next),
);
rotas.get('/empresas', negocio, (req, res, next) => empresaController.listar(req, res, next));
rotas.post('/empresas', negocio, somenteAdministrador('cadastrar empresas'), (req, res, next) =>
  empresaController.criar(req, res, next),
);
rotas.put('/empresas/:id', negocio, somenteAdministrador('alterar os dados das empresas'), (req, res, next) =>
  empresaController.atualizar(req, res, next),
);

// --- Relatorios ------------------------------------------------------------

rotas.get('/relatorios/dashboard', negocio, (req, res, next) =>
  reportController.dashboard(req, res, next),
);
rotas.get('/relatorios/planilha', negocio, (req, res, next) =>
  reportController.planilha(req, res, next),
);
rotas.get('/relatorios/pdf/estoque', negocio, (req, res, next) =>
  reportController.pdfItens(req, res, next),
);
rotas.get('/relatorios/pdf/emprestimos', negocio, (req, res, next) =>
  reportController.pdfEmprestimos(req, res, next),
);

// --- Configuracoes ---------------------------------------------------------

// Disparar as rotinas manualmente envia e-mail de verdade, entao o limite aqui
// e baixo de proposito.
const limiteRotinas = rateLimit({
  windowMs: 5 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { mensagem: 'Muitas execucoes seguidas. Aguarde alguns minutos.' },
});

rotas.get('/me', protegido, (req, res, next) => configuracaoController.eu(req, res, next));
rotas.get('/configuracoes/status', negocio, (req, res, next) =>
  configuracaoController.status(req, res, next),
);
rotas.get('/configuracoes/templates', negocio, (req, res, next) =>
  configuracaoController.listarTemplates(req, res, next),
);
rotas.put('/configuracoes/templates/:chave', negocio, somenteAdministrador('editar os modelos de e-mail'), (req, res, next) =>
  configuracaoController.atualizarTemplate(req, res, next),
);
rotas.post('/configuracoes/templates/:chave/restaurar', negocio, somenteAdministrador('editar os modelos de e-mail'), (req, res, next) =>
  configuracaoController.restaurarTemplate(req, res, next),
);
rotas.post('/configuracoes/templates/:chave/teste', negocio, somenteAdministrador('testar os modelos de e-mail'), limiteRotinas, (req, res, next) =>
  configuracaoController.enviarTeste(req, res, next),
);
rotas.get('/configuracoes/smtp/teste', negocio, (req, res, next) =>
  configuracaoController.testarSmtp(req, res, next),
);
rotas.get('/configuracoes/emails', negocio, (req, res, next) =>
  configuracaoController.listarEmailsEnviados(req, res, next),
);
rotas.post('/configuracoes/rotinas/cobranca', negocio, somenteAdministrador('rodar as rotinas na mao'), limiteRotinas, (req, res, next) =>
  configuracaoController.executarCobranca(req, res, next),
);
rotas.post('/configuracoes/rotinas/lembretes', negocio, somenteAdministrador('rodar as rotinas na mao'), limiteRotinas, (req, res, next) =>
  configuracaoController.executarLembretes(req, res, next),
);
rotas.get('/configuracoes/termos/fila', negocio, (req, res, next) =>
  configuracaoController.filaDeTermos(req, res, next),
);
rotas.put('/configuracoes/d4sign', negocio, somenteAdministrador('ligar ou desligar o D4Sign'), (req, res, next) =>
  configuracaoController.pausarD4sign(req, res, next),
);
rotas.post('/configuracoes/termos/fila', negocio, somenteAdministrador('processar a fila de termos'), limiteRotinas, (req, res, next) =>
  configuracaoController.processarFilaDeTermos(req, res, next),
);

export default rotas;
