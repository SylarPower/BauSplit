import { simplifyEventDebts } from './quickEvent';
import type {
  ActivityChanges,
  ActivityLog,
  CategoryOption,
  CategoryPatch,
  CreateGroupInput,
  DeletionPreview,
  RemovalPreview,
  QuickEventInput,
  QuickPersonInput,
  InviteChoice,
  Expense,
  ExpenseGroup,
  ExpenseInput,
  ExpenseSplit,
  GroupData,
  GroupMember,
  GroupOverview,
  InvitePreview,
  RecurringExpense,
  RecurringExpenseInput,
  Settlement,
  SettlementInput,
  SettlementKind,
  SimplifiedTransfer,
  UserProfile,
} from '../types';
import {
  computeExpenseSplits,
  convertTransferAmount,
  computeMemberBalances,
  convertToBaseAmount,
  simplifyDebts,
} from './accounting';
import {
  buildExpenseCreatedLog,
  buildExpenseDeletedLog,
  buildExpenseUpdatedLog,
  buildSettlementCreatedLog,
  buildSettlementDeletedLog,
  buildSettlementUpdatedLog,
  SPLIT_MODE_LABELS,
} from './audit';
import { withCurrentCategoryLabels } from './categories';
import { fetchExchangeRate, formatMoney } from './currencies';
import { formatFullDateIT, todayISO } from './dates';
import {
  advanceRecurringDate,
  collectDueOccurrences,
  FREQUENCY_LABELS,
} from './recurring';
import { supabase } from './supabase';

export interface CreatorRepository {
  previewRemoval(groupId: string, seatId: string): Promise<RemovalPreview>;
  removeParticipant(preview: RemovalPreview): Promise<void>;
  renameParticipant(groupId: string, seatId: string, name: string): Promise<void>;
  allowParticipantReturn(groupId: string, seatId: string): Promise<void>;
  previewDeletion(groupId: string): Promise<DeletionPreview>;
  deletePersonalGroup(preview: DeletionPreview): Promise<void>;
}

export interface DataRepository extends CreatorRepository {
  ensureProfile(): Promise<UserProfile>;
  updateProfileName(userId: string, displayName: string): Promise<UserProfile>;

  listGroupOverviews(currentUserId: string): Promise<GroupOverview[]>;
  createGroup(params: CreateGroupInput): Promise<ExpenseGroup>;
  createQuickEvent(input: QuickEventInput): Promise<ExpenseGroup>;
  addQuickPeople(groupId: string, people: QuickPersonInput[]): Promise<void>;
  updateGroup(params: {
    groupId: string;
    actorId: string;
    beforeName: string;
    beforeDescription: string;
    name: string;
    description: string;
  }): Promise<void>;
  leaveGroup(groupId: string): Promise<{ groupDeleted: boolean }>;
  closeGroup(params: {
    sourceGroup: ExpenseGroup;
    targetGroup: ExpenseGroup | null;
    transfers: SimplifiedTransfer[];
    exchangeRate: number;
    rateDate: string;
    rateIsManual: boolean;
    actorId: string;
    nameOf: (userId: string) => string;
  }): Promise<{ transferredCount: number }>;
  reopenGroup(groupId: string, actorId: string): Promise<void>;

  addParticipant(groupId: string, name: string): Promise<void>;
  getInvitePreview(token: string): Promise<InvitePreview>;
  acceptInvite(token: string, choice: InviteChoice): Promise<string>;
  regenerateInvite(groupId: string): Promise<string>;
  setInviteEnabled(groupId: string, enabled: boolean): Promise<boolean>;

  getGroupData(groupId: string): Promise<GroupData>;

  saveExpense(params: {
    input: ExpenseInput;
    baseCurrency: string;
    before?: Expense;
    nameOf: (userId: string) => string;
    fromRecurring?: boolean;
  }): Promise<string>;
  deleteExpense(params: {
    expense: Expense;
    baseCurrency: string;
    nameOf: (userId: string) => string;
  }): Promise<void>;

  saveSettlement(params: {
    input: SettlementInput;
    actorId: string;
    baseCurrency: string;
    before?: Settlement;
    nameOf: (userId: string) => string;
  }): Promise<string>;
  deleteSettlement(params: {
    settlement: Settlement;
    actorId: string;
    baseCurrency: string;
    nameOf: (userId: string) => string;
  }): Promise<void>;

  saveRecurring(params: {
    input: RecurringExpenseInput;
    actorId: string;
    baseCurrency: string;
    before?: RecurringExpense;
    nameOf: (userId: string) => string;
  }): Promise<string>;
  setRecurringActive(params: {
    recurring: RecurringExpense;
    active: boolean;
    nextDueDate?: string;
    actorId: string;
  }): Promise<void>;
  deleteRecurring(params: {
    recurring: RecurringExpense;
    actorId: string;
  }): Promise<void>;

  saveCategory(groupId: string, key: string | null, patch: CategoryPatch): Promise<string>;
  moveCategory(groupId: string, key: string, step: -1 | 1): Promise<void>;
  deleteCategory(groupId: string, key: string): Promise<void>;

  subscribeToGroup(groupId: string, onChange: () => void): () => void;
}

