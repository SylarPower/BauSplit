import { formatDecimalInput, parseDecimalInput } from './currencies';

/** Teniamo il testo digitato (anche incompleto) nel verso in cui è stato scritto. */
export interface RateQuote {
  text: string;
  inverse: boolean;
}

/** Per conti e salvataggio: sempre 1 unità della valuta originale in valuta base. */
export function canonicalRate(quote: RateQuote): number | null {
  const n = parseDecimalInput(quote.text);
  if (n === null || n <= 0) return null;
  const rate = quote.inverse ? 1 / n : n;
  // Stessa precisione delle colonne exchange_rate / fixed_exchange_rate: numeric(18,8).
  const stored = Number(rate.toFixed(8));
  return stored > 0 && stored < 1e10 ? stored : null;
}

export function directQuote(rate: number | null): RateQuote {
  return { text: rate === null ? '' : formatDecimalInput(rate, 8), inverse: false };
}

export function displayedQuote(quote: RateQuote, inverse: boolean): string {
  if (inverse === quote.inverse) return quote.text;
  const rate = canonicalRate(quote);
  return rate === null ? '' : formatDecimalInput(inverse ? 1 / rate : rate, 12);
}
