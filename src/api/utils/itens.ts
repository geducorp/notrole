/**
 * Como um equipamento e chamado nas telas, nos e-mails e nos documentos.
 *
 * Nem todo item tem hostname: notebooks tem, monitores e headsets nao. Antes
 * de o Notrole virar controle de estoque, `hostname` era obrigatorio e usado
 * como nome em todo lugar.
 *
 * Sem hostname, o nome e marca + modelo. O numero de serie nao entra no nome
 * (ja tem coluna propria; no nome, ficava "Pro I5 (c6xs9f4)").
 */
export function nomeDoItem(item: {
  hostname?: string | null;
  patrimonio?: string | null;
  marca?: string | null;
  modelo: string;
}): string {
  if (item.hostname) return item.hostname;
  return [item.marca, item.modelo].filter(Boolean).join(' ');
}

/** 1024 -> "1 TB"; 512 -> "512 GB". */
export function formatarGb(gb: number): string {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

/** "Intel i5 · 16 GB RAM · 512 GB": vazio quando nao ha especificacao. */
export function especificacoesDoItem(item: {
  processador?: string | null;
  memoriaGb?: number | null;
  armazenamentoGb?: number | null;
}): string {
  return [
    item.processador,
    item.memoriaGb ? `${formatarGb(item.memoriaGb)} RAM` : null,
    item.armazenamentoGb ? formatarGb(item.armazenamentoGb) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Notebook Dell Latitude 5440" - usado no termo e no comprovante. */
export function descricaoDoItem(item: {
  categoria?: { nome: string } | null;
  marca?: string | null;
  modelo: string;
}): string {
  return [item.categoria?.nome, item.marca, item.modelo].filter(Boolean).join(' ').trim();
}
