import type { Expense, ExpenseGroup, GroupMember } from '../../src/types';

export const member = (
  userId: string,
  displayName: string,
  ownerId: string | null
): GroupMember => ({
  userId,
  displayName,
  ownerId,
  joinedAt: '2026-01-01',
  leftAt: null,
});
export const group = (
  id: string,
  name: string,
  quickCreatorSeat: string | null = null
): ExpenseGroup => ({
  id,
  name,
  quickCreatorSeat,
  description: '',
  baseCurrency: 'EUR',
  createdBy: 'a',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  inviteToken: 'segreto',
  inviteEnabled: true,
  closedAt: null,
  closedBy: null,
  closedIntoGroupId: null,
  closedIntoGroupName: null,
});
export const expense = (
  description: string,
  amount: number,
  paidBy: string,
  ids: string[]
): Expense => ({
  id: description,
  groupId: 'ev',
  description,
  amount,
  baseAmount: amount,
  currency: 'EUR',
  exchangeRate: 1,
  rateDate: '2026-11-18',
  rateIsManual: false,
  expenseDate: '2026-11-18',
  category: 'altro',
  categoryLabel: 'Altro',
  paidBy,
  splitMode: 'equal',
  splits: ids.map((userId) => ({
    userId,
    amount: amount / ids.length,
    baseAmount: amount / ids.length,
    percentage: null,
  })),
  note: 'nota privata',
  recurringId: null,
  recurringOccurrenceDate: null,
  createdBy: 'a',
  updatedBy: 'a',
  createdAt: '2026-11-18',
  updatedAt: '2026-11-18',
});
