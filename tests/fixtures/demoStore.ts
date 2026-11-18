import type {
  ActivityAction,
  ActivityChanges,
  ActivityEntityType,
  ActivityLog,
  CustomCategory,
  Expense,
  ExpenseGroup,
  ExpenseInput,
  GroupData,
  GroupMember,
  GroupOverview,
  InvitePreview,
  RecurringExpense,
  RecurringExpenseInput,
  Settlement,
  SettlementInput,
  SimplifiedTransfer,
  UserProfile,
} from '../../src/types';
import { computeMemberBalances, convertToBaseAmount } from '../../src/lib/accounting';
import {
  buildExpenseCreatedLog,
  buildExpenseDeletedLog,
  buildExpenseUpdatedLog,
  buildSettlementCreatedLog,
  buildSettlementDeletedLog,
  buildSettlementUpdatedLog,
  SPLIT_MODE_LABELS,
} from '../../src/lib/audit';
import { formatMoney } from '../../src/lib/currencies';
import { addDaysISO, addMonthsClampedISO, formatFullDateIT, todayISO } from '../../src/lib/dates';
import { FREQUENCY_LABELS } from '../../src/lib/recurring';
import { buildCounterpartHint } from '../../src/lib/repository';

interface DemoDatabase {
  users: UserProfile[];
  groups: ExpenseGroup[];
  members: Record<string, GroupMember[]>;
  customCategories: CustomCategory[];
  expenses: Expense[];
  settlements: Settlement[];
  recurringExpenses: RecurringExpense[];
  activityLogs: ActivityLog[];
}

export const DEMO_USERS: UserProfile[] = [
  {
    id: 'demo-marco',
    email: 'marco@esempio.it',
    displayName: 'Marco',
    createdAt: '2026-09-01T09:00:00Z',
  },
  {
    id: 'demo-giulia',
    email: 'giulia@esempio.it',
    displayName: 'Giulia',
    createdAt: '2026-09-01T09:10:00Z',
  },
  {
    id: 'demo-luca',
    email: 'luca@esempio.it',
    displayName: 'Luca',
    createdAt: '2026-10-05T14:00:00Z',
  },
];

export const DEMO_SAMPLE_INVITE_TOKEN = 'demo-invito-vacanza-giappone-2027';

const DEMO_STORAGE_KEY = 'bausplit_demo_state_v1';

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeToken(): string {
  return (
    Math.random().toString(36).slice(2, 14) +
    Math.random().toString(36).slice(2, 14) +
    Date.now().toString(36)
  );
}

