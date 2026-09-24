-- Lead Hub: keep the landing page's answers (quiz, form steps) on the lead.
--
-- tracker.js now sends the answers collected on the page with the WhatsApp
-- click (LeadHub.set / LeadHub.whatsappUrl(url, answers)). They are stored in
-- lh_leads.extra and shown as columns in the sheet. A repeated click from the
-- same visitor merges new answers into the row instead of dropping them.

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
    insert into public.lh_leads as l (
      workspace_id, page_id, visitor_id, code, name,
      channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
      campaign_id, adset_id, ad_id, fbclid, gclid, fbc, fbp,
      landing_url, referrer, device, first_seen_at, extra
    )
    values (
      v_page.workspace_id, v_page.id, v_visitor,
      coalesce(nullif(upper(left(p_event ->> 'code', 8)), ''), lh_private.random_code()),
      nullif(left(p_event ->> 'name', 120), ''),
      left(p_event ->> 'channel', 40),
      left(v_attr ->> 'utm_source', 200), left(v_attr ->> 'utm_medium', 200),
      left(v_attr ->> 'utm_campaign', 300), left(v_attr ->> 'utm_content', 300),
      left(v_attr ->> 'utm_term', 300),
      left(v_attr ->> 'campaign_id', 100), left(v_attr ->> 'adset_id', 100), left(v_attr ->> 'ad_id', 100),
      left(v_attr ->> 'fbclid', 500), left(v_attr ->> 'gclid', 500),
      left(v_attr ->> 'fbc', 500), left(v_attr ->> 'fbp', 200),
      left(v_attr ->> 'landing_url', 2000), left(v_attr ->> 'referrer', 2000),
      left(p_event ->> 'device', 40),
      coalesce((v_attr ->> 'first_seen_at')::timestamptz, now()),
      coalesce(p_event -> 'data', '{}'::jsonb)
    )
    on conflict (page_id, visitor_id) where visitor_id is not null do update
      set clicks = l.clicks + 1,
          last_click_at = now(),
          name = coalesce(l.name, excluded.name),
          -- Answers from a later click (e.g. the quiz redone) add to the row.
          extra = l.extra || excluded.extra,
          updated_at = now()
    returning l.id, (l.xmax = 0) into v_lead_id, v_inserted;
    select * into v_lead from public.lh_leads where id = v_lead_id;
  else
    select id into v_lead_id from public.lh_leads
    where page_id = v_page.id and visitor_id = v_visitor;

    if v_type = 'identify' and v_lead_id is not null and nullif(p_event ->> 'name', '') is not null then
      update public.lh_leads set name = left(p_event ->> 'name', 120), updated_at = now()
      where id = v_lead_id and name is null;
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
      'code', case when v_type = 'whatsapp_click' then v_lead.code end,
      'data', p_event -> 'data'
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
