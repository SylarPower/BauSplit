// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupView } from '../src/components/GroupView';
import { GroupsHomeView } from '../src/components/GroupsHomeView';
import { quickContacts, simplifyEventDebts } from '../src/lib/quickEvent';
import { convertTransferAmount } from '../src/lib/accounting';
import type { DataRepository } from '../src/lib/repository';
import type {
  Expense,
  ExpenseGroup,
  GroupData,
  GroupMember,
  GroupOverview,
  Settlement,
} from '../src/types';

vi.mock('../src/lib/supabase', () => ({
  buildInviteUrl: () => 'https://example.test/?invito=segreto',
  isMissingSchemaError: () => false,
  translateErrorIT: String,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const member = (userId: string, displayName: string, ownerId: string | null): GroupMember => ({
  userId,
  displayName,
  ownerId,
  joinedAt: '2026-01-01',
  leftAt: null,
});
const group = (id: string, name: string, quickCreatorSeat: string | null = null): ExpenseGroup => ({
  id,
  name,
  quickCreatorSeat,
  description: '',
  baseCurrency: 'EUR',
  createdBy: 'a',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  inviteToken: 'segreto',
  inviteEnabled: true,
  closedAt: null,
  closedBy: null,
  closedIntoGroupId: null,
  closedIntoGroupName: null,
});
const casa = group('casa', 'Casa');
const overview = (g: ExpenseGroup, members: GroupMember[]): GroupOverview => ({
  group: g,
  members,
  expenseCount: 0,
  totalSpentBase: 0,
  myNetBalance: 0,
  counterpartHint: '',
});
const home = overview(casa, [member('a2', 'Anna', 'a'), member('b2', 'Giulia', 'b')]);
const known = [
  home,
  overview(group('uff', 'Ufficio'), [
    member('a3', 'Altra firma', 'a'),
    member('b3', 'Giulia B.', 'b'),
    member('c3', 'Giulia', 'c'),
  ]),
];
const ev = group('ev', 'Cena di sabato', 'a1');
const seats = [
  member('a1', 'Anna', 'a'),
  member('b1', 'Giulia', null),
  member('c1', 'Luca', null),
  member('d1', 'Sara', null),
];
const expense = (description: string, amount: number, paidBy: string, ids: string[]): Expense => ({
  id: description,
  groupId: 'ev',
  description,
  amount,
  baseAmount: amount,
  currency: 'EUR',
  exchangeRate: 1,
  rateDate: '2026-11-18',
  rateIsManual: false,
  expenseDate: '2026-11-18',
  category: 'altro',
  categoryLabel: 'Altro',
  paidBy,
  splitMode: 'equal',
  splits: ids.map((userId) => ({
    userId,
    amount: amount / ids.length,
    baseAmount: amount / ids.length,
    percentage: null,
  })),
  note: 'nota privata',
  recurringId: null,
  recurringOccurrenceDate: null,
  createdBy: 'a',
  updatedBy: 'a',
  createdAt: '2026-11-18',
  updatedAt: '2026-11-18',
});
const data: GroupData = {
  group: ev,
  members: seats,
  categories: [{ name: 'Altro', key: 'altro', color: '#112233', icon: 'tag', hidden: false }],
  expenses: [
    expense('Cena', 80, 'a1', ['a1', 'b1', 'c1', 'd1']),
    expense('Taxi', 30, 'c1', ['a1', 'c1', 'd1']),
  ],
  settlements: [],
  recurringExpenses: [],
  activityLogs: [],
  quickMatches: [{ peerId: 'b1', groupId: 'casa', seatId: 'b2', canCarry: true }],
};
const refund: Settlement = {
  ...expense('Rimborso', 30, 'd1', ['a1']),
  fromUser: 'd1',
  toUser: 'a1',
  settlementDate: '2026-11-18',
  kind: 'settlement',
  linkedGroupName: null,
};
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });
function renderHome() {
  const create = vi.fn().mockResolvedValue(undefined),
    regular = vi.fn();
  render(
    <GroupsHomeView
      groups={known}
      ownerId="a"
      defaultName="Anna"
      bookmarks={[]}
      schemaMissing={false}
      isGuest
      loading={false}
      loadError={null}
      pendingInvite={null}
      onCreateQuickEvent={create}
      onCreateGroup={regular}
      onSelectGroup={vi.fn()}
      onAccount={vi.fn()}
      onRetryLoad={vi.fn()}
      onInspectInviteToken={vi.fn()}
      onAcceptInvite={vi.fn()}
      onDeclineInvite={vi.fn()}
      onToast={vi.fn()}
    />
  );
  return { create, regular };
}
function renderEvent(eventData: GroupData) {
  const repo = {
    closeGroup: vi.fn().mockResolvedValue({ transferredCount: 1 }),
    addQuickPeople: vi.fn().mockResolvedValue(undefined),
  };
  const props = {
    repo: repo as unknown as DataRepository,
    actorId: 'a',
    currentUserId: 'a1',
    allGroups: [home],
    onBack: vi.fn(),
    onRefreshGroup: vi.fn().mockResolvedValue(undefined),
    onGroupLeft: vi.fn(),
    onNavigateGroup: vi.fn(),
    onToast: vi.fn(),
  };
  const view = render(<GroupView data={eventData} {...props} />);
  return { repo, update: (d: GroupData) => view.rerender(<GroupView data={d} {...props} />) };
}

it('solo dalla home: nessun contatto preselezionato, selezione per identità e nomi manuali indipendenti', async () => {
  const { create, regular } = renderHome();
  click('Conto al volo');
  change('Nome della serata', 'Cena di sabato');
  expect(screen.getByText('Anna (tu)')).toBeTruthy();
  expect(screen.queryByRole('checkbox', { checked: true })).toBeNull();
  expect(screen.getAllByRole('checkbox')).toHaveLength(2); // due Giulie diverse; la stessa persona non appare due volte
  fireEvent.click(screen.getByRole('checkbox', { name: 'Giulia Casa · Ufficio' }));
  change('Altri partecipanti', 'Luca\nSara');
  click('Crea serata');
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      name: 'Cena di sabato',
      baseCurrency: 'EUR',
      people: [
        { name: 'Giulia', source: { groupId: 'casa', seatId: 'b2' } },
        { name: 'Luca' },
        { name: 'Sara' },
      ],
    })
  );
  expect(regular).not.toHaveBeenCalled();
});

