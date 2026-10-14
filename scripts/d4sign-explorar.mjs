/**
 * Mostra o que o Notrole precisa saber da conta do D4Sign. SOMENTE LEITURA.
 *
 * Uso: node scripts/d4sign-explorar.mjs
 *
 * Faz exatamente 3 consultas e NAO cria, altera nem envia nenhum documento:
 *   1. GET  /account/balance  -> saldo/consumo do plano
 *   2. GET  /safes            -> cofres (o uuid_safe vira D4SIGN_SAFE_ID)
 *   3. POST /templates        -> modelos cadastrados (so informativo: o termo
 *      e preenchido pelo proprio Notrole, a partir de docs/modelos)
 *      (a API do D4Sign usa POST para LISTAR os modelos; nao cria nada)
 */
import 'dotenv/config';

const BASE = {
  producao: 'https://secure.d4sign.com.br/api/v1',
  sandbox: 'https://sandbox.d4sign.com.br/api/v1',
}[process.env.D4SIGN_AMBIENTE === 'sandbox' ? 'sandbox' : 'producao'];

const tokenAPI = process.env.D4SIGN_API_KEY?.trim();
// Opcional: so existe se estiver habilitado na conta.
const cryptKey = process.env.D4SIGN_CRYPT_KEY?.trim();


async function chamar(caminho, metodo) {
  const query = new URLSearchParams({ tokenAPI, ...(cryptKey ? { cryptKey } : {}) });
  const resposta = await fetch(`${BASE}${caminho}?${query}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
  });

  const texto = await resposta.text();
  if (!resposta.ok) {
    throw new Error(`HTTP ${resposta.status}: ${texto.slice(0, 300)}`);
  }

  try {
    return JSON.parse(texto);
  } catch {
    throw new Error(`resposta nao e JSON: ${texto.slice(0, 300)}`);
  }
}

/** A API devolve listas ora como array, ora como objeto {"0": ..., "1": ...}. */
const comoLista = (valor) =>
  Array.isArray(valor) ? valor : valor && typeof valor === 'object' ? Object.values(valor) : [];

async function main() {
  if (!tokenAPI) {
    console.error('\nFalta D4SIGN_API_KEY no .env.');
    console.error('Gere a chave no D4Sign (seu e-mail > Dev API > Nova chave API) e grave com:');
    console.error('  .\\scripts\\configurar.ps1\n');
    process.exitCode = 1;
    return;
  }

  console.log(`\nConsultando o D4Sign (${BASE.includes('sandbox') ? 'SANDBOX - testes' : 'PRODUCAO'})...`);
  console.log(`cryptKey: ${cryptKey ? 'informado' : 'nao informado (ok, e opcional)'}\n`);

  // --- Modo --pastas: so lista as pastas do cofre configurado (1 consulta) ----
  // Dentro do cofre de TI ha uma pasta por empresa (uma por CNPJ). O
  // termo deve ir para a pasta da empresa do colaborador.
  if (process.argv.includes('--pastas')) {
    const cofre = process.env.D4SIGN_SAFE_ID?.trim();
    if (!cofre) {
      console.error('Falta D4SIGN_SAFE_ID no .env.\n');
      process.exitCode = 1;
      return;
    }

    console.log(`PASTAS DO COFRE ${cofre}`);
    try {
      const resposta = await chamar(`/folders/${cofre}/find`, 'GET');
      const pastas = comoLista(resposta);
      if (pastas.length === 0) console.log('   nenhuma pasta encontrada.');
      for (const p of pastas) {
        const uuid = p.uuid_folder ?? p.uuid ?? p.id ?? '?';
        const nome = p.name ?? p.name_folder ?? p.nome ?? '';
        console.log(`   ${uuid}   ${nome}`);
      }
      // A documentacao nao descreve os campos da resposta; o bruto ajuda a
      // conferir se a leitura acima pegou os nomes certos.
      console.log('\n   Resposta completa:');
      console.log(JSON.stringify(resposta, null, 2).split('\n').map((l) => '   ' + l).join('\n'));
    } catch (erro) {
      console.log(`   falha ao listar: ${erro.message}`);
    }
    console.log('\n1 consulta de leitura. Nenhum documento foi criado.\n');
    return;
  }

  // --- 1. Saldo --------------------------------------------------------------
  console.log('1. SALDO / CONSUMO DO PLANO');
  try {
    const saldo = await chamar('/account/balance', 'GET');
    console.log(
      JSON.stringify(saldo, null, 2)
        .split('\n')
        .map((l) => '   ' + l)
        .join('\n'),
    );
  } catch (erro) {
    console.log(`   nao foi possivel consultar: ${erro.message}`);
    if (/401|403|token|invalid/i.test(erro.message)) {
      console.log('   A chave pode estar errada. Confira o que foi colado no configurar.ps1.');
      process.exitCode = 1;
      return;
    }
  }

  // --- 2. Cofres -------------------------------------------------------------
  console.log('\n2. COFRES  (o uuid_safe vira D4SIGN_SAFE_ID)');
  try {
    const cofres = comoLista(await chamar('/safes', 'GET'));
    if (cofres.length === 0) console.log('   nenhum cofre encontrado.');
    for (const c of cofres) {
      const atual = c.uuid_safe && c.uuid_safe === process.env.D4SIGN_SAFE_ID ? '   <- configurado hoje' : '';
      console.log(`   ${c.uuid_safe ?? c.uuid ?? '?'}   ${c['name-safe'] ?? c.name_safe ?? c.name ?? ''}${atual}`);
    }
  } catch (erro) {
    console.log(`   falha ao listar: ${erro.message}`);
  }

  // --- 3. Modelos ------------------------------------------------------------
  // So informativo: o termo e preenchido pelo proprio Notrole a partir de
  // docs/modelos, e nao pelo motor de modelos do D4Sign (ver ContratoService).
  console.log('\n3. MODELOS CADASTRADOS NO D4SIGN (informativo)');
  try {
    const modelos = comoLista(await chamar('/templates', 'POST'));
    if (modelos.length === 0) console.log('   nenhum modelo encontrado.');

    for (const m of modelos) {
      const variaveis = comoLista(m.variables ?? m.variaveis).map(String);

      console.log(`\n   id: ${m.id ?? '?'}`);
      console.log(`   nome: ${m.name ?? m.nome ?? ''}`);
      if (m.type ?? m.tipo) console.log(`   tipo: ${m.type ?? m.tipo}`);
      console.log(`   variaveis: ${variaveis.length ? variaveis.join(', ') : '(nenhuma)'}`);

    }
  } catch (erro) {
    console.log(`   falha ao listar: ${erro.message}`);
  }

  console.log('\n---');
  console.log('Nenhum documento foi criado. Foram feitas 3 consultas de leitura.');
  console.log('Mande esta saida para quem esta configurando o Notrole.\n');
}

await main();
