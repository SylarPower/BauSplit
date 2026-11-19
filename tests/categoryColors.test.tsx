// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CategoryManager } from '../src/components/CategoryManager';
import { ExpenseFormModal } from '../src/components/ExpenseFormModal';
import type { CategoryOption } from '../src/types';

vi.mock('../src/lib/supabase', () => ({ translateErrorIT: String }));
afterEach(cleanup);

const catalog: CategoryOption[] = [
  { key: 'spesa', name: 'Spesa', icon: 'shopping-basket', color: '#0F766E', hidden: false },
  { key: 'custom:libri', name: 'Libri', icon: 'book-open', color: '#1976d2', hidden: false },
];
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const change = (label: string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

function openSettingsEditor(action: string) {
  const save = vi.fn().mockResolvedValue('custom:nuova');
  render(
    <CategoryManager
      categories={catalog}
      onSaveCategory={save}
      onMoveCategory={vi.fn()}
      onDeleteCategory={vi.fn()}
      onToast={vi.fn()}
    />
  );
  fireEvent.click(screen.getByText('Categorie del gruppo'));
  click(action);
  return save;
}

function colorControls() {
  const group = within(screen.getByRole('group', { name: 'Colore della categoria' }));
  const presets = group.getAllByRole<HTMLInputElement>('radio', { name: /\S/ });
  expect(presets).toHaveLength(10);
  expect(new Set(presets.map((r) => r.value.toUpperCase())).size).toBe(10);
  const picker = group.getByLabelText<HTMLInputElement>('Colore personalizzato');
  expect(picker.type).toBe('color');
  return { group, picker };
}

it('nelle impostazioni apre il colore storico, anche fuori palette, e salva il nuovo preset senza altri cambiamenti', async () => {
  const save = openSettingsEditor('Modifica Spesa');
  const { group, picker } = colorControls();
  expect(picker.value).toBe('#0f766e');
  expect(group.queryByRole('radio', { checked: true })).toBeNull();
  fireEvent.click(group.getByRole('radio', { name: 'Viola' }));
  expect(picker.value).toBe('#7b1fa2');
  click('Salva categoria');
  await waitFor(() => expect(save).toHaveBeenCalledWith('spesa', { color: '#7B1FA2' }));
});

it('nelle impostazioni crea una categoria con un colore libero invece di un preset', async () => {
  const save = openSettingsEditor('Nuova categoria');
  const { group, picker } = colorControls();
  expect(group.getByRole<HTMLInputElement>('radio', { checked: true }).value.toLowerCase()).toBe(
    picker.value
  );
  change('Nome della categoria', 'Teatro');
  change('Colore personalizzato', '#a104ef');
  expect(group.queryByRole('radio', { checked: true })).toBeNull();
  click('Aggiungi categoria');
  await waitFor(() =>
    expect(save).toHaveBeenCalledWith(null, { name: 'Teatro', icon: 'tag', color: '#a104ef' })
  );
});

it('riconosce il colore di una categoria personalizzata senza distinguere maiuscole: ritornare al preset non lo riscrive', async () => {
  const save = openSettingsEditor('Modifica Libri');
  const { group } = colorControls();
  const blue = group.getByRole('radio', { name: 'Blu', checked: true });
  change('Colore personalizzato', '#335577');
  fireEvent.click(blue);
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Salva categoria' }).disabled).toBe(
    true
  );
  change('Nome della categoria', 'Letture');
  click('Salva categoria');
  await waitFor(() => expect(save).toHaveBeenCalledWith('custom:libri', { name: 'Letture' }));
});

it.each([
  ['predefinito', '#F57C00'],
  ['personalizzato', '#f0cafe'],
])(
  'dalla spesa aggiunge e seleziona la categoria con il colore %s senza inviare la spesa',
  async (kind, color) => {
    const create = vi.fn().mockResolvedValue('custom:nuova');
    const props = {
      open: true,
      onClose: vi.fn(),
      groupId: 'g',
      baseCurrency: 'EUR',
      members: [
        { userId: 'a', accessRole: 'editor' as const, ownerId: 'a', displayName: 'Anna', joinedAt: '2026-01-01', leftAt: null },
      ],
      currentUserId: 'a',
      categories: catalog,
      editingExpense: null,
      onSaveExpense: vi.fn(),
      onCreateRecurringWithOptionalFirst: vi.fn(),
      onAddCustomCategory: create,
      onToast: vi.fn(),
    };
    const { rerender } = render(<ExpenseFormModal {...props} />);
    change('Descrizione', 'Corso');
    change('Importo della spesa', '10');
    click('Nuova');
    change('Nome della categoria', 'Lingue');
    const icons = within(screen.getByRole('group', { name: 'Icona della categoria' }));
    fireEvent.click(icons.getByRole('radio', { name: 'Libri e studio' }));
    const { group, picker } = colorControls();
    fireEvent.click(group.getByRole('radio', { name: 'Arancione' }));
    if (kind === 'personalizzato') {
      change('Colore personalizzato', color);
      expect(group.queryByRole('radio', { checked: true })).toBeNull();
    }
    expect(picker.value).toBe(color.toLowerCase());
    expect(icons.getByRole('radio', { name: 'Libri e studio', checked: true })).toBeTruthy();
    click('Aggiungi');
    await waitFor(() => expect(screen.queryByLabelText('Nome della categoria')).toBeNull());
    const created = { name: 'Lingue', icon: 'book-open', color };
    expect(create).toHaveBeenCalledWith(created);
    rerender(
      <ExpenseFormModal
        {...props}
        categories={[...catalog, { ...created, key: 'custom:nuova', hidden: false }]}
      />
    );
    expect(screen.getByLabelText<HTMLSelectElement>('Categoria').value).toBe('custom:nuova');
    expect(screen.getByLabelText<HTMLInputElement>('Descrizione').value).toBe('Corso');
    expect(props.onSaveExpense).not.toHaveBeenCalled();
  }
);
