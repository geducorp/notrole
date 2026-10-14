/**
 * Erro de negocio com status HTTP. Tudo que nao for AppError e tratado como
 * falha inesperada pelo errorHandler e nao vaza detalhes para o cliente.
 */
export class AppError extends Error {
  constructor(
    public readonly mensagem: string,
    public readonly status: number = 400,
    public readonly codigo?: string,
  ) {
    super(mensagem);
    this.name = 'AppError';
  }

  static naoEncontrado(recurso: string) {
    return new AppError(`${recurso} nao encontrado.`, 404, 'NAO_ENCONTRADO');
  }

  static conflito(mensagem: string) {
    return new AppError(mensagem, 409, 'CONFLITO');
  }

  static naoAutorizado(mensagem = 'Acesso negado.') {
    return new AppError(mensagem, 403, 'NAO_AUTORIZADO');
  }
}
