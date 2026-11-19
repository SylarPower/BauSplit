// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpenseFormModal } from '../src/components/ExpenseFormModal';
import { SettlementFormModal } from '../src/components/SettlementFormModal';
import { RecurringTab } from '../src/components/RecurringTab';
import { GroupSettingsModal } from '../src/components/GroupSettingsModal';
import { fetchExchangeRate, type ExchangeRateResult } from '../src/lib/currencies';
import type { Expense, ExpenseGroup } from '../src/types';

vi.mock('../src/lib/currencies', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/currencies')>()),
  fetchExchangeRate: vi.fn(),
}));
vi.mock('../src/lib/supabase', () => ({ translateErrorIT: String }));

const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const flip = () => click('Inverti cambio');
const quote = (inverse: boolean) => `Tasso di cambio: 1 ${inverse ? 'EUR in JPY' : 'JPY in EUR'}`;
const valueOf = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;
const members = ['Anna', 'Nina'].map((id) => ({
  userId: id,
  accessRole: 'editor' as const,
  ownerId: id,
  displayName: id,
  joinedAt: '2026-01-01',
  leftAt: null,
}));
const categories = [
  { key: 'spesa', name: 'Dispensa', icon: 'home', color: '#112233', hidden: true },
  { key: 'altro', name: 'Altro', icon: 'tag', color: '#78716C', hidden: false },
];
const common = {
  groupId: 'g1',
  baseCurrency: 'EUR',
  currentUserId: 'Anna',
  members,
  categories,
  onToast: vi.fn(),
};
const expenseProps = {
  ...common,
  open: true,
  onClose: vi.fn(),
  expenses: [],
  editingExpense: null,
  onAddCustomCategory: vi.fn(),
  onSaveExpense: vi.fn(),
  onCreateRecurringWithOptionalFirst: vi.fn(),
};
const autoResult: ExchangeRateResult = { rate: 0.006, source: 'ecb', effectiveDate: '2026-01-03' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchExchangeRate).mockResolvedValue(autoResult);
});
afterEach(cleanup);

