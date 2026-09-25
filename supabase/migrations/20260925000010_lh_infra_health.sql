-- Lead Hub: numbers the admin panel uses to warn when it is time to move
-- Lead Hub to its own Supabase project (before the shared one becomes a
-- problem): whether other systems share this database, database and Lead Hub
-- sizes, how fast page events grow, and how many clients and leads exist.

create or replace function public.lh_admin_infra(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_events_bytes bigint;
  v_events int;
  v_events_7d int;
begin
  perform lh_private.admin_for(p_token);
  select pg_total_relation_size('public.lh_events'::regclass) into v_events_bytes;
  select count(*), count(*) filter (where created_at > now() - interval '7 days')
    into v_events, v_events_7d
  from public.lh_events;
  return jsonb_build_object(
    -- Tables of other systems in the same database.
    'other_tables', (
      select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r'
        and n.nspname not in ('lh_private', 'pg_catalog', 'information_schema', 'extensions', 'auth', 'storage',
                              'realtime', 'supabase_functions', 'supabase_migrations', 'vault', 'graphql',
                              'graphql_public', 'pgbouncer', 'net', 'cron', 'pgsodium', 'pgsodium_masks', '_realtime')
        and not (n.nspname = 'public' and c.relname like 'lh\_%')
    ),
    'db_bytes', pg_database_size(current_database()),
    'lh_bytes', (
      select coalesce(sum(pg_total_relation_size(c.oid)), 0) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and ((n.nspname = 'public' and c.relname like 'lh\_%') or n.nspname = 'lh_private')
    ),
    'clients', (select count(*) from public.lh_workspaces),
    'leads', (select count(*) from public.lh_leads),
    'events', v_events,
    'events_7d', v_events_7d,
    -- Rough growth: average size of a page event times events per day.
    'bytes_per_day', case when v_events > 0 then round(v_events_bytes::numeric / v_events * v_events_7d / 7) else 0 end
  );
end;
$$;

revoke all on function public.lh_admin_infra(text) from public;
grant execute on function public.lh_admin_infra(text) to anon, authenticated, service_role;
