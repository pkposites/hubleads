-- Cadê o Lead: landing pages with a form (no WhatsApp button) create leads too.
--
-- The tracker sends "form_submit" when the visitor sends a form with a phone
-- (or the page fires its Lead event with a phone on the page). It creates or
-- updates the lead exactly like a WhatsApp click, under the same sending
-- limits.

create or replace function lh_private.lh_collect(p_key text, p_origin_host text, p_event jsonb)
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
  -- null: page without the consent option (older installs); false: the
  -- visitor refused tracking, so only the contact typed on the page arrives.
  v_consent boolean := case p_event ->> 'consent' when 'true' then true when 'false' then false end;
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

  if v_type in ('whatsapp_click', 'form_submit') then
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
          tracking_consent = coalesce(v_consent, l.tracking_consent),
          updated_at = now()
      where l.id = v_lead.id;
      v_lead_id := v_lead.id;
    else
      insert into public.lh_leads as l (
        workspace_id, page_id, visitor_id, code, name, phone,
        channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name, placement, site_source_name,
        fbclid, gclid, fbc, fbp, url_params, ip_address, user_agent,
        landing_url, referrer, device, first_seen_at, extra, tracking_consent
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
        v_data, v_consent
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
            tracking_consent = coalesce(excluded.tracking_consent, l.tracking_consent),
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
      'code', case when v_type in ('whatsapp_click', 'form_submit') then v_lead.code end,
      'has_phone', case when v_phone is not null then true end,
      'data', v_data
    ))
  );

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true,
    'lead_id', v_lead_id,
    'code', v_lead.code,
    'new_lead', case when v_type in ('whatsapp_click', 'form_submit') then v_inserted end
  ));
end;
$$;

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
  -- A form sent counts against the same limits as a WhatsApp click.
  if not lh_private.collect_allowed(p_client, case p_event ->> 'type' when 'form_submit' then 'whatsapp_click' else p_event ->> 'type' end) then
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

revoke all on all functions in schema lh_private from public, anon, authenticated;
revoke all on function public.lh_server_collect(text, text, text, text, jsonb) from public;
grant execute on function public.lh_server_collect(text, text, text, text, jsonb) to anon, authenticated, service_role;
