begin;

create extension if not exists pgcrypto;

create table if not exists public.service_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  assigned_user_id uuid not null references public.profiles(id) on delete cascade,
  service_name text not null,
  account_email text not null,
  account_type text not null default 'Cuenta completa',
  cutoff_date date,
  renewal_price numeric(10,2) not null default 0,
  renewal_period_days integer not null default 30,
  status text not null default 'activa',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint service_accounts_status_check
    check (status in ('activa', 'pausada', 'sin_pago', 'desactivada'))
);

alter table public.service_accounts
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.service_accounts
  add column if not exists assigned_user_id uuid references public.profiles(id) on delete cascade;
alter table public.service_accounts
  add column if not exists service_name text;
alter table public.service_accounts
  add column if not exists account_email text;
alter table public.service_accounts
  add column if not exists account_type text default 'Cuenta completa';
alter table public.service_accounts
  add column if not exists cutoff_date date;
alter table public.service_accounts
  add column if not exists renewal_price numeric(10,2) default 0;
alter table public.service_accounts
  add column if not exists renewal_period_days integer default 30;
alter table public.service_accounts
  add column if not exists status text default 'activa';
alter table public.service_accounts
  add column if not exists created_at timestamptz default timezone('utc', now());
alter table public.service_accounts
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.service_accounts set account_type = 'Cuenta completa' where account_type is null;
update public.service_accounts set renewal_price = 0 where renewal_price is null;
update public.service_accounts set renewal_period_days = 30 where renewal_period_days is null;
update public.service_accounts set status = 'activa' where status is null;
update public.service_accounts set created_at = timezone('utc', now()) where created_at is null;
update public.service_accounts set updated_at = timezone('utc', now()) where updated_at is null;

alter table public.service_accounts alter column owner_id set not null;
alter table public.service_accounts alter column assigned_user_id set not null;
alter table public.service_accounts alter column service_name set not null;
alter table public.service_accounts alter column account_email set not null;
alter table public.service_accounts alter column account_type set not null;
alter table public.service_accounts alter column renewal_price set not null;
alter table public.service_accounts alter column renewal_period_days set not null;
alter table public.service_accounts alter column status set not null;
alter table public.service_accounts alter column created_at set not null;
alter table public.service_accounts alter column updated_at set not null;

drop index if exists public.service_accounts_user_email_idx;

create unique index if not exists service_accounts_user_service_email_idx
  on public.service_accounts (assigned_user_id, service_name, account_email);
create index if not exists service_accounts_owner_idx
  on public.service_accounts (owner_id, created_at desc);
create index if not exists service_accounts_user_idx
  on public.service_accounts (assigned_user_id, created_at desc);

create table if not exists public.support_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid references public.service_accounts(id) on delete set null,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  request_kind text not null,
  status text not null default 'abierta',
  subject text not null,
  description text,
  payment_proof_data_url text,
  renewal_price numeric(10,2),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint support_requests_kind_check
    check (request_kind in ('no_payment', 'issue', 'renewal')),
  constraint support_requests_status_check
    check (status in ('abierta', 'en_chat', 'pendiente_revision', 'aprobada', 'rechazada', 'cerrada'))
);

alter table public.support_requests
  add column if not exists account_id uuid references public.service_accounts(id) on delete set null;
alter table public.support_requests
  add column if not exists requester_id uuid references public.profiles(id) on delete cascade;
alter table public.support_requests
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.support_requests
  add column if not exists request_kind text;
alter table public.support_requests
  add column if not exists status text default 'abierta';
alter table public.support_requests
  add column if not exists subject text;
alter table public.support_requests
  add column if not exists description text;
alter table public.support_requests
  add column if not exists payment_proof_data_url text;
alter table public.support_requests
  add column if not exists renewal_price numeric(10,2);
alter table public.support_requests
  add column if not exists created_at timestamptz default timezone('utc', now());
alter table public.support_requests
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.support_requests set status = 'abierta' where status is null;
update public.support_requests set created_at = timezone('utc', now()) where created_at is null;
update public.support_requests set updated_at = timezone('utc', now()) where updated_at is null;

