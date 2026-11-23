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

it('mostra il saldo solo in Spese e Saldi, nasconde la dicitura superflua e limita Aggiungi spesa al tab Spese', () => {
  const { container } = openGroup(data, true, {});
  const balance = () => screen.queryByRole('region', { name: 'Riepilogo del tuo saldo' });
  const addButtons = () => container.querySelectorAll('.mobile-fab,.desktop-add-expense');

  expect(balance()).toBeTruthy();
  expect(screen.queryByText('Saldo semplificato aggiornato')).toBeNull();
  expect(addButtons()).toHaveLength(2);

  click('Insights');
  expect(balance()).toBeNull();
  expect(addButtons()).toHaveLength(0);
  expect(screen.getByText('Totale speso')).toBeTruthy();
  expect(screen.queryByText(/Numero di spese|Spesa media|\/giorno/i)).toBeNull();

  click(/^Ricorrenti/);
  expect(balance()).toBeNull();
  expect(addButtons()).toHaveLength(0);

  click('Storico');
  expect(balance()).toBeNull();
  expect(addButtons()).toHaveLength(0);

  click('Saldi');
  expect(balance()).toBeTruthy();
  expect(screen.queryByText('Saldo semplificato aggiornato')).toBeNull();
  expect(screen.queryByText('Valuta di visualizzazione dei saldi')).toBeNull();
  expect(addButtons()).toHaveLength(0);
});

it('sostituisce la card valuta di Saldi con il badge interattivo e popover ricco nel titolo gruppo', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ date: '2026-11-20', rates: { USD: 1.08 } }),
    }))
  );
  localStorage.clear();
  openGroup(data, true, {});

  click('Saldi');
  expect(screen.queryByText('Valuta di visualizzazione dei saldi')).toBeNull();

  const badgeBtn = screen.getByRole('button', { name: 'Valuta di visualizzazione dei saldi' });
  expect(badgeBtn.textContent).toContain('EUR');

  fireEvent.click(badgeBtn);
  const popover = screen.getByRole('region', { name: 'Visualizza saldi in' });
  expect(popover.textContent).toContain('Contabilità del gruppo in EUR');

  const search = within(popover).getByLabelText('Cerca valuta');
  fireEvent.change(search, { target: { value: 'Dollaro USA' } });
  fireEvent.click(within(popover).getByRole('option', { name: /USD/ }));

  await waitFor(() => {
    expect(screen.getByText(/mostrato in USD/)).toBeTruthy();
  });
  expect(badgeBtn.textContent).toContain('Vista USD · base EUR');
  expect(screen.getAllByText(/19,44/).length).toBeGreaterThan(0);

  // Riaprendo il popover mostra il dettaglio BCE e permette il reset
  fireEvent.click(badgeBtn);
  const openPopover = screen.getByRole('region', { name: 'Visualizza saldi in' });
  expect(openPopover.textContent).toContain('1 EUR = 1,08 USD');
  fireEvent.click(within(openPopover).getByRole('button', { name: 'Torna a EUR' }));

  expect(badgeBtn.textContent).toBe('EUR');
  expect(screen.queryByText(/mostrato in USD/)).toBeNull();
});

it('offre solo i filtri temporali richiesti in Spese e Insights e filtra Questa settimana e Anno scorso', () => {
  const today = todayISO();
  const prevYear = Number(today.slice(0, 4)) - 1;
  const expectedLabels = [
    'Tutto il periodo',
    'Questa settimana',
    'Questo mese',
    'Mese scorso',
    "Quest'anno",
    'Anno scorso',
    'Intervallo personalizzato',
  ];
  const timedData: GroupData = {
    ...data,
    expenses: [
      { ...expense('Spesa corrente', 30, 'a', ['a', 's']), id: 'e-now', expenseDate: today },
      {
        ...expense('Spesa anno scorso', 70, 'a', ['a', 's']),
        id: 'e-prev',
        expenseDate: `${prevYear}-06-15`,
      },
    ],
    settlements: [],
  };
  openGroup(timedData, true, {});

  click('Filtri');
  const expensePeriod = screen.getByLabelText('Periodo') as HTMLSelectElement;
  expect(Array.from(expensePeriod.options).map((o) => o.text)).toEqual(expectedLabels);

  fireEvent.change(expensePeriod, { target: { value: 'this_week' } });
  expect(screen.getByText('Spesa corrente')).toBeTruthy();
  expect(screen.queryByText('Spesa anno scorso')).toBeNull();

  fireEvent.change(expensePeriod, { target: { value: 'last_year' } });
  expect(screen.queryByText('Spesa corrente')).toBeNull();
  expect(screen.getByText('Spesa anno scorso')).toBeTruthy();

  click('Insights');
  const insightsPeriod = screen.getByLabelText(
    'Seleziona periodo degli Insights'
  ) as HTMLSelectElement;
  expect(Array.from(insightsPeriod.options).map((o) => o.text)).toEqual(expectedLabels);

  fireEvent.change(insightsPeriod, { target: { value: 'this_week' } });
  expect(screen.getAllByText(/30,00/).length).toBeGreaterThan(0);

  fireEvent.change(insightsPeriod, { target: { value: 'last_year' } });
  expect(screen.getAllByText(/70,00/).length).toBeGreaterThan(0);
});