function buildInitialDemoDatabase(): DemoDatabase {
  const today = todayISO();
  const d1 = addDaysISO(today, -1);
  const d3 = addDaysISO(today, -3);
  const d6 = addDaysISO(today, -6);
  const d11 = addDaysISO(today, -11);
  const d17 = addDaysISO(today, -17);
  const d34 = addDaysISO(today, -34);
  const d40 = addDaysISO(today, -40);
  const firstOfThisMonth = `${today.slice(0, 7)}-01`;
  const nextMonthFirst = addMonthsClampedISO(firstOfThisMonth, 1, 1);

  const gCasa = 'demo-group-casa';
  const gCinqueTerre = 'demo-group-cinqueterre';
  const gLondra = 'demo-group-londra';
  const gGiappone = 'demo-group-giappone';

  const catPetId = 'demo-cat-milo';

  return {
    users: DEMO_USERS.map((u) => ({ ...u })),
    groups: [
      {
        id: gCasa,
        name: 'Casa e vita insieme',
        description: 'Spese quotidiane, bollette e uscite di coppia',
        baseCurrency: 'EUR',
        inviteToken: 'demo-invito-casa-insieme-2026',
        inviteEnabled: true,
        closedAt: null,
        closedBy: null,
        closedIntoGroupId: null,
        closedIntoGroupName: null,
        createdBy: 'demo-marco',
        createdAt: '2026-09-01T09:15:00Z',
        updatedAt: `${d1}T20:15:00Z`,
      },
      {
        id: gCinqueTerre,
        name: 'Fuga alle Cinque Terre',
        description: 'Due giorni al mare — puoi provare a chiuderlo spostando il saldo in Casa',
        baseCurrency: 'EUR',
        inviteToken: 'demo-invito-cinque-terre-2026',
        inviteEnabled: true,
        closedAt: null,
        closedBy: null,
        closedIntoGroupId: null,
        closedIntoGroupName: null,
        createdBy: 'demo-giulia',
        createdAt: '2026-10-24T10:00:00Z',
        updatedAt: `${d11}T18:00:00Z`,
      },
      {
        id: gLondra,
        name: 'Weekend a Londra',
        description: 'Viaggio di 4 giorni tra Londra e Notting Hill (EUR e GBP)',
        baseCurrency: 'EUR',
        inviteToken: 'demo-invito-weekend-londra-2026',
        inviteEnabled: true,
        closedAt: null,
        closedBy: null,
        closedIntoGroupId: null,
        closedIntoGroupName: null,
        createdBy: 'demo-giulia',
        createdAt: '2026-10-10T18:00:00Z',
        updatedAt: `${d6}T19:30:00Z`,
      },
      {
        id: gGiappone,
        name: 'Capodanno a Tokyo',
        description: 'Gruppo con amici per organizzare voli e ryokan',
        baseCurrency: 'EUR',
        inviteToken: DEMO_SAMPLE_INVITE_TOKEN,
        inviteEnabled: true,
        closedAt: null,
        closedBy: null,
        closedIntoGroupId: null,
        closedIntoGroupName: null,
        createdBy: 'demo-giulia',
        createdAt: '2026-11-10T12:00:00Z',
        updatedAt: '2026-11-10T12:00:00Z',
      },
    ],
    members: {
      [gCasa]: [
        {
          userId: 'demo-marco',
          ownerId: 'demo-marco',
          displayName: 'Marco',
          joinedAt: '2026-09-01T09:15:00Z',
          leftAt: null,
        },
        {
          userId: 'demo-giulia',
          ownerId: 'demo-giulia',
          displayName: 'Giulia',
          joinedAt: '2026-09-01T09:22:00Z',
          leftAt: null,
        },
      ],
      [gCinqueTerre]: [
        {
          userId: 'demo-marco',
          ownerId: 'demo-marco',
          displayName: 'Marco',
          joinedAt: '2026-10-24T10:05:00Z',
          leftAt: null,
        },
        {
          userId: 'demo-giulia',
          ownerId: 'demo-giulia',
          displayName: 'Giulia',
          joinedAt: '2026-10-24T10:00:00Z',
          leftAt: null,
        },
      ],
      [gLondra]: [
        {
          userId: 'demo-marco',
          ownerId: 'demo-marco',
          displayName: 'Marco',
          joinedAt: '2026-10-10T18:12:00Z',
          leftAt: null,
        },
        {
          userId: 'demo-giulia',
          ownerId: 'demo-giulia',
          displayName: 'Giulia',
          joinedAt: '2026-10-10T18:00:00Z',
          leftAt: null,
        },
        {
          userId: 'demo-luca',
          ownerId: 'demo-luca',
          displayName: 'Luca',
          joinedAt: '2026-10-11T10:05:00Z',
          leftAt: null,
        },
      ],
      [gGiappone]: [
        {
          userId: 'demo-giulia',
          ownerId: 'demo-giulia',
          displayName: 'Giulia',
          joinedAt: '2026-11-10T12:00:00Z',
          leftAt: null,
        },
        {
          userId: 'demo-luca',
          ownerId: 'demo-luca',
          displayName: 'Luca',
          joinedAt: '2026-11-10T12:30:00Z',
          leftAt: null,
        },
      ],
    },
    customCategories: [
      {
        id: catPetId,
        groupId: gCasa,
        name: 'Gatto Milo',
        icon: 'paw-print',
        color: '#0369A1',
        createdBy: 'demo-giulia',
        createdAt: '2026-09-05T11:00:00Z',
      },
    ],
    expenses: [
      {
        id: 'demo-exp-1',
        groupId: gCasa,
        description: 'Spesa settimanale Esselunga',
        amount: 86.4,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d1,
        rateIsManual: false,
        baseAmount: 86.4,
        expenseDate: d1,
        category: 'spesa',
        categoryLabel: 'Spesa alimentare',
        paidBy: 'demo-marco',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 43.2, baseAmount: 43.2, percentage: null },
          { userId: 'demo-giulia', amount: 43.2, baseAmount: 43.2, percentage: null },
        ],
        note: 'Inclusi detersivi e caffè',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-marco',
        updatedBy: 'demo-marco',
        createdAt: `${d1}T19:20:00Z`,
        updatedAt: `${d1}T19:20:00Z`,
      },
      {
        id: 'demo-exp-2',
        groupId: gCasa,
        description: 'Cena Osteria del Porto',
        amount: 74,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d3,
        rateIsManual: false,
        baseAmount: 74,
        expenseDate: d3,
        category: 'ristoranti',
        categoryLabel: 'Ristoranti e bar',
        paidBy: 'demo-giulia',
        splitMode: 'exact',
        splits: [
          { userId: 'demo-marco', amount: 39, baseAmount: 39, percentage: null },
          { userId: 'demo-giulia', amount: 35, baseAmount: 35, percentage: null },
        ],
        note: 'Due primi, calice di vino e dolce',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-giulia',
        updatedBy: 'demo-marco',
        createdAt: `${d3}T22:40:00Z`,
        updatedAt: `${d3}T23:05:00Z`,
      },
      {
        id: 'demo-exp-3',
        groupId: gCasa,
        description: 'Croccantini e veterinario Milo',
        amount: 58,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d11,
        rateIsManual: false,
        baseAmount: 58,
        expenseDate: d11,
        category: `custom:${catPetId}`,
        categoryLabel: 'Gatto Milo',
        paidBy: 'demo-giulia',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 29, baseAmount: 29, percentage: null },
          { userId: 'demo-giulia', amount: 29, baseAmount: 29, percentage: null },
        ],
        note: 'Controllo annuale',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-giulia',
        updatedBy: 'demo-giulia',
        createdAt: `${d11}T17:10:00Z`,
        updatedAt: `${d11}T17:10:00Z`,
      },
      {
        id: 'demo-exp-4',
        groupId: gCasa,
        description: 'Affitto appartamento',
        amount: 780,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: firstOfThisMonth,
        rateIsManual: false,
        baseAmount: 780,
        expenseDate: firstOfThisMonth,
        category: 'casa',
        categoryLabel: 'Casa e affitto',
        paidBy: 'demo-marco',
        splitMode: 'percentage',
        splits: [
          { userId: 'demo-marco', amount: 429, baseAmount: 429, percentage: 55 },
          { userId: 'demo-giulia', amount: 351, baseAmount: 351, percentage: 45 },
        ],
        note: 'Bonifico mensile automatico',
        recurringId: 'demo-rec-affitto',
        recurringOccurrenceDate: firstOfThisMonth,
        createdBy: 'demo-marco',
        updatedBy: 'demo-marco',
        createdAt: `${firstOfThisMonth}T08:00:00Z`,
        updatedAt: `${firstOfThisMonth}T08:00:00Z`,
      },
      {
        id: 'demo-exp-5',
        groupId: gCasa,
        description: 'Bolletta luce e gas',
        amount: 112.5,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d34,
        rateIsManual: false,
        baseAmount: 112.5,
        expenseDate: d34,
        category: 'bollette',
        categoryLabel: 'Bollette e utenze',
        paidBy: 'demo-giulia',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 56.25, baseAmount: 56.25, percentage: null },
          { userId: 'demo-giulia', amount: 56.25, baseAmount: 56.25, percentage: null },
        ],
        note: 'Bimestre autunnale',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-giulia',
        updatedBy: 'demo-giulia',
        createdAt: `${d34}T11:30:00Z`,
        updatedAt: `${d34}T11:30:00Z`,
      },
      {
        id: 'demo-exp-6',
        groupId: gCasa,
        description: 'Abbonamento software cloud (USD)',
        amount: 20,
        currency: 'USD',
        exchangeRate: 0.924,
        rateDate: d40,
        rateIsManual: false,
        baseAmount: 18.48,
        expenseDate: d40,
        category: 'abbonamenti',
        categoryLabel: 'Abbonamenti',
        paidBy: 'demo-marco',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 10, baseAmount: 9.24, percentage: null },
          { userId: 'demo-giulia', amount: 10, baseAmount: 9.24, percentage: null },
        ],
        note: 'Backup foto condiviso',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-marco',
        updatedBy: 'demo-marco',
        createdAt: `${d40}T15:00:00Z`,
        updatedAt: `${d40}T15:00:00Z`,
      },
      // Gruppo Fuga alle Cinque Terre (Marco e Giulia, pronto da chiudere e trasferire in Casa)
      {
        id: 'demo-exp-ct-1',
        groupId: gCinqueTerre,
        description: 'Focaccia, vino e pranzo a Vernazza',
        amount: 69,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d11,
        rateIsManual: false,
        baseAmount: 69,
        expenseDate: d11,
        category: 'ristoranti',
        categoryLabel: 'Ristoranti e bar',
        paidBy: 'demo-giulia',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 34.5, baseAmount: 34.5, percentage: null },
          { userId: 'demo-giulia', amount: 34.5, baseAmount: 34.5, percentage: null },
        ],
        note: 'Terrazza vista mare',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-giulia',
        updatedBy: 'demo-giulia',
        createdAt: `${d11}T14:20:00Z`,
        updatedAt: `${d11}T14:20:00Z`,
      },
      // Gruppo Weekend a Londra (multi-valuta GBP + EUR, 3 persone)
      {
        id: 'demo-exp-uk-1',
        groupId: gLondra,
        description: 'Pub a Soho — fish & chips e birre',
        amount: 84,
        currency: 'GBP',
        exchangeRate: 1.1765,
        rateDate: d6,
        rateIsManual: false,
        baseAmount: 98.83,
        expenseDate: d6,
        category: 'ristoranti',
        categoryLabel: 'Ristoranti e bar',
        paidBy: 'demo-giulia',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 28, baseAmount: 32.95, percentage: null },
          { userId: 'demo-giulia', amount: 28, baseAmount: 32.94, percentage: null },
          { userId: 'demo-luca', amount: 28, baseAmount: 32.94, percentage: null },
        ],
        note: 'Cambio BCE del giorno della spesa',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-giulia',
        updatedBy: 'demo-giulia',
        createdAt: `${d6}T21:15:00Z`,
        updatedAt: `${d6}T21:15:00Z`,
      },
      {
        id: 'demo-exp-uk-2',
        groupId: gLondra,
        description: 'Appartamento Notting Hill (3 notti)',
        amount: 450,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d17,
        rateIsManual: false,
        baseAmount: 450,
        expenseDate: d17,
        category: 'viaggi',
        categoryLabel: 'Viaggi e alloggi',
        paidBy: 'demo-marco',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 150, baseAmount: 150, percentage: null },
          { userId: 'demo-giulia', amount: 150, baseAmount: 150, percentage: null },
          { userId: 'demo-luca', amount: 150, baseAmount: 150, percentage: null },
        ],
        note: 'Prenotazione anticipata',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-marco',
        updatedBy: 'demo-marco',
        createdAt: `${d17}T10:00:00Z`,
        updatedAt: `${d17}T10:00:00Z`,
      },
      {
        id: 'demo-exp-uk-3',
        groupId: gLondra,
        description: 'Treno Stansted Express A/R',
        amount: 66,
        currency: 'GBP',
        exchangeRate: 1.18,
        rateDate: d6,
        rateIsManual: true,
        baseAmount: 77.88,
        expenseDate: d6,
        category: 'trasporti',
        categoryLabel: 'Trasporti e auto',
        paidBy: 'demo-luca',
        splitMode: 'equal',
        splits: [
          { userId: 'demo-marco', amount: 22, baseAmount: 25.96, percentage: null },
          { userId: 'demo-giulia', amount: 22, baseAmount: 25.96, percentage: null },
          { userId: 'demo-luca', amount: 22, baseAmount: 25.96, percentage: null },
        ],
        note: 'Cambio applicato dalla carta Revolut',
        recurringId: null,
        recurringOccurrenceDate: null,
        createdBy: 'demo-luca',
        updatedBy: 'demo-luca',
        createdAt: `${d6}T11:20:00Z`,
        updatedAt: `${d6}T11:20:00Z`,
      },
    ],
    settlements: [
      {
        id: 'demo-set-1',
        groupId: gCasa,
        fromUser: 'demo-giulia',
        toUser: 'demo-marco',
        amount: 200,
        currency: 'EUR',
        exchangeRate: 1,
        rateDate: d3,
        rateIsManual: false,
        baseAmount: 200,
        settlementDate: d3,
        kind: 'settlement',
        linkedGroupName: null,
        note: 'Satispay quota affitto',
        createdBy: 'demo-giulia',
        updatedBy: 'demo-giulia',
        createdAt: `${d3}T14:00:00Z`,
        updatedAt: `${d3}T14:00:00Z`,
      },
    ],
    recurringExpenses: [
      {
        id: 'demo-rec-affitto',
        groupId: gCasa,
        description: 'Affitto appartamento',
        amount: 780,
        currency: 'EUR',
        fixedExchangeRate: null,
        category: 'casa',
        categoryLabel: 'Casa e affitto',
        paidBy: 'demo-marco',
        splitMode: 'percentage',
        splits: [
          { userId: 'demo-marco', percentage: 55 },
          { userId: 'demo-giulia', percentage: 45 },
        ],
        note: 'Bonifico mensile automatico',
        frequency: 'monthly',
        startDate: '2026-09-01',
        nextDueDate: nextMonthFirst,
        endDate: null,
        active: true,
        createdBy: 'demo-marco',
        updatedBy: 'demo-marco',
        createdAt: '2026-09-01T09:30:00Z',
        updatedAt: `${firstOfThisMonth}T08:00:00Z`,
      },
      {
        id: 'demo-rec-fibra',
        groupId: gCasa,
        description: 'Fibra casa FTTH',
        amount: 27.9,
        currency: 'EUR',
        fixedExchangeRate: null,
        category: 'bollette',
        categoryLabel: 'Bollette e utenze',
        paidBy: 'demo-giulia',
        splitMode: 'equal',
        splits: [{ userId: 'demo-marco' }, { userId: 'demo-giulia' }],
        note: 'Addebito il 25 del mese',
        frequency: 'monthly',
        startDate: '2026-09-25',
        nextDueDate: addDaysISO(today, 7),
        endDate: null,
        active: true,
        createdBy: 'demo-giulia',
        updatedBy: 'demo-giulia',
        createdAt: '2026-09-10T18:00:00Z',
        updatedAt: '2026-10-25T08:00:00Z',
      },
    ],
    activityLogs: [
      {
        id: 'demo-log-1',
        groupId: gCasa,
        actorId: 'demo-marco',
        actorName: 'Marco',
        entityType: 'expense',
        entityId: 'demo-exp-1',
        action: 'created',
        summary: 'Ha aggiunto la spesa "Spesa settimanale Esselunga" di 86,40 €',
        changes: {
          snapshot: {
            Importo: '86,40 €',
            'Pagato da': 'Marco',
            Categoria: 'Spesa alimentare',
            Divisione: 'Parti uguali — Marco: 43,20 €, Giulia: 43,20 €',
          },
        },
        createdAt: `${d1}T19:20:00Z`,
      },
      {
        id: 'demo-log-2',
        groupId: gCasa,
        actorId: 'demo-marco',
        actorName: 'Marco',
        entityType: 'expense',
        entityId: 'demo-exp-2',
        action: 'updated',
        summary: 'Ha modificato la spesa "Cena Osteria del Porto"',
        changes: {
          diffs: [
            { field: 'Importo e valuta', before: '68,00 €', after: '74,00 €' },
            {
              field: 'Ripartizione',
              before: 'Parti uguali (Marco: 34,00 €, Giulia: 34,00 €)',
              after: 'Importi esatti (Marco: 39,00 €, Giulia: 35,00 €)',
            },
          ],
        },
        createdAt: `${d3}T23:05:00Z`,
      },
      {
        id: 'demo-log-3',
        groupId: gCasa,
        actorId: 'demo-giulia',
        actorName: 'Giulia',
        entityType: 'expense',
        entityId: 'demo-exp-2',
        action: 'created',
        summary: 'Ha aggiunto la spesa "Cena Osteria del Porto" di 68,00 €',
        changes: {
          snapshot: {
            Importo: '68,00 €',
            'Pagato da': 'Giulia',
            Categoria: 'Ristoranti e bar',
          },
        },
        createdAt: `${d3}T22:40:00Z`,
      },
      {
        id: 'demo-log-4',
        groupId: gCasa,
        actorId: 'demo-giulia',
        actorName: 'Giulia',
        entityType: 'settlement',
        entityId: 'demo-set-1',
        action: 'created',
        summary: 'Ha registrato un rimborso di 200,00 € da Giulia a Marco',
        changes: {
          snapshot: {
            Rimborso: 'Giulia → Marco',
            Importo: '200,00 €',
            Nota: 'Satispay quota affitto',
          },
        },
        createdAt: `${d3}T14:00:00Z`,
      },
      {
        id: 'demo-log-5',
        groupId: gCasa,
        actorId: 'demo-marco',
        actorName: 'Marco',
        entityType: 'expense',
        entityId: 'demo-exp-4',
        action: 'generated',
        summary: 'Spesa ricorrente registrata: "Affitto appartamento" (780,00 €)',
        changes: {
          snapshot: {
            Importo: '780,00 €',
            'Pagato da': 'Marco',
            Divisione: 'Percentuali — Marco: 429,00 € (55%), Giulia: 351,00 € (45%)',
          },
        },
        createdAt: `${firstOfThisMonth}T08:00:00Z`,
      },
      {
        id: 'demo-log-6',
        groupId: gCasa,
        actorId: 'demo-giulia',
        actorName: 'Giulia',
        entityType: 'member',
        entityId: 'demo-giulia',
        action: 'joined',
        summary: "Giulia ha accettato l'invito ed è entrata nel gruppo",
        changes: {},
        createdAt: '2026-09-01T09:22:00Z',
      },
      {
        id: 'demo-log-uk-1',
        groupId: gLondra,
        actorId: 'demo-giulia',
        actorName: 'Giulia',
        entityType: 'expense',
        entityId: 'demo-exp-uk-1',
        action: 'created',
        summary: 'Ha aggiunto la spesa "Pub a Soho — fish & chips e birre" di 84,00 £ (98,83 €)',
        changes: {
          snapshot: {
            Importo: '84,00 £ → 98,83 € (cambio 1,1765, automatico)',
            'Pagato da': 'Giulia',
            Categoria: 'Ristoranti e bar',
          },
        },
        createdAt: `${d6}T21:15:00Z`,
      },
    ],
  };
}

