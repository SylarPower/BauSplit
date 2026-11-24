import { ArrowLeftRight, BarChart3 } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  computeComparisonDelta,
  computeGroupInsights,
  mergeCategoryComparisons,
} from '../lib/accounting';
import { formatMoney, formatNumberIT } from '../lib/currencies';
import {
  COMPARE_PRESET_LABELS,
  DATE_PRESET_LABELS,
  formatFullDateIT,
  resolveComparisonPeriod,
  resolveDatePreset,
} from '../lib/dates';
import type {
  CategoryInsight,
  CategoryOption,
  CompareDatePreset,
  ComparisonDelta,
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

function formatRangeSummary(from: string, to: string): string {
  if (!from && !to) return 'Intero storico del gruppo';
  return `${from ? `Dal ${formatFullDateIT(from)}` : 'Dall’inizio'} ${to ? `al ${formatFullDateIT(to)}` : 'a oggi'}`;
}

function deltaBadgeClass(delta: ComparisonDelta): string {
  if (delta.kind === 'up') return 'badge badge-negative tabular';
  if (delta.kind === 'down') return 'badge badge-positive tabular';
  return 'badge tabular';
}

function formatComparisonDelta(
  delta: ComparisonDelta,
  baseCurrency: string,
  allowNewLabel = true
): string {
  if (delta.kind === 'equal') {
    return `${formatMoney(0, baseCurrency)} (0,0%)`;
  }
  if (delta.kind === 'new') {
    const amountText = formatMoney(delta.diff, baseCurrency, { signed: true });
    return allowNewLabel ? `${amountText} · Nuova` : amountText;
  }
  const amountText = formatMoney(delta.diff, baseCurrency, { signed: true });
  if (delta.percentage === null) return amountText;
  const pctSign = delta.percentage > 0 ? '+' : delta.percentage < 0 ? '−' : '';
  return `${amountText} (${pctSign}${formatNumberIT(Math.abs(delta.percentage), 1, 1)}%)`;
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

  const [compareEnabled, setCompareEnabled] = useState(false);
  const [comparePreset, setComparePreset] = useState<CompareDatePreset>('auto');
  const [compareCustomFrom, setCompareCustomFrom] = useState('');
  const [compareCustomTo, setCompareCustomTo] = useState('');
  const [matchElapsed, setMatchElapsed] = useState(true);

  const rawRange = useMemo(
    () => resolveDatePreset(preset, customFrom, customTo),
    [preset, customFrom, customTo]
  );

  const comparison = useMemo(
    () =>
      compareEnabled
        ? resolveComparisonPeriod({
            presetA: preset,
            customAFrom: customFrom,
            customATo: customTo,
            comparePreset,
            compareCustomFrom,
            compareCustomTo,
            matchElapsed,
          })
        : null,
    [
      compareEnabled,
      preset,
      customFrom,
      customTo,
      comparePreset,
      compareCustomFrom,
      compareCustomTo,
      matchElapsed,
    ]
  );

  const range = comparison ? comparison.rangeA : rawRange;

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

  const comparisonInsights = useMemo(() => {
    if (!comparison || !comparison.valid) return null;
    return computeGroupInsights(
      expenses,
      settlements,
      members,
      categories,
      baseCurrency,
      comparison.rangeB.from,
      comparison.rangeB.to
    );
  }, [comparison, expenses, settlements, members, categories, baseCurrency]);

  const totalDelta = useMemo(
    () =>
      comparisonInsights
        ? computeComparisonDelta(insights.totalSpent, comparisonInsights.totalSpent, baseCurrency)
        : null,
    [insights.totalSpent, comparisonInsights, baseCurrency]
  );

  const mergedCategories = useMemo(
    () =>
      comparisonInsights
        ? mergeCategoryComparisons(insights.byCategory, comparisonInsights.byCategory, baseCurrency)
        : null,
    [insights.byCategory, comparisonInsights, baseCurrency]
  );

  const maxMonthTotal = Math.max(...insights.byMonth.map((m) => m.total), 0.01);
  const hasAnyPeriodData =
    insights.expenseCount > 0 || (comparisonInsights !== null && comparisonInsights.expenseCount > 0);

  return (
    <div className="section-stack">
      {/* Selettore intervallo di date */}
      <div className="card" style={{ padding: '14px 18px' }}>
        <div className="insights-period-head">
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Periodo analizzato</div>
            <div className="field-hint">
              {range.from || range.to ? (
                <>
                  {formatRangeSummary(range.from, range.to)} · Rimborsi esclusi dai totali
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

          <div className="insights-period-controls">
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

            <button
              type="button"
              className={`btn btn-secondary btn-sm ${compareEnabled ? 'badge-accent' : ''}`}
              aria-pressed={compareEnabled}
              onClick={() => setCompareEnabled((v) => !v)}
            >
              <ArrowLeftRight size={14} />
              Confronta
            </button>
          </div>
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

        {compareEnabled && comparison && (
          <div className="insights-compare-panel">
            <div className="insights-period-head">
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>Confronta con</div>
                <div className="field-hint">
                  {comparison.valid ? (
                    <>
                      {formatRangeSummary(comparison.rangeB.from, comparison.rangeB.to)}
                      {comparison.appliedElapsedParity && ' · Stesso punto del periodo'}
                    </>
                  ) : preset === 'all' && comparePreset === 'auto' ? (
                    'Seleziona un periodo specifico da confrontare oppure scegli un periodo B manuale.'
                  ) : (
                    'Inserisci un intervallo di date valido per il periodo di confronto.'
                  )}
                </div>
              </div>

              <select
                className="select select-sm"
                style={{ width: 'auto', minWidth: 190 }}
                value={comparePreset}
                onChange={(e) => setComparePreset(e.target.value as CompareDatePreset)}
                aria-label="Periodo di confronto"
              >
                {(Object.keys(COMPARE_PRESET_LABELS) as CompareDatePreset[]).map((key) => (
                  <option key={key} value={key}>
                    {COMPARE_PRESET_LABELS[key]}
                  </option>
                ))}
              </select>
            </div>

            {comparison.isOngoingA && comparePreset !== 'custom' && (
              <label className="insights-compare-check">
                <input
                  type="checkbox"
                  checked={matchElapsed}
                  onChange={(e) => setMatchElapsed(e.target.checked)}
                />
                <span>Stesso punto del periodo (a parità di giorni trascorsi)</span>
              </label>
            )}

            {comparePreset === 'custom' && (
              <div className="form-row" style={{ marginTop: 10 }}>
                <label className="field">
                  <span className="field-label">Confronto dal</span>
                  <input
                    type="date"
                    className="input input-sm tabular"
                    value={compareCustomFrom}
                    onChange={(e) => setCompareCustomFrom(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Confronto al</span>
                  <input
                    type="date"
                    className="input input-sm tabular"
                    value={compareCustomTo}
                    min={compareCustomFrom || undefined}
                    onChange={(e) => setCompareCustomTo(e.target.value)}
                  />
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      {!hasAnyPeriodData ? (
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
          {/* Ripartizione per categoria */}
          <section className="card card-pad">
            <div className="section-head" style={{ marginBottom: 16 }}>
              <div>
                <h2 className="section-title">Ripartizione per categoria</h2>
                <p className="field-hint">
                  {mergedCategories
                    ? 'Confronto tra periodo principale e periodo selezionato.'
                    : 'Clicca una categoria per vedere le relative spese.'}
                </p>
              </div>
              {comparisonInsights && totalDelta && (
                <div className="insights-total-compare tabular">
                  <span className="field-hint">
                    Confronto:{' '}
                    <strong>{formatMoney(comparisonInsights.totalSpent, baseCurrency)}</strong>
                  </span>
                  <span className={deltaBadgeClass(totalDelta)}>
                    {formatComparisonDelta(totalDelta, baseCurrency, false)}
                  </span>
                </div>
              )}
            </div>

            <div className="insights-cat-layout">
              <CategoryDonut
                categories={insights.byCategory}
                totalLabel={formatMoney(insights.totalSpent, baseCurrency)}
              />

              {mergedCategories ? (
                <div className="cat-breakdown-list">
                  {mergedCategories.map((cat) => {
                    const content = (
                      <>
                        <div className="cat-breakdown-top">
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                            <CategoryIcon icon={cat.icon} color={cat.color} size={16} />
                            <span style={{ fontWeight: 550 }}>{cat.label}</span>
                            <span className="field-hint">
                              ({cat.countA} {cat.countA === 1 ? 'spesa' : 'spese'})
                            </span>
                          </span>
                          <span className="cat-comparison-right tabular">
                            <span style={{ fontWeight: 650 }}>
                              {formatMoney(cat.totalA, baseCurrency)}
                            </span>
                            <span className={deltaBadgeClass(cat.delta)}>
                              {formatComparisonDelta(cat.delta, baseCurrency)}
                            </span>
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill category-paint"
                            style={{
                              ...categoryStyle(cat.color),
                              width: `${cat.totalA > 0 ? Math.max(2, cat.percentageA) : 0}%`,
                            }}
                          />
                        </div>
                        <div className="cat-comparison-meta tabular">
                          Confronto: {formatMoney(cat.totalB, baseCurrency)} (
                          {formatNumberIT(cat.percentageB, 1)}%) · Attuale:{' '}
                          {formatNumberIT(cat.percentageA, 1)}%
                        </div>
                      </>
                    );

                    return cat.countA > 0 ? (
                      <button
                        key={cat.key}
                        type="button"
                        className="cat-breakdown-item"
                        style={{ textAlign: 'left' }}
                        onClick={() => onFilterByCategory(cat.key, preset, customFrom, customTo)}
                      >
                        {content}
                      </button>
                    ) : (
                      <div key={cat.key} className="cat-breakdown-item">
                        {content}
                      </div>
                    );
                  })}
                </div>
              ) : (
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
                          style={{
                            ...categoryStyle(cat.color),
                            width: `${Math.max(2, cat.percentage)}%`,
                          }}
                        />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Chi ha anticipato il denaro vs Quota effettiva di ciascuno */}
          {insights.expenseCount > 0 && (
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
          )}

          {/* Andamento mensile quando il periodo copre più di un mese */}
          {insights.expenseCount > 0 && insights.byMonth.length > 1 && (
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
