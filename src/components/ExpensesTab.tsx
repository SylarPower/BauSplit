import {
  Download,
  Pencil,
  Plus,
  Receipt,
  Repeat,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { getUserExpenseImpact } from '../lib/accounting';
import { SPLIT_MODE_LABELS, splitLogActorAndBody } from '../lib/audit';
import {
  filterCategories,
  resolveCategoryDisplay,
} from '../lib/categories';
import {
  formatMoney,
  formatNumberIT,
  formatRateValue,
} from '../lib/currencies';
import { downloadCsvFile, generateGroupCsv } from '../lib/csv';
import {
  DATE_PRESET_LABELS,
  formatDateIT,
  formatDateTimeIT,
  formatFullDateIT,
  formatMonthHeadingIT,
  isDateInRange,
  resolveDatePreset,
} from '../lib/dates';
import { translateErrorIT } from '../lib/supabase';
import type {
  ActivityLog,
  CategoryOption,
  DateRangePreset,
  Expense,
  ExpenseFilters,
  ExpenseListFilterType,
  GroupMember,
  Settlement,
} from '../types';
import { Avatar, CategoryIcon } from './Icon';
import { Modal } from './Modal';

export const DEFAULT_EXPENSE_FILTERS: ExpenseFilters = {
  search: '',
  type: 'all',
  category: 'all',
  paidBy: 'all',
  participant: 'all',
  currency: 'all',
  datePreset: 'all',
  dateFrom: '',
  dateTo: '',
};

interface ExpensesTabProps {
  groupName: string;
  isClosed: boolean;
  baseCurrency: string;
  currentUserId: string;
  members: GroupMember[];
  categories: CategoryOption[];
  expenses: Expense[];
  settlements: Settlement[];
  activityLogs: ActivityLog[];
  filters: ExpenseFilters;
  onFiltersChange: (next: ExpenseFilters) => void;
  onAddExpense: () => void;
  onEditExpense: (exp: Expense) => void;
  onDeleteExpense: (exp: Expense) => Promise<void>;
  onEditSettlement: (st: Settlement) => void;
  onDeleteSettlement: (st: Settlement) => Promise<void>;
  onToast: (msg: string, isError?: boolean) => void;
}

type FeedItem =
  | { kind: 'expense'; date: string; createdAt: string; expense: Expense }
  | { kind: 'settlement'; date: string; createdAt: string; settlement: Settlement };

export function ExpensesTab({
  groupName,
  isClosed,
  baseCurrency,
  currentUserId,
  members,
  categories,
  expenses,
  settlements,
  activityLogs,
  filters,
  onFiltersChange,
  onAddExpense,
  onEditExpense,
  onDeleteExpense,
  onEditSettlement,
  onDeleteSettlement,
  onToast,
}: ExpensesTabProps) {
  const [showFilters, setShowFilters] = useState(false);
  const [selectedExpenseId, setSelectedExpenseId] = useState<string | null>(null);
  const [selectedSettlementId, setSelectedSettlementId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const nameMap = useMemo(
    () => new Map(members.map((m) => [m.userId, m.displayName])),
    [members]
  );
  const nameOf = (id: string) => nameMap.get(id) ?? 'Membro';

  const categoryOptions = useMemo(
    () => filterCategories(categories, expenses),
    [categories, expenses]
  );

  const usedCurrencies = useMemo(() => {
    const set = new Set<string>([baseCurrency]);
    expenses.forEach((e) => set.add(e.currency));
    settlements.forEach((s) => set.add(s.currency));
    return Array.from(set);
  }, [baseCurrency, expenses, settlements]);

  const resolvedRange = useMemo(
    () => resolveDatePreset(filters.datePreset, filters.dateFrom, filters.dateTo),
    [filters.datePreset, filters.dateFrom, filters.dateTo]
  );

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.type !== 'all') n += 1;
    if (filters.category !== 'all') n += 1;
    if (filters.paidBy !== 'all') n += 1;
    if (filters.participant !== 'all') n += 1;
    if (filters.currency !== 'all') n += 1;
    if (filters.datePreset !== 'all') n += 1;
    return n;
  }, [filters]);

  const hasAnyFilter = activeFilterCount > 0 || filters.search.trim().length > 0;

  const { filteredExpenses, filteredSettlements, feedByMonth, filteredExpensesSum } =
    useMemo(() => {
      const q = filters.search.trim().toLowerCase();

      const fExp =
        filters.type === 'settlements'
          ? []
          : expenses.filter((e) => {
              if (!isDateInRange(e.expenseDate, resolvedRange.from, resolvedRange.to)) {
                return false;
              }
              if (filters.category !== 'all' && e.category !== filters.category) {
                return false;
              }
              if (filters.paidBy !== 'all' && e.paidBy !== filters.paidBy) {
                return false;
              }
              if (
                filters.participant !== 'all' &&
                !e.splits.some((s) => s.userId === filters.participant)
              ) {
                return false;
              }
              if (filters.currency !== 'all' && e.currency !== filters.currency) {
                return false;
              }
              if (q) {
                const hay = [
                  e.description,
                  e.note,
                  e.categoryLabel,
                  nameMap.get(e.paidBy) ?? '',
                  String(e.amount),
                  e.amount.toFixed(2).replace('.', ','),
                ]
                  .join(' ')
                  .toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

      const fSet =
        filters.type === 'expenses' || filters.category !== 'all'
          ? []
          : settlements.filter((s) => {
              if (!isDateInRange(s.settlementDate, resolvedRange.from, resolvedRange.to)) {
                return false;
              }
              if (filters.paidBy !== 'all' && s.fromUser !== filters.paidBy) {
                return false;
              }
              if (
                filters.participant !== 'all' &&
                s.fromUser !== filters.participant &&
                s.toUser !== filters.participant
              ) {
                return false;
              }
              if (filters.currency !== 'all' && s.currency !== filters.currency) {
                return false;
              }
              if (q) {
                const hay = [
                  'rimborso',
                  s.note,
                  nameMap.get(s.fromUser) ?? '',
                  nameMap.get(s.toUser) ?? '',
                  String(s.amount),
                  s.amount.toFixed(2).replace('.', ','),
                ]
                  .join(' ')
                  .toLowerCase();
                if (!hay.includes(q)) return false;
              }
              return true;
            });

      const items: FeedItem[] = [
        ...fExp.map(
          (expense): FeedItem => ({
            kind: 'expense',
            date: expense.expenseDate,
            createdAt: expense.createdAt,
            expense,
          })
        ),
        ...fSet.map(
          (settlement): FeedItem => ({
            kind: 'settlement',
            date: settlement.settlementDate,
            createdAt: settlement.createdAt,
            settlement,
          })
        ),
      ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt));

      const grouped = new Map<string, { monthKey: string; items: FeedItem[]; monthExpenseTotal: number }>();
      for (const item of items) {
        const mk = item.date.slice(0, 7);
        const bucket = grouped.get(mk) ?? { monthKey: mk, items: [], monthExpenseTotal: 0 };
        bucket.items.push(item);
        if (item.kind === 'expense') {
          bucket.monthExpenseTotal += item.expense.baseAmount;
        }
        grouped.set(mk, bucket);
      }

      const sum = fExp.reduce((acc, e) => acc + e.baseAmount, 0);

      return {
        filteredExpenses: fExp,
        filteredSettlements: fSet,
        feedByMonth: Array.from(grouped.values()),
        filteredExpensesSum: sum,
      };
    }, [expenses, settlements, filters, resolvedRange, nameMap]);

  const selectedExpense = useMemo(
    () => (selectedExpenseId ? expenses.find((e) => e.id === selectedExpenseId) ?? null : null),
    [expenses, selectedExpenseId]
  );

  const selectedSettlement = useMemo(
    () =>
      selectedSettlementId
        ? settlements.find((s) => s.id === selectedSettlementId) ?? null
        : null,
    [settlements, selectedSettlementId]
  );

  const selectedEntityLogs = useMemo(() => {
    const id = selectedExpense?.id ?? selectedSettlement?.id;
    if (!id) return [];
    return activityLogs.filter((l) => l.entityId === id);
  }, [activityLogs, selectedExpense, selectedSettlement]);

  const handleExportCsv = () => {
    if (filteredExpenses.length === 0 && filteredSettlements.length === 0) {
      onToast('Nessun movimento da esportare.', true);
      return;
    }
    const csv = generateGroupCsv({
      groupName,
      baseCurrency,
      expenses: filteredExpenses,
      settlements: filteredSettlements,
      nameOf,
    });
    downloadCsvFile(csv, groupName);
    const totalRows = filteredExpenses.length + filteredSettlements.length;
    onToast(
      hasAnyFilter
        ? `Esportate ${totalRows} voci filtrate in CSV`
        : `Esportate tutte le ${totalRows} voci in CSV`
    );
  };

  const handleConfirmDeleteExpense = async () => {
    if (!selectedExpense) return;
    setDeleting(true);
    try {
      await onDeleteExpense(selectedExpense);
      setSelectedExpenseId(null);
      setConfirmDelete(false);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmDeleteSettlement = async () => {
    if (!selectedSettlement) return;
    setDeleting(true);
    try {
      await onDeleteSettlement(selectedSettlement);
      setSelectedSettlementId(null);
      setConfirmDelete(false);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setDeleting(false);
    }
  };

  const totalItems = expenses.length + settlements.length;
  const shownItems = filteredExpenses.length + filteredSettlements.length;

  return (
    <div>
      {/* Barra ricerca, filtri ed esportazione CSV */}
      <div className="toolbar">
        <div className="search-box">
          <span className="search-box-icon">
            <Search size={16} />
          </span>
          <input
            type="search"
            className="input"
            placeholder="Cerca per descrizione, nota, persona o importo…"
            value={filters.search}
            onChange={(e) => onFiltersChange({ ...filters, search: e.target.value })}
          />
          {filters.search && (
            <button
              type="button"
              className="search-clear"
              onClick={() => onFiltersChange({ ...filters, search: '' })}
              aria-label="Cancella ricerca"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <button
          type="button"
          className={`btn btn-secondary ${activeFilterCount > 0 ? 'badge-accent' : ''}`}
          style={
            activeFilterCount > 0
              ? { borderColor: 'var(--accent)', color: 'var(--accent)', background: 'var(--accent-soft)' }
              : undefined
          }
          onClick={() => setShowFilters((v) => !v)}
        >
          <SlidersHorizontal size={15} />
          Filtri{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
        </button>

        <button
          type="button"
          className="btn btn-secondary"
          onClick={handleExportCsv}
          disabled={shownItems === 0}
          title={hasAnyFilter ? 'Esporta le voci filtrate in CSV' : 'Esporta tutto in CSV'}
        >
          <Download size={15} />
          CSV
        </button>
      </div>

      {/* Pannello filtri espandibile */}
      {showFilters && (
        <div className="card filters-panel">
          <div className="filters-grid">
            <label className="field">
              <span className="field-label">Tipo movimento</span>
              <select
                className="select select-sm"
                value={filters.type}
                onChange={(e) =>
                  onFiltersChange({ ...filters, type: e.target.value as ExpenseListFilterType })
                }
              >
                <option value="all">Spese e rimborsi</option>
                <option value="expenses">Solo spese</option>
                <option value="settlements">Solo rimborsi</option>
              </select>
            </label>

            <label className="field">
              <span className="field-label">Categoria</span>
              <select
                className="select select-sm"
                value={filters.category}
                onChange={(e) => onFiltersChange({ ...filters, category: e.target.value })}
                disabled={filters.type === 'settlements'}
              >
                <option value="all">Tutte le categorie</option>
                {categoryOptions.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Pagato da</span>
              <select
                className="select select-sm"
                value={filters.paidBy}
                onChange={(e) => onFiltersChange({ ...filters, paidBy: e.target.value })}
              >
                <option value="all">Chiunque</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Partecipante</span>
              <select
                className="select select-sm"
                value={filters.participant}
                onChange={(e) => onFiltersChange({ ...filters, participant: e.target.value })}
              >
                <option value="all">Chiunque</option>
                {members.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                  </option>
                ))}
              </select>
            </label>

            {usedCurrencies.length > 1 && (
              <label className="field">
                <span className="field-label">Valuta</span>
                <select
                  className="select select-sm"
                  value={filters.currency}
                  onChange={(e) => onFiltersChange({ ...filters, currency: e.target.value })}
                >
                  <option value="all">Tutte le valute</option>
                  {usedCurrencies.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="field">
              <span className="field-label">Periodo</span>
              <select
                className="select select-sm"
                value={filters.datePreset}
                onChange={(e) =>
                  onFiltersChange({
                    ...filters,
                    datePreset: e.target.value as DateRangePreset,
                  })
                }
              >
                {(Object.keys(DATE_PRESET_LABELS) as DateRangePreset[]).map((key) => (
                  <option key={key} value={key}>
                    {DATE_PRESET_LABELS[key]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {filters.datePreset === 'custom' && (
            <div className="form-row">
              <label className="field">
                <span className="field-label">Dal</span>
                <input
                  type="date"
                  className="input input-sm tabular"
                  value={filters.dateFrom}
                  onChange={(e) => onFiltersChange({ ...filters, dateFrom: e.target.value })}
                />
              </label>
              <label className="field">
                <span className="field-label">Al</span>
                <input
                  type="date"
                  className="input input-sm tabular"
                  value={filters.dateTo}
                  min={filters.dateFrom || undefined}
                  onChange={(e) => onFiltersChange({ ...filters, dateTo: e.target.value })}
                />
              </label>
            </div>
          )}
        </div>
      )}

      {hasAnyFilter && (
        <div className="filter-summary-strip tabular">
          <span>
            {shownItems} {shownItems === 1 ? 'risultato' : 'risultati'}
            {filteredExpenses.length > 0 && (
              <>
                {' '}
                · Totale spese filtrate:{' '}
                <strong>{formatMoney(filteredExpensesSum, baseCurrency)}</strong>
              </>
            )}
          </span>
          <button
            type="button"
            className="link-btn"
            onClick={() => onFiltersChange({ ...DEFAULT_EXPENSE_FILTERS })}
          >
            Azzera filtri
          </button>
        </div>
      )}

      {/* Elenco vuoto */}
      {totalItems === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">
            <Receipt size={22} />
          </span>
          <h3 className="empty-title">Ancora nessuna spesa</h3>
          <p className="empty-desc">
            {isClosed
              ? 'Questo gruppo è stato chiuso senza movimenti registrati.'
              : 'Aggiungi la prima spesa del gruppo: potrai dividerla in parti uguali, per importi o per percentuali.'}
          </p>
          {!isClosed && (
            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 4 }}
              onClick={onAddExpense}
            >
              <Plus size={16} />
              Aggiungi prima spesa
            </button>
          )}
        </div>
      ) : shownItems === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">
            <Search size={20} />
          </span>
          <h3 className="empty-title">Nessuna voce corrisponde ai filtri</h3>
          <p className="empty-desc">Prova a modificare la ricerca o ad azzerare i filtri attivi.</p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => onFiltersChange({ ...DEFAULT_EXPENSE_FILTERS })}
          >
            Mostra tutte le voci
          </button>
        </div>
      ) : (
        feedByMonth.map((bucket) => (
          <section key={bucket.monthKey} className="month-group">
            <div className="month-heading tabular">
              <span>{formatMonthHeadingIT(bucket.monthKey)}</span>
              {bucket.monthExpenseTotal > 0 && (
                <span>Spese: {formatMoney(bucket.monthExpenseTotal, baseCurrency)}</span>
              )}
            </div>

            <div className="card tx-list">
              {bucket.items.map((item) => {
                if (item.kind === 'expense') {
                  const exp = item.expense;
                  const cat = resolveCategoryDisplay(
                    exp.category,
                    exp.categoryLabel,
                    categories
                  );
                  const impact = getUserExpenseImpact(exp, currentUserId, baseCurrency);
                  const payerLabel =
                    exp.paidBy === currentUserId ? 'Hai pagato tu' : `Ha pagato ${nameOf(exp.paidBy)}`;
                  const isForeign = exp.currency !== baseCurrency;

                  return (
                    <button
                      key={`exp-${exp.id}`}
                      type="button"
                      className="tx-row"
                      onClick={() => {
                        setConfirmDelete(false);
                        setSelectedExpenseId(exp.id);
                      }}
                    >
                      <CategoryIcon icon={cat.icon} color={cat.color} boxed />

                      <div className="tx-main">
                        <div className="tx-title">
                          <span className="tx-title-text">{exp.description}</span>
                          {exp.recurringId && (
                            <span className="badge" title="Generata da spesa ricorrente">
                              <Repeat size={11} />
                            </span>
                          )}
                          {isForeign && <span className="badge">{exp.currency}</span>}
                        </div>
                        <div className="tx-sub">
                          <span>{formatDateIT(exp.expenseDate, { relative: true })}</span>
                          <span>·</span>
                          <span>{payerLabel}</span>
                          <span>·</span>
                          <span className="text-muted">{cat.name}</span>
                        </div>
                      </div>

                      <div className="tx-amounts tabular">
                        <div className="tx-total">
                          {formatMoney(exp.baseAmount, baseCurrency)}
                        </div>
                        {isForeign && (
                          <div className="field-hint" style={{ fontSize: 11.5 }}>
                            {formatMoney(exp.amount, exp.currency)}
                          </div>
                        )}
                        <div
                          className={`tx-impact ${
                            !impact.involved
                              ? 'text-muted'
                              : impact.netBase > 0.005
                                ? 'text-positive'
                                : impact.netBase < -0.005
                                  ? 'text-negative'
                                  : 'text-muted'
                          }`}
                        >
                          {!impact.involved
                            ? 'Non coinvolto'
                            : impact.netBase > 0.005
                              ? `Ti spettano ${formatMoney(impact.netBase, baseCurrency)}`
                              : impact.netBase < -0.005
                                ? `Devi ${formatMoney(Math.abs(impact.netBase), baseCurrency)}`
                                : 'Già pari'}
                        </div>
                      </div>
                    </button>
                  );
                }

                const st = item.settlement;
                const isTransferIn = st.kind === 'transfer_in';
                const isTransferOut = st.kind === 'transfer_out';
                const isTransfer = isTransferIn || isTransferOut;
                const isForeign = st.currency !== baseCurrency;

                // Per transfer_in: fromUser = creditore, toUser = debitore
                const titleText = isTransferIn
                  ? `${st.toUser === currentUserId ? 'Tu devi' : `${nameOf(st.toUser)} deve`} a ${
                      st.fromUser === currentUserId ? 'te' : nameOf(st.fromUser)
                    }`
                  : isTransferOut
                    ? `Saldo spostato${st.linkedGroupName ? ` in "${st.linkedGroupName}"` : ''}`
                    : `${st.fromUser === currentUserId ? 'Tu hai rimborsato' : `${nameOf(st.fromUser)} ha rimborsato`} ${
                        st.toUser === currentUserId ? 'te' : nameOf(st.toUser)
                      }`;

                const badgeLabel = isTransferIn
                  ? 'Saldo riportato'
                  : isTransferOut
                    ? 'Chiusura gruppo'
                    : 'Rimborso';

                return (
                  <button
                    key={`set-${st.id}`}
                    type="button"
                    className="tx-row"
                    onClick={() => {
                      setConfirmDelete(false);
                      setSelectedSettlementId(st.id);
                    }}
                  >
                    <CategoryIcon
                      icon={isTransfer ? 'transfer' : 'settlement'}
                      color={isTransfer ? '#0b6e66' : '#0d7a5f'}
                      boxed
                    />

                    <div className="tx-main">
                      <div className="tx-title">
                        <span>{titleText}</span>
                        <span
                          className={`badge ${isTransfer ? 'badge-accent' : 'badge-positive'}`}
                        >
                          {badgeLabel}
                        </span>
                      </div>
                      <div className="tx-sub">
                        <span>{formatDateIT(st.settlementDate, { relative: true })}</span>
                        {isTransferOut && (
                          <>
                            <span>·</span>
                            <span className="text-muted">
                              {nameOf(st.fromUser)} → {nameOf(st.toUser)}
                            </span>
                          </>
                        )}
                        {isTransferIn && st.linkedGroupName && (
                          <>
                            <span>·</span>
                            <span className="text-muted">
                              Da &ldquo;{st.linkedGroupName}&rdquo;
                            </span>
                          </>
                        )}
                        {!isTransfer && st.note && (
                          <>
                            <span>·</span>
                            <span className="text-muted">{st.note}</span>
                          </>
                        )}
                      </div>
                    </div>

                    <div className="tx-amounts tabular">
                      <div
                        className={`tx-total ${isTransfer ? '' : 'text-positive'}`}
                      >
                        {formatMoney(st.baseAmount, baseCurrency)}
                      </div>
                      {isTransferIn &&
                        (st.fromUser === currentUserId || st.toUser === currentUserId) && (
                          <div
                            className={`tx-impact ${
                              st.fromUser === currentUserId ? 'text-positive' : 'text-negative'
                            }`}
                          >
                            {st.fromUser === currentUserId
                              ? `Ti spettano ${formatMoney(st.baseAmount, baseCurrency)}`
                              : `Devi ${formatMoney(st.baseAmount, baseCurrency)}`}
                          </div>
                        )}
                      {isForeign && (
                        <div className="field-hint" style={{ fontSize: 11.5 }}>
                          {formatMoney(st.amount, st.currency)}
                        </div>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        ))
      )}

      {/* Modale dettaglio spesa + storico della voce */}
      <Modal
        open={Boolean(selectedExpense)}
        title="Dettaglio spesa"
        onClose={() => {
          setSelectedExpenseId(null);
          setConfirmDelete(false);
        }}
        wide
        footerBetween
        footer={
          selectedExpense && !isClosed ? (
            <>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
              >
                <Trash2 size={14} />
                Elimina
              </button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    const exp = selectedExpense;
                    setSelectedExpenseId(null);
                    onEditExpense(exp);
                  }}
                >
                  <Pencil size={14} />
                  Modifica
                </button>
              </div>
            </>
          ) : undefined
        }
      >
        {selectedExpense && (
          <div className="form-stack">
            {confirmDelete && (
              <div className="alert alert-error" style={{ flexDirection: 'column', gap: 8 }}>
                <span>
                  Eliminare la spesa &ldquo;{selectedExpense.description}&rdquo;? I saldi verranno
                  aggiornati e l&apos;eliminazione resterà visibile nello storico del gruppo.
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-danger-solid btn-sm"
                    onClick={handleConfirmDeleteExpense}
                    disabled={deleting}
                  >
                    {deleting ? 'Eliminazione…' : 'Conferma eliminazione'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h3 style={{ fontSize: 19, fontWeight: 700 }}>{selectedExpense.description}</h3>
                <div className="text-secondary" style={{ fontSize: 13.5, marginTop: 2 }}>
                  {selectedExpense.categoryLabel} · {formatFullDateIT(selectedExpense.expenseDate)}
                </div>
              </div>
              <div className="tabular" style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {formatMoney(selectedExpense.baseAmount, baseCurrency)}
                </div>
                {selectedExpense.currency !== baseCurrency && (
                  <div className="text-secondary" style={{ fontSize: 13 }}>
                    {formatMoney(selectedExpense.amount, selectedExpense.currency)}
                  </div>
                )}
              </div>
            </div>

            <div className="card-subtle kv-list">
              <div className="kv-row">
                <span className="kv-key">Pagato da</span>
                <span className="kv-val">{nameOf(selectedExpense.paidBy)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">Modalità divisione</span>
                <span className="kv-val">{SPLIT_MODE_LABELS[selectedExpense.splitMode]}</span>
              </div>
              {selectedExpense.currency !== baseCurrency && (
                <div className="kv-row tabular">
                  <span className="kv-key">Tasso di cambio salvato</span>
                  <span className="kv-val">
                    1 {selectedExpense.currency} = {formatRateValue(selectedExpense.exchangeRate)}{' '}
                    {baseCurrency}{' '}
                    <span className="text-muted" style={{ fontWeight: 400 }}>
                      (
                      {selectedExpense.rateIsManual
                        ? 'manuale'
                        : `del ${formatFullDateIT(selectedExpense.rateDate)}`}
                      )
                    </span>
                  </span>
                </div>
              )}
              {selectedExpense.note && (
                <div className="kv-row">
                  <span className="kv-key">Nota</span>
                  <span className="kv-val">{selectedExpense.note}</span>
                </div>
              )}
            </div>

            <div className="field">
              <span className="field-label">
                Quote dei partecipanti ({selectedExpense.splits.length})
              </span>
              <div className="split-list">
                {selectedExpense.splits.map((s) => (
                  <div key={s.userId} className="split-row tabular">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                      <Avatar name={nameOf(s.userId)} seed={s.userId} size={26} />
                      <span style={{ fontWeight: 550 }}>{nameOf(s.userId)}</span>
                      {selectedExpense.splitMode === 'percentage' && s.percentage !== null && (
                        <span className="badge">{formatNumberIT(s.percentage, 2)}%</span>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontWeight: 600 }}>
                        {formatMoney(s.baseAmount, baseCurrency)}
                      </div>
                      {selectedExpense.currency !== baseCurrency && (
                        <div className="field-hint">
                          {formatMoney(s.amount, selectedExpense.currency)}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {selectedEntityLogs.length > 0 && (
              <div className="field">
                <span className="field-label">Cronologia modifiche di questa spesa</span>
                <div className="split-list">
                  {selectedEntityLogs.map((log) => {
                    const line = splitLogActorAndBody(log.actorName, log.summary);
                    return (
                    <div key={log.id} className="log-row">
                      <div className="log-top">
                        <span style={{ fontSize: 13.2 }}>
                          <strong>{line.lead}</strong>{' '}
                          <span className="text-secondary">{line.rest}</span>
                        </span>
                        <span className="field-hint tabular" style={{ flexShrink: 0 }}>
                          {formatDateTimeIT(log.createdAt)}
                        </span>
                      </div>
                      {log.changes.diffs && log.changes.diffs.length > 0 && (
                        <div className="log-diffs">
                          {log.changes.diffs.map((d, i) => (
                            <div key={i} className="log-diff-line">
                              <span className="text-secondary">{d.field}:</span>
                              <span className="diff-before">{d.before}</span>
                              <span>→</span>
                              <span className="diff-after">{d.after}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Modale dettaglio rimborso o trasferimento saldo */}
      <Modal
        open={Boolean(selectedSettlement)}
        title={
          selectedSettlement?.kind === 'transfer_in'
            ? 'Dettaglio saldo riportato'
            : selectedSettlement?.kind === 'transfer_out'
              ? 'Dettaglio saldo spostato'
              : 'Dettaglio rimborso'
        }
        onClose={() => {
          setSelectedSettlementId(null);
          setConfirmDelete(false);
        }}
        footerBetween
        footer={
          selectedSettlement && !isClosed && selectedSettlement.kind === 'settlement' ? (
            <>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => setConfirmDelete(true)}
                disabled={deleting}
              >
                <Trash2 size={14} />
                Elimina
              </button>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => {
                  const st = selectedSettlement;
                  setSelectedSettlementId(null);
                  onEditSettlement(st);
                }}
              >
                <Pencil size={14} />
                Modifica
              </button>
            </>
          ) : undefined
        }
      >
        {selectedSettlement && (
          <div className="form-stack">
            {confirmDelete && (
              <div className="alert alert-error" style={{ flexDirection: 'column', gap: 8 }}>
                <span>
                  Eliminare questo rimborso? I saldi del gruppo verranno ricalcolati e l&apos;azione
                  resterà nello storico.
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-danger-solid btn-sm"
                    onClick={handleConfirmDeleteSettlement}
                    disabled={deleting}
                  >
                    {deleting ? 'Eliminazione…' : 'Conferma eliminazione'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => setConfirmDelete(false)}
                    disabled={deleting}
                  >
                    Annulla
                  </button>
                </div>
              </div>
            )}

            <div className="card-subtle kv-list">
              <div className="kv-row">
                <span className="kv-key">
                  {selectedSettlement.kind === 'transfer_in'
                    ? 'Chi deve ricevere'
                    : selectedSettlement.kind === 'transfer_out'
                      ? 'Debitore originario'
                      : 'Chi ha rimborsato'}
                </span>
                <span className="kv-val">{nameOf(selectedSettlement.fromUser)}</span>
              </div>
              <div className="kv-row">
                <span className="kv-key">
                  {selectedSettlement.kind === 'transfer_in'
                    ? 'Chi deve dare'
                    : selectedSettlement.kind === 'transfer_out'
                      ? 'Creditore originario'
                      : 'Destinatario'}
                </span>
                <span className="kv-val">{nameOf(selectedSettlement.toUser)}</span>
              </div>
              {selectedSettlement.linkedGroupName && (
                <div className="kv-row">
                  <span className="kv-key">
                    {selectedSettlement.kind === 'transfer_in'
                      ? 'Gruppo di provenienza'
                      : 'Gruppo di destinazione'}
                  </span>
                  <span className="kv-val">{selectedSettlement.linkedGroupName}</span>
                </div>
              )}
              <div className="kv-row tabular">
                <span className="kv-key">Importo</span>
                <span className="kv-val text-positive" style={{ fontSize: 16, fontWeight: 700 }}>
                  {formatMoney(selectedSettlement.baseAmount, baseCurrency)}
                  {selectedSettlement.currency !== baseCurrency &&
                    ` (${formatMoney(selectedSettlement.amount, selectedSettlement.currency)})`}
                </span>
              </div>
              {selectedSettlement.currency !== baseCurrency && (
                <div className="kv-row tabular">
                  <span className="kv-key">Cambio salvato</span>
                  <span className="kv-val">
                    1 {selectedSettlement.currency} ={' '}
                    {formatRateValue(selectedSettlement.exchangeRate)} {baseCurrency}
                  </span>
                </div>
              )}
              <div className="kv-row">
                <span className="kv-key">Data</span>
                <span className="kv-val">{formatFullDateIT(selectedSettlement.settlementDate)}</span>
              </div>
              {selectedSettlement.note && (
                <div className="kv-row">
                  <span className="kv-key">Nota</span>
                  <span className="kv-val">{selectedSettlement.note}</span>
                </div>
              )}
              <div className="kv-row">
                <span className="kv-key">Registrato da</span>
                <span className="kv-val">
                  {(activityLogs.find((log) => log.entityId === selectedSettlement.id && log.action === 'created')?.actorName ??
                    members.find((m) => m.ownerId === selectedSettlement.createdBy)?.displayName ?? 'Membro')} ·{' '}
                  {formatDateTimeIT(selectedSettlement.createdAt)}
                </span>
              </div>
            </div>

            {selectedEntityLogs.length > 1 && (
              <div className="field">
                <span className="field-label">Cronologia modifiche</span>
                <div className="split-list">
                  {selectedEntityLogs.map((log) => (
                    <div key={log.id} className="log-row">
                      <div className="log-top">
                        <span style={{ fontSize: 13 }}>
                          <strong>{log.actorName}</strong> · {log.summary}
                        </span>
                        <span className="field-hint tabular">
                          {formatDateTimeIT(log.createdAt)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
