import PDFDocument from 'pdfkit';
import type { Empresa } from '@prisma/client';
import type { EmprestimoCompleto } from '../repositories/EmprestimoRepository';
import { formatarData } from '../utils/datas';
import { descricaoDoItem } from '../utils/itens';
import { formatarCpf, formatarMoeda } from '../utils/documentos';
import { empresaService } from './EmpresaService';

/**
 * Comprovante de devolucao em PDF.
 *
 * O termo de comodato tinha, no fim, uma secao de devolucao para ser preenchida
 * a mao. No fluxo digital ela nao tem como ser usada - o documento assinado no
 * D4Sign fica lacrado - e saiu do modelo. Este comprovante a substitui: e
 * gerado quando a TI registra a devolucao, vai anexado ao e-mail do colaborador
 * e pode ser baixado de novo pela tela de Emprestimos.
 *
 * E o documento que o colaborador guarda para provar que devolveu o
 * equipamento. Nao passa pelo D4Sign, entao nao tem custo.
 */

const CONDICAO: Record<string, string> = {
  BOM: 'Em bom estado',
  AVARIADO: 'Com avarias - encaminhado para avaliação da TI',
};

function dataHora(data: Date): string {
  return data.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export class ComprovanteService {
  async gerarDevolucao(emprestimo: EmprestimoCompleto): Promise<Buffer> {
    if (emprestimo.status !== 'DEVOLVIDO' || !emprestimo.dataDevolucao) {
      throw new Error('Comprovante de devolucao so existe para emprestimo devolvido.');
    }

    // Emprestimos anteriores ao cadastro de empresas ficam com a do AD/padrao.
    const empresa: Empresa | null =
      emprestimo.empresa ?? (await empresaService.identificar(emprestimo.colaborador.empresaAD));

    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: 'Comprovante de devolução' } });
      const partes: Buffer[] = [];
      doc.on('data', (p: Buffer) => partes.push(p));
      doc.on('end', () => resolve(Buffer.concat(partes)));
      doc.on('error', reject);

      const largura = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const esquerda = doc.page.margins.left;
      const nb = emprestimo.item;
      const colaborador = emprestimo.colaborador;
      const devolvidoEm = emprestimo.dataDevolucao!;

      // --- Cabecalho: empresa ------------------------------------------------
      if (empresa) {
        doc.font('Helvetica-Bold').fontSize(11).text(empresa.razaoSocial, { align: 'center' });
        doc
          .font('Helvetica')
          .fontSize(8.5)
          .fillColor('#444444')
          .text(
            `CNPJ ${empresa.cnpj} · ${empresa.logradouro}, ${empresa.cidade}/${empresa.uf} · CEP ${empresa.cep}`,
            { align: 'center' },
          )
          .fillColor('#000000');
      }

      doc.moveDown(1.6);
      doc.font('Helvetica-Bold').fontSize(14).text('COMPROVANTE DE DEVOLUÇÃO DE EQUIPAMENTO', {
        align: 'center',
      });
      doc
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#666666')
        .text(`${emprestimo.modalidade === 'DEFINITIVA' ? 'Entrega' : 'Empréstimo'} nº ${emprestimo.id}`, {
          align: 'center',
        })
        .fillColor('#000000');

      // --- Declaracao ----------------------------------------------------------
      doc.moveDown(1.6);
      const cpf = colaborador.cpf ? `, inscrito(a) no CPF sob o nº ${formatarCpf(colaborador.cpf)},` : '';
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .text(
          `Declaramos que recebemos de ${colaborador.nome}${cpf} o(s) equipamento(s) relacionado(s) ` +
            `abaixo, cedido(s) em comodato em ${formatarData(emprestimo.dataInicio)}` +
            (emprestimo.dataPrevista
              ? `, com devolução prevista para ${formatarData(emprestimo.dataPrevista)}.`
              : ', sem prazo de devolução (entrega para uso no trabalho).'),
          { align: 'justify', lineGap: 2 },
        );

      // --- Tabela de itens -----------------------------------------------------
      doc.moveDown(1.2);
      const colunas = [
        { titulo: 'Item', largura: largura * 0.42 },
        { titulo: 'Marca', largura: largura * 0.16 },
        { titulo: 'Patrimônio', largura: largura * 0.22 },
        { titulo: 'Valor', largura: largura * 0.2 },
      ];
      const linhas: string[][] = [
        [descricaoDoItem(nb), nb.marca || '-', nb.patrimonio || '-', nb.valor ? formatarMoeda(nb.valor) : '-'],
      ];
      if (emprestimo.acessorios?.trim()) linhas.push([emprestimo.acessorios.trim(), '-', '-', '-']);

      const desenharLinha = (valores: string[], negrito: boolean) => {
        const y = doc.y;
        let x = esquerda;
        const alturas = valores.map((v, i) =>
          doc.font(negrito ? 'Helvetica-Bold' : 'Helvetica').fontSize(9.5).heightOfString(v, {
            width: (colunas[i]?.largura ?? 0) - 10,
          }),
        );
        const altura = Math.max(...alturas) + 10;
        valores.forEach((v, i) => {
          const w = colunas[i]?.largura ?? 0;
          if (negrito) doc.rect(x, y, w, altura).fillAndStroke('#f1f5f9', '#94a3b8').fillColor('#000000');
          else doc.rect(x, y, w, altura).stroke('#94a3b8');
          doc
            .font(negrito ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(9.5)
            .text(v, x + 5, y + 5, { width: w - 10 });
          x += w;
        });
        doc.x = esquerda;
        doc.y = y + altura;
      };

      desenharLinha(colunas.map((c) => c.titulo), true);
      for (const l of linhas) desenharLinha(l, false);

      // --- Dados da devolucao --------------------------------------------------
      doc.moveDown(1.4);
      const campo = (rotulo: string, valor: string) => {
        doc.font('Helvetica-Bold').fontSize(10.5).text(`${rotulo}: `, { continued: true });
        doc.font('Helvetica').text(valor, { lineGap: 2 });
      };

      campo('Data da devolução', dataHora(devolvidoEm));
      campo(
        'Condição do equipamento',
        CONDICAO[emprestimo.condicaoDevolucao ?? ''] ?? (emprestimo.condicaoDevolucao || 'Não informada'),
      );
      // So a observacao da devolucao. As observacoes do emprestimo sao internas.
      if (emprestimo.observacoesDevolucao?.trim()) {
        campo('Observações', emprestimo.observacoesDevolucao.trim());
      }
      campo(
        'Recebido por',
        emprestimo.devolucaoRecebidaPorNome
          ? `${emprestimo.devolucaoRecebidaPorNome}${
              emprestimo.devolucaoRecebidaPorEmail ? ` (${emprestimo.devolucaoRecebidaPorEmail})` : ''
            } - Equipe de TI`
          : 'Equipe de TI',
      );

      doc.moveDown(1.4);
      doc
        .font('Helvetica')
        .fontSize(10.5)
        .text(
          'Este comprovante registra a devolução do(s) equipamento(s) acima e o encerramento ' +
            (emprestimo.modalidade === 'DEFINITIVA'
              ? `da entrega nº ${emprestimo.id}.`
              : `do empréstimo nº ${emprestimo.id}.`),
          { align: 'justify', lineGap: 2 },
        );

      // --- Rodape -------------------------------------------------------------
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor('#666666')
        .text(
          `Documento emitido eletronicamente pelo Notrole em ${dataHora(new Date())}. ` +
            'Guarde este comprovante.',
          esquerda,
          doc.page.height - doc.page.margins.bottom - 20,
          { width: largura, align: 'center', lineBreak: false },
        );

      doc.end();
    });
  }
}

export const comprovanteService = new ComprovanteService();
