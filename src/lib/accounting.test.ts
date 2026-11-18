import { describe, expect, it } from 'vitest';
import type { Expense, GroupMember, Settlement } from '../types';
import {
  computeExpenseSplits,
  computeGroupInsights,
  computeMemberBalances,
  convertToBaseAmount,
  simplifyDebts,
} from './accounting';
import { buildExpenseUpdatedLog } from './audit';
import { parseDecimalInput } from './currencies';
import { generateGroupCsv } from './csv';
import { advanceRecurringDate, collectDueOccurrences } from './recurring';
import { extractInviteToken } from './supabase';

const MEMBERS: GroupMember[] = [
  { userId: 'u1', ownerId: 'u1', displayName: 'Marco', joinedAt: '2026-01-01', leftAt: null },
  { userId: 'u2', ownerId: 'u2', displayName: 'Giulia', joinedAt: '2026-01-01', leftAt: null },
  { userId: 'u3', ownerId: 'u3', displayName: 'Luca', joinedAt: '2026-01-01', leftAt: null },
];

function makeExpense(partial: Partial<Expense> & Pick<Expense, 'id' | 'paidBy' | 'baseAmount' | 'splits'>): Expense {
  return {
    groupId: 'g1',
    description: 'Spesa test',
    amount: partial.baseAmount,
    currency: 'EUR',
    exchangeRate: 1,
    rateDate: '2026-11-10',
    rateIsManual: false,
    expenseDate: '2026-11-10',
    category: 'spesa',
    categoryLabel: 'Spesa alimentare',
    splitMode: 'equal',
    note: '',
    recurringId: null,
    recurringOccurrenceDate: null,
    createdBy: partial.paidBy,
    updatedBy: partial.paidBy,
    createdAt: '2026-11-10T10:00:00Z',
    updatedAt: '2026-11-10T10:00:00Z',
    ...partial,
  };
}

describe('computeExpenseSplits', () => {
  it('distribuisce al centesimo in parti uguali anche con resto indivisibile e valuta estera', () => {
    const base = convertToBaseAmount(84, 'GBP', 1.1765, 'EUR');
    expect(base).toBe(98.83);

    const res = computeExpenseSplits({
      totalAmount: 84,
      currency: 'GBP',
      totalBaseAmount: base,
      baseCurrency: 'EUR',
      splitMode: 'equal',
      participantIds: ['u1', 'u2', 'u3'],
    });

    expect(res.valid).toBe(true);
    expect(res.splits.map((s) => s.amount)).toEqual([28, 28, 28]);
    const sumBase = Number(res.splits.reduce((a, s) => a + s.baseAmount, 0).toFixed(2));
    expect(sumBase).toBe(98.83);
  });

  it('gestisce 10,00 € diviso 3 senza perdere centesimi', () => {
    const res = computeExpenseSplits({
      totalAmount: 10,
      currency: 'EUR',
      totalBaseAmount: 10,
      baseCurrency: 'EUR',
      splitMode: 'equal',
      participantIds: ['u1', 'u2', 'u3'],
    });
    expect(res.valid).toBe(true);
    expect(res.splits.map((s) => s.amount)).toEqual([3.34, 3.33, 3.33]);
  });

  it('valida la divisione per importi esatti e calcola la differenza residua', () => {
    const incomplete = computeExpenseSplits({
      totalAmount: 74,
      currency: 'EUR',
      totalBaseAmount: 74,
      baseCurrency: 'EUR',
      splitMode: 'exact',
      participantIds: ['u1', 'u2'],
      exactAmounts: { u1: 39, u2: 30 },
    });
    expect(incomplete.valid).toBe(false);
    expect(incomplete.remaining).toBe(5);

    const valid = computeExpenseSplits({
      totalAmount: 74,
      currency: 'EUR',
      totalBaseAmount: 74,
      baseCurrency: 'EUR',
      splitMode: 'exact',
      participantIds: ['u1', 'u2'],
      exactAmounts: { u1: 39, u2: 35 },
    });
    expect(valid.valid).toBe(true);
    expect(valid.splits.map((s) => s.amount)).toEqual([39, 35]);
  });

  it('divide correttamente per percentuali inclusi terzi (33,33%) e valute senza decimali (JPY)', () => {
    const pct = computeExpenseSplits({
      totalAmount: 780,
      currency: 'EUR',
      totalBaseAmount: 780,
      baseCurrency: 'EUR',
      splitMode: 'percentage',
      participantIds: ['u1', 'u2'],
      percentages: { u1: 55, u2: 45 },
    });
    expect(pct.valid).toBe(true);
    expect(pct.splits[0].amount).toBe(429);
    expect(pct.splits[1].amount).toBe(351);

    const thirds = computeExpenseSplits({
      totalAmount: 1000,
      currency: 'JPY',
      totalBaseAmount: 6.1,
      baseCurrency: 'EUR',
      splitMode: 'percentage',
      participantIds: ['u1', 'u2', 'u3'],
      percentages: { u1: 33.33, u2: 33.33, u3: 33.33 },
    });
    expect(thirds.valid).toBe(true);
    expect(thirds.splits.reduce((a, s) => a + s.amount, 0)).toBe(1000);
    expect(Number(thirds.splits.reduce((a, s) => a + s.baseAmount, 0).toFixed(2))).toBe(6.1);
  });
});

