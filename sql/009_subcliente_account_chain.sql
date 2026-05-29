begin;

alter table public.profiles
  add column if not exists parent_id uuid references public.profiles(id) on delete set null,
  add column if not exists created_by_id uuid references public.profiles(id) on delete set null,
  add column if not exists onboarding_status text not null default 'active';

create index if not exists profiles_parent_id_idx on public.profiles(parent_id);
create index if not exists profiles_created_by_id_idx on public.profiles(created_by_id);
create index if not exists profiles_onboarding_status_idx on public.profiles(onboarding_status);

alter table public.service_accounts
  add column if not exists parent_account_id uuid references public.service_accounts(id) on delete cascade,
  add column if not exists root_account_id uuid references public.service_accounts(id) on delete cascade,
  add column if not exists assigned_by_id uuid references public.profiles(id) on delete set null,
  add column if not exists assignment_depth integer not null default 0;

update public.service_accounts
set
  root_account_id = id,
  assigned_by_id = owner_id,
  assignment_depth = 0
where root_account_id is null;

update public.service_accounts
set assigned_by_id = owner_id
where assigned_by_id is null;

create index if not exists service_accounts_parent_account_idx
  on public.service_accounts(parent_account_id);

create index if not exists service_accounts_root_account_idx
  on public.service_accounts(root_account_id);

create index if not exists service_accounts_assigned_by_idx
  on public.service_accounts(assigned_by_id, created_at desc);

create unique index if not exists service_accounts_assigned_root_unique_idx
  on public.service_accounts(assigned_user_id, root_account_id)
  where root_account_id is not null;

alter table public.service_accounts replica identity full;

drop policy if exists "service_accounts_select_participants" on public.service_accounts;
create policy "service_accounts_select_participants"
on public.service_accounts
for select
to authenticated
using (
  assigned_user_id = auth.uid()
  or owner_id = auth.uid()
  or assigned_by_id = auth.uid()
);

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_rel rel
       join pg_publication pub on pub.oid = rel.prpubid
       where pub.pubname = 'supabase_realtime'
         and rel.prrelid = 'public.service_accounts'::regclass
     ) then
    alter publication supabase_realtime add table public.service_accounts;
  end if;
end;
$realtime$ language plpgsql;

commit;
