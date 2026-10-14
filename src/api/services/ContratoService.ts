import fs from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

/**
 * Preenchimento do termo de comodato a partir do modelo Word.
 *
 * Por que o Notrole preenche o contrato, e nao o D4Sign
 * -----------------------------------------------------
 * O D4Sign tem um motor de modelos proprio, e o plano original era usa-lo.
 * Nos testes, ele preenchia de forma consistente so parte dos campos do nosso
 * modelo (a tabela de itens e a cidade/data) e deixava em branco o resto -
 * dados da empresa, do colaborador, motivo, data de devolucao e testemunha.
 * Foram descartados, um a um, formato do corpo, grafia das chaves, negrito,
 * posicao no texto e a opcao "Obrigatorio" do modelo, sem chegar a causa.
 *
 * A saida foi tirar essa dependencia: o Notrole preenche o .docx e envia o
 * documento pronto (POST /documents/{cofre}/uploadbinary). O D4Sign so recolhe
 * as assinaturas. Custo identico: criar documento sem enviar nao consome o
 * pacote, e o envio para assinatura conta 1 do mesmo jeito.
 *
 * Como o modelo e escrito
 * -----------------------
 * Os campos usam a sintaxe que ja estava no arquivo: ${"Nome do Campo"} (com
 * aspas curvas ou retas). A chave e o nome normalizado - minusculas, sem
 * acento, com sublinhado no lugar de espaco e pontuacao:
 *   "Nome da Empresa"      -> nome_da_empresa
 *   "Cidade, Estado, Data" -> cidade_estado_data
 *
 * O Word quebra o texto em pedacos internos (runs) de forma imprevisivel, e um
 * campo costuma ficar espalhado por varios deles. Antes de substituir, os
 * pedacos de cada campo sao juntados num so, com a formatacao do pedaco onde o
 * nome do campo comeca - assim um campo em negrito continua em negrito.
 *
 * Trava de seguranca: se sobrar qualquer campo sem valor, ou se o modelo tiver
 * um campo que o Notrole nao conhece, o documento NAO e gerado. Contrato com
 * lacuna nunca chega ao D4Sign.
 */

const MARCADOR = /\$\{[“"]([^”"]+)[”"]\}/g;
const RUN = /<w:r(?:\s[^>]*)?>[\s\S]*?<\/w:r>/g;
const PARAGRAFO = /<w:p[ >][\s\S]*?<\/w:p>/g;

/** Mesma normalizacao usada pelo D4Sign ao listar os campos de um modelo. */
export function chaveDoCampo(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface Run {
  xml: string;
  inicio: number;
  rPr: string;
  texto: string;
  simples: boolean;
}

function lerRuns(paragrafo: string): Run[] {
  return [...paragrafo.matchAll(RUN)].map((m) => {
    const xml = m[0];
    const rPr = (xml.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) ?? [''])[0];
    const textos = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)];
    // "Simples" = so formatacao e um unico texto. Runs com tabulacao, quebra
    // de linha ou imagem nao sao mexidos.
    const resto = xml
      .replace(/^<w:r(?:\s[^>]*)?>|<\/w:r>$/g, '')
      .replace(rPr, '')
      .replace(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g, '')
      .trim();
    return {
      xml,
      inicio: m.index ?? 0,
      rPr,
      texto: textos.map((t) => t[1]).join(''),
      simples: textos.length <= 1 && resto === '',
    };
  });
}

