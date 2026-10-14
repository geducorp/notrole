import {
  Cable,
  Headphones,
  Keyboard,
  Laptop,
  MemoryStick,
  Monitor,
  Package,
  Plug,
  Printer,
  Smartphone,
  type LucideIcon,
} from 'lucide-react';

/**
 * Icone de cada categoria do estoque. O nome vem do campo "icone" da
 * categoria, que a TI escolhe no cadastro; sem correspondencia, usa uma caixa.
 */
const ICONES: Record<string, LucideIcon> = {
  laptop: Laptop,
  monitor: Monitor,
  smartphone: Smartphone,
  printer: Printer,
  'memory-stick': MemoryStick,
  keyboard: Keyboard,
  headphones: Headphones,
  cable: Cable,
  'plug-zap': Plug,
  package: Package,
};

export function iconeDaCategoria(nome?: string | null): LucideIcon {
  return (nome && ICONES[nome]) || Package;
}

/** Opcoes de icone no cadastro de categoria. */
export const ICONES_DISPONIVEIS = Object.keys(ICONES);
