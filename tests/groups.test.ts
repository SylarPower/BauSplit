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
      'Spesa',
      'Ristoranti e bar',
      'Casa',
      'Trasporti',
      'Viaggi',
      'Svago',
      'Shopping',
      'Salute',
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
      summary: 'Ha rinominato la categoria "Spesa" in "Dispensa"',
    });
    await expect(db.query('select delete_group_category($1,$2)', [a.id, custom])).rejects.toThrow(
      /nasconderla/
    );
    await saveCategory(a.id, 'spesa', null, false);
    expect((await catalog(a.id))[1]).toMatchObject({ name: 'Dispensa', hidden: false });
  });

  it('mantiene Bollette nei gruppi con vecchie spese o ricorrenze, non nei nuovi gruppi', async () => {
    await as(guest);
    const a = await createGroup('Vecchia spesa');
    const b = await createGroup('Solo ricorrenza');
    const payerA = (await member(a.id, guest)).user_id;
    const payerB = (await member(b.id, guest)).user_id;
    await db.query(
      `select save_expense($1,null,'Luce',45,'EUR',1,current_date,false,45,current_date,
       'bollette','Bollette e utenze',$2,'equal','',$3,'created','Luce')`,
      [a.id, payerA, JSON.stringify([{ user_id: payerA, amount: 45, base_amount: 45 }])]
    );
    await db.query(
      `insert into recurring_expenses(group_id,description,amount,currency,category,category_label,paid_by,split_mode,splits,
       frequency,start_date,next_due_date,created_by,updated_by) values ($1,'Internet',20,'EUR','bollette','Bollette e utenze',
       $2,'equal',$3,'monthly',current_date,current_date,$4,$4)`,
      [b.id, payerB, JSON.stringify([{ userId: payerB }]), guest]
    );
    for (const id of [a.id, b.id]) {
      const cats = await catalog(id);
      expect(cats.find((c) => c.key === 'bollette')).toMatchObject({
        name: 'Bollette e utenze',
        hidden: true,
      });
      expect(cats.filter((c) => !c.hidden)).toHaveLength(11);
    }
    await saveCategory(a.id, 'bollette', 'Utenze studio');
    expect((await catalog(a.id)).find((c) => c.key === 'bollette')?.hidden).toBe(true);
    await saveCategory(a.id, 'bollette', null, false);
    await db.exec('reset role');
    await db.exec(schema);
    await as(guest);
    expect((await catalog(a.id)).find((c) => c.key === 'bollette')).toMatchObject({
      name: 'Utenze studio',
      hidden: false,
    });
    expect(
      await first('select category, base_amount from expenses where group_id=$1', [a.id])
    ).toEqual({ category: 'bollette', base_amount: '45.00' });
    expect(
      await first('select category, active from recurring_expenses where group_id=$1', [b.id])
    ).toEqual({ category: 'bollette', active: true });
    expect((await catalog((await createGroup('Nuovo')).id)).some((c) => c.key === 'bollette')).toBe(
      false
    );
  });

  it('conserva una scelta precedente in cui solo Bollette era visibile', async () => {
    await as(guest);
    const g = await createGroup('Solo utenze');
    const customized = await createGroup('Categoria personalizzata prima dell’aggiornamento');
    const prefs = Object.fromEntries((await catalog(g.id)).map((c) => [c.key, { hidden: true }]));
    // Stati validi nella versione con 12 predefinite, anche senza movimenti.
    await db.exec('reset role');
    await db.query('update expense_groups set category_presets=$2 where id=$1', [
      g.id,
      JSON.stringify(prefs),
    ]);
    await db.query('update expense_groups set category_presets=$2 where id=$1', [
      customized.id,
      JSON.stringify({ bollette: { name: 'Ufficio', icon: 'briefcase' } }),
    ]);
    await as(guest);
    expect((await catalog(g.id)).filter((c) => !c.hidden).map((c) => c.key)).toEqual(['bollette']);
    expect((await catalog(customized.id)).find((c) => c.key === 'bollette')).toMatchObject({
      name: 'Ufficio',
      icon: 'briefcase',
      hidden: false,
    });
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
    expect(await catalog(a.id)).toHaveLength(11);
    await expect(saveCategory(a.id, null, 'Pulizie')).rejects.toThrow(/chiuso/);
    await expect(saveCategory(a.id, 'altro', 'Mio')).rejects.toThrow(/chiuso/);
  });
});

