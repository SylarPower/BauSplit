import { Check, Plus, RefreshCw, Repeat } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  computeExpenseSplits,
  convertToBaseAmount,
  roundCurrency,
} from '../lib/accounting';
import {
  buildCategoryOptions,
  CUSTOM_CATEGORY_COLORS,
  CUSTOM_CATEGORY_ICONS,
} from '../lib/categories';
import {
  CURRENCIES,
  fetchExchangeRate,
  formatMoney,
  formatNumberIT,
  formatRateValue,
  getCurrencyInfo,
  parseDecimalInput,
} from '../lib/currencies';
import { formatFullDateIT, todayISO } from '../lib/dates';
import {
  advanceRecurringDate,
  FREQUENCY_OPTIONS,
} from '../lib/recurring';
import { translateErrorIT } from '../lib/supabase';
import type {
  CustomCategory,
  Expense,
  ExpenseInput,
  GroupMember,
  RecurringExpenseInput,
  RecurringFrequency,
  SplitMode,
} from '../types';
import { Avatar, CategoryIcon } from './Icon';
import { Modal } from './Modal';

interface ExpenseFormModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  baseCurrency: string;
  members: GroupMember[];
  currentUserId: string;
  customCategories: CustomCategory[];
  editingExpense: Expense | null;
  onSaveExpense: (input: ExpenseInput, before?: Expense) => Promise<void>;
  onCreateRecurringWithOptionalFirst: (params: {
    recurring: RecurringExpenseInput;
    firstExpense?: ExpenseInput;
  }) => Promise<void>;
  onAddCustomCategory: (params: {
    name: string;
    icon: string;
    color: string;
  }) => Promise<CustomCategory>;
  onToast: (msg: string, isError?: boolean) => void;
}

