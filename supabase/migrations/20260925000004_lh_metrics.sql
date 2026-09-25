-- Lead Hub: conversion metrics.
--
-- The landing page's main number is the conversion rate: people who clicked
-- WhatsApp / people who visited. lh_metrics returns the totals, the funnel
-- (visitors -> clicked -> phone -> scheduled -> sale), a daily series and a
-- breakdown by channel, campaign, ad set, ad or device. Visitors and clickers
-- are distinct people, so the rate never exceeds 100% because of repeat
-- clicks. Funnel stages after the click count landing-page leads only; leads
-- added by hand are reported separately.
--
-- Events now carry campaign / ad set / ad names so visitors can be broken down
-- the same way as leads.

create or replace function public.lh_collect(p_key text, p_origin_host text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.lh_pages;
  v_type text := left(p_event ->> 'type', 40);
  v_visitor text := left(p_event ->> 'visitor_id', 64);
  v_attr jsonb := coalesce(p_event -> 'attribution', '{}'::jsonb);
  v_name text := nullif(left(trim(p_event ->> 'name'), 120), '');
  v_phone text := nullif(left(trim(p_event ->> 'phone'), 40), '');
  v_data jsonb := coalesce(p_event -> 'data', '{}'::jsonb);
  v_lead public.lh_leads;
  v_inserted boolean := false;
  v_lead_id uuid;
begin
  if pg_column_size(p_event) > 16384 then
    raise exception 'event too large' using errcode = '22023';
  end if;

  select * into v_page from public.lh_pages where public_key = p_key;
  if not found then
    raise exception 'unknown page key' using errcode = 'LH401';
  end if;

  if cardinality(v_page.domains) > 0 and not exists (
    select 1 from unnest(v_page.domains) d
    where lower(coalesce(p_origin_host, '')) = d
       or (d like '*.%' and lower(coalesce(p_origin_host, '')) like '%' || substr(d, 2))
  ) then
    raise exception 'origin not allowed' using errcode = 'LH403';
  end if;

  if v_type is null or v_visitor is null then
    raise exception 'type and visitor_id are required' using errcode = '22023';
  end if;

  if v_type = 'whatsapp_click' then
    -- Same person on another device or browser: the phone identifies the row.
    if v_phone is not null then
      select * into v_lead from public.lh_leads
      where workspace_id = v_page.workspace_id and phone = v_phone
      order by created_at
      limit 1;
    end if;

    if v_lead.id is not null and v_lead.visitor_id is distinct from v_visitor then
      update public.lh_leads l
      set clicks = l.clicks + 1,
          last_click_at = now(),
          name = coalesce(l.name, v_name),
          extra = l.extra || v_data,
          updated_at = now()
      where l.id = v_lead.id;
      v_lead_id := v_lead.id;
    else
      insert into public.lh_leads as l (
        workspace_id, page_id, visitor_id, code, name, phone,
        channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name, placement, site_source_name,
        fbclid, gclid, fbc, fbp, url_params, ip_address, user_agent,
        landing_url, referrer, device, first_seen_at, extra
      )
      values (
        v_page.workspace_id, v_page.id, v_visitor,
        coalesce(nullif(upper(left(p_event ->> 'code', 8)), ''), lh_private.random_code()),
        v_name, v_phone,
        left(p_event ->> 'channel', 40),
        left(v_attr ->> 'utm_source', 200), left(v_attr ->> 'utm_medium', 200),
        left(v_attr ->> 'utm_campaign', 300), left(v_attr ->> 'utm_content', 300),
        left(v_attr ->> 'utm_term', 300),
        left(v_attr ->> 'campaign_id', 100), left(v_attr ->> 'adset_id', 100), left(v_attr ->> 'ad_id', 100),
        left(v_attr ->> 'campaign_name', 300), left(v_attr ->> 'adset_name', 300), left(v_attr ->> 'ad_name', 300),
        left(v_attr ->> 'placement', 100), left(v_attr ->> 'site_source_name', 100),
        left(v_attr ->> 'fbclid', 500), left(v_attr ->> 'gclid', 500),
        left(v_attr ->> 'fbc', 500), left(v_attr ->> 'fbp', 200),
        coalesce(p_event -> 'url_params', '{}'::jsonb),
        left(p_event ->> 'ip_address', 64), left(p_event ->> 'user_agent', 500),
        left(v_attr ->> 'landing_url', 2000), left(v_attr ->> 'referrer', 2000),
        left(p_event ->> 'device', 40),
        coalesce((v_attr ->> 'first_seen_at')::timestamptz, now()),
        v_data
      )
      on conflict (page_id, visitor_id) where visitor_id is not null do update
        set clicks = l.clicks + 1,
            last_click_at = now(),
            -- What the attendant already typed wins over the page.
            name = coalesce(l.name, excluded.name),
            phone = coalesce(l.phone, excluded.phone),
            extra = l.extra || excluded.extra,
            -- Keep the Meta click identifiers fresh for conversion matching.
            fbc = coalesce(excluded.fbc, l.fbc),
            fbp = coalesce(excluded.fbp, l.fbp),
            ip_address = coalesce(excluded.ip_address, l.ip_address),
            user_agent = coalesce(excluded.user_agent, l.user_agent),
            updated_at = now()
      returning l.id, (l.xmax = 0) into v_lead_id, v_inserted;
    end if;
    select * into v_lead from public.lh_leads where id = v_lead_id;
  else
    select id into v_lead_id from public.lh_leads
    where page_id = v_page.id and visitor_id = v_visitor;

    if v_type = 'identify' and v_lead_id is not null then
      update public.lh_leads
      set name = coalesce(name, v_name),
          phone = coalesce(phone, v_phone),
          updated_at = now()
      where id = v_lead_id;
    end if;
  end if;

  insert into public.lh_events (workspace_id, page_id, lead_id, visitor_id, type, url, data)
  values (
    v_page.workspace_id, v_page.id, v_lead_id, v_visitor, v_type,
    left(p_event ->> 'url', 2000),
    jsonb_strip_nulls(jsonb_build_object(
      'channel', p_event ->> 'channel',
      'device', p_event ->> 'device',
      'title', left(p_event ->> 'title', 300),
      'utm_source', v_attr ->> 'utm_source',
      'utm_campaign', v_attr ->> 'utm_campaign',
      -- Names used by the metrics breakdown (Meta usually sends them in utm_*).
      'campaign', coalesce(v_attr ->> 'campaign_name', v_attr ->> 'utm_campaign'),
      'adset', coalesce(v_attr ->> 'adset_name', v_attr ->> 'utm_term'),
      'ad', coalesce(v_attr ->> 'ad_name', v_attr ->> 'utm_content'),
      'code', case when v_type = 'whatsapp_click' then v_lead.code end,
      'has_phone', case when v_phone is not null then true end,
      'data', v_data
    ))
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'lead_id', v_lead_id,
    'code', v_lead.code,
    'new_lead', case when v_type = 'whatsapp_click' then v_inserted end
  ));
