import { ArrowDown, ArrowUp, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { CUSTOM_CATEGORY_COLORS, CUSTOM_CATEGORY_ICONS } from '../lib/categories';
import { translateErrorIT } from '../lib/supabase';
import type { CategoryOption, CategoryPatch } from '../types';
import { CategoryIcon } from './Icon';

export interface CategoryManagerProps {
  categories: CategoryOption[];
  onSaveCategory: (key: string | null, patch: CategoryPatch) => Promise<string>;
  onMoveCategory: (key: string, step: -1 | 1) => Promise<void>;
  onDeleteCategory: (key: string) => Promise<void>;
  onToast: (msg: string, isError?: boolean) => void;
}

export function CategoryManager({
  categories,
  onSaveCategory,
  onMoveCategory,
  onDeleteCategory,
  onToast,
}: CategoryManagerProps) {
  // undefined: elenco; null: aggiunta; categoria: modifica dei soli campi toccati.
  const [editing, setEditing] = useState<CategoryOption | null>();
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setBusy(true);
    try {
      await action();
      setEditing(undefined);
      onToast(message);
    } catch (err) {
      onToast(translateErrorIT(err), true);
    } finally {
      setBusy(false);
    }
  };

  const editor = editing !== undefined && (
    <CategoryEditor
      key={editing?.key ?? 'new'}
      initial={editing}
      busy={busy}
      onCancel={() => setEditing(undefined)}
      onSave={(patch) =>
        run(
          () => onSaveCategory(editing?.key ?? null, patch),
          editing ? 'Categoria aggiornata' : 'Categoria aggiunta'
        )
      }
      onDelete={
        editing?.key.startsWith('custom:')
          ? () => run(() => onDeleteCategory(editing.key), 'Categoria eliminata')
          : undefined
      }
    />
  );

  return (
    <details className="category-panel">
      <summary>
        <span>
          <strong>Categorie del gruppo</strong>
          <small>Modifica nomi, aspetto e ordine</small>
        </span>
        <ChevronDown size={17} aria-hidden="true" />
      </summary>
      <div className="form-stack">
        <div className="category-manager-heading">
          <span className="field-hint">{categories.length} categorie</span>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            <Plus size={14} /> Nuova categoria
          </button>
        </div>
        <p className="field-hint">
          Anche le categorie predefinite si possono modificare. Il nuovo nome compare su tutte le
          spese del gruppo, comprese quelle passate.
        </p>
        {editing === null && editor}
        <ol className="category-manager-list">
          {categories.map((c, i) => (
            <li key={c.key}>
              <div className="category-manager-row">
                <CategoryIcon icon={c.icon} color={c.color} size={16} boxed />
                <span className="category-manager-name">
                  {c.name}
                  {c.hidden && <small>Nascosta</small>}
                </span>
                <div className="category-manager-actions">
                  {([-1, 1] as const).map((step) => {
                    const label = `Sposta ${c.name} ${step === -1 ? 'su' : 'giù'}`;
                    return (
                      <button
                        key={step}
                        type="button"
                        className="btn-icon"
                        title={label}
                        aria-label={label}
                        disabled={busy || (step === -1 ? i === 0 : i === categories.length - 1)}
                        onClick={() =>
                          run(
                            () => onMoveCategory(c.key, step),
                            'Ordine delle categorie aggiornato'
                          )
                        }
                      >
                        {step === -1 ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    className="btn-icon"
                    title={`Modifica ${c.name}`}
                    aria-label={`Modifica ${c.name}`}
                    aria-expanded={editing?.key === c.key}
                    disabled={busy}
                    onClick={() => setEditing(c)}
                  >
                    <Pencil size={15} />
                  </button>
                </div>
              </div>
              {editing?.key === c.key && editor}
            </li>
          ))}
        </ol>
      </div>
    </details>
  );
}

function CategoryEditor({
  initial,
  busy,
  onSave,
  onCancel,
  onDelete,
}: {
  initial: CategoryOption | null;
  busy: boolean;
  onSave: (patch: CategoryPatch) => Promise<void>;
  onCancel: () => void;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [icon, setIcon] = useState(initial?.icon ?? 'tag');
  const [color, setColor] = useState(initial?.color ?? CUSTOM_CATEGORY_COLORS[0]);
  const [hidden, setHidden] = useState(initial?.hidden ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const patch: CategoryPatch = {};
  if (name.trim() !== initial?.name) patch.name = name.trim();
  if (icon !== initial?.icon) patch.icon = icon;
  if (color !== initial?.color) patch.color = color;
  if (initial && hidden !== initial.hidden) patch.hidden = hidden;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!busy && name.trim()) void onSave(patch);
  };
  return (
    <form
      className="fx-box category-editor"
      onSubmit={submit}
      aria-label={initial ? `Modifica categoria ${initial.name}` : 'Nuova categoria'}
    >
      <label className="field">
        <span className="field-label">Nome della categoria</span>
        <input
          className="input input-sm"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
      </label>
      <div className="category-appearance">
        <CategoryIcon icon={icon} color={color} boxed />
        <label className="field">
          <span className="field-label">Icona</span>
          <select
            className="select select-sm"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
          >
            {CUSTOM_CATEGORY_ICONS.map((i) => (
              <option key={i.id} value={i.id}>
                {i.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Colore</span>
          <input
            type="color"
            className="category-color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
          />
        </label>
      </div>
      {initial && (
        <label className="category-visibility">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          <span>
            Nascondi dalle nuove spese
            <small className="field-hint">
              Le spese passate restano visibili e le ricorrenze continuano a usarla.
            </small>
          </span>
        </label>
      )}
      <div className="category-editor-buttons">
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || !name.trim() || !Object.keys(patch).length}
        >
          {busy ? 'Attendi…' : initial ? 'Salva categoria' : 'Aggiungi categoria'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={onCancel}>
          Annulla
        </button>
        {onDelete && (
          <button
            type="button"
            className="btn-icon"
            aria-label="Elimina categoria"
            title="Elimina categoria"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={15} />
          </button>
        )}
      </div>
      {confirmDelete && onDelete && (
        <div className="category-editor-buttons alert alert-warning">
          <span>Eliminare questa categoria? Se è già usata puoi solo nasconderla.</span>
          <button
            type="button"
            className="btn btn-danger-solid btn-sm"
            disabled={busy}
            onClick={onDelete}
          >
            Conferma eliminazione
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={busy}
            onClick={() => setConfirmDelete(false)}
          >
            Mantieni
          </button>
        </div>
      )}
    </form>
  );
}
