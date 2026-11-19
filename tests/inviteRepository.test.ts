import { createClient } from '@supabase/supabase-js';
import { expect, it, vi } from 'vitest';
import { SupabaseRepository } from '../src/lib/repository';

// Le letture ordinarie non richiedono segreti. Il fallback per le installazioni
// non migrate è ammesso solo per una RPC mancante, mai per un permesso negato.
function setup(responses: [number, unknown][]) {
  const calls: { path: string; payload: unknown }[] = [];
  const fetch = vi.fn(async (input, init) => {
    calls.push({
      path: new URL(String(input)).pathname,
      payload: init?.body && JSON.parse(String(init.body)),
    });
    const [status, body] = responses.shift()!;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const repo = new SupabaseRepository(
    createClient('https://bausplit.example.test', 'public-test', {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch },
    })
  );
  return { repo, calls };
}

it('mappa i link separati, il tipo di invito e il permesso effettivo; l’accettazione passa solo token e scelta del posto', async () => {
  const { repo, calls } = setup([
    [
      200,
      [
        { access_role: 'viewer', token: 'lettura', enabled: true },
        { access_role: 'editor', token: 'scrittura', enabled: false },
      ],
    ],
    [
      200,
      {
        valid: true,
        group_id: 'casa',
        invite_role: 'viewer',
        access_role: 'editor',
        already_member: true,
      },
    ],
    [200, 'casa'],
    [200, 'nuovo'],
    [200, false],
  ]);
  expect(await repo.getGroupInvites('casa')).toEqual([
    { role: 'viewer', token: 'lettura', enabled: true },
    { role: 'editor', token: 'scrittura', enabled: false },
  ]);
  expect(await repo.getInvitePreview('lettura')).toMatchObject({
    inviteRole: 'viewer',
    accessRole: 'editor',
    alreadyMember: true,
  });
  await repo.acceptInvite('lettura', { memberId: 's' });
  await repo.regenerateInvite('casa', 'viewer');
  await repo.setInviteEnabled('casa', false, 'viewer');
  expect(calls.map((c) => c.payload)).toEqual([
    { p_group_id: 'casa' },
    { p_token: 'lettura' },
    { p_token: 'lettura', p_member_id: 's', p_name: null },
    { p_group_id: 'casa', p_role: 'viewer' },
    { p_group_id: 'casa', p_enabled: false, p_role: 'viewer' },
  ]);
});

it('solo la RPC mancante permette di leggere il vecchio link, soltanto con modifica', async () => {
  const legacy = setup([
    [404, { code: 'PGRST202', message: 'Function missing' }],
    [200, { invite_token: 'precedente', invite_enabled: true }],
  ]);
  expect(await legacy.repo.getGroupInvites('casa')).toEqual([
    { role: 'editor', token: 'precedente', enabled: true },
  ]);
  const denied = setup([[403, { code: '42501', message: 'Non puoi gestire gli inviti' }]]);
  await expect(denied.repo.getGroupInvites('casa')).rejects.toMatchObject({ code: '42501' });
  expect(denied.calls.map((c) => c.path)).toEqual(['/rest/v1/rpc/get_group_invites']);
});