let memoryDemoDb: DemoDatabase | null = null;

function loadDb(): DemoDatabase {
  if (memoryDemoDb) return memoryDemoDb;
  try {
    if (typeof sessionStorage !== 'undefined') {
      const raw = sessionStorage.getItem(DEMO_STORAGE_KEY);
      if (raw) {
        memoryDemoDb = JSON.parse(raw) as DemoDatabase;
        return memoryDemoDb;
      }
    }
  } catch {
    // ignore (es. navigazione privata o iframe con storage bloccato)
  }
  const initial = buildInitialDemoDatabase();
  saveDb(initial);
  return initial;
}

function saveDb(db: DemoDatabase): void {
  memoryDemoDb = db;
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(db));
    }
  } catch {
    // ignore
  }
}

export function resetDemoDatabase(): void {
  saveDb(buildInitialDemoDatabase());
}

export class DemoRepository {
  readonly isDemo = true;
  private getCurrentUserId: () => string;

  constructor(getCurrentUserId: () => string) {
    this.getCurrentUserId = getCurrentUserId;
  }

  private pushLog(
    db: DemoDatabase,
    groupId: string,
    actorId: string,
    entityType: ActivityEntityType,
    entityId: string | null,
    action: ActivityAction,
    summary: string,
    changes: ActivityChanges = {}
  ): void {
    const actor = db.users.find((u) => u.id === actorId);
    db.activityLogs.unshift({
      id: makeId('log'),
      groupId,
      actorId,
      actorName: actor?.displayName ?? 'Utente',
      entityType,
      entityId,
      action,
      summary,
      changes,
      createdAt: new Date().toISOString(),
    });
  }

