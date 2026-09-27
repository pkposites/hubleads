-- Lead Hub: periods with an end (item "período" of the panel).
--
-- The sheet, the metrics and the export only had a start date, so a month
-- could not be looked at on its own ("mês passado", a date range) nor
-- compared with the previous one. These functions now also take p_until
-- (exclusive end; null = up to now). Visit counts use whole days in
-- America/Sao_Paulo, like the periods the app builds (midnight to midnight).
-- p_until goes last with a default, so calls without it keep working.

drop function public.lh_stats(text, timestamptz);

create function public.lh_stats(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ws as (select lh_private.workspace_for(p_token) as id),
  day_total as (
    select coalesce(a.day, c.day) as day, greatest(coalesce(a.visitors, 0), coalesce(c.visitors, 0)) as visitors
    from (
      select s.day, sum(s.visitors)::int as visitors from public.lh_visit_stats s, ws
      where s.workspace_id = ws.id and (p_since is null or s.day >= (p_since at time zone 'America/Sao_Paulo')::date)
        and (p_until is null or s.day < (p_until at time zone 'America/Sao_Paulo')::date)
      group by 1
    ) a
    full outer join (
      select (e.created_at at time zone 'America/Sao_Paulo')::date as day, count(distinct e.visitor_id)::int as visitors
      from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'page_view' and (p_since is null or e.created_at >= p_since) and (p_until is null or e.created_at < p_until)
      group by 1
    ) c on c.day = a.day
  )
  select jsonb_build_object(
    'visitors', (select coalesce(sum(visitors), 0) from day_total),
    'clicks', (
      select count(distinct e.visitor_id) from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'whatsapp_click' and (p_since is null or e.created_at >= p_since) and (p_until is null or e.created_at < p_until)
    ),
    'leads', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    ),
    'with_phone', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.phone is not null and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    ),
    'sales', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.status = 'venda' and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    ),
    'revenue', (
      select coalesce(sum(l.sale_value), 0) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.status = 'venda' and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    )
  )
$function$;

drop function public.lh_list_leads(text, timestamptz, text, text, text, integer, integer);

