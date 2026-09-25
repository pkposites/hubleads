-- Lead Hub: commercial events fired by the landing page.
--
-- tracker.js reads the events the page already sends through the Meta pixel
-- or Google Tag Manager (and LeadHub.track) and stores them in lh_events as
-- type 'lp_event' with data.data.event = name. Older pages sent custom events
-- with the name as the type; both are read here. Views, scrolls and similar
-- events are noise and never shown (the same list is in tracker.js and
-- src/lib/lp-events.ts).

create or replace function lh_private.is_noise_event(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(p_name, '') = '' or lower(trim(p_name)) ~ (
    '^(pageview|page_view|viewcontent|view_content|view_item|view_item_list|view_promotion|view_search_results|'
    || 'scroll|scroll_depth|user_engagement|session_start|first_visit|timer|click|file_download|form_start|'
    || 'video_start|video_progress|video_complete|subscribedbuttonclick|microdata|inputdata|(gtm|gtag|optimize)\..*)$'
  )
$$;

/** Name of a commercial page event, or null for visits, clicks, identify and noise. */
create or replace function lh_private.lp_event_name(p_type text, p_data jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n is null or lh_private.is_noise_event(n) then null
    else n
  end
  from (
    select case
      when p_type = 'lp_event' then left(p_data -> 'data' ->> 'event', 60)
      when p_type in ('page_view', 'whatsapp_click', 'identify') then null
      else p_type
    end as n
  ) x
$$;

create index lh_events_workspace_type_idx on public.lh_events (workspace_id, type, created_at);

/** For the sheet and the queue: each lead's page events, in the order they first happened. */
create or replace function public.lh_lead_lp_events(p_token text, p_lead_ids uuid[])
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.lead_id, x.events), '{}'::jsonb)
  from (
    select l.id as lead_id, jsonb_agg(e.name order by e.first_at) as events
    from public.lh_leads l
    join lateral (
      select lh_private.lp_event_name(ev.type, ev.data) as name, min(ev.created_at) as first_at
      from public.lh_events ev
      where ev.page_id = l.page_id and ev.visitor_id = l.visitor_id
        and ev.type not in ('page_view', 'whatsapp_click', 'identify')
      group by 1
    ) e on e.name is not null
    where l.workspace_id = lh_private.workspace_for(p_token)
      and l.id = any (p_lead_ids[1:500])
    group by l.id
  ) x
$$;

create or replace function public.lh_lead_detail(p_token text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_lead public.lh_leads;
begin
  select * into v_lead from public.lh_leads where id = p_lead_id and workspace_id = v_workspace;
  if not found then
    raise exception 'lead not found' using errcode = 'LH404';
  end if;
  return jsonb_build_object(
    'lead', lh_private.lead_json(v_lead),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', h.type, 'from', h.from_value, 'to', h.to_value, 'actor', h.actor, 'at', h.created_at
      ) order by h.created_at, h.id)
      from public.lh_lead_history h where h.lead_id = v_lead.id
    ), '[]'::jsonb),
    'meta', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', m.event_name, 'ok', m.ok, 'test', m.test, 'at', m.created_at
      ) order by m.created_at)
      from public.lh_meta_events m where m.lead_id = v_lead.id
    ), '[]'::jsonb),
    'lp_events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', x.name, 'source', x.source, 'value', x.value, 'at', x.created_at
      ) order by x.created_at)
      from (
        select lh_private.lp_event_name(e.type, e.data) as name,
               e.data -> 'data' ->> 'source' as source,
               e.data -> 'data' -> 'value' as value,
               e.created_at
        from public.lh_events e
        where v_lead.visitor_id is not null
          and e.page_id = v_lead.page_id and e.visitor_id = v_lead.visitor_id
          and e.type not in ('page_view', 'whatsapp_click', 'identify')
        order by e.created_at
        limit 100
      ) x
      where x.name is not null
    ), '[]'::jsonb)
  );
end;
$$;

/** Each commercial event: how many people fired it, and how many of them became leads and sales. */
create or replace function public.lh_lp_event_metrics(p_token text, p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with ev as (
    select lh_private.lp_event_name(e.type, e.data) as name, e.page_id, e.visitor_id
    from public.lh_events e
    where e.workspace_id = lh_private.workspace_for(p_token)
      and e.type not in ('page_view', 'whatsapp_click', 'identify')
      and (p_since is null or e.created_at >= p_since)
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
$$;

/** Meta pixel ids seen on the client's pages in the last 30 days (to check the CAPI setup). */
create or replace function public.lh_admin_lp_pixels(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_for(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object('pixel_id', x.pixel_id, 'last_seen', x.last_seen) order by x.last_seen desc)
    from (
      select e.data -> 'data' ->> 'pixel_id' as pixel_id, max(e.created_at) as last_seen
      from public.lh_events e
      where e.workspace_id = p_workspace_id and e.type = 'lp_event'
        and e.created_at > now() - interval '30 days'
        and e.data -> 'data' ->> 'pixel_id' ~ '^[0-9]{5,30}$'
      group by 1
      limit 10
    ) x
  ), '[]'::jsonb);
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_lead_lp_events(text, uuid[])',
    'lh_lead_detail(text, uuid)',
    'lh_lp_event_metrics(text, timestamptz)',
    'lh_admin_lp_pixels(text, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
