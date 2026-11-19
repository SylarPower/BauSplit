import { Archive, ArrowLeftRight, ArrowRight, CheckCircle2, Pencil } from 'lucide-react';
import { roundCurrency } from '../lib/accounting';
import {
  CURRENCIES,
  formatMoney,
  formatRateValue,
  type ExchangeRateResult,
} from '../lib/currencies';
import { formatFullDateIT } from '../lib/dates';
import type {
  MemberBalance,
  Settlement,
  SimplifiedTransfer,
} from '../types';
import { Avatar } from './Icon';

interface BalancesTabProps {
  isClosed: boolean;
  isEvent?: boolean;
  baseCurrency: string;
  displayCurrency: string;
  onDisplayCurrencyChange: (currency: string) => void;
  displayRate: ExchangeRateResult | null;
  loadingDisplayRate: boolean;
  currentUserId: string;
  balances: MemberBalance[];
  transfers: SimplifiedTransfer[];
  settlements: Settlement[];
  nameOf: (userId: string) => string;
  onSettleTransfer: (transfer: SimplifiedTransfer) => void;
  onNewCustomSettlement: () => void;
  onEditSettlement: (st: Settlement) => void;
  onOpenCloseGroup: () => void;
}

export function BalancesTab({
  isClosed,
  isEvent = false,
  baseCurrency,
  displayCurrency,
  onDisplayCurrencyChange,
  displayRate,
  loadingDisplayRate,
  currentUserId,
  balances,
  transfers,
  settlements,
  nameOf,
  onSettleTransfer,
  onNewCustomSettlement,
  onEditSettlement,
  onOpenCloseGroup,
}: BalancesTabProps) {
  const isConvertedView =
    displayCurrency !== baseCurrency && displayRate !== null && displayRate.rate > 0;
  const fx = isConvertedView ? displayRate.rate : 1;
  const shownCurrency = isConvertedView ? displayCurrency : baseCurrency;

  const formatDisplayAmount = (baseVal: number, signed = false) => {
    const converted = isConvertedView ? roundCurrency(baseVal * fx, shownCurrency) : baseVal;
    return formatMoney(converted, shownCurrency, { signed });
  };

  const maxAbsBalance = Math.max(
    ...balances.map((b) => Math.abs(b.netBalance)),
    0.01
  );

  return (
    <div className="section-stack">
      {/* Selettore valuta di visualizzazione dei saldi (non modifica la contabilità del gruppo) */}
      <div
        className="card"
        style={{
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 14,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div style={{ fontSize: 13.8, fontWeight: 600 }}>Valuta di visualizzazione dei saldi</div>
          <div className="field-hint tabular">
            {displayCurrency === baseCurrency ? (
              <>
                Contabilità del gruppo in <strong>{baseCurrency}</strong>. Puoi visualizzare i saldi
                in un&apos;altra valuta senza modificare i conti.
              </>
            ) : loadingDisplayRate ? (
              <>Conversione in {displayCurrency} in corso…</>
            ) : displayRate ? (
              <>
                Solo visualizzazione (1 {baseCurrency} = {formatRateValue(displayRate.rate)}{' '}
                {displayCurrency}
                {displayRate.source === 'fallback'
                  ? ', cambio indicativo'
                  : ` · BCE ${formatFullDateIT(displayRate.effectiveDate)}`}
                ). La contabilità resta in <strong>{baseCurrency}</strong>.
              </>
            ) : null}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {displayCurrency !== baseCurrency && (
            <button
              type="button"
              className="link-btn"
              style={{ fontSize: 12.5 }}
              onClick={() => onDisplayCurrencyChange(baseCurrency)}
            >
              Torna a {baseCurrency}
            </button>
          )}
          <select
            className="select select-sm"
            style={{ width: 'auto', minWidth: 150 }}
            value={displayCurrency}
            onChange={(e) => onDisplayCurrencyChange(e.target.value)}
            aria-label="Valuta di visualizzazione dei saldi"
          >
            {CURRENCIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.code} ({c.symbol}){c.code === baseCurrency ? ' · Base' : ''}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Piano semplificato di rimborso */}
      <section>
        <div className="section-head">
          <div>
            <h2 className="section-title">Come pareggiare i conti</h2>
            <p className="field-hint">
              Saldi compensati tra tutti i partecipanti per ridurre il numero di pagamenti.
            </p>
          </div>
          {!isClosed && balances.length >= 2 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={onNewCustomSettlement}
            >
              <ArrowLeftRight size={14} />
              Registra rimborso
            </button>
          )}
        </div>

        {transfers.length === 0 ? (
          <div className="card empty-state" style={{ padding: '32px 20px' }}>
            <span
              className="empty-icon"
              style={{ background: 'var(--positive-soft)', color: 'var(--positive)' }}
            >
              <CheckCircle2 size={22} />
            </span>
            <h3 className="empty-title">Tutto in pari</h3>
            <p className="empty-desc">
              Non ci sono importi in sospeso tra i membri di questo gruppo.
            </p>
          </div>
        ) : (
          <div className="card">
            {transfers.map((tr) => {
              const isMeDebtor = tr.fromUser === currentUserId;
              const isMeCreditor = tr.toUser === currentUserId;

              return (
                <div key={`${tr.fromUser}-${tr.toUser}`} className="transfer-row">
                  <div className="transfer-people">
                    <Avatar name={tr.fromName} seed={tr.fromUser} size={32} />
                    <div>
                      <div style={{ fontSize: 14.5 }}>
                        <strong>{isMeDebtor ? 'Tu' : tr.fromName}</strong>{' '}
                        <span className="text-secondary">
                          {isMeDebtor ? 'devi a' : 'deve a'}
                        </span>{' '}
                        <strong>{isMeCreditor ? 'te' : tr.toName}</strong>
                      </div>
                      {isConvertedView && (
                        <div className="field-hint tabular">
                          Importo contabile: {formatMoney(tr.amount, baseCurrency)}
                        </div>
                      )}
                    </div>
                    <ArrowRight size={15} className="text-muted" />
                    <Avatar name={tr.toName} seed={tr.toUser} size={32} />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
                    <span
                      className={`tabular ${
                        isMeCreditor
                          ? 'text-positive'
                          : isMeDebtor
                            ? 'text-negative'
                            : ''
                      }`}
                      style={{ fontSize: 17, fontWeight: 700 }}
                    >
                      {formatDisplayAmount(tr.amount)}
                    </span>
                    {!isClosed && (
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => onSettleTransfer(tr)}
                      >
                        Segna rimborso
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {!isClosed && !isEvent && (
              <div
                style={{
                  padding: '11px 18px',
                  borderTop: '1px solid var(--border)',
                  background: 'var(--bg-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  flexWrap: 'wrap',
                  fontSize: 13,
                }}
              >
                <span className="text-secondary">
                  Viaggio o progetto finito? Puoi chiudere il gruppo e spostare questo saldo in un
                  altro gruppo condiviso.
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={onOpenCloseGroup}
                >
                  <Archive size={13} />
                  Chiudi e sposta saldo
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      {/* Saldo netto di ciascun membro */}
      <section>
        <div className="section-head">
          <h2 className="section-title">Saldo per persona</h2>
        </div>

        <div className="card">
          {balances.map((b) => {
            const isPos = b.netBalance > 0.005;
            const isNeg = b.netBalance < -0.005;
            const pct = Math.min(100, Math.round((Math.abs(b.netBalance) / maxAbsBalance) * 100));

            return (
              <div key={b.userId} className="member-balance-row">
                <div className="member-balance-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <Avatar name={b.displayName} seed={b.userId} size={32} />
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14.5 }}>
                        {b.displayName}
                        {b.userId === currentUserId && (
                          <span className="text-muted" style={{ fontWeight: 400 }}>
                            {' '}
                            (tu)
                          </span>
                        )}
                      </span>
                      {!b.isActive && (
                        <span className="badge" style={{ marginLeft: 6 }}>
                          Ex membro
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="tabular" style={{ textAlign: 'right' }}>
                    <div
                      className={
                        isPos ? 'text-positive' : isNeg ? 'text-negative' : 'text-secondary'
                      }
                      style={{ fontWeight: 700, fontSize: 15.5 }}
                    >
                      {isPos || isNeg ? formatDisplayAmount(b.netBalance, true) : 'In pari'}
                    </div>
                    {isConvertedView && (isPos || isNeg) && (
                      <div className="field-hint">
                        {formatMoney(b.netBalance, baseCurrency, { signed: true })}
                      </div>
                    )}
                  </div>
                </div>

                {(isPos || isNeg) && (
                  <div className="progress-track">
                    <div
                      className="progress-fill"
                      style={{
                        width: `${pct}%`,
                        backgroundColor: isPos ? 'var(--positive)' : 'var(--negative)',
                      }}
                    />
                  </div>
                )}

                <div className="member-balance-stats tabular">
                  <span>Anticipato: {formatDisplayAmount(b.totalPaid)}</span>
                  <span>·</span>
                  <span>Quota spese: {formatDisplayAmount(b.totalShare)}</span>
                  {(b.settlementsSent > 0 || b.settlementsReceived > 0) && (
                    <>
                      <span>·</span>
                      <span>
                        Rimborsi:{' '}
                        {b.settlementsSent > 0
                          ? `inviati ${formatDisplayAmount(b.settlementsSent)}`
                          : ''}
                        {b.settlementsSent > 0 && b.settlementsReceived > 0 ? ', ' : ''}
                        {b.settlementsReceived > 0
                          ? `ricevuti ${formatDisplayAmount(b.settlementsReceived)}`
                          : ''}
                      </span>
                    </>
                  )}
                  {Math.abs(b.transfersNet) >= 0.01 && (
                    <>
                      <span>·</span>
                      <span>
                        Saldi riportati: {formatDisplayAmount(b.transfersNet, true)}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Ultimi rimborsi e trasferimenti di saldo */}
      {settlements.length > 0 && (
        <section>
          <div className="section-head">
            <h2 className="section-title">
              Rimborsi e trasferimenti ({settlements.length})
            </h2>
          </div>
          <div className="card">
            {settlements.slice(0, 10).map((st) => {
              const isIn = st.kind === 'transfer_in';
              const isOut = st.kind === 'transfer_out';
              return (
                <div key={st.id} className="transfer-row">
                  <div>
                    <div style={{ fontSize: 14, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      {isIn ? (
                        <>
                          <strong>{nameOf(st.toUser)}</strong>{' '}
                          <span className="text-secondary">deve a</span>{' '}
                          <strong>{nameOf(st.fromUser)}</strong>
                          <span className="badge badge-accent">Saldo riportato</span>
                        </>
                      ) : isOut ? (
                        <>
                          <strong>{nameOf(st.fromUser)}</strong>{' '}
                          <span className="text-secondary">→</span>{' '}
                          <strong>{nameOf(st.toUser)}</strong>
                          <span className="badge badge-accent">Spostato in altro gruppo</span>
                        </>
                      ) : (
                        <>
                          <strong>{nameOf(st.fromUser)}</strong>{' '}
                          <span className="text-secondary">ha rimborsato</span>{' '}
                          <strong>{nameOf(st.toUser)}</strong>
                        </>
                      )}
                    </div>
                    <div className="field-hint">
                      {formatFullDateIT(st.settlementDate)}
                      {st.note ? ` · ${st.note}` : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div className="tabular" style={{ textAlign: 'right' }}>
                      <div
                        className={isIn || isOut ? '' : 'text-positive'}
                        style={{ fontWeight: 650 }}
                      >
                        {formatMoney(st.baseAmount, baseCurrency)}
                      </div>
                      {st.currency !== baseCurrency && (
                        <div className="field-hint">
                          {formatMoney(st.amount, st.currency)}
                        </div>
                      )}
                    </div>
                    {!isClosed && st.kind === 'settlement' && (
                      <button
                        type="button"
                        className="btn-icon"
                        onClick={() => onEditSettlement(st)}
                        title="Modifica rimborso"
                        aria-label="Modifica rimborso"
                      >
                        <Pencil size={15} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
