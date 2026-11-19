const e=`-- =============================================================================
-- BauSplit — Schema completo Supabase (PostgreSQL + RLS + RPC + Realtime)
-- =============================================================================
-- Istruzioni:
-- 1. Apri la dashboard di Supabase -> SQL Editor -> New query
-- 2. Incolla tutto questo file e clicca "Run"
-- 3. Lo script è idempotente: può essere rieseguito in sicurezza senza perdere dati.
--    (Non elimina la vecchia tabella \`activities\`, se presente.)
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Funzioni di utilità di base
-- -----------------------------------------------------------------------------

create or replace function public.generate_invite_token()
returns text
language sql
volatile
set search_path = public
as $$
  select replace(gen_random_uuid()::text, '-', '')
      || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2. Tabelle
-- -----------------------------------------------------------------------------

-- Profili utente (sincronizzati con auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null check (char_length(trim(display_name)) between 1 and 60),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Autorizzazioni temporanee, mai esposte tramite le API del sito.
create schema if not exists bausplit_private;
revoke all on schema bausplit_private from public, anon, authenticated;
create table if not exists bausplit_private.account_links (
  guest_id uuid primary key references auth.users(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  completed_at timestamptz
);
revoke all on bausplit_private.account_links from public, anon, authenticated;

-- Gruppi privati di spesa (con supporto a chiusura e trasferimento saldo)
create table if not exists public.expense_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  description text not null default '' check (char_length(description) <= 280),
  base_currency text not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  invite_token text not null unique default public.generate_invite_token(),
  invite_enabled boolean not null default true,
  closed_at timestamptz null,
  closed_by uuid null references public.profiles(id),
  closed_into_group_id uuid null references public.expense_groups(id) on delete set null,
  closed_into_group_name text null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Migrazioni idempotenti se la tabella esisteva già
alter table public.expense_groups add column if not exists closed_at timestamptz null;
alter table public.expense_groups add column if not exists closed_by uuid null references public.profiles(id);
alter table public.expense_groups add column if not exists closed_into_group_id uuid null references public.expense_groups(id) on delete set null;
alter table public.expense_groups add column if not exists closed_into_group_name text null;

-- NULL per tutti i gruppi ordinari, anche quelli già esistenti. Non concede accesso.
alter table public.expense_groups add column if not exists quick_creator_seat uuid;

-- Solo le differenze rispetto alle categorie predefinite del catalogo.
alter table public.expense_groups add column if not exists category_presets jsonb not null default '{}';
alter table public.expense_groups add column if not exists category_order text[] not null default '{}';

-- user_id è il posto stabile nel libro delle spese, non la credenziale di accesso.
-- owner_id identifica chi lo occupa; un nome preparato prima dell'invito non ha proprietario.
create table if not exists public.group_members (
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  user_id uuid not null default gen_random_uuid(),
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  primary key (group_id, user_id)
);

-- Solo durante la prima migrazione: non assegnare mai un nome libero al secondo Run.
DO $$
begin
  if not exists (select from information_schema.columns where table_schema = 'public'
      and table_name = 'group_members' and column_name = 'owner_id') then
    alter table public.group_members add column owner_id uuid references public.profiles(id);
    update public.group_members set owner_id = user_id;
  end if;
end;
$$;
alter table public.group_members drop constraint if exists group_members_user_id_fkey;
alter table public.group_members alter column user_id set default gen_random_uuid();
alter table public.group_members add column if not exists display_name text
  check (char_length(trim(display_name)) between 1 and 60);
create unique index if not exists idx_group_members_owner on public.group_members (owner_id, group_id);

create index if not exists idx_group_members_user_active
  on public.group_members (user_id)
  where left_at is null;

create index if not exists idx_group_members_group_active
  on public.group_members (group_id)
  where left_at is null;

-- Categorie personalizzate per gruppo
create table if not exists public.group_categories (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40),
  icon text not null default 'tag',
  color text not null default '#0f766e',
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

alter table public.group_categories add column if not exists hidden boolean not null default false;

create unique index if not exists idx_group_categories_unique_name
  on public.group_categories (group_id, lower(trim(name)));

-- Spese ricorrenti
create table if not exists public.recurring_expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 1 and 140),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  fixed_exchange_rate numeric(18,8) null check (fixed_exchange_rate is null or fixed_exchange_rate > 0),
  category text not null default 'altro',
  category_label text not null default 'Altro',
  paid_by uuid not null,
  split_mode text not null check (split_mode in ('equal', 'exact', 'percentage')),
  splits jsonb not null,
  note text not null default '' check (char_length(note) <= 500),
  frequency text not null check (frequency in ('weekly', 'biweekly', 'monthly', 'bimonthly', 'quarterly', 'yearly')),
  start_date date not null,
  next_due_date date not null,
  end_date date null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_recurring_expenses_group
  on public.recurring_expenses (group_id, active, next_due_date);

-- Spese singole (con tasso di cambio salvato senza aggiornamenti retroattivi)
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  description text not null check (char_length(trim(description)) between 1 and 140),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  rate_date date not null default current_date,
  rate_is_manual boolean not null default false,
  base_amount numeric(14,2) not null check (base_amount > 0),
  expense_date date not null default current_date,
  category text not null default 'altro',
  category_label text not null default 'Altro',
  paid_by uuid not null,
  split_mode text not null check (split_mode in ('equal', 'exact', 'percentage')),
  note text not null default '' check (char_length(note) <= 500),
  recurring_id uuid null references public.recurring_expenses(id) on delete set null,
  recurring_occurrence_date date null,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_expenses_group_date
  on public.expenses (group_id, expense_date desc, created_at desc);

create unique index if not exists idx_expenses_recurring_occurrence
  on public.expenses (recurring_id, recurring_occurrence_date)
  where recurring_id is not null and recurring_occurrence_date is not null;

-- Quote di ripartizione per ciascun partecipante di una spesa
create table if not exists public.expense_splits (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  user_id uuid not null,
  amount numeric(14,2) not null check (amount >= 0),
  base_amount numeric(14,2) not null check (base_amount >= 0),
  percentage numeric(7,4) null,
  unique (expense_id, user_id)
);

create index if not exists idx_expense_splits_group
  on public.expense_splits (group_id);

create index if not exists idx_expense_splits_expense
  on public.expense_splits (expense_id);

-- Rimborsi registrati e trasferimenti di saldo tra gruppi (esclusi dai totali di spesa negli Insights)
create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  from_user uuid not null,
  to_user uuid not null,
  amount numeric(14,2) not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric(18,8) not null default 1 check (exchange_rate > 0),
  rate_date date not null default current_date,
  rate_is_manual boolean not null default false,
  base_amount numeric(14,2) not null check (base_amount > 0),
  settlement_date date not null default current_date,
  kind text not null default 'settlement' check (kind in ('settlement', 'transfer_out', 'transfer_in')),
  linked_group_name text null,
  note text not null default '' check (char_length(note) <= 500),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user <> to_user)
);

alter table public.settlements
  add column if not exists kind text not null default 'settlement'
  check (kind in ('settlement', 'transfer_out', 'transfer_in'));
alter table public.settlements
  add column if not exists linked_group_name text null;

create index if not exists idx_settlements_group_date
  on public.settlements (group_id, settlement_date desc, created_at desc);

-- Le quote appartengono a un partecipante DI QUEL gruppo, anche senza un account.
-- Sostituisce i vecchi riferimenti ai profili; non riscrive spese, importi o ID.
do $$
declare r record;
begin
  for r in select * from (values ('expenses','paid_by'), ('recurring_expenses','paid_by'),
      ('expense_splits','user_id'), ('settlements','from_user'), ('settlements','to_user')) as x(tab, col)
  loop
    execute format('alter table public.%I drop constraint if exists %I', r.tab, r.tab || '_' || r.col || '_fkey');
    if not exists (select from pg_constraint where conrelid = format('public.%I', r.tab)::regclass
        and conname = r.col || '_group_member_fk') then
      execute format('alter table public.%I add constraint %I foreign key (group_id, %I) references public.group_members(group_id, user_id)',
        r.tab, r.col || '_group_member_fk', r.col);
    end if;
  end loop;
end;
$$;

-- Storico completo delle attività (immutabile: chi ha fatto cosa e quando)
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  actor_id uuid not null references public.profiles(id),
  entity_type text not null check (entity_type in ('expense', 'settlement', 'recurring', 'group', 'member', 'invite', 'category')),
  entity_id uuid null,
  action text not null check (action in (
    'created', 'updated', 'deleted', 'joined', 'left',
    'regenerated', 'enabled', 'disabled', 'paused', 'resumed',
    'generated', 'closed', 'reopened', 'transferred_in'
  )),
  summary text not null,
  changes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Conserva il nome di chi ha agito anche se il suo accesso cambia in seguito.
alter table public.activity_logs add column if not exists actor_name text;
update public.activity_logs l set actor_name = p.display_name
from public.profiles p where l.actor_id = p.id and l.actor_name is null;

create or replace function public.stamp_actor_name() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select coalesce(gm.display_name, p.display_name) into new.actor_name
    from public.profiles p left join public.group_members gm
    on gm.owner_id = p.id and gm.group_id = new.group_id where p.id = new.actor_id;
  return new;
end;
$$;
drop trigger if exists trg_actor_name on public.activity_logs;
create trigger trg_actor_name before insert on public.activity_logs
  for each row execute function public.stamp_actor_name();

-- Aggiorna il vincolo action se la tabella esisteva già
alter table public.activity_logs drop constraint if exists activity_logs_action_check;
alter table public.activity_logs add constraint activity_logs_action_check check (
  action in (
    'created', 'updated', 'deleted', 'joined', 'left',
    'regenerated', 'enabled', 'disabled', 'paused', 'resumed',
    'generated', 'closed', 'reopened', 'transferred_in'
  )
);

create index if not exists idx_activity_logs_group_created
  on public.activity_logs (group_id, created_at desc);

create index if not exists idx_activity_logs_entity
  on public.activity_logs (group_id, entity_id);

-- -----------------------------------------------------------------------------
-- 3. Trigger updated_at e sincronizzazione profili auth.users
-- -----------------------------------------------------------------------------

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

drop trigger if exists trg_expense_groups_updated_at on public.expense_groups;
create trigger trg_expense_groups_updated_at
  before update on public.expense_groups
  for each row execute function public.set_updated_at();

drop trigger if exists trg_expenses_updated_at on public.expenses;
create trigger trg_expenses_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

drop trigger if exists trg_settlements_updated_at on public.settlements;
create trigger trg_settlements_updated_at
  before update on public.settlements
  for each row execute function public.set_updated_at();

drop trigger if exists trg_recurring_expenses_updated_at on public.recurring_expenses;
create trigger trg_recurring_expenses_updated_at
  before update on public.recurring_expenses
  for each row execute function public.set_updated_at();

create or replace function public.handle_auth_user_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  v_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'display_name'), ''),
    nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Ospite'
  );
  v_name := left(v_name, 60);

  insert into public.profiles (id, email, display_name)
  values (new.id, coalesce(new.email, ''), v_name)
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;

drop trigger if exists on_auth_user_synced on auth.users;
create trigger on_auth_user_synced
  after insert or update of email on auth.users
  for each row execute function public.handle_auth_user_sync();

-- Allinea eventuali utenti già registrati prima dell'esecuzione dello script
insert into public.profiles (id, email, display_name)
select
  u.id,
  coalesce(u.email, ''),
  left(
    coalesce(
      nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
      nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Ospite'
    ),
    60
  )
from auth.users u
on conflict (id) do nothing;

create or replace function public.ensure_current_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'Autenticazione richiesta';
  end if;

  -- Serializza ingresso/creazione e collegamento: nessun gruppo deve restare
  -- su un vecchio accesso ospite, nemmeno se ci sono due schede aperte.
  select * into v_profile from public.profiles where id = v_uid for no key update;
  if exists (select from bausplit_private.account_links where guest_id = v_uid and completed_at is not null) then
    raise exception 'I gruppi di questo dispositivo sono già collegati: accedi al tuo account';
  end if;
  if v_profile.id is not null then
    return v_profile;
  end if;

  insert into public.profiles (id, email, display_name)
  select
    u.id,
    coalesce(u.email, ''),
    left(
      coalesce(
        nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
        nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(split_part(coalesce(u.email, ''), '@', 1), ''), 'Ospite'
      ),
      60
    )
  from auth.users u
  where u.id = v_uid
  on conflict (id) do update set email = excluded.email
  returning * into v_profile;

  return v_profile;
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Funzioni di controllo accesso (SECURITY DEFINER per evitare ricorsioni RLS)
-- -----------------------------------------------------------------------------

create or replace function public.is_active_group_member(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = p_group_id
      and gm.owner_id = auth.uid()
      and gm.left_at is null
  );
$$;

create or replace function public.can_edit_group(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_active_group_member(p_group_id) and exists (
    select from public.expense_groups where id = p_group_id and closed_at is null
  );
$$;

create or replace function public.shares_group_with(p_target_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_target_user = auth.uid()
    or exists (
      select 1
      from public.group_members me
      join public.group_members other_m on other_m.group_id = me.group_id
      where me.owner_id = auth.uid()
        and me.left_at is null
        and other_m.owner_id = p_target_user
    );
$$;

-- -----------------------------------------------------------------------------
-- 5. Row Level Security (RLS)
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.expense_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_categories enable row level security;
alter table public.recurring_expenses enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_splits enable row level security;
alter table public.settlements enable row level security;
alter table public.activity_logs enable row level security;

-- profiles
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated
  using (public.shares_group_with(id));

drop policy if exists profiles_insert on public.profiles;
create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (id = auth.uid());

drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- expense_groups
drop policy if exists expense_groups_select on public.expense_groups;
create policy expense_groups_select on public.expense_groups
  for select to authenticated
  using (public.is_active_group_member(id));

drop policy if exists expense_groups_update on public.expense_groups;
create policy expense_groups_update on public.expense_groups
  for update to authenticated
  using (public.can_edit_group(id))
  with check (public.can_edit_group(id));

-- group_members
drop policy if exists group_members_select on public.group_members;
create policy group_members_select on public.group_members
  for select to authenticated
  using (public.is_active_group_member(group_id));

-- group_categories
drop policy if exists group_categories_select on public.group_categories;
create policy group_categories_select on public.group_categories
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists group_categories_insert on public.group_categories;
create policy group_categories_insert on public.group_categories
  for insert to authenticated
  with check (public.can_edit_group(group_id) and created_by = auth.uid());

drop policy if exists group_categories_update on public.group_categories;
create policy group_categories_update on public.group_categories
  for update to authenticated
  using (public.can_edit_group(group_id))
  with check (public.can_edit_group(group_id));

drop policy if exists group_categories_delete on public.group_categories;
create policy group_categories_delete on public.group_categories
  for delete to authenticated
  using (public.can_edit_group(group_id));

-- recurring_expenses
drop policy if exists recurring_expenses_select on public.recurring_expenses;
create policy recurring_expenses_select on public.recurring_expenses
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists recurring_expenses_insert on public.recurring_expenses;
create policy recurring_expenses_insert on public.recurring_expenses
  for insert to authenticated
  with check (
    public.can_edit_group(group_id)
    and created_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists recurring_expenses_update on public.recurring_expenses;
create policy recurring_expenses_update on public.recurring_expenses
  for update to authenticated
  using (public.can_edit_group(group_id))
  with check (public.can_edit_group(group_id) and updated_by = auth.uid());

drop policy if exists recurring_expenses_delete on public.recurring_expenses;
create policy recurring_expenses_delete on public.recurring_expenses
  for delete to authenticated
  using (public.can_edit_group(group_id));

-- expenses
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.can_edit_group(group_id)
    and created_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.can_edit_group(group_id))
  with check (public.can_edit_group(group_id) and updated_by = auth.uid());

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete to authenticated
  using (public.can_edit_group(group_id));

-- expense_splits
drop policy if exists expense_splits_select on public.expense_splits;
create policy expense_splits_select on public.expense_splits
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists expense_splits_insert on public.expense_splits;
create policy expense_splits_insert on public.expense_splits
  for insert to authenticated
  with check (public.can_edit_group(group_id));

drop policy if exists expense_splits_update on public.expense_splits;
create policy expense_splits_update on public.expense_splits
  for update to authenticated
  using (public.can_edit_group(group_id))
  with check (public.can_edit_group(group_id));

drop policy if exists expense_splits_delete on public.expense_splits;
create policy expense_splits_delete on public.expense_splits
  for delete to authenticated
  using (public.can_edit_group(group_id));

-- settlements
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements
  for insert to authenticated
  with check (
    kind = 'settlement' and public.can_edit_group(group_id)
    and created_by = auth.uid()
    and updated_by = auth.uid()
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = settlements.group_id and gm.user_id = settlements.from_user
    )
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = settlements.group_id and gm.user_id = settlements.to_user
    )
  );

drop policy if exists settlements_update on public.settlements;
create policy settlements_update on public.settlements
  for update to authenticated
  using (kind = 'settlement' and public.can_edit_group(group_id))
  with check (
    kind = 'settlement' and public.can_edit_group(group_id)
    and updated_by = auth.uid()
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = settlements.group_id and gm.user_id = settlements.from_user
    )
    and exists (
      select 1 from public.group_members gm
      where gm.group_id = settlements.group_id and gm.user_id = settlements.to_user
    )
  );

drop policy if exists settlements_delete on public.settlements;
create policy settlements_delete on public.settlements
  for delete to authenticated
  using (kind = 'settlement' and public.can_edit_group(group_id));

-- activity_logs (sola lettura + append per i membri attivi; nessuna modifica/cancellazione)
drop policy if exists activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert on public.activity_logs
  for insert to authenticated
  with check (public.can_edit_group(group_id) and actor_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. Funzioni RPC atomiche (Gruppi, Inviti, Spese, Uscita, Chiusura con riporto saldo)
-- -----------------------------------------------------------------------------

-- Il catalogo contiene anche le categorie nascoste. Le chiavi restano quelle
-- dei movimenti esistenti; nome, icona, colore e ordine appartengono al gruppo.
create or replace function public.get_group_categories(p_group_id uuid)
returns table (key text, name text, icon text, color text, hidden boolean)
language sql stable security invoker set search_path = '' as $$
  with g as (
    select category_presets, category_order from public.expense_groups where id = p_group_id
  ), catalog as (
    select p.key, coalesce(o.v->>'name', p.name) as name, coalesce(o.v->>'icon', p.icon) as icon,
      coalesce(o.v->>'color', p.color) as color, coalesce((o.v->>'hidden')::boolean, false) as hidden, p.pos
    from g cross join (values
      ('spesa', 'Spesa', 'shopping-basket', '#0F766E', 1),
      ('ristoranti', 'Ristoranti e bar', 'utensils', '#C2410C', 2),
      ('casa', 'Casa', 'home', '#1D4ED8', 3),
      ('trasporti', 'Trasporti', 'car', '#4338CA', 5),
      ('viaggi', 'Viaggi', 'plane', '#0369A1', 6),
      ('svago', 'Svago', 'sparkles', '#7E22CE', 7),
      ('shopping', 'Shopping', 'shopping-bag', '#BE185D', 8),
      ('salute', 'Salute', 'heart-pulse', '#047857', 9),
      ('abbonamenti', 'Abbonamenti', 'repeat', '#475569', 10),
      ('regali', 'Regali', 'gift', '#B91C1C', 11),
      ('altro', 'Altro', 'tag', '#78716C', 13)
    ) p(key,name,icon,color,pos) cross join lateral (select g.category_presets->p.key as v) o
    union all
    select 'custom:' || c.id, c.name, c.icon, c.color, c.hidden, 12
    from public.group_categories c where c.group_id = p_group_id
  ), old_bills as (
    select category_presets->'bollette' as prefs, exists (select from catalog where not hidden) as has_other_visible
    from g
  ), full_catalog as (
    select * from catalog
    union all
    -- Non è una predefinita: mantieni la chiave nei gruppi che la usano già.
    -- Senza preferenze è solo storica, a meno che fosse l'unica categoria visibile.
    -- Se il gruppo l'aveva personalizzata, ne conserva invece anche la visibilità.
    select 'bollette', coalesce(prefs->>'name','Bollette e utenze'), coalesce(prefs->>'icon','zap'),
      coalesce(prefs->>'color','#B45309'), coalesce((prefs->>'hidden')::boolean, prefs is null and has_other_visible), 4
    from old_bills
    where prefs is not null or not has_other_visible
      or exists (select from public.expenses where group_id = p_group_id and category = 'bollette')
      or exists (select from public.recurring_expenses where group_id = p_group_id and category = 'bollette')
  ) select c.key, c.name, c.icon, c.color, c.hidden from full_catalog c cross join g
    order by array_position(g.category_order, c.key) nulls last, c.pos, lower(c.name), c.key;
$$;

-- Il lock serializza anche due modifiche fatte da dispositivi diversi e la chiusura del gruppo.
create or replace function bausplit_private.lock_category_group(p_group_id uuid)
returns void language plpgsql set search_path = '' as $$
begin
  if not public.is_active_group_member(p_group_id) then raise exception 'Accesso non consentito'; end if;
  perform 1 from public.expense_groups where id = p_group_id and closed_at is null for update;
  if not found then raise exception 'Il gruppo è chiuso'; end if;
  -- Il posto potrebbe essere cambiato mentre attendevamo il lock del gruppo.
  perform 1 from public.group_members where group_id = p_group_id and owner_id = auth.uid() and left_at is null for share;
  if not found then raise exception 'Accesso non consentito'; end if;
end;
$$;

-- Chiave nulla = nuova categoria personalizzata; campi nulli = nessuna modifica.
create or replace function public.save_group_category(p_group_id uuid, p_key text,
  p_name text default null, p_icon text default null, p_color text default null, p_hidden boolean default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_old record;
  v_key text := p_key;
  v_id uuid;
  v_name text := trim(p_name);
  v_patch jsonb;
  v_summary text;
  v_changes jsonb := '{}';
begin
  perform bausplit_private.lock_category_group(p_group_id);
  if v_name is not null and length(v_name) not between 1 and 40 then raise exception 'Scegli un nome da 1 a 40 caratteri'; end if;
  if p_icon is not null and p_icon !~ '^[a-z][a-z0-9-]{0,39}$' then raise exception 'Icona non valida'; end if;
  if p_color is not null and p_color !~ '^#[a-fA-F0-9]{6}$' then raise exception 'Colore non valido'; end if;
  select * into v_old from public.get_group_categories(p_group_id) where key = p_key;
  if p_key is not null and not found then raise exception 'Categoria non trovata nel gruppo'; end if;
  if v_name is distinct from v_old.name and exists (select from public.get_group_categories(p_group_id)
      where key is distinct from p_key and lower(trim(name)) = lower(v_name)) then
    raise exception 'Esiste già una categoria con questo nome';
  end if;
  if p_key is null then
    if v_name is null then raise exception 'Inserisci un nome per la categoria'; end if;
    insert into public.group_categories(group_id, name, icon, color, hidden, created_by)
      values (p_group_id, v_name, coalesce(p_icon,'tag'), coalesce(p_color,'#0F766E'), coalesce(p_hidden,false), auth.uid())
      returning id into v_id;
    v_key := 'custom:' || v_id;
    v_summary := format('Ha creato la categoria "%s"', v_name);
  else
    if p_hidden and not v_old.hidden and not exists (select from public.get_group_categories(p_group_id)
        where key <> p_key and not hidden) then raise exception 'Lascia visibile almeno una categoria'; end if;
    v_patch := jsonb_strip_nulls(jsonb_build_object('name', v_name, 'icon', p_icon, 'color', p_color, 'hidden', p_hidden));
    if (to_jsonb(v_old) @> v_patch) then return p_key; end if;
    if p_key like 'custom:%' then
      v_id := substr(p_key, 8)::uuid;
      update public.group_categories set name = coalesce(v_name,name), icon = coalesce(p_icon,icon),
        color = coalesce(p_color,color), hidden = coalesce(p_hidden,hidden) where group_id = p_group_id and id = v_id;
    else
      -- La prima rinomina di una categoria storica non deve renderla visibile da sola.
      if p_key = 'bollette' and p_hidden is null then
        v_patch := v_patch || jsonb_build_object('hidden', v_old.hidden);
      end if;
      update public.expense_groups set category_presets = jsonb_set(category_presets, array[p_key],
        coalesce(category_presets->p_key, '{}'::jsonb) || v_patch) where id = p_group_id;
    end if;
    select jsonb_build_object('diffs', jsonb_agg(jsonb_build_object('field',label,'before',previous,'after',next))) into v_changes
      from (values ('Nome', v_old.name, v_name), ('Icona', v_old.icon, p_icon), ('Colore', v_old.color, p_color),
        ('Visibilità', case when v_old.hidden then 'Nascosta' else 'Visibile' end,
          case p_hidden when true then 'Nascosta' when false then 'Visibile' end)) d(label,previous,next)
      where next is not null and previous is distinct from next;
    if v_name is not null and v_name <> v_old.name then
      v_summary := format('Ha rinominato la categoria "%s" in "%s"', v_old.name, v_name);
    elsif p_hidden is not null and p_hidden <> v_old.hidden then
      v_summary := format('Ha %s la categoria "%s"', case when p_hidden then 'nascosto' else 'reso visibile' end, v_old.name);
    else
      v_summary := format('Ha aggiornato l’aspetto della categoria "%s"', v_old.name);
    end if;
  end if;
  insert into public.activity_logs(group_id,actor_id,entity_type,entity_id,action,summary,changes)
    values(p_group_id,auth.uid(),'category',v_id,case when p_key is null then 'created' else 'updated' end,v_summary,v_changes || jsonb_build_object('category_key',v_key));
  return v_key;
end;
$$;

create or replace function public.move_group_category(p_group_id uuid, p_key text, p_step integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_order text[]; i integer; v_name text;
begin
  perform bausplit_private.lock_category_group(p_group_id);
  if p_step is null or p_step not in (-1,1) then raise exception 'Spostamento non valido'; end if;
  select array_agg(c.key order by c.ordinality), max(c.name) filter (where c.key = p_key)
    into v_order,v_name from public.get_group_categories(p_group_id) with ordinality c;
  i := array_position(v_order,p_key);
  if i is null then raise exception 'Categoria non trovata nel gruppo'; end if;
  if i+p_step not between 1 and cardinality(v_order) then return; end if;
  v_order[i] := v_order[i+p_step]; v_order[i+p_step] := p_key;
  update public.expense_groups set category_order = v_order where id = p_group_id;
  insert into public.activity_logs(group_id,actor_id,entity_type,action,summary)
    values(p_group_id,auth.uid(),'category','updated',format('Ha spostato "%s" alla posizione %s',v_name,i+p_step));
end;
$$;

-- Una categoria usata può essere nascosta, ma non si perde il nome delle sue spese.
create or replace function public.delete_group_category(p_group_id uuid, p_key text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cat public.group_categories;
begin
  perform bausplit_private.lock_category_group(p_group_id);
  select * into v_cat from public.group_categories where group_id = p_group_id and 'custom:' || id = p_key;
  if not found then raise exception 'Puoi eliminare solo una categoria personalizzata del gruppo'; end if;
  if exists(select from public.expenses where group_id = p_group_id and category = p_key) or
     exists(select from public.recurring_expenses where group_id = p_group_id and category = p_key) then
    raise exception 'Categoria già usata: puoi nasconderla senza perdere lo storico'; end if;
  if not v_cat.hidden and not exists (select from public.get_group_categories(p_group_id)
      where key <> p_key and not hidden) then raise exception 'Lascia visibile almeno una categoria'; end if;
  delete from public.group_categories where id = v_cat.id;
  update public.expense_groups set category_order = array_remove(category_order,p_key) where id = p_group_id and p_key = any(category_order);
  insert into public.activity_logs(group_id,actor_id,entity_type,entity_id,action,summary)
    values(p_group_id,auth.uid(),'category',v_cat.id,'deleted',format('Ha eliminato la categoria "%s"',v_cat.name));
end;
$$;

revoke all on function public.get_group_categories(uuid), public.save_group_category(uuid,text,text,text,text,boolean),
  public.move_group_category(uuid,text,integer), public.delete_group_category(uuid,text) from public, anon;
grant execute on function public.get_group_categories(uuid), public.save_group_category(uuid,text,text,text,text,boolean),
  public.move_group_category(uuid,text,integer), public.delete_group_category(uuid,text) to authenticated;

-- Un nome non dà accesso: crea soltanto un posto utilizzabile nelle divisioni.
create or replace function public.add_group_participant(p_group_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_name text := trim(coalesce(p_name, ''));
  v_id uuid;
begin
  if not public.is_active_group_member(p_group_id) then raise exception 'Accesso non consentito'; end if;
  perform 1 from public.expense_groups where id = p_group_id and closed_at is null for update;
  if not found then raise exception 'Il gruppo è chiuso'; end if;
  if length(v_name) not between 1 and 60 then raise exception 'Scegli un nome da 1 a 60 caratteri'; end if;
  if exists (select from public.group_members m left join public.profiles p on p.id = m.owner_id
      where m.group_id = p_group_id and m.left_at is null
        and lower(coalesce(m.display_name, p.display_name)) = lower(v_name)) then
    raise exception 'Questo nome è già presente nel gruppo';
  end if;
  insert into public.group_members(group_id, display_name) values (p_group_id, v_name) returning user_id into v_id;
  insert into public.activity_logs(group_id, actor_id, entity_type, entity_id, action, summary)
    values (p_group_id, auth.uid(), 'member', v_id, 'created', format('Ha aggiunto %s ai partecipanti', v_name));
  return v_id;
end;
$$;

-- Creazione nuovo gruppo
drop function if exists public.create_expense_group(text, text, text);
create or replace function public.create_expense_group(
  p_name text,
  p_description text default '',
  p_base_currency text default 'EUR',
  p_participants text[] default '{}'
)
returns public.expense_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_group public.expense_groups;
  v_name text;
  v_currency text := upper(trim(coalesce(p_base_currency, 'EUR')));
begin
  v_profile := public.ensure_current_profile();

  if char_length(trim(coalesce(p_name, ''))) < 1 then
    raise exception 'Inserisci un nome per il gruppo';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'Codice valuta non valido';
  end if;

  insert into public.expense_groups (name, description, base_currency, created_by)
  values (left(trim(p_name), 80), left(trim(coalesce(p_description, '')), 280), v_currency, v_profile.id)
  returning * into v_group;

  insert into public.group_members (group_id, owner_id)
  values (v_group.id, v_profile.id);

  foreach v_name in array coalesce(p_participants, '{}'::text[]) loop
    perform public.add_group_participant(v_group.id, v_name);
  end loop;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (
    v_group.id,
    v_profile.id,
    'group',
    v_group.id,
    'created',
    format('Ha creato il gruppo "%s" (valuta di riferimento: %s)', v_group.name, v_group.base_currency),
    jsonb_build_object('name', v_group.name, 'base_currency', v_group.base_currency)
  );

  return v_group;
end;
$$;

-- I collegamenti contabili NON sono autorizzazioni di accesso. Il gruppo di
-- provenienza non è esposto agli altri partecipanti né nei link d'invito.
create table if not exists bausplit_private.event_people (
  event_id uuid not null,
  event_seat uuid not null,
  origin_group uuid not null,
  origin_seat uuid not null,
  primary key (event_id, event_seat),
  unique (event_id, origin_group, origin_seat),
  foreign key (event_id, event_seat) references public.group_members(group_id, user_id) on delete cascade,
  foreign key (origin_group, origin_seat) references public.group_members(group_id, user_id) on delete cascade
);
revoke all on bausplit_private.event_people from public, anon, authenticated;

-- Inserimento atomico: un errore su un nome o su un riferimento annulla l'intera selezione.
create or replace function public.add_quick_event_people(p_event_id uuid, p_people jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  item jsonb;
  origin public.group_members;
  new_seat uuid;
begin
  perform 1 from public.expense_groups e join public.group_members me
    on me.group_id=e.id and me.user_id=e.quick_creator_seat
    where e.id=p_event_id and e.closed_at is null and me.owner_id=auth.uid() and me.left_at is null
    for update of e, me;
  if not found then raise exception 'Solo chi ha creato la serata può aggiungere questi partecipanti a un conto aperto'; end if;
  if jsonb_typeof(p_people) is distinct from 'array' then raise exception 'Elenco dei partecipanti non valido'; end if;
  for item in select * from jsonb_array_elements(p_people) loop
    if item ? 'group_id' or item ? 'user_id' then
      -- Verifica il posto effettivo, non il nome fornito dal browser. Un nome
      -- ancora libero nel gruppo di coppia è identificabile solo in quel gruppo.
      select m.* into origin from public.group_members m join public.expense_groups g on g.id=m.group_id
        join public.group_members me on me.group_id=g.id and me.owner_id=auth.uid() and me.left_at is null
        where g.quick_creator_seat is null and m.group_id=(item->>'group_id')::uuid
          and m.user_id=(item->>'user_id')::uuid and m.left_at is null and m.owner_id is distinct from auth.uid()
        for share of m, me;
      if not found then raise exception 'Partecipante non più disponibile nei tuoi gruppi'; end if;
      if exists (select from bausplit_private.event_people l join public.group_members old
          on old.group_id=l.origin_group and old.user_id=l.origin_seat where l.event_id=p_event_id
          and ((old.group_id,old.user_id)=(origin.group_id,origin.user_id) or old.owner_id=origin.owner_id))
        or exists (select from public.group_members where group_id=p_event_id and owner_id=origin.owner_id) then
        raise exception 'Questa persona è già nella serata';
      end if;
      new_seat := public.add_group_participant(p_event_id,item->>'name');
      insert into bausplit_private.event_people values (p_event_id,new_seat,origin.group_id,origin.user_id);
    else
      perform public.add_group_participant(p_event_id,item->>'name');
    end if;
  end loop;
end;
$$;

create or replace function public.create_quick_event(p_name text, p_base_currency text, p_people jsonb default '[]')
returns public.expense_groups language plpgsql security definer set search_path = '' as $$
declare ev public.expense_groups;
begin
  ev := public.create_expense_group(p_name,'',p_base_currency,'{}');
  update public.expense_groups set quick_creator_seat=(select user_id from public.group_members
    where group_id=ev.id and owner_id=auth.uid()) where id=ev.id returning * into ev;
  perform public.add_quick_event_people(ev.id,p_people);
  return ev;
end;
$$;

-- Un posto suggerito è riservato: l'invito non può attribuirlo a un omonimo.
create or replace function bausplit_private.can_claim_event_seat(g uuid, seat uuid)
returns boolean language sql stable set search_path = '' as $$
  select not exists(select from bausplit_private.event_people l join public.group_members m
    on (m.group_id,m.user_id)=(l.origin_group,l.origin_seat)
    where (l.event_id,l.event_seat)=(g,seat) and (m.owner_id is distinct from auth.uid() or m.left_at is not null));
$$;

-- Un'unica mappa, usata sia per l'anteprima sia dalla chiusura sotto lock.
-- Solo al creatore: posti riconosciuti nei suoi gruppi; riporto solo se aperti e a due.
create or replace function public.get_quick_event_matches(p_event_id uuid)
returns table(peer_id uuid, group_id uuid, target_peer uuid, target_self uuid, can_carry boolean)
language sql stable security definer set search_path = '' as $$
  select peer.user_id, dst.id, partner.user_id, me.user_id,
         dst.closed_at is null and not exists (
           select from public.group_members third where third.group_id=dst.id and third.left_at is null
             and third.user_id not in (me.user_id, partner.user_id)
         )
    from public.expense_groups ev join public.group_members creator
      on (creator.group_id,creator.user_id)=(ev.id,ev.quick_creator_seat) and creator.owner_id=auth.uid() and creator.left_at is null
    join public.group_members peer on peer.group_id=ev.id and peer.user_id<>creator.user_id
    join public.group_members me on me.owner_id=auth.uid() and me.left_at is null
    join public.expense_groups dst on dst.id=me.group_id and dst.quick_creator_seat is null
    join public.group_members partner on partner.group_id=dst.id and partner.user_id<>me.user_id and partner.left_at is null
    left join bausplit_private.event_people l on (l.event_id,l.event_seat)=(ev.id,peer.user_id)
    left join public.group_members origin on (origin.group_id,origin.user_id)=(l.origin_group,l.origin_seat)
      and origin.left_at is null and public.is_active_group_member(origin.group_id)
    where ev.id=p_event_id and ev.closed_at is null
      and (partner.owner_id=peer.owner_id or (peer.owner_id is null and
        ((partner.group_id,partner.user_id)=(origin.group_id,origin.user_id) or partner.owner_id=origin.owner_id)));
$$;

revoke all on function public.create_quick_event(text,text,jsonb), public.add_quick_event_people(uuid,jsonb),
  public.get_quick_event_matches(uuid) from public, anon;
grant execute on function public.create_quick_event(text,text,jsonb), public.add_quick_event_people(uuid,jsonb),
  public.get_quick_event_matches(uuid) to authenticated;

-- Anteprima sicura di un link d'invito (non espone spese né dati privati)
create or replace function public.get_invite_preview(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group public.expense_groups;
  v_creator_name text;
  v_member_count integer;
  v_already_member boolean;
begin
  if v_uid is null then
    raise exception 'Accedi per visualizzare l''invito';
  end if;

  select * into v_group
  from public.expense_groups
  where invite_token = trim(coalesce(p_token, ''));

  if not found or not v_group.invite_enabled or v_group.closed_at is not null then
    return jsonb_build_object(
      'valid', false,
      'reason', case
        when not found then 'not_found'
        when v_group.closed_at is not null then 'closed'
        else 'disabled'
      end
    );
  end if;

  select p.display_name into v_creator_name
  from public.profiles p
  where p.id = v_group.created_by;

  select count(*)::integer into v_member_count
  from public.group_members gm
  where gm.group_id = v_group.id
    and gm.left_at is null;

  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = v_group.id
      and gm.owner_id = v_uid
      and gm.left_at is null
  ) into v_already_member;

  return jsonb_build_object(
    'valid', true,
    'group_id', v_group.id,
    'group_name', v_group.name,
    'description', v_group.description,
    'base_currency', v_group.base_currency,
    'created_by_name', coalesce(v_creator_name, 'Un membro'),
    'member_count', v_member_count,
    'already_member', v_already_member,
    'returning_name', (select coalesce(m.display_name, p.display_name) from public.group_members m
      join public.profiles p on p.id = m.owner_id where m.group_id = v_group.id and m.owner_id = v_uid and m.left_at is not null),
    'available_names', coalesce((select jsonb_agg(jsonb_build_object('id', user_id, 'name', display_name) order by display_name)
      from public.group_members where group_id = v_group.id and owner_id is null and left_at is null
        and bausplit_private.can_claim_event_seat(group_id,user_id)), '[]'::jsonb)
  );
end;
$$;

-- Accettazione esplicita dell'invito a un gruppo
drop function if exists public.accept_group_invite(text);
create or replace function public.accept_group_invite(p_token text, p_member_id uuid default null, p_name text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_group public.expense_groups;
  v_member public.group_members;
  v_name text;
begin
  v_profile := public.ensure_current_profile();

  select * into v_group
  from public.expense_groups
  where invite_token = trim(coalesce(p_token, '')) for update;

  if not found then
    raise exception 'Questo link d''invito non è valido o è stato rigenerato';
  end if;

  if v_group.closed_at is not null then
    raise exception 'Questo gruppo è stato chiuso e non accetta nuovi membri';
  end if;

  if not v_group.invite_enabled then
    raise exception 'Il link d''invito per questo gruppo è attualmente disattivato';
  end if;

  select * into v_member from public.group_members where group_id = v_group.id and owner_id = v_profile.id;
  if found then
    if v_member.left_at is null then return v_group.id; end if;
    -- Rientro: conserva il posto e i saldi precedenti, non prenderne un secondo.
    update public.group_members set left_at = null, joined_at = now()
      where group_id = v_group.id and user_id = v_member.user_id;
  elsif exists (select from bausplit_private.event_people l join public.group_members m
      on (m.group_id,m.user_id)=(l.origin_group,l.origin_seat) join public.group_members seat
      on (seat.group_id,seat.user_id)=(l.event_id,l.event_seat) where l.event_id=v_group.id
      and m.owner_id=v_profile.id and m.left_at is null and seat.owner_id is null and seat.left_at is null
      and l.event_seat is distinct from p_member_id) then
    raise exception 'Scegli il posto già riservato a te nella serata';
  elsif p_member_id is not null then
    update public.group_members set owner_id = v_profile.id
      where group_id = v_group.id and user_id = p_member_id and owner_id is null and left_at is null
        and bausplit_private.can_claim_event_seat(group_id,user_id)
      returning * into v_member;
    if not found then raise exception 'Questo nome non è più disponibile. Scegline un altro'; end if;
  else
    v_name := trim(coalesce(p_name, ''));
    if length(v_name) not between 1 and 60 then raise exception 'Scegli un nome da 1 a 60 caratteri'; end if;
    if exists (select from public.group_members m left join public.profiles p on p.id = m.owner_id
        where m.group_id = v_group.id and m.left_at is null and lower(coalesce(m.display_name, p.display_name)) = lower(v_name)) then
      raise exception 'Nome già presente: sceglilo dall’elenco se è tuo, oppure usa un nome diverso';
    end if;
    insert into public.group_members(group_id, owner_id, display_name)
      values (v_group.id, v_profile.id, nullif(v_name, v_profile.display_name)) returning * into v_member;
  end if;

  v_name := coalesce(v_member.display_name, v_profile.display_name);
  if v_profile.display_name = 'Ospite' and exists (select from auth.users where id = v_profile.id and is_anonymous is true) then
    update public.profiles set display_name = v_name where id = v_profile.id;
  end if;
  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (v_group.id, v_profile.id, 'member', v_member.user_id, 'joined',
    format('%s ha accettato l''invito ed è entrato nel gruppo', v_name), jsonb_build_object('member_name', v_name));

  return v_group.id;
end;
$$;

-- Rigenerazione link d'invito (qualsiasi membro attivo)
create or replace function public.regenerate_group_invite(p_group_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_new_token text;
begin
  if not public.is_active_group_member(p_group_id) then
    raise exception 'Accesso non consentito';
  end if;

  v_new_token := public.generate_invite_token();

  update public.expense_groups
  set invite_token = v_new_token,
      invite_enabled = true
  where id = p_group_id
    and closed_at is null;

  if not found then
    raise exception 'Impossibile rigenerare l''invito: il gruppo è chiuso';
  end if;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary)
  values (
    p_group_id,
    v_uid,
    'invite',
    p_group_id,
    'regenerated',
    'Ha rigenerato il link d''invito del gruppo (il link precedente non è più valido)'
  );

  return v_new_token;
end;
$$;

-- Attivazione o disattivazione del link d'invito (qualsiasi membro attivo)
create or replace function public.set_group_invite_enabled(
  p_group_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_active_group_member(p_group_id) then
    raise exception 'Accesso non consentito';
  end if;

  update public.expense_groups
  set invite_enabled = coalesce(p_enabled, false)
  where id = p_group_id
    and closed_at is null;

  if not found then
    raise exception 'Il gruppo è chiuso';
  end if;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary)
  values (
    p_group_id,
    v_uid,
    'invite',
    p_group_id,
    case when p_enabled then 'enabled' else 'disabled' end,
    case
      when p_enabled then 'Ha riattivato il link d''invito del gruppo'
      else 'Ha disattivato il link d''invito del gruppo'
    end
  );

  return coalesce(p_enabled, false);
end;
$$;

-- Salvataggio atomico di una spesa (creazione o modifica) + quote + storico
create or replace function public.save_expense(
  p_group_id uuid,
  p_expense_id uuid,
  p_description text,
  p_amount numeric,
  p_currency text,
  p_exchange_rate numeric,
  p_rate_date date,
  p_rate_is_manual boolean,
  p_base_amount numeric,
  p_expense_date date,
  p_category text,
  p_category_label text,
  p_paid_by uuid,
  p_split_mode text,
  p_note text,
  p_splits jsonb,
  p_log_action text,
  p_log_summary text,
  p_log_changes jsonb default '{}'::jsonb,
  p_recurring_id uuid default null,
  p_recurring_occurrence_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_closed_at timestamptz;
  v_sum_amount numeric(14,2);
  v_sum_base numeric(14,2);
  v_action text;
begin
  if not public.is_active_group_member(p_group_id) then
    raise exception 'Non fai parte di questo gruppo';
  end if;

  select closed_at into v_closed_at from public.expense_groups where id = p_group_id for update;
  if v_closed_at is not null then
    raise exception 'Questo gruppo è chiuso: riaprilo per aggiungere o modificare spese';
  end if;

  if not exists (
    select 1 from public.group_members gm
    where gm.group_id = p_group_id and gm.user_id = p_paid_by
  ) then
    raise exception 'Il pagante selezionato non appartiene al gruppo';
  end if;

  if jsonb_typeof(p_splits) <> 'array' or jsonb_array_length(p_splits) < 1 then
    raise exception 'Seleziona almeno un partecipante';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_splits) as item
    where not exists (
      select 1 from public.group_members gm
      where gm.group_id = p_group_id and gm.user_id = (item->>'user_id')::uuid
    )
  ) then
    raise exception 'Uno dei partecipanti selezionati non appartiene al gruppo';
  end if;

  select
    coalesce(sum((item->>'amount')::numeric(14,2)), 0),
    coalesce(sum((item->>'base_amount')::numeric(14,2)), 0)
  into v_sum_amount, v_sum_base
  from jsonb_array_elements(p_splits) as item;

  if abs(v_sum_amount - round(p_amount, 2)) > 0.01 then
    raise exception 'La somma delle quote (%) non coincide con l''importo totale (%)', v_sum_amount, round(p_amount, 2);
  end if;

  if abs(v_sum_base - round(p_base_amount, 2)) > 0.01 then
    raise exception 'La somma delle quote convertite (%) non coincide con il totale convertito (%)', v_sum_base, round(p_base_amount, 2);
  end if;

  if p_expense_id is null then
    if p_recurring_id is not null and p_recurring_occurrence_date is not null then
      select id into v_id
      from public.expenses
      where recurring_id = p_recurring_id
        and recurring_occurrence_date = p_recurring_occurrence_date;
      if found then
        return v_id;
      end if;
    end if;

    insert into public.expenses (
      group_id, description, amount, currency, exchange_rate, rate_date,
      rate_is_manual, base_amount, expense_date, category, category_label,
      paid_by, split_mode, note, recurring_id, recurring_occurrence_date,
      created_by, updated_by
    )
    values (
      p_group_id,
      left(trim(p_description), 140),
      round(p_amount, 2),
      upper(trim(p_currency)),
      p_exchange_rate,
      coalesce(p_rate_date, p_expense_date, current_date),
      coalesce(p_rate_is_manual, false),
      round(p_base_amount, 2),
      coalesce(p_expense_date, current_date),
      coalesce(nullif(trim(p_category), ''), 'altro'),
      coalesce(nullif(trim(p_category_label), ''), 'Altro'),
      p_paid_by,
      p_split_mode,
      left(coalesce(p_note, ''), 500),
      p_recurring_id,
      p_recurring_occurrence_date,
      v_uid,
      v_uid
    )
    returning id into v_id;

    v_action := case when p_log_action = 'generated' then 'generated' else 'created' end;
  else
    update public.expenses
    set description = left(trim(p_description), 140),
        amount = round(p_amount, 2),
        currency = upper(trim(p_currency)),
        exchange_rate = p_exchange_rate,
        rate_date = coalesce(p_rate_date, p_expense_date, current_date),
        rate_is_manual = coalesce(p_rate_is_manual, false),
        base_amount = round(p_base_amount, 2),
        expense_date = coalesce(p_expense_date, current_date),
        category = coalesce(nullif(trim(p_category), ''), 'altro'),
        category_label = coalesce(nullif(trim(p_category_label), ''), 'Altro'),
        paid_by = p_paid_by,
        split_mode = p_split_mode,
        note = left(coalesce(p_note, ''), 500),
        updated_by = v_uid
    where id = p_expense_id
      and group_id = p_group_id
    returning id into v_id;

    if not found then
      raise exception 'Spesa non trovata o già eliminata';
    end if;

    delete from public.expense_splits where expense_id = v_id;
    v_action := 'updated';
  end if;

  insert into public.expense_splits (expense_id, group_id, user_id, amount, base_amount, percentage)
  select
    v_id,
    p_group_id,
    (item->>'user_id')::uuid,
    round((item->>'amount')::numeric, 2),
    round((item->>'base_amount')::numeric, 2),
    case
      when item ? 'percentage' and item->>'percentage' is not null
      then round((item->>'percentage')::numeric, 4)
      else null
    end
  from jsonb_array_elements(p_splits) as item;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (
    p_group_id,
    v_uid,
    'expense',
    v_id,
    v_action,
    p_log_summary,
    coalesce(p_log_changes, '{}'::jsonb)
  );

  return v_id;
end;
$$;

-- Eliminazione atomica di una spesa + registrazione nello storico
create or replace function public.delete_expense(
  p_expense_id uuid,
  p_log_summary text,
  p_log_changes jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_group_id uuid;
  v_closed_at timestamptz;
begin
  select group_id into v_group_id
  from public.expenses
  where id = p_expense_id;

  if not found then
    raise exception 'Spesa non trovata o già eliminata';
  end if;

  if not public.is_active_group_member(v_group_id) then
    raise exception 'Accesso non consentito';
  end if;

  select closed_at into v_closed_at from public.expense_groups where id = v_group_id for update;
  if v_closed_at is not null then
    raise exception 'Questo gruppo è chiuso: riaprilo per eliminare spese';
  end if;

  delete from public.expenses where id = p_expense_id;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (
    v_group_id,
    v_uid,
    'expense',
    p_expense_id,
    'deleted',
    p_log_summary,
    coalesce(p_log_changes, '{}'::jsonb)
  );
end;
$$;

-- Uscita dal gruppo (consentita in qualsiasi momento, anche con saldo diverso da zero)
create or replace function public.leave_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_group public.expense_groups;
  v_paid numeric(14,2);
  v_owed numeric(14,2);
  v_sent numeric(14,2);
  v_received numeric(14,2);
  v_net numeric(14,2);
  v_remaining integer;
  v_summary text;
  v_member public.group_members;
begin
  v_profile := public.ensure_current_profile();

  if not public.is_active_group_member(p_group_id) then
    raise exception 'Non fai parte di questo gruppo';
  end if;

  select * into v_group from public.expense_groups where id = p_group_id for update;
  select * into strict v_member from public.group_members where group_id = p_group_id and owner_id = auth.uid() and left_at is null;
  v_profile.display_name := coalesce(v_member.display_name, v_profile.display_name);

  select coalesce(sum(base_amount), 0) into v_paid
  from public.expenses
  where group_id = p_group_id and paid_by = v_member.user_id;

  select coalesce(sum(base_amount), 0) into v_owed
  from public.expense_splits
  where group_id = p_group_id and user_id = v_member.user_id;

  select coalesce(sum(base_amount), 0) into v_sent
  from public.settlements
  where group_id = p_group_id and from_user = v_member.user_id;

  select coalesce(sum(base_amount), 0) into v_received
  from public.settlements
  where group_id = p_group_id and to_user = v_member.user_id;

  v_net := round(v_paid - v_owed + v_sent - v_received, 2);

  update public.group_members
  set left_at = now()
  where group_id = p_group_id
    and user_id = v_member.user_id;

  select count(*)::integer into v_remaining
  from public.group_members
  where group_id = p_group_id
    and left_at is null;

  if v_remaining = 0 then
    delete from public.expense_groups where id = p_group_id;
    return jsonb_build_object('left', true, 'group_deleted', true);
  end if;

  if abs(v_net) < 0.01 then
    v_summary := format('%s è uscito dal gruppo (saldo in pari)', v_profile.display_name);
  else
    v_summary := format(
      '%s è uscito dal gruppo con saldo aperto di %s%s %s',
      v_profile.display_name,
      case when v_net > 0 then '+' else '' end,
      v_net,
      v_group.base_currency
    );
  end if;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (
    p_group_id,
    v_profile.id,
    'member',
    v_member.user_id,
    'left',
    v_summary,
    jsonb_build_object(
      'member_name', v_profile.display_name,
      'balance_at_exit', v_net,
      'currency', v_group.base_currency
    )
  );

  return jsonb_build_object('left', true, 'group_deleted', false);
end;
$$;

-- Anche un rimborso ordinario (scritto tramite PostgREST, non una RPC) deve
-- serializzarsi con la chiusura della serata. I riporti della RPC hanno già il lock.
create or replace function bausplit_private.lock_event_settlement() returns trigger
language plpgsql security definer set search_path = '' as $$
declare gid uuid; closed timestamptz;
begin
  if tg_op='UPDATE' and old.group_id<>new.group_id then raise exception 'Non puoi cambiare il gruppo di un rimborso'; end if;
  gid := case when tg_op='DELETE' then old.group_id else new.group_id end;
  select g.closed_at into closed from public.expense_groups g
    where g.id=gid and g.quick_creator_seat is not null and public.is_active_group_member(gid) for share;
  if found and closed is not null then raise exception 'La serata è chiusa'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists trg_event_settlement_lock on public.settlements;
create trigger trg_event_settlement_lock before insert or update or delete on public.settlements
  for each row execute function bausplit_private.lock_event_settlement();

-- Chiusura di un gruppo, con possibilità di spostare il saldo rimanente in un altro gruppo
-- in cui siano presenti tutti gli utenti coinvolti nel saldo rimanente
create or replace function public.close_expense_group(
  p_source_group_id uuid,
  p_target_group_id uuid default null,
  p_transfers jsonb default '[]'::jsonb,
  p_exchange_rate numeric default 1,
  p_rate_date date default current_date,
  p_rate_is_manual boolean default false,
  p_snapshot jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_source public.expense_groups;
  v_target public.expense_groups;
  v_item jsonb;
  v_debtor uuid;
  v_creditor uuid;
  v_target_debtor uuid;
  v_target_creditor uuid;
  v_src_amt numeric(14,2);
  v_dst_amt numeric(14,2);
  v_fx numeric(18,8);
  v_count integer := 0;
begin
  if not public.is_active_group_member(p_source_group_id) then
    raise exception 'Non fai parte di questo gruppo';
  end if;

  select * into v_source from public.expense_groups where id = p_source_group_id for update;
  if not found then
    raise exception 'Gruppo non trovato';
  end if;

  if v_source.closed_at is not null then
    raise exception 'Questo gruppo è già stato chiuso';
  end if;

  if p_target_group_id is not null then
    if p_target_group_id = p_source_group_id then
      raise exception 'Seleziona un gruppo di destinazione diverso da quello attuale';
    end if;

    if not public.is_active_group_member(p_target_group_id) then
      raise exception 'Non fai parte del gruppo di destinazione selezionato';
    end if;

    select * into v_target from public.expense_groups where id = p_target_group_id for update;
    if not found then
      raise exception 'Gruppo di destinazione non trovato';
    end if;

    if v_target.closed_at is not null then
      raise exception 'Il gruppo di destinazione è chiuso: scegli un gruppo attivo';
    end if;

    if v_target.quick_creator_seat is not null then raise exception 'Scegli un gruppo ordinario come destinazione, non una serata'; end if;

    if jsonb_typeof(p_transfers) is distinct from 'array' or jsonb_array_length(p_transfers) < 1 then
      raise exception 'Non ci sono saldi rimanenti da trasferire';
    end if;

    if p_exchange_rate is null or p_exchange_rate <= 0 or p_exchange_rate >= 1e10 then
      raise exception 'Tasso di cambio non valido';
    end if;

    v_fx := case
      when v_source.base_currency = v_target.base_currency then 1
      else p_exchange_rate
    end;

    for v_item in select * from jsonb_array_elements(p_transfers)
    loop
      v_debtor := (v_item->>'from_user')::uuid;
      v_creditor := (v_item->>'to_user')::uuid;
      v_src_amt := round((v_item->>'source_amount')::numeric, 2);
      v_dst_amt := round((v_item->>'target_amount')::numeric, 2);

      if v_debtor is null or v_creditor is null or v_debtor = v_creditor
        or v_src_amt is null or v_dst_amt is null or v_src_amt <= 0 or v_dst_amt <= 0
        or v_src_amt = 'NaN'::numeric or v_dst_amt = 'NaN'::numeric then
        raise exception 'Dati di trasferimento saldo non validi';
      end if;

      if v_source.quick_creator_seat is not null then
        if jsonb_array_length(p_transfers) <> 1 or v_source.quick_creator_seat not in (v_debtor,v_creditor) then
          raise exception 'Registra prima i rimborsi degli amici: si può riportare solo il residuo della coppia';
        end if;
        select case when v_debtor=v_source.quick_creator_seat then t.target_self else t.target_peer end,
               case when v_creditor=v_source.quick_creator_seat then t.target_self else t.target_peer end
          into v_target_debtor,v_target_creditor from public.get_quick_event_matches(v_source.id) t
          where t.group_id=v_target.id and t.can_carry and t.peer_id=case when v_debtor=v_source.quick_creator_seat then v_creditor else v_debtor end;
        if not found then raise exception 'Gruppo di coppia o partecipanti non più disponibili per il riporto'; end if;
        if v_dst_amt is distinct from round(v_src_amt*v_fx,case when v_target.base_currency in ('JPY','KRW','ISK') then 0 else 2 end) then
          raise exception 'Importo convertito non valido: controlla il cambio prima di confermare';
        end if;
      else
        -- Verifica che entrambi gli utenti coinvolti siano membri attivi del gruppo di destinazione
        select dst.user_id into v_target_debtor from public.group_members src join public.group_members dst on dst.owner_id = src.owner_id
          where src.group_id = v_source.id and src.user_id = v_debtor and dst.group_id = v_target.id and dst.left_at is null;
        select dst.user_id into v_target_creditor from public.group_members src join public.group_members dst on dst.owner_id = src.owner_id
          where src.group_id = v_source.id and src.user_id = v_creditor and dst.group_id = v_target.id and dst.left_at is null;
      end if;
      if v_target_debtor is null or v_target_creditor is null then
        raise exception 'Tutti gli utenti coinvolti nel saldo rimanente devono far parte del gruppo "%"', v_target.name;
      end if;

      -- 1) Azzera il saldo nel gruppo di origine (transfer_out: debitore -> creditore)
      insert into public.settlements (
        group_id, from_user, to_user, amount, currency,
        exchange_rate, rate_date, rate_is_manual, base_amount,
        settlement_date, kind, linked_group_name, note, created_by, updated_by
      )
      values (
        v_source.id, v_debtor, v_creditor, v_src_amt, v_source.base_currency,
        1, current_date, false, v_src_amt,
        current_date, 'transfer_out', v_target.name,
        format('Saldo spostato nel gruppo "%s"', v_target.name),
        v_uid, v_uid
      );

      -- 2) Riporta il credito/debito nel gruppo di destinazione (transfer_in: creditore -> debitore)
      insert into public.settlements (
        group_id, from_user, to_user, amount, currency,
        exchange_rate, rate_date, rate_is_manual, base_amount,
        settlement_date, kind, linked_group_name, note, created_by, updated_by
      )
      values (
        v_target.id, v_target_creditor, v_target_debtor, v_src_amt, v_source.base_currency,
        v_fx, coalesce(p_rate_date, current_date),
        case when v_source.base_currency = v_target.base_currency then false else coalesce(p_rate_is_manual, false) end,
        v_dst_amt,
        current_date, 'transfer_in', v_source.name,
        format('Saldo riportato dalla chiusura di "%s"', v_source.name),
        v_uid, v_uid
      );

      v_count := v_count + 1;
    end loop;

    -- Un altro membro potrebbe aver registrato una spesa da quando è stato
    -- aperto il riepilogo. Non chiudere sulla base di una lista parziale o vecchia:
    -- sollevare un errore annulla anche i riporti appena inseriti.
    if exists (
      select membro from (
        select e.paid_by as membro,
          case when abs(e.base_amount - sum(s.base_amount)) <= 0.01 then sum(s.base_amount) else e.base_amount end as delta
        from public.expenses e left join public.expense_splits s on s.expense_id = e.id
        where e.group_id = v_source.id group by e.id
        union all select user_id, -base_amount from public.expense_splits where group_id = v_source.id
        union all select from_user, base_amount from public.settlements where group_id = v_source.id
        union all select to_user, -base_amount from public.settlements where group_id = v_source.id
      ) ledger group by membro having sum(delta) <> 0
    ) then raise exception 'I saldi sono cambiati. Riapri il riepilogo prima di spostarli'; end if;

    update public.expense_groups
    set updated_at = now()
    where id = v_target.id;

    insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
    values (
      v_target.id,
      v_uid,
      'group',
      v_source.id,
      'transferred_in',
      format('Ha riportato il saldo rimanente dal gruppo chiuso "%s"', v_source.name),
      coalesce(p_snapshot, '{}'::jsonb)
    );
  end if;

  -- Sospende eventuali spese ricorrenti attive e disattiva il link d'invito
  update public.recurring_expenses
  set active = false,
      updated_by = v_uid
  where group_id = v_source.id
    and active = true;

  update public.expense_groups
  set closed_at = now(),
      closed_by = v_uid,
      closed_into_group_id = p_target_group_id,
      closed_into_group_name = case when p_target_group_id is not null then v_target.name else null end,
      invite_enabled = false
  where id = v_source.id;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (
    v_source.id,
    v_uid,
    'group',
    v_source.id,
    'closed',
    case
      when p_target_group_id is not null
      then format('Ha chiuso il gruppo e spostato il saldo rimanente in "%s"', v_target.name)
      else 'Ha chiuso il gruppo'
    end,
    coalesce(p_snapshot, '{}'::jsonb)
  );

  return jsonb_build_object(
    'closed', true,
    'target_group_id', p_target_group_id,
    'transferred_count', v_count
  );
end;
$$;

-- Riapertura di un gruppo chiuso (i saldi già spostati restano contabilizzati senza duplicazioni)
create or replace function public.reopen_expense_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not public.is_active_group_member(p_group_id) then
    raise exception 'Accesso non consentito';
  end if;

  update public.expense_groups
  set closed_at = null,
      closed_by = null
  where id = p_group_id
    and closed_at is not null;

  if not found then
    raise exception 'Il gruppo è già aperto';
  end if;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary)
  values (
    p_group_id,
    v_uid,
    'group',
    p_group_id,
    'reopened',
    'Ha riaperto il gruppo'
  );
end;
$$;

-- Passaggio dal dispositivo all'account. Servono ENTRAMBI gli accessi: prima
-- l'ospite autorizza uno specifico account, poi quell'account verificato accetta.
-- Né l'elenco locale, né un nome, né un invito sono una prova di proprietà.
create or replace function public.authorize_guest_link(p_account_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select from auth.users where id = auth.uid() and is_anonymous is true)
    or not exists (select from auth.users where id = p_account_id and is_anonymous is false and email_confirmed_at is not null) then
    raise exception 'Servono il dispositivo originale e un account con email verificata';
  end if;
  insert into bausplit_private.account_links as l(guest_id, account_id, expires_at)
    values (auth.uid(), p_account_id, now() + interval '5 minutes')
    on conflict (guest_id) do update set account_id = excluded.account_id, expires_at = excluded.expires_at
      where l.completed_at is null or l.account_id = excluded.account_id;
  if not found then raise exception 'Questi gruppi sono già collegati a un altro account'; end if;
end;
$$;

create or replace function public.link_guest_groups(p_guest_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_account uuid := auth.uid();
  v_link bausplit_private.account_links;
  v_guest public.group_members;
  v_existing public.group_members;
  v_guest_name text;
  v_summary text;
begin
  select * into v_link from bausplit_private.account_links
    where guest_id = p_guest_id and account_id = v_account for update;
  if not found or not exists (select from auth.users where id = v_account and is_anonymous is false and email_confirmed_at is not null) then
    raise exception 'Collegamento non autorizzato';
  end if;
  if v_link.completed_at is not null then return; end if;
  if v_link.expires_at < now() then raise exception 'Collegamento scaduto: riprova dal dispositivo originale'; end if;
  select display_name into strict v_guest_name from public.profiles where id = p_guest_id for no key update;
  for v_guest in select * from public.group_members where owner_id = p_guest_id order by group_id loop
    perform 1 from public.expense_groups where id = v_guest.group_id for update;
    select * into v_existing from public.group_members where group_id = v_guest.group_id and owner_id = v_account;
    v_summary := format('Ha collegato il profilo ospite di %s al proprio account', coalesce(v_guest.display_name, v_guest_name));
    if v_existing.user_id is not null and (v_existing.left_at is null or v_guest.left_at is not null) then
      v_summary := v_summary || '. Il posto dell’account resta attivo; le quote del precedente nome restano distinte.';
      if v_existing.left_at is null then
        update public.expense_groups set quick_creator_seat=v_existing.user_id
          where id=v_guest.group_id and quick_creator_seat=v_guest.user_id;
      end if;
      -- Entrambi già presenti: resta il posto dell'account. Il secondo saldo non viene cancellato né sommato di nascosto.
      update public.group_members set owner_id = null, left_at = coalesce(left_at, now()),
        display_name = coalesce(display_name, v_guest_name)
        where group_id = v_guest.group_id and user_id = v_guest.user_id;
    else
      if v_existing.user_id is not null then
        update public.expense_groups set quick_creator_seat=v_guest.user_id
          where id=v_guest.group_id and quick_creator_seat=v_existing.user_id;
        -- L'account era già uscito: conserva il posto attivo dell'ospite, senza riattivare quello vecchio.
        update public.group_members set owner_id = null, display_name = coalesce(display_name,
          (select display_name from public.profiles where id = v_account))
          where group_id = v_guest.group_id and user_id = v_existing.user_id;
      end if;
      update public.group_members set owner_id = v_account, display_name = coalesce(display_name, v_guest_name)
        where group_id = v_guest.group_id and user_id = v_guest.user_id;
    end if;
    if v_guest.left_at is null then
      insert into public.activity_logs(group_id, actor_id, entity_type, entity_id, action, summary)
        values (v_guest.group_id, v_account, 'member', v_guest.user_id, 'updated', v_summary);
    end if;
  end loop;
  update bausplit_private.account_links set completed_at = now() where guest_id = p_guest_id;
end;
$$;

revoke all on function public.authorize_guest_link(uuid), public.link_guest_groups(uuid),
  public.add_group_participant(uuid,text), public.accept_group_invite(text,uuid,text),
  public.get_invite_preview(text), public.create_expense_group(text,text,text,text[]) from public, anon;
grant execute on function public.authorize_guest_link(uuid), public.link_guest_groups(uuid),
  public.add_group_participant(uuid,text) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Permessi ruoli
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;
-- Le appartenenze, i link e le quote passano dalle funzioni controllate sopra.
revoke all on public.profiles, public.expense_groups, public.group_members, public.expenses,
  public.expense_splits, public.activity_logs, public.settlements, public.recurring_expenses,
  public.group_categories from public, anon, authenticated;
-- Ai membri servono i nomi, non gli indirizzi email degli altri.
-- ensure_current_profile restituisce l'email completa solo al suo titolare.
grant select (id, display_name), update (display_name) on public.profiles to authenticated;
grant select, update (name, description) on public.expense_groups to authenticated;
grant select on public.group_members to authenticated;
grant select on public.group_categories to authenticated; -- modifiche solo tramite le RPC delle categorie
grant select, insert, update, delete on public.recurring_expenses to authenticated;
grant select on public.expenses to authenticated;
grant select on public.expense_splits to authenticated;
grant select, insert, update, delete on public.settlements to authenticated;
grant select, insert on public.activity_logs to authenticated;

grant execute on function public.ensure_current_profile() to authenticated;
grant execute on function public.is_active_group_member(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.create_expense_group(text, text, text, text[]) to authenticated;
grant execute on function public.get_invite_preview(text) to authenticated;
grant execute on function public.accept_group_invite(text, uuid, text) to authenticated;
grant execute on function public.regenerate_group_invite(uuid) to authenticated;
grant execute on function public.set_group_invite_enabled(uuid, boolean) to authenticated;
grant execute on function public.save_expense(uuid, uuid, text, numeric, text, numeric, date, boolean, numeric, date, text, text, uuid, text, text, jsonb, text, text, jsonb, uuid, date) to authenticated;
grant execute on function public.delete_expense(uuid, text, jsonb) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.close_expense_group(uuid, uuid, jsonb, numeric, date, boolean, jsonb) to authenticated;
grant execute on function public.reopen_expense_group(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Realtime per sincronizzazione istantanea tra membri
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'expense_groups',
    'group_members',
    'group_categories',
    'recurring_expenses',
    'expenses',
    'expense_splits',
    'settlements',
    'activity_logs'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;

notify pgrst, 'reload schema';
commit;
`;export{e as default};