/** Substitui os campos de um paragrafo. Devolve o XML novo e os campos usados. */
function preencherParagrafo(
  paragrafo: string,
  valores: Record<string, string>,
  usados: Set<string>,
  desconhecidos: Set<string>,
): string {
  const runs = lerRuns(paragrafo);
  if (runs.length === 0) return paragrafo;

  const texto = runs.map((r) => r.texto).join('');
  const marcadores = [...texto.matchAll(MARCADOR)];
  if (marcadores.length === 0) return paragrafo;

  // Segmentos de texto, cada um com a formatacao do run de origem.
  type Segmento = { rPr: string; texto: string; run: number; editado?: boolean };
  let segmentos: Segmento[] = runs.map((r, i) => ({ rPr: r.rPr, texto: r.texto, run: i }));

  // Do ultimo para o primeiro, para as posicoes dos anteriores nao mudarem.
  for (const m of marcadores.reverse()) {
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    const nome = m[1] ?? '';
    const chave = chaveDoCampo(nome);

    if (!(chave in valores)) {
      desconhecidos.add(nome);
      continue;
    }
    usados.add(chave);

    // Runs envolvidos: todos precisam ser simples.
    let acumulado = 0;
    const envolvidos: number[] = [];
    runs.forEach((r, i) => {
      const a = acumulado;
      const b = acumulado + r.texto.length;
      if (b > inicio && a < fim) envolvidos.push(i);
      acumulado = b;
    });
    if (!envolvidos.every((i) => runs[i]?.simples)) {
      throw new Error(
        `O campo "${nome}" do modelo esta misturado com tabulacao, quebra de linha ou imagem. ` +
          'Reescreva-o no Word em uma unica linha de texto.',
      );
    }

    // A formatacao vem do run onde o NOME comeca (depois de "${"), para que um
    // campo em negrito no Word saia em negrito no contrato.
    const inicioDoNome = inicio + 3;
    let formatacao = runs[envolvidos[0] ?? 0]?.rPr ?? '';
    acumulado = 0;
    for (const [i, r] of runs.entries()) {
      const a = acumulado;
      const b = acumulado + r.texto.length;
      if (inicioDoNome >= a && inicioDoNome < b) {
        formatacao = runs[i]?.rPr ?? formatacao;
        break;
      }
      acumulado = b;
    }

    const novos: Segmento[] = [];
    let posicao = 0;
    let inserido = false;
    for (const s of segmentos) {
      const a = posicao;
      const b = posicao + s.texto.length;
      posicao = b;

      if (b <= inicio || a >= fim) {
        novos.push(s);
        continue;
      }
      if (a < inicio) novos.push({ ...s, texto: s.texto.slice(0, inicio - a), editado: true });
      if (!inserido) {
        novos.push({ rPr: formatacao, texto: escaparXml(valores[chave] ?? ''), run: s.run, editado: true });
        inserido = true;
      }
      if (b > fim) novos.push({ ...s, texto: s.texto.slice(fim - a), editado: true });
    }
    segmentos = novos;
  }

  if (!segmentos.some((s) => s.editado)) return paragrafo;

  // Runs nao tocados mantem o XML original; os demais sao reescritos.
  const porRun = new Map<number, number>();
  for (const s of segmentos) porRun.set(s.run, (porRun.get(s.run) ?? 0) + 1);

  const corpo = segmentos
    .map((s) => {
      const original = runs[s.run];
      if (original && !s.editado && porRun.get(s.run) === 1 && s.texto === original.texto) {
        return original.xml;
      }
      if (s.texto === '') return '';
      return `<w:r>${s.rPr}<w:t xml:space="preserve">${s.texto}</w:t></w:r>`;
    })
    .join('');

  const primeiro = runs[0]!;
  const ultimo = runs[runs.length - 1]!;
  const entreRuns = paragrafo.slice(primeiro.inicio, ultimo.inicio + ultimo.xml.length);

  // Elementos entre runs (marcadores de revisao, bookmarks) sao preservados
  // no fim da faixa reescrita, para nao perder nada do documento.
  const extras = entreRuns.replace(RUN, '');

  return (
    paragrafo.slice(0, primeiro.inicio) +
    corpo +
    extras +
    paragrafo.slice(ultimo.inicio + ultimo.xml.length)
  );
}

export interface ResultadoContrato {
  arquivo: Buffer;
  camposPreenchidos: string[];
}

