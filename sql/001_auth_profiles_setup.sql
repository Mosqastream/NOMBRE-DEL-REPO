begin;

create extension if not exists pgcrypto;

do $$
begin
  if not exists (
    select 1
    from pg_type
    where typname = 'app_role'
      and typnamespace = 'public'::regnamespace
  ) then
    create type public.app_role as enum ('owner', 'usuario');
  end if;
end
$$ language plpgsql;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text unique,
  phone text unique,
  telegram text,
  role public.app_role not null default 'usuario',
  security_pin_hash text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists telegram text;
alter table public.profiles add column if not exists role public.app_role;
alter table public.profiles add column if not exists security_pin_hash text;
alter table public.profiles add column if not exists created_at timestamptz default timezone('utc', now());
alter table public.profiles add column if not exists updated_at timestamptz default timezone('utc', now());

update public.profiles
set role = 'usuario'
where role is null;

update public.profiles
set security_pin_hash = encode(digest('0000', 'sha256'), 'hex')
where security_pin_hash is null or trim(security_pin_hash) = '';

update public.profiles
set created_at = timezone('utc', now())
where created_at is null;

update public.profiles
set updated_at = timezone('utc', now())
where updated_at is null;

alter table public.profiles alter column username set not null;
alter table public.profiles alter column phone set not null;
alter table public.profiles alter column role set not null;
alter table public.profiles alter column security_pin_hash set not null;
alter table public.profiles alter column created_at set not null;
alter table public.profiles alter column updated_at set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_username_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (username ~ '^[a-z0-9](?:[a-z0-9._-]{1,28}[a-z0-9])?$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_phone_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_phone_format
      check (phone ~ '^\+[1-9][0-9]{5,14}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_security_pin_hash_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_security_pin_hash_format
      check (security_pin_hash ~ '^[a-f0-9]{64}$');
  end if;
end
$$ language plpgsql;

create unique index if not exists profiles_username_idx on public.profiles (username);
create unique index if not exists profiles_phone_idx on public.profiles (phone);

create or replace function public.set_updated_at()
returns trigger
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$
language plpgsql;

create or replace function public.handle_new_user_profile()
returns trigger
as $$
declare
  new_username text;
  new_phone text;
  new_telegram text;
  new_security_pin_hash text;
begin
  new_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  new_phone := trim(coalesce(new.raw_user_meta_data ->> 'phone', ''));
  new_telegram := nullif(trim(coalesce(new.raw_user_meta_data ->> 'telegram', '')), '');
  new_security_pin_hash := lower(trim(coalesce(new.raw_user_meta_data ->> 'security_pin_hash', '')));

  if new_username = '' then
    raise exception 'username es obligatorio';
  end if;

  if new_phone = '' then
    raise exception 'phone es obligatorio';
  end if;

  if new_security_pin_hash = '' then
    raise exception 'security_pin_hash es obligatorio';
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
    role = coalesce(public.profiles.role, 'usuario'),
    security_pin_hash = excluded.security_pin_hash,
    updated_at = timezone('utc', now());

  return new;
end;
$$
language plpgsql
security definer
set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user_profile();

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

alter table public.profiles enable row level security;

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

commit;
