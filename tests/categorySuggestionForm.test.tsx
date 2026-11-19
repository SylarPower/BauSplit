// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpenseFormModal } from '../src/components/ExpenseFormModal';
import type { Expense } from '../src/types';
import { expense, member } from './fixtures/groupViews';

vi.mock('../src/lib/supabase', () => ({ translateErrorIT: String }));
afterEach(cleanup);

const catalog = [
  { key: 'spesa', name: 'Spesa', icon: 'tag', color: '#00796B', hidden: false },
  { key: 'custom:treni', name: 'Mezzi pubblici', icon: 'car', color: '#1976D2', hidden: false },
  { key: 'cene', name: 'Cene', icon: 'utensils', color: '#FF8800', hidden: false },
];
const ride: Expense = {
  ...expense('Treno', 24, 'a', ['a', 's']),
  category: 'custom:treni',
  categoryLabel: 'Vecchio nome',
};
const props = () => ({
  open: true,
  groupId: 'ev',
  baseCurrency: 'EUR',
  currentUserId: 's',
  members: [member('a', 'Anna', 'account-anna'), member('s', 'Sara', 'ospite-sara')],
  categories: catalog,
  expenses: [ride],
  editingExpense: null,
  onSaveExpense: vi.fn().mockResolvedValue(undefined),
  onCreateRecurringWithOptionalFirst: vi.fn().mockResolvedValue(undefined),
  onAddCustomCategory: vi.fn().mockResolvedValue('custom:nuova'),
  onClose: vi.fn(),
  onToast: vi.fn(),
});
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const category = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Categoria' });
const hint = () => screen.getByRole('status').textContent;
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

it('mostra e salva la categoria suggerita con il nome attuale, senza riutilizzare pagante, importo o quote del precedente', async () => {
  const p = props();
  render(<ExpenseFormModal {...p} />);
  change('Descrizione', 'Treno per Bologna');
  expect(category().value).toBe('custom:treni');
  expect(hint()).toContain('Categoria suggerita dallo storico: Mezzi pubblici');
  expect(document.getElementById(category().getAttribute('aria-describedby')!)).toBe(
    screen.getByRole('status')
  );
  change('Importo della spesa', '10');
  expect(p.onSaveExpense).not.toHaveBeenCalled();
  click('Aggiungi spesa');
  await waitFor(() => expect(p.onClose).toHaveBeenCalled());
  expect(p.onSaveExpense).toHaveBeenCalledWith(
    expect.objectContaining({
      groupId: 'ev',
      description: 'Treno per Bologna',
      category: 'custom:treni',
      categoryLabel: 'Mezzi pubblici',
      paidBy: 's',
      amount: 10,
      splits: [
        expect.objectContaining({ userId: 'a', amount: 5 }),
        expect.objectContaining({ userId: 's', amount: 5 }),
      ],
    }),
    undefined
  );
});

it('finché la scelta è automatica segue il testo e lo storico; se la proposta sparisce ripristina la categoria iniziale', () => {
  const p = props();
  const { rerender } = render(<ExpenseFormModal {...p} />);
  change('Descrizione', 'Treno');
  expect(category().value).toBe('custom:treni');
  for (const description of ['', 'Gelato']) {
    change('Descrizione', description);
    expect(category().value).toBe('spesa');
    expect(hint()).toBe('');
  }
  change('Descrizione', 'Treno');
  const hidden = catalog.map((c) => ({ ...c, hidden: c.key === 'custom:treni' }));
  rerender(<ExpenseFormModal {...p} categories={hidden} />);
  expect(category().value).toBe('spesa');
  expect(hint()).toBe('');
  rerender(
    <ExpenseFormModal {...p} expenses={[ride, { ...ride, id: 'altra', category: 'cene' }]} />
  );
  expect(category().value).toBe('spesa');
  expect(hint()).toBe('');
  rerender(<ExpenseFormModal {...p} />);
  expect(category().value).toBe('custom:treni');
});

it('una scelta manuale vince su testo e sincronizzazione fino alla chiusura; la bozza successiva riparte automatica', async () => {
  const p = props();
  const { rerender } = render(<ExpenseFormModal {...p} />);
  change('Descrizione', 'Treno');
  change('Categoria', 'spesa'); // Anche se si sceglie esplicitamente il valore predefinito.
  change('Descrizione', 'Treno per Bologna');
  rerender(<ExpenseFormModal {...p} expenses={[{ ...ride }]} />);
  expect(category().value).toBe('spesa');
  expect(hint()).toBe('');
  change('Importo della spesa', '10');
  click('Aggiungi spesa');
  await waitFor(() =>
    expect(p.onSaveExpense).toHaveBeenCalledWith(
      expect.objectContaining({ category: 'spesa' }),
      undefined
    )
  );
  rerender(<ExpenseFormModal {...p} open={false} />);
  rerender(<ExpenseFormModal {...p} />);
  expect(screen.getByLabelText<HTMLInputElement>('Descrizione').value).toBe('');
  change('Descrizione', 'Treno');
  expect(category().value).toBe('custom:treni');
});

it('la creazione di una categoria nel modulo vale come scelta manuale, anche per la nuova ricorrenza', async () => {
  const p = props();
  const { rerender } = render(<ExpenseFormModal {...p} />);
  change('Descrizione', 'Treno');
  expect(category().value).toBe('custom:treni');
  click('Nuova');
  change('Nome della categoria', 'Pendolari');
  click('Aggiungi');
  await waitFor(() => expect(screen.queryByLabelText('Nome della categoria')).toBeNull());
  rerender(
    <ExpenseFormModal
      {...p}
      categories={[...catalog, { ...catalog[1], key: 'custom:nuova', name: 'Pendolari' }]}
    />
  );
  change('Descrizione', 'Treno per Milano');
  expect(category().value).toBe('custom:nuova');
  expect(hint()).toBe('');
  change('Importo della spesa', '10');
  fireEvent.click(screen.getByRole('button', { name: /Ripeti automaticamente/ }));
  click('Salva spesa ricorrente');
  await waitFor(() =>
    expect(p.onCreateRecurringWithOptionalFirst).toHaveBeenCalledWith({
      recurring: expect.objectContaining({ category: 'custom:nuova', categoryLabel: 'Pendolari' }),
      firstExpense: expect.objectContaining({
        category: 'custom:nuova',
        categoryLabel: 'Pendolari',
      }),
    })
  );
});

it('in modifica lascia intatta anche una categoria storica nascosta e non suggerisce mentre si corregge il titolo', () => {
  const p = props();
  const editing = { ...ride, id: 'prima', category: 'storica', categoryLabel: 'Storica' };
  render(<ExpenseFormModal {...p} editingExpense={editing} />);
  change('Descrizione', 'Treno per Bologna');
  expect(category().value).toBe('storica');
  expect(hint()).toBe('');
  expect(p.onSaveExpense).not.toHaveBeenCalled();
});
