-- Lead Hub: every visitor counts, with or without cookie consent.
--
-- Until now visitors were counted from page_view events, which only exist for
-- people who accepted cookies, so the conversion rate was inflated (a page
-- with 5 "visitors" and 4 leads). The tracker now also sends an anonymous
-- "visit" on every page load: no identifier, no storage in the browser, only
-- where the visit came from (channel, campaign names, device).
--
-- - The app hashes IP + browser (the raw values never reach the database).
--   Here that hash is hashed again with a random salt of the day, only to
--   count each person once per day and page; salts and hashes are deleted
--   after two days, so nothing can be linked back to a person.
-- - lh_visit_stats keeps only counters per page, day, channel, campaign,
--   ad set, ad and device.
-- - Metrics use, for each day, the larger of the anonymous count and the
--   people counted with consent (days before this change have only the
--   latter). A period's visitors are the sum of its days.

create table public.lh_visit_stats (
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  page_id uuid not null references public.lh_pages (id) on delete cascade,
  day date not null,
  channel text not null default '',
  campaign text not null default '',
  adset text not null default '',
  ad text not null default '',
  device text not null default '',
  visitors int not null default 0,
  views int not null default 0,
  primary key (page_id, day, channel, campaign, adset, ad, device)
);

create index lh_visit_stats_workspace_idx on public.lh_visit_stats (workspace_id, day);
alter table public.lh_visit_stats enable row level security;
revoke all on public.lh_visit_stats from anon, authenticated;

create table lh_private.visit_salts (
  day date primary key,
  salt bytea not null
);

create table lh_private.visit_seen (
  page_id uuid not null,
  day date not null,
  hash text not null,
  primary key (page_id, day, hash)
);

create index visit_seen_day_idx on lh_private.visit_seen (day);

/** p_client: SHA-256 (hex) of IP + user agent, made by the app's server. */
create or replace function public.lh_count_visit(p_key text, p_origin_host text, p_client text, p_dims jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.lh_pages;
  v_day date := (now() at time zone 'America/Sao_Paulo')::date;
  v_salt bytea;
  v_new boolean;
  v_dims jsonb := coalesce(p_dims, '{}'::jsonb);
begin
  if coalesce(p_client, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid client' using errcode = '22023';
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

  -- Yesterday's salt stays until the day after, then both go.
  delete from lh_private.visit_seen where day < v_day - 1;
  delete from lh_private.visit_salts where day < v_day - 1;
  insert into lh_private.visit_salts (day, salt) values (v_day, extensions.gen_random_bytes(32))
  on conflict (day) do nothing;
  select salt into v_salt from lh_private.visit_salts where day = v_day;

  insert into lh_private.visit_seen (page_id, day, hash)
  values (v_page.id, v_day, encode(extensions.digest(v_salt || convert_to(v_page.id::text || p_client, 'UTF8'), 'sha256'), 'hex'))
  on conflict do nothing;
  v_new := found;

  insert into public.lh_visit_stats as s (workspace_id, page_id, day, channel, campaign, adset, ad, device, visitors, views)
  values (
    v_page.workspace_id, v_page.id, v_day,
    left(coalesce(v_dims ->> 'channel', ''), 40),
    left(coalesce(v_dims ->> 'campaign', ''), 200),
    left(coalesce(v_dims ->> 'adset', ''), 200),
    left(coalesce(v_dims ->> 'ad', ''), 200),
    left(coalesce(v_dims ->> 'device', ''), 40),
    case when v_new then 1 else 0 end, 1
  )
  on conflict (page_id, day, channel, campaign, adset, ad, device) do update
  set visitors = s.visitors + excluded.visitors, views = s.views + 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Metrics: visitors per day = greatest(anonymous count, people with consent)
-- ---------------------------------------------------------------------------

create or replace function public.lh_metrics(p_token text, p_since timestamptz default null, p_dimension text default 'channel')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
      and (p_since is null or e.created_at >= p_since)
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
      and (p_since is null or l.created_at >= p_since)
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

create or replace function public.lh_stats(p_token text, p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with ws as (select lh_private.workspace_for(p_token) as id),
  day_total as (
    select coalesce(a.day, c.day) as day, greatest(coalesce(a.visitors, 0), coalesce(c.visitors, 0)) as visitors
    from (
      select s.day, sum(s.visitors)::int as visitors from public.lh_visit_stats s, ws
      where s.workspace_id = ws.id and (p_since is null or s.day >= (p_since at time zone 'America/Sao_Paulo')::date)
      group by 1
    ) a
    full outer join (
      select (e.created_at at time zone 'America/Sao_Paulo')::date as day, count(distinct e.visitor_id)::int as visitors
      from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'page_view' and (p_since is null or e.created_at >= p_since)
      group by 1
    ) c on c.day = a.day
  )
  select jsonb_build_object(
    'visitors', (select coalesce(sum(visitors), 0) from day_total),
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

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_count_visit(text, text, text, jsonb)',
    'lh_metrics(text, timestamptz, text)',
    'lh_stats(text, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
