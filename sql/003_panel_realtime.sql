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
  end if;
end
$$ language plpgsql;

alter table public.profiles replica identity full;
alter table public.service_accounts replica identity full;
alter table public.support_requests replica identity full;
alter table public.support_messages replica identity full;
alter table public.panel_products replica identity full;
alter table public.panel_product_special_prices replica identity full;
alter table public.panel_sales replica identity full;

commit;
