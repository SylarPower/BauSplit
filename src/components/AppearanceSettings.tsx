import { Moon, Sun } from 'lucide-react';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';

const THEMES = [
  { value: 'light', label: 'Chiaro', note: 'Predefinito', Icon: Sun },
  { value: 'amoled', label: 'AMOLED', note: 'Nero puro', Icon: Moon },
] as const;
type Theme = (typeof THEMES)[number]['value'];
const STORAGE_KEY = 'bausplit:theme'; // letto anche nel bootstrap pre-paint di index.html
const Appearance = createContext<{
  theme: Theme;
  chooseTheme: (theme: Theme) => void;
  remembered: boolean;
} | null>(null);

function savedTheme(): Theme {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'amoled' ? 'amoled' : 'light';
  } catch {
    return 'light';
  }
}

/** Una preferenza del browser, indipendente da gruppi, permessi e sessioni Supabase. */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [remembered, setRemembered] = useState(true);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'amoled' ? '#000000' : '#F8F8F2');
  }, [theme]);

  useEffect(() => {
    function sync(event: StorageEvent) {
      if ((event.key === STORAGE_KEY || event.key === null) && event.storageArea === localStorage) {
        setTheme(savedTheme());
        setRemembered(true);
      }
    }
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  function chooseTheme(next: Theme) {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
      setRemembered(true);
    } catch {
      setRemembered(false); // resta utilizzabile in memoria, anche con storage bloccato
    }
  }

  return (
    <Appearance.Provider value={{ theme, chooseTheme, remembered }}>{children}</Appearance.Provider>
  );
}

export function AppearanceSettings() {
  const preference = useContext(Appearance);
  const name = useId();
  if (!preference) throw new Error('AppearanceSettings richiede AppearanceProvider');

  return (
    <fieldset className="appearance-setting" aria-describedby={`${name}-hint`}>
      <legend className="field-label">Aspetto</legend>
      <div className="theme-options">
        {THEMES.map(({ value, label, note, Icon }) => (
          <label
            className={`theme-option${preference.theme === value ? ' selected' : ''}`}
            key={value}
          >
            <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
            <span>
              <strong>{label}</strong>
              <small>{note}</small>
            </span>
            <input
              type="radio"
              name={name}
              value={value}
              aria-label={label}
              checked={preference.theme === value}
              onChange={() => preference.chooseTheme(value)}
            />
          </label>
        ))}
      </div>
      <p className="field-hint" id={`${name}-hint`} aria-live="polite">
        {preference.remembered
          ? 'La scelta resta in questo browser, anche senza account.'
          : 'Il browser non può salvare la scelta: il tema resta attivo fino al prossimo caricamento.'}
      </p>
    </fieldset>
  );
}