describe('computeMemberBalances e simplifyDebts', () => {
  it('semplifica una catena di debiti A->B->C in un solo pagamento A->C', () => {
    // u2 paga 50 per u1; u3 paga 50 per u2 => u1 deve 50 direttamente a u3, u2 è in pari
    const expenses: Expense[] = [
      makeExpense({
        id: 'e1',
        paidBy: 'u2',
        baseAmount: 50,
        splits: [{ userId: 'u1', amount: 50, baseAmount: 50, percentage: null }],
      }),
      makeExpense({
        id: 'e2',
        paidBy: 'u3',
        baseAmount: 50,
        splits: [{ userId: 'u2', amount: 50, baseAmount: 50, percentage: null }],
      }),
    ];

    const balances = computeMemberBalances(MEMBERS, expenses, [], 'EUR');
    const netSum = balances.reduce((a, b) => a + b.netBalance, 0);
    expect(Math.abs(netSum)).toBeLessThan(0.001);

    const transfers = simplifyDebts(balances, 'EUR');
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      fromUser: 'u1',
      toUser: 'u3',
      amount: 50,
    });

    // Dopo la registrazione del rimborso il saldo è immediatamente in pari
    const settlement: Settlement = {
      id: 's1',
      groupId: 'g1',
      fromUser: 'u1',
      toUser: 'u3',
      amount: 50,
      currency: 'EUR',
      exchangeRate: 1,
      rateDate: '2026-11-11',
      rateIsManual: false,
      baseAmount: 50,
      settlementDate: '2026-11-11',
      kind: 'settlement',
      linkedGroupName: null,
      note: 'Bonifico',
      createdBy: 'u1',
      updatedBy: 'u1',
      createdAt: '2026-11-11T10:00:00Z',
      updatedAt: '2026-11-11T10:00:00Z',
    };
    const after = computeMemberBalances(MEMBERS, expenses, [settlement], 'EUR');
    expect(simplifyDebts(after, 'EUR')).toHaveLength(0);
    expect(after.every((b) => b.netBalance === 0)).toBe(true);
  });

  it('accoppia saldi esatti opposti riducendo il numero di rimborsi tra 4 persone', () => {
    const transfers = simplifyDebts(
      [
        { userId: 'a', displayName: 'A', isActive: true, totalPaid: 0, totalShare: 0, settlementsSent: 0, settlementsReceived: 0, transfersNet: 0, netBalance: 30 },
        { userId: 'b', displayName: 'B', isActive: true, totalPaid: 0, totalShare: 0, settlementsSent: 0, settlementsReceived: 0, transfersNet: 0, netBalance: 20 },
        { userId: 'c', displayName: 'C', isActive: true, totalPaid: 0, totalShare: 0, settlementsSent: 0, settlementsReceived: 0, transfersNet: 0, netBalance: -30 },
        { userId: 'd', displayName: 'D', isActive: true, totalPaid: 0, totalShare: 0, settlementsSent: 0, settlementsReceived: 0, transfersNet: 0, netBalance: -20 },
      ],
      'EUR'
    );
    expect(transfers).toHaveLength(2);
  });
});

