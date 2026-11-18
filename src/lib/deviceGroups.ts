import { SUPABASE_URL } from './supabase';

// Solo segnalibri, mai inviti, importi o credenziali. Il server decide sempre l'accesso.
export interface DeviceGroup {
  id: string;
  name: string;
}
const key = (guestId: string) => `bausplit:${SUPABASE_URL}:groups:${guestId}`;

export function readDeviceGroups(guestId: string): DeviceGroup[] {
  try {
    const list: unknown = JSON.parse(localStorage.getItem(key(guestId)) ?? '[]');
    return Array.isArray(list)
      ? list.filter((g) => g && typeof g.id === 'string' && typeof g.name === 'string')
      : [];
  } catch {
    return [];
  }
}

export function saveDeviceGroups(guestId: string, groups: DeviceGroup[]) {
  try {
    if (!groups.length) localStorage.removeItem(key(guestId));
    else
      localStorage.setItem(
        key(guestId),
        JSON.stringify(groups.map(({ id, name }) => ({ id, name })))
      );
  } catch {
    /* La sessione conserva l'accesso anche se lo spazio dei segnalibri è esaurito. */
  }
}
