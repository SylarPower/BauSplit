import { ChevronDown, ChevronUp, History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { splitLogActorAndBody } from '../lib/audit';
import { formatDateTimeIT } from '../lib/dates';
import type { ActivityAction, ActivityLog, GroupMember } from '../types';
import { Avatar } from './Icon';

interface HistoryTabProps {
  logs: ActivityLog[];
  actorLinks?: Record<string, string>;
  members?: GroupMember[];
}

const ACTION_BADGE: Record<ActivityAction, { label: string; className: string }> = {
  created: { label: 'Aggiunta', className: 'badge badge-positive' },
  generated: { label: 'Ricorrente', className: 'badge badge-accent' },
  updated: { label: 'Modifica', className: 'badge badge-warning' },
  deleted: { label: 'Eliminazione', className: 'badge badge-negative' },
  joined: { label: 'Ingresso', className: 'badge badge-accent' },
  left: { label: 'Uscita', className: 'badge' },
  closed: { label: 'Chiusura gruppo', className: 'badge badge-warning' },
  reopened: { label: 'Gruppo riaperto', className: 'badge badge-positive' },
  transferred_in: { label: 'Saldo riportato', className: 'badge badge-accent' },
  regenerated: { label: 'Invito', className: 'badge' },
  enabled: { label: 'Invito attivo', className: 'badge badge-positive' },
  disabled: { label: 'Invito disattivo', className: 'badge' },
  paused: { label: 'In pausa', className: 'badge' },
  resumed: { label: 'Riattivata', className: 'badge badge-positive' },
};

type EntityFilter = 'all' | 'expense' | 'settlement' | 'recurring' | 'group';

export function HistoryTab({ logs, actorLinks, members }: HistoryTabProps) {
  const [entityFilter, setEntityFilter] = useState<EntityFilter>('all');
  const [actorFilter, setActorFilter] = useState<string>('all');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const canonicalActorId = (actorId: string) => actorLinks?.[actorId] ?? actorId;

  const memberNameByOwner = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of members ?? []) {
      if (m.ownerId) map.set(m.ownerId, m.displayName);
    }
    return map;
  }, [members]);

  // L'autore è l'accesso che ha agito; eventuali accessi ospite collegati a un account vengono unificati.
  const actors = useMemo(() => {
    const names = new Map<string, string>();
    for (const log of logs) {
      const id = canonicalActorId(log.actorId);
      if (!names.has(id)) {
        names.set(id, memberNameByOwner.get(id) ?? log.actorName);
      } else if (log.actorId === id && !memberNameByOwner.has(id)) {
        names.set(id, log.actorName);
      }
    }
    return Array.from(names);
  }, [logs, actorLinks, memberNameByOwner]);

  const filtered = useMemo(() => {
    return logs.filter((l) => {
      if (actorFilter !== 'all' && canonicalActorId(l.actorId) !== actorFilter) return false;
      if (entityFilter === 'all') return true;
      if (entityFilter === 'group') {
        return ['group', 'member', 'invite', 'category'].includes(l.entityType);
      }
      return l.entityType === entityFilter;
    });
  }, [logs, entityFilter, actorFilter, actorLinks]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="section-stack">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <h2 className="section-title">Storico attività del gruppo</h2>
          <p className="field-hint">
            Ogni aggiunta, modifica o eliminazione viene registrata con autore e orario.
          </p>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select
            className="select select-sm"
            style={{ width: 'auto' }}
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value as EntityFilter)}
            aria-label="Filtra storico per tipo"
          >
            <option value="all">Tutte le attività</option>
            <option value="expense">Spese</option>
            <option value="settlement">Rimborsi</option>
            <option value="recurring">Ricorrenti</option>
            <option value="group">Gruppo, categorie e inviti</option>
          </select>

          <select
            className="select select-sm"
            style={{ width: 'auto' }}
            value={actorFilter}
            onChange={(e) => setActorFilter(e.target.value)}
            aria-label="Filtra storico per membro"
          >
            <option value="all">Tutti i membri</option>
            {actors.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-state">
          <span className="empty-icon">
            <History size={22} />
          </span>
          <h3 className="empty-title">Nessuna attività da mostrare</h3>
          <p className="empty-desc">Le operazioni registrate nel gruppo appariranno qui.</p>
        </div>
      ) : (
        <div className="card">
          {filtered.map((log) => {
            const badge = ACTION_BADGE[log.action] ?? { label: log.action, className: 'badge' };
            const diffs = log.changes.diffs ?? [];
            const snapshot = log.changes.snapshot;
            const hasSnapshot = snapshot && Object.keys(snapshot).length > 0;
            const isExpanded = expandedIds.has(log.id) || log.action === 'deleted';
            const line = splitLogActorAndBody(log.actorName, log.summary);

            return (
              <div key={log.id} className="log-row">
                <div className="log-top">
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <Avatar
                      name={log.actorName}
                      seed={canonicalActorId(log.actorId)}
                      size={28}
                    />
                    <div>
                      <div style={{ fontSize: 14, lineHeight: 1.45 }}>
                        <strong>{line.lead}</strong>{' '}
                        <span className="text-secondary">{line.rest}</span>
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          marginTop: 4,
                          flexWrap: 'wrap',
                        }}
                      >
                        <span className={badge.className}>{badge.label}</span>
                        <span className="field-hint tabular">
                          {formatDateTimeIT(log.createdAt)}
                        </span>
                        {hasSnapshot && log.action !== 'deleted' && (
                          <button
                            type="button"
                            className="link-btn"
                            style={{
                              fontSize: 12,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 2,
                            }}
                            onClick={() => toggleExpand(log.id)}
                          >
                            {expandedIds.has(log.id) ? (
                              <>
                                Nascondi dettagli <ChevronUp size={13} />
                              </>
                            ) : (
                              <>
                                Dettagli <ChevronDown size={13} />
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Differenze prima -> dopo sempre visibili per le modifiche */}
                {diffs.length > 0 && (
                  <div className="log-diffs" style={{ marginLeft: 38 }}>
                    {diffs.map((d, i) => (
                      <div key={i} className="log-diff-line">
                        <span className="text-secondary" style={{ fontWeight: 550 }}>
                          {d.field}:
                        </span>
                        <span className="diff-before">{d.before}</span>
                        <span className="text-muted">→</span>
                        <span className="diff-after">{d.after}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Riepilogo completo per elementi eliminati o dettagli espansi */}
                {hasSnapshot && isExpanded && (
                  <div className="log-diffs" style={{ marginLeft: 38 }}>
                    {Object.entries(snapshot).map(([k, v]) => (
                      <div key={k} className="log-diff-line">
                        <span className="text-secondary" style={{ fontWeight: 550 }}>
                          {k}:
                        </span>
                        <span>{v}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
