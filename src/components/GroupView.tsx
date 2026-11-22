import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ArrowLeftRight,
  BarChart3,
  History,
  Info,
  Eye,
  Plus,
  Receipt,
  Repeat,
  Scale,
  Settings,
  UserPlus,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  computeMemberBalances,
  roundCurrency,
  simplifyDebts,
} from '../lib/accounting';
import {
  fetchExchangeRate,
  formatMoney,
  type ExchangeRateResult,
} from '../lib/currencies';
import type { DataRepository } from '../lib/repository';
import { groupRoleFor } from '../lib/groupAccess';
import { processDueRecurringExpenses } from '../lib/repository';
import { advanceRecurringDate } from '../lib/recurring';
import { formatFullDateIT, todayISO } from '../lib/dates';
import type {
  CategoryPatch,
  DateRangePreset,
  Expense,
  ExpenseFilters,
  ExpenseGroup,
  ExpenseInput,
  GroupData,
  GroupOverview,
  RecurringExpense,
  RecurringExpenseInput,
  Settlement,
  SettlementInput,
  SimplifiedTransfer,
} from '../types';
import { BalancesTab } from './BalancesTab';
import { quickSummary, simplifyEventDebts } from '../lib/quickEvent';
import { CopyEventSummary } from './CopyEventSummary';
import { QuickEventForm } from './QuickEventForm';
import { ExpenseFormModal } from './ExpenseFormModal';
import { DEFAULT_EXPENSE_FILTERS, ExpensesTab } from './ExpensesTab';
import { GroupSettingsModal } from './GroupSettingsModal';
import { HistoryTab } from './HistoryTab';
import { Avatar } from './Icon';
import { InsightsTab } from './InsightsTab';
import { InviteModal } from './InviteModal';
import { RecurringTab } from './RecurringTab';
import { SettlementFormModal } from './SettlementFormModal';

type GroupTab = 'expenses' | 'balances' | 'insights' | 'recurring' | 'history';

interface GroupViewProps {
  repo: DataRepository;
  data: GroupData;
  allGroups: GroupOverview[];
  actorId: string;
  currentUserId: string; // posto del partecipante in questo gruppo
  onBack: () => void;
  onNavigateGroup: (groupId: string) => void;
  onRefreshGroup: () => Promise<void>;
  onGroupLeft: (groupDeleted: boolean) => void;
  onToast: (msg: string, isError?: boolean) => void;
}

const DISPLAY_CURRENCY_PREFIX = 'bausplit_display_currency_';