it('si può iniziare da soli; annullare non conserva un gruppo o dei contatti preselezionati', async () => {
  const { create } = renderHome();
  click('Conto al volo');
  fireEvent.click(screen.getByRole('checkbox', { name: 'Giulia Casa · Ufficio' }));
  click('Annulla');
  click('Conto al volo');
  change('Nome della serata', 'Cinema');
  click('Crea serata');
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({ name: 'Cinema', baseCurrency: 'EUR', people: [] })
  );
});

it('aggiunge partecipanti dopo la creazione, senza offrire la creazione di altre serate nel gruppo', async () => {
  const { repo } = renderEvent({ ...data, expenses: [], members: [seats[0]], quickMatches: [] });
  expect(screen.queryByRole('button', { name: 'Conto al volo' })).toBeNull();
  click('Aggiungi persone');
  const form = within(screen.getByRole('dialog'));
  fireEvent.click(form.getByRole('checkbox', { name: 'Giulia Casa' }));
  change('Altri partecipanti', 'Luca');
  fireEvent.click(form.getByRole('button', { name: 'Aggiungi persone' }));
  await waitFor(() =>
    expect(repo.addQuickPeople).toHaveBeenCalledWith('ev', [
      { name: 'Giulia', source: { groupId: 'casa', seatId: 'b2' } },
      { name: 'Luca' },
    ])
  );
});

it('copia i rimborsi attuali della serata, non i dettagli privati; se la copia è negata lascia il testo selezionabile', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const { update } = renderEvent(data);
  click('Copia riepilogo');
  const text = writeText.mock.calls[0][0] as string;
  expect(text).toMatch(/Cena di sabato[\s\S]*110,00/);
  expect(text).toMatch(/Sara → Anna: 30,00/);
  expect(text).toMatch(/Giulia → Anna: 20,00/);
  expect(text).not.toMatch(/Luca →|segreto|privata|invito|Casa/);
  update({ ...data, settlements: [refund] });
  writeText.mockRejectedValueOnce(Error('non consentito'));
  click('Copia riepilogo');
  const manual = await screen.findByRole('textbox', {
    name: 'Seleziona e copia il testo per la chat',
  });
  expect((manual as HTMLTextAreaElement).value).toMatch(/Giulia → Anna: 20,00/);
  expect((manual as HTMLTextAreaElement).value).not.toContain('Sara →');
  update({ ...data, expenses: [], settlements: [] });
  expect((manual as HTMLTextAreaElement).value).toContain('Tutti in pari');
});