  async ensureProfile(userId: string, fallbackEmail: string, fallbackName?: string): Promise<UserProfile> {
    const db = loadDb();
    const hit = db.users.find((u) => u.id === userId);
    if (hit) return hit;
    const created: UserProfile = {
      id: userId,
      email: fallbackEmail,
      displayName: fallbackName || 'Utente',
      createdAt: new Date().toISOString(),
    };
    db.users.push(created);
    saveDb(db);
    return created;
  }

  async updateProfileName(userId: string, displayName: string): Promise<UserProfile> {
    const clean = displayName.trim().slice(0, 60);
    if (!clean) throw new Error('Inserisci un nome valido.');
    const db = loadDb();
    const user = db.users.find((u) => u.id === userId);
    if (!user) throw new Error('Profilo non trovato.');
    user.displayName = clean;
    for (const list of Object.values(db.members)) {
      for (const m of list) {
        if (m.userId === userId) m.displayName = clean;
      }
    }
    saveDb(db);
    return { ...user };
  }

  async listGroupOverviews(currentUserId: string): Promise<GroupOverview[]> {
    const db = loadDb();
    const myGroups = db.groups.filter((g) =>
      (db.members[g.id] ?? []).some((m) => m.userId === currentUserId && m.leftAt === null)
    );

    return myGroups
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((group) => {
        const allMembers = db.members[group.id] ?? [];
        const expenses = db.expenses.filter((e) => e.groupId === group.id);
        const settlements = db.settlements.filter((s) => s.groupId === group.id);
        const { myNetBalance, counterpartHint, totalSpentBase } = buildCounterpartHint(
          currentUserId,
          allMembers,
          expenses,
          settlements,
          group.baseCurrency
        );
        return {
          group: { ...group },
          members: allMembers.filter((m) => m.leftAt === null).map((m) => ({ ...m })),
          expenseCount: expenses.length,
          totalSpentBase,
          myNetBalance,
          counterpartHint,
        };
      });
  }

