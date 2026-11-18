import type {
  ActivityChanges,
  Expense,
  ExpenseInput,
  ExpenseSplit,
  FieldChange,
  Settlement,
  SettlementInput,
  SplitMode,
} from '../types';
import { formatMoney, formatRateValue } from './currencies';
import { formatFullDateIT } from './dates';

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  equal: 'Parti uguali',
  exact: 'Importi esatti',
  percentage: 'Percentuali',
};

/**
 * Formatta in italiano naturale una riga dello storico evitando ripetizioni del nome
 * o maiuscole fuori posto (es. "Marco" + "Ha aggiunto..." -> "Marco" + "ha aggiunto...").
 */
export function splitLogActorAndBody(
  actorName: string,
  summary: string
): { lead: string; rest: string } {
  const trimmed = summary.trim();
  if (actorName && trimmed.startsWith(`${actorName} `)) {
    return {
      lead: actorName,
      rest: trimmed.slice(actorName.length + 1),
    };
  }
  if (/^Ha\s/.test(trimmed)) {
    return {
      lead: actorName,
      rest: `ha ${trimmed.slice(3)}`,
    };
  }
  if (trimmed.startsWith('Spesa ricorrente registrata')) {
    return {
      lead: 'Ricorrenza automatica',
      rest: `· ${trimmed}`,
    };
  }
  return {
    lead: actorName,
    rest: trimmed,
  };
}

function formatSplitsSummary(
  splits: ExpenseSplit[],
  currency: string,
  splitMode: SplitMode,
  nameOf: (userId: string) => string
): string {
  return splits
    .map((s) => {
      const name = nameOf(s.userId);
      const money = formatMoney(s.amount, currency);
      if (splitMode === 'percentage' && s.percentage !== null) {
        const pct = s.percentage.toLocaleString('it-IT', { maximumFractionDigits: 2 });
        return `${name}: ${money} (${pct}%)`;
      }
      return `${name}: ${money}`;
    })
    .join(', ');
}

function formatAmountWithFx(
  amount: number,
  currency: string,
  baseAmount: number,
  baseCurrency: string,
  exchangeRate: number,
  rateIsManual: boolean
): string {
  const orig = formatMoney(amount, currency);
  if (currency === baseCurrency) return orig;
  const base = formatMoney(baseAmount, baseCurrency);
  const mode = rateIsManual ? 'manuale' : 'automatico';
  return `${orig} → ${base} (cambio ${formatRateValue(exchangeRate)}, ${mode})`;
}

export function buildExpenseCreatedLog(
  input: ExpenseInput,
  baseCurrency: string,
  nameOf: (userId: string) => string,
  fromRecurring = false
): { summary: string; changes: ActivityChanges } {
  const moneyStr =
    input.currency === baseCurrency
      ? formatMoney(input.amount, input.currency)
      : `${formatMoney(input.amount, input.currency)} (${formatMoney(input.baseAmount, baseCurrency)})`;

  const summary = fromRecurring
    ? `Spesa ricorrente registrata: "${input.description}" (${moneyStr})`
    : `Ha aggiunto la spesa "${input.description}" di ${moneyStr}`;

  const snapshot: Record<string, string> = {
    Importo: formatAmountWithFx(
      input.amount,
      input.currency,
      input.baseAmount,
      baseCurrency,
      input.exchangeRate,
      input.rateIsManual
    ),
    'Pagato da': nameOf(input.paidBy),
    Categoria: input.categoryLabel,
    Data: formatFullDateIT(input.expenseDate),
    Divisione: `${SPLIT_MODE_LABELS[input.splitMode]} — ${formatSplitsSummary(
      input.splits,
      input.currency,
      input.splitMode,
      nameOf
    )}`,
  };
  if (input.note.trim()) {
    snapshot.Nota = input.note.trim();
  }

  return { summary, changes: { snapshot } };
}

