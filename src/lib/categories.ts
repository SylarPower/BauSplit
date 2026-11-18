import type { CategoryOption } from '../types';

export const CUSTOM_CATEGORY_ICONS: { id: string; label: string }[] = [
  { id: 'tag', label: 'Etichetta' },
  { id: 'shopping-basket', label: 'Cestino' },
  { id: 'utensils', label: 'Posate' },
  { id: 'home', label: 'Casa' },
  { id: 'zap', label: 'Energia' },
  { id: 'car', label: 'Auto' },
  { id: 'plane', label: 'Aereo' },
  { id: 'sparkles', label: 'Scintille' },
  { id: 'shopping-bag', label: 'Acquisti' },
  { id: 'heart-pulse', label: 'Salute' },
  { id: 'repeat', label: 'Rinnovo' },
  { id: 'gift', label: 'Regalo' },
  { id: 'paw-print', label: 'Animali' },
  { id: 'coffee', label: 'Caffè' },
  { id: 'dumbbell', label: 'Sport' },
  { id: 'book-open', label: 'Libri e studio' },
  { id: 'wifi', label: 'Internet e tech' },
  { id: 'music', label: 'Concerti e musica' },
  { id: 'baby', label: 'Famiglia' },
  { id: 'wrench', label: 'Manutenzione' },
  { id: 'briefcase', label: 'Lavoro' },
  { id: 'shirt', label: 'Abbigliamento' },
  { id: 'film', label: 'Cinema e serie' },
];

export const CUSTOM_CATEGORY_COLORS: string[] = [
  '#0F766E',
  '#0369A1',
  '#1D4ED8',
  '#4338CA',
  '#7E22CE',
  '#BE185D',
  '#C2410C',
  '#B45309',
  '#047857',
  '#475569',
  '#B91C1C',
  '#78716C',
];

type Classified = { category: string; categoryLabel: string };

export function resolveCategoryDisplay(
  key: string,
  savedLabel: string,
  catalog: CategoryOption[]
): CategoryOption {
  return (
    catalog.find((c) => c.key === key) ?? {
      key,
      name: savedLabel || 'Altro',
      icon: 'tag',
      color: '#78716C',
      hidden: true,
    }
  );
}

/** Applica il nome corrente in lettura, senza modificare movimenti, cambi o eventi storici. */
export function withCurrentCategoryLabels<T extends Classified>(
  rows: T[],
  catalog: CategoryOption[]
): T[] {
  const names = new Map(catalog.map((c) => [c.key, c.name]));
  return rows.map((row) => ({
    ...row,
    categoryLabel: names.get(row.category) ?? row.categoryLabel,
  }));
}

/** Una categoria nascosta (o eliminata da una vecchia versione) resta modificabile sul suo movimento. */
export function entryCategories(catalog: CategoryOption[], editing: Classified | null) {
  const options = catalog.filter((c) => !c.hidden || c.key === editing?.category);
  if (editing && !options.some((c) => c.key === editing.category)) {
    options.push(resolveCategoryDisplay(editing.category, editing.categoryLabel, catalog));
  }
  return options;
}

export function filterCategories(catalog: CategoryOption[], expenses: Classified[]) {
  const options = new Map(catalog.map((c) => [c.key, c]));
  for (const e of expenses) {
    if (!options.has(e.category))
      options.set(e.category, resolveCategoryDisplay(e.category, e.categoryLabel, []));
  }
  return [...options.values()];
}