  async createGroup(params: {
    name: string;
    description: string;
    baseCurrency: string;
  }): Promise<ExpenseGroup> {
    const db = loadDb();
    const uid = this.getCurrentUserId();
    const user = db.users.find((u) => u.id === uid) ?? DEMO_USERS[0];
    const now = new Date().toISOString();
    const group: ExpenseGroup = {
      id: makeId('grp'),
      name: params.name.trim().slice(0, 80),
      description: params.description.trim().slice(0, 280),
      baseCurrency: params.baseCurrency.toUpperCase(),
      inviteToken: makeToken(),
      inviteEnabled: true,
      closedAt: null,
      closedBy: null,
      closedIntoGroupId: null,
      closedIntoGroupName: null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    };
    db.groups.unshift(group);
    db.members[group.id] = [
      {
        userId: user.id,
        ownerId: user.id,
        displayName: user.displayName,
        joinedAt: now,
        leftAt: null,
      },
    ];
    this.pushLog(
      db,
      group.id,
      user.id,
      'group',
      group.id,
      'created',
      `Ha creato il gruppo "${group.name}" (valuta di riferimento: ${group.baseCurrency})`
    );
    saveDb(db);
    return group;
  }

  async updateGroup(params: {
    groupId: string;
    actorId: string;
    beforeName: string;
    beforeDescription: string;
    name: string;
    description: string;
  }): Promise<void> {
    const db = loadDb();
    const g = db.groups.find((x) => x.id === params.groupId);
    if (!g) throw new Error('Gruppo non trovato.');
    g.name = params.name.trim().slice(0, 80);
    g.description = params.description.trim().slice(0, 280);
    g.updatedAt = new Date().toISOString();
    const diffs = [];
    if (params.beforeName !== g.name) {
      diffs.push({ field: 'Nome gruppo', before: params.beforeName, after: g.name });
    }
    if (params.beforeDescription !== g.description) {
      diffs.push({
        field: 'Descrizione',
        before: params.beforeDescription || '(vuota)',
        after: g.description || '(vuota)',
      });
    }
    if (diffs.length > 0) {
      this.pushLog(
        db,
        g.id,
        params.actorId,
        'group',
        g.id,
        'updated',
        `Ha aggiornato le impostazioni del gruppo "${g.name}"`,
        { diffs }
      );
    }
    saveDb(db);
  }

  async leaveGroup(groupId: string): Promise<{ groupDeleted: boolean }> {
    const db = loadDb();
    const uid = this.getCurrentUserId();
    const group = db.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Gruppo non trovato.');

    const members = db.members[groupId] ?? [];
    const expenses = db.expenses.filter((e) => e.groupId === groupId);
    const settlements = db.settlements.filter((s) => s.groupId === groupId);
    const balances = computeMemberBalances(members, expenses, settlements, group.baseCurrency);
    const me = balances.find((b) => b.userId === uid);
    const myNet = me?.netBalance ?? 0;

    const memberRow = members.find((m) => m.userId === uid && m.leftAt === null);
    if (!memberRow) throw new Error('Non fai parte di questo gruppo.');
    memberRow.leftAt = new Date().toISOString();

    const remaining = members.filter((m) => m.leftAt === null);
    if (remaining.length === 0) {
      db.groups = db.groups.filter((g) => g.id !== groupId);
      delete db.members[groupId];
      db.expenses = db.expenses.filter((e) => e.groupId !== groupId);
      db.settlements = db.settlements.filter((s) => s.groupId !== groupId);
      db.recurringExpenses = db.recurringExpenses.filter((r) => r.groupId !== groupId);
      db.customCategories = db.customCategories.filter((c) => c.groupId !== groupId);
      db.activityLogs = db.activityLogs.filter((l) => l.groupId !== groupId);
      saveDb(db);
      return { groupDeleted: true };
    }

    const summary =
      Math.abs(myNet) < 0.01
        ? `${memberRow.displayName} è uscito dal gruppo (saldo in pari)`
        : `${memberRow.displayName} è uscito dal gruppo con saldo aperto di ${formatMoney(myNet, group.baseCurrency, { signed: true })}`;

    this.pushLog(db, groupId, uid, 'member', uid, 'left', summary, {
      balance_at_exit: myNet,
      currency: group.baseCurrency,
    });
    saveDb(db);
    return { groupDeleted: false };
  }

