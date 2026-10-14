/**
 * CPF e valores monetarios, como aparecem no termo de comodato.
 *
 * O CPF e digitado na mesa da TI, na hora da retirada. Um digito trocado ali
 * vai parar num contrato assinado; por isso o digito verificador e conferido
 * antes de o termo ser gerado.
 */

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, '');
}

export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return false;
  // Sequencias repetidas (111.111.111-11) passam no calculo, mas nao existem.
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const digito = (base: string, pesoInicial: number) => {
    const soma = [...base].reduce((acc, n, i) => acc + Number(n) * (pesoInicial - i), 0);
    const resto = (soma * 10) % 11;
    return resto === 10 ? 0 : resto;
  };

  return (
    digito(cpf.slice(0, 9), 10) === Number(cpf[9]) && digito(cpf.slice(0, 10), 11) === Number(cpf[10])
  );
}

/** "12345678909" -> "123.456.789-09" */
export function formatarCpf(valor: string): string {
  const cpf = somenteDigitos(valor);
  return cpf.length === 11 ? cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4') : valor;
}

/** 4500 -> "R$ 4.500,00" */
export function formatarMoeda(valor: number | string | { toString(): string }): string {
  const numero = typeof valor === 'number' ? valor : Number(valor.toString());
  return numero.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

/** 21/09/2026 -> "21 de setembro de 2026" */
export function dataPorExtenso(data: Date): string {
  return data.toLocaleDateString('pt-BR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });
}
