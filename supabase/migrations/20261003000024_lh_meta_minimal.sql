-- Lead Hub: measurement without cookies for visitors who did not accept them.
--
-- On landing pages with the consent banner, the Meta pixel only runs after
-- "Aceitar", so Meta lost most page views and leads. With minimal_tracking on
-- (the default), Lead Hub's server still tells Meta, through the Conversions
-- API, about:
--   - the page view (PageView), sent straight away and never stored;
--   - the WhatsApp click (Lead) and later Schedule / Purchase.
-- Only the ad click id read from the page address (fbc, never a cookie), the
-- IP and the browser go; no name, phone, visitor id or _fbp. Nothing is stored
-- on the visitor's device. Clients without the Meta setup, or with the option
-- off, keep the previous behaviour: nothing about these visitors is kept.

alter table public.lh_meta_configs
  add column minimal_tracking boolean not null default true,
  add column minimal_views int not null default 0,
  add column minimal_views_day date;

/** Whether the page's client sends measurement without cookies to Meta. */
create or replace function lh_private.minimal_on(p_key text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.lh_pages p
    join public.lh_meta_configs c on c.workspace_id = p.workspace_id
    where p.public_key = p_key and c.enabled and c.minimal_tracking
  )
$$;

/**
 * Events from the landing pages. A visitor who did not accept cookies keeps
 * IP, browser and the ad click id only when the client sends measurement
 * without cookies; otherwise only the typed contact arrives (as before).
 */