type Person = { name: string; group_id?: string; user_id?: string };
const quickEvent = (people: Person[] = [], currency = 'EUR') =>
  first<{ id: string; invite_token: string; quick_creator_seat: string }>(
    "select * from create_quick_event('Cena di sabato',$1,$2)",
    [currency, JSON.stringify(people)]
  );
const addPeople = (g: string, people: Person[]) =>
  db.query('select add_quick_event_people($1,$2)', [g, JSON.stringify(people)]);
const seatByName = (g: string, n: string) =>
  first<{ user_id: string; owner_id: string | null }>(
    'select user_id,owner_id from group_members where group_id=$1 and display_name=$2',
    [g, n]
  );
const carryPair = (
  ev: string,
  dest: string,
  from: string,
  to: string,
  amount: number,
  target = amount,
  fx = 1
) =>
  db.query('select close_expense_group($1,$2,$3,$4)', [
    ev,
    dest,
    JSON.stringify([
      { from_user: from, to_user: to, source_amount: amount, target_amount: target },
    ]),
    fx,
  ]);
const eventExpense = (g: string, label: string, total: number, payer: string, seats: string[]) =>
  db.query(
    `select save_expense($1,null,$2,$3,'EUR',1,current_date,false,$3,current_date,'altro','Altro',$4,'equal','',$5,'created',$2)`,
    [
      g,
      label,
      total,
      payer,
      JSON.stringify(
        seats.map((user_id) => ({
          user_id,
          amount: total / seats.length,
          base_amount: total / seats.length,
        }))
      ),
    ]
  );

