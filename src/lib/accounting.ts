import type {
  CategoryInsight,
  CustomCategory,
  Expense,
  ExpenseSplit,
  GroupInsights,
  GroupMember,
  GroupOverview,
  MemberBalance,
  MemberInsight,
  MonthlyInsight,
  Settlement,
  SimplifiedTransfer,
  SplitMode,
} from '../types';
import { resolveCategoryDisplay } from './categories';
import { getCurrencyDecimals } from './currencies';
import { daysBetweenInclusive, formatShortMonthIT, isDateInRange } from './dates';

export function unitFactor(currency: string): number {
  return getCurrencyDecimals(currency) === 0 ? 1 : 100;
}

export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * unitFactor(currency));
}

export function fromMinorUnits(units: number, currency: string): number {
  const factor = unitFactor(currency);
  const val = units / factor;
  return Object.is(val, -0) ? 0 : val;
}

export function roundCurrency(amount: number, currency: string): number {
  return fromMinorUnits(toMinorUnits(amount, currency), currency);
}

export function convertToBaseAmount(
  amount: number,
  currency: string,
  exchangeRate: number,
  baseCurrency: string
): number {
  if (currency.toUpperCase() === baseCurrency.toUpperCase()) {
    return roundCurrency(amount, baseCurrency);
  }
  return roundCurrency(amount * exchangeRate, baseCurrency);
}

/**
 * Distribuisce `totalUnits` interi in modo proporzionale a `weights`
 * tramite il metodo dei resti più alti (Hamilton), garantendo che la somma
 * coincida sempre al centesimo con `totalUnits`.
 */
export function allocateProportionally(totalUnits: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  const totalWeight = weights.reduce((acc, w) => acc + Math.max(0, w), 0);
  if (totalUnits <= 0 || totalWeight <= 0) {
    return new Array<number>(n).fill(0);
  }

  const raw = weights.map((w) => (Math.max(0, w) / totalWeight) * totalUnits);
  const floors = raw.map((v) => Math.floor(v + 1e-9));
  let remainder = totalUnits - floors.reduce((acc, v) => acc + v, 0);

  if (remainder > 0) {
    const order = raw
      .map((v, idx) => ({ idx, frac: v - floors[idx] }))
      .sort((a, b) => (Math.abs(b.frac - a.frac) > 1e-9 ? b.frac - a.frac : a.idx - b.idx));
    for (let i = 0; i < remainder; i++) {
      floors[order[i % n].idx] += 1;
    }
  } else if (remainder < 0) {
    // Caso raro di arrotondamento per 1e-9
    for (let i = n - 1; i >= 0 && remainder < 0; i--) {
      if (floors[i] > 0) {
        floors[i] -= 1;
        remainder += 1;
      }
    }
  }

  return floors;
}

export interface ComputeSplitsParams {
  totalAmount: number;
  currency: string;
  totalBaseAmount: number;
  baseCurrency: string;
  splitMode: SplitMode;
  participantIds: string[];
  exactAmounts?: Record<string, number>;
  percentages?: Record<string, number>;
}

export interface ComputeSplitsResult {
  valid: boolean;
  error?: string;
  splits: ExpenseSplit[];
  /** Differenza residua (nella valuta della spesa per 'exact', in punti % per 'percentage') */
  remaining: number;
}

