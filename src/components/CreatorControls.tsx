import { Archive, Pencil, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { formatMoney } from '../lib/currencies';
import type { CreatorRepository } from '../lib/repository';
import { translateErrorIT } from '../lib/supabase';
import type { DeletionPreview, ExpenseGroup, GroupMember, RemovalPreview } from '../types';
import { Avatar } from './Icon';

export interface CreatorControlsProps {
  repo: CreatorRepository;
  onChanged: () => Promise<void>;
  onDeleted: () => void;
  hasCarry: boolean;
}

type MemberAction =
  | { kind: 'rename'; seat: string; name: string }
  | { kind: 'remove'; seat: string; preview: RemovalPreview }
  | { kind: 'return'; seat: string };

export function ParticipantManager({
  group,
  members,
  currentSeat,
  controls,
  onToast,
}: {
  group: ExpenseGroup;
  members: GroupMember[];
  currentSeat: string;
  controls: CreatorControlsProps;
  onToast: (message: string) => void;
}) {
  const [action, setAction] = useState<MemberAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ seat: string; message: string } | null>(null);
  const active = members.filter((m) => !m.leftAt);
  const former = members.filter((m) => m.leftAt);
  const start = (next: MemberAction | null) => {
    setError(null);
    setAction(next);
  };
  const prepareRemoval = async (seat: string) => {
    start(null);
    setBusy(true);
    try {
      const preview = await controls.repo.previewRemoval(group.id, seat);
      setAction({ kind: 'remove', seat, preview });
    } catch (err) {
      setError({ seat, message: translateErrorIT(err) });
    } finally {
      setBusy(false);
    }
  };
  const save = async (m: GroupMember) => {
    if (busy || !action || action.seat !== m.userId) return;
    setError(null);
    setBusy(true);
    try {
      let message: string;
      if (action.kind === 'rename') {
        await controls.repo.renameParticipant(group.id, m.userId, action.name.trim());
        message = 'Nome aggiornato solo in questo gruppo';
      } else if (action.kind === 'return') {
        await controls.repo.allowParticipantReturn(group.id, m.userId);
        message = m.ownerId
          ? 'Rientro autorizzato. Da Invita, condividi il link per il permesso che vuoi concedere.'
          : 'Partecipante reincluso nelle divisioni';
      } else {
        await controls.repo.removeParticipant(action.preview);
        message =
          action.preview.mode === 'delete'
            ? `Nome «${action.preview.name}» eliminato`
            : 'Partecipante rimosso. I conti precedenti non cambiano.';
      }
      setAction(null);
      await controls.onChanged();
      onToast(message);
    } catch (err) {
      if (action.kind === 'remove') setAction(null); // ricaricare l’anteprima, non riconfermare dati vecchi
      setError({ seat: m.userId, message: translateErrorIT(err) });
    } finally {
      setBusy(false);
    }
  };

  const row = (m: GroupMember) => {
    const chosen = action?.seat === m.userId ? action : null;
    return (
      <li key={m.userId} className="creator-person">
        <div className="creator-person-head">
          <Avatar name={m.displayName} seed={m.userId} size={30} />
          <div className="creator-person-label">
            <strong>
              {m.displayName}
              {m.userId === currentSeat && ' (tu)'}
            </strong>
            <span className="field-hint">
              {m.removedAt
                ? m.ownerId
                  ? 'Accesso revocato'
                  : 'Escluso dalle nuove spese'
                : m.leftAt
                  ? m.ownerId
                    ? 'Non attivo · può rientrare su invito'
                    : 'Posto storico'
                  : m.ownerId
                    ? m.accessRole === 'viewer'
                      ? 'Solo visualizzazione'
                      : 'Può modificare il gruppo'
                    : 'Partecipa solo per nome'}
            </span>
          </div>
          <div className="creator-person-tools">
            <button
              type="button"
              className="btn-icon"
              aria-label={`Rinomina ${m.displayName}`}
              title="Rinomina solo qui"
              disabled={busy}
              onClick={() => start({ kind: 'rename', seat: m.userId, name: m.displayName })}
            >
              <Pencil size={16} />
            </button>
            {m.userId !== currentSeat &&
              (m.removedAt ? (
                <button
                  type="button"
                  className="btn-icon"
                  aria-label={`${m.ownerId ? 'Consenti nuovo invito per' : 'Reincludi'} ${m.displayName}`}
                  title={m.ownerId ? 'Consenti nuovo invito' : 'Reincludi nelle spese'}
                  disabled={busy}
                  onClick={() => start({ kind: 'return', seat: m.userId })}
                >
                  <UserPlus size={17} />
                </button>
              ) : (
                (!m.leftAt || m.ownerId) && (
                  <button
                    type="button"
                    className="btn-icon"
                    aria-label={`Rimuovi ${m.displayName}`}
                    title="Rimuovi partecipante"
                    disabled={busy}
                    onClick={() => void prepareRemoval(m.userId)}
                  >
                    <UserMinus size={17} />
                  </button>
                )
              ))}
          </div>
        </div>
        {chosen && (
          <form
            className="creator-confirm"
            onSubmit={(e) => {
              e.preventDefault();
              void save(m);
            }}
          >
            {chosen.kind === 'rename' ? (
              <label className="field">
                <span className="field-label">Nome o soprannome nel gruppo</span>
                <input
                  className="input"
                  autoFocus
                  aria-label="Nome o soprannome nel gruppo"
                  aria-describedby={`alias-help-${m.userId}`}
                  required
                  maxLength={60}
                  value={chosen.name}
                  onChange={(e) => setAction({ ...chosen, name: e.target.value })}
                />
                <span className="field-hint" id={`alias-help-${m.userId}`}>
                  Il profilo e i nomi negli altri gruppi non cambiano.
                </span>
              </label>
            ) : chosen.kind === 'return' ? (
              <p>
                {m.ownerId
                  ? `${m.displayName} potrà rientrare sullo stesso posto solo accettando un nuovo invito. Confermi?`
                  : `${m.displayName} tornerà tra i partecipanti alle nuove spese, senza ricevere accesso. Confermi?`}
              </p>
            ) : (
              <>
                <strong>Rimuovere {chosen.preview.name}?</strong>
                <p>
                  Saldo attuale:{' '}
                  <strong className="tabular">
                    {formatMoney(chosen.preview.balance, group.baseCurrency, { signed: true })}
                  </strong>{' '}
                  (
                  {chosen.preview.balance < 0
                    ? 'da pagare'
                    : chosen.preview.balance > 0
                      ? 'da ricevere'
                      : 'in pari'}
                  )
                </p>
                <p>
                  {chosen.preview.mode === 'delete'
                    ? 'È un nome senza accesso né movimenti: verrà eliminato dall’elenco.'
                    : 'Non comparirà nelle nuove spese. Le quote precedenti restano invariate e puoi ancora registrare i rimborsi.'}
                </p>
                {chosen.preview.mode === 'revoke' && (
                  <p>
                    L’accesso sarà revocato. Entrambi i vecchi link smetteranno di funzionare per
                    tutti. Per rientrare serviranno il tuo permesso e un nuovo invito.
                  </p>
                )}
                {chosen.preview.pauseCount > 0 && (
                  <p>
                    Ricorrenze che verranno messe in pausa:{' '}
                    <strong>{chosen.preview.pauseCount}</strong>. Rivedi pagante e quote prima di
                    riattivarle.
                  </p>
                )}
              </>
            )}
            <div className="inline-actions">
              <button
                type="submit"
                className={`btn btn-sm ${chosen.kind === 'remove' ? 'btn-danger-solid' : 'btn-primary'}`}
                disabled={
                  busy ||
                  (chosen.kind === 'rename' &&
                    (!chosen.name.trim() || chosen.name.trim() === m.displayName))
                }
              >
                {chosen.kind === 'rename'
                  ? 'Salva nome'
                  : chosen.kind === 'return'
                    ? m.ownerId
                      ? 'Conferma permesso'
                      : 'Reincludi nelle spese'
                    : 'Conferma rimozione'}
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => start(null)}
              >
                Annulla
              </button>
            </div>
          </form>
        )}
        {error?.seat === m.userId && (
          <p role="alert" className="alert alert-error">
            {error.message}
          </p>
        )}
      </li>
    );
  };
  return (
    <section className="field" aria-label="Gestisci partecipanti" aria-busy={busy}>
      <h3 className="field-label">Gestisci partecipanti ({active.length})</h3>
      <p className="field-hint">
        Puoi correggere un nome o rimuovere una persona solo da questo conto.
      </p>
      <ul className="creator-people">{active.map(row)}</ul>
      {former.length > 0 && (
        <details>
          <summary className="creator-summary">Partecipanti non attivi ({former.length})</summary>
          <ul className="creator-people">{former.map(row)}</ul>
        </details>
      )}
    </section>
  );
}

