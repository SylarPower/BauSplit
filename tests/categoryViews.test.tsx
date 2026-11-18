// @vitest-environment jsdom
import { createClient } from '@supabase/supabase-js';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CategoryManager } from '../src/components/CategoryManager';
import { DEFAULT_EXPENSE_FILTERS, ExpensesTab } from '../src/components/ExpensesTab';
import { computeGroupInsights } from '../src/lib/accounting';
import { entryCategories } from '../src/lib/categories';
import { generateGroupCsv } from '../src/lib/csv';
import { processDueRecurringExpenses, SupabaseRepository } from '../src/lib/repository';
import type { CategoryOption } from '../src/types';

const catalog: CategoryOption[] = [
  { key: 'custom:cat', name: 'Milo', color: '#112233', icon: 'paw-print', hidden: false },
  { key: 'spesa', name: 'Dispensa', color: '#BE185D', icon: 'home', hidden: true },
];
afterEach(cleanup);

it('nome nuovo anche in ricerca, dettaglio, filtri, CSV, Insights e prossima ricorrenza; lo storico non cambia', async () => {
  // Risposte HTTP come su PostgREST: etichette salvate prima della rinomina.
  const e = {
    id: 'e1',
    group_id: 'g',
    description: 'Mercato',
    amount: 1600,
    currency: 'JPY',
    exchange_rate: 0.00625,
    rate_date: '2026-05-18',
    rate_is_manual: true,
    expense_date: '2026-05-18',
    base_amount: 10,
    category: 'spesa',
    category_label: 'Spesa alimentare',
    paid_by: 'a',
    split_mode: 'equal',
    created_at: '2026-05-18',
    note: '',
  };
  const rows: Record<string, unknown> = {
    expense_groups: { id: 'g', name: 'Viaggio', base_currency: 'EUR', closed_at: null },
    get_group_categories: catalog,
    group_members: [
      { user_id: 'a', owner_id: 'a', display_name: 'Anna', joined_at: '2026-01-01', left_at: null },
    ],
    expenses: [
      e,
      {
        ...e,
        id: 'e2',
        description: 'Ricordo',
        category: 'custom:deleted',
        category_label: 'Vecchia categoria',
      },
    ],
    expense_splits: [
      { expense_id: 'e1', user_id: 'a', amount: 1600, base_amount: 10, percentage: null },
    ],
    settlements: [],
    recurring_expenses: [
      {
        id: 'r1',
        group_id: 'g',
        description: 'Crocchette',
        amount: 8,
        currency: 'EUR',
        fixed_exchange_rate: null,
        category: 'custom:cat',
        category_label: 'Animali',
        paid_by: 'a',
        split_mode: 'equal',
        splits: [{ userId: 'a' }],
        frequency: 'monthly',
        start_date: '2026-01-01',
        next_due_date: '2026-06-01',
        end_date: null,
        active: true,
      },
    ],
    activity_logs: [
      {
        id: 'log',
        actor_id: 'a',
        entity_id: 'e1',
        entity_type: 'expense',
        summary: 'Ha registrato Mercato',
        action: 'created',
        changes: { snapshot: { Categoria: 'Spesa alimentare' } },
        created_at: '2026-05-18',
      },
    ],
  };
  const client = createClient('https://bausplit.example.test', 'public-test', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input) => {
        const table = new URL(String(input)).pathname.split('/').pop()!;
        if (!(table in rows)) throw new Error(`Richiesta inattesa: ${table}`);
        return new Response(JSON.stringify(rows[table]), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const data = await new SupabaseRepository(client).getGroupData('g');
  expect(data.expenses.map((e) => e.categoryLabel)).toEqual(['Dispensa', 'Vecchia categoria']);
  expect(data.activityLogs[0].changes.snapshot?.Categoria).toBe('Spesa alimentare');
  expect(entryCategories(data.categories, data.expenses[1]).at(-1)).toMatchObject({
    name: 'Vecchia categoria',
    hidden: true,
  });
  expect(
    generateGroupCsv({ ...data, groupName: 'Viaggio', baseCurrency: 'EUR', nameOf: () => 'Anna' })
  ).toContain('Mercato,Dispensa,');
  const insights = computeGroupInsights(
    data.expenses,
    [],
    data.members,
    data.categories,
    'EUR',
    '',
    ''
  );
  expect(insights.byCategory.find((c) => c.key === 'spesa')).toMatchObject({
    label: 'Dispensa',
    total: 10,
    color: '#BE185D',
    icon: 'home',
  });
  const saveExpense = vi.fn();
  await processDueRecurringExpenses({
    repo: { saveExpense, setRecurringActive: vi.fn() },
    actorId: 'a',
    data,
    forceSingleOccurrence: true,
  });
  expect(saveExpense.mock.calls[0][0].input).toMatchObject({
    category: 'custom:cat',
    categoryLabel: 'Milo',
  });

  render(
    <ExpensesTab
      {...data}
      currentUserId="a"
      groupName="Viaggio"
      baseCurrency="EUR"
      isClosed={false}
      filters={{ ...DEFAULT_EXPENSE_FILTERS, search: 'dispensa' }}
      onFiltersChange={vi.fn()}
      onAddExpense={vi.fn()}
      onEditExpense={vi.fn()}
      onDeleteExpense={vi.fn()}
      onEditSettlement={vi.fn()}
      onDeleteSettlement={vi.fn()}
      onToast={vi.fn()}
    />
  );
  expect(screen.queryByRole('button', { name: /Ricordo/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Filtri' }));
  expect(screen.getByRole('option', { name: 'Dispensa' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Vecchia categoria' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Mercato/ }));
  expect(within(screen.getByRole('dialog')).getByText(/^Dispensa ·/)).toBeTruthy();
});

it('le impostazioni modificano una predefinita sul posto, senza ricrearla né sovrascrivere campi immutati', async () => {
  const save = vi.fn().mockResolvedValue('spesa');
  const move = vi.fn();
  render(
    <CategoryManager
      categories={catalog}
      onSaveCategory={save}
      onMoveCategory={move}
      onDeleteCategory={vi.fn()}
      onToast={vi.fn()}
    />
  );
  fireEvent.click(screen.getByText('Categorie del gruppo'));
  fireEvent.click(screen.getByRole('button', { name: 'Modifica Dispensa' }));
  fireEvent.change(screen.getByLabelText('Nome della categoria'), {
    target: { value: 'Alimentari' },
  });
  fireEvent.change(screen.getByLabelText('Icona'), { target: { value: 'utensils' } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: 'Salva categoria' }));
  await waitFor(() => expect(screen.queryByLabelText('Nome della categoria')).toBeNull());
  expect(save).toHaveBeenCalledWith('spesa', {
    name: 'Alimentari',
    icon: 'utensils',
    hidden: false,
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sposta Dispensa su' }));
  await waitFor(() => expect(move).toHaveBeenCalledWith('spesa', -1));
});
