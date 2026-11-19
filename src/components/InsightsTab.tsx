import { BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { computeGroupInsights } from '../lib/accounting';
import { formatMoney, formatNumberIT } from '../lib/currencies';
import {
  DATE_PRESET_LABELS,
  formatFullDateIT,
  resolveDatePreset,
} from '../lib/dates';
import type {
  CategoryInsight,
  CategoryOption,
  DateRangePreset,
  Expense,
  GroupMember,
  Settlement,
} from '../types';
import { Avatar, CategoryIcon, categoryStyle } from './Icon';

interface InsightsTabProps {
  baseCurrency: string;
  expenses: Expense[];
  settlements: Settlement[];
  members: GroupMember[];
  categories: CategoryOption[];
  onFilterByCategory: (categoryKey: string, preset: DateRangePreset, from: string, to: string) => void;
}

function CategoryDonut({
  categories,
  totalLabel,
}: {
  categories: CategoryInsight[];
  totalLabel: string;
}) {
  const size = 164;
  const strokeWidth = 20;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = categories.reduce((acc, c) => acc + c.total, 0);

  let cumulative = 0;

  return (
    <div className="donut-wrap">
      <div style={{ position: 'relative', width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--surface-subtle)"
            strokeWidth={strokeWidth}
          />
          {total > 0 &&
            categories.map((cat) => {
              const fraction = cat.total / total;
              const dash = fraction * circumference;
              const offset = -cumulative * circumference;
              cumulative += fraction;
              return (
                <circle
                  key={cat.key}
                  cx={size / 2}
                  cy={size / 2}
                  r={radius}
                  fill="none"
                  className="category-paint"
                  style={categoryStyle(cat.color)}
                  stroke="currentColor"
                  strokeWidth={strokeWidth}
                  strokeDasharray={`${dash} ${circumference - dash}`}
                  strokeDashoffset={offset}
                  transform={`rotate(-90 ${size / 2} ${size / 2})`}
                />
              );
            })}
        </svg>
        <div
          className="tabular"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: 24,
          }}
        >
          <span className="field-hint" style={{ fontSize: 11 }}>
            Totale
          </span>
          <span style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.2 }}>{totalLabel}</span>
        </div>
      </div>
    </div>
  );
}

