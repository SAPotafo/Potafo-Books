-- Potafo Accounts - Supabase setup
-- Run this once: Supabase dashboard > SQL Editor > New query > paste > Run.

-- One row per saved item (for example "cashbook", "ledgers", and any future module).
create table if not exists public.potafo_store (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null
);

-- Lock the table: only signed-in users can touch it, the public (anon) cannot.
alter table public.potafo_store enable row level security;

drop policy if exists "signed-in users can read"   on public.potafo_store;
drop policy if exists "signed-in users can add"    on public.potafo_store;
drop policy if exists "signed-in users can change" on public.potafo_store;
drop policy if exists "signed-in users can remove" on public.potafo_store;

create policy "signed-in users can read"   on public.potafo_store for select to authenticated using (true);
create policy "signed-in users can add"    on public.potafo_store for insert to authenticated with check (true);
create policy "signed-in users can change" on public.potafo_store for update to authenticated using (true) with check (true);
create policy "signed-in users can remove" on public.potafo_store for delete to authenticated using (true);
