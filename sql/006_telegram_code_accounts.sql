begin;

create table if not exists public.telegram_code_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  account_email text not null,
  service_name text not null default 'Netflix',
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint telegram_code_accounts_owner_email_unique unique (owner_id, account_email),
  constraint telegram_code_accounts_email_not_empty check (length(trim(account_email)) > 3),
  constraint telegram_code_accounts_service_not_empty check (length(trim(service_name)) > 0)
);

create index if not exists telegram_code_accounts_email_idx
  on public.telegram_code_accounts (account_email);

create index if not exists telegram_code_accounts_owner_idx
  on public.telegram_code_accounts (owner_id);

create or replace function public.touch_telegram_code_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.account_email = lower(trim(new.account_email));
  new.service_name = trim(new.service_name);
  return new;
end;
$$;

drop trigger if exists telegram_code_accounts_touch_updated_at on public.telegram_code_accounts;
create trigger telegram_code_accounts_touch_updated_at
before insert or update on public.telegram_code_accounts
for each row
execute function public.touch_telegram_code_accounts_updated_at();

alter table public.telegram_code_accounts enable row level security;
alter table public.telegram_code_accounts replica identity full;

drop policy if exists "telegram_owner_select_own" on public.telegram_code_accounts;
create policy "telegram_owner_select_own"
on public.telegram_code_accounts
for select
to authenticated
using (owner_id = auth.uid());

drop policy if exists "telegram_owner_insert_own" on public.telegram_code_accounts;
create policy "telegram_owner_insert_own"
on public.telegram_code_accounts
for insert
to authenticated
with check (
  owner_id = auth.uid()
  and exists (
    select 1
    from public.profiles profile
    where profile.id = auth.uid()
      and profile.role = 'owner'
  )
);

drop policy if exists "telegram_owner_update_own" on public.telegram_code_accounts;
create policy "telegram_owner_update_own"
on public.telegram_code_accounts
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

drop policy if exists "telegram_owner_delete_own" on public.telegram_code_accounts;
create policy "telegram_owner_delete_own"
on public.telegram_code_accounts
for delete
to authenticated
using (owner_id = auth.uid());

create or replace function pg_temp.add_public_realtime_table(table_name text)
returns void
language plpgsql
as $realtime$
declare
  table_oid regclass;
begin
  table_oid := to_regclass('public.' || table_name);

  if table_oid is null then
    return;
  end if;

  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;

  if exists (
    select 1
    from pg_publication_rel rel
    join pg_publication pub on pub.oid = rel.prpubid
    where pub.pubname = 'supabase_realtime'
      and rel.prrelid = table_oid
  ) then
    return;
  end if;

  execute format('alter publication supabase_realtime add table %s', table_oid);
end;
$realtime$;

select pg_temp.add_public_realtime_table('telegram_code_accounts');

commit;
