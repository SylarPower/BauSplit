import type {
  GroupData,
  GroupOverview,
  MemberBalance,
  QuickEventMatch,
  QuickPersonInput,
  SimplifiedTransfer,
} from '../types';
import { fromMinorUnits, simplifyDebts, toMinorUnits } from './accounting';
import { formatMoney } from './currencies';

interface Contact {
  key: string;
  name: string;
  groups: string[];
  source: NonNullable<QuickPersonInput['source']>;
}

export function quickContacts(groups: GroupOverview[], ownerId: string): Contact[] {
  const found = new Map<string, Contact>();
  // Preferisci come riferimento il posto in un gruppo a due. Non unire mai due omonimi.
  for (const { group, members } of [...groups].sort(
    (a, b) =>
      Number(!!a.group.closedAt) - Number(!!b.group.closedAt) || a.members.length - b.members.length
  )) {
    if (group.quickCreatorSeat || !members.some((m) => m.ownerId === ownerId && !m.leftAt))
      continue;
    for (const m of members) {
      if (m.leftAt || m.ownerId === ownerId) continue;
      const key = m.ownerId ?? `${group.id}:${m.userId}`;
      const hit = found.get(key);
      if (hit) hit.groups.push(group.name);
      else
        found.set(key, {
          key,
          name: m.displayName,
          groups: [group.name],
          source: { groupId: group.id, seatId: m.userId },
        });
    }
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

/** Minimo numero di rimborsi per una tavolata (fino a 12 saldi aperti).
 * Un blocco di k saldi a somma zero si chiude in k−1 pagamenti: cerchiamo
 * l'ordine con più prefissi a somma zero, cioè più blocchi indipendenti.
 * O(n·2^n), senza ricerca esponenziale per comitive grandi. */
export function simplifyEventDebts(
  balances: MemberBalance[],
  currency: string
): SimplifiedTransfer[] {
  const greedy = simplifyDebts(balances, currency);
  const open = balances.filter((b) => toMinorUnits(b.netBalance, currency) !== 0);
  const n = open.length;
  const creditors = open.filter((b) => b.netBalance > 0).length;
  if (n > 12 || greedy.length <= Math.max(creditors, n - creditors)) return greedy;

  const full = (1 << n) - 1;
  const units = open.map((b) => toMinorUnits(b.netBalance, currency));
  const sum = new Float64Array(full + 1);
  const blocks = new Uint8Array(full + 1);
  const last = new Uint8Array(full + 1);
  for (let mask = 1; mask <= full; mask++) {
    const low = mask & -mask;
    sum[mask] = sum[mask ^ low] + units[31 - Math.clz32(low)];
    let best = -1;
    for (let bits = mask; bits; bits &= bits - 1) {
      const bit = bits & -bits;
      if (blocks[mask ^ bit] > best) {
        best = blocks[mask ^ bit];
        last[mask] = 31 - Math.clz32(bit);
      }
    }
    blocks[mask] = best + Number(sum[mask] === 0);
  }
  if (sum[full] !== 0 || n - blocks[full] >= greedy.length) return greedy;
  const plan: SimplifiedTransfer[] = [];
  let block: MemberBalance[] = [];
  for (let mask = full; mask;) {
    const i = last[mask];
    block.push(open[i]);
    mask ^= 1 << i;
    if (sum[mask] === 0) {
      plan.push(...simplifyDebts(block, currency));
      block = [];
    }
  }
  return plan;
}

export function quickTransferTargets(
  creator: string,
  self: string,
  transfers: SimplifiedTransfer[],
  matches: QuickEventMatch[],
  groups: GroupOverview[]
) {
  const t = transfers[0];
  const peer =
    transfers.length !== 1
      ? null
      : t.fromUser === self
        ? t.toUser
        : t.toUser === self
          ? t.fromUser
          : null;
  const ids = new Set(
    matches.filter((row) => row.canCarry && row.peerId === peer).map((row) => row.groupId)
  );
  return {
    eligible:
      self !== creator
        ? []
        : groups.filter(
            (g) =>
              ids.has(g.group.id) &&
              !g.group.closedAt &&
              !g.group.quickCreatorSeat &&
              g.members.length === 2
          ),
    ineligible: [],
    involvedUserIds: Array.from(new Set(transfers.flatMap((t) => [t.fromUser, t.toUser]))),
  };
}

/** Testo destinato alla chat: importi contabili, non valuta di visualizzazione,
 * token, note private, identificativi o dati degli altri gruppi. */
export function quickSummary(
  { group, expenses, settlements }: Pick<GroupData, 'group' | 'expenses' | 'settlements'>,
  transfers: SimplifiedTransfer[]
): string {
  const cur = group.baseCurrency;
  const total = fromMinorUnits(
    expenses.reduce((n, e) => n + toMinorUnits(e.baseAmount, cur), 0),
    cur
  );
  return [
    `BauSplit · ${group.name}`,
    `${expenses.length} ${expenses.length === 1 ? 'spesa' : 'spese'} · Totale ${formatMoney(total, cur)} (${cur})`,
    '',
    ...(transfers.length
      ? [
          'Rimborsi ancora da fare:',
          ...transfers.map((t) => `${t.fromName} → ${t.toName}: ${formatMoney(t.amount, cur)}`),
        ]
      : [
          settlements.some((s) => s.kind === 'transfer_out')
            ? 'Nessun rimborso da fare qui: il saldo residuo è stato riportato.'
            : 'Tutti in pari.',
        ]),
  ].join('\n');
}
