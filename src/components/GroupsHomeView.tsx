import {
  Check,
  ChevronRight,
  Link2,
  Plus,
  Users,
  X,
} from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CURRENCIES, formatMoney } from '../lib/currencies';
import { DEMO_SAMPLE_INVITE_TOKEN } from '../lib/demoStore';
import { extractInviteToken, translateErrorIT } from '../lib/supabase';
import type { GroupOverview, InvitePreview } from '../types';
import { Avatar } from './Icon';
import { Modal } from './Modal';
import { SetupGuideCard } from './SetupGuideCard';

interface GroupsHomeViewProps {
  groups: GroupOverview[];
  loading: boolean;
  schemaMissing: boolean;
  isDemo: boolean;
  currentUserId: string;
  onRetryLoad: () => void;
  onSelectGroup: (groupId: string) => void;
  onCreateGroup: (params: {
    name: string;
    description: string;
    baseCurrency: string;
  }) => Promise<void>;

  pendingInvite: {
    token: string;
    loading: boolean;
    preview: InvitePreview | null;
  } | null;
  onInspectInviteToken: (token: string) => void;
  onAcceptInvite: (token: string) => Promise<void>;
  onDeclineInvite: () => void;
  onToast: (msg: string, isError?: boolean) => void;
}

export function GroupsHomeView({
  groups,
  loading,
  schemaMissing,
  isDemo,
  currentUserId,
  onRetryLoad,
  onSelectGroup,
  onCreateGroup,
  pendingInvite,
  onInspectInviteToken,
  onAcceptInvite,
  onDeclineInvite,
  onToast,
}: GroupsHomeViewProps) {
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [baseCurrency, setBaseCurrency] = useState('EUR');
  const [creating, setCreating] = useState(false);

  const [showJoinModal, setShowJoinModal] = useState(false);
  const [inviteInput, setInviteInput] = useState('');
  const [accepting, setAccepting] = useState(false);

  const handleCreateSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setCreating(true);
    try {
      await onCreateGroup({
        name: name.trim(),
        description: description.trim(),
        baseCurrency,
      });
      setName('');
      setDescription('');
      setBaseCurrency('EUR');
      setShowCreate(false);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setCreating(false);
    }
  };

  const handleJoinSubmit = (e: FormEvent) => {
    e.preventDefault();
    const token = extractInviteToken(inviteInput);
    if (!token) {
      onToast("Incolla un link d'invito valido.", true);
      return;
    }
    setInviteInput('');
    setShowJoinModal(false);
    onInspectInviteToken(token);
  };

  const handleAccept = async (token: string) => {
    setAccepting(true);
    try {
      await onAcceptInvite(token);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setAccepting(false);
    }
  };

  const showDemoInviteShortcut =
    isDemo &&
    currentUserId === 'demo-marco' &&
    !pendingInvite &&
    !groups.some((g) => g.group.id === 'demo-group-giappone');

  const activeGroups = groups.filter((g) => g.group.closedAt === null);
  const closedGroups = groups.filter((g) => g.group.closedAt !== null);

  return (
    <div className="container">
      <div className="page-head">
        <div>
          <h1 className="page-title">I tuoi gruppi</h1>
          <p className="page-subtitle">
            {groups.length === 0
              ? 'Crea un gruppo o accetta un link d’invito per iniziare.'
              : `${activeGroups.length} ${activeGroups.length === 1 ? 'gruppo attivo' : 'gruppi attivi'}${
                  closedGroups.length > 0
                    ? ` · ${closedGroups.length} ${closedGroups.length === 1 ? 'chiuso' : 'chiusi'}`
                    : ''
                }`}
          </p>
        </div>

        {!schemaMissing && (
          <div className="page-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => setShowJoinModal(true)}
            >
              <Link2 size={15} />
              Hai un invito?
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={16} />
              Nuovo gruppo
            </button>
          </div>
        )}
      </div>

      {schemaMissing ? (
        <SetupGuideCard onRetry={onRetryLoad} retrying={loading} />
      ) : (
        <>
          {/* Card di accettazione invito tramite link */}
          {pendingInvite && (
            <section className="card invite-card" aria-label="Invito a un gruppo">
              {pendingInvite.loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="spinner" />
                  <span className="text-secondary">Verifica dell&apos;invito in corso…</span>
                </div>
              ) : pendingInvite.preview?.valid ? (
                <>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span className="badge badge-accent" style={{ alignSelf: 'flex-start' }}>
                      Invito a un gruppo privato
                    </span>
                    <h2 style={{ fontSize: 19, fontWeight: 700, marginTop: 4 }}>
                      {pendingInvite.preview.groupName}
                    </h2>
                    {pendingInvite.preview.description && (
                      <p className="text-secondary" style={{ fontSize: 14 }}>
                        {pendingInvite.preview.description}
                      </p>
                    )}
                    <p className="field-hint" style={{ marginTop: 2 }}>
                      Creato da <strong>{pendingInvite.preview.createdByName}</strong> ·{' '}
                      {pendingInvite.preview.memberCount}{' '}
                      {pendingInvite.preview.memberCount === 1 ? 'membro' : 'membri'} · Valuta di
                      riferimento: <strong>{pendingInvite.preview.baseCurrency}</strong>
                    </p>
                  </div>

                  {pendingInvite.preview.alreadyMember ? (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => {
                          const gid = pendingInvite.preview?.groupId;
                          onDeclineInvite();
                          if (gid) onSelectGroup(gid);
                        }}
                      >
                        Fai già parte del gruppo — Aprilo
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        onClick={onDeclineInvite}
                      >
                        Chiudi
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => handleAccept(pendingInvite.token)}
                        disabled={accepting}
                      >
                        <Check size={16} />
                        {accepting ? 'Accesso al gruppo…' : 'Accetta ed entra nel gruppo'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={onDeclineInvite}
                        disabled={accepting}
                      >
                        <X size={15} />
                        Rifiuta
                      </button>
                    </div>
                  )}
                </>
              ) : (
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
                    <div style={{ fontWeight: 650, fontSize: 15 }}>
                      {pendingInvite.preview?.reason === 'closed'
                        ? 'Gruppo chiuso'
                        : pendingInvite.preview?.reason === 'disabled'
                          ? "Link d'invito disattivato"
                          : "Link d'invito non valido"}
                    </div>
                    <div className="field-hint">
                      {pendingInvite.preview?.reason === 'closed'
                        ? 'Questo gruppo è stato chiuso e non accetta nuovi membri.'
                        : pendingInvite.preview?.reason === 'disabled'
                          ? 'I membri di questo gruppo hanno temporaneamente disattivato gli inviti.'
                          : 'Il link potrebbe essere stato rigenerato. Chiedi un nuovo link a chi ti ha invitato.'}
                    </div>
                  </div>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={onDeclineInvite}>
                    Chiudi
                  </button>
                </div>
              )}
            </section>
          )}

          {loading && groups.length === 0 ? (
            <div className="center-loader" style={{ minHeight: '36dvh' }}>
              <span className="spinner" />
              <span>Caricamento dei gruppi…</span>
            </div>
          ) : groups.length === 0 ? (
            <div className="card empty-state">
              <span className="empty-icon">
                <Users size={22} />
              </span>
              <h2 className="empty-title">Nessun gruppo ancora</h2>
              <p className="empty-desc">
                Crea il vostro primo gruppo (ad esempio &ldquo;Casa&rdquo; o &ldquo;Vacanze&rdquo;) e
                condividi il link d&apos;invito con chi vuoi.
              </p>
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setShowCreate(true)}
                >
                  <Plus size={16} />
                  Crea il primo gruppo
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowJoinModal(true)}
                >
                  <Link2 size={15} />
                  Incolla link d&apos;invito
                </button>
              </div>
            </div>
          ) : (
            <div className="section-stack">
              {activeGroups.length > 0 && (
                <div className="groups-list">
                  {activeGroups.map((item) => {
                    const { group, members, expenseCount, myNetBalance, counterpartHint } = item;
                    const isPos = myNetBalance > 0.005;
                    const isNeg = myNetBalance < -0.005;

                    return (
                      <button
                        key={group.id}
                        type="button"
                        className="card group-card"
                        onClick={() => onSelectGroup(group.id)}
                      >
                        <div className="group-card-main">
                          <div className="group-card-title">
                            <span>{group.name}</span>
                            <span className="badge">{group.baseCurrency}</span>
                          </div>
                          <div className="group-card-meta">
                            <span className="avatar-stack">
                              {members.slice(0, 5).map((m) => (
                                <Avatar
                                  key={m.userId}
                                  name={m.displayName}
                                  seed={m.userId}
                                  size={22}
                                />
                              ))}
                            </span>
                            <span>{members.map((m) => m.displayName).join(', ')}</span>
                            <span>·</span>
                            <span>
                              {expenseCount} {expenseCount === 1 ? 'spesa' : 'spese'}
                            </span>
                          </div>
                        </div>

                        <div className="group-card-right">
                          <div>
                            <div
                              className={`balance-pill-text tabular ${
                                isPos ? 'text-positive' : isNeg ? 'text-negative' : 'text-secondary'
                              }`}
                            >
                              {isPos || isNeg
                                ? formatMoney(myNetBalance, group.baseCurrency, { signed: true })
                                : 'In pari'}
                            </div>
                            <div className="balance-pill-sub tabular">{counterpartHint}</div>
                          </div>
                          <ChevronRight size={18} className="text-muted" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {closedGroups.length > 0 && (
                <section>
                  <div className="month-heading" style={{ marginTop: 0 }}>
                    <span>Gruppi chiusi ({closedGroups.length})</span>
                  </div>
                  <div className="groups-list">
                    {closedGroups.map((item) => {
                      const { group, members, expenseCount, myNetBalance, counterpartHint } = item;
                      const isPos = myNetBalance > 0.005;
                      const isNeg = myNetBalance < -0.005;

                      return (
                        <button
                          key={group.id}
                          type="button"
                          className="card group-card"
                          style={{ opacity: 0.78 }}
                          onClick={() => onSelectGroup(group.id)}
                        >
                          <div className="group-card-main">
                            <div className="group-card-title">
                              <span>{group.name}</span>
                              <span className="badge badge-warning">Chiuso</span>
                              <span className="badge">{group.baseCurrency}</span>
                            </div>
                            <div className="group-card-meta">
                              <span>{members.map((m) => m.displayName).join(', ')}</span>
                              <span>·</span>
                              <span>
                                {expenseCount} {expenseCount === 1 ? 'spesa' : 'spese'}
                              </span>
                            </div>
                          </div>

                          <div className="group-card-right">
                            <div>
                              <div
                                className={`balance-pill-text tabular ${
                                  isPos
                                    ? 'text-positive'
                                    : isNeg
                                      ? 'text-negative'
                                      : 'text-secondary'
                                }`}
                              >
                                {isPos || isNeg
                                  ? formatMoney(myNetBalance, group.baseCurrency, { signed: true })
                                  : 'Chiuso in pari'}
                              </div>
                              <div className="balance-pill-sub tabular">
                                {group.closedIntoGroupName
                                  ? `Spostato in "${group.closedIntoGroupName}"`
                                  : counterpartHint}
                              </div>
                            </div>
                            <ChevronRight size={18} className="text-muted" />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              )}
            </div>
          )}

          {showDemoInviteShortcut && (
            <div
              className="card-subtle"
              style={{
                marginTop: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                flexWrap: 'wrap',
              }}
            >
              <span className="text-secondary" style={{ fontSize: 13.5 }}>
                Vuoi vedere come funziona l&apos;accettazione di un invito tramite link?
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => onInspectInviteToken(DEMO_SAMPLE_INVITE_TOKEN)}
              >
                <Link2 size={14} />
                Simula apertura link d&apos;invito
              </button>
            </div>
          )}
        </>
      )}

      {/* Modale creazione nuovo gruppo */}
      <Modal
        open={showCreate}
        title="Nuovo gruppo"
        onClose={() => setShowCreate(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowCreate(false)}
            >
              Annulla
            </button>
            <button
              type="submit"
              form="create-group-form"
              className="btn btn-primary"
              disabled={creating || !name.trim()}
            >
              {creating ? 'Creazione…' : 'Crea gruppo'}
            </button>
          </>
        }
      >
        <form id="create-group-form" className="form-stack" onSubmit={handleCreateSubmit}>
          <label className="field">
            <span className="field-label">Nome del gruppo</span>
            <input
              type="text"
              className="input"
              placeholder="Es. Casa, Spese insieme, Vacanza in Portogallo"
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </label>

          <label className="field">
            <span className="field-label">
              <span>Descrizione</span>
              <span className="field-hint">Opzionale</span>
            </span>
            <input
              type="text"
              className="input"
              placeholder="Es. Spese quotidiane e bollette"
              maxLength={280}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>

          <label className="field">
            <span className="field-label">Valuta di riferimento del gruppo</span>
            <select
              className="select"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name} ({c.symbol})
                </option>
              ))}
            </select>
            <span className="field-hint">
              Potrai comunque registrare spese in qualsiasi altra valuta: verranno convertite
              automaticamente al cambio della data della spesa.
            </span>
          </label>
        </form>
      </Modal>

      {/* Modale incolla link d'invito */}
      <Modal
        open={showJoinModal}
        title="Entra con un link d'invito"
        onClose={() => setShowJoinModal(false)}
        footer={
          <>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setShowJoinModal(false)}
            >
              Annulla
            </button>
            <button
              type="submit"
              form="join-group-form"
              className="btn btn-primary"
              disabled={!inviteInput.trim()}
            >
              Verifica invito
            </button>
          </>
        }
      >
        <form id="join-group-form" className="form-stack" onSubmit={handleJoinSubmit}>
          <label className="field">
            <span className="field-label">Link d&apos;invito ricevuto</span>
            <input
              type="text"
              className="input"
              placeholder="https://.../?invito=..."
              value={inviteInput}
              onChange={(e) => setInviteInput(e.target.value)}
              autoFocus
              required
            />
            <span className="field-hint">
              Vedrai prima i dettagli del gruppo e potrai scegliere se accettare o rifiutare.
            </span>
          </label>
        </form>
      </Modal>
    </div>
  );
}