describe('Inserimento e salvataggio del cambio nei moduli', () => {
  it('inverte durante il caricamento, usa il manuale su spesa e ricorrenza senza farsi sovrascrivere dalla BCE', async () => {
    let complete!: (value: ExchangeRateResult) => void;
    vi.mocked(fetchExchangeRate).mockReturnValue(
      new Promise((resolve) => {
        complete = resolve;
      })
    );
    render(<ExpenseFormModal {...expenseProps} />);
    change('Descrizione', 'Treno');
    change('Importo della spesa', '16000');
    change('Valuta della spesa', 'JPY');
    expect(valueOf('Categoria')).toBe('altro');
    expect(screen.queryByRole('option', { name: /Dispensa/ })).toBeNull();
    flip();
    change(quote(true), '160');
    await act(async () => complete(autoResult));
    expect(valueOf(quote(true))).toBe('160');
    flip();
    expect(valueOf(quote(false))).toBe('0,00625');
    flip();
    click(/Ripeti automaticamente/);
    click('Salva spesa ricorrente');
    await waitFor(() =>
      expect(expenseProps.onCreateRecurringWithOptionalFirst).toHaveBeenCalledTimes(1)
    );
    const { firstExpense, recurring } =
      expenseProps.onCreateRecurringWithOptionalFirst.mock.calls[0][0];
    expect(firstExpense).toMatchObject({
      amount: 16000,
      currency: 'JPY',
      baseAmount: 100,
      exchangeRate: 0.00625,
      rateIsManual: true,
    });
    expect(firstExpense.splits.map((s: { baseAmount: number }) => s.baseAmount)).toEqual([50, 50]);
    expect(recurring.fixedExchangeRate).toBe(0.00625);
  });

  it('la sola inversione del cambio automatico conserva data BCE e ricorrenza senza cambio fisso', async () => {
    render(<ExpenseFormModal {...expenseProps} />);
    change('Descrizione', 'Abbonamento');
    change('Importo della spesa', '1600');
    change('Valuta della spesa', 'JPY');
    await waitFor(() => expect(valueOf(quote(false))).toBe('0,006'));
    flip();
    click(/Ripeti automaticamente/);
    click('Salva spesa ricorrente');
    await waitFor(() =>
      expect(expenseProps.onCreateRecurringWithOptionalFirst).toHaveBeenCalledTimes(1)
    );
    const { firstExpense, recurring } =
      expenseProps.onCreateRecurringWithOptionalFirst.mock.calls[0][0];
    expect(firstExpense).toMatchObject({
      exchangeRate: autoResult.rate,
      rateDate: autoResult.effectiveDate,
      rateIsManual: false,
    });
    expect(recurring.fixedExchangeRate).toBeNull();
  });

  it('la sola inversione di una spesa storica non ricalcola importo, quote, data o origine del cambio', async () => {
    const e: Expense = {
      id: 'e1',
      groupId: 'g1',
      description: 'Treno',
      amount: 16000,
      currency: 'JPY',
      exchangeRate: 0.00612345,
      rateIsManual: false,
      rateDate: '2026-01-02',
      baseAmount: 97.98,
      expenseDate: '2026-01-05',
      paidBy: 'Anna',
      splitMode: 'equal',
      splits: members.map((m) => ({
        userId: m.userId,
        amount: 8000,
        baseAmount: 48.99,
        percentage: null,
      })),
      category: 'spesa',
      categoryLabel: 'Vecchio nome',
      note: '',
      recurringId: null,
      recurringOccurrenceDate: null,
      createdBy: 'Anna',
      updatedBy: 'Anna',
      createdAt: '2026-01-05',
      updatedAt: '2026-01-05',
    };
    render(<ExpenseFormModal {...expenseProps} editingExpense={e} />);
    expect(valueOf('Importo della spesa')).toBe('16000');
    expect(screen.getByRole('option', { name: 'Dispensa (nascosta)' })).toBeTruthy();
    flip();
    flip();
    flip();
    click('Salva modifiche');
    await waitFor(() => expect(expenseProps.onSaveExpense).toHaveBeenCalledTimes(1));
    expect(expenseProps.onSaveExpense.mock.calls[0][0]).toMatchObject({
      amount: e.amount,
      baseAmount: e.baseAmount,
      splits: e.splits,
      exchangeRate: e.exchangeRate,
      rateDate: e.rateDate,
      rateIsManual: false,
      category: 'spesa',
      categoryLabel: 'Dispensa',
    });
    expect(fetchExchangeRate).not.toHaveBeenCalled();
  });

  it('per un rimborso può tornare al cambio automatico nel verso scelto o salvare quello manuale', async () => {
    const save = vi.fn();
    render(
      <SettlementFormModal
        {...common}
        open
        onClose={vi.fn()}
        balances={[]}
        editingSettlement={null}
        prefillTransfer={null}
        onSave={save}
      />
    );
    change('Importo del rimborso', '1600');
    change('Valuta del rimborso', 'JPY');
    await waitFor(() => expect(valueOf(quote(false))).toBe('0,006'));
    flip();
    change(quote(true), '160');
    click('Cambio automatico');
    await waitFor(() => expect(valueOf(quote(true))).toMatch(/^166,66/));
    change(quote(true), '160');
    click('Registra rimborso');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      currency: 'JPY',
      amount: 1600,
      baseAmount: 10,
      exchangeRate: 0.00625,
      rateIsManual: true,
    });
  });

  it.each([
    ['', null],
    ['160', 0.00625],
  ])('per una ricorrenza, campo inverso «%s» → cambio fisso %s', async (text, expected) => {
    const save = vi.fn();
    render(
      <RecurringTab
        {...common}
        canEdit
        recurringExpenses={[]}
        nameOf={(s) => s}
        onSaveRecurring={save}
        onDeleteRecurring={vi.fn()}
        onRunNow={vi.fn()}
        onToggleActive={vi.fn()}
      />
    );
    click('Nuova ricorrente');
    change('Descrizione', 'Affitto');
    change('Importo della ricorrenza', '16000');
    change('Valuta della ricorrenza', 'JPY');
    flip();
    change(quote(true), String(text));
    click('Crea ricorrenza');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({ currency: 'JPY', fixedExchangeRate: expected });
  });

  it('al trasferimento tra gruppi cambia solo la scrittura: converte dallo yen del gruppo in chiusura all’euro di destinazione', async () => {
    const group: ExpenseGroup = {
      id: 'g1',
      name: 'Giappone',
      description: '',
      baseCurrency: 'JPY',
      closedAt: null,
      closedBy: null,
      closedIntoGroupId: null,
      quickCreatorSeat: null,
      closedIntoGroupName: null,
      createdAt: '',
      createdBy: 'Anna',
      updatedAt: '',
    };
    const target = { ...group, id: 'g2', name: 'Casa', baseCurrency: 'EUR' };
    const save = vi.fn();
    render(
      <GroupSettingsModal
        {...common}
        group={group}
        open
        initialFocusClose
        onClose={vi.fn()}
        allGroups={[
          {
            group: target,
            members,
            expenseCount: 0,
            totalSpentBase: 0,
            myNetBalance: 0,
            counterpartHint: '',
          },
        ]}
        balances={[]}
        transfers={[
          { fromUser: 'Anna', fromName: 'Anna', toUser: 'Nina', toName: 'Nina', amount: 1600 },
        ]}
        onCloseGroup={save}
        onUpdateGroup={vi.fn()}
        onAddParticipant={vi.fn()}
        onReopenGroup={vi.fn()}
        onLeaveGroup={vi.fn()}
        onMoveCategory={vi.fn()}
        onSaveCategory={vi.fn()}
        onDeleteCategory={vi.fn()}
      />
    );
    await waitFor(() => expect(valueOf(quote(false))).toBe('0,006'));
    flip();
    change(quote(true), '160');
    click('Sposta saldo in "Casa" e chiudi');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0][0]).toMatchObject({
      targetGroup: target,
      exchangeRate: 0.00625,
      rateIsManual: true,
    });
  });
});
