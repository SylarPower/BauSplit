import type { RecurringExpense, RecurringFrequency } from '../types';
import { addDaysISO, addMonthsClampedISO, parseISODate } from './dates';

export const FREQUENCY_LABELS: Record<RecurringFrequency, string> = {
  weekly: 'Ogni settimana',
  biweekly: 'Ogni 2 settimane',
  monthly: 'Ogni mese',
  bimonthly: 'Ogni 2 mesi',
  quarterly: 'Ogni 3 mesi',
  yearly: 'Ogni anno',
};

export const FREQUENCY_OPTIONS: { value: RecurringFrequency; label: string }[] = [
  { value: 'weekly', label: 'Ogni settimana' },
  { value: 'biweekly', label: 'Ogni 2 settimane' },
  { value: 'monthly', label: 'Ogni mese' },
  { value: 'bimonthly', label: 'Ogni 2 mesi' },
  { value: 'quarterly', label: 'Ogni 3 mesi' },
  { value: 'yearly', label: 'Ogni anno' },
];

export function advanceRecurringDate(
  currentISO: string,
  frequency: RecurringFrequency,
  anchorStartISO?: string
): string {
  const anchorDay = anchorStartISO ? parseISODate(anchorStartISO).day : undefined;
  switch (frequency) {
    case 'weekly':
      return addDaysISO(currentISO, 7);
    case 'biweekly':
      return addDaysISO(currentISO, 14);
    case 'monthly':
      return addMonthsClampedISO(currentISO, 1, anchorDay);
    case 'bimonthly':
      return addMonthsClampedISO(currentISO, 2, anchorDay);
    case 'quarterly':
      return addMonthsClampedISO(currentISO, 3, anchorDay);
    case 'yearly':
      return addMonthsClampedISO(currentISO, 12, anchorDay);
  }
}

/**
 * Calcola tutte le date di scadenza maturate fino a `upToISO` (inclusa) per una spesa ricorrente,
 * con un tetto di sicurezza di `maxOccurrences` per evitare cicli eccessivi.
 */
export function collectDueOccurrences(
  recurring: Pick<
    RecurringExpense,
    'active' | 'startDate' | 'nextDueDate' | 'endDate' | 'frequency'
  >,
  upToISO: string,
  maxOccurrences = 24
): { occurrences: string[]; nextDueDate: string; shouldDeactivate: boolean } {
  if (!recurring.active) {
    return {
      occurrences: [],
      nextDueDate: recurring.nextDueDate,
      shouldDeactivate: false,
    };
  }

  const occurrences: string[] = [];
  let cursor = recurring.nextDueDate;
  let shouldDeactivate = false;

  while (cursor <= upToISO && occurrences.length < maxOccurrences) {
    if (recurring.endDate && cursor > recurring.endDate) {
      shouldDeactivate = true;
      break;
    }
    occurrences.push(cursor);
    cursor = advanceRecurringDate(cursor, recurring.frequency, recurring.startDate);
  }

  if (recurring.endDate && cursor > recurring.endDate) {
    shouldDeactivate = true;
  }

  return { occurrences, nextDueDate: cursor, shouldDeactivate };
}
