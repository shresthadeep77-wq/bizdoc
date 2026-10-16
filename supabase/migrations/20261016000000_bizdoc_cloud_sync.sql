-- BizDoc cloud sync — private, per-user storage for businesses, customers,
-- products and documents.
--
-- Additive only: creates four tables, two RPC functions and one trigger
-- function. It drops nothing and touches no existing objects, so running it on
-- a project that already has other tables is safe. Run it once, in the SQL
-- editor or with `supabase db push`. See SUPABASE_SETUP.md.
--
-- Shape of the data
-- -----------------
-- The app keeps each record as one JSON object and runs every calculation —
-- VAT-inclusive rates, the 13% default, discounts, totals — in the browser.
-- Each row stores that object verbatim in `data` (jsonb keeps numbers as exact
-- decimals, so nothing is rounded on the way through), plus the columns the
-- database needs to enforce ownership, integrity and sync:
--
--   id          stable identity, generated on the device that created the
--               record, so an offline record has its final id before upload
--   owner_id    the Supabase user; every policy below keys off this
--   local_id    the app's own numeric id (customer 1001 is "Client No. C1001")
--               — unique per owner so two devices cannot both claim it
--   version     bumped by the trigger on every write; the client sends the
--               version it last saw and the write is refused if it is stale,
--               which is how conflicts are detected instead of overwritten
--   deleted     tombstone — deletions must reach the other devices, and the
--               last contents stay recoverable
--
-- Line items stay inside their document's `data`: they are a snapshot taken
-- when the document was made (the product's rate can change later, the
-- invoice must not), and they are always read and written with it.
--
-- Cross-user references are impossible by construction: children point at
-- their parent through (owner_id, parent_id), so the parent must belong to the
-- same user. Foreign-key checks are not subject to RLS, which is why the owner
-- has to be part of the key rather than left to the policies.

begin;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.bizdoc_businesses (
  id          uuid        primary key,
  owner_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  local_id    bigint      not null,
  data        jsonb       not null,
  version     integer     not null default 1,
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bizdoc_businesses_owner_local_id_key unique (owner_id, local_id),
  constraint bizdoc_businesses_owner_id_key unique (owner_id, id),
  constraint bizdoc_businesses_data_is_object check (jsonb_typeof(data) = 'object'),
  -- Logos, stamps and signatures live in the business record as images, so it
  -- is the largest row by far. 5 MB is well past any real one and stops a
  -- runaway client from filling the database.
  constraint bizdoc_businesses_data_size check (pg_column_size(data) <= 5242880)
);

create table if not exists public.bizdoc_customers (
  id          uuid        primary key,
  owner_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  business_id uuid        not null,
  local_id    bigint      not null,
  data        jsonb       not null,
  version     integer     not null default 1,
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bizdoc_customers_owner_local_id_key unique (owner_id, local_id),
  constraint bizdoc_customers_owner_id_key unique (owner_id, id),
  constraint bizdoc_customers_business_fkey foreign key (owner_id, business_id)
    references public.bizdoc_businesses (owner_id, id) on delete cascade,
  constraint bizdoc_customers_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint bizdoc_customers_data_size check (pg_column_size(data) <= 1048576)
);

create table if not exists public.bizdoc_products (
  id          uuid        primary key,
  owner_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  business_id uuid        not null,
  local_id    bigint      not null,
  data        jsonb       not null,
  version     integer     not null default 1,
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bizdoc_products_owner_local_id_key unique (owner_id, local_id),
  constraint bizdoc_products_business_fkey foreign key (owner_id, business_id)
    references public.bizdoc_businesses (owner_id, id) on delete cascade,
  constraint bizdoc_products_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint bizdoc_products_data_size check (pg_column_size(data) <= 1048576)
);

