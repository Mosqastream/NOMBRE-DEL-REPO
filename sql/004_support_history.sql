begin;

create table if not exists public.support_request_history (
  id uuid primary key default gen_random_uuid(),
  account_email text,
  service_name text,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_kind text not null,
  subject text not null,
  description text,
  summary text not null,
  message_count integer not null default 0,
  last_message_preview text,
  closed_by_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  closed_at timestamptz not null default timezone('utc', now()),
  constraint support_request_history_kind_check
    check (request_kind in ('no_payment', 'issue', 'renewal'))
);

alter table public.support_request_history enable row level security;

do $$
begin
  begin
    alter table public.support_requests
      drop constraint if exists support_requests_status_check;
  exception
    when undefined_table then null;
  end;

  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'support_requests'
  ) then
    alter table public.support_requests
      add constraint support_requests_status_check
      check (status in ('abierta', 'en_chat', 'pendiente_revision', 'aprobada', 'rechazada', 'cierre_solicitado', 'cerrada'));
  end if;
end
$$ language plpgsql;

drop policy if exists "support_history_select_requester_or_owner" on public.support_request_history;
create policy "support_history_select_requester_or_owner"
on public.support_request_history
for select
to authenticated
using (
  auth.uid() = requester_id
  or auth.uid() = owner_id
);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'support_request_history'
    ) then
      alter publication supabase_realtime add table public.support_request_history;
    end if;
  end if;
end
$$ language plpgsql;

alter table public.support_request_history replica identity full;

commit;
