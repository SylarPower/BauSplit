import { Check } from 'lucide-react';
import { useId } from 'react';
import { CUSTOM_CATEGORY_ICONS } from '../lib/categories';
import { CategoryIcon } from './Icon';

export function CategoryIconPicker({
  value,
  color,
  onChange,
  disabled = false,
  savedIcon,
}: {
  value: string;
  color: string;
  onChange: (icon: string) => void;
  disabled?: boolean;
  savedIcon?: string;
}) {
  const groupName = useId();
  // Anche un'icona storica fuori catalogo resta selezionabile durante la modifica.
  const options =
    savedIcon && !CUSTOM_CATEGORY_ICONS.some(({ id }) => id === savedIcon)
      ? [{ id: savedIcon, label: 'Icona salvata' }, ...CUSTOM_CATEGORY_ICONS]
      : CUSTOM_CATEGORY_ICONS;

  return (
    <fieldset className="category-picker" disabled={disabled}>
      <legend className="field-label icon-picker-heading">
        Icona della categoria
        <span className="icon-picker-preview" aria-hidden="true">
          <CategoryIcon icon={value} color={color} size={16} boxed />
          {options.find(({ id }) => id === value)?.label}
        </span>
      </legend>
      <div className="swatch-row">
        {options.map(({ id, label }) => (
          <label className="icon-swatch" key={id} title={label}>
            <input
              type="radio"
              name={groupName}
              aria-label={label}
              value={id}
              checked={value === id}
              onChange={() => onChange(id)}
            />
            <span aria-hidden="true">
              <CategoryIcon icon={id} color="currentColor" size={20} />
            </span>
            {value === id && (
              <Check className="icon-swatch-check" size={12} strokeWidth={3} aria-hidden="true" />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
