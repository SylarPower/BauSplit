import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// PostgreSQL isolato, non usa il progetto online. I ruoli simulano soltanto la sessione Supabase.
const schema = readFileSync(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
let guest: string, friend: string, account: string, outsider: string;
let db: PGlite;
async function as(id: string) {
  await db.exec('set role authenticated');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
}
async function first<T>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows[0];
}
const createGroup = (name: string, participants: string[] = []) =>
  first<{ id: string; invite_token: string }>(
    "select * from create_expense_group($1,'','EUR',$2)",
    [name, participants]
  );
const member = (id: string, owner: string) =>
  first<{ user_id: string; left_at: string | null }>(
    'select * from group_members where group_id=$1 and owner_id=$2',
    [id, owner]
  );
const preview = async (token: string) =>
  (
    await first<{
      p: {
        valid: boolean;
        already_member: boolean;
        reason?: string;
        available_names: { id: string; name: string }[];
      };
    }>('select get_invite_preview($1) p', [token])
  ).p;
const join = (token: string, slot: string | null, name: string | null = null) =>
  db.query('select accept_group_invite($1,$2,$3)', [token, slot, name]);
const countGroups = async (id: string) =>
  (await db.query('select id from expense_groups where id=$1', [id])).rows.length;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated;
    create schema auth; grant usage on schema auth to anon, authenticated;
    create table auth.users(id uuid primary key, email text, email_confirmed_at timestamptz, is_anonymous boolean, raw_user_meta_data jsonb);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create publication supabase_realtime;`);
  await db.exec(schema);
}, 30000);
beforeEach(async () => {
  [guest, friend, account, outsider] = Array.from({ length: 4 }, () => crypto.randomUUID());
  await db.exec('reset role');
  await db.query(
    `insert into auth.users values
    ($1,'',null,true,'{"display_name":"Anna"}'), ($2,null,null,true,'{}'),
    ($3,'anna@example.test',now(),false,'{"display_name":"Anna L."}'), ($4,'mira@example.test',now(),false,'{}')`,
    [guest, friend, account, outsider]
  );
}, 30000);
afterAll(() => db?.close());

describe('Gruppi BauSplit su PostgreSQL con accessi distinti', () => {
  it('conserva i posti liberi al secondo Run. Vedere o rifiutare l’invito non permette di leggere le spese', async () => {
    await as(guest);
    const group = await createGroup('Viaggio', ['Giò']);
    const me = await member(group.id, guest);
    const slot = (await preview(group.invite_token)).available_names[0];
    expect(slot.name).toBe('Giò');
    await db.query(
      `select save_expense($1,null,'Treno',20,'USD',0.9,'2026-11-10',true,18,'2026-11-10','viaggi','Viaggi',$2,'equal','',$3,'created','Treno')`,
      [
        group.id,
        me.user_id,
        JSON.stringify(
          [me.user_id, slot.id].map((user_id) => ({ user_id, amount: 10, base_amount: 9 }))
        ),
      ]
    );
    await db.exec('reset role');
    await db.exec(schema);
    await as(friend);
    expect((await preview(group.invite_token)).already_member).toBe(false);
    expect(await countGroups(group.id)).toBe(0);
    expect((await db.query('select * from expenses where group_id=$1', [group.id])).rows).toEqual(
      []
    );
    await join(group.invite_token, slot.id);
    expect((await member(group.id, friend)).user_id).toBe(slot.id);
    expect(
      await first('select user_id,base_amount from expense_splits where user_id=$1', [slot.id])
    ).toEqual({ user_id: slot.id, base_amount: '9.00' });
    await as(outsider);
    await expect(join(group.invite_token, slot.id)).rejects.toThrow(/più disponibile/);
    await expect(join(group.invite_token, null, 'Giò')).rejects.toThrow(/già presente/);
    await as(guest);
    await db.query('select set_group_invite_enabled($1,false)', [group.id]);
    await as(outsider);
    expect((await preview(group.invite_token)).reason).toBe('disabled');
    await expect(join(group.invite_token, null, 'Mira')).rejects.toThrow(/disattivato/);
  });

  it('trasferisce fra posti diversi della stessa persona, non fra omonimi; conserva uscita a saldo aperto, saldi e cambio', async () => {
    await as(guest);
    const source = await createGroup('Vacanza', ['Giò']);
    const target = await createGroup('Casa', ['Giò']);
    const a1 = await member(source.id, guest),
      a2 = await member(target.id, guest);
    const b1 = (await preview(source.invite_token)).available_names[0],
      b2 = (await preview(target.invite_token)).available_names[0];
    await as(friend);
    await join(source.invite_token, b1.id);
    await db.query(
      `select save_expense($1,null,'Cena',10,'EUR',1,current_date,false,10,current_date,'altro','Altro',$2,'equal','',$3,'created','Cena')`,
      [
        source.id,
        a1.user_id,
        JSON.stringify(
          [a1.user_id, b1.id].map((user_id) => ({ user_id, amount: 5, base_amount: 5 }))
        ),
      ]
    );
    await db.query('select leave_group($1)', [source.id]);
    expect(await countGroups(source.id)).toBe(0);
    await as(guest);
    const carry = () =>
      db.query('select close_expense_group($1,$2,$3)', [
        source.id,
        target.id,
        JSON.stringify([
          { from_user: b1.id, to_user: a1.user_id, source_amount: 5, target_amount: 5 },
        ]),
      ]);
    await expect(carry()).rejects.toThrow(/devono far parte/);
    await as(friend);
    await join(target.invite_token, b2.id);
    await as(guest);
    await expect(
      db.query('select close_expense_group($1,$2,$3)', [
        source.id,
        target.id,
        JSON.stringify([
          { from_user: b1.id, to_user: a1.user_id, source_amount: 4, target_amount: 4 },
        ]),
      ])
    ).rejects.toThrow(/saldi sono cambiati/);
    expect(
      (await db.query('select * from settlements where group_id=$1', [target.id])).rows
    ).toHaveLength(0);
    await carry();
    expect(
      await first(
        "select from_user,to_user,base_amount from settlements where group_id=$1 and kind='transfer_in'",
        [target.id]
      )
    ).toEqual({ from_user: a2.user_id, to_user: b2.id, base_amount: '5.00' });
    expect((await preview(source.invite_token)).reason).toBe('closed');
  });

  it('collega solo con il consenso dei due accessi e non riscrive quote, attori o posti già occupati', async () => {
    await as(guest);
    const local = await createGroup('Solo dispositivo', ['Nina']);
    const both = await createGroup('Già in comune');
    const seat = await member(local.id, guest);
    await as(account);
    await join(both.invite_token, null, 'Account');
    await expect(db.query('select link_guest_groups($1)', [guest])).rejects.toThrow(/autorizzato/);
    await as(guest);
    await db.query('select authorize_guest_link($1)', [account]);
    await as(outsider);
    await expect(db.query('select link_guest_groups($1)', [guest])).rejects.toThrow(/autorizzato/);
    await as(account);
    await db.query('select link_guest_groups($1)', [guest]);
    await db.query('select link_guest_groups($1)', [guest]); // riprova dopo una risposta persa
    expect((await member(local.id, account)).user_id).toBe(seat.user_id);
    expect((await preview(local.invite_token)).available_names.map((p) => p.name)).toEqual([
      'Nina',
    ]);
    expect(
      await first(
        "select actor_id, actor_name from activity_logs where group_id=$1 and entity_type='group' and action='created'",
        [local.id]
      )
    ).toEqual({ actor_id: guest, actor_name: 'Anna' });
    expect(
      (
        await db.query('select * from group_members where group_id=$1 and left_at is null', [
          both.id,
        ])
      ).rows
    ).toHaveLength(1);
    await as(guest);
    expect(await countGroups(local.id)).toBe(0);
    expect(await countGroups(both.id)).toBe(0);
    await expect(createGroup('Vecchia scheda')).rejects.toThrow(/già collegati/);
  });

  it('ritrova anche i gruppi chiusi, non riattiva quelli lasciati, mantiene il posto attivo se l’account era uscito', async () => {
    await as(guest);
    const closed = await createGroup('Archivio');
    await db.query('select close_expense_group($1)', [closed.id]);
    const left = await createGroup('Lasciato', ['Nina']);
    await db.query('select leave_group($1)', [left.id]);
    const active = await createGroup('Attivo');
    const seat = await member(active.id, guest);
    await as(account);
    await join(active.invite_token, null, 'Nome precedente');
    await db.query('select leave_group($1)', [active.id]);
    await as(guest);
    await db.query('select authorize_guest_link($1)', [account]);
    await as(account);
    await db.query('select link_guest_groups($1)', [guest]);
    expect(await countGroups(closed.id)).toBe(1);
    expect(await countGroups(left.id)).toBe(0);
    expect(await member(active.id, account)).toMatchObject({
      user_id: seat.user_id,
      left_at: null,
    });
  });
});

const catalog = async (group: string) =>
  (
    await db.query<{ key: string; name: string; hidden: boolean }>(
      'select * from get_group_categories($1)',
      [group]
    )
  ).rows;
const saveCategory = async (
  group: string,
  key: string | null,
  name: string | null,
  hidden: boolean | null = null
) =>
  (
    await first<{ key: string }>('select save_group_category($1,$2,$3,p_hidden => $4) as key', [
      group,
      key,
      name,
      hidden,
    ])
  ).key;

describe('Catalogo categorie del gruppo', () => {
  it('rinomina per chiave, conserva dati e storico e sincronizza ordine e visibilità anche dopo un secondo Run', async () => {
    await as(guest);
    const a = await createGroup('Giappone');
    const b = await createGroup('Casa');
    const me = await member(a.id, guest);
    const original = await catalog(a.id);
    expect(original.map((c) => c.name)).toEqual([
      'Spesa alimentare',
      'Ristoranti e bar',
      'Casa e affitto',
      'Bollette e utenze',
      'Trasporti e auto',
      'Viaggi e alloggi',
      'Svago e cultura',
      'Shopping',
      'Salute e benessere',
      'Abbonamenti',
      'Regali',
      'Altro',
    ]);
    const custom = await saveCategory(a.id, null, 'Animali');
    expect(custom).toMatch(/^custom:/);
    await db.query(
      `select save_expense($1,null,'Mercato',16000,'JPY',0.00625,'2026-09-01',true,100,'2026-09-01',
      'spesa','Spesa alimentare',$2,'equal','',$3,'created','Spesa registrata','{"snapshot":{"Categoria":"Spesa alimentare"}}')`,
      [a.id, me.user_id, JSON.stringify([{ user_id: me.user_id, amount: 16000, base_amount: 100 }])]
    );
    await db.query(
      `insert into recurring_expenses(group_id,description,amount,currency,category,category_label,paid_by,split_mode,splits,
      frequency,start_date,next_due_date,created_by,updated_by) values ($1,'Crocchette',10,'EUR',$2,'Animali',$3,'equal','[]','monthly',current_date,current_date,$4,$4)`,
      [a.id, custom, me.user_id, guest]
    );

    await as(friend);
    await join(a.invite_token, null, 'Mira');
    await db.query("select save_group_category($1,'spesa','Dispensa','home','#BE185D',true)", [
      a.id,
    ]);
    await saveCategory(a.id, custom, 'Gatto');
    await db.query('select move_group_category($1,$2,1)', [a.id, 'spesa']);
    await db.exec('reset role');
    await db.exec(schema);
    await as(guest);
    const updated = await catalog(a.id);
    expect(updated[1]).toEqual({
      key: 'spesa',
      name: 'Dispensa',
      icon: 'home',
      color: '#BE185D',
      hidden: true,
    });
    expect(updated.find((c) => c.key === custom)?.name).toBe('Gatto');
    expect(await catalog(b.id)).toEqual(original);
    expect(
      await first(
        'select category,category_label,amount,base_amount,exchange_rate from expenses where group_id=$1',
        [a.id]
      )
    ).toEqual({
      category: 'spesa',
      category_label: 'Spesa alimentare',
      amount: '16000.00',
      base_amount: '100.00',
      exchange_rate: '0.00625000',
    });
    expect(
      await first('select category,category_label from recurring_expenses where group_id=$1', [
        a.id,
      ])
    ).toEqual({ category: custom, category_label: 'Animali' });
    expect(
      await first(
        "select changes->'snapshot'->>'Categoria' as label from activity_logs where group_id=$1 and entity_type='expense'",
        [a.id]
      )
    ).toEqual({ label: 'Spesa alimentare' });
    expect(
      await first(
        "select actor_id,summary from activity_logs where group_id=$1 and summary like '%Dispensa%'",
        [a.id]
      )
    ).toEqual({
      actor_id: friend,
      summary: 'Ha rinominato la categoria "Spesa alimentare" in "Dispensa"',
    });
    await expect(db.query('select delete_group_category($1,$2)', [a.id, custom])).rejects.toThrow(
      /nasconderla/
    );
    await saveCategory(a.id, 'spesa', null, false);
    expect((await catalog(a.id))[1]).toMatchObject({ name: 'Dispensa', hidden: false });
  });

  it('controlla accesso, gruppo chiuso, chiavi, duplicati e ultima categoria visibile', async () => {
    await as(guest);
    const a = await createGroup('Uno');
    const b = await createGroup('Due');
    const custom = await saveCategory(a.id, null, 'Nuoto');
    await expect(saveCategory(b.id, custom, 'Altrove')).rejects.toThrow(/non trovata/);
    await expect(saveCategory(a.id, null, '  shopping  ')).rejects.toThrow(/già una categoria/);
    await expect(saveCategory(a.id, custom, 'Regali')).rejects.toThrow(/già una categoria/);
    await expect(saveCategory(a.id, 'altro', ' ')).rejects.toThrow(/nome/);
    for (const c of await catalog(a.id))
      if (c.key !== custom) await saveCategory(a.id, c.key, null, true);
    await expect(saveCategory(a.id, custom, null, true)).rejects.toThrow(/almeno una/);
    await expect(db.query('select delete_group_category($1,$2)', [a.id, custom])).rejects.toThrow(
      /almeno una/
    );
    await saveCategory(a.id, 'altro', null, false);
    await db.query('select delete_group_category($1,$2)', [a.id, custom]);
    expect((await catalog(a.id)).some((c) => c.key === custom)).toBe(false);
    await as(outsider);
    expect(await catalog(a.id)).toEqual([]);
    await expect(saveCategory(a.id, 'altro', 'Mio')).rejects.toThrow(/Accesso/);
    await expect(db.query('select move_group_category($1,$2,1)', [a.id, 'altro'])).rejects.toThrow(
      /Accesso/
    );
    await as(guest);
    await db.query('select close_expense_group($1)', [a.id]);
    expect(await catalog(a.id)).toHaveLength(12);
    await expect(saveCategory(a.id, null, 'Pulizie')).rejects.toThrow(/chiuso/);
    await expect(saveCategory(a.id, 'altro', 'Mio')).rejects.toThrow(/chiuso/);
  });
});
