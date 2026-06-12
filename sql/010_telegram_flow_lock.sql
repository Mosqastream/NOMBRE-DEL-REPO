begin;

create table if not exists public.telegram_flow_locks (
  lock_name text primary key,
  lease_token uuid not null,
  lease_expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.telegram_flow_locks enable row level security;

create or replace function public.acquire_telegram_flow_lock(
  p_lock_name text,
  p_lease_token uuid,
  p_lease_seconds integer default 180
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  affected_rows integer;
begin
  insert into public.telegram_flow_locks (
    lock_name,
    lease_token,
    lease_expires_at,
    updated_at
  )
  values (
    p_lock_name,
    p_lease_token,
    now() + make_interval(secs => greatest(p_lease_seconds, 30)),
    now()
  )
  on conflict (lock_name) do update
  set
    lease_token = excluded.lease_token,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = now()
  where
    public.telegram_flow_locks.lease_expires_at <= now()
    or public.telegram_flow_locks.lease_token = excluded.lease_token;

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$function$;

create or replace function public.release_telegram_flow_lock(
  p_lock_name text,
  p_lease_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $function$
declare
  affected_rows integer;
begin
  delete from public.telegram_flow_locks
  where lock_name = p_lock_name
    and lease_token = p_lease_token;

  get diagnostics affected_rows = row_count;
  return affected_rows > 0;
end;
$function$;

revoke all on table public.telegram_flow_locks from anon, authenticated;
revoke all on function public.acquire_telegram_flow_lock(text, uuid, integer) from public, anon, authenticated;
revoke all on function public.release_telegram_flow_lock(text, uuid) from public, anon, authenticated;

grant execute on function public.acquire_telegram_flow_lock(text, uuid, integer) to service_role;
grant execute on function public.release_telegram_flow_lock(text, uuid) to service_role;

commit;