export function buildExpenseUpdatedLog(
  before: Expense,
  after: ExpenseInput,
  baseCurrency: string,
  nameOf: (userId: string) => string
): { summary: string; changes: ActivityChanges } {
  const diffs: FieldChange[] = [];

  if (before.description.trim() !== after.description.trim()) {
    diffs.push({
      field: 'Descrizione',
      before: before.description,
      after: after.description.trim(),
    });
  }

  const amountChanged =
    Math.abs(before.amount - after.amount) >= 0.005 ||
    before.currency !== after.currency ||
    Math.abs(before.baseAmount - after.baseAmount) >= 0.005 ||
    Math.abs(before.exchangeRate - after.exchangeRate) >= 0.00001;

  if (amountChanged) {
    diffs.push({
      field: 'Importo e valuta',
      before: formatAmountWithFx(
        before.amount,
        before.currency,
        before.baseAmount,
        baseCurrency,
        before.exchangeRate,
        before.rateIsManual
      ),
      after: formatAmountWithFx(
        after.amount,
        after.currency,
        after.baseAmount,
        baseCurrency,
        after.exchangeRate,
        after.rateIsManual
      ),
    });
  }

  if (before.paidBy !== after.paidBy) {
    diffs.push({
      field: 'Pagato da',
      before: nameOf(before.paidBy),
      after: nameOf(after.paidBy),
    });
  }

  if (before.expenseDate !== after.expenseDate) {
    diffs.push({
      field: 'Data',
      before: formatFullDateIT(before.expenseDate),
      after: formatFullDateIT(after.expenseDate),
    });
  }

  if (before.categoryLabel !== after.categoryLabel) {
    diffs.push({
      field: 'Categoria',
      before: before.categoryLabel,
      after: after.categoryLabel,
    });
  }

  const beforeSplitText = `${SPLIT_MODE_LABELS[before.splitMode]} (${formatSplitsSummary(
    before.splits,
    before.currency,
    before.splitMode,
    nameOf
  )})`;
  const afterSplitText = `${SPLIT_MODE_LABELS[after.splitMode]} (${formatSplitsSummary(
    after.splits,
    after.currency,
    after.splitMode,
    nameOf
  )})`;
  if (beforeSplitText !== afterSplitText) {
    diffs.push({
      field: 'Ripartizione',
      before: beforeSplitText,
      after: afterSplitText,
    });
  }

  if (before.note.trim() !== after.note.trim()) {
    diffs.push({
      field: 'Nota',
      before: before.note.trim() || '(vuota)',
      after: after.note.trim() || '(vuota)',
    });
  }

  return {
    summary: `Ha modificato la spesa "${after.description.trim()}"`,
    changes: { diffs },
  };
}

export function buildExpenseDeletedLog(
  expense: Expense,
  baseCurrency: string,
  nameOf: (userId: string) => string
): { summary: string; changes: ActivityChanges } {
  const moneyStr =
    expense.currency === baseCurrency
      ? formatMoney(expense.amount, expense.currency)
      : `${formatMoney(expense.amount, expense.currency)} (${formatMoney(expense.baseAmount, baseCurrency)})`;

  const snapshot: Record<string, string> = {
    Descrizione: expense.description,
    Importo: formatAmountWithFx(
      expense.amount,
      expense.currency,
      expense.baseAmount,
      baseCurrency,
      expense.exchangeRate,
      expense.rateIsManual
    ),
    'Pagato da': nameOf(expense.paidBy),
    Categoria: expense.categoryLabel,
    Data: formatFullDateIT(expense.expenseDate),
    Divisione: `${SPLIT_MODE_LABELS[expense.splitMode]} — ${formatSplitsSummary(
      expense.splits,
      expense.currency,
      expense.splitMode,
      nameOf
    )}`,
  };
  if (expense.note.trim()) {
    snapshot.Nota = expense.note.trim();
  }

  return {
    summary: `Ha eliminato la spesa "${expense.description}" di ${moneyStr}`,
    changes: { snapshot },
  };
}

