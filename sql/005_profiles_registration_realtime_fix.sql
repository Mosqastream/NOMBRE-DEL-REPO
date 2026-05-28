begin;

create extension if not exists pgcrypto;

insert into public.profiles (
  id,
  username,
  phone,
  telegram,
  role,
  security_pin_hash,
  created_at,
  updated_at
)
select
  auth_user.id,
  lower(trim(coalesce(auth_user.raw_user_meta_data ->> 'username', split_part(auth_user.email, '@', 1)))),
  trim(coalesce(
    auth_user.raw_user_meta_data ->> 'phone',
    '+1' || lpad(substring(regexp_replace(auth_user.id::text, '\D', '', 'g') from 1 for 10), 10, '0')
  )),
  nullif(trim(coalesce(auth_user.raw_user_meta_data ->> 'telegram', '')), ''),
  'usuario'::public.app_role,
  lower(trim(coalesce(auth_user.raw_user_meta_data ->> 'security_pin_hash', encode(digest('0000', 'sha256'), 'hex')))),
  auth_user.created_at,
  timezone('utc', now())
from auth.users auth_user
where not exists (
  select 1
  from public.profiles profile
  where profile.id = auth_user.id
)
  and coalesce(auth_user.raw_user_meta_data ->> 'username', split_part(auth_user.email, '@', 1)) <> ''
on conflict (id) do nothing;

create or replace function public.handle_new_user_profile()
returns trigger
as $profile_trigger$
declare
  new_username text;
  new_phone text;
  new_telegram text;
  new_security_pin_hash text;
begin
  new_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1), '')));
  new_phone := trim(coalesce(
    new.raw_user_meta_data ->> 'phone',
    '+1' || lpad(substring(regexp_replace(new.id::text, '\D', '', 'g') from 1 for 10), 10, '0')
  ));
  new_telegram := nullif(trim(coalesce(new.raw_user_meta_data ->> 'telegram', '')), '');
  new_security_pin_hash := lower(trim(coalesce(new.raw_user_meta_data ->> 'security_pin_hash', encode(digest('0000', 'sha256'), 'hex'))));

  if new_username = '' then
    raise exception 'username es obligatorio';
  end if;

  insert into public.profiles (
    id,
    username,
    phone,
    telegram,
    role,
    security_pin_hash
  )
  values (
    new.id,
    new_username,
    new_phone,
    new_telegram,
    'usuario',
    new_security_pin_hash
  )
  on conflict (id) do update
  set
    username = excluded.username,
    phone = excluded.phone,
    telegram = excluded.telegram,
    security_pin_hash = excluded.security_pin_hash,
    updated_at = timezone('utc', now());

  return new;
end;
$profile_trigger$
language plpgsql
security definer
set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

alter table public.profiles enable row level security;
alter table public.profiles replica identity full;

drop policy if exists "profiles_select_own_row" on public.profiles;
create policy "profiles_select_own_row"
on public.profiles
for select
to authenticated
using (auth.uid() = id);

drop policy if exists "profiles_select_all_for_owner" on public.profiles;
create policy "profiles_select_all_for_owner"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles owner_profile
    where owner_profile.id = auth.uid()
      and owner_profile.role = 'owner'
  )
);

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

select pg_temp.add_public_realtime_table('profiles');

commit;
