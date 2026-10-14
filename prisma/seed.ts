/**
 * Dados de EXEMPLO para experimentar o Notrole num banco vazio.
 *
 *   npm run db:migrate   # cria as tabelas
 *   npm run db:seed      # cadastra duas empresas ficticias
 *
 * As migracoes so criam a estrutura (e as categorias padrao do estoque). As
 * empresas de verdade sao cadastradas em Configuracoes > Empresas; este seed
 * existe so para demonstracao e desenvolvimento. Os CNPJs sao ficticios e
 * propositalmente invalidos. Pode rodar mais de uma vez: nao duplica nada.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const EMPRESAS = [
  {
    apelido: 'Empresa Exemplo A',
    razaoSocial: 'Empresa Exemplo A Ltda',
    cnpj: '00.000.000/0001-00',
    logradouro: 'Rua Exemplo, 100 - Centro',
    cidade: 'Cidade Exemplo',
    uf: 'SP',
    cep: '00000-000',
    // Palavras que reconhecem a empresa no campo "Empresa" do perfil do AD.
    termosAD: 'exemplo a',
    padrao: true,
  },
  {
    apelido: 'Empresa Exemplo B',
    razaoSocial: 'Empresa Exemplo B Comercio Ltda',
    cnpj: '00.000.000/0002-00',
    logradouro: 'Avenida Modelo, 200 - Distrito Industrial',
    cidade: 'Cidade Exemplo',
    uf: 'SP',
    cep: '00000-001',
    termosAD: 'exemplo b',
    padrao: false,
  },
];

async function main() {
  for (const empresa of EMPRESAS) {
    await prisma.empresa.upsert({
      where: { cnpj: empresa.cnpj },
      update: {},
      create: empresa,
    });
  }
  console.log(`Seed concluido: ${EMPRESAS.length} empresas de exemplo.`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
