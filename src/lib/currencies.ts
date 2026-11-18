import { todayISO } from './dates';

export interface CurrencyInfo {
  code: string;
  name: string;
  symbol: string;
  decimals: 0 | 2;
  ecbSupported: boolean;
  /** Tasso indicativo di emergenza: quante unità di questa valuta per 1 EUR (usato solo offline o se valuta non BCE) */
  fallbackPerEur: number;
}

export const CURRENCIES: CurrencyInfo[] = [
  { code: 'EUR', name: 'Euro', symbol: '€', decimals: 2, ecbSupported: true, fallbackPerEur: 1 },
  { code: 'USD', name: 'Dollaro USA', symbol: '$', decimals: 2, ecbSupported: true, fallbackPerEur: 1.08 },
  { code: 'GBP', name: 'Sterlina britannica', symbol: '£', decimals: 2, ecbSupported: true, fallbackPerEur: 0.85 },
  { code: 'CHF', name: 'Franco svizzero', symbol: 'CHF', decimals: 2, ecbSupported: true, fallbackPerEur: 0.94 },
  { code: 'JPY', name: 'Yen giapponese', symbol: '¥', decimals: 0, ecbSupported: true, fallbackPerEur: 164 },
  { code: 'CAD', name: 'Dollaro canadese', symbol: 'CA$', decimals: 2, ecbSupported: true, fallbackPerEur: 1.5 },
  { code: 'AUD', name: 'Dollaro australiano', symbol: 'A$', decimals: 2, ecbSupported: true, fallbackPerEur: 1.66 },
  { code: 'DKK', name: 'Corona danese', symbol: 'kr', decimals: 2, ecbSupported: true, fallbackPerEur: 7.46 },
  { code: 'SEK', name: 'Corona svedese', symbol: 'kr', decimals: 2, ecbSupported: true, fallbackPerEur: 11.4 },
  { code: 'NOK', name: 'Corona norvegese', symbol: 'kr', decimals: 2, ecbSupported: true, fallbackPerEur: 11.7 },
  { code: 'PLN', name: 'Zloty polacco', symbol: 'zł', decimals: 2, ecbSupported: true, fallbackPerEur: 4.3 },
  { code: 'CZK', name: 'Corona ceca', symbol: 'Kč', decimals: 2, ecbSupported: true, fallbackPerEur: 25.2 },
  { code: 'HUF', name: 'Fiorino ungherese', symbol: 'Ft', decimals: 2, ecbSupported: true, fallbackPerEur: 405 },
  { code: 'RON', name: 'Leu rumeno', symbol: 'lei', decimals: 2, ecbSupported: true, fallbackPerEur: 4.97 },
  { code: 'ISK', name: 'Corona islandese', symbol: 'kr', decimals: 0, ecbSupported: true, fallbackPerEur: 149 },
  { code: 'TRY', name: 'Lira turca', symbol: '₺', decimals: 2, ecbSupported: true, fallbackPerEur: 38.5 },
  { code: 'THB', name: 'Baht thailandese', symbol: '฿', decimals: 2, ecbSupported: true, fallbackPerEur: 37.2 },
  { code: 'SGD', name: 'Dollaro di Singapore', symbol: 'S$', decimals: 2, ecbSupported: true, fallbackPerEur: 1.45 },
  { code: 'HKD', name: 'Dollaro di Hong Kong', symbol: 'HK$', decimals: 2, ecbSupported: true, fallbackPerEur: 8.4 },
  { code: 'CNY', name: 'Yuan cinese', symbol: '¥', decimals: 2, ecbSupported: true, fallbackPerEur: 7.82 },
  { code: 'KRW', name: 'Won sudcoreano', symbol: '₩', decimals: 0, ecbSupported: true, fallbackPerEur: 1500 },
  { code: 'MXN', name: 'Peso messicano', symbol: 'MX$', decimals: 2, ecbSupported: true, fallbackPerEur: 21.6 },
  { code: 'BRL', name: 'Real brasiliano', symbol: 'R$', decimals: 2, ecbSupported: true, fallbackPerEur: 6.2 },
  { code: 'NZD', name: 'Dollaro neozelandese', symbol: 'NZ$', decimals: 2, ecbSupported: true, fallbackPerEur: 1.82 },
  { code: 'MAD', name: 'Dirham marocchino', symbol: 'MAD', decimals: 2, ecbSupported: false, fallbackPerEur: 10.7 },
];

