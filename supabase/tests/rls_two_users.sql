-- Row Level Security test for the BizDoc tables, using two real users.
--
-- Paste the whole file into the Supabase SQL editor and run it after the
-- migration. It creates two throwaway users, acts as each of them in turn
-- exactly the way a signed-in browser would (role `authenticated` plus a JWT
-- `sub` claim), and checks every rule. Everything runs inside one transaction
-- that ends in ROLLBACK, so nothing is left behind.
--
-- Success: the last statement returns one row, "ALL RLS CHECKS PASSED".
-- Failure: the run stops at the first broken rule with "FAIL: ...".
--
-- tools/test-rls.mjs runs this same file against a local Postgres.

begin;

insert into auth.users (id, email, aud, role) values
  ('a0000000-0000-4000-8000-00000000000a', 'rls-user-a@example.invalid', 'authenticated', 'authenticated'),
  ('b0000000-0000-4000-8000-00000000000b', 'rls-user-b@example.invalid', 'authenticated', 'authenticated');

-- ---- act as user A ---------------------------------------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);

insert into public.bizdoc_businesses (id, local_id, data, version)
  values ('11111111-1111-4111-8111-111111111111', 1, '{"name":"A Traders","taxRate":13}', 99);
insert into public.bizdoc_customers (id, business_id, local_id, data)
  values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 1001, '{"companyName":"A customer"}');
insert into public.bizdoc_products (id, business_id, local_id, data)
  values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 1, '{"description":"Pipe","rate":113.00,"rateIncludesVat":true}');
insert into public.bizdoc_documents (id, business_id, customer_id, local_id, data)
  values ('44444444-4444-4444-8444-444444444444', '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222', 1, '{"number":"INV-0001","totals":{"total":113.00}}');

do $$
begin
  if (select count(*) from public.bizdoc_businesses) <> 1 then raise exception 'FAIL: A cannot see own business'; end if;
  if (select count(*) from public.bizdoc_documents) <> 1 then raise exception 'FAIL: A cannot see own document'; end if;
  -- The trigger owns version, not the client (A sent 99).
  if (select version from public.bizdoc_businesses) <> 1 then raise exception 'FAIL: client-supplied version was accepted'; end if;
  -- jsonb keeps decimals exact.
  if (select data->>'rate' from public.bizdoc_products) <> '113.00' then raise exception 'FAIL: rate not stored exactly'; end if;
end $$;

-- A cannot create a row owned by B.
do $$
begin
  insert into public.bizdoc_businesses (id, owner_id, local_id, data)
    values ('11111111-1111-4111-8111-999999999999', 'b0000000-0000-4000-8000-00000000000b', 2, '{}');
  raise exception 'FAIL: A inserted a row owned by B';
exception when insufficient_privilege then null;
end $$;

-- A cannot hand its own row to B.
do $$
begin
  update public.bizdoc_businesses set owner_id = 'b0000000-0000-4000-8000-00000000000b'
   where id = '11111111-1111-4111-8111-111111111111';
  raise exception 'FAIL: A transferred a row to B';
exception when insufficient_privilege then null;
end $$;

-- Optimistic versioning through the RPC: a stale version is refused, the
-- current one is accepted and bumps the version.
do $$
declare r jsonb;
begin
  r := public.bizdoc_push('bizdoc_products', '[{"op":"update","id":"33333333-3333-4333-8333-333333333333","local_id":1,
        "business_id":"11111111-1111-4111-8111-111111111111","data":{"description":"Pipe","rate":120},"base_version":7}]');
  if r->0->>'status' <> 'conflict' then raise exception 'FAIL: stale update not refused: %', r; end if;
  if (r->0->'row'->>'version')::int <> 1 then raise exception 'FAIL: conflict did not return current row: %', r; end if;

  r := public.bizdoc_push('bizdoc_products', '[{"op":"update","id":"33333333-3333-4333-8333-333333333333","local_id":1,
        "business_id":"11111111-1111-4111-8111-111111111111","data":{"description":"Pipe","rate":120},"base_version":1}]');
  if r->0->>'status' <> 'ok' or (r->0->>'version')::int <> 2 then raise exception 'FAIL: current-version update: %', r; end if;

  -- A retried insert reports the existing row instead of duplicating it.
  r := public.bizdoc_push('bizdoc_products', '[{"op":"insert","id":"33333333-3333-4333-8333-333333333333","local_id":1,
        "business_id":"11111111-1111-4111-8111-111111111111","data":{"description":"Pipe"}}]');
  if r->0->>'status' <> 'exists' or r->0->'row' is null then raise exception 'FAIL: retried insert: %', r; end if;

  -- A second record cannot claim a local number already in use.
  r := public.bizdoc_push('bizdoc_products', '[{"op":"insert","id":"33333333-3333-4333-8333-000000000002","local_id":1,
        "business_id":"11111111-1111-4111-8111-111111111111","data":{"description":"Other"}}]');
  if r->0->>'status' <> 'id_taken' then raise exception 'FAIL: duplicate local_id: %', r; end if;

  -- Soft delete keeps a tombstone that pulls still return.
  r := public.bizdoc_push('bizdoc_products', '[{"op":"delete","id":"33333333-3333-4333-8333-333333333333","base_version":2}]');
  if r->0->>'status' <> 'ok' then raise exception 'FAIL: delete: %', r; end if;
  r := public.bizdoc_pull('bizdoc_products', null, null, 100);
  if jsonb_array_length(r) <> 1 or (r->0->>'deleted')::boolean is not true then raise exception 'FAIL: tombstone not pulled: %', r; end if;