export function buildCounterpartHint(
  currentUserId: string,
  members: GroupMember[],
  expenses: Expense[],
  settlements: Settlement[],
  baseCurrency: string,
  planDebts = simplifyDebts
): { myNetBalance: number; counterpartHint: string; totalSpentBase: number } {
  const balances = computeMemberBalances(members, expenses, settlements, baseCurrency);
  const me = balances.find((b) => b.userId === currentUserId);
  const myNetBalance = me?.netBalance ?? 0;
  const totalSpentBase = expenses.reduce((acc, e) => acc + e.baseAmount, 0);

  if (Math.abs(myNetBalance) < 0.005) {
    return {
      myNetBalance: 0,
      counterpartHint: expenses.length === 0 ? 'Nessuna spesa' : 'Siete in pari',
      totalSpentBase,
    };
  }

  const transfers = planDebts(balances, baseCurrency);
  const incoming = transfers.filter((t) => t.toUser === currentUserId);
  const outgoing = transfers.filter((t) => t.fromUser === currentUserId);

  if (incoming.length === 1 && myNetBalance > 0) {
    return {
      myNetBalance,
      counterpartHint: `${incoming[0].fromName} ti deve ${formatMoney(incoming[0].amount, baseCurrency)}`,
      totalSpentBase,
    };
  }
  if (incoming.length > 1 && myNetBalance > 0) {
    return {
      myNetBalance,
      counterpartHint: `Ti devono ${formatMoney(myNetBalance, baseCurrency)}`,
      totalSpentBase,
    };
  }
  if (outgoing.length === 1 && myNetBalance < 0) {
    return {
      myNetBalance,
      counterpartHint: `Devi ${formatMoney(outgoing[0].amount, baseCurrency)} a ${outgoing[0].toName}`,
      totalSpentBase,
    };
  }
  return {
    myNetBalance,
    counterpartHint: `Devi ${formatMoney(Math.abs(myNetBalance), baseCurrency)}`,
    totalSpentBase,
  };
}

/**
 * Elabora eventuali spese ricorrenti con scadenza maturata (fino a oggi)
 * e registra automaticamente le relative spese nel gruppo.
 */
export async function processDueRecurringExpenses(params: {
  repo: Pick<DataRepository, 'saveExpense' | 'setRecurringActive'>;
  actorId: string;
  data: GroupData;
  onlyRecurringId?: string;
  forceSingleOccurrence?: boolean;
}): Promise<number> {
  const { repo, actorId, data, onlyRecurringId, forceSingleOccurrence = false } = params;
  if (data.group.closedAt !== null || data.group.quickCreatorSeat) return 0;
  const today = todayISO();
  const activeMembers = data.members.filter((m) => m.leftAt === null);
  const activeMemberIds = new Set(activeMembers.map((m) => m.userId));
  const nameMap = new Map(data.members.map((m) => [m.userId, m.displayName]));
  const nameOf = (id: string) => nameMap.get(id) ?? 'Membro';

  let generatedCount = 0;

  for (const rec of data.recurringExpenses) {
    if (onlyRecurringId && rec.id !== onlyRecurringId) continue;
    if (!forceSingleOccurrence && !rec.active) continue;

    let occurrences: string[];
    let nextDueDate: string;
    let shouldDeactivate = false;

    if (forceSingleOccurrence) {
      occurrences = [rec.nextDueDate];
      nextDueDate = advanceRecurringDate(rec.nextDueDate, rec.frequency, rec.startDate);
      if (rec.endDate && nextDueDate > rec.endDate) {
        shouldDeactivate = true;
      }
    } else {
      const due = collectDueOccurrences(rec, today);
      occurrences = due.occurrences;
      nextDueDate = due.nextDueDate;
      shouldDeactivate = due.shouldDeactivate;
    }

    if (occurrences.length === 0) {
      if (shouldDeactivate && rec.active) {
        await repo.setRecurringActive({ recurring: rec, active: false, actorId });
      }
      continue;
    }

    // Filtra eventuali date già generate in precedenza
    const existingDates = new Set(
      data.expenses
        .filter((e) => e.recurringId === rec.id && e.recurringOccurrenceDate)
        .map((e) => e.recurringOccurrenceDate as string)
    );

    const participantIds = rec.splits.map((s) => s.userId);
    if (!activeMemberIds.has(rec.paidBy) || participantIds.some((id) => !activeMemberIds.has(id))) {
      // Non addebitare agli ex membri e non redistribuire le loro quote in automatico.
      if (forceSingleOccurrence)
        throw new Error('Aggiorna pagante e quote della ricorrenza prima di registrarla.');
      continue;
    }
    if (participantIds.length === 0) continue;

    const exactAmounts: Record<string, number> = {};
    const percentages: Record<string, number> = {};
    for (const s of rec.splits) {
      if (typeof s.amount === 'number') exactAmounts[s.userId] = s.amount;
      if (typeof s.percentage === 'number') percentages[s.userId] = s.percentage;
    }

    for (const occDate of occurrences) {
      if (!existingDates.has(occDate)) {
        let rate = 1;
        let rateDate = occDate;
        let rateIsManual = false;

        if (rec.currency !== data.group.baseCurrency) {
          if (rec.fixedExchangeRate && rec.fixedExchangeRate > 0) {
            rate = rec.fixedExchangeRate;
            rateDate = occDate;
            rateIsManual = true;
          } else {
            const fx = await fetchExchangeRate(rec.currency, data.group.baseCurrency, occDate);
            rate = fx.rate;
            rateDate = fx.effectiveDate;
            rateIsManual = false;
          }
        }

        const baseAmount = convertToBaseAmount(
          rec.amount,
          rec.currency,
          rate,
          data.group.baseCurrency
        );

        const splitRes = computeExpenseSplits({
          totalAmount: rec.amount,
          currency: rec.currency,
          totalBaseAmount: baseAmount,
          baseCurrency: data.group.baseCurrency,
          splitMode: rec.splitMode,
          participantIds,
          exactAmounts,
          percentages,
        });

        if (splitRes.valid) {
          await repo.saveExpense({
            input: {
              groupId: data.group.id,
              description: rec.description,
              amount: rec.amount,
              currency: rec.currency,
              exchangeRate: rate,
              rateDate,
              rateIsManual,
              baseAmount,
              expenseDate: occDate,
              category: rec.category,
              categoryLabel: rec.categoryLabel,
              paidBy: rec.paidBy,
              splitMode: rec.splitMode,
              splits: splitRes.splits,
              note: rec.note,
              recurringId: rec.id,
              recurringOccurrenceDate: occDate,
            },
            baseCurrency: data.group.baseCurrency,
            nameOf,
            fromRecurring: true,
          });
          generatedCount += 1;
        }
      }
    }

    await repo.setRecurringActive({
      recurring: rec,
      active: shouldDeactivate ? false : rec.active,
      nextDueDate,
      actorId,
    });
  }

  return generatedCount;
}

