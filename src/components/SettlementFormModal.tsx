import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { convertToBaseAmount, roundCurrency } from '../lib/accounting';
import {
  CURRENCIES,
  formatMoney,
  formatDecimalInput,
  parseDecimalInput,
} from '../lib/currencies';
import { formatFullDateIT, todayISO } from '../lib/dates';
import { translateErrorIT } from '../lib/supabase';
import { useExchangeRate } from '../lib/useExchangeRate';
import type {
  GroupMember,
  MemberBalance,
  Settlement,
  SettlementInput,
  SimplifiedTransfer,
} from '../types';
import { Modal } from './Modal';
import { RateInput } from './RateInput';

interface SettlementFormModalProps {
  open: boolean;
  onClose: () => void;
  groupId: string;
  baseCurrency: string;
  members: GroupMember[];
  balances: MemberBalance[];
  currentUserId: string;
  editingSettlement: Settlement | null;
  prefillTransfer: SimplifiedTransfer | null;
  onSave: (input: SettlementInput, before?: Settlement) => Promise<void>;
}

export function SettlementFormModal({
  open,
  onClose,
  groupId,
  baseCurrency,
  members,
  balances,
  currentUserId,
  editingSettlement,
  prefillTransfer,
  onSave,
}: SettlementFormModalProps) {
  // Include i membri attivi più eventuali ex membri che hanno ancora un saldo aperto
  const selectableMembers = useMemo(() => {
    const openBalanceIds = new Set(
      balances.filter((b) => Math.abs(b.netBalance) >= 0.01).map((b) => b.userId)
    );
    return members.filter(
      (m) =>
        m.leftAt === null ||
        openBalanceIds.has(m.userId) ||
        m.userId === editingSettlement?.fromUser ||
        m.userId === editingSettlement?.toUser ||
        m.userId === prefillTransfer?.fromUser ||
        m.userId === prefillTransfer?.toUser
    );
  }, [members, balances, editingSettlement, prefillTransfer]);

  const [fromUser, setFromUser] = useState('');
  const [toUser, setToUser] = useState('');
  const [amountStr, setAmountStr] = useState('');
  const [currency, setCurrency] = useState(baseCurrency);
  const [settlementDate, setSettlementDate] = useState(todayISO());
  const [note, setNote] = useState('');

  const fx = useExchangeRate(open, currency, baseCurrency, settlementDate);
  const {
    reset: resetRate,
    rate: parsedRate,
    rateDate,
    manual: rateIsManual,
    loading: fetchingRate,
  } = fx;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // La sincronizzazione non deve resettare i campi già compilati.
  const initializedKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!open) {
      initializedKeyRef.current = null;
      return;
    }
    const initKey = editingSettlement
      ? `edit:${editingSettlement.id}`
      : prefillTransfer
        ? `tr:${prefillTransfer.fromUser}:${prefillTransfer.toUser}:${prefillTransfer.amount}`
        : `new:${groupId}`;
    if (initializedKeyRef.current === initKey) return;
    initializedKeyRef.current = initKey;

    setError(null);
    const today = todayISO();

    resetRate(editingSettlement);
    if (editingSettlement) {
      setFromUser(editingSettlement.fromUser);
      setToUser(editingSettlement.toUser);
      setAmountStr(formatDecimalInput(editingSettlement.amount));
      setCurrency(editingSettlement.currency);
      setSettlementDate(editingSettlement.settlementDate);
      setNote(editingSettlement.note);
    } else if (prefillTransfer) {
      setFromUser(prefillTransfer.fromUser);
      setToUser(prefillTransfer.toUser);
      setAmountStr(formatDecimalInput(prefillTransfer.amount));
      setCurrency(baseCurrency);
      setSettlementDate(today);
      setNote('');
    } else {
      const first =
        selectableMembers.find((m) => m.userId === currentUserId)?.userId ??
        selectableMembers[0]?.userId ??
        '';
      const second = selectableMembers.find((m) => m.userId !== first)?.userId ?? '';
      setFromUser(first);
      setToUser(second);
      setAmountStr('');
      setCurrency(baseCurrency);
      setSettlementDate(today);
      setNote('');
    }
  }, [
    open,
    editingSettlement,
    prefillTransfer,
    baseCurrency,
    selectableMembers,
    currentUserId,
    groupId,
    resetRate,
  ]);

  const parsedAmount = useMemo(() => {
    const v = parseDecimalInput(amountStr);
    return v !== null && v > 0 ? roundCurrency(v, currency) : 0;
  }, [amountStr, currency]);

  const baseAmount =
    editingSettlement &&
    fx.source === 'saved' &&
    currency === editingSettlement.currency &&
    parsedAmount === editingSettlement.amount &&
    parsedRate === editingSettlement.exchangeRate
      ? editingSettlement.baseAmount
      : convertToBaseAmount(parsedAmount, currency, parsedRate, baseCurrency);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!fromUser || !toUser || fromUser === toUser) {
      setError('Seleziona due persone diverse per il rimborso.');
      return;
    }
    if (parsedAmount <= 0) {
      setError('Inserisci un importo maggiore di zero.');
      return;
    }
    if (currency !== baseCurrency && parsedRate <= 0) {
      setError('Inserisci un tasso di cambio valido.');
      return;
    }

    setSaving(true);
    try {
      await onSave(
        {
          id: editingSettlement?.id,
          groupId,
          fromUser,
          toUser,
          amount: parsedAmount,
          currency,
          exchangeRate: currency === baseCurrency ? 1 : parsedRate,
          rateDate: currency === baseCurrency ? settlementDate : rateDate || settlementDate,
          rateIsManual: currency === baseCurrency ? false : rateIsManual,
          baseAmount,
          settlementDate,
          note: note.trim(),
        },
        editingSettlement ?? undefined
      );
      onClose();
    } catch (err) {
      setError(translateErrorIT(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={editingSettlement ? 'Modifica rimborso' : 'Registra rimborso'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            Annulla
          </button>
          <button
            type="submit"
            form="settlement-form"
            className="btn btn-primary"
            disabled={saving || fetchingRate || selectableMembers.length < 2}
          >
            {saving ? 'Salvataggio…' : editingSettlement ? 'Salva modifiche' : 'Registra rimborso'}
          </button>
        </>
      }
    >
      {selectableMembers.length < 2 ? (
        <p className="text-secondary">
          Servono almeno due membri nel gruppo per registrare un rimborso.
        </p>
      ) : (
        <form id="settlement-form" className="form-stack" onSubmit={handleSubmit}>
          {error && <div className="alert alert-error">{error}</div>}

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr auto 1fr',
              gap: 8,
              alignItems: 'end',
            }}
          >
            <label className="field">
              <span className="field-label">Chi ha pagato</span>
              <select
                className="select"
                value={fromUser}
                onChange={(e) => {
                  const val = e.target.value;
                  setFromUser(val);
                  if (val === toUser) {
                    const other = selectableMembers.find((m) => m.userId !== val);
                    if (other) setToUser(other.userId);
                  }
                }}
              >
                {selectableMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                    {m.userId === currentUserId ? ' (tu)' : m.leftAt !== null ? ' (uscito)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <span
              className="text-muted"
              style={{ height: 40, display: 'inline-flex', alignItems: 'center' }}
              aria-hidden="true"
            >
              <ArrowRight size={17} />
            </span>

            <label className="field">
              <span className="field-label">A chi</span>
              <select
                className="select"
                value={toUser}
                onChange={(e) => {
                  const val = e.target.value;
                  setToUser(val);
                  if (val === fromUser) {
                    const other = selectableMembers.find((m) => m.userId !== val);
                    if (other) setFromUser(other.userId);
                  }
                }}
              >
                {selectableMembers.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.displayName}
                    {m.userId === currentUserId ? ' (tu)' : m.leftAt !== null ? ' (uscito)' : ''}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="field">
            <span className="field-label">Importo rimborsato</span>
            <div className="form-row-amount">
              <input
                type="text"
                inputMode="decimal"
                className="input tabular"
                placeholder="0,00"
                aria-label="Importo del rimborso"
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                autoFocus
                required
              />
              <select
                className="select"
                aria-label="Valuta del rimborso"
                value={currency}
                onChange={(e) => {
                  resetRate();
                  setCurrency(e.target.value);
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
            <div className="fx-box">
              <div
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Cambio valuta ({formatFullDateIT(rateDate)})
                </span>
                <button
                  type="button"
                  className="link-btn"
                  style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => resetRate()}
                  disabled={fetchingRate}
                >
                  <RefreshCw size={12} /> {fetchingRate ? 'Aggiorno…' : 'Cambio automatico'}
                </button>
              </div>
              <RateInput
                key={currency}
                from={currency}
                to={baseCurrency}
                quote={fx.quote}
                onChange={fx.write}
              >
                {parsedAmount > 0 && parsedRate > 0 && (
                  <span className="tabular" style={{ marginLeft: 'auto', fontWeight: 650 }}>
                    = {formatMoney(baseAmount, baseCurrency)}
                  </span>
                )}
              </RateInput>
            </div>
          )}

          <label className="field">
            <span className="field-label">Data del rimborso</span>
            <input
              type="date"
              className="input tabular"
              value={settlementDate}
              onChange={(e) => setSettlementDate(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span className="field-label">
              <span>Nota</span>
              <span className="field-hint">Opzionale</span>
            </span>
            <input
              type="text"
              className="input"
              placeholder="Es. Satispay, bonifico, contanti…"
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>

          <p className="field-hint">
            Il rimborso avviene fuori dall&apos;app e aggiorna subito i saldi del gruppo, senza
            richiedere conferma al destinatario. Non viene sommato ai totali di spesa negli
            Insights.
          </p>
        </form>
      )}
    </Modal>
  );
}
