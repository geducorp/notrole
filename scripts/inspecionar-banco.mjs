/**
 * Inspecao SOMENTE LEITURA do banco do Notrole.
 *
 * Uso: node scripts/inspecionar-banco.mjs
 *
 * Nao altera nenhum dado. Serve para conferir rapidamente o estado do banco
 * sem precisar abrir o Prisma Studio ou um cliente SQL.
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: ['warn', 'error'] });

try {
  const [notebooks, colaboradores, emprestimos, historico, emails, templates] = await Promise.all([
    prisma.notebook.count(),
    prisma.colaborador.count(),
    prisma.emprestimo.count(),
    prisma.historicoAcoes.count(),
    prisma.emailEnviado.count(),
    prisma.templateEmail.count(),
  ]);

  console.log('CONTAGENS');
  console.table({ notebooks, colaboradores, emprestimos, historico, emails, templates });

  const porStatusNotebook = await prisma.notebook.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('\nNOTEBOOKS POR STATUS');
  console.table(porStatusNotebook.map((r) => ({ status: r.status, total: r._count._all })));

  const porStatusEmprestimo = await prisma.emprestimo.groupBy({
    by: ['status'],
    _count: { _all: true },
  });
  console.log('\nEMPRESTIMOS POR STATUS');
  console.table(porStatusEmprestimo.map((r) => ({ status: r.status, total: r._count._all })));

  const emAberto = await prisma.emprestimo.findMany({
    where: { status: { in: ['AGUARDANDO_ASSINATURA', 'ATIVO'] } },
    include: { notebook: true, colaborador: true },
    orderBy: { dataPrevista: 'asc' },
  });

  const agora = new Date();
  console.log('\nEMPRESTIMOS EM ABERTO');
  if (emAberto.length === 0) {
    console.log('  (nenhum)');
  } else {
    console.table(
      emAberto.map((e) => {
        const limite = new Date(e.dataPrevista);
        limite.setHours(23, 59, 59, 999);

        return {
          id: e.id,
          notebook: e.notebook?.hostname,
          colaborador: e.colaborador?.nome,
          status: e.status,
          prazo: e.dataPrevista?.toISOString().slice(0, 10),
          atrasado: agora > limite ? 'SIM' : 'nao',
          ultimaCobranca: e.ultimaCobrancaEm?.toISOString().slice(0, 10) ?? '-',
        };
      }),
    );
  }

  const ultimosEmails = await prisma.emailEnviado.findMany({
    orderBy: { enviadoEm: 'desc' },
    take: 10,
  });

  console.log('\nULTIMOS E-MAILS ENVIADOS');
  if (ultimosEmails.length === 0) {
    console.log('  (nenhum)');
  } else {
    console.table(
      ultimosEmails.map((e) => ({
        quando: e.enviadoEm.toISOString().slice(0, 16).replace('T', ' '),
        template: e.template,
        para: e.destinatario,
        ok: e.sucesso ? 'sim' : 'NAO',
        erro: e.erro?.slice(0, 60) ?? '',
      })),
    );
  }
} finally {
  await prisma.$disconnect();
}
