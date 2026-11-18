import { useCallback, useEffect, useState } from 'react';
import { fetchExchangeRate, type ExchangeRateResult } from './currencies';
import { canonicalRate, directQuote, type RateQuote } from './rateQuote';

interface SavedRate {
  exchangeRate: number;
  rateDate: string;
  rateIsManual: boolean;
}
interface Override {
  quote: RateQuote;
  date: string;
  manual: boolean;
  source: 'saved' | 'manual';
}

/** Il verso di scrittura appartiene al campo. Non cambia origine, data o valore del cambio. */
export function useExchangeRate(active: boolean, from: string, to: string, date: string) {
  const [override, setOverride] = useState<Override | null>(null);
  const [revision, setRevision] = useState(0);
  const [auto, setAuto] = useState<{ key: string; result: ExchangeRateResult } | null>(null);
  const key = `${from}:${to}:${date}:${revision}`;
  const needsAuto = active && from !== to && override === null;

  useEffect(() => {
    if (!needsAuto) return;
    let current = true;
    fetchExchangeRate(from, to, date).then((result) => {
      if (current) setAuto({ key, result });
    });
    return () => {
      current = false;
    };
  }, [needsAuto, key, from, to, date]);

  const reset = useCallback((saved?: SavedRate | null) => {
    setOverride(
      saved
        ? {
            quote: directQuote(saved.exchangeRate),
            date: saved.rateDate,
            manual: saved.rateIsManual,
            source: 'saved',
          }
        : null
    );
    setRevision((n) => n + 1);
  }, []);

  const match = auto?.key === key ? auto.result : null;
  const quote =
    from === to ? directQuote(1) : (override?.quote ?? directQuote(match?.rate ?? null));
  return {
    quote,
    rate: canonicalRate(quote) ?? 0,
    rateDate: from === to ? date : (override?.date ?? match?.effectiveDate ?? date),
    manual: from !== to && !!override?.manual,
    source: override?.source ?? match?.source,
    loading: needsAuto && !match,
    write: (quote: RateQuote) => setOverride({ quote, date, manual: true, source: 'manual' }),
    reset,
  };
}