  async closeGroup(params: {
    sourceGroup: ExpenseGroup;
    targetGroup: ExpenseGroup | null;
    transfers: SimplifiedTransfer[];
    exchangeRate: number;
    rateDate: string;
    rateIsManual: boolean;
    actorId: string;
    nameOf: (userId: string) => string;
  }): Promise<{ transferredCount: number }> {
    const db = loadDb();
    const {
      sourceGroup,
      targetGroup,
      transfers,
      exchangeRate,
      rateDate,
      rateIsManual,
      actorId,
      nameOf,
    } = params;

    const src = db.groups.find((g) => g.id === sourceGroup.id);
    if (!src) throw new Error('Gruppo non trovato.');
    if (src.closedAt !== null) throw new Error('Questo gruppo è già stato chiuso.');

    const now = new Date().toISOString();
    const today = todayISO();
    let count = 0;
    const snapshot: Record<string, string> = {};
    let dst: ExpenseGroup | null = null;

    if (targetGroup) {
      if (targetGroup.id === src.id) {
        throw new Error('Seleziona un gruppo di destinazione diverso da quello attuale.');
      }
      dst = db.groups.find((g) => g.id === targetGroup.id) ?? null;
      if (!dst) throw new Error('Gruppo di destinazione non trovato.');
      if (dst.closedAt !== null) {
        throw new Error('Il gruppo di destinazione è chiuso: scegli un gruppo attivo.');
      }
      if (transfers.length === 0) {
        throw new Error('Non ci sono saldi rimanenti da trasferire.');
      }

      const dstActiveIds = new Set(
        (db.members[dst.id] ?? []).filter((m) => m.leftAt === null).map((m) => m.userId)
      );
      if (!dstActiveIds.has(actorId)) {
        throw new Error('Non fai parte del gruppo di destinazione selezionato.');
      }

      for (const tr of transfers) {
        if (!dstActiveIds.has(tr.fromUser) || !dstActiveIds.has(tr.toUser)) {
          throw new Error(
            `Tutti gli utenti coinvolti nel saldo rimanente devono far parte del gruppo "${dst.name}".`
          );
        }
      }

      const fx = src.baseCurrency === dst.baseCurrency ? 1 : exchangeRate;
      if (fx <= 0) throw new Error('Tasso di cambio non valido.');

      const lines: string[] = [];

      for (const tr of transfers) {
        const dstAmt = convertToBaseAmount(tr.amount, src.baseCurrency, fx, dst.baseCurrency);

        // 1) Compensazione in uscita nel gruppo chiuso (debitore -> creditore)
        db.settlements.unshift({
          id: makeId('set'),
          groupId: src.id,
          fromUser: tr.fromUser,
          toUser: tr.toUser,
          amount: tr.amount,
          currency: src.baseCurrency,
          exchangeRate: 1,
          rateDate: today,
          rateIsManual: false,
          baseAmount: tr.amount,
          settlementDate: today,
          kind: 'transfer_out',
          linkedGroupName: dst.name,
          note: `Saldo spostato nel gruppo "${dst.name}"`,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: now,
          updatedAt: now,
        });

        // 2) Riporto in entrata nel gruppo di destinazione (creditore -> debitore)
        db.settlements.unshift({
          id: makeId('set'),
          groupId: dst.id,
          fromUser: tr.toUser,
          toUser: tr.fromUser,
          amount: tr.amount,
          currency: src.baseCurrency,
          exchangeRate: fx,
          rateDate,
          rateIsManual: src.baseCurrency === dst.baseCurrency ? false : rateIsManual,
          baseAmount: dstAmt,
          settlementDate: today,
          kind: 'transfer_in',
          linkedGroupName: src.name,
          note: `Saldo riportato dalla chiusura di "${src.name}"`,
          createdBy: actorId,
          updatedBy: actorId,
          createdAt: now,
          updatedAt: now,
        });

        const srcMoney = formatMoney(tr.amount, src.baseCurrency);
        const dstMoney =
          src.baseCurrency === dst.baseCurrency
            ? srcMoney
            : `${srcMoney} → ${formatMoney(dstAmt, dst.baseCurrency)}`;
        lines.push(`${nameOf(tr.fromUser)} deve a ${nameOf(tr.toUser)}: ${dstMoney}`);
        count += 1;
      }

      snapshot['Gruppo di origine'] = src.name;
      snapshot['Gruppo di destinazione'] = dst.name;
      snapshot['Saldi trasferiti'] = lines.join(' · ');

      dst.updatedAt = now;
      this.pushLog(
        db,
        dst.id,
        actorId,
        'group',
        src.id,
        'transferred_in',
        `Ha riportato il saldo rimanente dal gruppo chiuso "${src.name}"`,
        { snapshot }
      );
    }

    // Disattiva ricorrenze e link d'invito del gruppo chiuso
    for (const r of db.recurringExpenses) {
      if (r.groupId === src.id && r.active) {
        r.active = false;
        r.updatedBy = actorId;
        r.updatedAt = now;
      }
    }

    src.closedAt = now;
    src.closedBy = actorId;
    src.closedIntoGroupId = dst ? dst.id : null;
    src.closedIntoGroupName = dst ? dst.name : null;
    src.inviteEnabled = false;
    src.updatedAt = now;

    this.pushLog(
      db,
      src.id,
      actorId,
      'group',
      src.id,
      'closed',
      dst
        ? `Ha chiuso il gruppo e spostato il saldo rimanente in "${dst.name}"`
        : 'Ha chiuso il gruppo',
      Object.keys(snapshot).length > 0 ? { snapshot } : {}
    );

    saveDb(db);
    return { transferredCount: count };
  }

  async reopenGroup(groupId: string, actorId: string): Promise<void> {
    const db = loadDb();
    const g = db.groups.find((x) => x.id === groupId);
    if (!g) throw new Error('Gruppo non trovato.');
    if (g.closedAt === null) throw new Error('Il gruppo è già aperto.');
    g.closedAt = null;
    g.closedBy = null;
    g.updatedAt = new Date().toISOString();
    this.pushLog(db, g.id, actorId, 'group', g.id, 'reopened', 'Ha riaperto il gruppo');
    saveDb(db);
  }

  async getInvitePreview(token: string): Promise<InvitePreview> {
    const db = loadDb();
    const uid = this.getCurrentUserId();
    const g = db.groups.find((x) => x.inviteToken === token.trim());
    if (!g) return { valid: false, reason: 'not_found' };
    if (g.closedAt !== null) return { valid: false, reason: 'closed' };
    if (!g.inviteEnabled) return { valid: false, reason: 'disabled' };
    const members = (db.members[g.id] ?? []).filter((m) => m.leftAt === null);
    const creator = db.users.find((u) => u.id === g.createdBy);
    return {
      valid: true,
      groupId: g.id,
      groupName: g.name,
      description: g.description,
      baseCurrency: g.baseCurrency,
      createdByName: creator?.displayName ?? 'Un membro',
      memberCount: members.length,
      alreadyMember: members.some((m) => m.userId === uid),
    };
  }

  async acceptInvite(token: string): Promise<string> {
    const db = loadDb();
    const uid = this.getCurrentUserId();
    const user = db.users.find((u) => u.id === uid);
    if (!user) throw new Error('Utente non trovato.');

    const g = db.groups.find((x) => x.inviteToken === token.trim());
    if (!g) throw new Error("Questo link d'invito non è valido o è stato rigenerato.");
    if (g.closedAt !== null) {
      throw new Error('Questo gruppo è stato chiuso e non accetta nuovi membri.');
    }
    if (!g.inviteEnabled) {
      throw new Error("Il link d'invito per questo gruppo è attualmente disattivato.");
    }

    const list = db.members[g.id] ?? [];
    const existing = list.find((m) => m.userId === uid);
    if (existing && existing.leftAt === null) return g.id;

    const now = new Date().toISOString();
    if (existing) {
      existing.leftAt = null;
      existing.joinedAt = now;
    } else {
      list.push({
        userId: user.id,
        ownerId: user.id,
        displayName: user.displayName,
        joinedAt: now,
        leftAt: null,
      });
      db.members[g.id] = list;
    }

    g.updatedAt = now;
    this.pushLog(
      db,
      g.id,
      uid,
      'member',
      uid,
      'joined',
      `${user.displayName} ha accettato l'invito ed è entrato nel gruppo`
    );
    saveDb(db);
    return g.id;
  }

  async regenerateInvite(groupId: string): Promise<string> {
    const db = loadDb();
    const g = db.groups.find((x) => x.id === groupId);
    if (!g) throw new Error('Gruppo non trovato.');
    g.inviteToken = makeToken();
    g.inviteEnabled = true;
    this.pushLog(
      db,
      groupId,
      this.getCurrentUserId(),
      'invite',
      groupId,
      'regenerated',
      "Ha rigenerato il link d'invito del gruppo (il link precedente non è più valido)"
    );
    saveDb(db);
    return g.inviteToken;
  }