export function GroupView({
  repo,
  data,
  allGroups,
  actorId,
  currentUserId,
  onBack,
  onNavigateGroup,
  onRefreshGroup,
  onGroupLeft,
  onToast,
}: GroupViewProps) {
  const { group, members, categories, expenses, settlements, recurringExpenses, activityLogs } =
    data;
  const isClosed = group.closedAt !== null;
  const isEditor = groupRoleFor(members, actorId) === 'editor';
  const canEdit = isEditor && !isClosed;
  const writableGroups = useMemo(
    () => allGroups.filter((g) => groupRoleFor(g.members, actorId) === 'editor'),
    [allGroups, actorId]
  );
  const isEvent = !!group.quickCreatorSeat;
  const [addingPeople, setAddingPeople] = useState(false);

  const [tab, setTab] = useState<GroupTab>('expenses');
  const [filters, setFilters] = useState<ExpenseFilters>({ ...DEFAULT_EXPENSE_FILTERS });

  // Modali
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [settlementModalOpen, setSettlementModalOpen] = useState(false);
  const [editingSettlement, setEditingSettlement] = useState<Settlement | null>(null);
  const [prefillTransfer, setPrefillTransfer] = useState<SimplifiedTransfer | null>(null);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsFocusClose, setSettingsFocusClose] = useState(false);

  // Valuta di visualizzazione dei saldi (preferenza locale, non altera la contabilità)
  const [displayCurrency, setDisplayCurrency] = useState<string>(() => {
    try {
      return localStorage.getItem(`${DISPLAY_CURRENCY_PREFIX}${group.id}`) || group.baseCurrency;
    } catch {
      return group.baseCurrency;
    }
  });
  const [displayRate, setDisplayRate] = useState<ExchangeRateResult | null>(null);
  const [loadingDisplayRate, setLoadingDisplayRate] = useState(false);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(`${DISPLAY_CURRENCY_PREFIX}${group.id}`);
      setDisplayCurrency(saved || group.baseCurrency);
    } catch {
      setDisplayCurrency(group.baseCurrency);
    }
    setFilters({ ...DEFAULT_EXPENSE_FILTERS });
  }, [group.id, group.baseCurrency]);

  useEffect(() => {
    try {
      if (displayCurrency === group.baseCurrency) {
        localStorage.removeItem(`${DISPLAY_CURRENCY_PREFIX}${group.id}`);
      } else {
        localStorage.setItem(`${DISPLAY_CURRENCY_PREFIX}${group.id}`, displayCurrency);
      }
    } catch {
      // ignore
    }

    if (displayCurrency === group.baseCurrency) {
      setDisplayRate(null);
      setLoadingDisplayRate(false);
      return;
    }

    let cancelled = false;
    setLoadingDisplayRate(true);
    fetchExchangeRate(group.baseCurrency, displayCurrency)
      .then((res) => {
        if (!cancelled) setDisplayRate(res);
      })
      .finally(() => {
        if (!cancelled) setLoadingDisplayRate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [displayCurrency, group.baseCurrency, group.id]);

  const activeMembers = useMemo(
    () => members.filter((m) => m.leftAt === null),
    [members]
  );

  const nameMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName])),
    [members]
  );
  const nameOf = (userId: string) => nameMap.get(userId) ?? 'Membro';

  const balances = useMemo(
    () => computeMemberBalances(members, expenses, settlements, group.baseCurrency),
    [members, expenses, settlements, group.baseCurrency]
  );

  const transfers = useMemo(
    () => (isEvent ? simplifyEventDebts : simplifyDebts)(balances, group.baseCurrency),
    [balances, group.baseCurrency, isEvent]
  );

  const myBalance = balances.find((b) => b.userId === currentUserId)?.netBalance ?? 0;
  const myPrimaryTransfer = useMemo(
    () =>
      transfers.find((t) => t.fromUser === currentUserId) ??
      transfers.find((t) => t.toUser === currentUserId) ??
      null,
    [transfers, currentUserId]
  );

  const isConvertedDisplay =
    displayCurrency !== group.baseCurrency && displayRate !== null && displayRate.rate > 0;

  const formatBalanceSummary = (baseVal: number, signed = false) => {
    if (isConvertedDisplay && displayRate) {
      return formatMoney(roundCurrency(baseVal * displayRate.rate, displayCurrency), displayCurrency, {
        signed,
      });
    }
    return formatMoney(baseVal, group.baseCurrency, { signed });
  };

  // Azioni repository
  const handleSaveExpense = async (input: ExpenseInput, before?: Expense) => {
    await repo.saveExpense({
      input,
      baseCurrency: group.baseCurrency,
      before,
      nameOf,
    });
    await onRefreshGroup();
    onToast(before ? 'Spesa aggiornata' : 'Spesa aggiunta');
  };

  const handleCreateRecurringWithFirst = async (params: {
    recurring: RecurringExpenseInput;
    firstExpense?: ExpenseInput;
  }) => {
    const recId = await repo.saveRecurring({
      input: params.recurring,
      actorId,
      baseCurrency: group.baseCurrency,
      nameOf,
    });
    if (params.firstExpense) {
      await repo.saveExpense({
        input: {
          ...params.firstExpense,
          recurringId: recId,
          recurringOccurrenceDate: params.firstExpense.expenseDate,
        },
        baseCurrency: group.baseCurrency,
        nameOf,
        fromRecurring: true,
      });
    }
    await onRefreshGroup();
    onToast(
      params.firstExpense
        ? 'Spesa registrata e ricorrenza attivata'
        : 'Spesa ricorrente programmata'
    );
  };

  const handleDeleteExpense = async (exp: Expense) => {
    await repo.deleteExpense({
      expense: exp,
      baseCurrency: group.baseCurrency,
      nameOf,
    });
    await onRefreshGroup();
    onToast('Spesa eliminata');
  };

  const handleSaveSettlement = async (input: SettlementInput, before?: Settlement) => {
    await repo.saveSettlement({
      input,
      actorId,
      baseCurrency: group.baseCurrency,
      before,
      nameOf,
    });
    await onRefreshGroup();
    onToast(before ? 'Rimborso aggiornato' : 'Rimborso registrato');
  };

  const handleDeleteSettlement = async (st: Settlement) => {
    await repo.deleteSettlement({
      settlement: st,
      actorId,
      baseCurrency: group.baseCurrency,
      nameOf,
    });
    await onRefreshGroup();
    onToast('Rimborso eliminato');
  };

  const handleSaveRecurring = async (input: RecurringExpenseInput, before?: RecurringExpense) => {
    await repo.saveRecurring({
      input,
      actorId,
      baseCurrency: group.baseCurrency,
      before,
      nameOf,
    });
    const fresh = await repo.getGroupData(group.id);
    await processDueRecurringExpenses({ repo, actorId, data: fresh });
    await onRefreshGroup();
    onToast(before ? 'Ricorrenza aggiornata' : 'Spesa ricorrente creata');
  };

  const handleToggleRecurring = async (rec: RecurringExpense, active: boolean) => {
    let nextDue: string | undefined;
    if (active) {
      const today = todayISO();
      let cursor = rec.nextDueDate;
      let guard = 0;
      while (cursor < today && guard < 120) {
        cursor = advanceRecurringDate(cursor, rec.frequency, rec.startDate);
        guard += 1;
      }
      if (cursor !== rec.nextDueDate) nextDue = cursor;
    }
    await repo.setRecurringActive({
      recurring: rec,
      active,
      nextDueDate: nextDue,
      actorId,
    });
    await onRefreshGroup();
    onToast(active ? 'Ricorrenza riattivata' : 'Ricorrenza messa in pausa');
  };

  const handleRunRecurringNow = async (rec: RecurringExpense) => {
    const count = await processDueRecurringExpenses({
      repo,
      actorId,
      data,
      onlyRecurringId: rec.id,
      forceSingleOccurrence: true,
    });
    await onRefreshGroup();
    onToast(
      count > 0
        ? `Spesa "${rec.description}" registrata`
        : 'Questa scadenza era già stata registrata'
    );
  };

  const handleDeleteRecurring = async (rec: RecurringExpense) => {
    await repo.deleteRecurring({ recurring: rec, actorId });
    await onRefreshGroup();
    onToast('Spesa ricorrente rimossa');
  };

  const handleSaveCategory = async (key: string | null, patch: CategoryPatch) => {
    const savedKey = await repo.saveCategory(group.id, key, patch);
    await onRefreshGroup();
    return savedKey;
  };

  const handleUpdateGroup = async (name: string, description: string) => {
    await repo.updateGroup({
      groupId: group.id,
      actorId,
      beforeName: group.name,
      beforeDescription: group.description,
      name,
      description,
    });
    await onRefreshGroup();
  };

  const handleCloseGroup = async (params: {
    targetGroup: ExpenseGroup | null;
    exchangeRate: number;
    rateDate: string;
    rateIsManual: boolean;
  }) => {
    await repo.closeGroup({
      sourceGroup: group,
      targetGroup: params.targetGroup,
      transfers,
      exchangeRate: params.exchangeRate,
      rateDate: params.rateDate,
      rateIsManual: params.rateIsManual,
      actorId,
      nameOf,
    });
    await onRefreshGroup();
    const message = isEvent ? 'Serata archiviata' : 'Gruppo chiuso';
    onToast(params.targetGroup ? `${message}: saldo spostato in "${params.targetGroup.name}"` : message);
  };

  const handleReopenGroup = async () => {
    await repo.reopenGroup(group.id, actorId);
    await onRefreshGroup();
    onToast(isEvent ? 'Serata riaperta' : 'Gruppo riaperto');
  };

  const handleLeaveGroup = async () => {
    const res = await repo.leaveGroup(group.id);
    onGroupLeft(res.groupDeleted);
  };

  const openNewExpense = () => {
    setEditingExpense(null);
    setExpenseModalOpen(true);
  };

  const openSettleTransfer = (tr: SimplifiedTransfer) => {
    setEditingSettlement(null);
    setPrefillTransfer(tr);
    setSettlementModalOpen(true);
  };

  const handleFilterFromInsights = (
    categoryKey: string,
    preset: DateRangePreset,
    from: string,
    to: string
  ) => {
    setFilters({
      ...DEFAULT_EXPENSE_FILTERS,
      type: 'expenses',
      category: categoryKey,
      datePreset: preset,
      dateFrom: from,
      dateTo: to,
    });
    setTab('expenses');
  };

  const activeRecurringCount = recurringExpenses.filter((r) => r.active).length;

  // Testo sintetico del banner saldo in alto
  const balanceHeadline = useMemo(() => {
    if (Math.abs(myBalance) < 0.005) {
      if (transfers.length === 0) {
        return {
          title: 'Siete in pari',
          sub:
            expenses.length === 0
              ? 'Nessuna spesa registrata finora'
              : `Tutti i conti in ${group.baseCurrency} sono saldati`,
          tone: 'neutral' as const,
        };
      }
      return {
        title: 'Tu sei in pari',
        sub: `Resta ${transfers.length === 1 ? '1 rimborso' : `${transfers.length} rimborsi`} tra gli altri membri`,
        tone: 'neutral' as const,
      };
    }

    if (myBalance > 0) {
      const single =
        transfers.filter((t) => t.toUser === currentUserId).length === 1
          ? transfers.find((t) => t.toUser === currentUserId)
          : null;
      return {
        title: single
          ? `${single.fromName} ti deve ${formatBalanceSummary(single.amount)}`
          : `Ti devono ${formatBalanceSummary(myBalance)}`,
        sub: isConvertedDisplay
          ? `Contabilità gruppo: ${formatMoney(myBalance, group.baseCurrency, { signed: true })}`
          : 'Saldo semplificato aggiornato',
        tone: 'positive' as const,
      };
    }

    const singleOut =
      transfers.filter((t) => t.fromUser === currentUserId).length === 1
        ? transfers.find((t) => t.fromUser === currentUserId)
        : null;
    return {
      title: singleOut
        ? `Devi ${formatBalanceSummary(singleOut.amount)} a ${singleOut.toName}`
        : `Devi ${formatBalanceSummary(Math.abs(myBalance))}`,
      sub: isConvertedDisplay
        ? `Contabilità gruppo: ${formatMoney(myBalance, group.baseCurrency, { signed: true })}`
        : 'Saldo semplificato aggiornato',
      tone: 'negative' as const,
    };
  }, [
    myBalance,
    transfers,
    expenses.length,
    group.baseCurrency,
    currentUserId,
    isConvertedDisplay,
    displayCurrency,
    displayRate,
  ]);

  const tabItems: { id: GroupTab; label: string; icon: typeof Receipt; count?: number }[] = [
    { id: 'expenses', label: 'Spese', icon: Receipt },
    { id: 'balances', label: 'Saldi', icon: Scale },
    { id: 'insights', label: 'Insights', icon: BarChart3 },
    {
      id: 'recurring',
      label: 'Ricorrenti',
      icon: Repeat,
      count: activeRecurringCount > 0 ? activeRecurringCount : undefined,
    },
    { id: 'history', label: 'Storico', icon: History },
  ];

  const visibleTabs = tabItems.filter((item) => !isEvent || item.id !== 'recurring');
  return (
    <>
      <div className="container with-mobile-nav">
        {/* Intestazione gruppo */}
        <header className="group-header">
          <div className="group-header-top">
            <button type="button" className="back-btn" onClick={onBack}>
              <ArrowLeft size={16} />I tuoi gruppi
            </button>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus size={14} />
                  Invita
                </button>
              )}
              <button
                type="button"
                className="btn-icon"
                onClick={() => {
                  setSettingsFocusClose(false);
                  setSettingsOpen(true);
                }}
                aria-label={isEditor ? 'Impostazioni del gruppo' : 'Dettagli del gruppo'}
                title={isEditor ? 'Impostazioni del gruppo' : 'Dettagli del gruppo'}
              >
                {isEditor ? <Settings size={18} /> : <Info size={18} />}
              </button>
            </div>
          </div>

          <div className="group-title-row">
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                <h1 className="page-title">{group.name}</h1>
                <span className="badge">{group.baseCurrency}</span>
                {!isEditor && <span className="badge"><Eye size={13} /> Solo visualizzazione</span>}
                {isEvent && <span className="badge badge-accent">Serata</span>}
                {isClosed && <span className="badge badge-warning">{isEvent ? 'Archiviata' : 'Gruppo chiuso'}</span>}
              </div>
              {group.description && (
                <p className="page-subtitle" style={{ marginTop: 3 }}>
                  {group.description}
                </p>
              )}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 8,
                  fontSize: 13,
                  color: 'var(--text-secondary)',
                }}
              >
                <span className="avatar-stack">
                  {activeMembers.slice(0, 6).map((m) => (
                    <Avatar key={m.userId} name={m.displayName} seed={m.userId} size={24} />
                  ))}
                </span>
                <span>{activeMembers.map((m) => m.displayName).join(', ')}</span>
                {canEdit && !isEvent && activeMembers.length === 1 && (
                  <button
                    type="button"
                    className="link-btn"
                    style={{ fontSize: 12.5 }}
                    onClick={() => setInviteOpen(true)}
                  >
                    + Invita col link
                  </button>
                )}
              </div>
            </div>

            {canEdit && (
              <button
                type="button"
                className="btn btn-primary desktop-add-expense"
                onClick={openNewExpense}
              >
                <Plus size={16} />
                Aggiungi spesa
              </button>
            )}
          </div>
        </header>

        {isEvent && (
          <div className="quick-event-actions" role="group" aria-label="Azioni della serata">
            {canEdit && group.quickCreatorSeat === currentUserId && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAddingPeople(true)}>
                <UserPlus size={15} /> Aggiungi persone
              </button>
            )}
            <CopyEventSummary
              text={quickSummary(data, transfers)}
              onCopied={() => onToast('Riepilogo copiato, pronto per la chat')}
            />
            {canEdit && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => {
                setSettingsFocusClose(true);
                setSettingsOpen(true);
              }}>
                <Archive size={15} /> Concludi serata
              </button>
            )}
          </div>
        )}
        {addingPeople && canEdit && (
          <QuickEventForm
            mode="add"
            groups={allGroups}
            ownerId={actorId}
            members={members}
            matches={data.quickMatches ?? []}
            onClose={() => setAddingPeople(false)}
            onAdd={async (people) => {
              await repo.addQuickPeople(group.id, people);
              await onRefreshGroup();
              onToast('Partecipanti aggiunti');
            }}
          />
        )}

        {/* Banner gruppo chiuso */}
        {isClosed && (
          <div
            className="card-subtle"
            style={{
              marginBottom: 14,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 13.5 }}>
              <Archive size={16} className="text-secondary" />
              <span>
                Chiuso il <strong>{formatFullDateIT(group.closedAt!.slice(0, 10))}</strong>
                {group.closedIntoGroupName && (
                  <>
                    {' '}
                    · Saldo rimanente spostato in{' '}
                    {group.closedIntoGroupId &&
                    allGroups.some((g) => g.group.id === group.closedIntoGroupId) ? (
                      <button
                        type="button"
                        className="link-btn"
                        style={{ fontSize: 13.5 }}
                        onClick={() => onNavigateGroup(group.closedIntoGroupId!)}
                      >
                        {group.closedIntoGroupName}
                      </button>
                    ) : (
                      <strong>&ldquo;{group.closedIntoGroupName}&rdquo;</strong>
                    )}
                  </>
                )}
              </span>
            </div>
            {isEditor && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => void handleReopenGroup()}>
                <ArchiveRestore size={14} /> Riapri
              </button>
            )}
          </div>
        )}

        {/* Riepilogo saldo rapido */}
        {(tab === 'expenses' || tab === 'balances') && (
          <section className="card group-summary-bar" aria-label="Riepilogo del tuo saldo">
            <div>
              <div className="summary-balance-label">
                Il tuo saldo
                {isConvertedDisplay ? ` (mostrato in ${displayCurrency})` : ''}
              </div>
              <div
                className={`summary-balance-value tabular ${
                  balanceHeadline.tone === 'positive'
                    ? 'text-positive'
                    : balanceHeadline.tone === 'negative'
                      ? 'text-negative'
                      : ''
                }`}
              >
                {balanceHeadline.title}
              </div>
              <div className="summary-balance-sub tabular">{balanceHeadline.sub}</div>
            </div>

            <div className="summary-actions">
              {canEdit && myPrimaryTransfer && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => openSettleTransfer(myPrimaryTransfer)}
                >
                  <ArrowLeftRight size={14} />
                  Segna rimborso
                </button>
              )}
              {tab !== 'balances' && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setTab('balances')}
                >
                  Vedi saldi
                </button>
              )}
            </div>
          </section>
        )}

        {/* Navigazione schede Desktop */}
        <nav className="tabs-bar" aria-label="Sezioni del gruppo">
          {visibleTabs.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                type="button"
                className={`tab-btn ${tab === item.id ? 'active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
                {item.count !== undefined && (
                  <span className="badge" style={{ fontSize: 11, padding: '1px 6px' }}>
                    {item.count}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Contenuto della scheda attiva */}
        {tab === 'expenses' && (
          <ExpensesTab
            groupName={group.name}
            canEdit={canEdit}
            baseCurrency={group.baseCurrency}
            currentUserId={currentUserId}
            members={members}
            categories={categories}
            expenses={expenses}
            settlements={settlements}
            activityLogs={activityLogs}
            filters={filters}
            onFiltersChange={setFilters}
            onAddExpense={openNewExpense}
            onEditExpense={(exp) => {
              setEditingExpense(exp);
              setExpenseModalOpen(true);
            }}
            onDeleteExpense={handleDeleteExpense}
            onEditSettlement={(st) => {
              setEditingSettlement(st);
              setPrefillTransfer(null);
              setSettlementModalOpen(true);
            }}
            onDeleteSettlement={handleDeleteSettlement}
            onToast={onToast}
          />
        )}

        {tab === 'balances' && (
          <BalancesTab
            isEvent={isEvent}
            canEdit={canEdit}
            baseCurrency={group.baseCurrency}
            displayCurrency={displayCurrency}
            onDisplayCurrencyChange={setDisplayCurrency}
            displayRate={displayRate}
            loadingDisplayRate={loadingDisplayRate}
            currentUserId={currentUserId}
            balances={balances}
            transfers={transfers}
            settlements={settlements}
            nameOf={nameOf}
            onSettleTransfer={openSettleTransfer}
            onNewCustomSettlement={() => {
              setEditingSettlement(null);
              setPrefillTransfer(null);
              setSettlementModalOpen(true);
            }}
            onEditSettlement={(st) => {
              setEditingSettlement(st);
              setPrefillTransfer(null);
              setSettlementModalOpen(true);
            }}
            onOpenCloseGroup={() => {
              setSettingsFocusClose(true);
              setSettingsOpen(true);
            }}
          />
        )}

        {tab === 'insights' && (
          <InsightsTab
            baseCurrency={group.baseCurrency}
            expenses={expenses}
            settlements={settlements}
            members={members}
            categories={categories}
            onFilterByCategory={handleFilterFromInsights}
          />
        )}

        {tab === 'recurring' && (
          <RecurringTab
            groupId={group.id}
            canEdit={canEdit}
            baseCurrency={group.baseCurrency}
            currentUserId={currentUserId}
            members={members}
            categories={categories}
            recurringExpenses={recurringExpenses}
            nameOf={nameOf}
            onSaveRecurring={handleSaveRecurring}
            onToggleActive={handleToggleRecurring}
            onRunNow={handleRunRecurringNow}
            onDeleteRecurring={handleDeleteRecurring}
            onToast={onToast}
          />
        )}

        {tab === 'history' && <HistoryTab logs={activityLogs} />}
      </div>

      {/* Bottone mobile rapido "+ Spesa" */}
      {canEdit && (
        <button type="button" className="mobile-fab" onClick={openNewExpense}>
          <Plus size={19} strokeWidth={2.4} />
          Spesa
        </button>
      )}

      {/* Navigazione schede Mobile */}
      <nav className="mobile-tabbar" aria-label="Sezioni del gruppo">
        {visibleTabs.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              className={`mobile-tab-btn ${tab === item.id ? 'active' : ''}`}
              onClick={() => setTab(item.id)}
            >
              <Icon size={19} strokeWidth={tab === item.id ? 2.2 : 1.8} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Modali */}
      <ExpenseFormModal
        allowRecurring={!isEvent}
        open={canEdit && expenseModalOpen}
        onClose={() => {
          setExpenseModalOpen(false);
          setEditingExpense(null);
        }}
        groupId={group.id}
        baseCurrency={group.baseCurrency}
        members={members}
        currentUserId={currentUserId}
        categories={categories}
        expenses={expenses}
        editingExpense={editingExpense}
        onSaveExpense={handleSaveExpense}
        onCreateRecurringWithOptionalFirst={handleCreateRecurringWithFirst}
        onAddCustomCategory={style => handleSaveCategory(null, style)}
        onToast={onToast}
      />

      <SettlementFormModal
        open={canEdit && settlementModalOpen}
        onClose={() => {
          setSettlementModalOpen(false);
          setEditingSettlement(null);
          setPrefillTransfer(null);
        }}
        groupId={group.id}
        baseCurrency={group.baseCurrency}
        members={members}
        balances={balances}
        currentUserId={currentUserId}
        editingSettlement={editingSettlement}
        prefillTransfer={prefillTransfer}
        onSave={handleSaveSettlement}
      />

      {canEdit && inviteOpen && (
        <InviteModal
          group={group}
          repo={repo}
          revision={activityLogs.find((log) => log.entityType === 'invite' || log.entityType === 'member')?.id}
          onClose={() => setInviteOpen(false)}
          onToast={onToast}
        />
      )}

      <GroupSettingsModal
        readOnly={!isEditor}
        creatorControls={
          isEditor && group.creatorOwnerId === actorId
            ? {
                repo,
                onChanged: onRefreshGroup,
                onDeleted: () => onGroupLeft(true),
                hasCarry:
                  !!group.closedIntoGroupName || settlements.some((s) => s.kind !== 'settlement'),
              }
            : undefined
        }
        quickMatches={data.quickMatches}
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsFocusClose(false);
        }}
        initialFocusClose={settingsFocusClose}
        group={group}
        allGroups={writableGroups}
        members={members}
        balances={balances}
        transfers={transfers}
        categories={categories}
        currentUserId={currentUserId}
        onUpdateGroup={handleUpdateGroup}
        onAddParticipant={async (name) => {
          await repo.addParticipant(group.id, name);
          await onRefreshGroup();
        }}
        onSaveCategory={handleSaveCategory}
        onMoveCategory={async (key, step) => {
          await repo.moveCategory(group.id, key, step);
          await onRefreshGroup();
        }}
        onDeleteCategory={async key => {
          await repo.deleteCategory(group.id, key);
          await onRefreshGroup();
        }}
        onCloseGroup={handleCloseGroup}
        onReopenGroup={handleReopenGroup}
        onLeaveGroup={handleLeaveGroup}
        onToast={onToast}
      />
    </>
  );
}
