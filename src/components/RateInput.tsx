import { ArrowLeftRight } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { canonicalRate, displayedQuote, type RateQuote } from '../lib/rateQuote';

export function RateInput({
  from,
  to,
  quote,
  onChange,
  children,
}: {
  from: string;
  to: string;
  quote: RateQuote;
  onChange: (quote: RateQuote) => void;
  children?: ReactNode;
}) {
  const [inverse, setInverse] = useState(false);
  const invalid = !!quote.text.trim() && canonicalRate(quote) === null;
  const [unit, counter] = inverse ? [to, from] : [from, to];
  return (
    <div className="rate-input">
      <label className="rate-equation tabular">
        <span>1 {unit} =</span>
        <input
          type="text"
          inputMode="decimal"
          className="input input-sm tabular"
          aria-invalid={invalid}
          aria-label={`Tasso di cambio: 1 ${unit} in ${counter}`}
          value={displayedQuote(quote, inverse)}
          onChange={(e) => onChange({ text: e.target.value, inverse })}
        />
        <span>{counter}</span>
      </label>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        aria-pressed={inverse}
        disabled={invalid}
        title={invalid ? 'Completa o cancella il tasso per poterlo invertire' : undefined}
        onClick={() => setInverse((v) => !v)}
      >
        <ArrowLeftRight size={14} /> Inverti cambio
      </button>
      {children}
    </div>
  );
}
