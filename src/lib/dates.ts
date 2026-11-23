import type { CompareDatePreset, DateRangePreset } from '../types';

export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseISODate(iso: string): { year: number; month: number; day: number } {
  const [y, m, d] = iso.split('-').map((n) => Number.parseInt(n, 10));
  return { year: y, month: m, day: d };
}

export function toISODateUTC(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDaysISO(iso: string, days: number): string {
  const { year, month, day } = parseISODate(iso);
  const dt = new Date(Date.UTC(year, month - 1, day + days));
  return toISODateUTC(dt);
}

export function daysInMonth(year: number, month1Based: number): number {
  return new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
}

export function addMonthsClampedISO(iso: string, monthsToAdd: number, anchorDay?: number): string {
  const { year, month, day } = parseISODate(iso);
  const totalMonths = year * 12 + (month - 1) + monthsToAdd;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = daysInMonth(targetYear, targetMonth);
  const targetDay = Math.min(anchorDay ?? day, maxDay);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(targetDay).padStart(2, '0')}`;
}

export function daysBetweenInclusive(fromISO: string, toISO: string): number {
  const a = parseISODate(fromISO);
  const b = parseISODate(toISO);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  const diff = Math.floor((msB - msA) / 86_400_000);
  return Math.max(1, diff + 1);
}

const SHORT_MONTHS_IT = [
  'gen',
  'feb',
  'mar',
  'apr',
  'mag',
  'giu',
  'lug',
  'ago',
  'set',
  'ott',
  'nov',
  'dic',
];

const LONG_MONTHS_IT = [
  'Gennaio',
  'Febbraio',
  'Marzo',
  'Aprile',
  'Maggio',
  'Giugno',
  'Luglio',
  'Agosto',
  'Settembre',
  'Ottobre',
  'Novembre',
  'Dicembre',
];

export function formatDateIT(iso: string, options?: { relative?: boolean; nowISO?: string }): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  if (options?.relative) {
    const ref = options.nowISO ?? todayISO();
    if (iso === ref) return 'Oggi';
    if (iso === addDaysISO(ref, -1)) return 'Ieri';
  }
  const { year, month, day } = parseISODate(iso);
  const currentYear = parseISODate(options?.nowISO ?? todayISO()).year;
  const monthLabel = SHORT_MONTHS_IT[month - 1] ?? '';
  return year === currentYear ? `${day} ${monthLabel}` : `${day} ${monthLabel} ${year}`;
}

export function formatFullDateIT(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const { year, month, day } = parseISODate(iso);
  return `${day} ${SHORT_MONTHS_IT[month - 1] ?? ''} ${year}`;
}

export function formatMonthHeadingIT(monthKey: string): string {
  const [y, m] = monthKey.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m) return monthKey;
  return `${LONG_MONTHS_IT[m - 1] ?? ''} ${y}`;
}

export function formatShortMonthIT(monthKey: string): string {
  const [y, m] = monthKey.split('-').map((n) => Number.parseInt(n, 10));
  if (!y || !m) return monthKey;
  const short = SHORT_MONTHS_IT[m - 1] ?? '';
  const cap = short.charAt(0).toUpperCase() + short.slice(1);
  return `${cap} '${String(y).slice(-2)}`;
}