end;
$$;

create or replace function public.lh_metrics(p_token text, p_since timestamptz default null, p_dimension text default 'channel')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_result jsonb;
begin
  if p_dimension not in ('channel', 'campaign', 'adset', 'ad', 'device') then
    raise exception 'invalid dimension' using errcode = '22023';
  end if;

  with ev as (
    select e.visitor_id, e.type, e.created_at,
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
      and (p_since is null or e.created_at >= p_since)
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
      and (p_since is null or l.created_at >= p_since)
  ),
  ev_by as (
    select dim,
      count(distinct visitor_id) filter (where type = 'page_view') as visitors,
      count(distinct visitor_id) filter (where type = 'whatsapp_click') as clickers
    from ev group by dim
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
    select (created_at at time zone 'America/Sao_Paulo')::date as day,
      count(distinct visitor_id) filter (where type = 'page_view') as visitors,
      count(distinct visitor_id) filter (where type = 'whatsapp_click') as clickers
    from ev group by 1
  )
  select jsonb_build_object(
    'totals', jsonb_build_object(
      'visitors', (select count(distinct visitor_id) from ev where type = 'page_view'),
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
          and (p_since is null or m.created_at >= p_since)
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
$$;

-- The sheet's tiles also count people, not repeated clicks.
create or replace function public.lh_stats(p_token text, p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with ws as (select lh_private.workspace_for(p_token) as id)
  select jsonb_build_object(
    'visitors', (
      select count(distinct e.visitor_id) from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'page_view' and (p_since is null or e.created_at >= p_since)
    ),
    'clicks', (
      select count(distinct e.visitor_id) from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'whatsapp_click' and (p_since is null or e.created_at >= p_since)
    ),
    'leads', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and (p_since is null or l.created_at >= p_since)
    ),
    'with_phone', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.phone is not null and (p_since is null or l.created_at >= p_since)
    ),
    'sales', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.status = 'venda' and (p_since is null or l.created_at >= p_since)
    ),
    'revenue', (
      select coalesce(sum(l.sale_value), 0) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.status = 'venda' and (p_since is null or l.created_at >= p_since)
    )
  )
$$;

revoke all on function public.lh_metrics(text, timestamptz, text) from public;
grant execute on function public.lh_metrics(text, timestamptz, text) to anon, authenticated, service_role;
