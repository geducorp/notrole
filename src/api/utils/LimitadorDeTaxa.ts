/**
 * Controle de quantas chamadas podem ser feitas a um servico externo por hora.
 *
 * Existe por causa do D4Sign: a conta vem com um teto de requisicoes por hora e
 * cada termo de responsabilidade consome tres chamadas. Emprestar cinco
 * notebooks de uma vez dispara quinze requisicoes em sequencia e estoura o
 * limite - as ultimas voltam com erro e, antes desta mudanca, o termo
 * simplesmente se perdia sem ninguem ficar sabendo.
 *
 * A janela e deslizante: guardamos o instante de cada chamada e descartamos as
 * que ja passaram de uma hora.
 */
export class LimitadorDeTaxa {
  private chamadas: number[] = [];

  constructor(
    private readonly limitePorJanela: number,
    private readonly janelaMs: number = 60 * 60 * 1000,
  ) {}

  private limpar(agora: number): void {
    const corte = agora - this.janelaMs;
    this.chamadas = this.chamadas.filter((t) => t > corte);
  }

  /** Quantas chamadas ainda cabem na janela atual. */
  disponivel(): number {
    this.limpar(Date.now());
    return Math.max(0, this.limitePorJanela - this.chamadas.length);
  }

  /**
   * Reserva uma cota. Devolve false se nao houver - cabe a quem chamou decidir
   * se tenta de novo mais tarde.
   */
  reservar(quantidade = 1): boolean {
    const agora = Date.now();
    this.limpar(agora);

    if (this.chamadas.length + quantidade > this.limitePorJanela) return false;

    for (let i = 0; i < quantidade; i += 1) this.chamadas.push(agora);
    return true;
  }

  /** Registra uma chamada que ja aconteceu, mesmo sem reserva previa. */
  registrar(): void {
    this.chamadas.push(Date.now());
  }

  /**
   * Em quanto tempo (ms) uma nova cota fica livre. Zero se ja houver.
   *
   * Serve para dizer ao operador quando o termo dele deve sair, em vez de
   * deixa-lo no escuro.
   */
  esperaAteLiberar(quantidade = 1): number {
    const agora = Date.now();
    this.limpar(agora);

    const faltam = this.chamadas.length + quantidade - this.limitePorJanela;
    if (faltam <= 0) return 0;

    // A cota volta quando a n-esima chamada mais antiga sair da janela.
    const indice = Math.min(faltam - 1, this.chamadas.length - 1);
    const maisAntiga = this.chamadas[indice];
    if (maisAntiga === undefined) return this.janelaMs;

    return Math.max(0, maisAntiga + this.janelaMs - agora);
  }

  /**
   * Como esperaAteLiberar, mas para uma quantidade que pode passar de uma
   * janela: e a previsao do terceiro termo da fila, que so sai depois dos dois
   * da frente. Aproximada (supoe a cota toda para a fila), serve para mostrar
   * ao operador "sai por volta das HH:MM".
   */
  esperaParaAcumulado(quantidade: number): number {
    if (quantidade <= this.limitePorJanela) return this.esperaAteLiberar(quantidade);
    const janelasInteiras = Math.floor((quantidade - 1) / this.limitePorJanela);
    const resto = quantidade - janelasInteiras * this.limitePorJanela;
    return this.esperaAteLiberar(resto) + janelasInteiras * this.janelaMs;
  }

  /** Devolve uma cota reservada que acabou nao sendo usada. */
  devolver(quantidade = 1): void {
    for (let i = 0; i < quantidade; i += 1) this.chamadas.pop();
  }
}
