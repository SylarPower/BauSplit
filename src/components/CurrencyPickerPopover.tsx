import { Check, ChevronDown, RotateCcw, Search, X } from 'lucide-react';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { CURRENCIES, getCurrencyInfo } from '../lib/currencies';

interface CurrencyPickerPopoverProps {
  value: string;
  baseCurrency: string;
  onChange: (currency: string) => void;
  variant: 'badge' | 'field';
  suggestedCurrencies?: string[];
  heading: string;
  footerNote?: ReactNode;
  ariaLabel: string;
  showResetButton?: boolean;
  disabled?: boolean;
}

interface PopoverPlacement {
  left: number;
  top?: number;
  bottom?: number;
  width: number;
  listMaxHeight: number;
}

const DEFAULT_POPULAR_CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'JPY', 'CAD'];

export function CurrencyPickerPopover({
  value,
  baseCurrency,
  onChange,
  variant,
  suggestedCurrencies,
  heading,
  footerNote,
  ariaLabel,
  showResetButton = false,
  disabled = false,
}: CurrencyPickerPopoverProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [placement, setPlacement] = useState<PopoverPlacement>({
    left: 12,
    top: 48,
    width: 296,
    listMaxHeight: 190,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isConverted = value !== baseCurrency;
  const info = getCurrencyInfo(value);

  const quickCodes = useMemo(() => {
    const pool = [
      baseCurrency,
      ...(suggestedCurrencies ?? []),
      ...DEFAULT_POPULAR_CURRENCIES,
    ];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of pool) {
      const code = raw.toUpperCase();
      if (!seen.has(code)) {
        seen.add(code);
        out.push(code);
        if (out.length === 6) break;
      }
    }
    return out;
  }, [baseCurrency, suggestedCurrencies]);

  const filteredCurrencies = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter(
      (c) =>
        c.code.toLowerCase().includes(q) ||
        c.name.toLowerCase().includes(q) ||
        c.symbol.toLowerCase().includes(q)
    );
  }, [query]);

  const updatePlacement = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const vw = window.innerWidth || 1024;
    const vh = window.innerHeight || 768;
    const width = Math.min(300, Math.max(240, vw - 24));
    const rawLeft = variant === 'field' ? rect.right - width : rect.left;
    const left = Math.max(12, Math.min(rawLeft, vw - width - 12));

    const spaceBelow = vh - rect.bottom - 12;
    const spaceAbove = rect.top - 12;
    const openAbove = spaceBelow < 260 && spaceAbove > spaceBelow;
    const availableHeight = openAbove ? spaceAbove : spaceBelow;
    const listMaxHeight = Math.max(120, Math.min(200, availableHeight - 175));

    if (openAbove) {
      setPlacement({
        left,
        bottom: vh - rect.top + 6,
        width,
        listMaxHeight,
      });
    } else {
      setPlacement({
        left,
        top: rect.bottom + 6,
        width,
        listMaxHeight,
      });
    }
  }, [variant]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePlacement();
  }, [open, updatePlacement]);

  useEffect(() => {
    if (!open) return;
    setQuery('');

    let rafId = 0;
    const isCoarsePointer =
      typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
    if (!isCoarsePointer) {
      // Lascia il cursore pronto per filtrare al volo su desktop senza forzare tastiere su touch.
      rafId = requestAnimationFrame(() => {
        searchInputRef.current?.focus({ preventScroll: true });
      });
    }

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    const onScrollOrResize = () => updatePlacement();

    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('scroll', onScrollOrResize, true);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, updatePlacement]);

  const pickCurrency = (code: string) => {
    onChange(code);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const popoverNode =
    open && !disabled && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={popoverRef}
            className="currency-popover-panel"
            style={{
              left: placement.left,
              top: placement.top,
              bottom: placement.bottom,
              width: placement.width,
            }}
            role="region"
            aria-label={heading}
          >
            <div className="currency-popover-head">
              <strong className="currency-popover-title">{heading}</strong>
              {isConverted && (
                <button
                  type="button"
                  className="link-btn currency-popover-reset"
                  onClick={() => pickCurrency(baseCurrency)}
                >
                  <RotateCcw size={11} aria-hidden="true" />
                  Torna a {baseCurrency}
                </button>
              )}
            </div>

            {query.trim() === '' && (
              <div className="currency-popover-grid">
                {quickCodes.map((code) => {
                  const item = getCurrencyInfo(code);
                  return (
                    <button
                      key={code}
                      type="button"
                      className={`currency-popover-quick ${value === code ? 'active' : ''}`}
                      onClick={() => pickCurrency(code)}
                    >
                      <span>{code}</span>
                      <span className="currency-popover-quick-sym">{item.symbol}</span>
                    </button>
                  );
                })}
              </div>
            )}

            <div className="currency-popover-search-wrap">
              <Search size={13} className="currency-popover-search-icon" aria-hidden="true" />
              <input
                ref={searchInputRef}
                type="text"
                className="input input-sm currency-popover-search"
                placeholder="Cerca valuta (es. CHF, Yen…)"
                aria-label="Cerca valuta"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    e.stopPropagation();
                    if (query.trim() && filteredCurrencies.length > 0) {
                      pickCurrency(filteredCurrencies[0].code);
                    }
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  className="currency-popover-search-clear"
                  aria-label="Svuota ricerca valuta"
                  onClick={() => {
                    setQuery('');
                    searchInputRef.current?.focus();
                  }}
                >
                  <X size={12} aria-hidden="true" />
                </button>
              )}
            </div>

            <div
              className="currency-popover-list"
              style={{ maxHeight: placement.listMaxHeight }}
              role="listbox"
              aria-label={heading}
            >
              {filteredCurrencies.length === 0 ? (
                <div className="currency-popover-empty">
                  Nessuna valuta trovata per &ldquo;{query.trim()}&rdquo;
                </div>
              ) : (
                filteredCurrencies.map((c) => {
                  const selected = value === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`currency-popover-row ${selected ? 'active' : ''}`}
                      onClick={() => pickCurrency(c.code)}
                    >
                      <span className="currency-popover-row-label">
                        <strong>{c.code}</strong> · {c.name}
                        {c.code === baseCurrency && (
                          <span className="currency-popover-base-tag">Base</span>
                        )}
                      </span>
                      <span className="currency-popover-row-right">
                        <span className="text-muted">{c.symbol}</span>
                        {selected && <Check size={13} aria-hidden="true" />}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {footerNote && <div className="currency-popover-footer field-hint tabular">{footerNote}</div>}
          </div>,
          document.body
        )
      : null;

  if (variant === 'badge') {
    return (
      <span className="currency-badge-wrap">
        <button
          ref={triggerRef}
          type="button"
          className={`currency-badge-btn ${isConverted ? 'is-converted' : ''}`}
          aria-label={ariaLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          title={
            isConverted
              ? `Saldi mostrati in ${value} (contabilità in ${baseCurrency}). Clicca per cambiare.`
              : `Valuta del gruppo: ${baseCurrency}. Clicca per cambiare valuta di visualizzazione dei saldi.`
          }
          onClick={() => setOpen((v) => !v)}
        >
          <span>
            {isConverted ? `Vista ${value} · base ${baseCurrency}` : value}
          </span>
          <ChevronDown size={12} strokeWidth={2.2} aria-hidden="true" />
        </button>
        {showResetButton && isConverted && (
          <button
            type="button"
            className="currency-reset-x"
            title={`Torna a ${baseCurrency}`}
            aria-label={`Torna a ${baseCurrency}`}
            onClick={() => {
              onChange(baseCurrency);
              setOpen(false);
            }}
          >
            <X size={12} aria-hidden="true" />
          </button>
        )}
        {popoverNode}
      </span>
    );
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`currency-field-btn ${open ? 'is-open' : ''}`}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="currency-field-text">
          <strong>{info.code}</strong>{' '}
          <span className="currency-field-sym">({info.symbol})</span>
        </span>
        <ChevronDown size={15} className="currency-field-caret" aria-hidden="true" />
      </button>
      {popoverNode}
    </>
  );
}
