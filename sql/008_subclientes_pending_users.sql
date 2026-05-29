begin;

alter table public.profiles
  add column if not exists parent_id uuid references public.profiles(id) on delete set null,
  add column if not exists created_by_id uuid references public.profiles(id) on delete set null,
  add column if not exists onboarding_status text not null default 'active';

do $profiles_onboarding$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_onboarding_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_onboarding_status_check
      check (onboarding_status in ('active', 'pending'));
  end if;
end;
$profiles_onboarding$ language plpgsql;

update public.profiles
set onboarding_status = 'active'
where onboarding_status is null;

create index if not exists profiles_parent_id_idx on public.profiles(parent_id);
create index if not exists profiles_created_by_id_idx on public.profiles(created_by_id);
create index if not exists profiles_onboarding_status_idx on public.profiles(onboarding_status);

alter table public.profiles replica identity full;

create or replace function public.handle_new_user_profile()
returns trigger
as $new_profile$
declare
  new_username text;
  new_phone text;
  new_telegram text;
  new_security_pin_hash text;
  new_onboarding_status text;
  new_created_by_id uuid;
  new_parent_id uuid;
begin
  new_username := lower(trim(coalesce(new.raw_user_meta_data ->> 'username', '')));
  new_phone := trim(coalesce(new.raw_user_meta_data ->> 'phone', ''));
  new_telegram := nullif(trim(coalesce(new.raw_user_meta_data ->> 'telegram', '')), '');
  new_security_pin_hash := lower(trim(coalesce(new.raw_user_meta_data ->> 'security_pin_hash', '')));
  new_onboarding_status := lower(trim(coalesce(new.raw_user_meta_data ->> 'onboarding_status', 'active')));
  new_created_by_id := nullif(trim(coalesce(new.raw_user_meta_data ->> 'created_by_id', '')), '')::uuid;
  new_parent_id := nullif(trim(coalesce(new.raw_user_meta_data ->> 'parent_id', '')), '')::uuid;

  if new_username = '' then
    raise exception 'username es obligatorio';
  end if;

  if new_phone = '' then
    raise exception 'phone es obligatorio';
  end if;

  if new_security_pin_hash = '' then
    raise exception 'security_pin_hash es obligatorio';
  end if;

  if new_onboarding_status not in ('active', 'pending') then
    new_onboarding_status := 'active';
  end if;

  insert into public.profiles (
    id,
    username,
    phone,
    telegram,
    role,
    security_pin_hash,
    onboarding_status,
    created_by_id,
    parent_id
  )
  values (
    new.id,
    new_username,
    new_phone,
    new_telegram,
    'usuario',
    new_security_pin_hash,
    new_onboarding_status,
    new_created_by_id,
    new_parent_id
  )
  on conflict (id) do update
  set
    username = excluded.username,
    phone = excluded.phone,
    telegram = excluded.telegram,
    role = coalesce(public.profiles.role, 'usuario'),
    security_pin_hash = excluded.security_pin_hash,
    onboarding_status = excluded.onboarding_status,
    created_by_id = excluded.created_by_id,
    parent_id = excluded.parent_id,
    updated_at = timezone('utc', now());

  return new;
end;
$new_profile$
language plpgsql
security definer
set search_path = public;

do $realtime$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_rel rel
       join pg_publication pub on pub.oid = rel.prpubid
       where pub.pubname = 'supabase_realtime'
         and rel.prrelid = 'public.profiles'::regclass
     ) then
    alter publication supabase_realtime add table public.profiles;
  end if;
end;
$realtime$ language plpgsql;

commit;