export function InsightsTab({
  baseCurrency,
  expenses,
  settlements,
  members,
  categories,
  onFilterByCategory,
}: InsightsTabProps) {
  const [preset, setPreset] = useState<DateRangePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');

  const range = useMemo(
    () => resolveDatePreset(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const insights = useMemo(
    () =>
      computeGroupInsights(
        expenses,
        settlements,
        members,
        categories,
        baseCurrency,
        range.from,
        range.to
      ),
    [expenses, settlements, members, categories, baseCurrency, range.from, range.to]
  );

  const maxMonthTotal = Math.max(...insights.byMonth.map((m) => m.total), 0.01);

  return (
    <div className="section-stack">
      {/* Selettore intervallo di date */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Periodo analizzato</div>
            <div className="field-hint">
              {range.from || range.to ? (
                <>
                  {range.from ? `Dal ${formatFullDateIT(range.from)}` : 'Dall’inizio'}{' '}
                  {range.to ? `al ${formatFullDateIT(range.to)}` : 'a oggi'} · Rimborsi esclusi dai
                  totali
                  {insights.excludedSettlementsCount > 0 &&
                    ` (${insights.excludedSettlementsCount} nel periodo)`}
                </>
              ) : (
                <>
                  Intero storico del gruppo · Rimborsi esclusi dai totali di spesa
                  {insights.excludedSettlementsCount > 0 &&
                    ` (${insights.excludedSettlementsCount} esclusi)`}
                </>
              )}
            </div>
          </div>

          <select
            className="select select-sm"
            style={{ width: 'auto', minWidth: 190 }}
            value={preset}
            onChange={(e) => setPreset(e.target.value as DateRangePreset)}
            aria-label="Seleziona periodo degli Insights"
          >
            {(Object.keys(DATE_PRESET_LABELS) as DateRangePreset[]).map((key) => (
              <option key={key} value={key}>
                {DATE_PRESET_LABELS[key]}
              </option>
            ))}
          </select>
        </div>

        {preset === 'custom' && (
          <div className="form-row" style={{ marginTop: 12 }}>
            <label className="field">
              <span className="field-label">Data iniziale</span>
              <input
                type="date"
                className="input input-sm tabular"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Data finale</span>
              <input
                type="date"
                className="input input-sm tabular"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </div>
        )}
      </div>

      {insights.expenseCount === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">
            <BarChart3 size={22} />
          </span>
          <h3 className="empty-title">Nessuna spesa nel periodo selezionato</h3>
          <p className="empty-desc">
            {preset !== 'all'
              ? 'Amplia l’intervallo di date per visualizzare il riepilogo delle spese.'
              : 'Non appena registrerete delle spese, qui troverete totali e ripartizioni.'}
          </p>
          {preset !== 'all' && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setPreset('all')}
            >
              Mostra tutto il periodo
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Indicatori sintetici */}
          <div className="kpi-grid">
            <div className="card kpi-card">
              <div>
                <div className="kpi-label">Totale speso</div>
                {insights.dailyAverage !== null && (
                  <div className="kpi-sub tabular">
                    Media {formatMoney(insights.dailyAverage, baseCurrency)}/giorno
                  </div>
                )}
              </div>
              <div className="kpi-value tabular">
                {formatMoney(insights.totalSpent, baseCurrency)}
              </div>
            </div>

            <div className="card kpi-card">
              <div>
                <div className="kpi-label">Numero di spese</div>
                <div className="kpi-sub">
                  in {insights.byCategory.length}{' '}
                  {insights.byCategory.length === 1 ? 'categoria' : 'categorie'}
                </div>
              </div>
              <div className="kpi-value tabular">{insights.expenseCount}</div>
            </div>

            <div className="card kpi-card">
              <div>
                <div className="kpi-label">Spesa media</div>
                <div className="kpi-sub">in {baseCurrency}</div>
              </div>
              <div className="kpi-value tabular">
                {formatMoney(insights.averageExpense, baseCurrency)}
              </div>
            </div>
          </div>

          {/* Ripartizione per categoria */}
          <section className="card card-pad">
            <div className="section-head" style={{ marginBottom: 16 }}>
              <div>
                <h2 className="section-title">Ripartizione per categoria</h2>
                <p className="field-hint">Clicca una categoria per vedere le relative spese.</p>
              </div>
            </div>

            <div className="insights-cat-layout">
              <CategoryDonut
                categories={insights.byCategory}
                totalLabel={formatMoney(insights.totalSpent, baseCurrency)}
              />

              <div className="cat-breakdown-list">
                {insights.byCategory.map((cat) => (
                  <button
                    key={cat.key}
                    type="button"
                    className="cat-breakdown-item"
                    style={{ textAlign: 'left' }}
                    onClick={() => onFilterByCategory(cat.key, preset, customFrom, customTo)}
                  >
                    <div className="cat-breakdown-top">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <CategoryIcon icon={cat.icon} color={cat.color} size={16} />
                        <span style={{ fontWeight: 550 }}>{cat.label}</span>
                        <span className="field-hint">
                          ({cat.count} {cat.count === 1 ? 'spesa' : 'spese'})
                        </span>
                      </span>
                      <span className="tabular" style={{ fontWeight: 650 }}>
                        {formatMoney(cat.total, baseCurrency)}{' '}
                        <span className="text-muted" style={{ fontWeight: 450, fontSize: 12.5 }}>
                          {formatNumberIT(cat.percentage, 1)}%
                        </span>
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill category-paint"
                        style={{ ...categoryStyle(cat.color), width: `${Math.max(2, cat.percentage)}%` }}
                      />
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          {/* Chi ha anticipato il denaro vs Quota effettiva di ciascuno */}
          <div className="insights-two-col">
            <section className="card card-pad">
              <div style={{ marginBottom: 14 }}>
                <h2 className="section-title">Chi ha anticipato il denaro</h2>
                <p className="field-hint">Importo delle spese pagate direttamente da ciascuno.</p>
              </div>

              <div className="cat-breakdown-list">
                {insights.byMember.map((m) => (
                  <div key={`adv-${m.userId}`} className="cat-breakdown-item">
                    <div className="cat-breakdown-top">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={m.displayName} seed={m.userId} size={24} />
                        <span style={{ fontWeight: 550 }}>{m.displayName}</span>
                        <span className="field-hint">({m.advancedCount})</span>
                      </span>
                      <span className="tabular" style={{ fontWeight: 650 }}>
                        {formatMoney(m.advancedTotal, baseCurrency)}{' '}
                        <span className="text-muted" style={{ fontWeight: 450, fontSize: 12.5 }}>
                          {formatNumberIT(m.advancedPercentage, 1)}%
                        </span>
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${m.advancedPercentage}%`,
                          backgroundColor: 'var(--accent)',
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="card card-pad">
              <div style={{ marginBottom: 14 }}>
                <h2 className="section-title">Quota effettiva per persona</h2>
                <p className="field-hint">
                  Parte di spesa spettante a ciascuno in base alle ripartizioni.
                </p>
              </div>

              <div className="cat-breakdown-list">
                {insights.byMember.map((m) => (
                  <div key={`share-${m.userId}`} className="cat-breakdown-item">
                    <div className="cat-breakdown-top">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                        <Avatar name={m.displayName} seed={m.userId} size={24} />
                        <span style={{ fontWeight: 550 }}>{m.displayName}</span>
                      </span>
                      <span className="tabular" style={{ fontWeight: 650 }}>
                        {formatMoney(m.shareTotal, baseCurrency)}{' '}
                        <span className="text-muted" style={{ fontWeight: 450, fontSize: 12.5 }}>
                          {formatNumberIT(m.sharePercentage, 1)}%
                        </span>
                      </span>
                    </div>
                    <div className="progress-track">
                      <div
                        className="progress-fill"
                        style={{
                          width: `${m.sharePercentage}%`,
                          backgroundColor: 'var(--chart-secondary)',
                        }}
                      />
                    </div>
                    {Math.abs(m.periodDelta) >= 0.01 && (
                      <div className="field-hint tabular" style={{ fontSize: 11.8 }}>
                        Differenza anticipato/quota:{' '}
                        <span
                          className={m.periodDelta > 0 ? 'text-positive' : 'text-negative'}
                          style={{ fontWeight: 550 }}
                        >
                          {formatMoney(m.periodDelta, baseCurrency, { signed: true })}
                        </span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Andamento mensile quando il periodo copre più di un mese */}
          {insights.byMonth.length > 1 && (
            <section className="card card-pad">
              <div style={{ marginBottom: 8 }}>
                <h2 className="section-title">Andamento mensile</h2>
                <p className="field-hint">Totale spese per mese in {baseCurrency}.</p>
              </div>
              <div className="month-bars">
                {insights.byMonth.map((m) => {
                  const heightPct = Math.max(5, Math.round((m.total / maxMonthTotal) * 100));
                  return (
                    <div
                      key={m.monthKey}
                      className="month-bar-col tabular"
                      title={`${m.label}: ${formatMoney(m.total, baseCurrency)} (${m.count} spese)`}
                    >
                      <span className="month-bar-amount">
                        {formatMoney(m.total, baseCurrency)}
                      </span>
                      <div
                        className="month-bar-fill"
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="month-bar-label">{m.label}</span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
