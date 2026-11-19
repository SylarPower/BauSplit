// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupView } from '../src/components/GroupView';
import { GroupsHomeView } from '../src/components/GroupsHomeView';
import { processDueRecurringExpenses, type DataRepository } from '../src/lib/repository';
import { todayISO } from '../src/lib/dates';
import type { GroupData, GroupInvite, GroupRole } from '../src/types';
import { expense, group, member } from './fixtures/groupViews';

vi.mock('../src/lib/supabase', () => ({
  buildInviteUrl: (token: string) => `https://esempio.test/?invito=${token}`,
  translateErrorIT: (e: Error) => e.message,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const people = [
  member('a', 'Anna', 'account-anna'),
  { ...member('s', 'Sara', 'ospite-sara'), accessRole: 'viewer' as const },
];
const dinner = expense('Cena in due', 40, 'a', ['a', 's']);
const data: GroupData = {
  group: { ...group('ev', 'Casa'), creatorOwnerId: 'account-anna', everShared: true },
  members: people,
  expenses: [dinner],
  settlements: [
    {
      ...dinner,
      id: 'r',
      amount: 2,
      baseAmount: 2,
      kind: 'settlement',
      settlementDate: '2026-11-18',
      fromUser: 's',
      toUser: 'a',
      linkedGroupName: null,
    },
  ],
  recurringExpenses: [
    {
      ...dinner,
      id: 'rec',
      description: 'Affitto',
      fixedExchangeRate: null,
      frequency: 'monthly',
      startDate: todayISO(),
      nextDueDate: todayISO(),
      endDate: null,
      active: true,
    },
  ],
  categories: [{ name: 'Altro', key: 'altro', color: '#78716C', icon: 'tag', hidden: false }],
  activityLogs: [
    {
      id: 'l',
      groupId: 'ev',
      actorName: 'Anna',
      actorId: 'account-anna',
      entityType: 'expense',
      entityId: dinner.id,
      action: 'created',
      summary: 'Ha registrato la cena',
      changes: {},
      createdAt: '2026-11-18T18:00:00Z',
    },
  ],
};
const overview = {
  group: data.group,
  members: people,
  totalSpentBase: 40,
  myNetBalance: -18,
  expenseCount: 1,
  counterpartHint: 'Devi 18 € ad Anna',
};
const click = (name: string | RegExp) =>
  fireEvent.click(screen.getAllByRole('button', { name })[0]);
const noAction = (name: RegExp) =>
  expect(screen.queryAllByRole('button', { name })).toHaveLength(0);
function openGroup(d = data, editor = false, repo: Partial<DataRepository> = {}) {
  const props = {
    repo: repo as DataRepository,
    data: d,
    allGroups: [overview],
    actorId: editor ? 'account-anna' : 'ospite-sara',
    currentUserId: editor ? 'a' : 's',
    onBack: vi.fn(),
    onNavigateGroup: vi.fn(),
    onRefreshGroup: vi.fn(),
    onGroupLeft: vi.fn(),
    onToast: vi.fn(),
  };
  return { ...render(<GroupView {...props} />), props };
}

it('il lettore vede quote, saldo, dettagli, filtri e storico; nessun comando di scrittura desktop o mobile', () => {
  const getGroupInvites = vi.fn();
  const { container } = openGroup(data, false, { getGroupInvites });
  expect(screen.getByText('Solo visualizzazione')).toBeTruthy();
  expect(screen.getByRole('region', { name: 'Riepilogo del tuo saldo' }).textContent).toMatch(
    /Devi 18,00.*Anna/
  );
  expect(container.querySelector('.mobile-fab,.desktop-add-expense')).toBeNull();
  noAction(/Invita|Aggiungi|Segna rimborso|Impostazioni|Riapri/i);
  expect(screen.getByRole('searchbox')).toBeTruthy();
  click(/Cena in due/);
  const detail = within(screen.getByRole('dialog', { name: 'Dettaglio spesa' }));
  expect(detail.getByText('Sara')).toBeTruthy();
  expect(detail.getAllByText(/20,00/).length).toBeGreaterThan(0);
  noAction(/Elimina|Modifica/);
  click('Chiudi finestra');
  click(/Rimborso/);
  expect(screen.getByRole('dialog', { name: 'Dettaglio rimborso' })).toBeTruthy();
  noAction(/Elimina|Modifica/);
  click('Chiudi finestra');
  click('Saldi');
  noAction(/Segna rimborso|Registra|Modifica rimborso|Chiudi e sposta|Nuovo rimborso/i);
  click(/^Ricorrenti/);
  expect(screen.getByText('Affitto')).toBeTruthy();
  noAction(/ricorrente|ricorrenza|Registra|Modifica|pausa|Elimina/i);
  click('Storico');
  expect(screen.getByText(/registrato la cena/)).toBeTruthy();
  click('Dettagli del gruppo');
  expect(screen.getByRole('button', { name: 'Esci dal gruppo' })).toBeTruthy();
  noAction(/Archivia|Elimina|Rimuovi|Riapri|Chiudi gruppo|Salva|Aggiungi|Categorie/);
  expect(getGroupInvites).not.toHaveBeenCalled();
});

it.each([false, true])('serata in visualizzazione, anche in archivio (chiusa=%s)', (closed) => {
  openGroup({
    ...data,
    group: { ...data.group, quickCreatorSeat: 'a', closedAt: closed ? '2026-11-18' : null },
  });
  expect(screen.getByRole('button', { name: 'Copia riepilogo' })).toBeTruthy();
  noAction(/Invita|Aggiungi|Concludi|Riapri|Segna rimborso|Ricorrenti/);
  click('Dettagli del gruppo');
  noAction(/Riapri|Archivia|Concludi|Elimina/);
});

it('un lettore o un ex membro non genera né fa avanzare ricorrenze, nemmeno forzandole; un editor sì', async () => {
  const repo = { saveExpense: vi.fn(), setRecurringActive: vi.fn() };
  for (const actorId of ['ospite-sara', 'ex', 's']) {
    for (const forceSingleOccurrence of [false, true]) {
      expect(
        await processDueRecurringExpenses({ repo, data, actorId, forceSingleOccurrence })
      ).toBe(0);
    }
  }
  expect(repo.saveExpense).not.toHaveBeenCalled();
  expect(repo.setRecurringActive).not.toHaveBeenCalled();
  expect(await processDueRecurringExpenses({ repo, data, actorId: 'account-anna' })).toBe(1);
  expect(
    repo.saveExpense.mock.calls[0][0].input.splits.map((s: { userId: string }) => s.userId)
  ).toEqual(['a', 's']);
});

it('l’editor può includere Sara e copiare, condividere, disattivare o rigenerare solo il link scelto', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined),
    share = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText }, share });
  const links: GroupInvite[] = [
    { role: 'editor', token: 'scrittura', enabled: true },
    { role: 'viewer', token: 'lettura', enabled: true },
  ];
  const getGroupInvites = vi.fn(async () => links.map((l) => ({ ...l })));
  const regenerateInvite = vi.fn(async (_: string, role: GroupRole) => {
    const link = links.find((l) => l.role === role)!;
    link.enabled = true;
    return (link.token += '-nuovo');
  });
  const setInviteEnabled = vi.fn(
    async (_: string, enabled: boolean, role: GroupRole) =>
      (links.find((l) => l.role === role)!.enabled = enabled)
  );
  openGroup(data, true, { getGroupInvites, regenerateInvite, setInviteEnabled });
  click('Aggiungi spesa');
  expect(within(screen.getByRole('dialog')).getByRole('option', { name: 'Sara' })).toBeTruthy();
  click('Chiudi finestra');
  expect(getGroupInvites).not.toHaveBeenCalled();
  click('Invita');
  const section = () => within(screen.getByRole('region', { name: 'Solo visualizzazione' }));
  await screen.findByRole('textbox', { name: 'Link: Solo visualizzazione' });
  const copyViewer = section().getByRole('button', { name: 'Copia link: Solo visualizzazione' });
  fireEvent.click(copyViewer);
  expect(writeText).toHaveBeenCalledWith('https://esempio.test/?invito=lettura');
  fireEvent.click(section().getByRole('button', { name: 'Condividi link: Solo visualizzazione' }));
  expect(share).toHaveBeenCalledWith(
    expect.objectContaining({ url: 'https://esempio.test/?invito=lettura' })
  );
  fireEvent.click(section().getByText('Gestisci questo link'));
  fireEvent.click(section().getByRole('button', { name: 'Disattiva link' }));
  await screen.findByText('Link disattivato');
  expect(setInviteEnabled).toHaveBeenCalledWith('ev', false, 'viewer');
  expect(section().queryByRole('button', { name: 'Copia link: Solo visualizzazione' })).toBeNull();
  fireEvent.click(section().getByText('Gestisci questo link'));
  fireEvent.click(section().getByRole('button', { name: 'Rigenera link' }));
  expect(regenerateInvite).not.toHaveBeenCalled();
  fireEvent.click(section().getByRole('button', { name: 'Conferma rigenerazione' }));
  expect(
    await screen.findByDisplayValue('https://esempio.test/?invito=lettura-nuovo')
  ).toBeTruthy();
  expect(screen.getByDisplayValue('https://esempio.test/?invito=scrittura')).toBeTruthy();
  expect(regenerateInvite).toHaveBeenCalledWith('ev', 'viewer');
});

