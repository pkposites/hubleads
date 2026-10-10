-- Lead Hub: all leads of the admin's clients in one list (painel mãe).
--
-- The master sees every client; a gestor only the clients they own (same rule
-- as lh_admin_list_workspaces). A client filter outside that set returns
-- nothing. Read-only: changes still happen in each client's panel.

create or replace function public.lh_admin_all_leads(p_token text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
  v_master boolean := lh_private.admin_is_master(v_admin);
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_client uuid;
  v_search text := nullif(left(trim(coalesce(v_filters ->> 'search', '')), 100), '');
  v_digits text;
  v_status text := nullif(v_filters ->> 'status', '');
  v_source text := nullif(v_filters ->> 'source', '');
  v_days int := least(greatest(coalesce((v_filters ->> 'days')::int, 30), 0), 3650);
  v_limit int := least(greatest(coalesce((v_filters ->> 'limit')::int, 100), 1), 500);
begin
  begin
    v_client := nullif(v_filters ->> 'client', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid client' using errcode = '22023';
  end;
  v_digits := nullif(regexp_replace(coalesce(v_search, ''), '\D', '', 'g'), '');

  return (
    with mine as (
      select w.id, w.name, w.slug from public.lh_workspaces w
      where (v_master or w.owner_admin_id = v_admin)
        and (v_client is null or w.id = v_client)
    ),
    found as (
      select l.*, m.name as client_name, m.slug as client_slug
      from public.lh_leads l join mine m on m.id = l.workspace_id
      where (v_days = 0 or l.created_at > now() - make_interval(days => v_days))
        and (v_status is null or l.status = v_status)
        and (v_source is null or l.source = v_source)
        and (
          v_search is null
          or l.name ilike '%' || v_search || '%'
          or upper(l.code) = upper(v_search)
          or (v_digits is not null and length(v_digits) >= 4 and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
        )
    )
    select jsonb_build_object(
      'total', (select count(*) from found),
      'by_client', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.workspace_id, 'name', c.client_name, 'count', c.n) order by c.n desc, c.client_name)
        from (select workspace_id, client_name, count(*) as n from found group by 1, 2) c
      ), '[]'::jsonb),
      'leads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id,
          'client_id', f.workspace_id,
          'client_name', f.client_name,
          'client_slug', f.client_slug,
          'code', f.code,
          'name', f.name,
          'phone', f.phone,
          'status', f.status,
          'color', f.color,
          'source', f.source,
          'channel', f.channel,
          'campaign', coalesce(f.campaign_name, f.utm_campaign),
          'sale_value', f.sale_value,
          'created_at', f.created_at
        ) order by f.created_at desc)
        from (select * from found order by created_at desc limit v_limit) f
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.lh_admin_all_leads(text, jsonb) from public;
grant execute on function public.lh_admin_all_leads(text, jsonb) to anon, authenticated, service_role;
