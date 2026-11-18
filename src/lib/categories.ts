import type { CategoryOption, CustomCategory } from '../types';

export interface PresetCategory {
  key: string;
  name: string;
  icon: string;
  color: string;
}

export const PRESET_CATEGORIES: PresetCategory[] = [
  { key: 'spesa', name: 'Spesa alimentare', icon: 'shopping-basket', color: '#0F766E' },
  { key: 'ristoranti', name: 'Ristoranti e bar', icon: 'utensils', color: '#C2410C' },
  { key: 'casa', name: 'Casa e affitto', icon: 'home', color: '#1D4ED8' },
  { key: 'bollette', name: 'Bollette e utenze', icon: 'zap', color: '#B45309' },
  { key: 'trasporti', name: 'Trasporti e auto', icon: 'car', color: '#4338CA' },
  { key: 'viaggi', name: 'Viaggi e alloggi', icon: 'plane', color: '#0369A1' },
  { key: 'svago', name: 'Svago e cultura', icon: 'sparkles', color: '#7E22CE' },
  { key: 'shopping', name: 'Shopping', icon: 'shopping-bag', color: '#BE185D' },
  { key: 'salute', name: 'Salute e benessere', icon: 'heart-pulse', color: '#047857' },
  { key: 'abbonamenti', name: 'Abbonamenti', icon: 'repeat', color: '#475569' },
  { key: 'regali', name: 'Regali', icon: 'gift', color: '#B91C1C' },
  { key: 'altro', name: 'Altro', icon: 'tag', color: '#78716C' },
];

export const CUSTOM_CATEGORY_ICONS: { id: string; label: string }[] = [
  { id: 'tag', label: 'Etichetta' },
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
];

export function buildCategoryOptions(customCategories: CustomCategory[]): CategoryOption[] {
  const presets: CategoryOption[] = PRESET_CATEGORIES.map((c) => ({
    key: c.key,
    name: c.name,
    icon: c.icon,
    color: c.color,
    isCustom: false,
  }));

  const customs: CategoryOption[] = customCategories.map((c) => ({
    key: `custom:${c.id}`,
    name: c.name,
    icon: c.icon || 'tag',
    color: c.color || '#0F766E',
    isCustom: true,
    customId: c.id,
  }));

  // Inserisce le categorie personalizzate prima di "Altro"
  const withoutAltro = presets.filter((p) => p.key !== 'altro');
  const altro = presets.find((p) => p.key === 'altro')!;
  return [...withoutAltro, ...customs, altro];
}

export function resolveCategoryDisplay(
  categoryKey: string,
  fallbackLabel: string,
  customCategories: CustomCategory[]
): CategoryOption {
  const preset = PRESET_CATEGORIES.find((c) => c.key === categoryKey);
  if (preset) {
    return {
      key: preset.key,
      name: preset.name,
      icon: preset.icon,
      color: preset.color,
      isCustom: false,
    };
  }

  if (categoryKey.startsWith('custom:')) {
    const id = categoryKey.slice('custom:'.length);
    const custom = customCategories.find((c) => c.id === id);
    if (custom) {
      return {
        key: categoryKey,
        name: custom.name,
        icon: custom.icon || 'tag',
        color: custom.color || '#0F766E',
        isCustom: true,
        customId: custom.id,
      };
    }
  }

  return {
    key: categoryKey || 'altro',
    name: fallbackLabel || 'Altro',
    icon: 'tag',
    color: '#78716C',
    isCustom: false,
  };
}
