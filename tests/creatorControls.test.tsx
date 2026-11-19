// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupView } from '../src/components/GroupView';
import { processDueRecurringExpenses, type DataRepository } from '../src/lib/repository';
import { expense, group, member } from './fixtures/groupViews';
import type { GroupData, RecurringExpense, RemovalPreview } from '../src/types';

vi.mock('../src/lib/supabase', () => ({
  buildInviteUrl: () => 'invito',
  translateErrorIT: (err: Error) => err.message,
}));
afterEach(cleanup);

const currentOwner = 'account-collegato';
const people = [
  member('a', 'Anna', currentOwner),
  member('b', 'Giulia', null),
  member('c', 'Luca', null),
  member('d', 'Sara', null),
];
const dinner = expense(
  'Cena',
  80,
  'a',
  people.map((m) => m.userId)
);
function setup(event: boolean, creator = true) {
  const g = {
    ...group('ev', 'Cena', event ? 'a' : null),
    createdBy: 'vecchio-ospite',
    creatorOwnerId: currentOwner,
    everShared: false,
  };
  let data: GroupData = {
    group: g,
    members: people,
    categories: [{ name: 'Altro', key: 'altro', color: '#abcdef', icon: 'tag', hidden: false }],
    expenses: [dinner],
    settlements: [],
    activityLogs: [],
    recurringExpenses: [],
  };
  const preview: RemovalPreview = {
    groupId: g.id,
    seatId: 'd',
    ownerId: null,
    name: 'Sara',
    mode: 'retire',
    balance: -20,
    pauseCount: 0,
  };
  const deletion = {
    groupId: g.id,
    name: g.name,
    people: 4,
    expenses: 1,
    refunds: 0,
    recurring: 0,
    activities: 3,
  };
  const repo = {
    previewRemoval: vi.fn().mockResolvedValue(preview),
    removeParticipant: vi.fn().mockResolvedValue(undefined),
    renameParticipant: vi.fn().mockResolvedValue(undefined),
    allowParticipantReturn: vi.fn().mockResolvedValue(undefined),
    previewDeletion: vi.fn().mockResolvedValue(deletion),
    deletePersonalGroup: vi.fn().mockResolvedValue(undefined),
    saveSettlement: vi.fn().mockResolvedValue('r'),
    closeGroup: vi.fn().mockResolvedValue({ transferredCount: 0 }),
  };
  const props = {
    repo: repo as unknown as DataRepository,
    currentUserId: creator ? 'a' : 'd',
    actorId: creator ? currentOwner : 'sara-account',
    allGroups: [],
    onBack: vi.fn(),
    onNavigateGroup: vi.fn(),
    onRefreshGroup: vi.fn().mockResolvedValue(undefined),
    onGroupLeft: vi.fn(),
    onToast: vi.fn(),
  };
  const view = render(<GroupView {...props} data={data} />);
  const update = (patch: Partial<GroupData>) => {
    data = { ...data, ...patch };
    view.rerender(<GroupView {...props} data={data} />);
  };
  return { g, repo, props, update, preview, deletion };
}
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const settings = () => click('Impostazioni del gruppo');
const dialog = () => within(screen.getByRole('dialog'));

