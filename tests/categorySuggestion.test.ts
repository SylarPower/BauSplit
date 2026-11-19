import { describe, expect, it } from 'vitest';
import { buildCategoryHistory, suggestCategoryKey } from '../src/lib/categorySuggestion';

const catalog = [
  { key: 'trasporti', hidden: false },
  { key: 'custom:gite', hidden: false },
  { key: 'vecchia', hidden: true },
];
const row = (description: string, category = 'trasporti', groupId = 'casa') => ({
  groupId,
  description,
  category,
});
const history = (...rows: ReturnType<typeof row>[]) => buildCategoryHistory('casa', rows, catalog);

describe('Categorie dalle descrizioni di questo gruppo', () => {
  it('basta un precedente: riconosce la parola intera con altri dettagli, punteggiatura o plurale', () => {
    const h = history(row('Treno'));
    for (const query of [
      ' TRENO! ',
      'Treno per Bologna',
      'Biglietto del treno per Bologna',
      'Treni',
    ]) {
      expect(suggestCategoryKey(query, h)).toBe('trasporti');
    }
    expect(suggestCategoryKey('caffe bar', history(row('Caffè al BAR')))).toBe('trasporti');
    expect(suggestCategoryKey('treno per Milano', history(row('Treno per Roma')))).toBe(
      'trasporti'
    );
    expect(
      suggestCategoryKey('Biglietto del teatro', history(row('Biglietto del treno')))
    ).toBeNull();
  });

  it('non impara da altri gruppi né da categorie nascoste o eliminate; usa le chiavi, non le etichette', () => {
    const h = history(
      row('Treno', 'trasporti', 'ufficio'),
      row('Treno', 'vecchia'),
      row('Treno', 'rimossa')
    );
    expect(suggestCategoryKey('Treno', h)).toBeNull();
    expect(suggestCategoryKey('Treno', history(row('Treno', 'custom:gite')))).toBe('custom:gite');
    expect(suggestCategoryKey('Trasporti', history())).toBeNull();
  });

  it('non usa frammenti, numeri, preposizioni o un dettaglio incidentale come il nome di una città', () => {
    const h = history(row('Bar'), row('Treno per Roma'), row('Pagamento del taxi 2026'));
    for (const query of [
      '',
      '   ',
      'Tr',
      'del',
      '2026!',
      'Barca',
      'Pagamento libri',
      'Cena a Roma',
    ]) {
      expect(suggestCategoryKey(query, h)).toBeNull();
    }
  });

  it('la corrispondenza esatta batte molte parziali, indipendentemente dall’ordine dello storico', () => {
    const rows = [
      row('Treno Roma'),
      row('Treno per Roma', 'custom:gite'),
      row('Treno', 'custom:gite'),
      row('Treno per Milano', 'custom:gite'),
    ];
    for (const order of [rows, [...rows].reverse()]) {
      expect(suggestCategoryKey('Treno Roma', history(...order))).toBe('trasporti');
    }
  });

  it('considera quante volte è stata usata la categoria fra i migliori precedenti; si astiene se il voto è incerto', () => {
    const a = row('Treno');
    const b = row('Treno', 'custom:gite');
    expect(suggestCategoryKey('Treno per Roma', history(a, b))).toBeNull();
    expect(suggestCategoryKey('Treno per Roma', history(a, b, a, b, a))).toBeNull();
    expect(suggestCategoryKey('Treno per Roma', history(b, a, a))).toBe('trasporti');
  });
});
