/**
 * Confere se a configuracao do Entra ID esta funcionando de ponta a ponta.
 *
 * Uso: node scripts/verificar-entra.mjs
 *
 * Testa, nesta ordem:
 *   1. o client secret e aceito (e o erro que derrubava a API em crash-loop);
 *   2. a permissao User.Read.All funciona (busca de colaboradores no AD);
 *   3. a permissao GroupMember.Read.All funciona;
 *   4. o grupo de AZURE_GRUPO_AUTORIZADO_ID existe de fato no Entra ID e
 *      quantos membros tem.
 *
 * O item 4 pega um engano comum: um grupo criado no Active Directory local tem
 * um objectGUID proprio, que NAO e o mesmo id do objeto correspondente no Entra
 * ID. Usar o GUID errado faz todo mundo tomar "sem permissao" sem explicacao.
 *
 * Nao altera nada e nao imprime o segredo.
 */
import 'dotenv/config';

const tenant = process.env.AZURE_TENANT_ID?.trim();
const clientId = process.env.AZURE_CLIENT_ID?.trim();
const clientSecret = process.env.AZURE_CLIENT_SECRET?.trim();
const grupoId = process.env.AZURE_GRUPO_AUTORIZADO_ID?.trim();

// Tudo roda dentro de main() para encerrar com "return" em vez de process.exit.
// Chamar process.exit com a conexao do fetch ainda aberta derruba o Node no
// Windows com "Assertion failed ... srcwinasync.c".
async function main() {
  const ok = (t) => console.log(`  [ok]    ${t}`);
  const falha = (t) => console.log(`  [FALHA] ${t}`);
  const aviso = (t) => console.log(`  [aviso] ${t}`);

  if (!tenant || !clientId || !clientSecret) {
    console.error('\nFaltam AZURE_TENANT_ID, AZURE_CLIENT_ID ou AZURE_CLIENT_SECRET no .env.\n');
    process.exitCode = 1;
    return;
  }

  console.log('\nVerificando a configuracao do Entra ID...\n');

  // --- 1. Token de aplicacao --------------------------------------------------
  let token;
  console.log('1. Credenciais do aplicativo');
  try {
    const corpo = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });

    const resposta = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: corpo,
    });

    const dados = await resposta.json();

    if (!resposta.ok) {
      falha(`o Azure recusou as credenciais: ${dados.error} - ${dados.error_description?.split('\n')[0]}`);
      console.log('\n  Gere um novo segredo em: Entra ID > Registros de aplicativo > Notrole >');
      console.log('  Certificados e segredos. Depois rode: .\\scripts\\configurar.ps1\n');
      process.exitCode = 1;
      return;
    }

    token = dados.access_token;
    ok('client secret aceito pelo Azure.');
  } catch (erro) {
    falha(`nao foi possivel falar com o Azure: ${erro.message}`);
    process.exitCode = 1;
    return;
  }

  const graph = async (caminho) => {
    const resposta = await fetch(`https://graph.microsoft.com/v1.0${caminho}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { resposta, dados: await resposta.json().catch(() => ({})) };
  };

  // --- Modo --empresas ------------------------------------------------------
  // Lista os valores do campo "Empresa" (companyName) dos usuarios do AD. O
  // Notrole usa esse campo para saber de qual empresa e o colaborador - e,
  // portanto, em nome de qual empresa o termo de comodato e emitido.
  if (process.argv.includes('--empresas')) {
    console.log('\nEMPRESAS CADASTRADAS NO AD (campo "Empresa" do perfil)\n');

    const contagem = new Map();
    let proxima = '/users?$select=companyName&$filter=accountEnabled eq true&$top=999';
    let paginas = 0;

    while (proxima && paginas < 20) {
      const { resposta, dados } = await graph(proxima);
      if (!resposta.ok) {
        falha(`${dados.error?.code ?? resposta.status}: ${dados.error?.message ?? 'erro'}`);
        process.exitCode = 1;
        return;
      }
      for (const u of dados.value ?? []) {
        const empresa = (u.companyName ?? '').trim() || '(vazio)';
        contagem.set(empresa, (contagem.get(empresa) ?? 0) + 1);
      }
      proxima = dados['@odata.nextLink']?.replace('https://graph.microsoft.com/v1.0', '') ?? null;
      paginas += 1;
    }

    const linhas = [...contagem.entries()].sort((a, b) => b[1] - a[1]);
    for (const [empresa, total] of linhas) {
      console.log(`  ${String(total).padStart(5)}  ${empresa}`);
    }
    console.log('\nSomente leitura. Nada foi alterado.\n');
    return;
  }

  // --- 2. User.Read.All -------------------------------------------------------
  console.log('\n2. Permissao para buscar usuarios (User.Read.All)');
  {
    const { resposta, dados } = await graph('/users?$top=1&$select=id');
    if (resposta.ok) {
      ok('a busca de colaboradores no AD vai funcionar.');
    } else {
      falha(`${dados.error?.code ?? resposta.status}: ${dados.error?.message ?? 'erro desconhecido'}`);
      console.log('  Adicione User.Read.All como permissao de APLICATIVO e conceda o');
      console.log('  consentimento do administrador.');
    }
  }

  // --- 3 e 4. Grupo autorizado ------------------------------------------------
  console.log('\n3. Grupo que libera o acesso ao sistema');

  if (!grupoId) {
    aviso('AZURE_GRUPO_AUTORIZADO_ID esta vazio.');
    console.log('  Enquanto isso, QUALQUER conta do tenant tem acesso total ao Notrole.');
  } else {
    const { resposta, dados } = await graph(
      `/groups/${grupoId}?$select=id,displayName,onPremisesSyncEnabled,securityEnabled`,
    );

    if (resposta.status === 404) {
      falha(`nenhum grupo com o id ${grupoId} existe neste tenant.`);
      console.log('');
      console.log('  Se voce criou o grupo no Active Directory local, o id que o sistema');
      console.log('  precisa NAO e o objectGUID de la: e o "ID do objeto" que aparece no');
      console.log('  portal do Azure depois que o grupo sincroniza.');
      console.log('');
      console.log('  Abra portal.azure.com > Entra ID > Grupos, procure o grupo pelo nome,');
      console.log('  abra e copie o "ID do objeto". Se ele nao aparecer la, a OU dele esta');
      console.log('  fora do escopo do Entra Connect.');
    } else if (!resposta.ok) {
      falha(`${dados.error?.code ?? resposta.status}: ${dados.error?.message ?? 'erro desconhecido'}`);
      console.log('  Confira a permissao GroupMember.Read.All (tipo Aplicativo, com consentimento).');
    } else {
      ok(`grupo encontrado: "${dados.displayName}".`);

      if (dados.onPremisesSyncEnabled) {
        console.log('          Origem: Active Directory local, sincronizado para a nuvem.');
      } else {
        console.log('          Origem: criado direto no Entra ID.');
      }

      if (dados.securityEnabled === false) {
        aviso('este grupo nao e do tipo Seguranca. Prefira um grupo de seguranca.');
      }

      const membros = await graph(`/groups/${grupoId}/members?$select=displayName,userPrincipalName`);
      if (membros.resposta.ok) {
        const lista = membros.dados.value ?? [];
        ok(`${lista.length} membro(s) com acesso ao Notrole:`);
        for (const m of lista.slice(0, 20)) {
          console.log(`          - ${m.displayName ?? ''} (${m.userPrincipalName ?? ''})`);
        }
        if (lista.length === 0) {
          aviso('o grupo esta vazio: ninguem conseguira entrar no sistema.');
        }
      } else {
        falha(
          `nao foi possivel listar os membros: ${membros.dados.error?.message ?? membros.resposta.status}`,
        );
        console.log('  Confira a permissao GroupMember.Read.All (tipo Aplicativo, com consentimento).');
      }
    }
  }

  console.log('');

}

await main();