// -----------------------------------------------------------------------------
// Implementazione Supabase (produzione)
// -----------------------------------------------------------------------------

function num(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') return Number.parseFloat(v);
  return 0;
}

function mapSettlementKind(v: unknown): SettlementKind {
  if (v === 'transfer_out' || v === 'transfer_in') return v;
  return 'settlement';
}

function mapGroup(row: Record<string, unknown>): ExpenseGroup {
  return {
    id: String(row.id),
    creatorOwnerId: row.creator_owner_id ? String(row.creator_owner_id) : undefined,
    everShared: Boolean(row.ever_shared),
    quickCreatorSeat: row.quick_creator_seat ? String(row.quick_creator_seat) : null,
    name: String(row.name ?? ''),
    description: String(row.description ?? ''),
    baseCurrency: String(row.base_currency ?? 'EUR'),
    inviteToken: String(row.invite_token ?? ''),
    inviteEnabled: Boolean(row.invite_enabled),
    closedAt: row.closed_at ? String(row.closed_at) : null,
    closedBy: row.closed_by ? String(row.closed_by) : null,
    closedIntoGroupId: row.closed_into_group_id ? String(row.closed_into_group_id) : null,
    closedIntoGroupName: row.closed_into_group_name ? String(row.closed_into_group_name) : null,
    createdBy: String(row.created_by ?? ''),
    createdAt: String(row.created_at ?? ''),
    updatedAt: String(row.updated_at ?? ''),
  };
}

const MEMBER_COLUMNS = '*, profiles!group_members_owner_id_fkey(display_name)';

type DisplayProfile = { display_name: string };
function mapMember(row: {
  user_id: string;
  owner_id: string | null;
  display_name: string | null;
  joined_at: string;
  left_at: string | null;
  removed_at?: string | null;
  profiles: DisplayProfile | DisplayProfile[] | null;
}): GroupMember {
  const profile = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
  return {
    userId: row.user_id,
    ownerId: row.owner_id,
    displayName: row.display_name ?? profile?.display_name ?? 'Membro',
    joinedAt: row.joined_at,
    leftAt: row.left_at,
    removedAt: row.removed_at ?? null,
  };
}

function quickPeoplePayload(people: QuickPersonInput[]) {
  return people.map(({ name, source }) => ({
    name: name.trim(),
    ...(source && { group_id: source.groupId, user_id: source.seatId }),
  }));
}

export class SupabaseRepository implements DataRepository {
  constructor(private readonly client = supabase) {}

  async ensureProfile(): Promise<UserProfile> {
    const { data, error } = await this.client.rpc('ensure_current_profile').single<{ id: string; email: string; display_name: string; created_at: string }>();
    if (error) throw error;
    return { id: data.id, email: data.email, displayName: data.display_name, createdAt: data.created_at };
  }

  async updateProfileName(userId: string, displayName: string): Promise<UserProfile> {
    const clean = displayName.trim().slice(0, 60);
    if (!clean) throw new Error('Inserisci un nome valido.');

    const { error } = await this.client.from('profiles').update({ display_name: clean }).eq('id', userId);
    if (error) throw error;
    await this.client.auth.updateUser({ data: { display_name: clean } }).catch(() => {});
    return this.ensureProfile();
  }

  async listGroupOverviews(currentUserId: string): Promise<GroupOverview[]> {
    const { data: groupRows, error: gErr } = await this.client
      .from('expense_groups')
      .select('*, group_members!inner(owner_id, left_at)')
      .eq('group_members.owner_id', currentUserId)
      .is('group_members.left_at', null)
      .order('updated_at', { ascending: false });
    if (gErr) throw gErr;
    if (!groupRows || groupRows.length === 0) return [];

    const groups = groupRows.map((r) => mapGroup(r as Record<string, unknown>));
    const groupIds = groups.map((g) => g.id);

    const [membersRes, expensesRes, splitsRes, settlementsRes] = await Promise.all([
      this.client
        .from('group_members')
        .select(MEMBER_COLUMNS)
        .in('group_id', groupIds),
      this.client
        .from('expenses')
        .select('id, group_id, paid_by, base_amount, amount, currency, exchange_rate, rate_date, rate_is_manual, expense_date, category, category_label, description, split_mode, note, recurring_id, recurring_occurrence_date, created_by, updated_by, created_at, updated_at')
        .in('group_id', groupIds),
      this.client
        .from('expense_splits')
        .select('expense_id, group_id, user_id, amount, base_amount, percentage')
        .in('group_id', groupIds),
      this.client
        .from('settlements')
        .select('*')
        .in('group_id', groupIds),
    ]);

    if (membersRes.error) throw membersRes.error;
    if (expensesRes.error) throw expensesRes.error;
    if (splitsRes.error) throw splitsRes.error;
    if (settlementsRes.error) throw settlementsRes.error;

    const splitsByExpense = new Map<string, ExpenseSplit[]>();
    for (const s of splitsRes.data ?? []) {
      const list = splitsByExpense.get(s.expense_id) ?? [];
      list.push({
        userId: s.user_id,
        amount: num(s.amount),
        baseAmount: num(s.base_amount),
        percentage: s.percentage === null ? null : num(s.percentage),
      });
      splitsByExpense.set(s.expense_id, list);
    }

    return groups.map((group) => {
      const allMembers: GroupMember[] = (membersRes.data ?? [])
        .filter((m) => m.group_id === group.id)
        .map(mapMember);

      const expenses: Expense[] = (expensesRes.data ?? [])
        .filter((e) => e.group_id === group.id)
        .map((e) => ({
          id: e.id,
          groupId: e.group_id,
          description: e.description,
          amount: num(e.amount),
          currency: e.currency,
          exchangeRate: num(e.exchange_rate),
          rateDate: e.rate_date,
          rateIsManual: Boolean(e.rate_is_manual),
          baseAmount: num(e.base_amount),
          expenseDate: e.expense_date,
          category: e.category,
          categoryLabel: e.category_label,
          paidBy: e.paid_by,
          splitMode: e.split_mode,
          splits: splitsByExpense.get(e.id) ?? [],
          note: e.note ?? '',
          recurringId: e.recurring_id,
          recurringOccurrenceDate: e.recurring_occurrence_date,
          createdBy: e.created_by,
          updatedBy: e.updated_by,
          createdAt: e.created_at,
          updatedAt: e.updated_at,
        }));

      const settlements: Settlement[] = (settlementsRes.data ?? [])
        .filter((st) => st.group_id === group.id)
        .map((st) => ({
          id: st.id,
          groupId: st.group_id,
          fromUser: st.from_user,
          toUser: st.to_user,
          amount: num(st.amount),
          currency: st.currency,
          exchangeRate: num(st.exchange_rate),
          rateDate: st.rate_date,
          rateIsManual: Boolean(st.rate_is_manual),
          baseAmount: num(st.base_amount),
          settlementDate: st.settlement_date,
          kind: mapSettlementKind(st.kind),
          linkedGroupName: st.linked_group_name ?? null,
          note: st.note ?? '',
          createdBy: st.created_by,
          updatedBy: st.updated_by,
          createdAt: st.created_at,
          updatedAt: st.updated_at,
        }));

      const { myNetBalance, counterpartHint, totalSpentBase } = buildCounterpartHint(
        allMembers.find((m) => m.ownerId === currentUserId && m.leftAt === null)?.userId ?? '',
        allMembers,
        expenses,
        settlements,
        group.baseCurrency,
        group.quickCreatorSeat ? simplifyEventDebts : simplifyDebts
      );

      return {
        group,
        members: allMembers.filter((m) => m.leftAt === null),
        expenseCount: expenses.length,
        totalSpentBase,
        myNetBalance,
        counterpartHint,
      };
    });
  }