describe('Conti al volo', () => {
  it('dal solo telefono del creatore: cena + taxi, rimborso di Sara, riporto del solo residuo senza copiare spese', async () => {
    await as(guest);
    const casa = await createGroup('Casa', ['Giulia']);
    const partner = await seatByName(casa.id, 'Giulia'); // nessun account nemmeno nel gruppo di coppia
    const meAtHome = await member(casa.id, guest);
    const ev = await quickEvent();
    expect(
      (await db.query('select * from group_members where group_id=$1', [ev.id])).rows
    ).toHaveLength(1);
    const me = ev.quick_creator_seat;
    expect((await member(ev.id, guest)).user_id).toBe(me);
    await addPeople(ev.id, [
      { name: 'Giulia P.', group_id: casa.id, user_id: partner.user_id },
      { name: 'Luca' },
      { name: 'Sara' },
    ]);
    const b = (await seatByName(ev.id, 'Giulia P.')).user_id,
      c = (await seatByName(ev.id, 'Luca')).user_id,
      d = (await seatByName(ev.id, 'Sara')).user_id;
    await eventExpense(ev.id, 'Cena', 80, me, [me, b, c, d]);
    await eventExpense(ev.id, 'Taxi', 30, c, [me, c, d]);
    const carry = () => carryPair(ev.id, casa.id, b, me, 20);
    await expect(carry()).rejects.toThrow(/saldi sono cambiati/); // anche Sara deve ancora 30
    expect(
      (await db.query('select * from settlements where group_id in ($1,$2)', [ev.id, casa.id])).rows
    ).toHaveLength(0);
    await db.query(
      `insert into settlements(group_id,from_user,to_user,amount,currency,exchange_rate,rate_date,base_amount,settlement_date,created_by,updated_by)
      values($1,$2,$3,30,'EUR',1,current_date,30,current_date,$4,$4)`,
      [ev.id, d, me, guest]
    );
    await expect(carryPair(ev.id, casa.id, b, me, 20, 900)).rejects.toThrow(/convertito/);
    await carry();
    expect(
      await first(
        "select from_user,to_user,base_amount from settlements where group_id=$1 and kind='transfer_in'",
        [casa.id]
      )
    ).toEqual({ from_user: meAtHome.user_id, to_user: partner.user_id, base_amount: '20.00' });
    expect(
      await first(
        "select from_user,to_user,base_amount from settlements where group_id=$1 and kind='transfer_out'",
        [ev.id]
      )
    ).toEqual({ from_user: b, to_user: me, base_amount: '20.00' });
    expect(
      (await db.query('select * from expenses where group_id=$1', [casa.id])).rows
    ).toHaveLength(0);
    expect((await db.query('select * from expenses where group_id=$1', [ev.id])).rows).toHaveLength(
      2
    );
    await expect(carry()).rejects.toThrow(/chiuso/);
    await db.query('select reopen_expense_group($1)', [ev.id]);
    await expect(carry()).rejects.toThrow(/saldi sono cambiati/);
    expect(
      (await db.query('select * from settlements where group_id=$1', [casa.id])).rows
    ).toHaveLength(1);
  });

  it('il suggerimento riserva un posto, non concede accesso. Solo la persona verificata può sceglierlo con l’invito', async () => {
    await as(guest);
    const casa = await createGroup('Casa', ['Giulia']);
    const original = (await seatByName(casa.id, 'Giulia')).user_id;
    await as(friend);
    await join(casa.invite_token, original);
    await as(guest);
    const ev = await quickEvent([
      { name: 'G.', group_id: casa.id, user_id: original },
      { name: 'Luca' },
    ]);
    const p = await seatByName(ev.id, 'G.');
    expect(p.owner_id).toBeNull();
    await expect(
      addPeople(ev.id, [{ name: 'Secondo posto', group_id: casa.id, user_id: original }])
    ).rejects.toThrow(/già nella serata/);
    await as(outsider);
    expect(await countGroups(ev.id)).toBe(0);
    expect((await preview(ev.invite_token)).available_names.map((n) => n.name)).toEqual(['Luca']);
    await expect(join(ev.invite_token, p.user_id)).rejects.toThrow(/disponibile/);
    await as(friend);
    expect(await countGroups(ev.id)).toBe(0);
    expect((await preview(ev.invite_token)).available_names.map((n) => n.id)).toContain(p.user_id);
    await join(ev.invite_token, p.user_id);
    expect((await member(ev.id, friend)).user_id).toBe(p.user_id);
    expect(
      (await db.query('select * from get_quick_event_matches($1)', [ev.id])).rows
    ).toHaveLength(0);
    await expect(carryPair(ev.id, casa.id, p.user_id, ev.quick_creator_seat, 1)).rejects.toThrow(
      /coppia/
    );
  });

  it('rifiuta riferimenti fuori dai propri gruppi, omonimi e destinazioni non più a due; la creazione è atomica', async () => {
    await as(outsider);
    const priv = await createGroup('Privato', ['Giulia']);
    const foreign = (await seatByName(priv.id, 'Giulia')).user_id;
    await as(guest);
    const casa = await createGroup('Casa', ['Giulia']);
    const own = (await seatByName(casa.id, 'Giulia')).user_id;
    await expect(
      quickEvent([{ name: 'Luca' }, { name: 'Giulia', group_id: priv.id, user_id: foreign }])
    ).rejects.toThrow(/non più disponibile/);
    expect(
      (await db.query('select id from expense_groups where quick_creator_seat is not null')).rows
    ).toHaveLength(0);
    const ev = await quickEvent([{ name: 'Giulia' }]);
    const manual = (await seatByName(ev.id, 'Giulia')).user_id;
    expect(
      (await db.query('select * from get_quick_event_matches($1)', [ev.id])).rows
    ).toHaveLength(0);
    await expect(carryPair(ev.id, casa.id, manual, ev.quick_creator_seat, 1)).rejects.toThrow(
      /coppia/
    );
    await addPeople(ev.id, [{ name: 'Giulia R.', group_id: casa.id, user_id: own }]);
    const peer = (await seatByName(ev.id, 'Giulia R.')).user_id;
    expect(
      (await db.query('select group_id,peer_id from get_quick_event_matches($1)', [ev.id])).rows
    ).toEqual([{ group_id: casa.id, peer_id: peer }]);
    await db.query("select add_group_participant($1,'Terzo')", [casa.id]);
    await expect(carryPair(ev.id, casa.id, peer, ev.quick_creator_seat, 1)).rejects.toThrow(
      /coppia/
    );
    await as(outsider);
    await expect(addPeople(ev.id, [{ name: 'Mira' }])).rejects.toThrow(/Solo chi ha creato/);
  });
});

