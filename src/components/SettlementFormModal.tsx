import { ArrowRight, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { convertToBaseAmount, roundCurrency } from '../lib/accounting';
import {
  CURRENCIES,
  fetchExchangeRate,
  formatMoney,
  formatNumberIT,
  parseDecimalInput,
} from '../lib/currencies';
import { formatFullDateIT, todayISO } from '../lib/dates';
import { translateErrorIT } from '../lib/supabase';
import type {
  GroupMember,
  MemberBalance,
  Settlement,
  SettlementInput,
  SimplifiedTransfer,
} from '../types';
import { Modal } from './Modal';

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

  const [rateStr, setRateStr] = useState('1');
  const [rateDate, setRateDate] = useState(todayISO());
  const [rateIsManual, setRateIsManual] = useState(false);
  const [fetchingRate, setFetchingRate] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const preserveSavedRateRef = useRef(false);
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

    if (editingSettlement) {
      preserveSavedRateRef.current = true;
      setFromUser(editingSettlement.fromUser);
      setToUser(editingSettlement.toUser);
      setAmountStr(formatNumberIT(editingSettlement.amount, 2, 0));
      setCurrency(editingSettlement.currency);
      setSettlementDate(editingSettlement.settlementDate);
      setNote(editingSettlement.note);
      setRateStr(String(editingSettlement.exchangeRate).replace('.', ','));
      setRateDate(editingSettlement.rateDate);
      setRateIsManual(editingSettlement.rateIsManual);
    } else if (prefillTransfer) {
      preserveSavedRateRef.current = false;
      setFromUser(prefillTransfer.fromUser);
      setToUser(prefillTransfer.toUser);
      setAmountStr(formatNumberIT(prefillTransfer.amount, 2, 0));
      setCurrency(baseCurrency);
      setSettlementDate(today);
      setNote('');
      setRateStr('1');
      setRateDate(today);
      setRateIsManual(false);
    } else {
      preserveSavedRateRef.current = false;
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
      setRateStr('1');
      setRateDate(today);
      setRateIsManual(false);
    }
  }, [open, editingSettlement, prefillTransfer, baseCurrency, selectableMembers, currentUserId]);

  useEffect(() => {
    if (!open) return;
    if (currency === baseCurrency) {
      setRateStr('1');
      setRateDate(settlementDate);
      setRateIsManual(false);
      return;
    }
    if (preserveSavedRateRef.current || rateIsManual) return;

    let cancelled = false;
    setFetchingRate(true);
    fetchExchangeRate(currency, baseCurrency, settlementDate)
      .then((res) => {
        if (cancelled) return;
        setRateStr(String(res.rate).replace('.', ','));
        setRateDate(res.effectiveDate);
      })
      .finally(() => {
        if (!cancelled) setFetchingRate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, currency, settlementDate, baseCurrency, rateIsManual]);

  const parsedAmount = useMemo(() => {
    const v = parseDecimalInput(amountStr);
    return v !== null && v > 0 ? roundCurrency(v, currency) : 0;
  }, [amountStr, currency]);

  const parsedRate = useMemo(() => {
    if (currency === baseCurrency) return 1;
    const v = parseDecimalInput(rateStr);
    return v !== null && v > 0 ? v : 0;
  }, [currency, baseCurrency, rateStr]);

  const baseAmount = useMemo(() => {
    if (parsedAmount <= 0 || parsedRate <= 0) return 0;
    return convertToBaseAmount(parsedAmount, currency, parsedRate, baseCurrency);
  }, [parsedAmount, currency, parsedRate, baseCurrency]);

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
            {saving
              ? 'Salvataggio…'
              : editingSettlement
                ? 'Salva modifiche'
                : 'Registra rimborso'}
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
                value={amountStr}
                onChange={(e) => setAmountStr(e.target.value)}
                autoFocus
                required
              />
              <select
                className="select"
                value={currency}
                onChange={(e) => {
                  preserveSavedRateRef.current = false;
                  setRateIsManual(false);
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
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>
                  Cambio verso {baseCurrency} ({formatFullDateIT(rateDate)})
                </span>
                <button
                  type="button"
                  className="link-btn"
                  style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  onClick={() => {
                    preserveSavedRateRef.current = false;
                    setRateIsManual(false);
                  }}
                >
                  <RefreshCw size={12} /> Automatico
                </button>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 13.5 }}>1 {currency} =</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input input-sm tabular"
                  style={{ width: 120 }}
                  value={rateStr}
                  onChange={(e) => {
                    preserveSavedRateRef.current = false;
                    setRateIsManual(true);
                    setRateStr(e.target.value);
                  }}
                />
                <span style={{ fontSize: 13.5 }}>{baseCurrency}</span>
                {parsedAmount > 0 && parsedRate > 0 && (
                  <span className="tabular" style={{ marginLeft: 'auto', fontWeight: 650 }}>
                    = {formatMoney(baseAmount, baseCurrency)}
                  </span>
                )}
              </div>
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
            richiedere conferma al destinatario. Non viene sommato ai totali di spesa negli Insights.
          </p>
        </form>
      )}
    </Modal>
  );
}