it('permette di confrontare due periodi in Insights (automatico e personalizzabile) con variazione € e %', () => {
  const today = todayISO();
  const [yStr, mStr, dStr] = today.split('-');
  const y = Number(yStr);
  const m = Number(mStr);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  const prevMonthFirst = `${prevY}-${String(prevM).padStart(2, '0')}-01`;
  // Data nel mese scorso ma oltre il giorno corrente (se non è il 31), per verificare la parità di giorni trascorsi
  const prevMonthLate = `${prevY}-${String(prevM).padStart(2, '0')}-28`;

  const compareData: GroupData = {
    ...data,
    categories: [
      { name: 'Spesa alimentare', key: 'spesa', color: '#0F766E', icon: 'shopping-basket', hidden: false },
      { name: 'Casa', key: 'casa', color: '#BE185D', icon: 'home', hidden: false },
      { name: 'Viaggi', key: 'viaggi', color: '#2563EB', icon: 'plane', hidden: false },
    ],
    expenses: [
      {
        ...expense('Supermercato oggi', 120, 'a', ['a', 's']),
        id: 'c1',
        expenseDate: today,
        category: 'spesa',
        categoryLabel: 'Spesa alimentare',
      },
      {
        ...expense('Lampada oggi', 40, 'a', ['a', 's']),
        id: 'c2',
        expenseDate: today,
        category: 'casa',
        categoryLabel: 'Casa',
      },
      {
        ...expense('Supermercato mese scorso', 100, 'a', ['a', 's']),
        id: 'p1',
        expenseDate: prevMonthFirst,
        category: 'spesa',
        categoryLabel: 'Spesa alimentare',
      },
      {
        ...expense('Treno mese scorso', 50, 'a', ['a', 's']),
        id: 'p2',
        expenseDate: prevMonthFirst,
        category: 'viaggi',
        categoryLabel: 'Viaggi',
      },
      ...(Number(dStr) < 28
        ? [
            {
              ...expense('Fine mese scorso', 200, 'a', ['a', 's']),
              id: 'p3',
              expenseDate: prevMonthLate,
              category: 'viaggi',
              categoryLabel: 'Viaggi',
            },
          ]
        : []),
    ],
    settlements: [],
  };

  openGroup(compareData, true, {});
  click('Insights');

  fireEvent.change(screen.getByLabelText('Seleziona periodo degli Insights'), {
    target: { value: 'this_month' },
  });
  click('Confronta');

  // Confronto automatico di default: Questo mese (160 €) vs Mese scorso a parità di giorni (150 €)
  expect(screen.getByLabelText('Periodo di confronto')).toBeTruthy();
  expect(screen.getByText(/\+10,00 € \(\+6,7%\)/)).toBeTruthy();
  expect(screen.getByText(/\+20,00 € \(\+20,0%\)/)).toBeTruthy();
  expect(screen.getByText(/\+40,00 € · Nuova/)).toBeTruthy();
  expect(screen.getByText(/−50,00 € \(−100,0%\)/)).toBeTruthy();

  // Disattivando "Stesso punto del periodo" include anche la spesa del 28 del mese scorso (totale B = 350 €)
  if (Number(dStr) < 28) {
    const parityCheckbox = screen.getByRole('checkbox', {
      name: /Stesso punto del periodo/i,
    });
    fireEvent.click(parityCheckbox);
    expect(screen.getByText(/−190,00 € \(−54,3%\)/)).toBeTruthy();
  }

  // Personalizzazione manuale del periodo di confronto
  fireEvent.change(screen.getByLabelText('Periodo di confronto'), {
    target: { value: 'custom' },
  });
  fireEvent.change(screen.getByLabelText('Confronto dal'), {
    target: { value: '2020-01-01' },
  });
  fireEvent.change(screen.getByLabelText('Confronto al'), {
    target: { value: '2020-01-31' },
  });
  expect(screen.getByText(/\+160,00 €/)).toBeTruthy();
});

it('nello Storico unifica nello stesso filtro ospite e account collegato tramite actorLinks', () => {
  const linkedData: GroupData = {
    ...data,
    members: [
      member('seat-gab', 'Gabriele', 'acc-gab'),
      member('seat-anna', 'Anna', 'acc-anna'),
    ],
    actorLinks: {
      'guest-gab': 'acc-gab',
    },
    activityLogs: [
      {
        id: 'log-acc',
        groupId: 'ev',
        actorName: 'Gabriele',
        actorId: 'acc-gab',
        entityType: 'expense',
        entityId: dinner.id,
        action: 'created',
        summary: 'Ha aggiunto Cena dopo registrazione',
        changes: {},
        createdAt: '2026-11-20T18:00:00Z',
      },
      {
        id: 'log-guest',
        groupId: 'ev',
        actorName: 'Gabriele',
        actorId: 'guest-gab',
        entityType: 'group',
        entityId: 'ev',
        action: 'created',
        summary: 'Ha creato il gruppo da ospite',
        changes: {},
        createdAt: '2026-11-18T18:00:00Z',
      },
      {
        id: 'log-anna',
        groupId: 'ev',
        actorName: 'Anna',
        actorId: 'acc-anna',
        entityType: 'expense',
        entityId: dinner.id,
        action: 'updated',
        summary: 'Ha modificato una spesa',
        changes: {},
        createdAt: '2026-11-19T18:00:00Z',
      },
    ],
  };

  openGroup(linkedData, true, {});
  click('Storico');

  const actorSelect = screen.getByLabelText('Filtra storico per membro') as HTMLSelectElement;
  expect(Array.from(actorSelect.options).map((o) => o.text)).toEqual([
    'Tutti i membri',
    'Gabriele',
    'Anna',
  ]);

  fireEvent.change(actorSelect, { target: { value: 'acc-gab' } });
  expect(screen.getByText(/aggiunto Cena dopo registrazione/)).toBeTruthy();
  expect(screen.getByText(/creato il gruppo da ospite/)).toBeTruthy();
  expect(screen.queryByText(/modificato una spesa/)).toBeNull();
});

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