it('prima dell’aggiornamento SQL non presenta mai il vecchio URL come link in lettura', async () => {
  openGroup(data, true, {
    getGroupInvites: async () => [{ role: 'editor', token: 'vecchio', enabled: true }],
  });
  click('Invita');
  expect(await screen.findByText(/deve aggiornare Supabase/)).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Link: Solo visualizzazione' })).toBeNull();
  expect(screen.getByDisplayValue('https://esempio.test/?invito=vecchio')).toBeTruthy();
});

it.each([
  ['viewer', 'Solo visualizzazione', 'Accetta in sola visualizzazione'],
  ['editor', 'Invito con modifica', 'Accetta ed entra nel gruppo'],
] as const)('l’invito %s mostra prima il permesso e non invia il ruolo dal client', async (role, label, action) => {
  const onAcceptInvite = vi.fn().mockResolvedValue(undefined);
  render(
    <GroupsHomeView
      groups={[]}
      ownerId="ospite-sara"
      isGuest
      defaultName="Ospite"
      loading={false}
      bookmarks={[]}
      loadError={null}
      schemaMissing={false}
      pendingInvite={{
        loading: false,
        token: 'lettura',
        preview: {
          valid: true,
          groupId: 'ev',
          groupName: 'Casa',
          inviteRole: role,
          accessRole: role,
          memberCount: 2,
          availableNames: [{ id: 's', name: 'Sara' }],
        },
      }}
      onCreateQuickEvent={vi.fn()}
      onAccount={vi.fn()}
      onCreateGroup={vi.fn()}
      onRetryLoad={vi.fn()}
      onSelectGroup={vi.fn()}
      onInspectInviteToken={vi.fn()}
      onAcceptInvite={onAcceptInvite}
      onDeclineInvite={vi.fn()}
      onToast={vi.fn()}
    />
  );
  const card = within(screen.getByRole('region', { name: 'Invito a un gruppo' }));
  expect(card.getByText('Il branco ti aspetta')).toBeTruthy();
  expect(card.getByText(label)).toBeTruthy();
  if (role === 'viewer') expect(card.getByText(/il tuo saldo/)).toBeTruthy();
  expect(onAcceptInvite).not.toHaveBeenCalled();
  fireEvent.change(card.getByRole('combobox'), { target: { value: 's' } });
  fireEvent.click(card.getByRole('button', { name: action }));
  await waitFor(() => expect(onAcceptInvite).toHaveBeenCalledWith('lettura', { memberId: 's' }));
});

it('se il permesso cambia mentre un modulo è aperto, la bozza non offre più Salva o Invita', () => {
  const { props, rerender } = openGroup(data, true);
  click('Aggiungi spesa');
  expect(screen.getByRole('dialog')).toBeTruthy();
  rerender(
    <GroupView
      {...props}
      data={{ ...data, members: people.map((m) => ({ ...m, accessRole: 'viewer' })) }}
    />
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  noAction(/Invita|Aggiungi|Salva spesa|Segna rimborso/i);
});