  async createGroup(params: CreateGroupInput): Promise<ExpenseGroup> {
    const { data, error } = await this.client.rpc('create_expense_group', {
      p_name: params.name.trim(),
      p_description: params.description.trim(),
      p_base_currency: params.baseCurrency.toUpperCase(),
      p_participants: params.participants,
    }).single();
    if (error) throw error;
    return mapGroup(data as Record<string, unknown>);
  }

  async createQuickEvent(input: QuickEventInput): Promise<ExpenseGroup> {
    const { data, error } = await this.client.rpc('create_quick_event', {
      p_name: input.name.trim(),
      p_base_currency: input.baseCurrency,
      p_people: quickPeoplePayload(input.people),
    }).single();
    if (error) throw error;
    return mapGroup(data as Record<string, unknown>);
  }

  async addQuickPeople(groupId: string, people: QuickPersonInput[]): Promise<void> {
    const { error } = await this.client.rpc('add_quick_event_people', {
      p_event_id: groupId, p_people: quickPeoplePayload(people),
    });
    if (error) throw error;
  }

  async updateGroup(params: {
    groupId: string;
    actorId: string;
    beforeName: string;
    beforeDescription: string;
    name: string;
    description: string;
  }): Promise<void> {
    const cleanName = params.name.trim().slice(0, 80);
    const cleanDesc = params.description.trim().slice(0, 280);
    if (!cleanName) throw new Error('Il nome del gruppo non può essere vuoto.');

    const { error } = await this.client
      .from('expense_groups')
      .update({ name: cleanName, description: cleanDesc })
      .eq('id', params.groupId);
    if (error) throw error;

    const diffs = [];
    if (params.beforeName !== cleanName) {
      diffs.push({ field: 'Nome gruppo', before: params.beforeName, after: cleanName });
    }
    if (params.beforeDescription !== cleanDesc) {
      diffs.push({
        field: 'Descrizione',
        before: params.beforeDescription || '(vuota)',
        after: cleanDesc || '(vuota)',
      });
    }
    if (diffs.length > 0) {
      await this.client.from('activity_logs').insert({
        group_id: params.groupId,
        actor_id: params.actorId,
        entity_type: 'group',
        entity_id: params.groupId,
        action: 'updated',
        summary: `Ha aggiornato le impostazioni del gruppo "${cleanName}"`,
        changes: { diffs },
      });
    }
  }

  async previewRemoval(groupId: string, seatId: string): Promise<RemovalPreview> {
    const { data, error } = await this.client.rpc('creator_action_preview', {
      p_group_id: groupId,
      p_member_id: seatId,
    });
    if (error) throw error;
    return data as RemovalPreview;
  }

  async removeParticipant(preview: RemovalPreview) {
    const { error } = await this.client.rpc('remove_group_participant', {
      p_group_id: preview.groupId,
      p_member_id: preview.seatId,
      p_confirmation: preview,
    });
    if (error) throw error;
  }

  async renameParticipant(groupId: string, seatId: string, name: string) {
    const { error } = await this.client.rpc('rename_group_participant', {
      p_group_id: groupId,
      p_member_id: seatId,
      p_name: name.trim(),
    });
    if (error) throw error;
  }

  async allowParticipantReturn(groupId: string, seatId: string) {
    const { error } = await this.client.rpc('allow_participant_return', {
      p_group_id: groupId,
      p_member_id: seatId,
    });
    if (error) throw error;
  }

  async previewDeletion(groupId: string): Promise<DeletionPreview> {
    const { data, error } = await this.client.rpc('creator_action_preview', {
      p_group_id: groupId,
    });
    if (error) throw error;
    return data as DeletionPreview;
  }

  async deletePersonalGroup(preview: DeletionPreview) {
    const { error } = await this.client.rpc('delete_personal_group', {
      p_group_id: preview.groupId,
      p_confirmation: preview,
    });
    if (error) throw error;
  }