create or replace function public.lh_server_collect(p_secret text, p_client text, p_key text, p_origin_host text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb := p_event;
begin
  perform lh_private.check_server(p_secret);
  if not lh_private.collect_allowed(p_client, p_event ->> 'type') then
    return jsonb_build_object('limited', true);
  end if;
  if v_event ->> 'consent' = 'false' then
    if lh_private.minimal_on(p_key) then
      v_event := jsonb_set(v_event, '{attribution}', jsonb_strip_nulls(jsonb_build_object(
        'fbc', v_event -> 'attribution' ->> 'fbc',
        'landing_url', v_event -> 'attribution' ->> 'landing_url'
      )));
    else
      v_event := v_event - 'ip_address' - 'user_agent' - 'attribution' - 'url_params';
    end if;
  end if;
  return lh_private.lh_collect(p_key, p_origin_host, v_event);
end;
$$;

/**
 * Page view of a visitor without cookies: the client's pixel and token for the
 * app's server to send it to Meta (null when the page, the site or the option
 * does not allow it). Counts the day's sends; stores nothing about the visit.
 */
create or replace function public.lh_server_meta_view(p_secret text, p_client text, p_key text, p_origin_host text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.lh_pages;
  v_config public.lh_meta_configs;
begin
  perform lh_private.check_server(p_secret);
  if not lh_private.collect_allowed(p_client, 'meta_view') then
    return jsonb_build_object('limited', true);
  end if;
  select * into v_page from public.lh_pages where public_key = p_key;
  if not found then
    return null;
  end if;
  if cardinality(v_page.domains) > 0 and not exists (
    select 1 from unnest(v_page.domains) d
    where lower(coalesce(p_origin_host, '')) = d
       or (d like '*.%' and lower(coalesce(p_origin_host, '')) like '%' || substr(d, 2))
  ) then
    return null;
  end if;
  update public.lh_meta_configs c set
    minimal_views = case when c.minimal_views_day = current_date then c.minimal_views + 1 else 1 end,
    minimal_views_day = current_date
  where c.workspace_id = v_page.workspace_id and c.enabled and c.minimal_tracking
  returning * into v_config;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'pixel_id', v_config.pixel_id,
    'access_token', v_config.access_token,
    'test_event_code', v_config.test_event_code
  );
end;
$$;

create or replace function public.lh_server_meta_payload(p_secret text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.lh_leads;
  v_config public.lh_meta_configs;
begin
  perform lh_private.check_server(p_secret);
  select * into v_lead from public.lh_leads where id = p_lead_id;
  if not found then
    return null;
  end if;
  select * into v_config from public.lh_meta_configs where workspace_id = v_lead.workspace_id and enabled;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'config', jsonb_build_object(
      'pixel_id', v_config.pixel_id, 'access_token', v_config.access_token,
      'test_event_code', v_config.test_event_code,
      'send_schedule', v_config.send_schedule, 'send_purchase', v_config.send_purchase,
      'minimal_tracking', v_config.minimal_tracking
    ),
    'lead', to_jsonb(v_lead),
    'status_at', lh_private.status_at(v_lead.id, v_lead.status),
    'sent', coalesce((
      select jsonb_agg(distinct m.event_name) from public.lh_meta_events m
      where m.lead_id = v_lead.id and m.ok and not m.test
    ), '[]'::jsonb)
  );
end;
$$;

/** Leads Meta still owes; now also the Lead of visitors without cookies. */
create or replace function public.lh_server_meta_pending(p_secret text, p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  return coalesce((
    select jsonb_agg(x.id order by x.status_at)
    from (
      select c.id, c.status_at
      from (
        select l.id, l.status, l.sale_value, cfg.send_schedule, cfg.send_purchase,
               case l.status when 'agendado' then 'Schedule' else 'Purchase' end as event_name,
               lh_private.status_at(l.id, l.status) as status_at
        from public.lh_leads l
        join public.lh_meta_configs cfg
          on cfg.workspace_id = l.workspace_id and cfg.enabled and cfg.test_event_code is null
        where l.status in ('agendado', 'venda')
          -- Without cookies: only with something Meta can match (IP and browser, or the ad click id).
          and (l.tracking_consent is distinct from false
               or (cfg.minimal_tracking and (l.user_agent is not null or l.fbc is not null)))
          and l.updated_at > now() - interval '8 days'
        union all
        select l.id, 'lead', null, true, true, 'Lead', l.created_at
        from public.lh_leads l
        join public.lh_meta_configs cfg
          on cfg.workspace_id = l.workspace_id and cfg.enabled and cfg.test_event_code is null
        where l.created_at > now() - interval '7 days'
          and (
            (l.source = 'meta_form' and l.meta_lead_id is not null)
            or (l.source = 'lp' and l.tracking_consent = false and cfg.minimal_tracking and l.user_agent is not null)
          )
      ) c
      where c.status_at > now() - interval '7 days'
        and ((c.status = 'agendado' and c.send_schedule) or (c.status = 'venda' and c.send_purchase and c.sale_value > 0) or c.status = 'lead')
        and not exists (
          select 1 from public.lh_meta_events m
          where m.lead_id = c.id and m.event_name = c.event_name and m.ok and not m.test
        )
        and (
          select count(*) from public.lh_meta_events m
          where m.lead_id = c.id and m.event_name = c.event_name and not m.ok and not m.test
        ) < 6
        and not exists (
          select 1 from public.lh_meta_events m
          where m.lead_id = c.id and m.event_name = c.event_name and m.created_at > now() - interval '50 minutes'
        )
      order by c.status_at
      limit greatest(1, least(coalesce(p_limit, 20), 100))
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function lh_private.lh_admin_get_meta(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lh_meta_configs;
  v_found boolean;
begin
  perform lh_private.admin_for(p_token);
  select * into v_config from public.lh_meta_configs where workspace_id = p_workspace_id;
  v_found := found;
  return jsonb_build_object(
    'configured', v_found,
    'pixel_id', v_config.pixel_id,
    'token_hint', case when v_found then '••••' || coalesce(v_config.token_hint, '') end,
    'test_event_code', v_config.test_event_code,
    'enabled', coalesce(v_config.enabled, false),
    'send_schedule', coalesce(v_config.send_schedule, true),
    'send_purchase', coalesce(v_config.send_purchase, true),
    'minimal_tracking', coalesce(v_config.minimal_tracking, true),
    'minimal_views_today', case when v_config.minimal_views_day = current_date then v_config.minimal_views else 0 end,
    'minimal_leads_7d', (
      select count(*) from public.lh_meta_events m join public.lh_leads l on l.id = m.lead_id
      where m.workspace_id = p_workspace_id and m.ok and not m.test and l.tracking_consent = false
        and m.created_at > now() - interval '7 days'
    ),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('event', m.event_name, 'ok', m.ok, 'test', m.test, 'at', m.created_at, 'response', m.response)
                       order by m.created_at desc)
      from (select * from public.lh_meta_events where workspace_id = p_workspace_id order by created_at desc limit 10) m
    ), '[]'::jsonb),
    'failures_24h', (
      select count(*) from public.lh_meta_events m
      where m.workspace_id = p_workspace_id and not m.ok and not m.test and m.created_at > now() - interval '24 hours'
    ),
    'last_error', (
      select m.response from public.lh_meta_events m
      where m.workspace_id = p_workspace_id and not m.ok
      order by m.created_at desc limit 1
    ),
    'last_ok_at', (
      select max(m.created_at) from public.lh_meta_events m
      where m.workspace_id = p_workspace_id and m.ok and not m.test
    ),
    -- Results the landing page also sends itself: Meta would count them twice.
    'lp_conflicts', coalesce((
      select jsonb_agg(distinct e.data -> 'data' ->> 'event')
      from public.lh_events e
      where e.workspace_id = p_workspace_id and e.type = 'lp_event'
        and e.created_at > now() - interval '30 days'
        and e.data -> 'data' ->> 'event' in ('Schedule', 'Purchase')
        and coalesce(e.data -> 'data' ->> 'source', '') in ('pixel', 'gtm', 'gtag')
    ), '[]'::jsonb)
  );
end;
$$;

/** Turns measurement without cookies on or off for a client. */
create or replace function public.lh_admin_set_meta_minimal(p_token text, p_workspace_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  update public.lh_meta_configs set minimal_tracking = coalesce(p_enabled, true), updated_at = now()
  where workspace_id = p_workspace_id;
  if not found then
    raise exception 'meta not set up' using errcode = 'LH404';
  end if;
end;
$$;

/** Public privacy policy data; 'minimal' says the measurement without cookies is on. */
create or replace function public.lh_public_privacy(p_ref text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'name', w.name,
    'slug', w.slug,
    'controller', coalesce(w.privacy_controller, w.name),
    'document', w.privacy_document,
    'email', w.privacy_email,
    'retention_months', w.retention_months,
    'updated_at', coalesce(w.privacy_updated_at, w.created_at),
    'meta', exists (select 1 from public.lh_meta_configs m where m.workspace_id = w.id and m.enabled),
    'minimal', exists (select 1 from public.lh_meta_configs m where m.workspace_id = w.id and m.enabled and m.minimal_tracking)
  )
  from public.lh_workspaces w
  where w.slug = lower(trim(p_ref))
     or w.id = (select p.workspace_id from public.lh_pages p where p.public_key = p_ref)
  limit 1
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_server_collect(text, text, text, text, jsonb)',
    'lh_server_meta_view(text, text, text, text)',
    'lh_server_meta_payload(text, uuid)',
    'lh_server_meta_pending(text, integer)',
    'lh_admin_set_meta_minimal(text, uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