export function formatDateTimeIT(isoTimestamp: string): string {
  const dt = new Date(isoTimestamp);
  if (Number.isNaN(dt.getTime())) return isoTimestamp;
  return new Intl.DateTimeFormat('it-IT', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(dt);
}

export const DATE_PRESET_LABELS: Record<DateRangePreset, string> = {
  all: 'Tutto il periodo',
  this_week: 'Questa settimana',
  this_month: 'Questo mese',
  last_month: 'Mese scorso',
  this_year: "Quest'anno",
  last_year: 'Anno scorso',
  custom: 'Intervallo personalizzato',
};

export const COMPARE_PRESET_LABELS: Record<CompareDatePreset, string> = {
  auto: 'Periodo precedente',
  this_week: 'Questa settimana',
  this_month: 'Questo mese',
  last_month: 'Mese scorso',
  this_year: "Quest'anno",
  last_year: 'Anno scorso',
  custom: 'Intervallo personalizzato',
};

export interface ResolvedComparisonPeriod {
  rangeA: { from: string; to: string };
  rangeB: { from: string; to: string };
  valid: boolean;
  isOngoingA: boolean;
  appliedElapsedParity: boolean;
}

export function resolveDatePreset(
  preset: DateRangePreset,
  customFrom: string,
  customTo: string,
  refISO: string = todayISO()
): { from: string; to: string } {
  const { year, month, day } = parseISODate(refISO);
  switch (preset) {
    case 'all':
      return { from: '', to: '' };
    case 'this_week': {
      const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
      const monday = addDaysISO(refISO, -((dow + 6) % 7));
      return { from: monday, to: addDaysISO(monday, 6) };
    }
    case 'this_month': {
      const m = String(month).padStart(2, '0');
      const last = String(daysInMonth(year, month)).padStart(2, '0');
      return { from: `${year}-${m}-01`, to: `${year}-${m}-${last}` };
    }
    case 'last_month': {
      const prevYear = month === 1 ? year - 1 : year;
      const prevMonth = month === 1 ? 12 : month - 1;
      const m = String(prevMonth).padStart(2, '0');
      const last = String(daysInMonth(prevYear, prevMonth)).padStart(2, '0');
      return { from: `${prevYear}-${m}-01`, to: `${prevYear}-${m}-${last}` };
    }
    case 'this_year':
      return { from: `${year}-01-01`, to: `${year}-12-31` };
    case 'last_year':
      return { from: `${year - 1}-01-01`, to: `${year - 1}-12-31` };
    case 'custom':
      return { from: customFrom, to: customTo };
  }
}

export function resolveComparisonPeriod(params: {
  presetA: DateRangePreset;
  customAFrom: string;
  customATo: string;
  comparePreset: CompareDatePreset;
  compareCustomFrom: string;
  compareCustomTo: string;
  matchElapsed: boolean;
  refISO?: string;
}): ResolvedComparisonPeriod {
  const {
    presetA,
    customAFrom,
    customATo,
    comparePreset,
    compareCustomFrom,
    compareCustomTo,
    matchElapsed,
    refISO = todayISO(),
  } = params;

  const rawA = resolveDatePreset(presetA, customAFrom, customATo, refISO);
  const isOngoingA =
    (presetA === 'this_week' || presetA === 'this_month' || presetA === 'this_year') &&
    rawA.from <= refISO &&
    refISO <= rawA.to;
  const applyParity = isOngoingA && matchElapsed && comparePreset !== 'custom';

  const { year, month, day } = parseISODate(refISO);
  let rangeB: { from: string; to: string } = { from: '', to: '' };
  let valid = false;

  if (comparePreset === 'auto') {
    switch (presetA) {
      case 'all':
        valid = false;
        break;
      case 'this_week': {
        const prevMonday = addDaysISO(rawA.from, -7);
        rangeB = {
          from: prevMonday,
          to: applyParity ? addDaysISO(refISO, -7) : addDaysISO(prevMonday, 6),
        };
        valid = true;
        break;
      }
      case 'this_month': {
        const prevYear = month === 1 ? year - 1 : year;
        const prevMonth = month === 1 ? 12 : month - 1;
        const m = String(prevMonth).padStart(2, '0');
        const maxDay = daysInMonth(prevYear, prevMonth);
        const endDay = applyParity ? Math.min(day, maxDay) : maxDay;
        rangeB = {
          from: `${prevYear}-${m}-01`,
          to: `${prevYear}-${m}-${String(endDay).padStart(2, '0')}`,
        };
        valid = true;
        break;
      }
      case 'last_month': {
        const { year: aYear, month: aMonth } = parseISODate(rawA.from);
        const prevYear = aMonth === 1 ? aYear - 1 : aYear;
        const prevMonth = aMonth === 1 ? 12 : aMonth - 1;
        const m = String(prevMonth).padStart(2, '0');
        const last = String(daysInMonth(prevYear, prevMonth)).padStart(2, '0');
        rangeB = { from: `${prevYear}-${m}-01`, to: `${prevYear}-${m}-${last}` };
        valid = true;
        break;
      }
      case 'this_year': {
        const prevYear = year - 1;
        if (applyParity) {
          const endDay = Math.min(day, daysInMonth(prevYear, month));
          rangeB = {
            from: `${prevYear}-01-01`,
            to: `${prevYear}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
          };
        } else {
          rangeB = { from: `${prevYear}-01-01`, to: `${prevYear}-12-31` };
        }
        valid = true;
        break;
      }
      case 'last_year': {
        const { year: aYear } = parseISODate(rawA.from);
        const prevYear = aYear - 1;
        rangeB = { from: `${prevYear}-01-01`, to: `${prevYear}-12-31` };
        valid = true;
        break;
      }
      case 'custom': {
        const effectiveTo = rawA.to || (rawA.from && rawA.from <= refISO ? refISO : '');
        if (rawA.from && effectiveTo && rawA.from <= effectiveTo) {
          const days = daysBetweenInclusive(rawA.from, effectiveTo);
          const prevTo = addDaysISO(rawA.from, -1);
          rangeB = { from: addDaysISO(prevTo, -(days - 1)), to: prevTo };
          valid = true;
        }
        break;
      }
    }
  } else if (comparePreset === 'custom') {
    if (
      (compareCustomFrom || compareCustomTo) &&
      !(compareCustomFrom && compareCustomTo && compareCustomFrom > compareCustomTo)
    ) {
      rangeB = { from: compareCustomFrom, to: compareCustomTo };
      valid = true;
    }
  } else {
    const baseB = resolveDatePreset(comparePreset, '', '', refISO);
    if (applyParity) {
      if (presetA === 'this_year' && comparePreset === 'last_year') {
        const prevYear = year - 1;
        const endDay = Math.min(day, daysInMonth(prevYear, month));
        rangeB = {
          from: `${prevYear}-01-01`,
          to: `${prevYear}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
        };
      } else {
        const elapsedDays = daysBetweenInclusive(rawA.from, refISO);
        const cappedTo = addDaysISO(baseB.from, elapsedDays - 1);
        rangeB = {
          from: baseB.from,
          to: cappedTo < baseB.to ? cappedTo : baseB.to,
        };
      }
    } else {
      rangeB = baseB;
    }
    valid = true;
  }

  return {
    rangeA: valid && applyParity ? { from: rawA.from, to: refISO } : rawA,
    rangeB,
    valid,
    isOngoingA,
    appliedElapsedParity: valid && applyParity,
  };
}

export function isDateInRange(iso: string, from: string, to: string): boolean {
  if (from && iso < from) return false;
  if (to && iso > to) return false;
  return true;
}