export function computeExpenseSplits(params: ComputeSplitsParams): ComputeSplitsResult {
  const {
    totalAmount,
    currency,
    totalBaseAmount,
    baseCurrency,
    splitMode,
    participantIds,
    exactAmounts = {},
    percentages = {},
  } = params;

  const uniqueIds = Array.from(new Set(participantIds));
  if (uniqueIds.length === 0) {
    return {
      valid: false,
      error: 'Seleziona almeno un partecipante.',
      splits: [],
      remaining: 0,
    };
  }

  const totalOrigUnits = toMinorUnits(totalAmount, currency);
  const totalBaseUnits = toMinorUnits(totalBaseAmount, baseCurrency);

  if (totalOrigUnits <= 0) {
    return {
      valid: false,
      error: 'Inserisci un importo maggiore di zero.',
      splits: [],
      remaining: 0,
    };
  }

  if (totalBaseUnits <= 0) {
    return {
      valid: false,
      error: "L'importo convertito nella valuta del gruppo è troppo piccolo.",
      splits: [],
      remaining: 0,
    };
  }

  if (splitMode === 'equal') {
    const weights = uniqueIds.map(() => 1);
    const origAlloc = allocateProportionally(totalOrigUnits, weights);
    const baseAlloc = allocateProportionally(totalBaseUnits, origAlloc);

    return {
      valid: true,
      remaining: 0,
      splits: uniqueIds.map((userId, idx) => ({
        userId,
        amount: fromMinorUnits(origAlloc[idx], currency),
        baseAmount: fromMinorUnits(baseAlloc[idx], baseCurrency),
        percentage: null,
      })),
    };
  }

  if (splitMode === 'exact') {
    const origUnitsPerUser = uniqueIds.map((id) => {
      const raw = exactAmounts[id] ?? 0;
      return toMinorUnits(raw, currency);
    });

    if (origUnitsPerUser.some((u) => u < 0)) {
      return {
        valid: false,
        error: 'Gli importi delle quote non possono essere negativi.',
        splits: [],
        remaining: 0,
      };
    }

    const assignedUnits = origUnitsPerUser.reduce((acc, u) => acc + u, 0);
    const diffUnits = totalOrigUnits - assignedUnits;
    const remaining = fromMinorUnits(diffUnits, currency);

    const baseAlloc =
      assignedUnits > 0
        ? allocateProportionally(totalBaseUnits, origUnitsPerUser)
        : new Array<number>(uniqueIds.length).fill(0);

    const previewSplits: ExpenseSplit[] = uniqueIds.map((userId, idx) => ({
      userId,
      amount: fromMinorUnits(origUnitsPerUser[idx], currency),
      baseAmount: fromMinorUnits(baseAlloc[idx], baseCurrency),
      percentage: null,
    }));

    if (diffUnits !== 0) {
      return {
        valid: false,
        error:
          diffUnits > 0
            ? 'La somma delle quote è inferiore al totale della spesa.'
            : 'La somma delle quote supera il totale della spesa.',
        splits: previewSplits,
        remaining,
      };
    }

    const nonZero = previewSplits.filter((s) => s.amount > 0 || s.baseAmount > 0);
    if (nonZero.length === 0) {
      return {
        valid: false,
        error: 'Assegna un importo ad almeno un partecipante.',
        splits: [],
        remaining: 0,
      };
    }

    return {
      valid: true,
      splits: nonZero,
      remaining: 0,
    };
  }

  // splitMode === 'percentage'
  const pctList = uniqueIds.map((id) => {
    const raw = percentages[id] ?? 0;
    return Number.isFinite(raw) ? raw : 0;
  });

  if (pctList.some((p) => p < 0)) {
    return {
      valid: false,
      error: 'Le percentuali non possono essere negative.',
      splits: [],
      remaining: 0,
    };
  }

  const sumPct = pctList.reduce((acc, p) => acc + p, 0);
  const remainingPct = Number((100 - sumPct).toFixed(2));

  const origAlloc =
    sumPct > 0
      ? allocateProportionally(totalOrigUnits, pctList)
      : new Array<number>(uniqueIds.length).fill(0);
  const baseAlloc =
    sumPct > 0
      ? allocateProportionally(totalBaseUnits, pctList)
      : new Array<number>(uniqueIds.length).fill(0);

  const previewSplits: ExpenseSplit[] = uniqueIds.map((userId, idx) => ({
    userId,
    amount: fromMinorUnits(origAlloc[idx], currency),
    baseAmount: fromMinorUnits(baseAlloc[idx], baseCurrency),
    percentage: Number(pctList[idx].toFixed(4)),
  }));

  // Accetta una tolleranza minima di 0,02% (es. 33,33 + 33,33 + 33,33 = 99,99%)
  if (Math.abs(100 - sumPct) > 0.02) {
    return {
      valid: false,
      error:
        sumPct < 100
          ? 'La somma delle percentuali deve raggiungere il 100%.'
          : 'La somma delle percentuali supera il 100%.',
      splits: previewSplits,
      remaining: remainingPct,
    };
  }

  const nonZero = previewSplits.filter((s) => (s.percentage ?? 0) > 0);
  return {
    valid: nonZero.length > 0,
    splits: nonZero,
    remaining: 0,
  };
}

