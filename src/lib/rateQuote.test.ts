import { describe, expect, it } from 'vitest';
import { canonicalRate, directQuote, displayedQuote } from './rateQuote';

describe('Verso del cambio', () => {
  it('interpreta entrambe le scritture e conserva il testo digitato quando si torna indietro', () => {
    const jpyPerEur = { text: '160,00', inverse: true };
    expect(canonicalRate(jpyPerEur)).toBe(0.00625);
    expect(displayedQuote(jpyPerEur, false)).toBe('0,00625');
    expect(displayedQuote(jpyPerEur, true)).toBe('160,00');
    expect(canonicalRate({ text: '0.00625', inverse: false })).toBe(0.00625);
    expect(displayedQuote(directQuote(0.00625), true)).toBe('160');
    expect(canonicalRate({ text: '3', inverse: true })).toBe(0.33333333);
  });

  it('non trasforma vuoto, zero, testo o valori fuori dalla precisione di archivio in un cambio implicito', () => {
    for (const value of ['', ' ', '0', '-1', 'abc', 'NaN', 'Infinity']) {
      for (const inverse of [false, true])
        expect(canonicalRate({ text: value, inverse })).toBeNull();
    }
    expect(canonicalRate({ text: '1000000000', inverse: true })).toBeNull();
    expect(canonicalRate({ text: '10000000000', inverse: false })).toBeNull();
    expect(displayedQuote(directQuote(null), true)).toBe('');
    expect(canonicalRate(directQuote(0.00000001))).toBe(1e-8);
  });
});
