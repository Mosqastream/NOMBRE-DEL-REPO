begin;

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

    if to_regclass('public.support_request_history') is not null and not exists (
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

do $$
begin
  if to_regclass('public.support_request_history') is not null then
    alter table public.support_request_history enable row level security;
    alter table public.support_request_history replica identity full;

    drop policy if exists "support_history_select_requester_or_owner" on public.support_request_history;
    create policy "support_history_select_requester_or_owner"
    on public.support_request_history
    for select
    to authenticated
    using (requester_id = auth.uid() or owner_id = auth.uid());
  end if;
end
$$ language plpgsql;

commit;