export class ContratoService {
  constructor(private readonly caminhoModelo: string) {}

  /** Campos que o modelo espera, na ordem em que aparecem. */
  async listarCampos(): Promise<string[]> {
    const zip = await JSZip.loadAsync(await fs.readFile(this.caminhoModelo));
    const campos: string[] = [];
    for (const nome of Object.keys(zip.files).filter((n) => /^word\/(document|header\d*|footer\d*)\.xml$/.test(n))) {
      const xml = await zip.file(nome)!.async('string');
      for (const p of xml.match(PARAGRAFO) ?? []) {
        const texto = lerRuns(p).map((r) => r.texto).join('');
        for (const m of texto.matchAll(MARCADOR)) {
          const chave = chaveDoCampo(m[1] ?? '');
          if (!campos.includes(chave)) campos.push(chave);
        }
      }
    }
    return campos;
  }

  /**
   * Gera o contrato preenchido. Falha - e o contrato nao e gerado - se:
   *  - algum campo do modelo nao tiver valor;
   *  - algum valor obrigatorio vier vazio;
   *  - sobrar qualquer marcador ${"..."} no documento final.
   */
  async preencher(
    valores: Record<string, string>,
    opcionais: string[] = [],
  ): Promise<ResultadoContrato> {
    const vazios = Object.entries(valores)
      .filter(([chave, valor]) => !opcionais.includes(chave) && !valor?.trim())
      .map(([chave]) => chave);
    if (vazios.length) {
      throw new Error(`Contrato nao gerado: campos obrigatorios vazios (${vazios.join(', ')}).`);
    }

    const zip = await JSZip.loadAsync(await fs.readFile(this.caminhoModelo));
    const usados = new Set<string>();
    const desconhecidos = new Set<string>();

    const partes = Object.keys(zip.files).filter((n) =>
      /^word\/(document|header\d*|footer\d*)\.xml$/.test(n),
    );

    for (const nome of partes) {
      const xml = await zip.file(nome)!.async('string');
      const novo = xml.replace(PARAGRAFO, (p) => preencherParagrafo(p, valores, usados, desconhecidos));

      // Conferencia final: nenhum marcador pode ter sobrado.
      const restantes = (xml === novo ? xml : novo).match(PARAGRAFO)?.flatMap((p) => {
        const texto = lerRuns(p).map((r) => r.texto).join('');
        return [...texto.matchAll(MARCADOR)].map((m) => m[1]);
      });
      if (restantes?.length) {
        throw new Error(
          `Contrato nao gerado: o modelo tem campos sem valor informado (${[...new Set(restantes)].join(', ')}).`,
        );
      }

      zip.file(nome, novo);
    }

    if (desconhecidos.size) {
      throw new Error(
        `Contrato nao gerado: o modelo tem campos sem valor informado (${[...desconhecidos].join(', ')}).`,
      );
    }

    const naoUsados = Object.keys(valores).filter((c) => !usados.has(c));
    if (naoUsados.length) {
      // Nao impede o contrato - so significa que o modelo mudou e deixou de
      // usar algum campo. Fica registrado para quem for manter.
      console.warn(`[contrato] Campos enviados que o modelo nao usa: ${naoUsados.join(', ')}`);
    }

    const arquivo = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    return { arquivo, camposPreenchidos: [...usados] };
  }
}

/** Caminho padrao do modelo, versionado junto com o codigo. */
export function caminhoModeloPadrao(): string {
  return path.join(process.cwd(), 'docs', 'modelos', 'termo-comodato-emprestimo.docx');
}

/**
 * Modelo da entrega definitiva: a "MINUTA - Comodato PF Padrao", sem prazo de
 * devolucao e sem motivo. Ver docs/modelos/README.md.
 */
export function caminhoModeloEntrega(): string {
  return path.join(process.cwd(), 'docs', 'modelos', 'termo-comodato-entrega.docx');
}
