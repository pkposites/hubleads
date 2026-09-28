-- Lead Hub: leads from Meta's native forms (Lead Ads), straight from Meta.
--
-- - Each client can connect one Meta access token (a system user token with
--   leads_retrieval, encrypted by the app like the Conversions API token) and
--   choose which forms of its Pages feed the sheet.
-- - Every minute the app asks Meta for the new leads of each enabled form
--   (from a cursor: the time of the last lead imported) and stores them with
--   source 'meta_form', the Meta lead id, campaign/ad set/ad names and the
--   form answers. The same Meta lead is never stored twice.
-- - These leads go back to Meta as CRM events (Conversion Leads): "Lead" when
--   it arrives, then Schedule and Purchase with the lead id, so campaigns can
--   optimize for leads that become sales.

alter table public.lh_leads drop constraint lh_leads_source_check;
alter table public.lh_leads add constraint lh_leads_source_check check (source in ('lp', 'manual', 'meta_form'));
alter table public.lh_leads
  add column meta_lead_id text check (meta_lead_id ~ '^[0-9]{5,30}$'),
  add column meta_form_id text,
  add column email text check (char_length(email) <= 200);

create unique index lh_leads_meta_lead_uidx on public.lh_leads (workspace_id, meta_lead_id) where meta_lead_id is not null;

create table public.lh_meta_lead_access (
  workspace_id uuid primary key references public.lh_workspaces (id) on delete cascade,
  access_token text not null
    constraint lh_meta_lead_access_token_encrypted check (access_token ~ '^enc:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$'),
  token_hint text check (char_length(token_hint) <= 8),
  updated_at timestamptz not null default now()
);

create table public.lh_meta_lead_forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  page_id text not null check (page_id ~ '^[0-9]{5,30}$'),
  page_name text check (char_length(page_name) <= 200),
  form_id text not null check (form_id ~ '^[0-9]{5,30}$'),
  form_name text check (char_length(form_name) <= 200),
  enabled boolean not null default true,
  -- Unix time of the newest lead imported (Meta's created_time).
  cursor_time bigint not null,
  last_sync_at timestamptz,
  last_error text check (char_length(last_error) <= 300),
  leads_imported int not null default 0,
  created_at timestamptz not null default now(),
  unique (workspace_id, form_id)
);

alter table public.lh_meta_lead_access enable row level security;
alter table public.lh_meta_lead_forms enable row level security;
revoke all on public.lh_meta_lead_access, public.lh_meta_lead_forms from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Admin panel (every function checks that the admin may manage the client)
-- ---------------------------------------------------------------------------

create or replace function public.lh_admin_get_lead_forms(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return jsonb_build_object(
    'has_token', exists (select 1 from public.lh_meta_lead_access a where a.workspace_id = p_workspace_id),
    'token_hint', (select a.token_hint from public.lh_meta_lead_access a where a.workspace_id = p_workspace_id),
    'forms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id, 'page_id', f.page_id, 'page_name', f.page_name, 'form_id', f.form_id, 'form_name', f.form_name,
        'enabled', f.enabled, 'last_sync_at', f.last_sync_at, 'last_error', f.last_error,
        'leads_imported', f.leads_imported, 'since', to_timestamp(f.cursor_time)
      ) order by f.created_at)
      from public.lh_meta_lead_forms f where f.workspace_id = p_workspace_id
    ), '[]'::jsonb)
  );
end;
$$;

/** Saves the (already encrypted) token, or removes it and stops every form with null. */
create or replace function public.lh_admin_set_lead_token(p_token text, p_workspace_id uuid, p_access_token text, p_token_hint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  if p_access_token is null then
    delete from public.lh_meta_lead_access where workspace_id = p_workspace_id;
    update public.lh_meta_lead_forms set enabled = false where workspace_id = p_workspace_id;
    return;
  end if;
  insert into public.lh_meta_lead_access (workspace_id, access_token, token_hint)
  values (p_workspace_id, p_access_token, left(p_token_hint, 8))
  on conflict (workspace_id) do update
  set access_token = excluded.access_token, token_hint = excluded.token_hint, updated_at = now();
end;
$$;

/**
 * Connects a form (or turns it on/off). p_since: from when to import (unix
 * time) when the form is connected for the first time.
 */
create or replace function public.lh_admin_set_lead_form(
  p_token text, p_workspace_id uuid, p_page_id text, p_page_name text, p_form_id text, p_form_name text,
  p_enabled boolean, p_since bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  if p_since is null or p_since < extract(epoch from now() - interval '90 days')::bigint then
    raise exception 'can import at most the last 90 days' using errcode = '22023';
  end if;
  insert into public.lh_meta_lead_forms (workspace_id, page_id, page_name, form_id, form_name, enabled, cursor_time)
  values (p_workspace_id, p_page_id, left(p_page_name, 200), p_form_id, left(p_form_name, 200), coalesce(p_enabled, true), p_since)
  on conflict (workspace_id, form_id) do update
  set enabled = coalesce(p_enabled, true), page_name = excluded.page_name, form_name = excluded.form_name, last_error = null;
end;
$$;

-- ---------------------------------------------------------------------------
-- App server (server secret)
-- ---------------------------------------------------------------------------

/** The encrypted token of a client, for listing its Pages and forms in the panel. */
create or replace function public.lh_server_lead_token(p_secret text, p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  return (select a.access_token from public.lh_meta_lead_access a where a.workspace_id = p_workspace_id);
end;
$$;

/** Enabled forms to check, oldest check first, with the client's encrypted token. */
create or replace function public.lh_server_lead_forms_due(p_secret text, p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'workspace_id', f.workspace_id, 'page_id', f.page_id, 'form_id', f.form_id,
      'cursor_time', f.cursor_time, 'access_token', a.access_token
    ) order by f.last_sync_at nulls first)
    from (
      select * from public.lh_meta_lead_forms
      where enabled
      order by last_sync_at nulls first
      limit greatest(1, least(coalesce(p_limit, 50), 200))
    ) f
    join public.lh_meta_lead_access a on a.workspace_id = f.workspace_id
  ), '[]'::jsonb);
