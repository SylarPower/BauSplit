import { useMemo, useState, type FormEvent } from 'react';
import { CURRENCIES } from '../lib/currencies';
import { quickContacts } from '../lib/quickEvent';
import { isMissingSchemaError, translateErrorIT } from '../lib/supabase';
import type {
  GroupMember,
  GroupOverview,
  QuickEventInput,
  QuickEventMatch,
  QuickPersonInput,
} from '../types';
import { Modal } from './Modal';

type Props = { groups: GroupOverview[]; ownerId: string; onClose: () => void } & (
  | { mode: 'create'; selfName: string; onCreate: (input: QuickEventInput) => Promise<void> }
  | {
      mode: 'add';
      members: GroupMember[];
      matches: QuickEventMatch[];
      onAdd: (people: QuickPersonInput[]) => Promise<void>;
    }
);

export function QuickEventForm(props: Props) {
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('EUR');
  const [search, setSearch] = useState('');
  const [chosen, setChosen] = useState<Record<string, QuickPersonInput>>({});
  const [otherNames, setOtherNames] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const contacts = useMemo(
    () => quickContacts(props.groups, props.ownerId),
    [props.groups, props.ownerId]
  );
  const present = props.mode === 'add' ? props.members.filter((m) => !m.leftAt) : [];
  const presentNames =
    props.mode === 'create' ? [props.selfName] : present.map((m) => m.displayName);
  const available = contacts.filter(
    (c) =>
      props.mode === 'create' ||
      (!present.some((m) => m.ownerId === c.key) &&
        !props.matches.some((m) => m.groupId === c.source.groupId && m.seatId === c.source.seatId))
  );
  const visible = available.filter((c) =>
    [c.name, ...c.groups].join(' ').toLowerCase().includes(search.trim().toLowerCase())
  );
  const people = [
    ...Object.values(chosen),
    ...otherNames
      .split('\n')
      .map((n) => n.trim())
      .filter(Boolean)
      .map((name) => ({ name })),
  ];
  const creating = props.mode === 'create';
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const used = new Set(presentNames.map((n) => n.trim().toLowerCase()));
    for (const p of people) {
      const n = p.name.trim();
      if (n.length < 1 || n.length > 60) {
        setError('Usa nomi da 1 a 60 caratteri.');
        return;
      }
      if (used.has(n.toLowerCase())) {
        setError(`«${n}» è già presente. Usa un soprannome per distinguere due persone diverse.`);
        return;
      }
      used.add(n.toLowerCase());
    }
    setBusy(true);
    setError('');
    try {
      if (props.mode === 'create')
        await props.onCreate({ name: name.trim(), baseCurrency: currency, people });
      else await props.onAdd(people);
      props.onClose();
    } catch (err) {
      setError(
        isMissingSchemaError(err)
          ? 'Per usare i conti al volo, chi gestisce BauSplit deve aggiornare Supabase con il file supabase/schema.sql. I gruppi esistenti non cambiano.'
          : translateErrorIT(err)
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title={creating ? 'Conto al volo' : 'Aggiungi persone alla serata'}
      onClose={() => {
        if (!busy) props.onClose();
      }}
      footer={
        <>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={props.onClose}>
            Annulla
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            form="quick-event-form"
            disabled={busy || (creating ? !name.trim() : !people.length)}
          >
            {busy ? 'Salvataggio…' : creating ? 'Crea serata' : 'Aggiungi persone'}
          </button>
        </>
      }
    >
      <form id="quick-event-form" className="form-stack" onSubmit={submit}>
        {creating && (
          <>
            <p className="text-secondary">
              Un conto separato per un’occasione. Registra chi anticipa e dividi ogni spesa solo tra
              chi partecipa.
            </p>
            <label className="field">
              <span className="field-label">Nome della serata</span>
              <input
                autoFocus
                required
                maxLength={80}
                className="input"
                placeholder="Es. Cena di sabato"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">Valuta della serata</span>
              <select
                className="select"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <div className="card-subtle">
          <strong>{creating ? `${props.selfName} (tu)` : 'Già nella serata'}</strong>
          <p className="field-hint">
            {creating
              ? people.length
                ? `${people.length + 1} partecipanti, te compreso.`
                : 'Per ora ci sei solo tu. Puoi aggiungere persone anche più tardi.'
              : presentNames.join(', ')}
          </p>
        </div>
        <fieldset className="quick-contacts">
          <legend className="field-label">Persone dai tuoi gruppi</legend>
          {available.length === 0 ? (
            <p className="field-hint">
              Nessun altro partecipante da suggerire. Puoi scrivere i nomi qui sotto.
            </p>
          ) : (
            <>
              {available.length > 6 && (
                <input
                  className="input input-sm"
                  aria-label="Cerca persona o gruppo"
                  placeholder="Cerca persona o gruppo"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              )}
              <div className="quick-contact-list">
                {visible.map((c) => (
                  <label key={c.key} className="quick-contact">
                    <input
                      type="checkbox"
                      checked={!!chosen[c.key]}
                      onChange={(e) => {
                        const next = { ...chosen };
                        if (e.target.checked) next[c.key] = { name: c.name, source: c.source };
                        else delete next[c.key];
                        setChosen(next);
                      }}
                    />
                    <span>
                      <strong>{c.name}</strong>
                      <small>{c.groups.join(' · ')}</small>
                    </span>
                  </label>
                ))}
                {!visible.length && <small>Nessuna corrispondenza.</small>}
              </div>
            </>
          )}
          <p className="field-hint">
            Se scegli una persona qui, potrai riconoscerla per il riporto del saldo. Non riceverà
            accesso automatico alla serata.
          </p>
        </fieldset>
        {Object.keys(chosen).length > 0 && (
          <details className="quick-aliases">
            <summary>Usa un soprannome nella serata</summary>
            {Object.entries(chosen).map(([key, p]) => (
              <label key={key} className="field">
                <span className="field-label">
                  Nome nella serata per {contacts.find((c) => c.key === key)?.name}
                </span>
                <input
                  className="input input-sm"
                  required
                  maxLength={60}
                  value={p.name}
                  onChange={(e) => setChosen({ ...chosen, [key]: { ...p, name: e.target.value } })}
                />
              </label>
            ))}
          </details>
        )}
        <div className="field">
          <label className="field-label" htmlFor="quick-other-names">
            Altri partecipanti
          </label>
          <textarea
            id="quick-other-names"
            aria-describedby="quick-other-hint"
            className="input"
            rows={2}
            placeholder="Un nome per riga"
            value={otherNames}
            onChange={(e) => setOtherNames(e.target.value)}
          />
          <span className="field-hint" id="quick-other-hint">
            Basta il nome, non servono email. Un nome scritto a mano non collega due gruppi.
          </span>
        </div>
        {error && (
          <p className="alert alert-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}