export function computeMemberBalances(
  members: GroupMember[],
  expenses: Expense[],
  settlements: Settlement[],
  baseCurrency: string
): MemberBalance[] {
  interface Acc {
    userId: string;
    displayName: string;
    isActive: boolean;
    paidUnits: number;
    shareUnits: number;
    sentUnits: number;
    receivedUnits: number;
    transfersNetUnits: number;
  }

  const map = new Map<string, Acc>();
  const ensure = (userId: string): Acc => {
    const existing = map.get(userId);
    if (existing) return existing;
    const created: Acc = {
      userId,
      displayName: 'Membro',
      isActive: false,
      paidUnits: 0,
      shareUnits: 0,
      sentUnits: 0,
      receivedUnits: 0,
      transfersNetUnits: 0,
    };
    map.set(userId, created);
    return created;
  };

  for (const m of members) {
    map.set(m.userId, {
      userId: m.userId,
      displayName: m.displayName,
      isActive: m.leftAt === null,
      paidUnits: 0,
      shareUnits: 0,
      sentUnits: 0,
      receivedUnits: 0,
      transfersNetUnits: 0,
    });
  }

  for (const exp of expenses) {
    const splitsUnits = exp.splits.map((s) => toMinorUnits(s.baseAmount, baseCurrency));
    const sumSplits = splitsUnits.reduce((a, b) => a + b, 0);
    // Usa sumSplits se coincide (garantisce invariante somma saldi === 0 anche per arrotondamenti)
    const expUnits = toMinorUnits(exp.baseAmount, baseCurrency);
    const effectivePaid = Math.abs(expUnits - sumSplits) <= 1 ? sumSplits : expUnits;

    ensure(exp.paidBy).paidUnits += effectivePaid;
    exp.splits.forEach((s, idx) => {
      ensure(s.userId).shareUnits += splitsUnits[idx];
    });
  }

  for (const st of settlements) {
    const units = toMinorUnits(st.baseAmount, baseCurrency);
    if (st.kind === 'transfer_in' || st.kind === 'transfer_out') {
      ensure(st.fromUser).transfersNetUnits += units;
      ensure(st.toUser).transfersNetUnits -= units;
    } else {
      ensure(st.fromUser).sentUnits += units;
      ensure(st.toUser).receivedUnits += units;
    }
  }

  const list: MemberBalance[] = [];
  for (const acc of map.values()) {
    const netUnits =
      acc.paidUnits - acc.shareUnits + acc.sentUnits - acc.receivedUnits + acc.transfersNetUnits;
    // Mostra tutti i membri attivi e gli ex membri con saldo diverso da zero
    if (!acc.isActive && netUnits === 0) continue;
    list.push({
      userId: acc.userId,
      displayName: acc.displayName,
      isActive: acc.isActive,
      totalPaid: fromMinorUnits(acc.paidUnits, baseCurrency),
      totalShare: fromMinorUnits(acc.shareUnits, baseCurrency),
      settlementsSent: fromMinorUnits(acc.sentUnits, baseCurrency),
      settlementsReceived: fromMinorUnits(acc.receivedUnits, baseCurrency),
      transfersNet: fromMinorUnits(acc.transfersNetUnits, baseCurrency),
      netBalance: fromMinorUnits(netUnits, baseCurrency),
    });
  }

  return list.sort((a, b) => b.netBalance - a.netBalance || a.displayName.localeCompare(b.displayName, 'it'));
}