export function ExpenseFormModal({
  open,
  onClose,
  groupId,
  baseCurrency,
  members,
  currentUserId,
  customCategories,
  editingExpense,
  onSaveExpense,
  onCreateRecurringWithOptionalFirst,
  onAddCustomCategory,
  onToast,
}: ExpenseFormModalProps) {
  const activeMembers = useMemo(
    () => members.filter((m) => m.leftAt === null),
    [members]
  );

  // Include eventuali ex membri coinvolti in una spesa storica in modifica
  const selectableMembers = useMemo(() => {
    if (!editingExpense) return activeMembers;
    const involvedIds = new Set([
      editingExpense.paidBy,
      ...editingExpense.splits.map((s) => s.userId),
    ]);
    return members.filter((m) => m.leftAt === null || involvedIds.has(m.userId));
  }, [activeMembers, editingExpense, members]);

  const categories = useMemo(
    () => buildCategoryOptions(customCategories),
    [customCategories]
  );

  const [description, setDescription] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [expenseDate, setExpenseDate] = useState(todayISO());
  const [categoryKey, setCategoryKey] = useState('spesa');
  const [paidBy, setPaidBy] = useState(currentUserId);
  const [splitMode, setSplitMode] = useState<SplitMode>('equal');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [exactInputs, setExactInputs] = useState<Record<string, string>>({});
  const [pctInputs, setPctInputs] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');

  // Gestione cambio valuta (salvato senza aggiornamenti retroattivi)
  const [rateStr, setRateStr] = useState('1');
  const [rateDate, setRateDate] = useState(todayISO());
  const [rateIsManual, setRateIsManual] = useState(false);
  const [rateSource, setRateSource] = useState<'ecb' | 'fallback' | 'saved'>('ecb');
  const [fetchingRate, setFetchingRate] = useState(false);

  // Opzione ricorrenza (solo in creazione)
  const [isRecurring, setIsRecurring] = useState(false);
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [endDate, setEndDate] = useState('');

  // Creazione rapida categoria personalizzata
  const [showNewCat, setShowNewCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('tag');
  const [newCatColor, setNewCatColor] = useState(CUSTOM_CATEGORY_COLORS[0]);
  const [creatingCat, setCreatingCat] = useState(false);

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Impedisce il ricalcolo automatico del cambio all'apertura di una spesa esistente
  const preserveSavedRateRef = useRef(false);
  // Evita che aggiornamenti Realtime o l'aggiunta di una categoria resettino i campi già compilati
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedKeyRef.current = null;
      return;
    }
    const initKey = editingExpense ? `edit:${editingExpense.id}` : `new:${groupId}`;
    if (initializedKeyRef.current === initKey) return;
    initializedKeyRef.current = initKey;

    setFormError(null);
    setShowNewCat(false);
    setNewCatName('');

    if (editingExpense) {
      preserveSavedRateRef.current = true;
      setDescription(editingExpense.description);
      setAmountStr(formatNumberIT(editingExpense.amount, 2, 0));
      setCurrency(editingExpense.currency);
      setExpenseDate(editingExpense.expenseDate);
      setCategoryKey(editingExpense.category);
      setPaidBy(editingExpense.paidBy);
      setSplitMode(editingExpense.splitMode);
      setSelectedIds(editingExpense.splits.map((s) => s.userId));

      const exacts: Record<string, string> = {};
      const pcts: Record<string, string> = {};
      for (const s of editingExpense.splits) {
        exacts[s.userId] = formatNumberIT(s.amount, 2, 0);
        if (s.percentage !== null) {
          pcts[s.userId] = formatNumberIT(s.percentage, 2, 0);
        }
      }
      setExactInputs(exacts);
      setPctInputs(pcts);
      setNote(editingExpense.note);

      setRateStr(String(editingExpense.exchangeRate).replace('.', ','));
      setRateDate(editingExpense.rateDate);
      setRateIsManual(editingExpense.rateIsManual);
      setRateSource('saved');
      setIsRecurring(false);
      setEndDate('');
    } else {
      preserveSavedRateRef.current = false;
      const today = todayISO();
      const defaultIds = activeMembers.map((m) => m.userId);
      setDescription('');
      setAmountStr('');
      setCurrency(baseCurrency);
      setExpenseDate(today);
      setCategoryKey('spesa');
      setPaidBy(
        defaultIds.includes(currentUserId) ? currentUserId : (defaultIds[0] ?? currentUserId)
      );
      setSplitMode('equal');
      setSelectedIds(defaultIds);
      setExactInputs({});
      const equalPct =
        defaultIds.length > 0 ? formatNumberIT(100 / defaultIds.length, 2, 0) : '100';
      const initialPcts: Record<string, string> = {};
      defaultIds.forEach((id) => {
        initialPcts[id] = equalPct;
      });
      setPctInputs(initialPcts);
      setNote('');
      setRateStr('1');
      setRateDate(today);
      setRateIsManual(false);
      setRateSource('ecb');
      setIsRecurring(false);
      setFrequency('monthly');
      setEndDate('');
    }
  }, [open, editingExpense, baseCurrency, activeMembers, currentUserId]);

  const loadAutoRate = async (fromCur: string, dateForRate: string) => {
    if (fromCur === baseCurrency) {
      setRateStr('1');
      setRateDate(dateForRate);
      setRateIsManual(false);
      setRateSource('ecb');
      return;
    }
    setFetchingRate(true);
    try {
      const res = await fetchExchangeRate(fromCur, baseCurrency, dateForRate);
      setRateStr(String(res.rate).replace('.', ','));
      setRateDate(res.effectiveDate);
      setRateIsManual(false);
      setRateSource(res.source);
    } finally {
      setFetchingRate(false);
    }
  };

  // Cambio automatico alla data della spesa SOLO per nuove spese (o cambio valuta esplicito)
  useEffect(() => {
    if (!open) return;
    if (currency === baseCurrency) {
      setRateStr('1');
      setRateDate(expenseDate);
      setRateIsManual(false);
      return;
    }
    if (preserveSavedRateRef.current || rateIsManual) return;

    let cancelled = false;
    setFetchingRate(true);
    fetchExchangeRate(currency, baseCurrency, expenseDate)
      .then((res) => {
        if (cancelled) return;
        setRateStr(String(res.rate).replace('.', ','));
        setRateDate(res.effectiveDate);
        setRateSource(res.source);
      })
      .finally(() => {
        if (!cancelled) setFetchingRate(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, currency, expenseDate, baseCurrency, rateIsManual]);

  const handleCurrencyChange = (nextCur: string) => {
    preserveSavedRateRef.current = false;
    setRateIsManual(false);
    setCurrency(nextCur);
  };

  const parsedAmount = useMemo(() => {
    const v = parseDecimalInput(amountStr);
    return v !== null && v > 0 ? roundCurrency(v, currency) : 0;
  }, [amountStr, currency]);

  const parsedRate = useMemo(() => {
    if (currency === baseCurrency) return 1;
    const v = parseDecimalInput(rateStr);
    return v !== null && v > 0 ? v : 0;
  }, [currency, baseCurrency, rateStr]);

  const computedBaseAmount = useMemo(() => {
    if (parsedAmount <= 0 || parsedRate <= 0) return 0;
    return convertToBaseAmount(parsedAmount, currency, parsedRate, baseCurrency);
  }, [parsedAmount, currency, parsedRate, baseCurrency]);

  const exactNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of selectedIds) {
      const v = parseDecimalInput(exactInputs[id] ?? '');
      out[id] = v !== null ? v : 0;
    }
    return out;
  }, [selectedIds, exactInputs]);

  const pctNumbers = useMemo(() => {
    const out: Record<string, number> = {};
    for (const id of selectedIds) {
      const v = parseDecimalInput(pctInputs[id] ?? '');
      out[id] = v !== null ? v : 0;
    }
    return out;
  }, [selectedIds, pctInputs]);

  const splitCalc = useMemo(
    () =>
      computeExpenseSplits({
        totalAmount: parsedAmount,
        currency,
        totalBaseAmount: computedBaseAmount,
        baseCurrency,
        splitMode,
        participantIds: selectedIds,
        exactAmounts: exactNumbers,
        percentages: pctNumbers,
      }),
    [
      parsedAmount,
      currency,
      computedBaseAmount,
      baseCurrency,
      splitMode,
      selectedIds,
      exactNumbers,
      pctNumbers,
    ]
  );

  const toggleParticipant = (userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]
    );
  };

  const handleSplitModeChange = (next: SplitMode) => {
    if (next === 'exact' && parsedAmount > 0 && selectedIds.length > 0) {
      const hasAny = selectedIds.some((id) => (parseDecimalInput(exactInputs[id] ?? '') ?? 0) > 0);
      if (!hasAny) {
        const eq = computeExpenseSplits({
          totalAmount: parsedAmount,
          currency,
          totalBaseAmount: computedBaseAmount || parsedAmount,
          baseCurrency,
          splitMode: 'equal',
          participantIds: selectedIds,
        });
        const nextExacts: Record<string, string> = { ...exactInputs };
        for (const s of eq.splits) {
          nextExacts[s.userId] = formatNumberIT(s.amount, 2, 0);
        }
        setExactInputs(nextExacts);
      }
    }
    if (next === 'percentage' && selectedIds.length > 0) {
      const sum = selectedIds.reduce(
        (acc, id) => acc + (parseDecimalInput(pctInputs[id] ?? '') ?? 0),
        0
      );
      if (sum <= 0) {
        distributeEqualPercentages(selectedIds);
      }
    }
    setSplitMode(next);
  };

  const distributeEqualPercentages = (ids: string[]) => {
    if (ids.length === 0) return;
    const base = Math.floor((10000 / ids.length)) / 100;
    const next: Record<string, string> = {};
    let assigned = 0;
    ids.forEach((id, idx) => {
      if (idx === ids.length - 1) {
        const last = Number((100 - assigned).toFixed(2));
        next[id] = formatNumberIT(last, 2, 0);
      } else {
        next[id] = formatNumberIT(base, 2, 0);
        assigned += base;
      }
    });
    setPctInputs((prev) => ({ ...prev, ...next }));
  };

  const assignRemainingExactTo = (targetId: string) => {
    const current = exactNumbers[targetId] ?? 0;
    const updated = roundCurrency(Math.max(0, current + splitCalc.remaining), currency);
    setExactInputs((prev) => ({
      ...prev,
      [targetId]: formatNumberIT(updated, 2, 0),
    }));
  };

  const handleQuickCreateCategory = async () => {
    if (!newCatName.trim()) return;
    setCreatingCat(true);
    try {
      const created = await onAddCustomCategory({
        name: newCatName.trim(),
        icon: newCatIcon,
        color: newCatColor,
      });
      setCategoryKey(`custom:${created.id}`);
      setNewCatName('');
      setShowNewCat(false);
      onToast(`Categoria "${created.name}" aggiunta`);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setCreatingCat(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const cleanDesc = description.trim();
    if (!cleanDesc) {
      setFormError('Inserisci una descrizione per la spesa.');
      return;
    }
    if (parsedAmount <= 0) {
      setFormError('Inserisci un importo valido maggiore di zero.');
      return;
    }
    if (currency !== baseCurrency && parsedRate <= 0) {
      setFormError('Inserisci un tasso di cambio valido maggiore di zero.');
      return;
    }
    if (!splitCalc.valid) {
      setFormError(splitCalc.error ?? 'Controlla la ripartizione tra i partecipanti.');
      return;
    }
    if (isRecurring && endDate && endDate < expenseDate) {
      setFormError('La data di fine ricorrenza non può precedere la data della spesa.');
      return;
    }

    const chosenCat = categories.find((c) => c.key === categoryKey);
    const categoryLabel =
      chosenCat?.name ??
      (editingExpense && editingExpense.category === categoryKey
        ? editingExpense.categoryLabel
        : 'Altro');

    const expensePayload: ExpenseInput = {
      id: editingExpense?.id,
      groupId,
      description: cleanDesc,
      amount: parsedAmount,
      currency,
      exchangeRate: currency === baseCurrency ? 1 : parsedRate,
      rateDate: currency === baseCurrency ? expenseDate : rateDate || expenseDate,
      rateIsManual: currency === baseCurrency ? false : rateIsManual,
      baseAmount: computedBaseAmount,
      expenseDate,
      category: categoryKey,
      categoryLabel,
      paidBy,
      splitMode,
      splits: splitCalc.splits,
      note: note.trim(),
    };

    setSaving(true);
    try {
      if (!editingExpense && isRecurring) {
        const today = todayISO();
        const registerImmediately = expenseDate <= today;
        const nextDue = registerImmediately
          ? advanceRecurringDate(expenseDate, frequency, expenseDate)
          : expenseDate;
        const stillActive = !endDate || nextDue <= endDate;

        const recurringPayload: RecurringExpenseInput = {
          groupId,
          description: cleanDesc,
          amount: parsedAmount,
          currency,
          fixedExchangeRate:
            currency !== baseCurrency && rateIsManual ? parsedRate : null,
          category: categoryKey,
          categoryLabel,
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
          startDate: expenseDate,
          nextDueDate: nextDue,
          endDate: endDate || null,
          active: stillActive,
        };

        await onCreateRecurringWithOptionalFirst({
          recurring: recurringPayload,
          firstExpense: registerImmediately ? expensePayload : undefined,
        });
      } else {
        await onSaveExpense(expensePayload, editingExpense ?? undefined);
      }
      onClose();
    } catch (err) {
      setFormError(translateErrorIT(err));
    } finally {
      setSaving(false);
    }
  };

  const currencySymbol = getCurrencyInfo(currency).symbol;
  const showDateRateSyncButton =
    Boolean(editingExpense) &&
    currency !== baseCurrency &&
    preserveSavedRateRef.current &&
    expenseDate !== editingExpense?.expenseDate;

  return (
    <Modal
      open={open}
      title={editingExpense ? 'Modifica spesa' : 'Nuova spesa'}
      onClose={onClose}
      wide
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button
            type="submit"
            form="expense-form"
            className="btn btn-primary"
            disabled={saving || fetchingRate}
          >
            {saving
              ? 'Salvataggio…'
              : editingExpense
                ? 'Salva modifiche'
                : isRecurring
                  ? 'Salva spesa ricorrente'
                  : 'Aggiungi spesa'}
          </button>
        </>
      }
    >
      <form id="expense-form" className="form-stack" onSubmit={handleSubmit}>
        {formError && <div className="alert alert-error">{formError}</div>}

        <label className="field">
          <span className="field-label">Descrizione</span>
          <input
            type="text"
            className="input"
            placeholder="Es. Spesa supermercato, Cena pizzeria, Benzina"
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
              value={amountStr}
              onChange={(e) => setAmountStr(e.target.value)}
              required
            />
            <select
              className="select"
              value={currency}
              onChange={(e) => handleCurrencyChange(e.target.value)}
              aria-label="Valuta della spesa"
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} ({c.symbol})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Riquadro tasso di cambio quando la valuta differisce da quella di riferimento del gruppo */}
        {currency !== baseCurrency && (
          <div className="fx-box">
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>
                Cambio verso {baseCurrency}{' '}
                {rateIsManual ? (
                  <span className="badge badge-warning" style={{ marginLeft: 4 }}>
                    Manuale
                  </span>
                ) : rateSource === 'saved' ? (
                  <span className="badge" style={{ marginLeft: 4 }}>
                    Salvato ({formatFullDateIT(rateDate)})
                  </span>
                ) : rateSource === 'fallback' ? (
                  <span className="badge badge-warning" style={{ marginLeft: 4 }}>
                    Indicativo (modificabile)
                  </span>
                ) : (
                  <span className="badge badge-accent" style={{ marginLeft: 4 }}>
                    BCE · {formatFullDateIT(rateDate)}
                  </span>
                )}
              </span>

              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                onClick={() => {
                  preserveSavedRateRef.current = false;
                  loadAutoRate(currency, expenseDate);
                }}
                disabled={fetchingRate}
              >
                <RefreshCw size={12} />
                {fetchingRate
                  ? 'Aggiorno…'
                  : showDateRateSyncButton
                    ? `Usa cambio del ${formatFullDateIT(expenseDate)}`
                    : 'Cambio automatico'}
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span className="tabular" style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
                1 {currency} =
              </span>
              <input
                type="text"
                inputMode="decimal"
                className="input input-sm tabular"
                style={{ width: 126 }}
                value={rateStr}
                onChange={(e) => {
                  preserveSavedRateRef.current = false;
                  setRateIsManual(true);
                  setRateDate(expenseDate);
                  setRateStr(e.target.value);
                }}
                aria-label="Tasso di cambio"
              />
              <span style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>{baseCurrency}</span>
              {parsedAmount > 0 && parsedRate > 0 && (
                <span
                  className="tabular"
                  style={{ marginLeft: 'auto', fontSize: 13.5, fontWeight: 650 }}
                >
                  = {formatMoney(computedBaseAmount, baseCurrency)}
                </span>
              )}
            </div>

            <span className="field-hint">
              Il tasso viene salvato su questa spesa e non subirà variazioni retroattive.
              {rateSource === 'fallback' &&
                ' Non è stato possibile scaricare la quotazione BCE: verifica o inserisci il cambio desiderato.'}
            </span>
          </div>
        )}

        <div className="form-row">
          <label className="field">
            <span className="field-label">Data</span>
            <input
              type="date"
              className="input tabular"
              value={expenseDate}
              onChange={(e) => setExpenseDate(e.target.value)}
              required
            />
          </label>

          <div className="field">
            <span className="field-label">
              <span>Categoria</span>
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 2 }}
                onClick={() => setShowNewCat((v) => !v)}
              >
                <Plus size={13} />
                {showNewCat ? 'Chiudi' : 'Nuova'}
              </button>
            </span>
            <select
              className="select"
              value={categoryKey}
              onChange={(e) => setCategoryKey(e.target.value)}
            >
              {categories.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                  {c.isCustom ? ' ★' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {showNewCat && (
          <div className="fx-box">
            <div style={{ fontSize: 13, fontWeight: 600 }}>Nuova categoria per il gruppo</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                className="input input-sm"
                placeholder="Es. Animali, Palestra, Giardino"
                maxLength={40}
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
              />
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleQuickCreateCategory}
                disabled={creatingCat || !newCatName.trim()}
              >
                {creatingCat ? 'Creo…' : 'Aggiungi'}
              </button>
            </div>
            <div className="swatch-row">
              {CUSTOM_CATEGORY_ICONS.map((ic) => (
                <button
                  key={ic.id}
                  type="button"
                  title={ic.label}
                  className={`icon-swatch ${newCatIcon === ic.id ? 'active' : ''}`}
                  onClick={() => setNewCatIcon(ic.id)}
                >
                  <CategoryIcon
                    icon={ic.id}
                    color={newCatIcon === ic.id ? newCatColor : '#57534e'}
                    size={16}
                  />
                </button>
              ))}
            </div>
            <div className="swatch-row">
              {CUSTOM_CATEGORY_COLORS.map((col) => (
                <button
                  key={col}
                  type="button"
                  className={`color-swatch ${newCatColor === col ? 'active' : ''}`}
                  style={{ backgroundColor: col }}
                  onClick={() => setNewCatColor(col)}
                  aria-label={`Colore ${col}`}
                />
              ))}
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">Pagato da</span>
          <select
            className="select"
            value={paidBy}
            onChange={(e) => setPaidBy(e.target.value)}
          >
            {selectableMembers.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
                {m.userId === currentUserId ? ' (tu)' : ''}
                {m.leftAt ? ' (ex membro)' : ''}
              </option>
            ))}
          </select>
        </label>

        {/* Ripartizione */}
        <div className="field">
          <span className="field-label">
            <span>Come dividere la spesa</span>
            {selectedIds.length < selectableMembers.length && (
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12.5 }}
                onClick={() => setSelectedIds(selectableMembers.map((m) => m.userId))}
              >
                Seleziona tutti
              </button>
            )}
          </span>

          <div className="segmented">
            <button
              type="button"
              className={`segmented-btn ${splitMode === 'equal' ? 'active' : ''}`}
              onClick={() => handleSplitModeChange('equal')}
            >
              Parti uguali
            </button>
            <button
              type="button"
              className={`segmented-btn ${splitMode === 'exact' ? 'active' : ''}`}
              onClick={() => handleSplitModeChange('exact')}
            >
              Importi
            </button>
            <button
              type="button"
              className={`segmented-btn ${splitMode === 'percentage' ? 'active' : ''}`}
              onClick={() => handleSplitModeChange('percentage')}
            >
              Percentuali
            </button>
          </div>

          <div className="split-list" style={{ marginTop: 6 }}>
            {selectableMembers.map((m) => {
              const checked = selectedIds.includes(m.userId);
              const splitItem = splitCalc.splits.find((s) => s.userId === m.userId);

              return (
                <div key={m.userId} className={`split-row ${checked ? '' : 'inactive'}`}>
                  <button
                    type="button"
                    className="split-member-toggle"
                    onClick={() => toggleParticipant(m.userId)}
                  >
                    <span className={`check-circle ${checked ? 'checked' : ''}`}>
                      {checked && <Check size={13} strokeWidth={2.6} />}
                    </span>
                    <Avatar name={m.displayName} seed={m.userId} size={26} />
                    <span style={{ fontWeight: 550, fontSize: 14 }}>
                      {m.displayName}
                      {m.userId === currentUserId && (
                        <span className="text-muted" style={{ fontWeight: 400 }}>
                          {' '}
                          (tu)
                        </span>
                      )}
                    </span>
                  </button>

                  {checked && splitMode === 'equal' && (
                    <div className="tabular" style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>
                        {parsedAmount > 0 && splitItem
                          ? formatMoney(splitItem.amount, currency)
                          : '—'}
                      </div>
                      {currency !== baseCurrency && parsedAmount > 0 && splitItem && (
                        <div className="field-hint">
                          {formatMoney(splitItem.baseAmount, baseCurrency)}
                        </div>
                      )}
                    </div>
                  )}

                  {checked && splitMode === 'exact' && (
                    <div className="split-input-wrap">
                      {Math.abs(splitCalc.remaining) >= 0.01 && parsedAmount > 0 && (
                        <button
                          type="button"
                          className="link-btn"
                          style={{ fontSize: 11.5 }}
                          onClick={() => assignRemainingExactTo(m.userId)}
                          title="Assegna la differenza residua a questa persona"
                        >
                          +resto
                        </button>
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        className="split-input tabular"
                        placeholder="0,00"
                        value={exactInputs[m.userId] ?? ''}
                        onChange={(e) =>
                          setExactInputs((prev) => ({
                            ...prev,
                            [m.userId]: e.target.value,
                          }))
                        }
                        aria-label={`Importo per ${m.displayName}`}
                      />
                      <span className="split-unit">{currencySymbol}</span>
                    </div>
                  )}

                  {checked && splitMode === 'percentage' && (
                    <div className="split-input-wrap">
                      {parsedAmount > 0 && splitItem && (
                        <span className="field-hint tabular" style={{ marginRight: 4 }}>
                          {formatMoney(splitItem.amount, currency)}
                        </span>
                      )}
                      <input
                        type="text"
                        inputMode="decimal"
                        className="split-input tabular"
                        style={{ width: 74 }}
                        placeholder="0"
                        value={pctInputs[m.userId] ?? ''}
                        onChange={(e) =>
                          setPctInputs((prev) => ({
                            ...prev,
                            [m.userId]: e.target.value,
                          }))
                        }
                        aria-label={`Percentuale per ${m.displayName}`}
                      />
                      <span className="split-unit">%</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {splitMode === 'exact' && parsedAmount > 0 && selectedIds.length > 0 && (
            <div
              className="field-hint tabular"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                color:
                  Math.abs(splitCalc.remaining) < 0.005
                    ? 'var(--positive)'
                    : 'var(--negative)',
              }}
            >
              <span>
                {Math.abs(splitCalc.remaining) < 0.005
                  ? 'Somma quote corretta'
                  : splitCalc.remaining > 0
                    ? `Restano da assegnare ${formatMoney(splitCalc.remaining, currency)}`
                    : `Supera il totale di ${formatMoney(Math.abs(splitCalc.remaining), currency)}`}
              </span>
              <span>Totale: {formatMoney(parsedAmount, currency)}</span>
            </div>
          )}

          {splitMode === 'percentage' && selectedIds.length > 0 && (
            <div
              className="field-hint tabular"
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  color:
                    Math.abs(splitCalc.remaining) <= 0.02
                      ? 'var(--positive)'
                      : 'var(--negative)',
                }}
              >
                {Math.abs(splitCalc.remaining) <= 0.02
                  ? 'Totale: 100%'
                  : splitCalc.remaining > 0
                    ? `Manca il ${formatNumberIT(splitCalc.remaining, 2)}% per arrivare al 100%`
                    : `Supera il 100% di ${formatNumberIT(Math.abs(splitCalc.remaining), 2)}%`}
              </span>
              <button
                type="button"
                className="link-btn"
                style={{ fontSize: 12 }}
                onClick={() => distributeEqualPercentages(selectedIds)}
              >
                Dividi equamente
              </button>
            </div>
          )}
        </div>

        {/* Opzione spesa ricorrente (solo in creazione) */}
        {!editingExpense && (
          <div className="fx-box" style={{ background: isRecurring ? 'var(--accent-soft)' : undefined }}>
            <button
              type="button"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                width: '100%',
                textAlign: 'left',
              }}
              onClick={() => setIsRecurring((v) => !v)}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 550 }}>
                <Repeat size={15} style={{ color: 'var(--accent)' }} />
                Ripeti automaticamente (affitto, bollette, abbonamenti)
              </span>
              <span className={`check-circle ${isRecurring ? 'checked' : ''}`}>
                {isRecurring && <Check size={13} strokeWidth={2.6} />}
              </span>
            </button>

            {isRecurring && (
              <div className="form-row" style={{ marginTop: 6 }}>
                <label className="field">
                  <span className="field-label">Frequenza</span>
                  <select
                    className="select select-sm"
                    value={frequency}
                    onChange={(e) => setFrequency(e.target.value as RecurringFrequency)}
                  >
                    {FREQUENCY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span className="field-label">
                    <span>Fine ricorrenza</span>
                    <span className="field-hint">Opz.</span>
                  </span>
                  <input
                    type="date"
                    className="input input-sm tabular"
                    value={endDate}
                    min={expenseDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        )}

        <label className="field">
          <span className="field-label">
            <span>Nota</span>
            <span className="field-hint">Opzionale</span>
          </span>
          <input
            type="text"
            className="input"
            placeholder="Aggiungi un dettaglio se utile…"
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        {editingExpense && currency !== baseCurrency && !rateIsManual && (
          <p className="field-hint" style={{ marginTop: -6 }}>
            Cambio salvato: 1 {currency} = {formatRateValue(parsedRate)} {baseCurrency}
          </p>
        )}
      </form>
    </Modal>
  );
}
