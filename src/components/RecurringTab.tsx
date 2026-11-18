import {
  Check,
  Pause,
  Pencil,
  Play,
  Plus,
  Repeat,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { computeExpenseSplits, roundCurrency } from '../lib/accounting';
import { SPLIT_MODE_LABELS } from '../lib/audit';
import { entryCategories, resolveCategoryDisplay } from '../lib/categories';
import {
  CURRENCIES,
  formatMoney,
  formatDecimalInput,
  getCurrencyInfo,
  parseDecimalInput,
} from '../lib/currencies';
import { formatFullDateIT, todayISO } from '../lib/dates';
import { FREQUENCY_LABELS, FREQUENCY_OPTIONS } from '../lib/recurring';
import { translateErrorIT } from '../lib/supabase';
import { canonicalRate, directQuote } from '../lib/rateQuote';
import type {
  CategoryOption,
  GroupMember,
  RecurringExpense,
  RecurringExpenseInput,
  RecurringFrequency,
  SplitMode,
} from '../types';
import { Avatar, CategoryIcon } from './Icon';
import { Modal } from './Modal';
import { RateInput } from './RateInput';

interface RecurringTabProps {
  groupId: string;
  isClosed: boolean;
  baseCurrency: string;
  currentUserId: string;
  members: GroupMember[];
  categories: CategoryOption[];
  recurringExpenses: RecurringExpense[];
  nameOf: (userId: string) => string;
  onSaveRecurring: (input: RecurringExpenseInput, before?: RecurringExpense) => Promise<void>;
  onToggleActive: (rec: RecurringExpense, active: boolean) => Promise<void>;
  onRunNow: (rec: RecurringExpense) => Promise<void>;
  onDeleteRecurring: (rec: RecurringExpense) => Promise<void>;
  onToast: (msg: string, isError?: boolean) => void;
}

export function RecurringTab({
  groupId,
  isClosed,
  baseCurrency,
  currentUserId,
  members,
  categories: catalog,
  recurringExpenses,
  nameOf,
  onSaveRecurring,
  onToggleActive,
  onRunNow,
  onDeleteRecurring,
  onToast,
}: RecurringTabProps) {
  const activeMembers = useMemo(() => members.filter((m) => m.leftAt === null), [members]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RecurringExpense | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Stato modulo
  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [fixedQuote, setFixedQuote] = useState(() => directQuote(null));
  const [categoryKey, setCategoryKey] = useState('casa');
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exactInputs, setExactInputs] = useState<Record<string, string>>({});
  const [pctInputs, setPctInputs] = useState<Record<string, string>>({});
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [nextDueDate, setNextDueDate] = useState(todayISO());
  const [endDate, setEndDate] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const categories = useMemo(() => entryCategories(catalog, editing), [catalog, editing]);
  const selectedCategory = categories.find((c) => c.key === categoryKey);

  // La sincronizzazione non deve resettare i campi già compilati.
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!modalOpen) {
      initializedKeyRef.current = null;
      return;
    }
    const initKey = editing ? `edit:${editing.id}` : `new:${groupId}`;
    if (initializedKeyRef.current === initKey) return;
    initializedKeyRef.current = initKey;

    setFormError(null);
    const today = todayISO();
    const defaultIds = activeMembers.map((m) => m.userId);

    if (editing) {
      setDescription(editing.description);
      setAmountStr(formatDecimalInput(editing.amount));
      setCurrency(editing.currency);
      setFixedQuote(directQuote(editing.fixedExchangeRate));
      setCategoryKey(editing.category);
      setPaidBy(editing.paidBy);
      setSplitMode(editing.splitMode);
      setSelectedIds(editing.splits.map((s) => s.userId));
      const ex: Record<string, string> = {};
      const pc: Record<string, string> = {};
      editing.splits.forEach((s) => {
        if (typeof s.amount === 'number') ex[s.userId] = formatDecimalInput(s.amount);
        if (typeof s.percentage === 'number') pc[s.userId] = formatDecimalInput(s.percentage, 4);
      });
      setExactInputs(ex);
      setPctInputs(pc);
      setFrequency(editing.frequency);
      setNextDueDate(editing.nextDueDate);
      setEndDate(editing.endDate ?? '');
      setNote(editing.note);
    } else {
      setDescription('');
      setAmountStr('');
      setCurrency(baseCurrency);
      setFixedQuote(directQuote(null));
      setCategoryKey(categories.find((c) => c.key === 'casa')?.key ?? categories[0]?.key ?? '');
      setPaidBy(
        defaultIds.includes(currentUserId) ? currentUserId : (defaultIds[0] ?? currentUserId)
      );
      setSplitMode('equal');
      setSelectedIds(defaultIds);
      setExactInputs({});
      const equalPct = defaultIds.length > 0 ? formatDecimalInput(100 / defaultIds.length) : '100';
      const pc: Record<string, string> = {};
      defaultIds.forEach((id) => {
        pc[id] = equalPct;
      });
      setPctInputs(pc);
      setFrequency('monthly');
      setNextDueDate(today);
      setEndDate('');
      setNote('');
    }
  }, [modalOpen, editing, activeMembers, baseCurrency, currentUserId, categories, groupId]);

  const parsedAmount = useMemo(() => {
    const v = parseDecimalInput(amountStr);
    return v !== null && v > 0 ? roundCurrency(v, currency) : 0;
  }, [amountStr, currency]);

  const exactNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of selectedIds) out[id] = parseDecimalInput(exactInputs[id] ?? '') ?? 0;
    return out;
  }, [selectedIds, exactInputs]);

  const pctNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of selectedIds) out[id] = parseDecimalInput(pctInputs[id] ?? '') ?? 0;
    return out;
  }, [selectedIds, pctInputs]);

  const splitCalc = useMemo(
    () =>
      computeExpenseSplits({
        totalAmount: parsedAmount,
        currency,
        totalBaseAmount: parsedAmount,
        baseCurrency: currency,
        splitMode,
        participantIds: selectedIds,
        exactAmounts: exactNumbers,
        percentages: pctNumbers,
      }),
    [parsedAmount, currency, splitMode, selectedIds, exactNumbers, pctNumbers]
  );

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!description.trim()) {
      setFormError('Inserisci una descrizione.');
      return;
    }
    if (parsedAmount <= 0) {
      setFormError('Inserisci un importo valido maggiore di zero.');
      return;
    }
    if (!splitCalc.valid) {
      setFormError(splitCalc.error ?? 'Verifica le quote di ripartizione.');
      return;
    }

    let fixedRate: number | null = null;
    if (currency !== baseCurrency && fixedQuote.text.trim()) {
      const parsed = canonicalRate(fixedQuote);
      if (parsed === null || parsed <= 0) {
        setFormError(
          'Inserisci un cambio fisso valido oppure lascia vuoto per il cambio automatico.'
        );
        return;
      }
      fixedRate = parsed;
    }

    if (endDate && endDate < nextDueDate) {
      setFormError('La data di fine non può precedere la prossima scadenza.');
      return;
    }

    if (!selectedCategory) {
      setFormError('Questa categoria non è più disponibile. Scegline un’altra.');
      return;
    }
    const input: RecurringExpenseInput = {
      id: editing?.id,
      groupId,
      description: description.trim(),
      amount: parsedAmount,
      currency,
      fixedExchangeRate: fixedRate,
      category: categoryKey,
      categoryLabel: selectedCategory.name,
      paidBy,
      splitMode,
      splits: splitCalc.splits.map((s) => ({
        userId: s.userId,
        ...(splitMode === 'exact' ? { amount: s.amount } : {}),
        ...(splitMode === 'percentage' && s.percentage !== null
          ? { percentage: s.percentage }
          : {}),
      })),
      note: note.trim(),
      frequency,
      startDate: editing?.startDate ?? nextDueDate,
      nextDueDate,
      endDate: endDate || null,
      active: editing ? editing.active : true,
    };

    setSaving(true);
    try {
      await onSaveRecurring(input, editing ?? undefined);
      setModalOpen(false);
      setEditing(null);
    } catch (err) {
      setFormError(translateErrorIT(err));
    } finally {
      setSaving(false);
    }
  };

  const handleAction = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    try {
      await fn();
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setBusyId(null);
    }
  };

  const sym = getCurrencyInfo(currency).symbol;

  return (
    <div className="section-stack">
      <div className="section-head" style={{ marginBottom: 0 }}>
        <div>
          <h2 className="section-title">Spese ricorrenti</h2>
          <p className="field-hint">
            Affitto, bollette e abbonamenti vengono registrati in automatico alla data prevista.
          </p>
        </div>
        {!isClosed && (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => {
              setEditing(null);
              setModalOpen(true);
            }}
          >
            <Plus size={15} />
            Nuova ricorrente
          </button>
        )}
      </div>

      {recurringExpenses.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">
            <Repeat size={22} />
          </span>
          <h3 className="empty-title">Nessuna spesa ricorrente</h3>
          <p className="empty-desc">
            {isClosed
              ? 'Questo gruppo non aveva spese ricorrenti impostate.'
              : 'Aggiungi spese fisse come affitto, internet, luce o abbonamenti condivisi per non doverle inserire ogni mese.'}
          </p>
          {!isClosed && (
            <button
              type="button"
              className="btn btn-primary btn-sm"
              style={{ marginTop: 4 }}
              onClick={() => {
                setEditing(null);
                setModalOpen(true);
              }}
            >
              <Plus size={15} />
              Imposta una ricorrenza
            </button>
          )}
        </div>
      ) : (
        <div className="card">
          {recurringExpenses.map((rec) => {
            const cat = resolveCategoryDisplay(rec.category, rec.categoryLabel, catalog);
            const isBusy = busyId === rec.id;

            return (
              <div
                key={rec.id}
                className="log-row"
                style={{ opacity: rec.active ? 1 : 0.68, padding: '15px 18px' }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <CategoryIcon icon={cat.icon} color={cat.color} boxed />
                    <div>
                      <div
                        style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}
                      >
                        <span style={{ fontSize: 15, fontWeight: 650 }}>{rec.description}</span>
                        <span className={`badge ${rec.active ? 'badge-accent' : ''}`}>
                          {FREQUENCY_LABELS[rec.frequency]}
                        </span>
                        {!rec.active && <span className="badge badge-warning">In pausa</span>}
                      </div>
                      <div className="tx-sub">
                        <span>{cat.name}</span>
                        <span>·</span>
                        <span>Paga {nameOf(rec.paidBy)}</span>
                        <span>·</span>
                        <span>{SPLIT_MODE_LABELS[rec.splitMode]}</span>
                        <span>·</span>
                        <span>
                          {rec.active
                            ? `Prossima: ${formatFullDateIT(rec.nextDueDate)}`
                            : 'Sospesa'}
                        </span>
                        {rec.endDate && (
                          <>
                            <span>·</span>
                            <span>Fino al {formatFullDateIT(rec.endDate)}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="tabular" style={{ fontSize: 16.5, fontWeight: 700 }}>
                    {formatMoney(rec.amount, rec.currency)}
                  </div>
                </div>

                {confirmDeleteId === rec.id ? (
                  <div
                    className="alert alert-error"
                    style={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span>
                      Rimuovere questa ricorrenza? (Le spese già registrate resteranno nel gruppo.)
                    </span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="btn btn-danger-solid btn-sm"
                        disabled={isBusy}
                        onClick={() =>
                          handleAction(rec.id, async () => {
                            await onDeleteRecurring(rec);
                            setConfirmDeleteId(null);
                          })
                        }
                      >
                        Rimuovi
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => setConfirmDeleteId(null)}
                      >
                        Annulla
                      </button>
                    </div>
                  </div>
                ) : !isClosed ? (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      flexWrap: 'wrap',
                      paddingLeft: 50,
                    }}
                  >
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      disabled={isBusy}
                      onClick={() => handleAction(rec.id, () => onRunNow(rec))}
                      title={`Registra subito la scadenza del ${formatFullDateIT(rec.nextDueDate)}`}
                    >
                      <Zap size={13} />
                      Registra ora
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={isBusy}
                      onClick={() => handleAction(rec.id, () => onToggleActive(rec, !rec.active))}
                    >
                      {rec.active ? <Pause size={13} /> : <Play size={13} />}
                      {rec.active ? 'Pausa' : 'Riattiva'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      disabled={isBusy}
                      onClick={() => {
                        setEditing(rec);
                        setModalOpen(true);
                      }}
                    >
                      <Pencil size={13} />
                      Modifica
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      style={{ color: 'var(--danger)' }}
                      disabled={isBusy}
                      onClick={() => setConfirmDeleteId(rec.id)}
                    >
                      <Trash2 size={13} />
                      Elimina
                    </button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {/* Modale creazione / modifica ricorrenza */}
      <Modal
        open={modalOpen}
        title={editing ? 'Modifica spesa ricorrente' : 'Nuova spesa ricorrente'}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        wide
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setModalOpen(false)}
              disabled={saving}
            >
              Annulla
            </button>
            <button
              type="submit"
              form="recurring-form"
              className="btn btn-primary"
              disabled={saving}
            >
              {saving ? 'Salvataggio…' : editing ? 'Salva modifiche' : 'Crea ricorrenza'}
            </button>
          </>
        }
      >
        <form id="recurring-form" className="form-stack" onSubmit={handleSubmit}>
          {formError && <div className="alert alert-error">{formError}</div>}

          <label className="field">
            <span className="field-label">Descrizione</span>
            <input
              type="text"
              className="input"
              placeholder="Es. Affitto, Fibra casa, Netflix"
              maxLength={140}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              autoFocus
              required
            />
          </label>

          <div className="field">
            <span className="field-label">Importo e valuta</span>
            <div className="form-row-amount">
              <input
                type="text"
                inputMode="decimal"
                className="input tabular"
                placeholder="0,00"
                aria-label="Importo della ricorrenza"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                required
              />
              <select
                className="select"
                aria-label="Valuta della ricorrenza"
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                  setFixedQuote(directQuote(null));
                }}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} ({c.symbol})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {currency !== baseCurrency && (
            <div className="field fx-box">
              <span className="field-label">Cambio fisso · opzionale</span>
              <RateInput
                key={currency}
                from={currency}
                to={baseCurrency}
                quote={fixedQuote}
                onChange={setFixedQuote}
              />
              <span className="field-hint">
                Lascia vuoto per usare il cambio automatico del giorno di scadenza.
              </span>
            </div>
          )}

          <div className="form-row">
            <label className="field">
              <span className="field-label">Frequenza</span>
              <select
                className="select"
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
              >
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="field-label">Categoria</span>
              <select
                className="select"
                aria-label="Categoria"
                value={selectedCategory?.key ?? ''}
                onChange={(e) => setCategoryKey(e.target.value)}
              >
                {!selectedCategory && <option value="">Scegli una categoria</option>}
                {categories.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.name}
                    {c.hidden ? ' (nascosta)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="form-row">
            <label className="field">
              <span className="field-label">
                {editing ? 'Prossima scadenza' : 'Prima scadenza'}
              </span>
              <input
                type="date"
                className="input tabular"
                value={nextDueDate}
                onChange={(e) => setNextDueDate(e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span className="field-label">
                <span>Ultima data</span>
                <span className="field-hint">Opzionale</span>
              </span>
              <input
                type="date"
                className="input tabular"
                min={nextDueDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>

          <label className="field">
            <span className="field-label">Pagato da</span>
            <select className="select" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
              {activeMembers.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span className="field-label">Ripartizione</span>
            <div className="segmented">
              <button
                type="button"
                className={`segmented-btn ${splitMode === 'equal' ? 'active' : ''}`}
                onClick={() => setSplitMode('equal')}
              >
                Parti uguali
              </button>
              <button
                type="button"
                className={`segmented-btn ${splitMode === 'exact' ? 'active' : ''}`}
                onClick={() => setSplitMode('exact')}
              >
                Importi
              </button>
              <button
                type="button"
                className={`segmented-btn ${splitMode === 'percentage' ? 'active' : ''}`}
                onClick={() => setSplitMode('percentage')}
              >
                Percentuali
              </button>
            </div>

            <div className="split-list" style={{ marginTop: 6 }}>
              {activeMembers.map((m) => {
                const checked = selectedIds.includes(m.userId);
                const s = splitCalc.splits.find((x) => x.userId === m.userId);
                return (
                  <div key={m.userId} className={`split-row ${checked ? '' : 'inactive'}`}>
                    <button
                      type="button"
                      className="split-member-toggle"
                      onClick={() =>
                        setSelectedIds((prev) =>
                          prev.includes(m.userId)
                            ? prev.filter((id) => id !== m.userId)
                            : [...prev, m.userId]
                        )
                      }
                    >
                      <span className={`check-circle ${checked ? 'checked' : ''}`}>
                        {checked && <Check size={13} strokeWidth={2.6} />}
                      </span>
                      <Avatar name={m.displayName} seed={m.userId} size={24} />
                      <span style={{ fontWeight: 550 }}>{m.displayName}</span>
                    </button>

                    {checked && splitMode === 'equal' && (
                      <span className="tabular" style={{ fontWeight: 600 }}>
                        {parsedAmount > 0 && s ? formatMoney(s.amount, currency) : '—'}
                      </span>
                    )}
                    {checked && splitMode === 'exact' && (
                      <div className="split-input-wrap">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="split-input tabular"
                          placeholder="0,00"
                          value={exactInputs[m.userId] ?? ''}
                          onChange={(e) =>
                            setExactInputs((p) => ({ ...p, [m.userId]: e.target.value }))
                          }
                        />
                        <span className="split-unit">{sym}</span>
                      </div>
                    )}
                    {checked && splitMode === 'percentage' && (
                      <div className="split-input-wrap">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="split-input tabular"
                          style={{ width: 74 }}
                          placeholder="0"
                          value={pctInputs[m.userId] ?? ''}
                          onChange={(e) =>
                            setPctInputs((p) => ({ ...p, [m.userId]: e.target.value }))
                          }
                        />
                        <span className="split-unit">%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <label className="field">
            <span className="field-label">
              <span>Nota</span>
              <span className="field-hint">Opzionale</span>
            </span>
            <input
              type="text"
              className="input"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </form>
      </Modal>
    </div>
  );
}
