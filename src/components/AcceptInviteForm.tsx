import { Check, X } from 'lucide-react';
import { useState } from 'react';
import type { InviteChoice, InvitePreview } from '../types';
import { translateErrorIT } from '../lib/supabase';

export function AcceptInviteForm({
  preview,
  defaultName,
  onAccept,
  onDecline,
  onRefresh,
}: {
  preview: InvitePreview;
  defaultName: string;
  onAccept: (choice: InviteChoice) => Promise<void>;
  onDecline: () => void;
  onRefresh: () => void;
}) {
  const available = preview.availableNames ?? [];
  const [slot, setSlot] = useState(available.length ? '' : 'new');
  const [name, setName] = useState(defaultName === 'Ospite' ? '' : defaultName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const choice = slot === 'new' ? { name: name.trim() } : { memberId: slot };
  return (
    <form
      className="form-stack"
      onSubmit={async (e) => {
        e.preventDefault();
        setError('');
        setBusy(true);
        try {
          await onAccept(preview.returningName ? null : choice);
        } catch (err) {
          setError(translateErrorIT(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      {preview.returningName ? (
        <p>
          Rientrerai come <strong>{preview.returningName}</strong>, con le tue quote precedenti.
        </p>
      ) : (
        <>
          {available.length > 0 && (
            <label className="field">
              <span className="field-label">Qual è il tuo nome nel gruppo?</span>
              <select
                className="select"
                required
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
              >
                <option value="" disabled>
                  Scegli il tuo nome…
                </option>
                {available.map((p) => (
                  <option value={p.id} key={p.id}>
                    {p.name}
                  </option>
                ))}
                <option value="new">Il mio nome non c’è: aggiungilo</option>
              </select>
              <span className="field-hint">
                Scegliendo un nome già in elenco ritrovi anche le spese assegnate a quel nome.
              </span>
            </label>
          )}
          {slot === 'new' && (
            <label className="field">
              <span className="field-label">Il tuo nome in questo gruppo</span>
              <input
                className="input"
                required
                maxLength={60}
                value={name}
                placeholder="Nome o soprannome"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
          )}
        </>
      )}
      {error && (
        <div role="alert" className="alert alert-error">
          {error}{' '}
          <button type="button" className="link-btn" onClick={onRefresh}>
            Aggiorna l’invito
          </button>
        </div>
      )}
      <div className="inline-actions">
        <button
          className="btn btn-primary"
          disabled={busy || (!preview.returningName && (!slot || (slot === 'new' && !name.trim())))}
        >
          <Check size={16} /> {busy ? 'Accesso al gruppo…' : 'Accetta ed entra nel gruppo'}
        </button>
        <button className="btn btn-secondary" type="button" disabled={busy} onClick={onDecline}>
          <X size={15} /> Rifiuta
        </button>
      </div>
    </form>
  );
}
