// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { JSDOM } from 'jsdom';
import shell from '../index.html?raw';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppearanceProvider } from '../src/components/AppearanceSettings';
import { ProfileModal } from '../src/components/ProfileModal';
import { Welcome } from '../src/components/Welcome';

vi.mock('../src/lib/supabase', () => ({ translateErrorIT: String }));

const key = 'bausplit:theme';
const chromeColor = () =>
  document.querySelector('meta[name="theme-color"]')?.getAttribute('content');
beforeEach(() => {
  const meta = document.createElement('meta');
  meta.name = 'theme-color';
  document.head.appendChild(meta);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.remove();
});

it.each([
  [null, 'light', '#F8F8F2'],
  ['amoled', 'amoled', '#000000'],
  ['sconosciuto', 'light', '#F8F8F2'],
] as const)(
  'il documento imposta il tema prima del bundle React (valore: %s)',
  (stored, theme, color) => {
    const page = new JSDOM(shell, {
      url: 'https://esempio.test/BauSplit/',
      runScripts: 'dangerously', // esegue solo lo script inline del nostro index.html, senza risorse esterne
      beforeParse(win) {
        if (stored !== null) win.localStorage.setItem(key, stored);
      },
    });
    try {
      const doc = page.window.document;
      expect(doc.querySelector('#root')?.childElementCount).toBe(0);
      expect(doc.documentElement.dataset.theme).toBe(theme);
      expect(doc.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(color);
    } finally {
      page.window.close();
    }
  }
);

function openProfile(isGuest = true) {
  const updateName = vi.fn();
  const result = render(
    <AppearanceProvider>
      <ProfileModal
        open
        profile={{ id: 'p', displayName: 'Sara', email: '', createdAt: '' }}
        isGuest={isGuest}
        onClose={vi.fn()}
        onUpdateName={updateName}
        onSignOut={vi.fn()}
        onOpenAccount={vi.fn()}
        onToast={vi.fn()}
      />
    </AppearanceProvider>
  );
  return {
    ...result,
    updateName,
    appearance: within(screen.getByRole('group', { name: 'Aspetto' })),
  };
}

it.each([true, false])(
  'dal profilo (ospite: %s) il tema cambia subito e sopravvive alla riapertura',
  (isGuest) => {
    const { appearance, updateName, unmount } = openProfile(isGuest);
    expect(appearance.getByRole('radio', { name: 'Chiaro', checked: true })).toBeTruthy();
    expect(localStorage.getItem(key)).toBeNull();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    fireEvent.click(appearance.getByRole('radio', { name: 'AMOLED' }));
    expect(document.documentElement.dataset.theme).toBe('amoled');
    expect(chromeColor()).toBe('#000000');
    expect(writes.mock.calls).toEqual([[key, 'amoled']]);
    expect(updateName).not.toHaveBeenCalled();
    unmount();

    const next = openProfile(isGuest).appearance;
    expect(next.getByRole('radio', { name: 'AMOLED', checked: true })).toBeTruthy();
    fireEvent.click(next.getByRole('radio', { name: 'Chiaro' }));
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(chromeColor()).toBe('#F8F8F2');
    expect(localStorage.getItem(key)).toBe('light');
  }
);

it('un valore sconosciuto non attiva AMOLED; le scelte delle altre schede si applicano senza riscriverle', () => {
  localStorage.setItem(key, 'sistema');
  const { appearance } = openProfile();
  expect(document.documentElement.dataset.theme).toBe('light');
  localStorage.setItem(key, 'amoled');
  const writes = vi.spyOn(Storage.prototype, 'setItem');
  const notify = (key: string | null) =>
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key, storageArea: localStorage }));
    });
  notify(key);
  expect(appearance.getByRole('radio', { name: 'AMOLED', checked: true })).toBeTruthy();
  localStorage.clear();
  notify(null);
  expect(appearance.getByRole('radio', { name: 'Chiaro', checked: true })).toBeTruthy();
  expect(writes).not.toHaveBeenCalled();
});

it('con storage bloccato parte in chiaro e si può cambiare tema per la sessione corrente', () => {
  const denied = () => {
    throw new DOMException('Bloccato', 'SecurityError');
  };
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(denied);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(denied);
  const { appearance } = openProfile();
  expect(document.documentElement.dataset.theme).toBe('light');
  fireEvent.click(appearance.getByRole('radio', { name: 'AMOLED' }));
  expect(document.documentElement.dataset.theme).toBe('amoled');
  expect(appearance.getByText(/non può salvare la scelta/)).toBeTruthy();
});

it('la copertina rispetta il tema anche prima dell’accesso e la didascalia non contiene numero o separatore', () => {
  localStorage.setItem(key, 'amoled');
  render(
    <AppearanceProvider>
      <Welcome hasInvite={false} onAccount={vi.fn()} />
    </AppearanceProvider>
  );
  const figure = screen.getByRole('figure');
  expect(figure.querySelector('figcaption')?.textContent?.trim()).toBe('IL COMPAGNO DI CONTI');
  expect(within(figure).getByRole('img', { name: /terrier/ })).toBeTruthy();
  expect(document.documentElement.dataset.theme).toBe('amoled');
});