create table if not exists public.bizdoc_documents (
  id          uuid        primary key,
  owner_id    uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  business_id uuid        not null,
  -- Nullable: a draft can exist before a customer is picked, and a document
  -- outlives its customer being removed.
  customer_id uuid,
  local_id    bigint      not null,
  data        jsonb       not null,
  version     integer     not null default 1,
  deleted     boolean     not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint bizdoc_documents_owner_local_id_key unique (owner_id, local_id),
  constraint bizdoc_documents_business_fkey foreign key (owner_id, business_id)
    references public.bizdoc_businesses (owner_id, id) on delete cascade,
  -- SET NULL on just the one column: plain SET NULL would also null owner_id.
  constraint bizdoc_documents_customer_fkey foreign key (owner_id, customer_id)
    references public.bizdoc_customers (owner_id, id) on delete set null (customer_id),
  constraint bizdoc_documents_data_is_object check (jsonb_typeof(data) = 'object'),
  constraint bizdoc_documents_data_size check (pg_column_size(data) <= 2097152)
);

-- Pulls read "everything of mine changed since X", in (updated_at, id) order.
create index if not exists bizdoc_businesses_sync_idx on public.bizdoc_businesses (owner_id, updated_at, id);
create index if not exists bizdoc_customers_sync_idx  on public.bizdoc_customers  (owner_id, updated_at, id);
create index if not exists bizdoc_products_sync_idx   on public.bizdoc_products   (owner_id, updated_at, id);
create index if not exists bizdoc_documents_sync_idx  on public.bizdoc_documents  (owner_id, updated_at, id);
-- Foreign-key columns, so cascades and parent lookups do not scan.
create index if not exists bizdoc_customers_business_idx on public.bizdoc_customers (owner_id, business_id);
create index if not exists bizdoc_products_business_idx  on public.bizdoc_products  (owner_id, business_id);
create index if not exists bizdoc_documents_business_idx on public.bizdoc_documents (owner_id, business_id);
create index if not exists bizdoc_documents_customer_idx on public.bizdoc_documents (owner_id, customer_id);

-- ---------------------------------------------------------------------------
-- Version and timestamps are the server's, never the client's
-- ---------------------------------------------------------------------------

create or replace function public.bizdoc_touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.version := 1;
    new.created_at := now();
    new.updated_at := now();
  else
    -- A record cannot be handed to another account or change identity. RLS
    -- WITH CHECK already refuses a different owner; this also covers the
    -- service role, which bypasses RLS.
    if new.owner_id is distinct from old.owner_id then
      raise exception 'owner_id cannot be changed' using errcode = '42501';
    end if;
    if new.id is distinct from old.id then
      raise exception 'id cannot be changed' using errcode = '42501';
    end if;
    new.version := old.version + 1;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.bizdoc_touch_row() from public, anon, authenticated;

drop trigger if exists bizdoc_businesses_touch on public.bizdoc_businesses;
create trigger bizdoc_businesses_touch before insert or update on public.bizdoc_businesses
  for each row execute function public.bizdoc_touch_row();
drop trigger if exists bizdoc_customers_touch on public.bizdoc_customers;
create trigger bizdoc_customers_touch before insert or update on public.bizdoc_customers
  for each row execute function public.bizdoc_touch_row();
drop trigger if exists bizdoc_products_touch on public.bizdoc_products;
create trigger bizdoc_products_touch before insert or update on public.bizdoc_products
  for each row execute function public.bizdoc_touch_row();
drop trigger if exists bizdoc_documents_touch on public.bizdoc_documents;
create trigger bizdoc_documents_touch before insert or update on public.bizdoc_documents
  for each row execute function public.bizdoc_touch_row();

-- ---------------------------------------------------------------------------
-- Row Level Security — every row belongs to exactly one user
-- ---------------------------------------------------------------------------
-- `(select auth.uid())` rather than `auth.uid()` so Postgres evaluates it once
-- per statement instead of once per row.

