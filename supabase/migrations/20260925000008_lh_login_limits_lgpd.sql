-- Lead Hub: login limits and LGPD.
--
-- 1. Login limits. Wrong passwords are counted per account (client or admin)
--    and per device (a hash of the IP sent by the app's server). 5 failures
--    in 15 minutes lock that device out of that account for 15 minutes; 30
--    failures from anywhere lock the account for everyone for 15 minutes, which
--    also covers calls made straight to the API. A right password clears the
--    count. The answer never says whether the account exists.
-- 2. Consent. Each lead records whether the visitor accepted tracking
--    (tracking_consent). Without consent the page sends only the contact the
--    person typed; nothing is sent to Meta for that lead.
-- 3. Privacy details per client (controller, contact, retention) for the
--    public privacy policy page.
-- 4. Audit log of exports, deletions and retention runs (who, when, how many).
-- 5. Data export of one lead for the person's LGPD request (admin only).
-- 6. Retention: leads and page events older than the client's retention
--    period are deleted, and IP/browser are cleared after 90 days. Run daily
--    by the app's server (lh_server_apply_retention).

-- ---------------------------------------------------------------------------
-- 1. Login limits
-- ---------------------------------------------------------------------------

create table lh_private.login_failures (
  id bigint generated always as identity primary key,
  account text not null,
  client text not null default '',
  created_at timestamptz not null default now()
);

create index login_failures_account_idx on lh_private.login_failures (account, created_at);

/** Seconds until the account can be tried again from this client, or 0. */
create or replace function lh_private.login_wait(p_account text, p_client text)
returns int
language sql
stable
set search_path = ''
as $$
  select greatest(
    coalesce((
      select case when count(*) >= 5 then ceil(extract(epoch from (max(f.created_at) + interval '15 minutes' - now())))::int end
      from lh_private.login_failures f
      where f.account = p_account and f.client = p_client and f.created_at > now() - interval '15 minutes'
    ), 0),
    coalesce((
      select case when count(*) >= 30 then ceil(extract(epoch from (max(f.created_at) + interval '15 minutes' - now())))::int end
      from lh_private.login_failures f
      where f.account = p_account and f.created_at > now() - interval '15 minutes'
    ), 0),
    0
  )
$$;

create or replace function lh_private.login_failed(p_account text, p_client text)
returns void
language sql
set search_path = ''
as $$
  delete from lh_private.login_failures where created_at < now() - interval '1 day';
  insert into lh_private.login_failures (account, client) values (p_account, p_client);
$$;

drop function public.lh_login(text, text);

/** p_client: hash of the visitor's IP, sent by the app's server. */
create or replace function public.lh_login(p_slug text, p_password text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account text := 'ws:' || lower(trim(coalesce(p_slug, '')));
  v_client text := left(coalesce(p_client, ''), 64);
  v_wait int := lh_private.login_wait(v_account, v_client);
  v_workspace public.lh_workspaces;
  v_token text;
begin
  if v_wait > 0 then
    return jsonb_build_object('locked', true, 'retry_after', v_wait);
  end if;

  select * into v_workspace from public.lh_workspaces where slug = lower(trim(p_slug));
  if not found or extensions.crypt(coalesce(p_password, ''), v_workspace.password_hash) <> v_workspace.password_hash then
    perform lh_private.login_failed(v_account, v_client);
    perform pg_sleep(0.3); -- slows down guessing
    return null;
  end if;

  delete from lh_private.login_failures where account = v_account;
  delete from public.lh_sessions where workspace_id = v_workspace.id and expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.lh_sessions (token_hash, workspace_id, expires_at)
  values (lh_private.sha256(v_token), v_workspace.id, now() + interval '30 days');

  return jsonb_build_object('token', v_token, 'slug', v_workspace.slug);
end;
$$;

drop function public.lh_admin_login(text, text);

create or replace function public.lh_admin_login(p_login text, p_password text, p_client text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_account text := 'admin:' || lower(trim(coalesce(p_login, '')));
  v_client text := left(coalesce(p_client, ''), 64);
  v_wait int := lh_private.login_wait(v_account, v_client);
  v_admin public.lh_admins;
  v_token text;
begin
  if v_wait > 0 then
    return jsonb_build_object('locked', true, 'retry_after', v_wait);
  end if;

  select * into v_admin from public.lh_admins where login = lower(trim(coalesce(p_login, '')));
  if not found or extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    perform lh_private.login_failed(v_account, v_client);
    perform pg_sleep(0.5);
    return null;
  end if;

  delete from lh_private.login_failures where account = v_account;
  delete from public.lh_admin_sessions where admin_id = v_admin.id and expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.lh_admin_sessions (token_hash, admin_id, expires_at)
  values (lh_private.sha256(v_token), v_admin.id, now() + interval '7 days');
  return jsonb_build_object('token', v_token, 'login', v_admin.login);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Consent
-- ---------------------------------------------------------------------------

alter table public.lh_leads add column tracking_consent boolean;

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

-- ---------------------------------------------------------------------------
-- 3. Privacy details per client
-- ---------------------------------------------------------------------------

alter table public.lh_workspaces
  add column privacy_controller text check (char_length(privacy_controller) <= 200),
  add column privacy_document text check (char_length(privacy_document) <= 40),
  add column privacy_email text check (privacy_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(privacy_email) <= 200),
  add column retention_months int not null default 24 check (retention_months between 1 and 120),
  add column privacy_updated_at timestamptz;

/** Public: what the privacy policy page shows. p_ref is the client's slug or a page key. */
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
    'meta', exists (select 1 from public.lh_meta_configs m where m.workspace_id = w.id and m.enabled)
  )
  from public.lh_workspaces w
  where w.slug = lower(trim(p_ref))
     or w.id = (select p.workspace_id from public.lh_pages p where p.public_key = p_ref)
  limit 1
$$;

-- No foreign key: the record must outlive what it describes.
create table public.lh_audit (
  id bigint generated always as identity primary key,
  workspace_id uuid not null,
  action text not null,
  actor text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lh_audit_workspace_idx on public.lh_audit (workspace_id, created_at desc);
alter table public.lh_audit enable row level security;
revoke all on public.lh_audit from anon, authenticated;

create or replace function public.lh_admin_get_privacy(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.lh_workspaces;
begin
  perform lh_private.admin_for(p_token);
  select * into v from public.lh_workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  return jsonb_build_object(
    'controller', v.privacy_controller,
    'document', v.privacy_document,
    'email', v.privacy_email,
    'retention_months', v.retention_months,
    'updated_at', v.privacy_updated_at,
    'audit', coalesce((
      select jsonb_agg(jsonb_build_object('action', a.action, 'actor', a.actor, 'detail', a.detail, 'at', a.created_at)
                       order by a.created_at desc)
      from (select * from public.lh_audit where workspace_id = p_workspace_id order by created_at desc limit 30) a
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.lh_admin_set_privacy(
  p_token text,
  p_workspace_id uuid,
  p_controller text,
  p_document text,
  p_email text,
  p_retention_months int
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_for(p_token);
  update public.lh_workspaces set
    privacy_controller = nullif(trim(coalesce(p_controller, '')), ''),
    privacy_document = nullif(trim(coalesce(p_document, '')), ''),
    privacy_email = nullif(lower(trim(coalesce(p_email, ''))), ''),
    retention_months = coalesce(p_retention_months, retention_months),
    privacy_updated_at = now()
  where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Audit log
-- ---------------------------------------------------------------------------

-- Every deletion of leads is recorded, whoever makes it.
create or replace function lh_private.audit_lead_deletes()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into public.lh_audit (workspace_id, action, actor, detail)
  select d.workspace_id, 'delete_leads',
         coalesce(nullif(current_setting('lh.actor', true), ''), 'sistema'),
         jsonb_build_object('count', count(*))
  from deleted d
  group by d.workspace_id;
  return null;
end;
$$;

create trigger lh_leads_audit_delete
  after delete on public.lh_leads
  referencing old table as deleted
  for each statement execute function lh_private.audit_lead_deletes();

/** The app records a CSV export (who and how many rows). */
create or replace function public.lh_log_export(p_token text, p_rows int, p_filters jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.lh_audit (workspace_id, action, actor, detail)
  values (lh_private.workspace_for(p_token), 'export_csv', coalesce(lh_private.session_role(p_token), 'atendente'),
          jsonb_build_object('rows', greatest(coalesce(p_rows, 0), 0), 'filters', coalesce(p_filters, '{}'::jsonb)));
end;
$$;

create or replace function public.lh_delete_leads(p_token text, p_lead_ids uuid[])
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_count int;
begin
  if lh_private.session_role(p_token) is distinct from 'admin' then
    raise exception 'only admins can delete rows' using errcode = 'LH403';
  end if;
  perform lh_private.set_actor('admin');

  delete from public.lh_events e
  using public.lh_leads l
  where l.id = any (p_lead_ids)
    and l.workspace_id = v_workspace
    and e.workspace_id = v_workspace
    and (e.lead_id = l.id or (l.visitor_id is not null and e.page_id = l.page_id and e.visitor_id = l.visitor_id));

  delete from public.lh_leads where id = any (p_lead_ids) and workspace_id = v_workspace;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. Data of one lead, for the person's request (admin sessions only)
-- ---------------------------------------------------------------------------

create or replace function public.lh_lead_export(p_token text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_lead public.lh_leads;
begin
  if lh_private.session_role(p_token) is distinct from 'admin' then
    raise exception 'only admins can export personal data' using errcode = 'LH403';
  end if;
  select * into v_lead from public.lh_leads where id = p_lead_id and workspace_id = v_workspace;
  if not found then
    raise exception 'lead not found' using errcode = 'LH404';
  end if;
  insert into public.lh_audit (workspace_id, action, actor, detail)
  values (v_workspace, 'export_lead', 'admin', jsonb_build_object('code', v_lead.code));
  return jsonb_build_object(
    'exported_at', now(),
    'controller', (select coalesce(w.privacy_controller, w.name) from public.lh_workspaces w where w.id = v_workspace),
    'lead', to_jsonb(v_lead) - 'workspace_id',
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('type', h.type, 'from', h.from_value, 'to', h.to_value, 'actor', h.actor, 'at', h.created_at)
                       order by h.created_at)
      from public.lh_lead_history h where h.lead_id = v_lead.id
    ), '[]'::jsonb),
    'page_events', coalesce((
      select jsonb_agg(jsonb_build_object('type', e.type, 'url', e.url, 'data', e.data, 'at', e.created_at) order by e.created_at)
      from public.lh_events e
      where e.workspace_id = v_workspace
        and (e.lead_id = v_lead.id or (v_lead.visitor_id is not null and e.page_id = v_lead.page_id and e.visitor_id = v_lead.visitor_id))
    ), '[]'::jsonb),
    'sent_to_meta', coalesce((
      select jsonb_agg(jsonb_build_object('event', m.event_name, 'ok', m.ok, 'test', m.test, 'at', m.created_at) order by m.created_at)
      from public.lh_meta_events m where m.lead_id = v_lead.id
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Retention
-- ---------------------------------------------------------------------------

create or replace function public.lh_server_apply_retention(p_secret text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_leads int;
  v_events int;
  v_cleared int;
begin
  perform lh_private.check_server(p_secret);
  perform lh_private.set_actor('sistema');

  -- Leads with no activity for longer than the client's retention period.
  delete from public.lh_leads l
  using public.lh_workspaces w
  where w.id = l.workspace_id
    and greatest(l.updated_at, l.last_click_at, l.created_at) < now() - make_interval(months => w.retention_months);
  get diagnostics v_leads = row_count;

  -- Page events (visits of people who never became leads, too).
  delete from public.lh_events e
  using public.lh_workspaces w
  where w.id = e.workspace_id and e.created_at < now() - make_interval(months => w.retention_months);
  get diagnostics v_events = row_count;

  -- IP and browser are only needed to match conversions: 90 days.
  update public.lh_leads
  set ip_address = null, user_agent = null
  where (ip_address is not null or user_agent is not null)
    and greatest(created_at, last_click_at) < now() - interval '90 days';
  get diagnostics v_cleared = row_count;

  delete from public.lh_audit where created_at < now() - interval '5 years';
  delete from lh_private.login_failures where created_at < now() - interval '1 day';

  return jsonb_build_object('leads_deleted', v_leads, 'events_deleted', v_events, 'ip_cleared', v_cleared);
end;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_login(text, text, text)',
    'lh_admin_login(text, text, text)',
    'lh_collect(text, text, jsonb)',
    'lh_public_privacy(text)',
    'lh_admin_get_privacy(text, uuid)',
    'lh_admin_set_privacy(text, uuid, text, text, text, int)',
    'lh_log_export(text, int, jsonb)',
    'lh_delete_leads(text, uuid[])',
    'lh_lead_export(text, uuid)',
    'lh_server_apply_retention(text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