const CURRENCY_MAP = new Map<string, CurrencyInfo>(CURRENCIES.map((c) => [c.code, c]));

export function getCurrencyInfo(code: string): CurrencyInfo {
  const upper = (code || 'EUR').toUpperCase();
  return (
    CURRENCY_MAP.get(upper) ?? {
      code: upper,
      name: upper,
      symbol: upper,
      decimals: 2,
      ecbSupported: true,
      fallbackPerEur: 1,
    }
  );
}

export function getCurrencyDecimals(code: string): 0 | 2 {
  return getCurrencyInfo(code).decimals;
}

export function formatMoney(
  amount: number,
  currency: string,
  options?: { signed?: boolean; compact?: boolean }
): string {
  const info = getCurrencyInfo(currency);
  const safe = Number.isFinite(amount) ? amount : 0;
  const normalized = Math.abs(safe) < 0.005 ? 0 : safe;
  const sign =
    options?.signed && normalized > 0 ? '+' : normalized < 0 ? '−' : '';
  const abs = Math.abs(normalized);

  try {
    const formatted = new Intl.NumberFormat('it-IT', {
      style: 'currency',
      currency: info.code,
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    }).format(abs);
    return `${sign}${formatted}`;
  } catch {
    const num = abs.toLocaleString('it-IT', {
      minimumFractionDigits: info.decimals,
      maximumFractionDigits: info.decimals,
    });
    return `${sign}${num} ${info.code}`;
  }
}

export function formatNumberIT(value: number, maxDecimals = 2, minDecimals = 0): string {
  return value.toLocaleString('it-IT', {
    minimumFractionDigits: minDecimals,
    maximumFractionDigits: maxDecimals,
  });
}

export function formatRateValue(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  const decimals = rate >= 100 ? 2 : rate >= 1 ? 4 : 6;
  return rate.toLocaleString('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: decimals,
  });
}

/**
 * Converte input numerico inserito dall'utente (supporta virgola italiana e punto decimale,
 * ad es. "1.250,50", "42,50", "42.50").
 */
export function parseDecimalInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/\s+/g, '');
  if (!cleaned) return null;

  let normalized = cleaned;
  const hasComma = cleaned.includes(',');
  const hasDot = cleaned.includes('.');

  if (hasComma && hasDot) {
    // L'ultimo separatore è considerato il separatore decimale
    if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
      normalized = cleaned.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = cleaned.replace(/,/g, '');
    }
  } else if (hasComma) {
    normalized = cleaned.replace(',', '.');
  }

  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const num = Number.parseFloat(normalized);
  return Number.isFinite(num) ? num : null;
}

export interface ExchangeRateResult {
  /** 1 unità di `from` = `rate` unità di `to` */
  rate: number;
  /** Data effettiva del tasso BCE restituito (YYYY-MM-DD) */
  effectiveDate: string;
  /** 'ecb' = tasso ufficiale BCE; 'fallback' = stima indicativa offline (modificabile) */
  source: 'ecb' | 'fallback';
}

const RATE_CACHE_KEY = 'bausplit_fx_cache_v1';
const memoryRateCache = new Map<string, ExchangeRateResult>();