/**
 * Calcola il piano di rimborsi semplificato per ridurre al minimo il numero di pagamenti:
 * 1. Accoppia prima eventuali coppie debitore/creditore con lo stesso importo esatto;
 * 2. Poi compensa iterativamente il maggior debitore con il maggior creditore.
 */
export function simplifyDebts(
  balances: MemberBalance[],
  baseCurrency: string
): SimplifiedTransfer[] {
  interface Node {
    userId: string;
    name: string;
    units: number;
  }

  const creditors: Node[] = [];
  const debtors: Node[] = [];

  for (const b of balances) {
    const units = toMinorUnits(b.netBalance, baseCurrency);
    if (units > 0) {
      creditors.push({ userId: b.userId, name: b.displayName, units });
    } else if (units < 0) {
      debtors.push({ userId: b.userId, name: b.displayName, units: -units });
    }
  }

  const transfers: SimplifiedTransfer[] = [];

  // Passaggio 1: compensazioni esatte 1-a-1
  for (const d of debtors) {
    if (d.units === 0) continue;
    const exactCreditor = creditors.find((c) => c.units === d.units);
    if (exactCreditor) {
      transfers.push({
        fromUser: d.userId,
        fromName: d.name,
        toUser: exactCreditor.userId,
        toName: exactCreditor.name,
        amount: fromMinorUnits(d.units, baseCurrency),
      });
      d.units = 0;
      exactCreditor.units = 0;
    }
  }

  // Passaggio 2: compensazione greedy ordinata tra saldi residui
  while (true) {
    debtors.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'it'));
    creditors.sort((a, b) => b.units - a.units || a.name.localeCompare(b.name, 'it'));

    const d = debtors[0];
    const c = creditors[0];
    if (!d || !c || d.units <= 0 || c.units <= 0) break;

    const settled = Math.min(d.units, c.units);
    transfers.push({
      fromUser: d.userId,
      fromName: d.name,
      toUser: c.userId,
      toName: c.name,
      amount: fromMinorUnits(settled, baseCurrency),
    });
    d.units -= settled;
    c.units -= settled;
  }

  return transfers.sort((a, b) => b.amount - a.amount);
}

/**
 * Calcola l'impatto netto di una singola spesa per l'utente corrente (in baseCurrency):
 * > 0 = ha anticipato per altri ("ti spettano +X")
 * < 0 = deve la propria quota ("la tua quota -X")
 * null = non coinvolto nella spesa
 */
export function getUserExpenseImpact(
  expense: Expense,
  userId: string,
  baseCurrency: string
): { involved: boolean; netBase: number; myShareBase: number; paidByMe: boolean } {
  const paidByMe = expense.paidBy === userId;
  const mySplit = expense.splits.find((s) => s.userId === userId);
  if (!paidByMe && !mySplit) {
    return { involved: false, netBase: 0, myShareBase: 0, paidByMe: false };
  }
  const paidUnits = paidByMe ? toMinorUnits(expense.baseAmount, baseCurrency) : 0;
  const shareUnits = mySplit ? toMinorUnits(mySplit.baseAmount, baseCurrency) : 0;
  return {
    involved: true,
    netBase: fromMinorUnits(paidUnits - shareUnits, baseCurrency),
    myShareBase: fromMinorUnits(shareUnits, baseCurrency),
    paidByMe,
  };
}

/**
 * Individua quali gruppi attivi dell'utente possono ricevere il saldo rimanente
 * alla chiusura di `sourceGroupId` (devono contenere come membri attivi tutti
 * gli utenti coinvolti nel saldo rimanente).
 */
