-- Lead Hub: conversions back to Google Ads (offline conversion import).
--
-- - Google Ads fetches, on a schedule, a file with the client's conversions:
--   Lead (the lead arrived), Agendamento and Venda (with the value), each with
--   the lead's Google click id (gclid). No Google API access is needed: the
--   admin pastes the file address, user and password in Google Ads
--   (Metas > Conversões > Uploads > Programações).
-- - The address has a random id and the password is stored only as a hash.
-- - The file lists the last 30 days of conversions every time (Google ignores
--   the ones it already has), only for leads that came from a Google ad click
--   in the last 90 days.

create table public.lh_google_ads (
  workspace_id uuid primary key references public.lh_workspaces (id) on delete cascade,
  feed_id uuid not null unique default gen_random_uuid(),
  username text not null check (char_length(username) between 6 and 60),
  password_hash text not null,
  enabled boolean not null default true,
  lead_name text not null default 'Lead Hub - Lead' check (char_length(lead_name) between 1 and 100),
  schedule_name text not null default 'Lead Hub - Agendamento' check (char_length(schedule_name) between 1 and 100),
  purchase_name text not null default 'Lead Hub - Venda' check (char_length(purchase_name) between 1 and 100),
  send_lead boolean not null default true,
  send_schedule boolean not null default true,
  send_purchase boolean not null default true,
  created_at timestamptz not null default now(),
  last_fetch_at timestamptz,
  last_rows int
);

alter table public.lh_google_ads enable row level security;
revoke all on public.lh_google_ads from anon, authenticated;

create or replace function lh_private.google_ads_json(g public.lh_google_ads)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(g) - 'password_hash' - 'workspace_id'
    || jsonb_build_object('with_gclid_90d', (
      select count(*) from public.lh_leads l
      where l.workspace_id = g.workspace_id and coalesce(l.gclid, '') <> '' and l.created_at > now() - interval '90 days'
    ))
$$;

/** The client's Google Ads settings (without the password), or null. */
create or replace function public.lh_admin_get_google_ads(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lh_google_ads;
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  select * into v_row from public.lh_google_ads where workspace_id = p_workspace_id;
  if not found then
    return null;
  end if;
  return lh_private.google_ads_json(v_row);
end;
$$;

/**
 * Turns the Google Ads file on (or gives it a new password). Returns the
 * settings and the password, shown once.
 */
create or replace function public.lh_admin_google_ads_credentials(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text := encode(extensions.gen_random_bytes(18), 'hex');
  v_row public.lh_google_ads;
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  insert into public.lh_google_ads (workspace_id, username, password_hash)
  values (p_workspace_id, 'leadhub-' || encode(extensions.gen_random_bytes(4), 'hex'), lh_private.sha256(v_password))
  on conflict (workspace_id) do update set password_hash = excluded.password_hash
  returning * into v_row;
  return lh_private.google_ads_json(v_row) || jsonb_build_object('password', v_password);
end;
$$;

/** Conversion names and which conversions go; p_delete turns it off for good. */
create or replace function public.lh_admin_update_google_ads(p_token text, p_workspace_id uuid, p_settings jsonb, p_delete boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lh_google_ads;
  v_name text;
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  if p_delete then
    delete from public.lh_google_ads where workspace_id = p_workspace_id;
    return null;
  end if;
  foreach v_name in array array['lead_name', 'schedule_name', 'purchase_name'] loop
    if p_settings ? v_name and char_length(trim(coalesce(p_settings ->> v_name, ''))) not between 1 and 100 then
      raise exception 'invalid name' using errcode = '22023';
    end if;
  end loop;
  update public.lh_google_ads g set
    enabled = coalesce((p_settings ->> 'enabled')::boolean, g.enabled),
    lead_name = coalesce(trim(p_settings ->> 'lead_name'), g.lead_name),
    schedule_name = coalesce(trim(p_settings ->> 'schedule_name'), g.schedule_name),
    purchase_name = coalesce(trim(p_settings ->> 'purchase_name'), g.purchase_name),
    send_lead = coalesce((p_settings ->> 'send_lead')::boolean, g.send_lead),
    send_schedule = coalesce((p_settings ->> 'send_schedule')::boolean, g.send_schedule),
    send_purchase = coalesce((p_settings ->> 'send_purchase')::boolean, g.send_purchase)
  where g.workspace_id = p_workspace_id
  returning * into v_row;
  if not found then
    raise exception 'google ads not set up' using errcode = 'LH404';
  end if;
  return lh_private.google_ads_json(v_row);
end;
$$;

/**
 * The conversions of a feed, for the app's server, when the user and password
 * match (null otherwise). Counts against the caller's sending limits.
 */
create or replace function public.lh_server_google_ads_feed(p_secret text, p_client text, p_feed_id uuid, p_username text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.lh_google_ads;
  v_rows jsonb;
begin
  perform lh_private.check_server(p_secret);
  if not lh_private.collect_allowed(p_client, 'other') then
    return jsonb_build_object('limited', true);
  end if;
  select * into v_row from public.lh_google_ads
  where feed_id = p_feed_id and enabled and username = coalesce(p_username, '')
    and password_hash = lh_private.sha256(coalesce(p_password, ''));
  if not found then
    return null;
  end if;

  with leads as (
    select l.id, l.gclid, l.created_at, l.status, l.sale_value, l.updated_at
    from public.lh_leads l
    where l.workspace_id = v_row.workspace_id and coalesce(l.gclid, '') <> '' and l.created_at > now() - interval '90 days'
  ),
  steps as (
    select h.lead_id,
      min(h.created_at) filter (where split_part(h.to_value, ' · ', 1) in ('agendado', 'venda')) as scheduled_at,
      min(h.created_at) filter (where split_part(h.to_value, ' · ', 1) = 'venda') as sold_at
    from public.lh_lead_history h join leads on leads.id = h.lead_id
    where h.type = 'status'
    group by h.lead_id
  ),
  conversions as (
    select l.gclid, v_row.lead_name as name, l.created_at as at, null::numeric as value
    from leads l where v_row.send_lead
    union all
    select l.gclid, v_row.schedule_name, s.scheduled_at, null
    from leads l join steps s on s.lead_id = l.id
    where v_row.send_schedule and l.status in ('agendado', 'venda') and s.scheduled_at is not null
    union all
    select l.gclid, v_row.purchase_name, coalesce(s.sold_at, l.updated_at), l.sale_value
    from leads l left join steps s on s.lead_id = l.id
    where v_row.send_purchase and l.status = 'venda' and coalesce(l.sale_value, 0) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'gclid', c.gclid,
    'name', c.name,
    'time', to_char(c.at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI:SS'),
    'value', c.value
  ) order by c.at), '[]'::jsonb)
  into v_rows
  from (select * from conversions where at > now() - interval '30 days' order by at desc limit 5000) c;

  update public.lh_google_ads set last_fetch_at = now(), last_rows = jsonb_array_length(v_rows) where workspace_id = v_row.workspace_id;
  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_get_google_ads(text, uuid)',
    'lh_admin_google_ads_credentials(text, uuid)',
    'lh_admin_update_google_ads(text, uuid, jsonb, boolean)',
    'lh_server_google_ads_feed(text, text, uuid, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
