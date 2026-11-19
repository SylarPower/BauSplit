import type { CategoryOption, Expense } from '../types';

type Description = { text: string; words: string[] };
type Example = { title: Description; category: string };

const STOP_WORDS = new Set(
  'con per tra fra che una uno gli dei del dal nel sul col alla alle allo agli della delle dello degli dalla dalle dallo dagli nella nelle nello negli sulla sulle sullo sugli all dall dell nell sull'.split(
    ' '
  )
);
// Da sole possono dare una corrispondenza esatta, ma «pagamento» in due titoli non li rende simili.
const GENERIC_WORDS = new Set([
  'spesa',
  'spese',
  'acquisto',
  'acquisti',
  'pagamento',
  'pagamenti',
  'biglietto',
  'biglietti',
]);

function describe(value: string): Description | null {
  const tokens =
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const meaningful = tokens.filter((w) => w.length >= 3 && /\p{L}/u.test(w) && !STOP_WORDS.has(w));
  if (!meaningful.length) return null;
  // Varianti semplici come treno/treni. Mai sottostringhe: «bar» non deve corrispondere a «barca».
  const words = meaningful
    .filter((w) => !GENERIC_WORDS.has(w))
    .map((w) => (w.length >= 5 ? w.replace(/i$/, 'o') : w));
  return { text: tokens.join(' '), words: [...new Set(words)] };
}

/** Preparato una volta per lo storico e il catalogo correnti; nessun dato viene persistito. */
export function buildCategoryHistory(
  groupId: string,
  expenses: readonly Pick<Expense, 'groupId' | 'description' | 'category'>[],
  catalog: readonly Pick<CategoryOption, 'key' | 'hidden'>[]
): Example[] {
  const visible = new Set(catalog.filter((c) => !c.hidden).map((c) => c.key));
  const history: Example[] = [];
  for (const expense of expenses) {
    if (expense.groupId !== groupId || !visible.has(expense.category)) continue;
    const title = describe(expense.description);
    if (title) history.push({ title, category: expense.category });
  }
  return history;
}

function matchStrength(a: Description, b: Description): number {
  if (a.text === b.text) return 4;
  const [short, long] = a.words.length <= b.words.length ? [a.words, b.words] : [b.words, a.words];
  if (!short.length) return 0;
  const shared = short.filter((w) => long.includes(w)).length;
  const sameHead = short[0] === long[0];
  if (shared === long.length) return 3; // stesse parole, anche in ordine diverso
  if (shared === short.length && (shared >= 2 || sameHead || long.length <= 3)) return 2;
  // «Treno Roma» / «Treno Milano» sì; «Cena Roma» / «Treno Roma» no.
  if (shared * 2 >= long.length && (shared >= 2 || sameHead)) return 1;
  return 0;
}

/** Votano solo gli esempi più simili. Un solo precedente basta, una parità non decide. */
export function suggestCategoryKey(
  description: string,
  history: readonly Example[]
): string | null {
  if (!history.length) return null;
  const query = describe(description);
  if (!query) return null;

  const votes = new Map<string, number>();
  let best = 0;
  let total = 0;
  for (const example of history) {
    const strength = matchStrength(query, example.title);
    if (!strength || strength < best) continue;
    if (strength > best) {
      votes.clear();
      total = 0;
      best = strength;
    }
    votes.set(example.category, (votes.get(example.category) ?? 0) + 1);
    total++;
  }
  for (const [key, count] of votes) {
    if (count * 3 >= total * 2) return key; // almeno due terzi dei precedenti migliori
  }
  return null;
}