it.each([false, true])(
  'conferma il saldo, non ridivide la spesa e permette il rimborso dopo la rimozione (serata=%s)',
  async (event) => {
    const { repo, preview, update, props } = setup(event);
    settings();
    expect(screen.queryByRole('button', { name: 'Rimuovi Anna' })).toBeNull();
    click('Rimuovi Sara');
    expect(await screen.findByText('Rimuovere Sara?')).toBeTruthy();
    expect(screen.getByText(/Saldo attuale:/).textContent).toMatch(/−20,00.*da pagare/);
    expect(repo.removeParticipant).not.toHaveBeenCalled();
    click('Annulla');
    expect(repo.removeParticipant).not.toHaveBeenCalled();
    click('Rimuovi Sara');
    await screen.findByText('Rimuovere Sara?');
    click('Conferma rimozione');
    await waitFor(() => expect(props.onRefreshGroup).toHaveBeenCalledTimes(1));
    expect(repo.removeParticipant).toHaveBeenCalledWith(preview);
    update({
      members: people.map((m) =>
        m.userId === 'd' ? { ...m, leftAt: '2026-11-18', removedAt: '2026-11-18' } : m
      ),
    });
    click('Chiudi finestra');
    click('Aggiungi spesa');
    expect(dialog().queryByRole('option', { name: /Sara/ })).toBeNull();
    expect(dialog().queryByRole('button', { name: /Sara/ })).toBeNull();
    expect(dialog().getByRole('option', { name: /Luca/ })).toBeTruthy();
    click('Annulla');
    fireEvent.click(screen.getAllByRole('button', { name: 'Saldi' })[0]);
    const row = screen
      .getAllByText('Sara')
      .map((el) => el.closest('.transfer-row'))
      .find((el) => el);
    expect(row?.textContent).toMatch(/20,00/);
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Segna rimborso' }));
    expect((dialog().getByLabelText('Chi ha pagato') as HTMLSelectElement).value).toBe('d');
    expect((dialog().getByLabelText('Importo del rimborso') as HTMLInputElement).value).toBe('20');
    fireEvent.click(dialog().getByRole('button', { name: 'Registra rimborso' }));
    await waitFor(() =>
      expect(repo.saveSettlement).toHaveBeenCalledWith(
        expect.objectContaining({
          input: expect.objectContaining({ fromUser: 'd', toUser: 'a', amount: 20 }),
        })
      )
    );
  }
);

it('le azioni sul posto sono locali; dopo una conferma obsoleta richiede una nuova anteprima', async () => {
  const { g, repo, update, preview } = setup(false);
  settings();
  click('Rinomina Sara');
  fireEvent.change(screen.getByRole('textbox', { name: 'Nome o soprannome nel gruppo' }), {
    target: { value: ' Sarina ' },
  });
  click('Salva nome');
  await waitFor(() => expect(repo.renameParticipant).toHaveBeenCalledWith('ev', 'd', 'Sarina'));
  const claimed = { ...people[3], displayName: 'Sarina', ownerId: 'sara-account' };
  update({ members: [...people.slice(0, 3), claimed], group: { ...g, everShared: true } });
  repo.previewRemoval.mockResolvedValue({
    ...preview,
    name: 'Sarina',
    mode: 'revoke',
    pauseCount: 1,
  });
  repo.removeParticipant.mockRejectedValueOnce(
    new Error('I dati sono cambiati: ricontrolla la rimozione')
  );
  click('Rimuovi Sarina');
  await screen.findByText(/Il vecchio link/);
  expect(screen.getByText(/Ricorrenze che verranno/)).toBeTruthy();
  click('Conferma rimozione');
  expect((await screen.findByRole('alert')).textContent).toMatch(/cambiati/);
  expect(screen.queryByRole('button', { name: 'Conferma rimozione' })).toBeNull();
  update({ members: [...people.slice(0, 3), { ...claimed, leftAt: 'ieri', removedAt: 'ieri' }] });
  fireEvent.click(screen.getByText('Partecipanti non attivi (1)'));
  click('Consenti nuovo invito per Sarina');
  expect(repo.allowParticipantReturn).not.toHaveBeenCalled();
  click('Conferma permesso');
  await waitFor(() => expect(repo.allowParticipantReturn).toHaveBeenCalledWith('ev', 'd'));
});

it.each([false, true])(
  'l’eliminazione personale richiede anteprima e conferma distinte (serata=%s)',
  async (event) => {
    const { repo, props, deletion } = setup(event);
    settings();
    click('Elimina conto personale');
    await screen.findByRole('group', { name: 'Conferma eliminazione definitiva' });
    expect(screen.getByText(/Verranno cancellati/).textContent).toMatch(
      /partecipanti \(4\).*spese \(1\)/
    );
    expect(repo.deletePersonalGroup).not.toHaveBeenCalled();
    click('Annulla');
    click('Elimina conto personale');
    await screen.findByRole('button', { name: 'Elimina definitivamente' });
    click('Elimina definitivamente');
    await waitFor(() => expect(props.onGroupLeft).toHaveBeenCalledWith(true));
    expect(repo.deletePersonalGroup).toHaveBeenCalledWith(deletion);
  }
);

