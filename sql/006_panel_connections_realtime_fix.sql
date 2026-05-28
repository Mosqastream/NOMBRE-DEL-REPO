begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

alter table public.service_accounts
  drop constraint if exists service_accounts_status_check;
alter table public.service_accounts
  add constraint service_accounts_status_check
  check (status in ('activa', 'pausada', 'sin_pago', 'desactivada'));

alter table public.support_requests
  drop constraint if exists support_requests_status_check;
alter table public.support_requests
  add constraint support_requests_status_check
  check (status in ('abierta', 'en_chat', 'pendiente_revision', 'aprobada', 'rechazada', 'cierre_solicitado', 'cerrada'));

alter table public.panel_sales
  drop constraint if exists panel_sales_status_check;
alter table public.panel_sales
  add constraint panel_sales_status_check
  check (status in ('pendiente', 'pagada', 'cancelada'));

create unique index if not exists service_accounts_user_service_email_idx
  on public.service_accounts (assigned_user_id, service_name, account_email);
create index if not exists service_accounts_owner_user_idx
  on public.service_accounts (owner_id, assigned_user_id, created_at desc);
create index if not exists support_requests_owner_status_idx
  on public.support_requests (owner_id, status, created_at desc);
create index if not exists support_requests_requester_status_idx
  on public.support_requests (requester_id, status, created_at desc);
create index if not exists panel_products_owner_stock_idx
  on public.panel_products (owner_id, in_stock, created_at desc);
create index if not exists panel_sales_owner_status_idx
  on public.panel_sales (owner_id, status, created_at desc);

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

alter table public.profiles enable row level security;
alter table public.service_accounts enable row level security;
alter table public.support_requests enable row level security;
alter table public.support_messages enable row level security;
alter table public.panel_products enable row level security;
alter table public.panel_product_special_prices enable row level security;
alter table public.panel_sales enable row level security;

alter table public.profiles replica identity full;
alter table public.service_accounts replica identity full;
alter table public.support_requests replica identity full;
alter table public.support_messages replica identity full;
alter table public.panel_products replica identity full;
alter table public.panel_product_special_prices replica identity full;
alter table public.panel_sales replica identity full;

drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
on public.profiles
for select
to authenticated
using (true);

drop policy if exists "service_accounts_select_participants" on public.service_accounts;
create policy "service_accounts_select_participants"
on public.service_accounts
for select
to authenticated
using (assigned_user_id = auth.uid() or owner_id = auth.uid());

drop policy if exists "support_requests_select_participants" on public.support_requests;
create policy "support_requests_select_participants"
on public.support_requests
for select
to authenticated
using (requester_id = auth.uid() or owner_id = auth.uid());

drop policy if exists "support_messages_select_participants" on public.support_messages;
create policy "support_messages_select_participants"
on public.support_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.support_requests req
    where req.id = support_messages.request_id
      and (req.requester_id = auth.uid() or req.owner_id = auth.uid())
  )
);

drop policy if exists "panel_products_select_visible" on public.panel_products;
create policy "panel_products_select_visible"
on public.panel_products
for select
to authenticated
using (in_stock = true or owner_id = auth.uid());

drop policy if exists "panel_product_special_prices_select_visible" on public.panel_product_special_prices;
create policy "panel_product_special_prices_select_visible"
on public.panel_product_special_prices
for select
to authenticated
using (
  user_id = auth.uid()
  or exists (
    select 1
    from public.panel_products product
    where product.id = panel_product_special_prices.product_id
      and product.owner_id = auth.uid()
  )
);

drop policy if exists "panel_sales_select_participants" on public.panel_sales;
create policy "panel_sales_select_participants"
on public.panel_sales
for select
to authenticated
using (buyer_id = auth.uid() or owner_id = auth.uid());

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
select pg_temp.add_public_realtime_table('service_accounts');
select pg_temp.add_public_realtime_table('support_requests');
select pg_temp.add_public_realtime_table('support_messages');
select pg_temp.add_public_realtime_table('support_request_history');
select pg_temp.add_public_realtime_table('panel_products');
select pg_temp.add_public_realtime_table('panel_product_special_prices');
select pg_temp.add_public_realtime_table('panel_sales');

do $history$
begin
  if to_regclass('public.support_request_history') is not null then
    execute 'alter table public.support_request_history enable row level security';
    execute 'alter table public.support_request_history replica identity full';
    execute 'drop policy if exists "support_history_select_requester_or_owner" on public.support_request_history';
    execute 'create policy "support_history_select_requester_or_owner"
      on public.support_request_history
      for select
      to authenticated
      using (requester_id = auth.uid() or owner_id = auth.uid())';
  end if;
end;
$history$;

commit;