end;
$$;

/**
 * Stores one lead from a form. Returns {lead_id, new}; a lead already stored
 * (same Meta lead id) is left as is.
 */
create or replace function public.lh_server_meta_form_lead(p_secret text, p_form uuid, p_lead jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_form public.lh_meta_lead_forms;
  v_id uuid;
  v_meta_id text := p_lead ->> 'meta_lead_id';
  v_answers jsonb := coalesce(p_lead -> 'answers', '{}'::jsonb);
begin
  perform lh_private.check_server(p_secret);
  if pg_column_size(p_lead) > 16384 then
    raise exception 'lead too large' using errcode = '22023';
  end if;
  select * into v_form from public.lh_meta_lead_forms where id = p_form;
  if not found then
    raise exception 'form not found' using errcode = 'LH404';
  end if;
  if coalesce(v_meta_id, '') !~ '^[0-9]{5,30}$' then
    raise exception 'invalid lead id' using errcode = '22023';
  end if;
  if jsonb_typeof(v_answers) <> 'object' then
    v_answers := '{}'::jsonb;
  end if;

  insert into public.lh_leads (
    workspace_id, source, code, name, phone, email, channel, meta_lead_id, meta_form_id,
    campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name, utm_campaign, utm_content, utm_term,
    site_source_name, placement, extra, created_at, last_click_at
  )
  values (
    v_form.workspace_id, 'meta_form', lh_private.random_code(),
    nullif(left(trim(p_lead ->> 'name'), 120), ''),
    nullif(left(trim(p_lead ->> 'phone'), 40), ''),
    nullif(left(lower(trim(p_lead ->> 'email')), 200), ''),
    case when (p_lead ->> 'is_organic')::boolean then 'organic_social' else 'meta_ads' end,
    v_meta_id, v_form.form_id,
    left(p_lead ->> 'campaign_id', 40), left(p_lead ->> 'adset_id', 40), left(p_lead ->> 'ad_id', 40),
    left(p_lead ->> 'campaign_name', 200), left(p_lead ->> 'adset_name', 200), left(p_lead ->> 'ad_name', 200),
    left(p_lead ->> 'campaign_name', 200), left(p_lead ->> 'ad_name', 200), left(p_lead ->> 'adset_name', 200),
    left(p_lead ->> 'platform', 40), null,
    v_answers || jsonb_build_object('Formulário', coalesce(v_form.form_name, v_form.form_id)),
    coalesce((p_lead ->> 'created_time')::timestamptz, now()),
    coalesce((p_lead ->> 'created_time')::timestamptz, now())
  )
  on conflict (workspace_id, meta_lead_id) where meta_lead_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.lh_leads where workspace_id = v_form.workspace_id and meta_lead_id = v_meta_id;
    return jsonb_build_object('lead_id', v_id, 'new', false);
  end if;
  update public.lh_meta_lead_forms set leads_imported = leads_imported + 1 where id = p_form;
  return jsonb_build_object('lead_id', v_id, 'new', true);
end;
$$;

/** Records a check of a form: the new cursor (newest lead seen) and the error, if any. */
create or replace function public.lh_server_lead_form_synced(p_secret text, p_form uuid, p_cursor_time bigint, p_error text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  update public.lh_meta_lead_forms
  set cursor_time = greatest(cursor_time, coalesce(p_cursor_time, cursor_time)),
      last_sync_at = now(),
      last_error = left(p_error, 300)
  where id = p_form;
end;
$$;

-- Form leads also owe Meta the "Lead" CRM event (the stage the lead enters
-- with); the hourly retry covers it like Schedule and Purchase.
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
          and l.tracking_consent is distinct from false
          and l.updated_at > now() - interval '8 days'
        union all
        select l.id, 'lead', null, true, true, 'Lead', l.created_at
        from public.lh_leads l
        join public.lh_meta_configs cfg
          on cfg.workspace_id = l.workspace_id and cfg.enabled and cfg.test_event_code is null
        where l.source = 'meta_form' and l.meta_lead_id is not null
          and l.created_at > now() - interval '7 days'
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

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_get_lead_forms(text, uuid)',
    'lh_admin_set_lead_token(text, uuid, text, text)',
    'lh_admin_set_lead_form(text, uuid, text, text, text, text, boolean, bigint)',
    'lh_server_lead_token(text, uuid)',
    'lh_server_lead_forms_due(text, integer)',
    'lh_server_meta_form_lead(text, uuid, jsonb)',
    'lh_server_lead_form_synced(text, uuid, bigint, text)',
    'lh_server_meta_pending(text, integer)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
