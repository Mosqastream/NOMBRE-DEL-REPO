begin;

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
$history$ language plpgsql;

commit;