export function getGroupTransferTargets(params: {
  sourceGroupId: string;
  sourceMembers: GroupMember[];
  transfers: SimplifiedTransfer[];
  allGroups: GroupOverview[];
  nameOf: (userId: string) => string;
}): {
  involvedUserIds: string[];
  eligible: GroupOverview[];
  ineligible: { overview: GroupOverview; missingNames: string[] }[];
} {
  const { sourceGroupId, transfers, allGroups, nameOf } = params;
  const involvedSet = new Set<string>();
  for (const t of transfers) {
    involvedSet.add(t.fromUser);
    involvedSet.add(t.toUser);
  }
  const involvedUserIds = Array.from(involvedSet);

  const owners = new Map(params.sourceMembers.map((m) => [m.userId, m.ownerId]));
  const eligible: GroupOverview[] = [];
  const ineligible: { overview: GroupOverview; missingNames: string[] }[] = [];

  for (const ov of allGroups) {
    if (ov.group.id === sourceGroupId) continue;
    if (ov.group.closedAt !== null) continue;

    const targetOwners = new Set(ov.members.map((m) => m.ownerId).filter(Boolean));
    const missing = involvedUserIds.filter((uid) => !targetOwners.has(owners.get(uid) ?? null));
    if (missing.length === 0) {
      eligible.push(ov);
    } else {
      ineligible.push({
        overview: ov,
        missingNames: missing.map((uid) => nameOf(uid)),
      });
    }
  }

  return { involvedUserIds, eligible, ineligible };
}

/**
 * Calcola gli Insights del gruppo (o di un intervallo di date),
 * escludendo rigorosamente i rimborsi e i trasferimenti di saldo dai totali di spesa.
 */
