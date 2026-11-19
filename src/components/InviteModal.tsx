import { Check, Copy, Eye, Pencil, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { DataRepository } from '../lib/repository';
import { buildInviteUrl, translateErrorIT } from '../lib/supabase';
import type { ExpenseGroup, GroupInvite } from '../types';
import { Modal } from './Modal';

type Invites = Pick<DataRepository, 'getGroupInvites' | 'regenerateInvite' | 'setInviteEnabled'>;
type Toast = (msg: string, isError?: boolean) => void;

export function InviteModal({
  group,
  repo,
  revision,
  onClose,
  onToast,
}: {
  group: ExpenseGroup;
  repo: Invites;
  revision?: string;
  onClose: () => void;
  onToast: Toast;
}) {
  const [links, setLinks] = useState<GroupInvite[] | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState('');
  const reload = () => setAttempt((n) => n + 1);

  // I token vengono richiesti solo a modale aperta, mai nella home o nei dati del gruppo.
  useEffect(() => {
    let current = true;
    setError('');
    setLinks(null);
    repo.getGroupInvites(group.id).then(
      (next) => {
        if (current) setLinks(next);
      },
      (err) => {
        if (current) setError(translateErrorIT(err));
      }
    );
    return () => {
      current = false;
    };
  }, [group.id, repo, revision, attempt]);

  return (
    <Modal open title={`Invita in «${group.name}»`} onClose={onClose}>
      <div className="form-stack">
        <p className="text-secondary">
          Scegli il link in base a cosa può fare la persona che inviti. In entrambi i casi sceglierà
          il proprio nome, anche senza account.
        </p>
        {error ? (
          <div className="alert alert-warning" role="alert">
            {error}{' '}
            <button className="link-btn" onClick={reload}>
              Riprova
            </button>
          </div>
        ) : !links ? (
          <p role="status" className="field-hint">
            Caricamento dei link…
          </p>
        ) : (
          <>
            {(['viewer', 'editor'] as const).map((role) => {
              const invite = links.find((i) => i.role === role);
              return (
                invite && (
                  <InviteCard
                    key={role}
                    invite={invite}
                    group={group}
                    repo={repo}
                    onChanged={reload}
                    onToast={onToast}
                  />
                )
              );
            })}
            {!links.some((i) => i.role === 'viewer') && (
              <p className="alert alert-warning">
                Per attivare il link in sola visualizzazione, chi gestisce BauSplit deve aggiornare
                Supabase con lo{' '}
                <a
                  href="https://github.com/SylarPower/BauSplit/blob/main/supabase/schema.sql"
                  target="_blank"
                  rel="noreferrer"
                >
                  script SQL di questa versione
                </a>
                . Il link con modifica non è un invito in sola lettura.
              </p>
            )}
            <p className="field-hint">
              Chi riceve un link può usarlo: condividilo solo con le persone del gruppo. Chi è già
              membro mantiene il proprio permesso.
            </p>
          </>
        )}
      </div>
    </Modal>
  );
}

function InviteCard({
  invite,
  group,
  repo,
  onChanged,
  onToast,
}: {
  invite: GroupInvite;
  group: ExpenseGroup;
  repo: Invites;
  onChanged: () => void;
  onToast: Toast;
}) {
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const viewer = invite.role === 'viewer';
  const title = viewer ? 'Solo visualizzazione' : 'Con modifica';
  const url = buildInviteUrl(invite.token);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2200);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onToast(`Link «${title}» copiato`);
    } catch {
      onToast('Seleziona e copia il link dal campo di testo.', true);
    }
  };
  const share = async () => {
    try {
      await navigator.share({
        title: `BauSplit · ${group.name}`,
        text: `Invito in «${group.name}» · ${title}`,
        url,
      });
    } catch (err) {
      if (!(err instanceof Error && err.name === 'AbortError'))
        onToast('Non è stato possibile condividere il link. Puoi copiarlo.', true);
    }
  };
  const manage = async (rotate: boolean) => {
    setBusy(true);
    try {
      if (rotate) await repo.regenerateInvite(group.id, invite.role);
      else await repo.setInviteEnabled(group.id, !invite.enabled, invite.role);
      onToast(
        `Link «${title}» ${rotate ? 'rigenerato' : invite.enabled ? 'disattivato' : 'riattivato'}`
      );
      onChanged();
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <section className="card-subtle invite-permission" aria-label={title}>
      <h3>
        {viewer ? <Eye size={18} /> : <Pencil size={17} />}
        {title}
      </h3>
      <p className="field-hint">
        {viewer
          ? 'Partecipa alle divisioni e vede il proprio saldo, le spese e lo storico. Non può modificare il gruppo né gestire gli inviti.'
          : 'Può aggiungere, modificare ed eliminare spese, registrare rimborsi e invitare altre persone.'}
      </p>
      {invite.enabled ? (
        <>
          <input
            className="input"
            aria-label={`Link: ${title}`}
            value={url}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="inline-actions">
            <button
              className="btn btn-primary btn-sm"
              aria-label={`Copia link: ${title}`}
              onClick={copy}
              disabled={busy}
            >
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'Copiato!' : 'Copia link'}
            </button>
            {typeof navigator.share === 'function' && (
              <button
                className="btn btn-secondary btn-sm"
                aria-label={`Condividi link: ${title}`}
                onClick={share}
                disabled={busy}
              >
                <Share2 size={15} /> Condividi
              </button>
            )}
          </div>
        </>
      ) : (
        <span className="badge badge-warning">Link disattivato</span>
      )}
      <details>
        <summary>Gestisci questo link</summary>
        {confirm ? (
          <div className="form-stack">
            <p className="field-hint">
              Il link «{title}» attuale non funzionerà più. Quello nuovo sarà attivo. L’altro link e
              chi è già nel gruppo non cambiano.
            </p>
            <div className="inline-actions">
              <button
                className="btn btn-secondary btn-sm"
                disabled={busy}
                onClick={() => manage(true)}
              >
                Conferma rigenerazione
              </button>
              <button
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                Annulla
              </button>
            </div>
          </div>
        ) : (
          <div className="inline-actions">
            <button
              className="btn btn-secondary btn-sm"
              disabled={busy}
              onClick={() => manage(false)}
            >
              {invite.enabled ? 'Disattiva link' : 'Riattiva link'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              Rigenera link
            </button>
          </div>
        )}
      </details>
    </section>
  );
}