it('il passaggio alla coppia richiede amici in pari, destinazione ammessa e conferma esplicita', async () => {
  const { repo, update } = renderEvent(data);
  click('Concludi serata');
  let dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByRole('button', { name: 'Riporta nel gruppo di coppia' })).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Chiudi finestra' }));
  update({ ...data, settlements: [refund] });
  click('Concludi serata');
  dialog = within(screen.getByRole('dialog'));
  expect(dialog.queryByLabelText('Gruppo di destinazione')).toBeNull();
  fireEvent.click(dialog.getByRole('button', { name: 'Riporta nel gruppo di coppia' }));
  expect(
    (dialog.getByRole('combobox', { name: /Gruppo di destinazione/ }) as HTMLSelectElement).value
  ).toBe('casa');
  expect(repo.closeGroup).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole('button', { name: 'Sposta saldo in "Casa" e chiudi' }));
  await waitFor(() =>
    expect(repo.closeGroup).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceGroup: ev,
        targetGroup: casa,
        transfers: [
          { fromUser: 'b1', fromName: 'Giulia', toUser: 'a1', toName: 'Anna', amount: 20 },
        ],
      })
    )
  );
});

it('non suggerisce gruppi altrui o posti usciti e non unisce omonimi liberi; il riporto rispetta i decimali del cambio salvato', () => {
  expect(
    quickContacts(
      [
        home,
        overview(group('altro', 'Altro'), [member('p', 'Estraneo', 'q')]),
        overview(group('vac', 'Viaggio'), [
          home.members[0],
          { ...member('sx', 'Uscito', 'x'), leftAt: '2026-01-05' },
          member('solo', 'Giulia', null),
        ]),
      ],
      'a'
    ).map((c) => c.key)
  ).toEqual(['b', 'vac:solo']);
  expect(convertTransferAmount(1, 'EUR', 1.005, 'USD')).toBe(1.01);
  expect(convertTransferAmount(1, 'EUR', 160.5, 'JPY')).toBe(161);
});

it('trova quattro rimborsi invece di cinque mantenendo ogni saldo al centesimo', () => {
  const amounts = [0.05, 0.06, -0.01, -0.03, -0.03, -0.04];
  const balances = amounts.map((netBalance, i) => ({
    userId: String(i),
    displayName: String(i),
    isActive: true,
    totalPaid: 0,
    totalShare: 0,
    settlementsReceived: 0,
    settlementsSent: 0,
    transfersNet: 0,
    netBalance,
  }));
  const plan = simplifyEventDebts(balances, 'EUR');
  expect(plan).toHaveLength(4);
  const remaining = amounts.map((n) => Math.round(n * 100));
  for (const { fromUser, toUser, amount } of plan) {
    remaining[Number(fromUser)] += Math.round(amount * 100);
    remaining[Number(toUser)] -= Math.round(amount * 100);
  }
  expect(remaining).toEqual([0, 0, 0, 0, 0, 0]);
});

it('con più gruppi di coppia la scelta è esplicita, anche se l’importo è già noto', () => {
  const second = overview(group('viaggi', 'Viaggi'), [
    member('a3', 'Anna', 'a'),
    member('b3', 'Giulia', 'b'),
  ]);
  const selected = {
    ...data,
    settlements: [refund],
    quickMatches: [
      ...data.quickMatches!,
      { peerId: 'b1', groupId: 'viaggi', seatId: 'b3', canCarry: true },
    ],
  };
  const closeGroup = vi.fn();
  render(
    <GroupView
      data={selected}
      repo={{ closeGroup } as unknown as DataRepository}
      actorId="a"
      currentUserId="a1"
      allGroups={[home, second]}
      onBack={vi.fn()}
      onRefreshGroup={vi.fn()}
      onGroupLeft={vi.fn()}
      onNavigateGroup={vi.fn()}
      onToast={vi.fn()}
    />
  );
  click('Concludi serata');
  click('Riporta nel gruppo di coppia');
  const dest = screen.getByRole('combobox', {
    name: /Gruppo di destinazione/,
  }) as HTMLSelectElement;
  expect(dest.value).toBe('');
  expect(closeGroup).not.toHaveBeenCalled();
  fireEvent.change(dest, { target: { value: 'viaggi' } });
  expect(screen.getByText('Conferma il riporto in Viaggi')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Sposta saldo in "Viaggi" e chiudi' })).toBeTruthy();
  expect(closeGroup).not.toHaveBeenCalled();
});
