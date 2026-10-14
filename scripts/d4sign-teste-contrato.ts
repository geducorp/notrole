/**
 * Teste do termo de comodato, com dados de exemplo.
 *
 * Uso (na pasta do projeto, no servidor):
 *
 *   npx tsx scripts/d4sign-teste-contrato.ts
 *       Gera o contrato preenchido em teste-contrato.docx, na pasta do projeto.
 *       NAO fala com o D4Sign. Abra o arquivo no Word e confira.
 *
 *   npx tsx scripts/d4sign-teste-contrato.ts --enviar-rascunho
 *       Gera o contrato e sobe para o D4Sign como RASCUNHO, na pasta da
 *       empresa padrao: sem signatario, sem envio, ninguem recebe nada.
 *       1 requisicao. Rascunho nao consome o pacote de envios (medido em
 *       21/09/2026: 146/300 antes e depois).
 *
 *   npx tsx scripts/d4sign-teste-contrato.ts --cancelar <uuid>
 *       Cancela o rascunho de teste. 1 requisicao.
 *
 * Funciona mesmo com D4SIGN_ATIVO=false: o teste existe justamente para
 * conferir o contrato antes de ligar os envios.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/api/config/prisma';
import { env } from '../src/api/config/env';
import { empresaService } from '../src/api/services/EmpresaService';
import { termoService, TermoService } from '../src/api/services/TermoService';
import { ContratoService, caminhoModeloPadrao } from '../src/api/services/ContratoService';
import { d4signService } from '../src/api/services/D4SignService';

const argumentos = process.argv.slice(2);

async function main() {
  const indiceCancelar = argumentos.indexOf('--cancelar');
  if (indiceCancelar >= 0) {
    const uuid = argumentos[indiceCancelar + 1];
    if (!uuid) throw new Error('Informe o codigo do documento depois de --cancelar.');
    await d4signService.cancelar(uuid);
    console.log(`\nPedido de cancelamento enviado para ${uuid}. Confira no painel do D4Sign.\n`);
    return;
  }

  const empresa = await empresaService.identificar(null);
  if (!empresa) throw new Error('Nenhuma empresa cadastrada. Cadastre em Configuracoes > Empresas ou rode npm run db:seed.');

  // Emprestimo de exemplo, so em memoria - nada e gravado no banco.
  const exemplo = {
    id: 0,
    dataInicio: new Date(),
    dataPrevista: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    motivo: 'TESTE - notebook proprio em manutencao',
    acessorios: 'Carregador, Mouse',
    testemunhaNome: 'Testemunha de Teste',
    testemunhaEmail: 'teste@exemplo.com',
    empresa,
    notebook: {
      hostname: 'N-TESTE-001',
      patrimonio: 'TESTE123',
      marca: 'Dell',
      modelo: 'Latitude 5420',
      valor: new Prisma.Decimal('4500'),
    },
    colaborador: {
      nome: 'Colaborador de Teste',
      email: 'colaborador@exemplo.com',
      cpf: '529.982.247-25',
      endereco: 'Rua de Teste, 123 - Centro, Cidade Exemplo/UF',
    },
  } as unknown as Parameters<typeof termoService.montarCamposDoTermo>[0];

  const campos = termoService.montarCamposDoTermo(exemplo);
  const contrato = new ContratoService(env.D4SIGN_MODELO || caminhoModeloPadrao());
  const { arquivo, camposPreenchidos } = await contrato.preencher(campos, TermoService.CAMPOS_OPCIONAIS);

  const destino = path.join(process.cwd(), 'teste-contrato.docx');
  await fs.writeFile(destino, arquivo);

  console.log(`\nContrato de exemplo gerado: ${destino}`);
  console.log(`Empresa: ${empresa.apelido} · ${camposPreenchidos.length} campos preenchidos.`);
  console.log('Abra no Word e confira. Nada foi enviado ao D4Sign.');

  if (!argumentos.includes('--enviar-rascunho')) {
    console.log('\nPara ver como fica no D4Sign, rode de novo com --enviar-rascunho.\n');
    return;
  }

  console.log(`\nSubindo como RASCUNHO para a pasta da ${empresa.apelido} no D4Sign...`);
  const uuid = await d4signService.criarDocumento({
    nome: 'TESTE NOTROLE - NAO ASSINAR - pode cancelar.docx',
    arquivo,
    pastaId: empresa.d4signPastaId,
  });

  console.log(`Rascunho criado: ${uuid}`);
  console.log('Sem signatario e sem envio - ninguem recebe nada.');
  console.log(`\nConfira no painel: cofre configurado (D4SIGN_SAFE_ID) > pasta ${empresa.apelido.split(' ')[0]?.toUpperCase()}.`);
  console.log('Depois de conferir, cancele:');
  console.log(`  npx tsx scripts/d4sign-teste-contrato.ts --cancelar ${uuid}\n`);
}

main()
  .catch((erro) => {
    console.error(`\nFalhou: ${erro instanceof Error ? erro.message : String(erro)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
