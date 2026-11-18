-- =============================================================================
-- Conti Insieme — Schema completo Supabase (PostgreSQL + RLS + RPC + Realtime)
-- =============================================================================
-- Istruzioni:
-- 1. Apri la dashboard di Supabase -> SQL Editor -> New query
-- 2. Incolla tutto questo file e clicca "Run"
-- 3. Lo script è idempotente: può essere rieseguito in sicurezza senza perdere dati.
--    (Non elimina la vecchia tabella `activities`, se presente.)
-- =============================================================================

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

-- Membri dei gruppi (`left_at is null` = membro attivo; se valorizzato conserva lo storico e il saldo)
create table if not exists public.group_members (
  group_id uuid not null references public.expense_groups(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  primary key (group_id, user_id)
);

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
  paid_by uuid not null references public.profiles(id),
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
  paid_by uuid not null references public.profiles(id),
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
  user_id uuid not null references public.profiles(id),
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
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
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
    split_part(coalesce(new.email, 'Utente'), '@', 1)
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
      split_part(coalesce(u.email, 'Utente'), '@', 1)
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

  select * into v_profile from public.profiles where id = v_uid;
  if found then
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
        split_part(coalesce(u.email, 'Utente'), '@', 1)
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
      and gm.user_id = auth.uid()
      and gm.left_at is null
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
      where me.user_id = auth.uid()
        and me.left_at is null
        and other_m.user_id = p_target_user
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
  using (public.is_active_group_member(id))
  with check (public.is_active_group_member(id));

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
  with check (public.is_active_group_member(group_id) and created_by = auth.uid());

drop policy if exists group_categories_update on public.group_categories;
create policy group_categories_update on public.group_categories
  for update to authenticated
  using (public.is_active_group_member(group_id))
  with check (public.is_active_group_member(group_id));

drop policy if exists group_categories_delete on public.group_categories;
create policy group_categories_delete on public.group_categories
  for delete to authenticated
  using (public.is_active_group_member(group_id));

-- recurring_expenses
drop policy if exists recurring_expenses_select on public.recurring_expenses;
create policy recurring_expenses_select on public.recurring_expenses
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists recurring_expenses_insert on public.recurring_expenses;
create policy recurring_expenses_insert on public.recurring_expenses
  for insert to authenticated
  with check (
    public.is_active_group_member(group_id)
    and created_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists recurring_expenses_update on public.recurring_expenses;
create policy recurring_expenses_update on public.recurring_expenses
  for update to authenticated
  using (public.is_active_group_member(group_id))
  with check (public.is_active_group_member(group_id) and updated_by = auth.uid());

drop policy if exists recurring_expenses_delete on public.recurring_expenses;
create policy recurring_expenses_delete on public.recurring_expenses
  for delete to authenticated
  using (public.is_active_group_member(group_id));

-- expenses
drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists expenses_insert on public.expenses;
create policy expenses_insert on public.expenses
  for insert to authenticated
  with check (
    public.is_active_group_member(group_id)
    and created_by = auth.uid()
    and updated_by = auth.uid()
  );

drop policy if exists expenses_update on public.expenses;
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.is_active_group_member(group_id))
  with check (public.is_active_group_member(group_id) and updated_by = auth.uid());

drop policy if exists expenses_delete on public.expenses;
create policy expenses_delete on public.expenses
  for delete to authenticated
  using (public.is_active_group_member(group_id));

-- expense_splits
drop policy if exists expense_splits_select on public.expense_splits;
create policy expense_splits_select on public.expense_splits
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists expense_splits_insert on public.expense_splits;
create policy expense_splits_insert on public.expense_splits
  for insert to authenticated
  with check (public.is_active_group_member(group_id));

drop policy if exists expense_splits_update on public.expense_splits;
create policy expense_splits_update on public.expense_splits
  for update to authenticated
  using (public.is_active_group_member(group_id))
  with check (public.is_active_group_member(group_id));

drop policy if exists expense_splits_delete on public.expense_splits;
create policy expense_splits_delete on public.expense_splits
  for delete to authenticated
  using (public.is_active_group_member(group_id));

-- settlements
drop policy if exists settlements_select on public.settlements;
create policy settlements_select on public.settlements
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists settlements_insert on public.settlements;
create policy settlements_insert on public.settlements
  for insert to authenticated
  with check (
    public.is_active_group_member(group_id)
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
  using (public.is_active_group_member(group_id))
  with check (
    public.is_active_group_member(group_id)
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
  using (public.is_active_group_member(group_id));

-- activity_logs (sola lettura + append per i membri attivi; nessuna modifica/cancellazione)
drop policy if exists activity_logs_select on public.activity_logs;
create policy activity_logs_select on public.activity_logs
  for select to authenticated
  using (public.is_active_group_member(group_id));

drop policy if exists activity_logs_insert on public.activity_logs;
create policy activity_logs_insert on public.activity_logs
  for insert to authenticated
  with check (public.is_active_group_member(group_id) and actor_id = auth.uid());

-- -----------------------------------------------------------------------------
-- 6. Funzioni RPC atomiche (Gruppi, Inviti, Spese, Uscita, Chiusura con riporto saldo)
-- -----------------------------------------------------------------------------

-- Creazione nuovo gruppo
create or replace function public.create_expense_group(
  p_name text,
  p_description text default '',
  p_base_currency text default 'EUR'
)
returns public.expense_groups
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_group public.expense_groups;
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

  insert into public.group_members (group_id, user_id)
  values (v_group.id, v_profile.id);

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
      and gm.user_id = v_uid
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
    'already_member', v_already_member
  );
end;
$$;

-- Accettazione esplicita dell'invito a un gruppo
create or replace function public.accept_group_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.profiles;
  v_group public.expense_groups;
  v_was_active boolean;
begin
  v_profile := public.ensure_current_profile();

  select * into v_group
  from public.expense_groups
  where invite_token = trim(coalesce(p_token, ''));

  if not found then
    raise exception 'Questo link d''invito non è valido o è stato rigenerato';
  end if;

  if v_group.closed_at is not null then
    raise exception 'Questo gruppo è stato chiuso e non accetta nuovi membri';
  end if;

  if not v_group.invite_enabled then
    raise exception 'Il link d''invito per questo gruppo è attualmente disattivato';
  end if;

  select exists (
    select 1
    from public.group_members gm
    where gm.group_id = v_group.id
      and gm.user_id = v_profile.id
      and gm.left_at is null
  ) into v_was_active;

  if v_was_active then
    return v_group.id;
  end if;

  insert into public.group_members (group_id, user_id, joined_at, left_at)
  values (v_group.id, v_profile.id, now(), null)
  on conflict (group_id, user_id) do update
    set joined_at = now(),
        left_at = null;

  insert into public.activity_logs (group_id, actor_id, entity_type, entity_id, action, summary, changes)
  values (
    v_group.id,
    v_profile.id,
    'member',
    v_profile.id,
    'joined',
    format('%s ha accettato l''invito ed è entrato nel gruppo', v_profile.display_name),
    jsonb_build_object('member_name', v_profile.display_name)
  );

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

  select closed_at into v_closed_at from public.expense_groups where id = p_group_id;
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

  select closed_at into v_closed_at from public.expense_groups where id = v_group_id;
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
begin
  v_profile := public.ensure_current_profile();

  if not public.is_active_group_member(p_group_id) then
    raise exception 'Non fai parte di questo gruppo';
  end if;

  select * into v_group from public.expense_groups where id = p_group_id;

  select coalesce(sum(base_amount), 0) into v_paid
  from public.expenses
  where group_id = p_group_id and paid_by = v_profile.id;

  select coalesce(sum(base_amount), 0) into v_owed
  from public.expense_splits
  where group_id = p_group_id and user_id = v_profile.id;

  select coalesce(sum(base_amount), 0) into v_sent
  from public.settlements
  where group_id = p_group_id and from_user = v_profile.id;

  select coalesce(sum(base_amount), 0) into v_received
  from public.settlements
  where group_id = p_group_id and to_user = v_profile.id;

  v_net := round(v_paid - v_owed + v_sent - v_received, 2);

  update public.group_members
  set left_at = now()
  where group_id = p_group_id
    and user_id = v_profile.id;

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
    v_profile.id,
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
  v_src_amt numeric(14,2);
  v_dst_amt numeric(14,2);
  v_fx numeric(18,8);
  v_count integer := 0;
begin
  if not public.is_active_group_member(p_source_group_id) then
    raise exception 'Non fai parte di questo gruppo';
  end if;

  select * into v_source from public.expense_groups where id = p_source_group_id;
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

    select * into v_target from public.expense_groups where id = p_target_group_id;
    if not found then
      raise exception 'Gruppo di destinazione non trovato';
    end if;

    if v_target.closed_at is not null then
      raise exception 'Il gruppo di destinazione è chiuso: scegli un gruppo attivo';
    end if;

    if jsonb_typeof(p_transfers) <> 'array' or jsonb_array_length(p_transfers) < 1 then
      raise exception 'Non ci sono saldi rimanenti da trasferire';
    end if;

    if p_exchange_rate is null or p_exchange_rate <= 0 then
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

      if v_debtor = v_creditor or v_src_amt <= 0 or v_dst_amt <= 0 then
        raise exception 'Dati di trasferimento saldo non validi';
      end if;

      -- Verifica che entrambi gli utenti coinvolti siano membri attivi del gruppo di destinazione
      if not exists (
        select 1 from public.group_members gm
        where gm.group_id = v_target.id and gm.user_id = v_debtor and gm.left_at is null
      ) or not exists (
        select 1 from public.group_members gm
        where gm.group_id = v_target.id and gm.user_id = v_creditor and gm.left_at is null
      ) then
        raise exception 'Tutti gli utenti coinvolti nel saldo rimanente devono far parte del gruppo "%s"', v_target.name;
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
        v_target.id, v_creditor, v_debtor, v_src_amt, v_source.base_currency,
        v_fx, coalesce(p_rate_date, current_date),
        case when v_source.base_currency = v_target.base_currency then false else coalesce(p_rate_is_manual, false) end,
        v_dst_amt,
        current_date, 'transfer_in', v_source.name,
        format('Saldo riportato dalla chiusura di "%s"', v_source.name),
        v_uid, v_uid
      );

      v_count := v_count + 1;
    end loop;

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

-- -----------------------------------------------------------------------------
-- 7. Permessi ruoli
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, update on public.expense_groups to authenticated;
grant select on public.group_members to authenticated;
grant select, insert, update, delete on public.group_categories to authenticated;
grant select, insert, update, delete on public.recurring_expenses to authenticated;
grant select, insert, update, delete on public.expenses to authenticated;
grant select, insert, update, delete on public.expense_splits to authenticated;
grant select, insert, update, delete on public.settlements to authenticated;
grant select, insert on public.activity_logs to authenticated;

grant execute on function public.ensure_current_profile() to authenticated;
grant execute on function public.is_active_group_member(uuid) to authenticated;
grant execute on function public.shares_group_with(uuid) to authenticated;
grant execute on function public.create_expense_group(text, text, text) to authenticated;
grant execute on function public.get_invite_preview(text) to authenticated;
grant execute on function public.accept_group_invite(text) to authenticated;
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