  async leaveGroup(groupId: string): Promise<{ groupDeleted: boolean }> {
    const { data, error } = await this.client.rpc('leave_group', { p_group_id: groupId });
    if (error) throw error;
    const obj = (data ?? {}) as { group_deleted?: boolean };
    return { groupDeleted: Boolean(obj.group_deleted) };
  }

  async closeGroup(params: {
    sourceGroup: ExpenseGroup;
    targetGroup: ExpenseGroup | null;
    transfers: SimplifiedTransfer[];
    exchangeRate: number;
    rateDate: string;
    rateIsManual: boolean;
    actorId: string;
    nameOf: (userId: string) => string;
  }): Promise<{ transferredCount: number }> {
    const { sourceGroup, targetGroup, transfers, exchangeRate, rateDate, rateIsManual, nameOf } =
      params;

    const fx =
      targetGroup && sourceGroup.baseCurrency !== targetGroup.baseCurrency ? Number(exchangeRate.toFixed(8)) : 1;

    const payloadTransfers = targetGroup
      ? transfers.map((tr) => ({
          from_user: tr.fromUser,
          to_user: tr.toUser,
          source_amount: tr.amount,
          target_amount: convertTransferAmount(
            tr.amount,
            sourceGroup.baseCurrency,
            fx,
            targetGroup.baseCurrency
          ),
        }))
      : [];

    const snapshot: Record<string, string> = {};
    if (targetGroup && payloadTransfers.length > 0) {
      snapshot['Gruppo di origine'] = sourceGroup.name;
      snapshot['Gruppo di destinazione'] = targetGroup.name;
      snapshot['Saldi trasferiti'] = payloadTransfers
        .map((p) => {
          const srcStr = formatMoney(p.source_amount, sourceGroup.baseCurrency);
          const dstStr =
            sourceGroup.baseCurrency === targetGroup.baseCurrency
              ? srcStr
              : `${srcStr} → ${formatMoney(p.target_amount, targetGroup.baseCurrency)}`;
          return `${nameOf(p.from_user)} deve a ${nameOf(p.to_user)}: ${dstStr}`;
        })
        .join(' · ');
    }

    const { data, error } = await this.client.rpc('close_expense_group', {
      p_source_group_id: sourceGroup.id,
      p_target_group_id: targetGroup ? targetGroup.id : null,
      p_transfers: payloadTransfers,
      p_exchange_rate: fx,
      p_rate_date: rateDate,
      p_rate_is_manual: rateIsManual,
      p_snapshot: Object.keys(snapshot).length > 0 ? { snapshot } : {},
    });
    if (error) throw error;
    const obj = (data ?? {}) as { transferred_count?: number };
    return { transferredCount: Number(obj.transferred_count ?? 0) };
  }

  async reopenGroup(groupId: string): Promise<void> {
    const { error } = await this.client.rpc('reopen_expense_group', { p_group_id: groupId });
    if (error) throw error;
  }

  async addParticipant(groupId: string, name: string): Promise<void> {
    const { error } = await this.client.rpc('add_group_participant', { p_group_id: groupId, p_name: name.trim() });
    if (error) throw error;
  }

  async getInvitePreview(token: string): Promise<InvitePreview> {
    const { data, error } = await this.client.rpc('get_invite_preview', { p_token: token });
    if (error) throw error;
    const raw = (data ?? {}) as Record<string, unknown>;
    if (!raw.valid) {
      return {
        valid: false,
        reason:
          raw.reason === 'disabled' || raw.reason === 'closed' || raw.reason === 'revoked'
            ? raw.reason
            : 'not_found',
      };
    }
    return {
      valid: true,
      groupId: String(raw.group_id),
      groupName: String(raw.group_name ?? ''),
      description: String(raw.description ?? ''),
      baseCurrency: String(raw.base_currency ?? 'EUR'),
      createdByName: String(raw.created_by_name ?? 'Un membro'),
      memberCount: Number(raw.member_count ?? 1),
      alreadyMember: Boolean(raw.already_member),
      availableNames: (raw.available_names ?? []) as { id: string; name: string }[],
      returningName: raw.returning_name ? String(raw.returning_name) : undefined,
    };
  }

  async acceptInvite(token: string, choice: InviteChoice): Promise<string> {
    const { data, error } = await this.client.rpc('accept_group_invite', {
      p_token: token,
      p_member_id: choice && 'memberId' in choice ? choice.memberId : null,
      p_name: choice && 'name' in choice ? choice.name : null,
    });
    if (error) throw error;
    return String(data);
  }

  async regenerateInvite(groupId: string): Promise<string> {
    const { data, error } = await this.client.rpc('regenerate_group_invite', {
      p_group_id: groupId,
    });
    if (error) throw error;
    return String(data);
  }

  async setInviteEnabled(groupId: string, enabled: boolean): Promise<boolean> {
    const { data, error } = await this.client.rpc('set_group_invite_enabled', {
      p_group_id: groupId,
      p_enabled: enabled,
    });
    if (error) throw error;
    return Boolean(data);
  }