create function public.lh_list_leads(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_status text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  with filtered as (
    select l.* from public.lh_leads l
    where l.workspace_id = v_workspace
      and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
      and (p_status is null or l.status = p_status)
      and (p_channel is null or l.channel = p_channel)
      and (
        v_search is null
        or l.name ilike '%' || v_search || '%'
        or l.phone ilike '%' || v_search || '%'
        or l.code ilike v_search
        or l.utm_campaign ilike '%' || v_search || '%'
        or l.notes ilike '%' || v_search || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(lh_private.lead_json(f) order by f.created_at desc)
      from (
        select * from filtered order by created_at desc
        limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)
      ) f
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

drop function public.lh_metrics(text, timestamptz, text);

create function public.lh_metrics(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_dimension text DEFAULT 'channel'::text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_since_day date := (p_since at time zone 'America/Sao_Paulo')::date;
  v_result jsonb;
begin
  if p_dimension not in ('channel', 'campaign', 'adset', 'ad', 'device') then
    raise exception 'invalid dimension' using errcode = '22023';
  end if;

  with ev as (
    select e.visitor_id, e.type, e.created_at,
      (e.created_at at time zone 'America/Sao_Paulo')::date as day,
      coalesce(case p_dimension
        when 'channel' then e.data ->> 'channel'
        when 'campaign' then coalesce(e.data ->> 'campaign', e.data ->> 'utm_campaign')
        when 'adset' then e.data ->> 'adset'
        when 'ad' then e.data ->> 'ad'
        else e.data ->> 'device'
      end, '') as dim
    from public.lh_events e
    where e.workspace_id = v_workspace
      and e.type in ('page_view', 'whatsapp_click')
      and (p_since is null or e.created_at >= p_since) and (p_until is null or e.created_at < p_until)
  ),
  anon as (
    select s.day,
      case p_dimension
        when 'channel' then s.channel
        when 'campaign' then s.campaign
        when 'adset' then s.adset
        when 'ad' then s.ad
        else s.device
      end as dim,
      s.visitors
    from public.lh_visit_stats s
    where s.workspace_id = v_workspace
      and (p_since is null or s.day >= v_since_day)
      and (p_until is null or s.day < (p_until at time zone 'America/Sao_Paulo')::date)
  ),
  -- Visitors per day and dimension value, then per day.
  day_dim as (
    select coalesce(a.day, c.day) as day, coalesce(a.dim, c.dim) as dim,
      greatest(coalesce(a.visitors, 0), coalesce(c.visitors, 0)) as visitors
    from (select day, dim, sum(visitors)::int as visitors from anon group by 1, 2) a
    full outer join (
      select day, dim, count(distinct visitor_id)::int as visitors from ev where type = 'page_view' group by 1, 2
    ) c on c.day = a.day and c.dim = a.dim
  ),
  day_total as (
    select coalesce(a.day, c.day) as day,
      greatest(coalesce(a.visitors, 0), coalesce(c.visitors, 0)) as visitors
    from (select day, sum(visitors)::int as visitors from anon group by 1) a
    full outer join (
      select day, count(distinct visitor_id)::int as visitors from ev where type = 'page_view' group by 1
    ) c on c.day = a.day
  ),
  ld as (
    select l.phone, l.status, l.sale_value, l.created_at,
      coalesce(case p_dimension
        when 'channel' then l.channel
        when 'campaign' then coalesce(l.campaign_name, l.utm_campaign)
        when 'adset' then coalesce(l.adset_name, l.utm_term)
        when 'ad' then coalesce(l.ad_name, l.utm_content)
        else l.device
      end, '') as dim
    from public.lh_leads l
    where l.workspace_id = v_workspace
      and l.source = 'lp'
      and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
  ),
  ev_by as (
    select coalesce(v.dim, k.dim) as dim, coalesce(v.visitors, 0) as visitors, coalesce(k.clickers, 0) as clickers
    from (select dim, sum(visitors)::int as visitors from day_dim group by dim) v
    full outer join (
      select dim, count(distinct visitor_id)::int as clickers from ev where type = 'whatsapp_click' group by dim
    ) k on k.dim = v.dim
  ),
  ld_by as (
    select dim,
      count(*) as leads,
      count(*) filter (where phone is not null) as with_phone,
      count(*) filter (where status in ('agendado', 'venda')) as scheduled,
      count(*) filter (where status = 'venda') as sales,
      coalesce(sum(sale_value) filter (where status = 'venda'), 0) as revenue
    from ld group by dim
  ),
  by_dim as (
    select coalesce(e.dim, l.dim) as key,
      coalesce(e.visitors, 0) as visitors,
      coalesce(e.clickers, 0) as clickers,
      coalesce(l.leads, 0) as leads,
      coalesce(l.with_phone, 0) as with_phone,
      coalesce(l.scheduled, 0) as scheduled,
      coalesce(l.sales, 0) as sales,
      coalesce(l.revenue, 0) as revenue
    from ev_by e full outer join ld_by l on l.dim = e.dim
  ),
  daily as (
    select coalesce(t.day, k.day) as day, coalesce(t.visitors, 0) as visitors, coalesce(k.clickers, 0) as clickers
    from day_total t
    full outer join (
      select day, count(distinct visitor_id)::int as clickers from ev where type = 'whatsapp_click' group by day
    ) k on k.day = t.day
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'visitors', (select coalesce(sum(visitors), 0) from day_total),
      'clickers', (select count(distinct visitor_id) from ev where type = 'whatsapp_click'),
      'clicks', (select count(*) from ev where type = 'whatsapp_click'),
      'leads', (select count(*) from ld),
      'with_phone', (select count(*) from ld where phone is not null),
      'scheduled', (select count(*) from ld where status in ('agendado', 'venda')),
      'sales', (select count(*) from ld where status = 'venda'),
      'revenue', (select coalesce(sum(sale_value), 0) from ld where status = 'venda'),
      'manual_leads', (
        select count(*) from public.lh_leads m
        where m.workspace_id = v_workspace and m.source = 'manual'
          and (p_since is null or m.created_at >= p_since) and (p_until is null or m.created_at < p_until)
      )
    ),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(b) order by b.visitors desc, b.leads desc, b.key) from by_dim b
    ), '[]'::jsonb),
    'daily', coalesce((
      select jsonb_agg(jsonb_build_object('day', d.day, 'visitors', d.visitors, 'clickers', d.clickers) order by d.day)
      from daily d
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$function$;

drop function public.lh_attendance_metrics(text, timestamptz);

create function public.lh_attendance_metrics(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
begin
  return jsonb_build_object(
    'first_contact_median_min', (
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from (l.first_contact_at - l.created_at)) / 60))::numeric, 1)
      from public.lh_leads l
      where l.workspace_id = v_workspace and l.first_contact_at is not null
        and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    ),
    'contacted', (
      select count(*) from public.lh_leads l
      where l.workspace_id = v_workspace and l.first_contact_at is not null
        and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    ),
    'within_5_min', (
      select count(*) from public.lh_leads l
      where l.workspace_id = v_workspace and l.first_contact_at is not null
        and l.first_contact_at - l.created_at <= interval '5 minutes'
        and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
    ),
    'waiting', (
      select count(*) from public.lh_leads l
      where l.workspace_id = v_workspace and l.status = 'novo'
    ),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r.reason, 'count', r.n) order by r.n desc)
      from (
        select coalesce(l.lost_reason, 'Não informado') as reason, count(*) as n
        from public.lh_leads l
        where l.workspace_id = v_workspace and l.status = 'perdido'
          and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
        group by 1
      ) r
    ), '[]'::jsonb)
  );
end;
$function$;

drop function public.lh_lp_event_metrics(text, timestamptz);

create function public.lh_lp_event_metrics(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with ev as (
    select lh_private.lp_event_name(e.type, e.data) as name, e.page_id, e.visitor_id
    from public.lh_events e
    where e.workspace_id = lh_private.workspace_for(p_token)
      and e.type not in ('page_view', 'whatsapp_click', 'identify')
      and (p_since is null or e.created_at >= p_since) and (p_until is null or e.created_at < p_until)
  ),
  people as (
    select ev.name, ev.page_id, ev.visitor_id, count(*) as n
    from ev where ev.name is not null
    group by 1, 2, 3
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'event', r.name, 'people', r.people, 'events', r.events, 'leads', r.leads, 'sales', r.sales
  ) order by r.people desc, r.name), '[]'::jsonb)
  from (
    select p.name,
           count(*) as people,
           sum(p.n) as events,
           count(l.id) as leads,
           count(l.id) filter (where l.status = 'venda') as sales
    from people p
    left join public.lh_leads l on l.page_id = p.page_id and l.visitor_id = p.visitor_id
    group by p.name
    limit 50
  ) r
$function$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_stats(text, timestamptz, timestamptz)',
    'lh_list_leads(text, timestamptz, text, text, text, integer, integer, timestamptz)',
    'lh_metrics(text, timestamptz, text, timestamptz)',
    'lh_attendance_metrics(text, timestamptz, timestamptz)',
    'lh_lp_event_metrics(text, timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