export function PersonalGroupDeletion({
  group,
  controls,
  onArchive,
}: {
  group: ExpenseGroup;
  controls: CreatorControlsProps;
  onArchive: () => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const blocked = group.everShared
    ? 'Un’altra persona ha già avuto accesso a questo conto.'
    : controls.hasCarry
      ? 'Questo conto ha un riporto di saldo con un altro gruppo.'
      : '';
  const run = async () => {
    if (busy || blocked) return;
    setError('');
    setBusy(true);
    try {
      if (!preview) setPreview(await controls.repo.previewDeletion(group.id));
      else {
        await controls.repo.deletePersonalGroup(preview);
        controls.onDeleted();
      }
    } catch (err) {
      setPreview(null);
      setError(translateErrorIT(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="field" aria-label="Eliminazione del conto">
      <h3 className="field-label">Eliminazione del conto</h3>
      {blocked ? (
        <>
          <p className="field-hint">
            {blocked} Non può essere eliminato.{' '}
            {group.closedAt
              ? 'Lo storico resta consultabile.'
              : 'Puoi archiviarlo mantenendo lo storico.'}
          </p>
          {!group.closedAt && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              style={{ alignSelf: 'flex-start' }}
              onClick={onArchive}
            >
              <Archive size={15} /> Archivia invece…
            </button>
          )}
        </>
      ) : preview ? (
        <div className="creator-confirm" role="group" aria-label="Conferma eliminazione definitiva">
          <strong>Eliminare «{preview.name}» definitivamente?</strong>
          <p>
            Verranno cancellati i partecipanti ({preview.people}), le spese ({preview.expenses}), i
            rimborsi ({preview.refunds}), le ricorrenze ({preview.recurring}) e lo storico (
            {preview.activities} attività).
          </p>
          <p>Non potrai annullare. Per conservare questi dati, scegli l’archiviazione.</p>
          <div className="inline-actions">
            <button
              type="button"
              className="btn btn-danger-solid btn-sm"
              disabled={busy}
              onClick={() => void run()}
            >
              Elimina definitivamente
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Annulla
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="field-hint">
            Nessun altro è mai entrato. I partecipanti aggiunti solo per nome non impediscono
            l’eliminazione.
          </p>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            style={{ alignSelf: 'flex-start' }}
            disabled={busy}
            onClick={() => void run()}
          >
            <Trash2 size={15} /> Elimina conto personale
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="alert alert-error">
          {error}
        </p>
      )}
    </section>
  );
}