alter table public.bizdoc_businesses enable row level security;
alter table public.bizdoc_customers  enable row level security;
alter table public.bizdoc_products   enable row level security;
alter table public.bizdoc_documents  enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['bizdoc_businesses', 'bizdoc_customers', 'bizdoc_products', 'bizdoc_documents'] loop
    execute format('drop policy if exists "Owners can read their rows" on public.%I', t);
    execute format('drop policy if exists "Owners can insert their rows" on public.%I', t);
    execute format('drop policy if exists "Owners can update their rows" on public.%I', t);
    execute format('drop policy if exists "Owners can delete their rows" on public.%I', t);

    execute format($p$create policy "Owners can read their rows" on public.%I
      for select to authenticated
      using ((select auth.uid()) = owner_id)$p$, t);
    execute format($p$create policy "Owners can insert their rows" on public.%I
      for insert to authenticated
      with check ((select auth.uid()) = owner_id)$p$, t);
    -- USING picks which rows can be targeted; WITH CHECK stops the new row
    -- being given away to another owner.
    execute format($p$create policy "Owners can update their rows" on public.%I
      for update to authenticated
      using ((select auth.uid()) = owner_id)
      with check ((select auth.uid()) = owner_id)$p$, t);
    execute format($p$create policy "Owners can delete their rows" on public.%I
      for delete to authenticated
      using ((select auth.uid()) = owner_id)$p$, t);

    -- Policies only filter what a role is already granted. Signed-out
    -- visitors (anon) get nothing at all; signed-in users get exactly the four
    -- verbs, and the policies narrow those to their own rows.
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- bizdoc_push — apply a batch of writes, each one judged on its own
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: runs as the calling user, so every statement inside is
-- subject to the same RLS policies as a direct table write. It exists so a
-- bulk change (a CSV import, a bulk rate update) is a few requests instead of
-- thousands, while each record still gets its own optimistic version check.
--
-- p_ops is an array of
--   { op: "insert" | "update" | "delete", id, local_id, data,
--     business_id, customer_id, base_version }
-- and the result is one entry per op:
--   { id, status: "ok",       version, updated_at }
--   { id, status: "conflict", row }   stale base_version; row is the current one (or null)
--   { id, status: "exists",   row }   insert of an id that already exists (a retry)
--   { id, status: "id_taken" }        local_id already used by a different record
--   { id, status: "error",    code, message }