export function computeGroupInsights(
  expenses: Expense[],
  settlements: Settlement[],
  members: GroupMember[],
  customCategories: CustomCategory[],
  baseCurrency: string,
  dateFrom = '',
  dateTo = ''
): GroupInsights {
  const filteredExpenses = expenses.filter((e) => isDateInRange(e.expenseDate, dateFrom, dateTo));
  const excludedSettlementsCount = settlements.filter(
    (s) => s.kind === 'settlement' && isDateInRange(s.settlementDate, dateFrom, dateTo)
  ).length;

  let totalUnits = 0;
  const catMap = new Map<
    string,
    { key: string; label: string; icon: string; color: string; units: number; count: number }
  >();
  const memberMap = new Map<
    string,
    {
      userId: string;
      displayName: string;
      isActive: boolean;
      advUnits: number;
      advCount: number;
      shareUnits: number;
      shareCount: number;
    }
  >();
  const monthMap = new Map<string, { units: number; count: number }>();

  for (const m of members) {
    memberMap.set(m.userId, {
      userId: m.userId,
      displayName: m.displayName,
      isActive: m.leftAt === null,
      advUnits: 0,
      advCount: 0,
      shareUnits: 0,
      shareCount: 0,
    });
  }

  const ensureMember = (userId: string) => {
    const hit = memberMap.get(userId);
    if (hit) return hit;
    const created = {
      userId,
      displayName: 'Membro',
      isActive: false,
      advUnits: 0,
      advCount: 0,
      shareUnits: 0,
      shareCount: 0,
    };
    memberMap.set(userId, created);
    return created;
  };

  let minDate = '';
  let maxDate = '';

  for (const exp of filteredExpenses) {
    const expUnits = toMinorUnits(exp.baseAmount, baseCurrency);
    totalUnits += expUnits;

    if (!minDate || exp.expenseDate < minDate) minDate = exp.expenseDate;
    if (!maxDate || exp.expenseDate > maxDate) maxDate = exp.expenseDate;

    // Categoria
    const catInfo = resolveCategoryDisplay(exp.category, exp.categoryLabel, customCategories);
    const catKey = catInfo.key;
    const catEntry = catMap.get(catKey) ?? {
      key: catKey,
      label: catInfo.name,
      icon: catInfo.icon,
      color: catInfo.color,
      units: 0,
      count: 0,
    };
    catEntry.units += expUnits;
    catEntry.count += 1;
    catMap.set(catKey, catEntry);

    // Chi ha anticipato il denaro
    const payer = ensureMember(exp.paidBy);
    payer.advUnits += expUnits;
    payer.advCount += 1;

    // Quota effettiva di ciascuno
    for (const s of exp.splits) {
      const sUnits = toMinorUnits(s.baseAmount, baseCurrency);
      if (sUnits <= 0) continue;
      const participant = ensureMember(s.userId);
      participant.shareUnits += sUnits;
      participant.shareCount += 1;
    }

    // Andamento mensile
    const monthKey = exp.expenseDate.slice(0, 7);
    const monthEntry = monthMap.get(monthKey) ?? { units: 0, count: 0 };
    monthEntry.units += expUnits;
    monthEntry.count += 1;
    monthMap.set(monthKey, monthEntry);
  }

  const totalSpent = fromMinorUnits(totalUnits, baseCurrency);
  const expenseCount = filteredExpenses.length;
  const averageExpense =
    expenseCount > 0 ? roundCurrency(totalSpent / expenseCount, baseCurrency) : 0;

  let dailyAverage: number | null = null;
  const effectiveFrom = dateFrom || minDate;
  const effectiveTo = dateTo || maxDate;
  if (expenseCount > 0 && effectiveFrom && effectiveTo && effectiveFrom <= effectiveTo) {
    const days = daysBetweenInclusive(effectiveFrom, effectiveTo);
    dailyAverage = roundCurrency(totalSpent / days, baseCurrency);
  }

  const byCategory: CategoryInsight[] = Array.from(catMap.values())
    .sort((a, b) => b.units - a.units || b.count - a.count)
    .map((c) => ({
      key: c.key,
      label: c.label,
      icon: c.icon,
      color: c.color,
      total: fromMinorUnits(c.units, baseCurrency),
      count: c.count,
      percentage: totalUnits > 0 ? Number(((c.units / totalUnits) * 100).toFixed(1)) : 0,
    }));

  const totalShareUnits = Array.from(memberMap.values()).reduce((acc, m) => acc + m.shareUnits, 0);

  const byMember: MemberInsight[] = Array.from(memberMap.values())
    .filter((m) => m.isActive || m.advUnits > 0 || m.shareUnits > 0)
    .sort(
      (a, b) =>
        b.advUnits - a.advUnits ||
        b.shareUnits - a.shareUnits ||
        a.displayName.localeCompare(b.displayName, 'it')
    )
    .map((m) => ({
      userId: m.userId,
      displayName: m.displayName,
      advancedTotal: fromMinorUnits(m.advUnits, baseCurrency),
      advancedCount: m.advCount,
      advancedPercentage:
        totalUnits > 0 ? Number(((m.advUnits / totalUnits) * 100).toFixed(1)) : 0,
      shareTotal: fromMinorUnits(m.shareUnits, baseCurrency),
      shareCount: m.shareCount,
      sharePercentage:
        totalShareUnits > 0 ? Number(((m.shareUnits / totalShareUnits) * 100).toFixed(1)) : 0,
      periodDelta: fromMinorUnits(m.advUnits - m.shareUnits, baseCurrency),
    }));

  const byMonth: MonthlyInsight[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, val]) => ({
      monthKey,
      label: formatShortMonthIT(monthKey),
      total: fromMinorUnits(val.units, baseCurrency),
      count: val.count,
    }));

  return {
    totalSpent,
    expenseCount,
    averageExpense,
    dailyAverage,
    byCategory,
    byMember,
    byMonth,
    excludedSettlementsCount,
  };
}
