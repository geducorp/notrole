/**
 * Como um equipamento e chamado nas telas, nos e-mails e nos documentos.
 *
 * Nem todo item tem hostname: notebooks tem, monitores e headsets nao. Antes
 * de o Notrole virar controle de estoque, `hostname` era obrigatorio e usado
 * como nome em todo lugar.
 */
export function nomeDoItem(item: {
  hostname?: string | null;
  patrimonio?: string | null;
  marca?: string | null;
  modelo: string;
}): string {
  if (item.hostname) return item.hostname;
  if (item.patrimonio) return `${item.modelo} (${item.patrimonio})`;
  return [item.marca, item.modelo].filter(Boolean).join(' ');
}

/** "Notebook Dell Latitude 5440" - usado no termo e no comprovante. */
export function descricaoDoItem(item: {
  categoria?: { nome: string } | null;
  marca?: string | null;
  modelo: string;
}): string {
  return [item.categoria?.nome, item.marca, item.modelo].filter(Boolean).join(' ').trim();
}
