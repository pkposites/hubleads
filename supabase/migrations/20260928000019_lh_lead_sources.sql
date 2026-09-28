-- Lead Hub: sources of leads, not only landing pages.
--
-- - A client can connect Google Sheets (typically the sheet Meta's native
--   form integration fills): an Apps Script in the sheet sends the new rows
--   to /api/sources/sheets with the source's own key. The key is shown once
--   and stored only as a hash; it can be replaced or the source paused.
-- - Rows with a Meta lead id become 'meta_form' leads (and go back to Meta as
--   CRM events like the direct integration); other rows become 'sheets'
--   leads. The same lead never enters twice (Meta lead id, or a fingerprint
--   of the row made by the app).
-- - The sheet can filter by source and the tiles/metrics count leads by
--   source.

alter table public.lh_leads drop constraint lh_leads_source_check;
alter table public.lh_leads add constraint lh_leads_source_check check (source in ('lp', 'manual', 'meta_form', 'sheets'));

create table public.lh_lead_sources (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  kind text not null check (kind in ('sheets')),
  name text not null check (char_length(name) between 1 and 120),
  key_hash text not null unique,
  key_hint text not null check (char_length(key_hint) <= 8),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  last_received_at timestamptz,
  leads_received int not null default 0,
  last_error text check (char_length(last_error) <= 300)
);

create index lh_lead_sources_workspace_idx on public.lh_lead_sources (workspace_id);
alter table public.lh_lead_sources enable row level security;
revoke all on public.lh_lead_sources from anon, authenticated;

alter table public.lh_leads
  add column source_id uuid references public.lh_lead_sources (id) on delete set null,
  add column external_id text check (char_length(external_id) <= 100);

create unique index lh_leads_external_uidx on public.lh_leads (workspace_id, external_id) where external_id is not null;

-- ---------------------------------------------------------------------------
-- Admin panel
-- ---------------------------------------------------------------------------

create or replace function public.lh_admin_list_sources(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'kind', s.kind, 'name', s.name, 'key_hint', s.key_hint, 'enabled', s.enabled,
      'created_at', s.created_at, 'last_received_at', s.last_received_at,
      'leads_received', s.leads_received, 'last_error', s.last_error
    ) order by s.created_at)
    from public.lh_lead_sources s where s.workspace_id = p_workspace_id
  ), '[]'::jsonb);
end;
$$;

/** Creates a source and returns its key (shown once). */
create or replace function public.lh_admin_create_source(p_token text, p_workspace_id uuid, p_kind text, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'lhs_' || encode(extensions.gen_random_bytes(24), 'hex');
  v_id uuid;
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  insert into public.lh_lead_sources (workspace_id, kind, name, key_hash, key_hint)
  values (p_workspace_id, p_kind, left(trim(coalesce(nullif(trim(p_name), ''), 'Google Sheets')), 120), lh_private.sha256(v_key), right(v_key, 4))
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'key', v_key);
end;
$$;