describe('computeGroupInsights', () => {
  it('esclude i rimborsi dai totali e filtra correttamente per intervallo di date', () => {
    const expenses: Expense[] = [
      makeExpense({
        id: 'e1',
        paidBy: 'u1',
        baseAmount: 100,
        expenseDate: '2026-11-05',
        category: 'spesa',
        categoryLabel: 'Spesa alimentare',
        splits: [
          { userId: 'u1', amount: 50, baseAmount: 50, percentage: null },
          { userId: 'u2', amount: 50, baseAmount: 50, percentage: null },
        ],
      }),
      makeExpense({
        id: 'e2',
        paidBy: 'u2',
        baseAmount: 60,
        expenseDate: '2026-11-12',
        category: 'ristoranti',
        categoryLabel: 'Ristoranti e bar',
        splits: [
          { userId: 'u1', amount: 30, baseAmount: 30, percentage: null },
          { userId: 'u2', amount: 30, baseAmount: 30, percentage: null },
        ],
      }),
      makeExpense({
        id: 'e3',
        paidBy: 'u1',
        baseAmount: 200,
        expenseDate: '2026-10-02',
        category: 'casa',
        categoryLabel: 'Casa e affitto',
        splits: [
          { userId: 'u1', amount: 100, baseAmount: 100, percentage: null },
          { userId: 'u2', amount: 100, baseAmount: 100, percentage: null },
        ],
      }),
    ];

    const settlements: Settlement[] = [
      {
        id: 's1',
        groupId: 'g1',
        fromUser: 'u2',
        toUser: 'u1',
        amount: 999,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: '2026-11-15',
        rateIsManual: false,
        baseAmount: 999,
        settlementDate: '2026-11-15',
        kind: 'settlement',
        linkedGroupName: null,
        note: '',
        createdBy: 'u2',
        updatedBy: 'u2',
        createdAt: '2026-11-15T10:00:00Z',
        updatedAt: '2026-11-15T10:00:00Z',
      },
      {
        id: 't1',
        groupId: 'g1',
        fromUser: 'u1',
        toUser: 'u2',
        amount: 34.5,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: '2026-11-16',
        rateIsManual: false,
        baseAmount: 34.5,
        settlementDate: '2026-11-16',
        kind: 'transfer_in',
        linkedGroupName: 'Fuga alle Cinque Terre',
        note: 'Saldo riportato',
        createdBy: 'u1',
        updatedBy: 'u1',
        createdAt: '2026-11-16T10:00:00Z',
        updatedAt: '2026-11-16T10:00:00Z',
      },
    ];

    const nov = computeGroupInsights(
      expenses,
      settlements,
      MEMBERS.slice(0, 2),
      [],
      'EUR',
      '2026-11-01',
      '2026-11-30'
    );

    expect(nov.totalSpent).toBe(160);
    expect(nov.expenseCount).toBe(2);
    expect(nov.averageExpense).toBe(80);
    expect(nov.excludedSettlementsCount).toBe(1);
    expect(nov.byCategory.map((c) => [c.key, c.total, c.percentage])).toEqual([
      ['spesa', 100, 62.5],
      ['ristoranti', 60, 37.5],
    ]);
    const marco = nov.byMember.find((m) => m.userId === 'u1')!;
    expect(marco.advancedTotal).toBe(100);
    expect(marco.shareTotal).toBe(80);
    expect(marco.periodDelta).toBe(20);
  });
});

describe('ricorrenze, numeri, inviti, audit e CSV', () => {
  it('gestisce correttamente la fine del mese nelle spese ricorrenti mensili', () => {
    const feb = advanceRecurringDate('2026-01-31', 'monthly', '2026-01-31');
    expect(feb).toBe('2026-02-28');
    const mar = advanceRecurringDate(feb, 'monthly', '2026-01-31');
    expect(mar).toBe('2026-03-31');

    const due = collectDueOccurrences(
      {
        active: true,
        startDate: '2026-09-01',
        nextDueDate: '2026-09-01',
        endDate: '2026-10-15',
        frequency: 'monthly',
      },
      '2026-11-18'
    );
    expect(due.occurrences).toEqual(['2026-09-01', '2026-10-01']);
    expect(due.shouldDeactivate).toBe(true);
  });

  it('interpreta importi con virgola italiana e punto decimale', () => {
    expect(parseDecimalInput('1.250,50')).toBe(1250.5);
    expect(parseDecimalInput('42,5')).toBe(42.5);
    expect(parseDecimalInput('42.50')).toBe(42.5);
    expect(parseDecimalInput('')).toBeNull();
  });

  it('estrae il token invito da URL GitHub Pages o codice diretto', () => {
    expect(
      extractInviteToken('https://sylarpower.github.io/BauSplit/?invito=abc123456789')
    ).toBe('abc123456789');
    expect(extractInviteToken('abc123456789')).toBe('abc123456789');
  });

  it('genera diff storico e file CSV con BOM UTF-8', () => {
    const exp = makeExpense({
      id: 'e1',
      description: 'Cena, pizzeria "Da Mario"',
      paidBy: 'u1',
      amount: 50,
      currency: 'GBP',
      exchangeRate: 1.18,
      baseAmount: 59,
      splits: [
        { userId: 'u1', amount: 25, baseAmount: 29.5, percentage: null },
        { userId: 'u2', amount: 25, baseAmount: 29.5, percentage: null },
      ],
    });

    const diff = buildExpenseUpdatedLog(
      exp,
      { ...exp, amount: 60, baseAmount: 70.8, paidBy: 'u2' },
      'EUR',
      (id) => (id === 'u1' ? 'Marco' : 'Giulia')
    );
    expect(diff.changes.diffs?.map((d) => d.field)).toContain('Importo e valuta');
    expect(diff.changes.diffs?.map((d) => d.field)).toContain('Pagato da');

    const csv = generateGroupCsv({
      groupName: 'Casa',
      baseCurrency: 'EUR',
      expenses: [exp],
      settlements: [],
      nameOf: (id) => (id === 'u1' ? 'Marco' : 'Giulia'),
    });
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Cena, pizzeria ""Da Mario"""');
    expect(csv).toContain('1.18');
    expect(csv).toContain('59.00');
  });
});