  async getGroupData(groupId: string): Promise<GroupData> {
    const [
      groupRes,
      membersRes,
      catRes,
      expRes,
      splitsRes,
      settleRes,
      recRes,
      logsRes,
    ] = await Promise.all([
      this.client.from('expense_groups').select('*').eq('id', groupId).single(),
      this.client
        .from('group_members')
        .select(MEMBER_COLUMNS)
        .eq('group_id', groupId)
        .order('joined_at', { ascending: true }),
      this.client.rpc('get_group_categories', { p_group_id: groupId }),
      this.client
        .from('expenses')
        .select('*')
        .eq('group_id', groupId)
        .order('expense_date', { ascending: false })
        .order('created_at', { ascending: false }),
      this.client.from('expense_splits').select('*').eq('group_id', groupId),
      this.client
        .from('settlements')
        .select('*')
        .eq('group_id', groupId)
        .order('settlement_date', { ascending: false })
        .order('created_at', { ascending: false }),
      this.client
        .from('recurring_expenses')
        .select('*')
        .eq('group_id', groupId)
        .order('active', { ascending: false })
        .order('next_due_date', { ascending: true }),
      this.client
        .from('activity_logs')
        .select('*')
        .eq('group_id', groupId)
        .order('created_at', { ascending: false })
        .limit(300),
    ]);

    if (groupRes.error?.code === 'PGRST116')
      throw new Error('Il conto non è più disponibile o non hai più accesso.');
    if (groupRes.error) throw groupRes.error;
    if (membersRes.error) throw membersRes.error;
    if (catRes.error) throw catRes.error;
    if (expRes.error) throw expRes.error;
    if (splitsRes.error) throw splitsRes.error;
    if (settleRes.error) throw settleRes.error;
    if (recRes.error) throw recRes.error;
    if (logsRes.error) throw logsRes.error;

    const group = mapGroup(groupRes.data as Record<string, unknown>);

    const matches = group.quickCreatorSeat && !group.closedAt
      ? await this.client.rpc('get_quick_event_matches', { p_event_id: groupId })
      : null;
    if (matches?.error) throw matches.error;
    const members = (membersRes.data ?? []).map(mapMember);
    const actorNames = new Map(members.map((m) => [m.ownerId, m.displayName]));

    const categories: CategoryOption[] = catRes.data ?? [];

    const splitsByExpense = new Map<string, ExpenseSplit[]>();
    for (const s of splitsRes.data ?? []) {
      const list = splitsByExpense.get(s.expense_id) ?? [];
      list.push({
        userId: s.user_id,
        amount: num(s.amount),
        baseAmount: num(s.base_amount),
        percentage: s.percentage === null ? null : num(s.percentage),
      });
      splitsByExpense.set(s.expense_id, list);
    }

    const expenses: Expense[] = (expRes.data ?? []).map((e) => ({
      id: e.id,
      groupId: e.group_id,
      description: e.description,
      amount: num(e.amount),
      currency: e.currency,
      exchangeRate: num(e.exchange_rate),
      rateDate: e.rate_date,
      rateIsManual: Boolean(e.rate_is_manual),
      baseAmount: num(e.base_amount),
      expenseDate: e.expense_date,
      category: e.category,
      categoryLabel: e.category_label,
      paidBy: e.paid_by,
      splitMode: e.split_mode,
      splits: splitsByExpense.get(e.id) ?? [],
      note: e.note ?? '',
      recurringId: e.recurring_id,
      recurringOccurrenceDate: e.recurring_occurrence_date,
      createdBy: e.created_by,
      updatedBy: e.updated_by,
      createdAt: e.created_at,
      updatedAt: e.updated_at,
    }));

    const settlements: Settlement[] = (settleRes.data ?? []).map((st) => ({
      id: st.id,
      groupId: st.group_id,
      fromUser: st.from_user,
      toUser: st.to_user,
      amount: num(st.amount),
      currency: st.currency,
      exchangeRate: num(st.exchange_rate),
      rateDate: st.rate_date,
      rateIsManual: Boolean(st.rate_is_manual),
      baseAmount: num(st.base_amount),
      settlementDate: st.settlement_date,
      kind: mapSettlementKind(st.kind),
      linkedGroupName: st.linked_group_name ?? null,
      note: st.note ?? '',
      createdBy: st.created_by,
      updatedBy: st.updated_by,
      createdAt: st.created_at,
      updatedAt: st.updated_at,
    }));

    const recurringExpenses: RecurringExpense[] = (recRes.data ?? []).map((r) => ({
      id: r.id,
      groupId: r.group_id,
      description: r.description,
      amount: num(r.amount),
      currency: r.currency,
      fixedExchangeRate: r.fixed_exchange_rate === null ? null : num(r.fixed_exchange_rate),
      category: r.category,
      categoryLabel: r.category_label,
      paidBy: r.paid_by,
      splitMode: r.split_mode,
      splits: Array.isArray(r.splits) ? r.splits : [],
      note: r.note ?? '',
      frequency: r.frequency,
      startDate: r.start_date,
      nextDueDate: r.next_due_date,
      endDate: r.end_date,
      active: Boolean(r.active),
      createdBy: r.created_by,
      updatedBy: r.updated_by,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));

    const activityLogs: ActivityLog[] = (logsRes.data ?? []).map((l) => {
      return {
        id: l.id,
        groupId: l.group_id,
        actorId: l.actor_id,
        actorName: l.actor_name ?? actorNames.get(l.actor_id) ?? 'Membro',
        entityType: l.entity_type,
        entityId: l.entity_id,
        action: l.action,
        summary: l.summary,
        changes: (l.changes ?? {}) as ActivityChanges,
        createdAt: l.created_at,
      };
    });

    return {
      group,
      members,
      categories,
      quickMatches: (matches?.data ?? []).map((row: { peer_id: string; group_id: string; target_peer: string; can_carry: boolean }) => ({
        peerId: row.peer_id, groupId: row.group_id, seatId: row.target_peer, canCarry: row.can_carry,
      })),
      expenses: withCurrentCategoryLabels(expenses, categories),
      settlements,
      recurringExpenses: withCurrentCategoryLabels(recurringExpenses, categories),
      activityLogs,
    };
  }

  async saveExpense(params: {
    input: ExpenseInput;
    baseCurrency: string;
    before?: Expense;
    nameOf: (userId: string) => string;
    fromRecurring?: boolean;
  }): Promise<string> {
    const { input, baseCurrency, before, nameOf, fromRecurring = false } = params;
    const isEdit = Boolean(input.id && before);

    const log = isEdit && before
      ? buildExpenseUpdatedLog(before, input, baseCurrency, nameOf)
      : buildExpenseCreatedLog(input, baseCurrency, nameOf, fromRecurring);

    const splitsPayload = input.splits.map((s) => ({
      user_id: s.userId,
      amount: s.amount,
      base_amount: s.baseAmount,
      percentage: s.percentage,
    }));

    const { data, error } = await this.client.rpc('save_expense', {
      p_group_id: input.groupId,
      p_expense_id: input.id ?? null,
      p_description: input.description.trim(),
      p_amount: input.amount,
      p_currency: input.currency.toUpperCase(),
      p_exchange_rate: input.exchangeRate,
      p_rate_date: input.rateDate,
      p_rate_is_manual: input.rateIsManual,
      p_base_amount: input.baseAmount,
      p_expense_date: input.expenseDate,
      p_category: input.category,
      p_category_label: input.categoryLabel,
      p_paid_by: input.paidBy,
      p_split_mode: input.splitMode,
      p_note: input.note.trim(),
      p_splits: splitsPayload,
      p_log_action: isEdit ? 'updated' : fromRecurring ? 'generated' : 'created',
      p_log_summary: log.summary,
      p_log_changes: log.changes,
      p_recurring_id: input.recurringId ?? null,
      p_recurring_occurrence_date: input.recurringOccurrenceDate ?? null,
    });

    if (error) throw error;
    return String(data);
  }

  async deleteExpense(params: {
    expense: Expense;
    baseCurrency: string;
    nameOf: (userId: string) => string;
  }): Promise<void> {
    const log = buildExpenseDeletedLog(params.expense, params.baseCurrency, params.nameOf);
    const { error } = await this.client.rpc('delete_expense', {
      p_expense_id: params.expense.id,
      p_log_summary: log.summary,
      p_log_changes: log.changes,
    });
    if (error) throw error;
  }

  async saveSettlement(params: {
    input: SettlementInput;
    actorId: string;
    baseCurrency: string;
    before?: Settlement;
    nameOf: (userId: string) => string;
  }): Promise<string> {
    const { input, actorId, baseCurrency, before, nameOf } = params;
    if (input.fromUser === input.toUser) {
      throw new Error('Chi rimborsa e chi riceve devono essere due persone diverse.');
    }

    if (input.id && before) {
      const { data, error } = await this.client
        .from('settlements')
        .update({
          from_user: input.fromUser,
          to_user: input.toUser,
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          exchange_rate: input.exchangeRate,
          rate_date: input.rateDate,
          rate_is_manual: input.rateIsManual,
          base_amount: input.baseAmount,
          settlement_date: input.settlementDate,
          note: input.note.trim(),
          updated_by: actorId,
        })
        .eq('id', input.id)
        .eq('group_id', input.groupId)
        .select('id')
        .single();
      if (error) throw error;

      const log = buildSettlementUpdatedLog(before, input, baseCurrency, nameOf);
      await this.client.from('activity_logs').insert({
        group_id: input.groupId,
        actor_id: actorId,
        entity_type: 'settlement',
        entity_id: data.id,
        action: 'updated',
        summary: log.summary,
        changes: log.changes,
      });
      return data.id;
    }

    const { data, error } = await this.client
      .from('settlements')
      .insert({
        group_id: input.groupId,
        from_user: input.fromUser,
        to_user: input.toUser,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        exchange_rate: input.exchangeRate,
        rate_date: input.rateDate,
        rate_is_manual: input.rateIsManual,
        base_amount: input.baseAmount,
        settlement_date: input.settlementDate,
        note: input.note.trim(),
        created_by: actorId,
        updated_by: actorId,
      })
      .select('id')
      .single();
    if (error) throw error;

    const log = buildSettlementCreatedLog(input, baseCurrency, nameOf);
    await this.client.from('activity_logs').insert({
      group_id: input.groupId,
      actor_id: actorId,
      entity_type: 'settlement',
      entity_id: data.id,
      action: 'created',
      summary: log.summary,
      changes: log.changes,
    });
    return data.id;
  }

  async deleteSettlement(params: {
    settlement: Settlement;
    actorId: string;
    baseCurrency: string;
    nameOf: (userId: string) => string;
  }): Promise<void> {
    const { settlement, actorId, baseCurrency, nameOf } = params;
    const { error } = await this.client
      .from('settlements')
      .delete()
      .eq('id', settlement.id)
      .eq('group_id', settlement.groupId);
    if (error) throw error;

    const log = buildSettlementDeletedLog(settlement, baseCurrency, nameOf);
    await this.client.from('activity_logs').insert({
      group_id: settlement.groupId,
      actor_id: actorId,
      entity_type: 'settlement',
      entity_id: settlement.id,
      action: 'deleted',
      summary: log.summary,
      changes: log.changes,
    });
  }

  async saveRecurring(params: {
    input: RecurringExpenseInput;
    actorId: string;
    baseCurrency: string;
    before?: RecurringExpense;
    nameOf: (userId: string) => string;
  }): Promise<string> {
    const { input, actorId, before, nameOf } = params;
    const freqLabel = FREQUENCY_LABELS[input.frequency];
    const money = formatMoney(input.amount, input.currency);

    if (input.id && before) {
      const { data, error } = await this.client
        .from('recurring_expenses')
        .update({
          description: input.description.trim(),
          amount: input.amount,
          currency: input.currency.toUpperCase(),
          fixed_exchange_rate: input.fixedExchangeRate,
          category: input.category,
          category_label: input.categoryLabel,
          paid_by: input.paidBy,
          split_mode: input.splitMode,
          splits: input.splits,
          note: input.note.trim(),
          frequency: input.frequency,
          start_date: input.startDate,
          next_due_date: input.nextDueDate,
          end_date: input.endDate,
          active: input.active,
          updated_by: actorId,
        })
        .eq('id', input.id)
        .eq('group_id', input.groupId)
        .select('id')
        .single();
      if (error) throw error;

      const diffs = [];
      if (before.description !== input.description.trim()) {
        diffs.push({ field: 'Descrizione', before: before.description, after: input.description.trim() });
      }
      if (before.amount !== input.amount || before.currency !== input.currency) {
        diffs.push({
          field: 'Importo',
          before: formatMoney(before.amount, before.currency),
          after: money,
        });
      }
      if (before.category !== input.category) {
        diffs.push({ field: 'Categoria', before: before.categoryLabel, after: input.categoryLabel });
      }
      if (before.frequency !== input.frequency) {
        diffs.push({
          field: 'Frequenza',
          before: FREQUENCY_LABELS[before.frequency],
          after: freqLabel,
        });
      }
      if (before.nextDueDate !== input.nextDueDate) {
        diffs.push({
          field: 'Prossima scadenza',
          before: formatFullDateIT(before.nextDueDate),
          after: formatFullDateIT(input.nextDueDate),
        });
      }
      if (before.paidBy !== input.paidBy) {
        diffs.push({
          field: 'Pagato da',
          before: nameOf(before.paidBy),
          after: nameOf(input.paidBy),
        });
      }

      await this.client.from('activity_logs').insert({
        group_id: input.groupId,
        actor_id: actorId,
        entity_type: 'recurring',
        entity_id: data.id,
        action: 'updated',
        summary: `Ha modificato la spesa ricorrente "${input.description.trim()}" (${money}, ${freqLabel.toLowerCase()})`,
        changes: { diffs },
      });
      return data.id;
    }

    const { data, error } = await this.client
      .from('recurring_expenses')
      .insert({
        group_id: input.groupId,
        description: input.description.trim(),
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        fixed_exchange_rate: input.fixedExchangeRate,
        category: input.category,
        category_label: input.categoryLabel,
        paid_by: input.paidBy,
        split_mode: input.splitMode,
        splits: input.splits,
        note: input.note.trim(),
        frequency: input.frequency,
        start_date: input.startDate,
        next_due_date: input.nextDueDate,
        end_date: input.endDate,
        active: input.active,
        created_by: actorId,
        updated_by: actorId,
      })
      .select('id')
      .single();
    if (error) throw error;

    await this.client.from('activity_logs').insert({
      group_id: input.groupId,
      actor_id: actorId,
      entity_type: 'recurring',
      entity_id: data.id,
      action: 'created',
      summary: `Ha impostato la spesa ricorrente "${input.description.trim()}" (${money}, ${freqLabel.toLowerCase()})`,
      changes: {
        snapshot: {
          Importo: money,
          Categoria: input.categoryLabel,
          Frequenza: freqLabel,
          'Pagato da': nameOf(input.paidBy),
          Divisione: SPLIT_MODE_LABELS[input.splitMode],
          'Prima scadenza': formatFullDateIT(input.nextDueDate),
        },
      },
    });
    return data.id;
  }

  async setRecurringActive(params: {
    recurring: RecurringExpense;
    active: boolean;
    nextDueDate?: string;
    actorId: string;
  }): Promise<void> {
    const { recurring, active, nextDueDate, actorId } = params;
    const patch: Record<string, unknown> = {
      active,
      updated_by: actorId,
    };
    if (nextDueDate) patch.next_due_date = nextDueDate;

    const { error } = await this.client
      .from('recurring_expenses')
      .update(patch)
      .eq('id', recurring.id)
      .eq('group_id', recurring.groupId);
    if (error) throw error;

    // Registra nello storico solo quando l'utente mette in pausa o riattiva esplicitamente
    if (!nextDueDate && recurring.active !== active) {
      await this.client.from('activity_logs').insert({
        group_id: recurring.groupId,
        actor_id: actorId,
        entity_type: 'recurring',
        entity_id: recurring.id,
        action: active ? 'resumed' : 'paused',
        summary: active
          ? `Ha riattivato la spesa ricorrente "${recurring.description}"`
          : `Ha messo in pausa la spesa ricorrente "${recurring.description}"`,
        changes: {},
      });
    }
  }

  async deleteRecurring(params: {
    recurring: RecurringExpense;
    actorId: string;
  }): Promise<void> {
    const { recurring, actorId } = params;
    const { error } = await this.client
      .from('recurring_expenses')
      .delete()
      .eq('id', recurring.id)
      .eq('group_id', recurring.groupId);
    if (error) throw error;

    await this.client.from('activity_logs').insert({
      group_id: recurring.groupId,
      actor_id: actorId,
      entity_type: 'recurring',
      entity_id: recurring.id,
      action: 'deleted',
      summary: `Ha rimosso la spesa ricorrente "${recurring.description}"`,
      changes: {
        snapshot: {
          Descrizione: recurring.description,
          Importo: formatMoney(recurring.amount, recurring.currency),
          Frequenza: FREQUENCY_LABELS[recurring.frequency],
        },
      },
    });
  }

  async saveCategory(groupId: string, key: string | null, patch: CategoryPatch): Promise<string> {
    const { data, error } = await this.client.rpc('save_group_category', {
      p_group_id: groupId,
      p_key: key,
      p_name: patch.name,
      p_icon: patch.icon,
      p_color: patch.color,
      p_hidden: patch.hidden,
    });
    if (error) throw error;
    return data;
  }

  async moveCategory(groupId: string, key: string, step: -1 | 1): Promise<void> {
    const { error } = await this.client.rpc('move_group_category', {
      p_group_id: groupId, p_key: key, p_step: step,
    });
    if (error) throw error;
  }

  async deleteCategory(groupId: string, key: string): Promise<void> {
    const { error } = await this.client.rpc('delete_group_category', { p_group_id: groupId, p_key: key });
    if (error) throw error;
  }

  subscribeToGroup(groupId: string, onChange: () => void): () => void {
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const trigger = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => onChange(), 250);
    };

    const channel = this.client
      .channel(`group_${groupId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expenses', filter: `group_id=eq.${groupId}` },
        trigger
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'settlements', filter: `group_id=eq.${groupId}` },
        trigger
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'recurring_expenses', filter: `group_id=eq.${groupId}` },
        trigger
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_members', filter: `group_id=eq.${groupId}` },
        trigger
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_categories', filter: `group_id=eq.${groupId}` },
        trigger
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'expense_groups', filter: `id=eq.${groupId}` },
        trigger
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs', filter: `group_id=eq.${groupId}` }, trigger)
      .subscribe();

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      this.client.removeChannel(channel);
    };
  }
}
