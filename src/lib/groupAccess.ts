import type { GroupMember, GroupRole } from '../types';

/** I permessi seguono il posto attivo in questo gruppo, non il profilo globale. */
export function groupRoleFor(members: GroupMember[], ownerId: string): GroupRole | undefined {
  return members.find((m) => m.ownerId === ownerId && m.leftAt === null)?.accessRole;
}
