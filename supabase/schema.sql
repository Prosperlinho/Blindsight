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

create index if not exists vaults_created_at_idx on public.vaults (created_at desc);

alter table public.vaults enable row level security;
grant select, insert on public.vaults to anon;

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

-- Make PostgREST pick up new columns immediately.
notify pgrst, 'reload schema';
