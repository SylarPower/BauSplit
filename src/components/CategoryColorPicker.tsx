import { Check } from 'lucide-react';
import { useId } from 'react';
import { CATEGORY_COLOR_PRESETS } from '../lib/categories';

export function CategoryColorPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (color: string) => void;
  disabled?: boolean;
}) {
  const groupName = useId();
  const hexValue = value.toUpperCase();
  const selected = CATEGORY_COLOR_PRESETS.find(({ hex }) => hex.toUpperCase() === hexValue);

  return (
    <fieldset className="category-picker" disabled={disabled}>
      <legend className="field-label">Colore della categoria</legend>
      <div className="swatch-row">
        {CATEGORY_COLOR_PRESETS.map(({ label, hex }) => (
          <label key={hex} className="color-swatch" title={label}>
            <input
              type="radio"
              name={groupName}
              aria-label={label}
              value={hex}
              checked={selected?.hex === hex}
              style={{ backgroundColor: hex }}
              onChange={() => onChange(hex)}
            />
            {selected?.hex === hex && <Check size={16} strokeWidth={3} aria-hidden="true" />}
          </label>
        ))}
      </div>
      <div className="category-color-tools">
        <label className="category-custom-color">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
          Colore personalizzato
        </label>
        <span className="tabular">
          {selected?.label ?? 'Personalizzato'} · {hexValue}
        </span>
      </div>
    </fieldset>
  );
}
