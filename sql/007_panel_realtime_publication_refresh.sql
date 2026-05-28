begin;

create or replace function pg_temp.add_public_table_to_realtime(table_name text)
returns void
language plpgsql
as $$
declare
  table_oid regclass;
begin
  table_oid := to_regclass(format('public.%I', table_name));

  if table_oid is null then
    return;
  end if;

  if not exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
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
$$;

create or replace function pg_temp.set_public_table_replica_full(table_name text)
returns void
language plpgsql
as $$
declare
  table_oid regclass;
begin
  table_oid := to_regclass(format('public.%I', table_name));

  if table_oid is null then
    return;
  end if;

  execute format('alter table %s replica identity full', table_oid);
end;
$$;

select pg_temp.add_public_table_to_realtime('profiles');
select pg_temp.add_public_table_to_realtime('service_accounts');
select pg_temp.add_public_table_to_realtime('support_requests');
select pg_temp.add_public_table_to_realtime('support_messages');
select pg_temp.add_public_table_to_realtime('support_request_history');
select pg_temp.add_public_table_to_realtime('panel_products');
select pg_temp.add_public_table_to_realtime('panel_product_special_prices');
select pg_temp.add_public_table_to_realtime('panel_sales');

select pg_temp.set_public_table_replica_full('profiles');
select pg_temp.set_public_table_replica_full('service_accounts');
select pg_temp.set_public_table_replica_full('support_requests');
select pg_temp.set_public_table_replica_full('support_messages');
select pg_temp.set_public_table_replica_full('support_request_history');
select pg_temp.set_public_table_replica_full('panel_products');
select pg_temp.set_public_table_replica_full('panel_product_special_prices');
select pg_temp.set_public_table_replica_full('panel_sales');

commit;