describe('Storico e identità della serata', () => {
  it('il riporto funziona anche a parti invertite e con cambio: il selezionato non deve accettare, nemmeno dopo il passaggio ospite → account', async () => {
    await as(guest);
    const couple = await first<{ id: string }>(
      "select * from create_expense_group('Casa','','JPY','{Giulia}')"
    );
    const b = (await seatByName(couple.id, 'Giulia')).user_id;
    const event = await quickEvent([{ name: 'Giulia', group_id: couple.id, user_id: b }]);
    const peer = (await seatByName(event.id, 'Giulia')).user_id;
    await eventExpense(event.id, 'Biglietti', 2, peer, [event.quick_creator_seat, peer]);
    await db.query('select authorize_guest_link($1)', [account]);
    await as(account);
    await db.query('select link_guest_groups($1)', [guest]);
    expect((await member(event.id, account)).user_id).toBe(event.quick_creator_seat);
    await carryPair(event.id, couple.id, event.quick_creator_seat, peer, 1, 161, 160.5);
    expect(
      await first(
        "select from_user,to_user,base_amount,amount,exchange_rate from settlements where group_id=$1 and kind='transfer_in'",
        [couple.id]
      )
    ).toEqual({
      from_user: b,
      to_user: (await member(couple.id, account)).user_id,
      base_amount: '161.00',
      amount: '1.00',
      exchange_rate: '160.50000000',
    });
    await as(guest);
    expect(await countGroups(event.id)).toBe(0);
  });

  it('archivia senza simulare rimborsi; il secondo Run non ripristina accessi e conserva i collegamenti', async () => {
    await as(guest);
    const home = await createGroup('Casa', ['B']);
    const original = (await seatByName(home.id, 'B')).user_id;
    const e = await quickEvent([{ name: 'B', group_id: home.id, user_id: original }]);
    const peer = (await seatByName(e.id, 'B')).user_id;
    await eventExpense(e.id, 'Cinema', 10, e.quick_creator_seat, [e.quick_creator_seat, peer]);
    await db.query('select close_expense_group($1)', [e.id]);
    await db.exec('reset role');
    await db.exec(schema);
    await as(guest);
    expect(
      await first('select quick_creator_seat from expense_groups where id=$1', [home.id])
    ).toEqual({ quick_creator_seat: null });
    expect(
      (await db.query('select id from settlements where group_id in ($1,$2)', [e.id, home.id])).rows
    ).toHaveLength(0);
    expect(
      (await db.query("select id from activity_logs where group_id=$1 and action='closed'", [e.id]))
        .rows
    ).toHaveLength(1);
    await expect(addPeople(e.id, [{ name: 'E.' }])).rejects.toThrow(/aperto/);
    await db.query('select reopen_expense_group($1)', [e.id]);
    expect(
      await first('select group_id,target_peer,can_carry from get_quick_event_matches($1)', [e.id])
    ).toEqual({ group_id: home.id, target_peer: original, can_carry: true });
    expect((await seatByName(e.id, 'B')).owner_id).toBeNull();
    await expect(db.query('select * from bausplit_private.event_people')).rejects.toThrow(
      /permission denied/i
    );
    await db.exec('reset role; set role anon');
    await expect(quickEvent()).rejects.toThrow(/permission denied/i);
  });
});