it.each(['condiviso', 'riporto'] as const)(
  'un conto protetto (%s) offre archiviazione, non eliminazione',
  async (why) => {
    const { update, g, repo } = setup(true);
    update(
      why === 'condiviso'
        ? { group: { ...g, everShared: true } }
        : {
            settlements: [
              {
                ...dinner,
                fromUser: 'a',
                toUser: 'd',
                kind: 'transfer_in',
                settlementDate: dinner.expenseDate,
                linkedGroupName: 'Casa',
              },
            ],
          }
    );
    settings();
    expect(screen.queryByRole('button', { name: /Elimina conto/ })).toBeNull();
    click('Archivia invece…');
    expect(repo.closeGroup).not.toHaveBeenCalled();
    click('Archivia senza riporto');
    await waitFor(() =>
      expect(repo.closeGroup).toHaveBeenCalledWith(expect.objectContaining({ targetGroup: null }))
    );
    expect(repo.previewDeletion).not.toHaveBeenCalled();
  }
);

it('un partecipante con accesso non vede azioni del creatore', () => {
  const { update, g } = setup(false, false);
  update({
    members: people.map((m) => (m.userId === 'd' ? { ...m, ownerId: 'sara-account' } : m)),
    group: { ...g, everShared: true },
  });
  settings();
  expect(screen.queryByRole('region', { name: 'Gestisci partecipanti' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Eliminazione del conto' })).toBeNull();
  expect(dialog().getByRole('button', { name: 'Esci dal gruppo' })).toBeTruthy();
});

it('il generatore non addebita quote agli ex membri né le spalma sugli altri, neanche con Registra ora', async () => {
  const { groupId, ...base } = dinner;
  const rec: RecurringExpense = {
    ...base,
    groupId,
    frequency: 'monthly',
    startDate: '2026-01-01',
    nextDueDate: '2026-02-01',
    endDate: null,
    active: true,
    fixedExchangeRate: null,
  };
  const data: GroupData = {
    group: group('ev', 'Casa'),
    members: people.map((m) => (m.userId === 'd' ? { ...m, leftAt: '2026-01-15' } : m)),
    expenses: [],
    categories: [],
    settlements: [],
    activityLogs: [],
    recurringExpenses: [rec],
  };
  const repo = { saveExpense: vi.fn(), setRecurringActive: vi.fn() };
  expect(await processDueRecurringExpenses({ repo, actorId: currentOwner, data })).toBe(0);
  await expect(
    processDueRecurringExpenses({
      repo,
      actorId: currentOwner,
      data,
      onlyRecurringId: rec.id,
      forceSingleOccurrence: true,
    })
  ).rejects.toThrow(/Aggiorna pagante e quote/);
  expect(repo.saveExpense).not.toHaveBeenCalled();
});

it('un modulo già aperto non perde la bozza e non ricalcola di nascosto le quote quando Sara viene rimossa', () => {
  const { update } = setup(true);
  click('Aggiungi spesa');
  fireEvent.change(dialog().getByLabelText('Descrizione'), { target: { value: 'Biglietti' } });
  fireEvent.change(dialog().getByLabelText('Importo della spesa'), { target: { value: '60' } });
  update({
    members: people.map((m) =>
      m.userId === 'd' ? { ...m, leftAt: '2026-11-18', removedAt: '2026-11-18' } : m
    ),
  });
  expect(
    (dialog().getByRole('button', { name: 'Aggiungi spesa' }) as HTMLButtonElement).disabled
  ).toBe(true);
  click('Aggiorna selezione');
  expect((dialog().getByLabelText('Descrizione') as HTMLInputElement).value).toBe('Biglietti');
  expect(dialog().queryByRole('option', { name: /Sara/ })).toBeNull();
  expect(dialog().getAllByText(/20,00/)).toHaveLength(3);
});