  async setInviteEnabled(groupId: string, enabled: boolean): Promise<boolean> {
    const db = loadDb();
    const g = db.groups.find((x) => x.id === groupId);
    if (!g) throw new Error('Gruppo non trovato.');
    g.inviteEnabled = enabled;
    this.pushLog(
      db,
      groupId,
      this.getCurrentUserId(),
      'invite',
      groupId,
      enabled ? 'enabled' : 'disabled',
      enabled
        ? "Ha riattivato il link d'invito del gruppo"
        : "Ha disattivato il link d'invito del gruppo"
    );
    saveDb(db);
    return enabled;
  }

  async getGroupData(groupId: string): Promise<GroupData> {
    const db = loadDb();
    const group = db.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Gruppo non trovato.');

    return {
      group: { ...group },
      members: (db.members[groupId] ?? []).map((m) => ({ ...m })),
      customCategories: db.customCategories
        .filter((c) => c.groupId === groupId)
        .sort((a, b) => a.name.localeCompare(b.name, 'it')),
      expenses: db.expenses
        .filter((e) => e.groupId === groupId)
        .sort(
          (a, b) =>
            b.expenseDate.localeCompare(a.expenseDate) || b.createdAt.localeCompare(a.createdAt)
        ),
      settlements: db.settlements
        .filter((s) => s.groupId === groupId)
        .sort(
          (a, b) =>
            b.settlementDate.localeCompare(a.settlementDate) ||
            b.createdAt.localeCompare(a.createdAt)
        ),
      recurringExpenses: db.recurringExpenses
        .filter((r) => r.groupId === groupId)
        .sort(
          (a, b) =>
            Number(b.active) - Number(a.active) || a.nextDueDate.localeCompare(b.nextDueDate)
        ),
      activityLogs: db.activityLogs
        .filter((l) => l.groupId === groupId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async saveExpense(params: {
    input: ExpenseInput;
    baseCurrency: string;
    before?: Expense;
    nameOf: (userId: string) => string;
    fromRecurring?: boolean;
  }): Promise<string> {
    const db = loadDb();
    const uid = this.getCurrentUserId();
    const now = new Date().toISOString();
    const { input, baseCurrency, before, nameOf, fromRecurring = false } = params;

    if (input.id && before) {
      const idx = db.expenses.findIndex((e) => e.id === input.id);
      if (idx === -1) throw new Error('Spesa non trovata.');
      db.expenses[idx] = {
        ...db.expenses[idx],
        description: input.description.trim(),
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        exchangeRate: input.exchangeRate,
        rateDate: input.rateDate,
        rateIsManual: input.rateIsManual,
        baseAmount: input.baseAmount,
        expenseDate: input.expenseDate,
        category: input.category,
        categoryLabel: input.categoryLabel,
        paidBy: input.paidBy,
        splitMode: input.splitMode,
        splits: input.splits.map((s) => ({ ...s })),
        note: input.note.trim(),
        updatedBy: uid,
        updatedAt: now,
      };
      const log = buildExpenseUpdatedLog(before, input, baseCurrency, nameOf);
      this.pushLog(db, input.groupId, uid, 'expense', input.id, 'updated', log.summary, log.changes);
      const grp = db.groups.find((g) => g.id === input.groupId);
      if (grp) grp.updatedAt = now;
      saveDb(db);
      return input.id;
    }

    const id = makeId('exp');
    db.expenses.unshift({
      id,
      groupId: input.groupId,
      description: input.description.trim(),
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      exchangeRate: input.exchangeRate,
      rateDate: input.rateDate,
      rateIsManual: input.rateIsManual,
      baseAmount: input.baseAmount,
      expenseDate: input.expenseDate,
      category: input.category,
      categoryLabel: input.categoryLabel,
      paidBy: input.paidBy,
      splitMode: input.splitMode,
      splits: input.splits.map((s) => ({ ...s })),
      note: input.note.trim(),
      recurringId: input.recurringId ?? null,
      recurringOccurrenceDate: input.recurringOccurrenceDate ?? null,
      createdBy: uid,
      updatedBy: uid,
      createdAt: now,
      updatedAt: now,
    });

    const log = buildExpenseCreatedLog(input, baseCurrency, nameOf, fromRecurring);
    this.pushLog(
      db,
      input.groupId,
      uid,
      'expense',
      id,
      fromRecurring ? 'generated' : 'created',
      log.summary,
      log.changes
    );
    const grp = db.groups.find((g) => g.id === input.groupId);
    if (grp) grp.updatedAt = now;
    saveDb(db);
    return id;
  }

  async deleteExpense(params: {
    expense: Expense;
    baseCurrency: string;
    nameOf: (userId: string) => string;
  }): Promise<void> {
    const db = loadDb();
    const uid = this.getCurrentUserId();
    db.expenses = db.expenses.filter((e) => e.id !== params.expense.id);
    const log = buildExpenseDeletedLog(params.expense, params.baseCurrency, params.nameOf);
    this.pushLog(
      db,
      params.expense.groupId,
      uid,
      'expense',
      params.expense.id,
      'deleted',
      log.summary,
      log.changes
    );
    saveDb(db);
  }

  async saveSettlement(params: {
    input: SettlementInput;
    actorId: string;
    baseCurrency: string;
    before?: Settlement;
    nameOf: (userId: string) => string;
  }): Promise<string> {
    const db = loadDb();
    const now = new Date().toISOString();
    const { input, actorId, baseCurrency, before, nameOf } = params;

    if (input.fromUser === input.toUser) {
      throw new Error('Chi rimborsa e chi riceve devono essere due persone diverse.');
    }

    if (input.id && before) {
      const idx = db.settlements.findIndex((s) => s.id === input.id);
      if (idx === -1) throw new Error('Rimborso non trovato.');
      db.settlements[idx] = {
        ...db.settlements[idx],
        fromUser: input.fromUser,
        toUser: input.toUser,
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        exchangeRate: input.exchangeRate,
        rateDate: input.rateDate,
        rateIsManual: input.rateIsManual,
        baseAmount: input.baseAmount,
        settlementDate: input.settlementDate,
        note: input.note.trim(),
        updatedBy: actorId,
        updatedAt: now,
      };
      const log = buildSettlementUpdatedLog(before, input, baseCurrency, nameOf);
      this.pushLog(
        db,
        input.groupId,
        actorId,
        'settlement',
        input.id,
        'updated',
        log.summary,
        log.changes
      );
      saveDb(db);
      return input.id;
    }

    const id = makeId('set');
    db.settlements.unshift({
      id,
      groupId: input.groupId,
      fromUser: input.fromUser,
      toUser: input.toUser,
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      exchangeRate: input.exchangeRate,
      rateDate: input.rateDate,
      rateIsManual: input.rateIsManual,
      baseAmount: input.baseAmount,
      settlementDate: input.settlementDate,
      kind: 'settlement',
      linkedGroupName: null,
      note: input.note.trim(),
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });

    const log = buildSettlementCreatedLog(input, baseCurrency, nameOf);
    this.pushLog(db, input.groupId, actorId, 'settlement', id, 'created', log.summary, log.changes);
    const grp = db.groups.find((g) => g.id === input.groupId);
    if (grp) grp.updatedAt = now;
    saveDb(db);
    return id;
  }

  async deleteSettlement(params: {
    settlement: Settlement;
    actorId: string;
    baseCurrency: string;
    nameOf: (userId: string) => string;
  }): Promise<void> {
    const db = loadDb();
    db.settlements = db.settlements.filter((s) => s.id !== params.settlement.id);
    const log = buildSettlementDeletedLog(params.settlement, params.baseCurrency, params.nameOf);
    this.pushLog(
      db,
      params.settlement.groupId,
      params.actorId,
      'settlement',
      params.settlement.id,
      'deleted',
      log.summary,
      log.changes
    );
    saveDb(db);
  }

  async saveRecurring(params: {
    input: RecurringExpenseInput;
    actorId: string;
    baseCurrency: string;
    before?: RecurringExpense;
    nameOf: (userId: string) => string;
  }): Promise<string> {
    const db = loadDb();
    const now = new Date().toISOString();
    const { input, actorId, before, nameOf } = params;
    const money = formatMoney(input.amount, input.currency);
    const freqLabel = FREQUENCY_LABELS[input.frequency];

    if (input.id && before) {
      const idx = db.recurringExpenses.findIndex((r) => r.id === input.id);
      if (idx === -1) throw new Error('Spesa ricorrente non trovata.');
      db.recurringExpenses[idx] = {
        ...db.recurringExpenses[idx],
        description: input.description.trim(),
        amount: input.amount,
        currency: input.currency.toUpperCase(),
        fixedExchangeRate: input.fixedExchangeRate,
        category: input.category,
        categoryLabel: input.categoryLabel,
        paidBy: input.paidBy,
        splitMode: input.splitMode,
        splits: input.splits,
        note: input.note.trim(),
        frequency: input.frequency,
        startDate: input.startDate,
        nextDueDate: input.nextDueDate,
        endDate: input.endDate,
        active: input.active,
        updatedBy: actorId,
        updatedAt: now,
      };
      this.pushLog(
        db,
        input.groupId,
        actorId,
        'recurring',
        input.id,
        'updated',
        `Ha modificato la spesa ricorrente "${input.description.trim()}" (${money}, ${freqLabel.toLowerCase()})`
      );
      saveDb(db);
      return input.id;
    }

    const id = makeId('rec');
    db.recurringExpenses.push({
      id,
      groupId: input.groupId,
      description: input.description.trim(),
      amount: input.amount,
      currency: input.currency.toUpperCase(),
      fixedExchangeRate: input.fixedExchangeRate,
      category: input.category,
      categoryLabel: input.categoryLabel,
      paidBy: input.paidBy,
      splitMode: input.splitMode,
      splits: input.splits,
      note: input.note.trim(),
      frequency: input.frequency,
      startDate: input.startDate,
      nextDueDate: input.nextDueDate,
      endDate: input.endDate,
      active: input.active,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: now,
      updatedAt: now,
    });

    this.pushLog(
      db,
      input.groupId,
      actorId,
      'recurring',
      id,
      'created',
      `Ha impostato la spesa ricorrente "${input.description.trim()}" (${money}, ${freqLabel.toLowerCase()})`,
      {
        snapshot: {
          Importo: money,
          Frequenza: freqLabel,
          'Pagato da': nameOf(input.paidBy),
          Divisione: SPLIT_MODE_LABELS[input.splitMode],
          'Prima scadenza': formatFullDateIT(input.nextDueDate),
        },
      }
    );
    saveDb(db);
    return id;
  }

  async setRecurringActive(params: {
    recurring: RecurringExpense;
    active: boolean;
    nextDueDate?: string;
    actorId: string;
  }): Promise<void> {
    const db = loadDb();
    const r = db.recurringExpenses.find((x) => x.id === params.recurring.id);
    if (!r) return;
    const prevActive = r.active;
    r.active = params.active;
    if (params.nextDueDate) r.nextDueDate = params.nextDueDate;
    r.updatedBy = params.actorId;
    r.updatedAt = new Date().toISOString();

    if (!params.nextDueDate && prevActive !== params.active) {
      this.pushLog(
        db,
        r.groupId,
        params.actorId,
        'recurring',
        r.id,
        params.active ? 'resumed' : 'paused',
        params.active
          ? `Ha riattivato la spesa ricorrente "${r.description}"`
          : `Ha messo in pausa la spesa ricorrente "${r.description}"`
      );
    }
    saveDb(db);
  }

  async deleteRecurring(params: {
    recurring: RecurringExpense;
    actorId: string;
  }): Promise<void> {
    const db = loadDb();
    db.recurringExpenses = db.recurringExpenses.filter((r) => r.id !== params.recurring.id);
    this.pushLog(
      db,
      params.recurring.groupId,
      params.actorId,
      'recurring',
      params.recurring.id,
      'deleted',
      `Ha rimosso la spesa ricorrente "${params.recurring.description}"`
    );
    saveDb(db);
  }

  async addCustomCategory(params: {
    groupId: string;
    actorId: string;
    name: string;
    icon: string;
    color: string;
  }): Promise<CustomCategory> {
    const clean = params.name.trim().slice(0, 40);
    if (!clean) throw new Error('Inserisci un nome per la categoria.');
    const db = loadDb();
    const dup = db.customCategories.some(
      (c) => c.groupId === params.groupId && c.name.toLowerCase() === clean.toLowerCase()
    );
    if (dup) throw new Error('Esiste già una categoria con questo nome.');

    const created: CustomCategory = {
      id: makeId('cat'),
      groupId: params.groupId,
      name: clean,
      icon: params.icon,
      color: params.color,
      createdBy: params.actorId,
      createdAt: new Date().toISOString(),
    };
    db.customCategories.push(created);
    this.pushLog(
      db,
      params.groupId,
      params.actorId,
      'category',
      created.id,
      'created',
      `Ha creato la categoria personalizzata "${clean}"`
    );
    saveDb(db);
    return created;
  }

  async deleteCustomCategory(params: {
    category: CustomCategory;
    actorId: string;
  }): Promise<void> {
    const db = loadDb();
    db.customCategories = db.customCategories.filter((c) => c.id !== params.category.id);
    this.pushLog(
      db,
      params.category.groupId,
      params.actorId,
      'category',
      params.category.id,
      'deleted',
      `Ha eliminato la categoria personalizzata "${params.category.name}"`
    );
    saveDb(db);
  }

  subscribeToGroup(): () => void {
    return () => {};
  }
}