end $$;

-- ---- act as user B ---------------------------------------------------------
select set_config('request.jwt.claims', '{"sub":"b0000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);

do $$
declare n int; r jsonb;
begin
  -- B sees none of A's rows, directly or through the RPC.
  if (select count(*) from public.bizdoc_businesses) <> 0 then raise exception 'FAIL: B can read A''s businesses'; end if;
  if (select count(*) from public.bizdoc_customers)  <> 0 then raise exception 'FAIL: B can read A''s customers'; end if;
  if (select count(*) from public.bizdoc_products)   <> 0 then raise exception 'FAIL: B can read A''s products'; end if;
  if (select count(*) from public.bizdoc_documents)  <> 0 then raise exception 'FAIL: B can read A''s documents'; end if;
  if jsonb_array_length(public.bizdoc_pull('bizdoc_documents', null, null, 100)) <> 0 then raise exception 'FAIL: B pulled A''s documents'; end if;

  -- B cannot change or delete A's rows.
  update public.bizdoc_documents set data = '{"hacked":true}' where id = '44444444-4444-4444-8444-444444444444';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s document'; end if;
  delete from public.bizdoc_customers where id = '22222222-2222-4222-8222-222222222222';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A''s customer'; end if;

  r := public.bizdoc_push('bizdoc_documents', '[{"op":"update","id":"44444444-4444-4444-8444-444444444444","local_id":1,
        "business_id":"11111111-1111-4111-8111-111111111111","data":{"hacked":true},"base_version":1}]');
  if r->0->>'status' <> 'conflict' or r->0->'row' <> 'null'::jsonb then raise exception 'FAIL: B updated A''s row via RPC: %', r; end if;
  r := public.bizdoc_push('bizdoc_documents', '[{"op":"delete","id":"44444444-4444-4444-8444-444444444444","base_version":1}]');
  if r->0->>'status' <> 'conflict' then raise exception 'FAIL: B deleted A''s row via RPC: %', r; end if;
  -- Re-using A's id tells B nothing about A's row.
  r := public.bizdoc_push('bizdoc_businesses', '[{"op":"insert","id":"11111111-1111-4111-8111-111111111111","local_id":1,"data":{}}]');
  if r->0->>'status' <> 'exists' or r->0->'row' <> 'null'::jsonb then raise exception 'FAIL: B learned about A''s row: %', r; end if;
end $$;

-- B cannot attach its records to A's business or customer.
do $$
begin
  insert into public.bizdoc_customers (id, business_id, local_id, data)
    values ('22222222-2222-4222-8222-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111', 1001, '{}');
  raise exception 'FAIL: B attached a customer to A''s business';
exception when foreign_key_violation then null;
end $$;

insert into public.bizdoc_businesses (id, local_id, data)
  values ('11111111-1111-4111-8111-bbbbbbbbbbbb', 1, '{"name":"B Ltd"}');  -- same local number as A's: fine, per user

do $$
begin
  insert into public.bizdoc_documents (id, business_id, customer_id, local_id, data)
    values ('44444444-4444-4444-8444-bbbbbbbbbbbb', '11111111-1111-4111-8111-bbbbbbbbbbbb',
            '22222222-2222-4222-8222-222222222222', 1, '{}');
  raise exception 'FAIL: B linked a document to A''s customer';
exception when foreign_key_violation then null;
end $$;

-- A's data is untouched by everything B tried.
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
do $$
begin
  if (select data->>'number' from public.bizdoc_documents where id = '44444444-4444-4444-8444-444444444444') <> 'INV-0001'
    then raise exception 'FAIL: A''s document changed'; end if;
  if (select count(*) from public.bizdoc_customers) <> 1 then raise exception 'FAIL: A''s customer missing'; end if;
  if (select count(*) from public.bizdoc_businesses) <> 1 then raise exception 'FAIL: A sees B''s business'; end if;
end $$;

-- ---- signed out (anon) -----------------------------------------------------
reset role;
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
do $$
begin
  perform count(*) from public.bizdoc_documents;
  raise exception 'FAIL: anon can read documents';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.bizdoc_pull('bizdoc_documents', null, null, 10);
  raise exception 'FAIL: anon can call bizdoc_pull';
exception when insufficient_privilege then null;
end $$;

reset role;
rollback;

-- Only reached if nothing above raised.
select 'ALL RLS CHECKS PASSED' as result;