/** Replaces the key (the old one stops working) and returns the new one. */
create or replace function public.lh_admin_rotate_source_key(p_token text, p_workspace_id uuid, p_source_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text := 'lhs_' || encode(extensions.gen_random_bytes(24), 'hex');
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  update public.lh_lead_sources set key_hash = lh_private.sha256(v_key), key_hint = right(v_key, 4)
  where id = p_source_id and workspace_id = p_workspace_id;
  if not found then
    raise exception 'source not found' using errcode = 'LH404';
  end if;
  return v_key;
end;
$$;

/** Pauses/resumes (p_enabled) or deletes (p_delete) a source; its leads stay. */
create or replace function public.lh_admin_update_source(p_token text, p_workspace_id uuid, p_source_id uuid, p_enabled boolean, p_delete boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  if p_delete then
    delete from public.lh_lead_sources where id = p_source_id and workspace_id = p_workspace_id;
  else
    update public.lh_lead_sources set enabled = coalesce(p_enabled, enabled) where id = p_source_id and workspace_id = p_workspace_id;
  end if;
  if not found then
    raise exception 'source not found' using errcode = 'LH404';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- App server
-- ---------------------------------------------------------------------------

/**
 * The source of a key, if it exists and is on (null otherwise), counting
 * the request against the device's sending limits.
 */
create or replace function public.lh_server_source_for_key(p_secret text, p_client text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.lh_lead_sources;
begin
  perform lh_private.check_server(p_secret);
  if not lh_private.collect_allowed(p_client, 'other') then
    return jsonb_build_object('limited', true);
  end if;
  select * into v_source from public.lh_lead_sources where key_hash = lh_private.sha256(coalesce(p_key, ''));
  if not found or not v_source.enabled then
    return null;
  end if;
  return jsonb_build_object('id', v_source.id, 'workspace_id', v_source.workspace_id, 'name', v_source.name);
end;
$$;

/** Stores one row of a source. Returns {lead_id, new}. */
create or replace function public.lh_server_source_lead(p_secret text, p_source uuid, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.lh_lead_sources;
  v_id uuid;
  v_meta_id text := nullif(p_lead ->> 'meta_lead_id', '');
  v_external text := nullif(left(p_lead ->> 'external_id', 100), '');
  v_answers jsonb := coalesce(p_lead -> 'answers', '{}'::jsonb);
  v_created timestamptz;
begin
  perform lh_private.check_server(p_secret);
  if pg_column_size(p_lead) > 16384 then
    raise exception 'lead too large' using errcode = '22023';
  end if;
  select * into v_source from public.lh_lead_sources where id = p_source and enabled;
  if not found then
    raise exception 'source not found' using errcode = 'LH404';
  end if;
  if v_meta_id is not null and v_meta_id !~ '^[0-9]{5,30}$' then
    raise exception 'invalid lead id' using errcode = '22023';
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    v_answers := '{}'::jsonb;
  end if;
  begin
    v_created := least(coalesce((p_lead ->> 'created_time')::timestamptz, now()), now());
  exception when others then
    v_created := now();
  end;

  insert into public.lh_leads (
    workspace_id, source, source_id, code, name, phone, email, channel, meta_lead_id, meta_form_id, external_id,
    campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name, utm_campaign, utm_content, utm_term,
    site_source_name, extra, created_at, last_click_at
  )
  values (
    v_source.workspace_id,
    case when v_meta_id is not null then 'meta_form' else 'sheets' end,
    v_source.id, lh_private.random_code(),
    nullif(left(trim(p_lead ->> 'name'), 120), ''),
    nullif(left(trim(p_lead ->> 'phone'), 40), ''),
    nullif(left(lower(trim(p_lead ->> 'email')), 200), ''),
    case
      when v_meta_id is null then nullif(left(p_lead ->> 'channel', 40), '')
      when (p_lead ->> 'is_organic')::boolean then 'organic_social'
      else 'meta_ads'
    end,
    v_meta_id, nullif(left(p_lead ->> 'form_id', 40), ''),
    case when v_meta_id is null then v_external end,
    left(p_lead ->> 'campaign_id', 40), left(p_lead ->> 'adset_id', 40), left(p_lead ->> 'ad_id', 40),
    left(p_lead ->> 'campaign_name', 200), left(p_lead ->> 'adset_name', 200), left(p_lead ->> 'ad_name', 200),
    left(p_lead ->> 'campaign_name', 200), left(p_lead ->> 'ad_name', 200), left(p_lead ->> 'adset_name', 200),
    left(p_lead ->> 'platform', 40),
    v_answers || case when p_lead ? 'form_name' then jsonb_build_object('Formulário', left(p_lead ->> 'form_name', 200)) else '{}'::jsonb end,
    v_created, v_created
  )
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.lh_leads
    where workspace_id = v_source.workspace_id
      and ((v_meta_id is not null and meta_lead_id = v_meta_id) or (v_meta_id is null and external_id = v_external));
    return jsonb_build_object('lead_id', v_id, 'new', false);
  end if;
  update public.lh_lead_sources
  set leads_received = leads_received + 1, last_received_at = now(), last_error = null
  where id = v_source.id;
  return jsonb_build_object('lead_id', v_id, 'new', true);
end;
$$;

/** Records that the source sent something (and the last problem, if any). */
create or replace function public.lh_server_source_seen(p_secret text, p_source uuid, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  update public.lh_lead_sources set last_received_at = now(), last_error = left(p_error, 300) where id = p_source;
end;
$$;

-- ---------------------------------------------------------------------------
-- Sheet filter and numbers by source
-- ---------------------------------------------------------------------------

drop function public.lh_list_leads(text, timestamptz, text, text, text, integer, integer, timestamptz);

create function public.lh_list_leads(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_status text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT NULL::text)
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
      and (p_source is null or l.source = p_source)
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

create or replace function public.lh_stats(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
    ),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'source', s.source, 'leads', s.leads, 'with_phone', s.with_phone,
        'scheduled', s.scheduled, 'sales', s.sales, 'revenue', s.revenue
      ) order by s.leads desc, s.source), '[]'::jsonb)
      from (
        select l.source, count(*) as leads,
          count(*) filter (where l.phone is not null) as with_phone,
          count(*) filter (where l.status in ('agendado', 'venda')) as scheduled,
          count(*) filter (where l.status = 'venda') as sales,
          coalesce(sum(l.sale_value) filter (where l.status = 'venda'), 0) as revenue
        from public.lh_leads l, ws
        where l.workspace_id = ws.id and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
        group by l.source
      ) s
    )
  )
$function$;

create or replace function public.lh_metrics(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_dimension text DEFAULT 'channel'::text, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone)
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
    ), '[]'::jsonb),
    'by_source', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'source', s.source, 'leads', s.leads, 'with_phone', s.with_phone,
        'scheduled', s.scheduled, 'sales', s.sales, 'revenue', s.revenue
      ) order by s.leads desc, s.source), '[]'::jsonb)
      from (
        select l.source, count(*) as leads,
          count(*) filter (where l.phone is not null) as with_phone,
          count(*) filter (where l.status in ('agendado', 'venda')) as scheduled,
          count(*) filter (where l.status = 'venda') as sales,
          coalesce(sum(l.sale_value) filter (where l.status = 'venda'), 0) as revenue
        from public.lh_leads l
        where l.workspace_id = v_workspace and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
        group by l.source
      ) s
    )
  ) into v_result;

  return v_result;
end;
$function$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_list_sources(text, uuid)',
    'lh_admin_create_source(text, uuid, text, text)',
    'lh_admin_rotate_source_key(text, uuid, uuid)',
    'lh_admin_update_source(text, uuid, uuid, boolean, boolean)',
    'lh_server_source_for_key(text, text, text)',
    'lh_server_source_lead(text, uuid, jsonb)',
    'lh_server_source_seen(text, uuid, text)',
    'lh_list_leads(text, timestamptz, text, text, text, integer, integer, timestamptz, text)',
    'lh_stats(text, timestamptz, timestamptz)',
    'lh_metrics(text, timestamptz, text, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
