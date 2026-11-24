create extension if not exists pgcrypto;

create table if not exists public.vaults (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text not null default '',
  price text not null,
  publisher_address text not null,
  payout_address text not null,
  file_reference text not null,
  created_at timestamptz not null default now()
);

-- Bring a table created by hand up to date. Safe to re-run.
alter table public.vaults add column if not exists description text not null default '';
alter table public.vaults add column if not exists payout_address text;
update public.vaults set payout_address = publisher_address where payout_address is null;
alter table public.vaults alter column payout_address set not null;
alter table public.vaults add column if not exists created_at timestamptz not null default now();

-- Publishing-fee transaction. Unique so one fee payment can publish only one vault.
alter table public.vaults add column if not exists publish_fee_tx text;
create unique index if not exists vaults_publish_fee_tx_key on public.vaults (publish_fee_tx);

create index if not exists vaults_created_at_idx on public.vaults (created_at desc);

alter table public.vaults enable row level security;
-- The server uses the anon key (never exposed to browsers). Unpublishing is
-- authorised in the API route by a NEAR wallet signature from the publisher.
grant select, insert, delete on public.vaults to anon;

drop policy if exists "BlindSight vaults are readable" on public.vaults;
create policy "BlindSight vaults are readable"
  on public.vaults for select to anon using (true);

drop policy if exists "BlindSight vaults can be published" on public.vaults;
create policy "BlindSight vaults can be published"
  on public.vaults for insert to anon with check (true);

insert into storage.buckets (id, name, public)
values ('vault-datasets', 'vault-datasets', false)
on conflict (id) do update set public = false;

drop policy if exists "BlindSight encrypted datasets are readable" on storage.objects;
create policy "BlindSight encrypted datasets are readable"
  on storage.objects for select to anon using (bucket_id = 'vault-datasets');

drop policy if exists "BlindSight encrypted datasets can be uploaded" on storage.objects;
create policy "BlindSight encrypted datasets can be uploaded"
  on storage.objects for insert to anon with check (bucket_id = 'vault-datasets');

drop policy if exists "BlindSight vaults can be unpublished" on public.vaults;
create policy "BlindSight vaults can be unpublished"
  on public.vaults for delete to anon using (true);

drop policy if exists "BlindSight encrypted datasets can be deleted" on storage.objects;
create policy "BlindSight encrypted datasets can be deleted"
  on storage.objects for delete to anon using (bucket_id = 'vault-datasets');

-- Admin activity log: one row per answered paid question, publish and
-- unpublish. Append-only (no update or delete grant), so it keeps the history
-- of vaults that were later removed. Read only through the password-protected
-- /api/admin/activity route.
create table if not exists public.activity_log (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('query', 'publish', 'unpublish')),
  account_id text not null,
  vault_id text,
  vault_title text,
  receiver_id text,
  amount_near text,
  payment_tx text,
  fee_near text,
  fee_tx text,
  created_at timestamptz not null default now()
);

-- A payment buys one answer and a publishing fee one vault, so each is logged once.
create unique index if not exists activity_log_payment_tx_key on public.activity_log (payment_tx);
create unique index if not exists activity_log_fee_tx_key on public.activity_log (fee_tx);
create index if not exists activity_log_created_at_idx on public.activity_log (created_at desc);

alter table public.activity_log enable row level security;
grant select, insert on public.activity_log to anon;

drop policy if exists "BlindSight activity is readable by the server" on public.activity_log;
create policy "BlindSight activity is readable by the server"
  on public.activity_log for select to anon using (true);

drop policy if exists "BlindSight activity can be recorded" on public.activity_log;
create policy "BlindSight activity can be recorded"
  on public.activity_log for insert to anon with check (true);

-- Make PostgREST pick up new columns immediately.
notify pgrst, 'reload schema';