create or replace function public.bizdoc_push(p_table text, p_ops jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_uid        uuid := auth.uid();
  v_op         jsonb;
  v_out        jsonb := '[]'::jsonb;
  v_res        jsonb;
  v_cur        jsonb;
  v_id         uuid;
  v_kind       text;
  v_has_biz    boolean := p_table <> 'bizdoc_businesses';
  v_has_cust   boolean := p_table = 'bizdoc_documents';
  v_set_refs   text;
  v_constraint text;
  v_state      text;
  v_msg        text;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_table not in ('bizdoc_businesses', 'bizdoc_customers', 'bizdoc_products', 'bizdoc_documents') then
    raise exception 'Unknown table %', p_table using errcode = '22023';
  end if;
  if jsonb_typeof(p_ops) is distinct from 'array' then
    raise exception 'p_ops must be an array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_ops) > 500 then
    raise exception 'At most 500 operations per call' using errcode = '22023';
  end if;

  v_set_refs := case when v_has_biz then ', business_id = $5' else '' end
             || case when v_has_cust then ', customer_id = $6' else '' end;

  for v_op in select value from jsonb_array_elements(p_ops) loop
    v_res := null;
    v_cur := null;
    v_id := null;
    v_kind := v_op->>'op';
    begin
      v_id := (v_op->>'id')::uuid;
      if v_id is null then
        raise exception 'id is required' using errcode = '22023';
      end if;

      if v_kind = 'insert' then
        execute format(
          'insert into public.%I (id, owner_id, local_id, data%s%s) values ($1, $2, $3, $4%s%s)
           returning jsonb_build_object(''version'', version, ''updated_at'', updated_at)',
          p_table,
          case when v_has_biz then ', business_id' else '' end,
          case when v_has_cust then ', customer_id' else '' end,
          case when v_has_biz then ', $5' else '' end,
          case when v_has_cust then ', $6' else '' end)
        into v_res
        using v_id, v_uid, (v_op->>'local_id')::bigint, v_op->'data',
              (v_op->>'business_id')::uuid, (v_op->>'customer_id')::uuid;

      elsif v_kind = 'update' then
        execute format(
          'update public.%I set local_id = $3, data = $4, deleted = false%s
            where id = $1 and owner_id = $2 and version = $7
           returning jsonb_build_object(''version'', version, ''updated_at'', updated_at)',
          p_table, v_set_refs)
        into v_res
        using v_id, v_uid, (v_op->>'local_id')::bigint, v_op->'data',
              (v_op->>'business_id')::uuid, (v_op->>'customer_id')::uuid,
              (v_op->>'base_version')::integer;

      elsif v_kind = 'delete' then
        -- Soft delete. The contents stay, so a mistaken delete can be
        -- recovered and every other device learns the record is gone.
        execute format(
          'update public.%I set deleted = true
            where id = $1 and owner_id = $2 and version = $3
           returning jsonb_build_object(''version'', version, ''updated_at'', updated_at)',
          p_table)
        into v_res
        using v_id, v_uid, (v_op->>'base_version')::integer;

      else
        raise exception 'Unknown op %', v_kind using errcode = '22023';
      end if;

      if v_res is null then
        -- Nothing matched: someone else wrote first (or the row is gone).
        execute format(
          'select jsonb_build_object(''id'', id, ''local_id'', local_id, ''data'', data,
                  ''version'', version, ''deleted'', deleted, ''updated_at'', updated_at)
             from public.%I where id = $1 and owner_id = $2', p_table)
        into v_cur using v_id, v_uid;
        v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'conflict', 'row', v_cur));
      else
        v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'ok') || v_res);
      end if;

    exception
      when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint like '%local_id%' then
          v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'id_taken'));
        else
          -- The id exists. If it is ours this is a retried insert whose first
          -- response never arrived; if it is someone else's, RLS hides it and
          -- row comes back null, telling the client to pick a new id.
          execute format(
            'select jsonb_build_object(''id'', id, ''local_id'', local_id, ''data'', data,
                    ''version'', version, ''deleted'', deleted, ''updated_at'', updated_at)
               from public.%I where id = $1 and owner_id = $2', p_table)
          into v_cur using v_id, v_uid;
          v_out := v_out || jsonb_build_array(jsonb_build_object('id', v_id, 'status', 'exists', 'row', v_cur));
        end if;
      when others then
        get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
        v_out := v_out || jsonb_build_array(jsonb_build_object(
          'id', v_id, 'status', 'error', 'code', v_state, 'message', v_msg));
    end;
  end loop;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------------
-- bizdoc_pull — my rows changed after a point, in a stable order
-- ---------------------------------------------------------------------------
-- Keyset pagination on (updated_at, id): one bulk write stamps many rows with
-- the same updated_at, so the id breaks ties and no row is skipped between
-- pages. Also SECURITY INVOKER, so RLS applies as usual.

create or replace function public.bizdoc_pull(
  p_table text,
  p_since timestamptz default null,
  p_after uuid default null,
  p_limit integer default 500
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_out jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_table not in ('bizdoc_businesses', 'bizdoc_customers', 'bizdoc_products', 'bizdoc_documents') then
    raise exception 'Unknown table %', p_table using errcode = '22023';
  end if;

  execute format(
    'select coalesce(jsonb_agg(jsonb_build_object(
              ''id'', r.id, ''local_id'', r.local_id, ''data'', r.data, ''version'', r.version,
              ''deleted'', r.deleted, ''updated_at'', r.updated_at) order by r.updated_at, r.id), ''[]''::jsonb)
       from (select id, local_id, data, version, deleted, updated_at
               from public.%I
              where owner_id = auth.uid()
                and (updated_at, id) > ($1, $2)
              order by updated_at, id
              limit $3) r', p_table)
  into v_out
  using coalesce(p_since, '-infinity'::timestamptz),
        coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid),
        least(greatest(coalesce(p_limit, 500), 1), 1000);

  return v_out;
end;
$$;

revoke all on function public.bizdoc_push(text, jsonb) from public, anon;
revoke all on function public.bizdoc_pull(text, timestamptz, uuid, integer) from public, anon;
grant execute on function public.bizdoc_push(text, jsonb) to authenticated;
grant execute on function public.bizdoc_pull(text, timestamptz, uuid, integer) to authenticated;

commit;
