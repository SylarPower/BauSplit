export type SplitMode = 'equal' | 'exact' | 'percentage';

export type RecurringFrequency =
  | 'weekly'
  | 'biweekly'
  | 'monthly'
  | 'bimonthly'
  | 'quarterly'
  | 'yearly';

export type ActivityEntityType =
  | 'expense'
  | 'settlement'
  | 'recurring'
  | 'group'
  | 'member'
  | 'invite'
  | 'category';

export type ActivityAction =
  | 'created'
  | 'updated'
  | 'deleted'
  | 'joined'
  | 'left'
  | 'regenerated'
  | 'enabled'
  | 'disabled'
  | 'paused'
  | 'resumed'
  | 'generated'
  | 'closed'
  | 'reopened'
  | 'transferred_in';

export type SettlementKind = 'settlement' | 'transfer_out' | 'transfer_in';

export interface UserProfile {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export type GroupRole = 'editor' | 'viewer';

export interface GroupInvite {
  role: GroupRole;
  token: string;
  enabled: boolean;
}

export interface GroupMember {
  accessRole: GroupRole; // permesso di accesso, non cambia pagante, quote o saldo
  userId: string; // posto stabile nei conti del gruppo
  ownerId: string | null; // accesso ospite/account; null = nessun accesso
  displayName: string;
  joinedAt: string;
  leftAt: string | null;
  removedAt?: string | null; // rimozione del creatore, distinta dall’uscita volontaria
}

export interface ExpenseGroup {
  creatorOwnerId?: string; // assente con lo schema precedente; non usare il nome o createdBy come ripiego
  everShared?: boolean;
  quickCreatorSeat: string | null; // null = gruppo ordinario
  id: string;
  name: string;
  description: string;
  baseCurrency: string;
  closedAt: string | null;
  closedBy: string | null;
  closedIntoGroupId: string | null;
  closedIntoGroupName: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryOption {
  key: string; // es. 'spesa' oppure 'custom:<uuid>'
  name: string;
  icon: string;
  color: string;
  hidden: boolean;
}

export type CategoryStyle = Pick<CategoryOption, 'name' | 'icon' | 'color'>;
export type CategoryPatch = Partial<CategoryStyle & { hidden: boolean }>;

export interface ExpenseSplit {
  userId: string;
  amount: number; // nella valuta originale della spesa
  baseAmount: number; // nella valuta di riferimento del gruppo (congelato)
  percentage: number | null;
}

export interface Expense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number; // 1 unità di currency = exchangeRate unità di baseCurrency
  rateDate: string; // YYYY-MM-DD
  rateIsManual: boolean;
  baseAmount: number; // importo congelato in baseCurrency
  expenseDate: string; // YYYY-MM-DD
  category: string;
  categoryLabel: string;
  paidBy: string;
  splitMode: SplitMode;
  splits: ExpenseSplit[];
  note: string;
  recurringId: string | null;
  recurringOccurrenceDate: string | null;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settlement {
  id: string;
  groupId: string;
  fromUser: string; // chi paga il rimborso (per transfer_in: il creditore; per transfer_out: il debitore)
  toUser: string; // chi riceve il rimborso (per transfer_in: il debitore; per transfer_out: il creditore)
  amount: number;
  currency: string;
  exchangeRate: number;
  rateDate: string;
  rateIsManual: boolean;
  baseAmount: number;
  settlementDate: string; // YYYY-MM-DD
  kind: SettlementKind;
  linkedGroupName: string | null;
  note: string;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface RecurringSplitTemplate {
  userId: string;
  amount?: number; // usato quando splitMode === 'exact'
  percentage?: number; // usato quando splitMode === 'percentage'
}

export interface RecurringExpense {
  id: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  fixedExchangeRate: number | null;
  category: string;
  categoryLabel: string;
  paidBy: string;
  splitMode: SplitMode;
  splits: RecurringSplitTemplate[];
  note: string;
  frequency: RecurringFrequency;
  startDate: string;
  nextDueDate: string;
  endDate: string | null;
  active: boolean;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FieldChange {
  field: string;
  before: string;
  after: string;
}

export interface ActivityChanges {
  diffs?: FieldChange[];
  snapshot?: Record<string, string>;
  [key: string]: unknown;
}

export interface ActivityLog {
  id: string;
  groupId: string;
  actorId: string;
  actorName: string;
  entityType: ActivityEntityType;
  entityId: string | null;
  action: ActivityAction;
  summary: string;
  changes: ActivityChanges;
  createdAt: string;
}

export interface GroupOverview {
  group: ExpenseGroup;
  members: GroupMember[]; // membri attivi
  expenseCount: number;
  totalSpentBase: number;
  myNetBalance: number; // in baseCurrency: >0 mi devono, <0 devo
  counterpartHint: string; // es. "Giulia ti deve 42,50 €" o "In pari"
}

export interface QuickPersonInput {
  name: string;
  source?: { groupId: string; seatId: string }; // solo se scelto dai propri gruppi
}
export interface QuickEventInput {
  name: string;
  baseCurrency: string;
  people: QuickPersonInput[];
}
/** Corrispondenza fra un posto della serata e uno dei gruppi condivisi del creatore. */
export interface QuickEventMatch {
  peerId: string;
  groupId: string;
  seatId: string;
  canCarry: boolean;
}

export interface GroupData {
  quickMatches?: QuickEventMatch[];
  actorLinks?: Record<string, string>; // guestId -> accountId verificato da account_links
  group: ExpenseGroup;
  members: GroupMember[]; // tutti i membri (attivi e usciti per risolvere i nomi storici)
  categories: CategoryOption[]; // catalogo del gruppo, incluse quelle nascoste
  expenses: Expense[];
  settlements: Settlement[];
  recurringExpenses: RecurringExpense[];
  activityLogs: ActivityLog[];
}

export interface InvitePreview {
  inviteRole?: GroupRole; // tipo del link, anche se chi lo apre è già membro
  accessRole?: GroupRole; // permesso effettivo dopo l’accettazione
  valid: boolean;
  reason?: 'not_found' | 'disabled' | 'closed' | 'revoked';
  groupId?: string;
  groupName?: string;
  description?: string;
  baseCurrency?: string;
  createdByName?: string;
  memberCount?: number;
  alreadyMember?: boolean;
  availableNames?: { id: string; name: string }[];
  returningName?: string;
}

/** Anteprime restituite dal DB e ripresentate senza modifiche alla conferma. */
export interface RemovalPreview {
  groupId: string;
  seatId: string;
  ownerId: string | null;
  name: string;
  mode: 'delete' | 'retire' | 'revoke';
  balance: number;
  pauseCount: number;
}
export interface DeletionPreview {
  groupId: string;
  name: string;
  people: number;
  expenses: number;
  refunds: number;
  recurring: number;
  activities: number;
}

export interface CreateGroupInput {
  name: string;
  description: string;
  baseCurrency: string;
  participants: string[];
}

export type InviteChoice = { memberId: string } | { name: string } | null;

export interface ExpenseInput {
  id?: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  rateDate: string;
  rateIsManual: boolean;
  baseAmount: number;
  expenseDate: string;
  category: string;
  categoryLabel: string;
  paidBy: string;
  splitMode: SplitMode;
  splits: ExpenseSplit[];
  note: string;
  recurringId?: string | null;
  recurringOccurrenceDate?: string | null;
}

export interface SettlementInput {
  id?: string;
  groupId: string;
  fromUser: string;
  toUser: string;
  amount: number;
  currency: string;
  exchangeRate: number;
  rateDate: string;
  rateIsManual: boolean;
  baseAmount: number;
  settlementDate: string;
  note: string;
}

export interface RecurringExpenseInput {
  id?: string;
  groupId: string;
  description: string;
  amount: number;
  currency: string;
  fixedExchangeRate: number | null;
  category: string;
  categoryLabel: string;
  paidBy: string;
  splitMode: SplitMode;
  splits: RecurringSplitTemplate[];
  note: string;
  frequency: RecurringFrequency;
  startDate: string;
  nextDueDate: string;
  endDate: string | null;
  active: boolean;
}

export interface MemberBalance {
  userId: string;
  displayName: string;
  isActive: boolean;
  totalPaid: number; // spese anticipate (baseCurrency)
  totalShare: number; // quota di competenza sulle spese (baseCurrency)
  settlementsSent: number; // rimborsi effettuati (baseCurrency)
  settlementsReceived: number; // rimborsi ricevuti (baseCurrency)
  transfersNet: number; // saldo netto da trasferimenti tra gruppi (baseCurrency)
  netBalance: number; // >0 a credito, <0 a debito (baseCurrency)
}

export interface SimplifiedTransfer {
  fromUser: string;
  fromName: string;
  toUser: string;
  toName: string;
  amount: number; // in baseCurrency
}

export interface CategoryInsight {
  key: string;
  label: string;
  icon: string;
  color: string;
  total: number;
  count: number;
  percentage: number;
}

export interface MemberInsight {
  userId: string;
  displayName: string;
  advancedTotal: number; // quanto ha anticipato (pagato)
  advancedCount: number;
  advancedPercentage: number;
  shareTotal: number; // quanto gli compete effettivamente
  shareCount: number;
  sharePercentage: number;
  periodDelta: number; // advancedTotal - shareTotal (solo sulle spese del periodo)
}

export interface MonthlyInsight {
  monthKey: string; // YYYY-MM
  label: string; // es. "Nov 2026"
  total: number;
  count: number;
}

export interface GroupInsights {
  totalSpent: number;
  expenseCount: number;
  averageExpense: number;
  dailyAverage: number | null;
  byCategory: CategoryInsight[];
  byMember: MemberInsight[];
  byMonth: MonthlyInsight[];
  excludedSettlementsCount: number;
}

export type ExpenseListFilterType = 'all' | 'expenses' | 'settlements';

export type DateRangePreset =
  | 'all'
  | 'this_week'
  | 'this_month'
  | 'last_month'
  | 'this_year'
  | 'last_year'
  | 'custom';

export type CompareDatePreset = 'auto' | Exclude<DateRangePreset, 'all'>;

export interface ComparisonDelta {
  diff: number;
  percentage: number | null; // null quando il periodo di confronto è 0 e quello attuale > 0
  kind: 'up' | 'down' | 'equal' | 'new';
}

export interface CategoryComparisonItem {
  key: string;
  label: string;
  icon: string;
  color: string;
  totalA: number;
  countA: number;
  percentageA: number;
  totalB: number;
  countB: number;
  percentageB: number;
  delta: ComparisonDelta;
}

export interface ExpenseFilters {
  search: string;
  type: ExpenseListFilterType;
  category: string; // 'all' o category key
  paidBy: string; // 'all' o userId
  participant: string; // 'all' o userId
  currency: string; // 'all' o currency code
  datePreset: DateRangePreset;
  dateFrom: string; // '' o YYYY-MM-DD
  dateTo: string; // '' o YYYY-MM-DD
}
