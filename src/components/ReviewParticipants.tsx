import type { GroupMember } from '../types';

/** Un modulo già aperto può avere ancora una quota che la lista non mostra più. */
export function reviewSelection(members: GroupMember[], paidBy: string, selectedIds: string[]) {
  const eligible = new Set(members.map((m) => m.userId));
  const ids = selectedIds.filter((id) => eligible.has(id));
  const payer = eligible.has(paidBy) ? paidBy : '';
  return { ids, payer, changed: payer !== paidBy || ids.length !== selectedIds.length };
}

export function ReviewParticipants({ onReview }: { onReview: () => void }) {
  return (
    <div role="alert" className="creator-confirm">
      <strong>L’elenco dei partecipanti è cambiato.</strong>
      <p>
        Aggiorna la selezione e controlla pagante e quote prima di salvare. I dati già compilati
        resteranno nel modulo.
      </p>
      <button type="button" className="btn btn-secondary btn-sm" onClick={onReview}>
        Aggiorna selezione
      </button>
    </div>
  );
}
