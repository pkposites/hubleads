-- Lead Hub: reliable conversions to Meta.
--
-- 1. Retries. lh_server_meta_pending lists leads whose Schedule/Purchase is
--    still owed to Meta (live mode only), so the app's server can resend them
--    every hour: at most 6 failed attempts per event, spaced by 50 minutes,
--    and only while the booking or sale is less than 7 days old (Meta refuses
--    older events). It also sends what was booked or sold before the
--    integration was switched on or while it was in test mode.
-- 2. The event time is the moment the status changed (from the lead history),
--    not the moment it was sent.
-- 3. Failures show up in the admin panel (count and last error); the lead
--    history gets one "falhou" line per event, not one per retry.
-- 4. The admin sees when the landing page itself fires Schedule or Purchase
--    through the pixel or GTM, which would count the same result twice.

/** When the lead last entered its current status, from the history. */
create or replace function lh_private.status_at(p_lead_id uuid, p_status text)
returns timestamptz
language sql
stable
set search_path = ''
as $$
  select max(h.created_at) from public.lh_lead_history h
  where h.lead_id = p_lead_id and h.type = 'status' and split_part(h.to_value, ' · ', 1) = p_status
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
      'send_schedule', v_config.send_schedule, 'send_purchase', v_config.send_purchase
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

/** Leads that still owe Meta an event and may be tried now (oldest first). */
create or replace function public.lh_server_meta_pending(p_secret text, p_limit int default 20)
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
          and l.tracking_consent is distinct from false
          and l.updated_at > now() - interval '8 days'
      ) c
      where c.status_at > now() - interval '7 days'
        and ((c.status = 'agendado' and c.send_schedule) or (c.status = 'venda' and c.send_purchase and c.sale_value > 0))
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

create or replace function public.lh_server_meta_log(
  p_secret text,
  p_workspace_id uuid,
  p_lead_id uuid,
  p_event_name text,
  p_event_id text,
  p_ok boolean,
  p_test boolean,
  p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_failed_before boolean;
begin
  perform lh_private.check_server(p_secret);
  v_failed_before := p_lead_id is not null and exists (
    select 1 from public.lh_meta_events m
    where m.lead_id = p_lead_id and m.event_name = p_event_name and not m.ok and m.test = coalesce(p_test, false)
  );
  insert into public.lh_meta_events (workspace_id, lead_id, event_name, event_id, ok, test, response)
  values (p_workspace_id, p_lead_id, left(p_event_name, 60), left(p_event_id, 200), p_ok, coalesce(p_test, false), left(p_response, 2000));
  -- One history line per outcome: retries of a failure do not repeat it.
  if p_lead_id is not null and (p_ok or not v_failed_before) then
    insert into public.lh_lead_history (lead_id, workspace_id, type, to_value, actor)
    values (p_lead_id, p_workspace_id, 'meta',
            p_event_name || case when p_ok then ' enviado' else ' falhou (nova tentativa automática)' end, 'sistema');
  end if;
end;
$$;

create or replace function public.lh_admin_get_meta(p_token text, p_workspace_id uuid)
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

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_server_meta_payload(text, uuid)',
    'lh_server_meta_pending(text, int)',
    'lh_server_meta_log(text, uuid, uuid, text, text, boolean, boolean, text)',
    'lh_admin_get_meta(text, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
