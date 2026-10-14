import { prisma } from '../config/prisma';

/**
 * Ajustes que mudam pela tela, sem editar o .env nem reiniciar o servidor.
 *
 * O primeiro e a pausa do D4Sign: se a integracao comecar a se comportar mal
 * (documento duplicado, cobranca inesperada), o administrador desliga na hora.
 * Pausado, o Notrole nao faz nenhuma chamada ao D4Sign; os termos novos ficam
 * na fila e saem quando a integracao for religada.
 *
 * O valor fica em memoria para ser lido sem ir ao banco (o D4SignService
 * pergunta a cada chamada). O servidor roda num processo so, entao a memoria
 * e o banco nao se desencontram.
 */

const CHAVE_D4SIGN_PAUSADO = 'd4sign.pausado';

export interface PausaD4Sign {
  pausado: boolean;
  alteradoPor: string | null;
  alteradoEm: Date | null;
}

export class ConfiguracaoService {
  private d4sign: PausaD4Sign = { pausado: false, alteradoPor: null, alteradoEm: null };

  /** Le os ajustes do banco. Chamado uma vez, na subida do servidor. */
  async carregar(): Promise<void> {
    const registro = await prisma.configuracao.findUnique({ where: { chave: CHAVE_D4SIGN_PAUSADO } });
    if (registro) {
      this.d4sign = {
        pausado: registro.valor === 'true',
        alteradoPor: registro.updatedBy,
        alteradoEm: registro.updatedAt,
      };
    }
    if (this.d4sign.pausado) {
      console.warn(`[config] D4Sign PAUSADO desde ${this.d4sign.alteradoEm?.toISOString()} por ${this.d4sign.alteradoPor}.`);
    }
  }

  get d4signPausado(): boolean {
    return this.d4sign.pausado;
  }

  get pausaDoD4sign(): PausaD4Sign {
    return { ...this.d4sign };
  }

  async pausarD4sign(pausado: boolean, usuario?: string): Promise<PausaD4Sign> {
    const registro = await prisma.configuracao.upsert({
      where: { chave: CHAVE_D4SIGN_PAUSADO },
      create: { chave: CHAVE_D4SIGN_PAUSADO, valor: String(pausado), updatedBy: usuario ?? null },
      update: { valor: String(pausado), updatedBy: usuario ?? null },
    });

    this.d4sign = { pausado, alteradoPor: registro.updatedBy, alteradoEm: registro.updatedAt };
    console.warn(`[config] D4Sign ${pausado ? 'PAUSADO' : 'religado'} por ${usuario ?? 'desconhecido'}.`);
    return this.pausaDoD4sign;
  }
}

export const configuracaoService = new ConfiguracaoService();
