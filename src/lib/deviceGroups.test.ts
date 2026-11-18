import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readDeviceGroups, saveDeviceGroups } from './deviceGroups';

beforeEach(() => {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

it('ricorda soltanto id e nome del gruppo, separatamente per ospite; riconcilia anche uscite e collegamento', () => {
  const group = { id: 'casa', name: 'Casa', inviteToken: 'non-salvare', balance: 12 };
  saveDeviceGroups('anna', [group]);
  expect(readDeviceGroups('anna')).toEqual([{ id: 'casa', name: 'Casa' }]);
  expect(readDeviceGroups('nina')).toEqual([]);
  saveDeviceGroups('nina', [{ id: 'mare', name: 'Mare' }]);
  saveDeviceGroups('anna', []);
  expect(readDeviceGroups('anna')).toEqual([]);
  expect(readDeviceGroups('nina')).toHaveLength(1);
});