alter table public.support_requests alter column requester_id set not null;
alter table public.support_requests alter column owner_id set not null;
alter table public.support_requests alter column request_kind set not null;
alter table public.support_requests alter column status set not null;
alter table public.support_requests alter column subject set not null;
alter table public.support_requests alter column created_at set not null;
alter table public.support_requests alter column updated_at set not null;

create index if not exists support_requests_requester_idx
  on public.support_requests (requester_id, created_at desc);
create index if not exists support_requests_owner_idx
  on public.support_requests (owner_id, created_at desc);
create index if not exists support_requests_account_idx
  on public.support_requests (account_id, created_at desc);

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.support_requests(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_role public.app_role not null,
  body text not null,
  image_data_url text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.support_messages
  add column if not exists request_id uuid references public.support_requests(id) on delete cascade;
alter table public.support_messages
  add column if not exists sender_id uuid references public.profiles(id) on delete cascade;
alter table public.support_messages
  add column if not exists sender_role public.app_role;
alter table public.support_messages
  add column if not exists body text;
alter table public.support_messages
  add column if not exists image_data_url text;
alter table public.support_messages
  add column if not exists created_at timestamptz default timezone('utc', now());

update public.support_messages set created_at = timezone('utc', now()) where created_at is null;

alter table public.support_messages alter column request_id set not null;
alter table public.support_messages alter column sender_id set not null;
alter table public.support_messages alter column sender_role set not null;
alter table public.support_messages alter column body set not null;
alter table public.support_messages alter column created_at set not null;

create index if not exists support_messages_request_idx
  on public.support_messages (request_id, created_at asc);

create table if not exists public.panel_products (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  provider_name text not null,
  title text not null,
  price numeric(10,2) not null,
  image_data_url text,
  in_stock boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.panel_products
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.panel_products
  add column if not exists provider_name text;
alter table public.panel_products
  add column if not exists title text;
alter table public.panel_products
  add column if not exists price numeric(10,2);
alter table public.panel_products
  add column if not exists image_data_url text;
alter table public.panel_products
  add column if not exists in_stock boolean default true;
alter table public.panel_products
  add column if not exists created_at timestamptz default timezone('utc', now());
alter table public.panel_products
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.panel_products set in_stock = true where in_stock is null;
update public.panel_products set created_at = timezone('utc', now()) where created_at is null;
update public.panel_products set updated_at = timezone('utc', now()) where updated_at is null;

alter table public.panel_products alter column owner_id set not null;
alter table public.panel_products alter column provider_name set not null;
alter table public.panel_products alter column title set not null;
alter table public.panel_products alter column price set not null;
alter table public.panel_products alter column in_stock set not null;
alter table public.panel_products alter column created_at set not null;
alter table public.panel_products alter column updated_at set not null;

create index if not exists panel_products_owner_idx
  on public.panel_products (owner_id, created_at desc);
create index if not exists panel_products_stock_idx
  on public.panel_products (in_stock, created_at desc);

create table if not exists public.panel_product_special_prices (
  product_id uuid not null references public.panel_products(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  special_price numeric(10,2) not null,
  created_at timestamptz not null default timezone('utc', now()),
  primary key (product_id, user_id)
);

alter table public.panel_product_special_prices
  add column if not exists product_id uuid references public.panel_products(id) on delete cascade;
alter table public.panel_product_special_prices
  add column if not exists user_id uuid references public.profiles(id) on delete cascade;
alter table public.panel_product_special_prices
  add column if not exists special_price numeric(10,2);
alter table public.panel_product_special_prices
  add column if not exists created_at timestamptz default timezone('utc', now());

update public.panel_product_special_prices
set created_at = timezone('utc', now())
where created_at is null;

alter table public.panel_product_special_prices alter column product_id set not null;
alter table public.panel_product_special_prices alter column user_id set not null;
alter table public.panel_product_special_prices alter column special_price set not null;
alter table public.panel_product_special_prices alter column created_at set not null;

create index if not exists panel_product_special_prices_user_idx
  on public.panel_product_special_prices (user_id, created_at desc);

create table if not exists public.panel_sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.panel_products(id) on delete set null,
  buyer_id uuid not null references public.profiles(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title_snapshot text not null,
  provider_name_snapshot text not null,
  price_paid numeric(10,2) not null,
  status text not null default 'pendiente',
  payment_proof_data_url text,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint panel_sales_status_check
    check (status in ('pendiente', 'pagada', 'cancelada'))
);

alter table public.panel_sales
  add column if not exists product_id uuid references public.panel_products(id) on delete set null;
alter table public.panel_sales
  add column if not exists buyer_id uuid references public.profiles(id) on delete cascade;
alter table public.panel_sales
  add column if not exists owner_id uuid references public.profiles(id) on delete cascade;
alter table public.panel_sales
  add column if not exists title_snapshot text;
alter table public.panel_sales
  add column if not exists provider_name_snapshot text;
alter table public.panel_sales
  add column if not exists price_paid numeric(10,2);
alter table public.panel_sales
  add column if not exists status text default 'pendiente';
alter table public.panel_sales
  add column if not exists payment_proof_data_url text;
alter table public.panel_sales
  add column if not exists created_at timestamptz default timezone('utc', now());
alter table public.panel_sales
  add column if not exists updated_at timestamptz default timezone('utc', now());

update public.panel_sales set status = 'pendiente' where status is null;
update public.panel_sales set created_at = timezone('utc', now()) where created_at is null;
update public.panel_sales set updated_at = timezone('utc', now()) where updated_at is null;

alter table public.panel_sales alter column buyer_id set not null;
alter table public.panel_sales alter column owner_id set not null;
alter table public.panel_sales alter column title_snapshot set not null;
alter table public.panel_sales alter column provider_name_snapshot set not null;
alter table public.panel_sales alter column price_paid set not null;
alter table public.panel_sales alter column status set not null;
alter table public.panel_sales alter column created_at set not null;
alter table public.panel_sales alter column updated_at set not null;

create index if not exists panel_sales_buyer_idx
  on public.panel_sales (buyer_id, created_at desc);
create index if not exists panel_sales_owner_idx
  on public.panel_sales (owner_id, created_at desc);

drop trigger if exists service_accounts_set_updated_at on public.service_accounts;
create trigger service_accounts_set_updated_at
before update on public.service_accounts
for each row
execute function public.set_updated_at();

drop trigger if exists support_requests_set_updated_at on public.support_requests;
create trigger support_requests_set_updated_at
before update on public.support_requests
for each row
execute function public.set_updated_at();

drop trigger if exists panel_products_set_updated_at on public.panel_products;
create trigger panel_products_set_updated_at
before update on public.panel_products
for each row
execute function public.set_updated_at();

drop trigger if exists panel_sales_set_updated_at on public.panel_sales;
create trigger panel_sales_set_updated_at
before update on public.panel_sales
for each row
execute function public.set_updated_at();

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
        and cls.relname = 'profiles'
    ) then
      alter publication supabase_realtime add table public.profiles;
    end if;

    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'service_accounts'
    ) then
      alter publication supabase_realtime add table public.service_accounts;
    end if;

    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'support_requests'
    ) then
      alter publication supabase_realtime add table public.support_requests;
    end if;

    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'support_messages'
    ) then
      alter publication supabase_realtime add table public.support_messages;
    end if;

    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'panel_products'
    ) then
      alter publication supabase_realtime add table public.panel_products;
    end if;

    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'panel_product_special_prices'
    ) then
      alter publication supabase_realtime add table public.panel_product_special_prices;
    end if;

    if not exists (
      select 1
      from pg_publication_rel rel
      join pg_class cls on cls.oid = rel.prrelid
      join pg_namespace nsp on nsp.oid = cls.relnamespace
      join pg_publication pub on pub.oid = rel.prpubid
      where pub.pubname = 'supabase_realtime'
        and nsp.nspname = 'public'
        and cls.relname = 'panel_sales'
    ) then
      alter publication supabase_realtime add table public.panel_sales;
    end if;
  end if;
end
$$ language plpgsql;

alter table public.service_accounts enable row level security;
alter table public.support_requests enable row level security;
alter table public.support_messages enable row level security;
alter table public.panel_products enable row level security;
alter table public.panel_product_special_prices enable row level security;
alter table public.panel_sales enable row level security;

commit;