export function buildSettlementCreatedLog(
  input: SettlementInput,
  baseCurrency: string,
  nameOf: (userId: string) => string
): { summary: string; changes: ActivityChanges } {
  const moneyStr =
    input.currency === baseCurrency
      ? formatMoney(input.amount, input.currency)
      : `${formatMoney(input.amount, input.currency)} (${formatMoney(input.baseAmount, baseCurrency)})`;

  const from = nameOf(input.fromUser);
  const to = nameOf(input.toUser);
  const snapshot: Record<string, string> = {
    Rimborso: `${from} → ${to}`,
    Importo: formatAmountWithFx(
      input.amount,
      input.currency,
      input.baseAmount,
      baseCurrency,
      input.exchangeRate,
      input.rateIsManual
    ),
    Data: formatFullDateIT(input.settlementDate),
  };
  if (input.note.trim()) {
    snapshot.Nota = input.note.trim();
  }

  return {
    summary: `Ha registrato un rimborso di ${moneyStr} da ${from} a ${to}`,
    changes: { snapshot },
  };
}

export function buildSettlementUpdatedLog(
  before: Settlement,
  after: SettlementInput,
  baseCurrency: string,
  nameOf: (userId: string) => string
): { summary: string; changes: ActivityChanges } {
  const diffs: FieldChange[] = [];

  if (before.fromUser !== after.fromUser || before.toUser !== after.toUser) {
    diffs.push({
      field: 'Parti',
      before: `${nameOf(before.fromUser)} → ${nameOf(before.toUser)}`,
      after: `${nameOf(after.fromUser)} → ${nameOf(after.toUser)}`,
    });
  }

  if (
    Math.abs(before.amount - after.amount) >= 0.005 ||
    before.currency !== after.currency ||
    Math.abs(before.baseAmount - after.baseAmount) >= 0.005
  ) {
    diffs.push({
      field: 'Importo',
      before: formatAmountWithFx(
        before.amount,
        before.currency,
        before.baseAmount,
        baseCurrency,
        before.exchangeRate,
        before.rateIsManual
      ),
      after: formatAmountWithFx(
        after.amount,
        after.currency,
        after.baseAmount,
        baseCurrency,
        after.exchangeRate,
        after.rateIsManual
      ),
    });
  }

  if (before.settlementDate !== after.settlementDate) {
    diffs.push({
      field: 'Data',
      before: formatFullDateIT(before.settlementDate),
      after: formatFullDateIT(after.settlementDate),
    });
  }

  if (before.note.trim() !== after.note.trim()) {
    diffs.push({
      field: 'Nota',
      before: before.note.trim() || '(vuota)',
      after: after.note.trim() || '(vuota)',
    });
  }

  return {
    summary: `Ha modificato il rimborso da ${nameOf(after.fromUser)} a ${nameOf(after.toUser)}`,
    changes: { diffs },
  };
}

export function buildSettlementDeletedLog(
  settlement: Settlement,
  baseCurrency: string,
  nameOf: (userId: string) => string
): { summary: string; changes: ActivityChanges } {
  const from = nameOf(settlement.fromUser);
  const to = nameOf(settlement.toUser);
  const moneyStr =
    settlement.currency === baseCurrency
      ? formatMoney(settlement.amount, settlement.currency)
      : `${formatMoney(settlement.amount, settlement.currency)} (${formatMoney(settlement.baseAmount, baseCurrency)})`;

  const snapshot: Record<string, string> = {
    Rimborso: `${from} → ${to}`,
    Importo: formatAmountWithFx(
      settlement.amount,
      settlement.currency,
      settlement.baseAmount,
      baseCurrency,
      settlement.exchangeRate,
      settlement.rateIsManual
    ),
    Data: formatFullDateIT(settlement.settlementDate),
  };
  if (settlement.note.trim()) {
    snapshot.Nota = settlement.note.trim();
  }

  return {
    summary: `Ha eliminato il rimborso di ${moneyStr} da ${from} a ${to}`,
    changes: { snapshot },
  };
}