function readCachedRate(key: string): ExchangeRateResult | null {
  const inMem = memoryRateCache.get(key);
  if (inMem) return inMem;
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, ExchangeRateResult>;
    const hit = parsed[key];
    if (hit && typeof hit.rate === 'number' && hit.rate > 0 && hit.source === 'ecb') {
      memoryRateCache.set(key, hit);
      return hit;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function writeCachedRate(key: string, value: ExchangeRateResult): void {
  memoryRateCache.set(key, value);
  if (value.source !== 'ecb') return;
  try {
    const raw = localStorage.getItem(RATE_CACHE_KEY);
    const parsed: Record<string, ExchangeRateResult> = raw ? JSON.parse(raw) : {};
    const keys = Object.keys(parsed);
    if (keys.length > 200) {
      for (const oldKey of keys.slice(0, 60)) {
        delete parsed[oldKey];
      }
    }
    parsed[key] = value;
    localStorage.setItem(RATE_CACHE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage errors
  }
}

export function getFallbackRate(from: string, to: string, date: string): ExchangeRateResult {
  const fromInfo = getCurrencyInfo(from);
  const toInfo = getCurrencyInfo(to);
  if (fromInfo.code === toInfo.code) {
    return { rate: 1, effectiveDate: date, source: 'ecb' };
  }
  // 1 EUR = fromPerEur FROM, 1 EUR = toPerEur TO => 1 FROM = (toPerEur / fromPerEur) TO
  const raw = toInfo.fallbackPerEur / fromInfo.fallbackPerEur;
  const rounded = Number(raw.toFixed(6));
  return {
    rate: rounded > 0 ? rounded : 1,
    effectiveDate: date,
    source: 'fallback',
  };
}

async function fetchWithTimeout(url: string, timeoutMs = 5500): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Recupera il tasso di cambio storico alla data indicata (`1 from = rate to`)
 * dalle quotazioni ufficiali BCE (Frankfurter, gratuito e senza API key).
 * Per date odierne o future usa l'ultima quotazione disponibile (`latest`).
 */
export async function fetchExchangeRate(
  fromCurrency: string,
  toCurrency: string,
  dateISO?: string
): Promise<ExchangeRateResult> {
  const from = fromCurrency.toUpperCase();
  const to = toCurrency.toUpperCase();
  const today = todayISO();
  const requestedDate =
    dateISO && /^\d{4}-\d{2}-\d{2}$/.test(dateISO) ? dateISO : today;

  if (from === to) {
    return { rate: 1, effectiveDate: requestedDate, source: 'ecb' };
  }

  const fromInfo = getCurrencyInfo(from);
  const toInfo = getCurrencyInfo(to);
  if (!fromInfo.ecbSupported || !toInfo.ecbSupported) {
    return getFallbackRate(from, to, requestedDate);
  }

  const isLatest = !dateISO || requestedDate >= today;
  const endpointDate = isLatest ? 'latest' : requestedDate < '1999-01-04' ? '1999-01-04' : requestedDate;
  const cacheKey = `${from}_${to}_${isLatest ? `latest_${today}` : endpointDate}`;

  const cached = readCachedRate(cacheKey);
  if (cached) return cached;

  const endpoints = [
    `https://api.frankfurter.dev/v1/${endpointDate}?base=${encodeURIComponent(from)}&symbols=${encodeURIComponent(to)}`,
    `https://api.frankfurter.app/${endpointDate}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
  ];

  for (const url of endpoints) {
    try {
      const res = await fetchWithTimeout(url);
      if (!res.ok) continue;
      const data = (await res.json()) as {
        date?: string;
        rates?: Record<string, number>;
      };
      const rate = data?.rates?.[to];
      if (typeof rate === 'number' && Number.isFinite(rate) && rate > 0) {
        const result: ExchangeRateResult = {
          rate: Number(rate.toFixed(6)),
          effectiveDate: data.date ?? requestedDate,
          source: 'ecb',
        };
        writeCachedRate(cacheKey, result);
        return result;
      }
    } catch {
      // Prova l'endpoint successivo o usa il tasso indicativo di fallback
    }
  }

  return getFallbackRate(from, to, requestedDate);
}
