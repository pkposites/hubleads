-- Lead Hub: master admin panel, attendant-only client access and contact data
-- from the landing page.
--
-- - Admins (lh_admins) log in to /admin, create clients (workspaces) with their
--   landing pages, generate the password handed to the client's attendants,
--   and can open any client's sheet.
-- - Client sessions now carry a role: 'atendente' (the client password: sheet
--   only) or 'admin' (opened from the admin panel).
-- - Landing pages can now ask for name and phone before WhatsApp; the phone
--   comes in with the click, and a click with a phone already on file joins
--   that row instead of creating another.
-- - Everything needed to send conversions back to Meta later is kept on the
--   lead: campaign/ad set/ad names and ids, every URL parameter, fbclid/fbc/
--   fbp, and the click's IP address and user agent.
-- - Admin sessions can delete rows (e.g. tests), together with their events.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.lh_admins (
  id uuid primary key default gen_random_uuid(),
  login text not null unique check (login = lower(login) and char_length(login) between 3 and 120),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.lh_admin_sessions (
  token_hash text primary key,
  admin_id uuid not null references public.lh_admins (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

alter table public.lh_admins enable row level security;
alter table public.lh_admin_sessions enable row level security;
revoke all on public.lh_admins, public.lh_admin_sessions from anon, authenticated;

alter table public.lh_sessions
  add column role text not null default 'atendente' check (role in ('atendente', 'admin'));

create index lh_leads_phone_idx on public.lh_leads (workspace_id, phone) where phone is not null;

alter table public.lh_leads
  add column campaign_name text,
  add column adset_name text,
  add column ad_name text,
  add column placement text,
  add column site_source_name text,
  -- Every parameter of the landing URL, so nothing the ad sends is lost.
  add column url_params jsonb not null default '{}'::jsonb,
  -- For Meta's Conversions API matching (client_ip_address, client_user_agent).
  add column ip_address text,
  add column user_agent text;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Readable, unguessable password such as "k7qm-x3tn-p9wd" (cryptographic RNG).
create or replace function lh_private.random_password()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_out text := '';
begin
  for i in 0..11 loop
    if i in (4, 8) then
      v_out := v_out || '-';
    end if;
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return v_out;
end;
$$;

create or replace function lh_private.hash_password(p text)
returns text
language sql
volatile
set search_path = ''
as $$
  select extensions.crypt(p, extensions.gen_salt('bf', 8))
$$;

create or replace function lh_private.admin_for(p_token text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_admin uuid;
begin
  select s.admin_id into v_admin
  from public.lh_admin_sessions s
  where s.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and s.expires_at > now();
  if v_admin is null then
    raise exception 'invalid or expired admin session' using errcode = 'LH401';
  end if;
  return v_admin;
end;
$$;

-- Admin setup from SQL: select lh_private.create_admin('email', 'password');
create or replace function lh_private.create_admin(p_login text, p_password text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if char_length(coalesce(p_password, '')) < 10 then
    raise exception 'admin password must have at least 10 characters';
  end if;
  insert into public.lh_admins (login, password_hash)
  values (lower(trim(p_login)), lh_private.hash_password(p_password))
  on conflict (login) do update set password_hash = excluded.password_hash
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function lh_private.lead_json(l public.lh_leads)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(l) - 'workspace_id' - 'visitor_id' - 'ip_address' - 'user_agent'
$$;

create or replace function lh_private.workspace_summary(w public.lh_workspaces)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', w.id,
    'name', w.name,
    'slug', w.slug,
    'created_at', w.created_at,
    'leads_total', (select count(*) from public.lh_leads l where l.workspace_id = w.id),
    'leads_7d', (select count(*) from public.lh_leads l where l.workspace_id = w.id and l.created_at >= now() - interval '7 days'),
    'without_phone', (select count(*) from public.lh_leads l where l.workspace_id = w.id and l.phone is null),
    'last_lead_at', (select max(l.created_at) from public.lh_leads l where l.workspace_id = w.id),
    'last_event_at', (select max(e.created_at) from public.lh_events e where e.workspace_id = w.id),
    'pages', (
      select coalesce(jsonb_agg(to_jsonb(p) - 'workspace_id' order by p.created_at), '[]'::jsonb)
      from public.lh_pages p where p.workspace_id = w.id
    )
  )
$$;

-- ---------------------------------------------------------------------------
-- Client sessions: expose the role, lock settings to admins
-- ---------------------------------------------------------------------------

create or replace function public.lh_session(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug, 'role', s.role)
  from public.lh_sessions s
  join public.lh_workspaces w on w.id = s.workspace_id
  where s.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and s.expires_at > now()
$$;

-- Settings and the event log moved to the admin panel.
drop function if exists public.lh_update_page(text, uuid, text, text[], boolean);
drop function if exists public.lh_list_pages(text);
drop function if exists public.lh_list_events(text, int);

-- ---------------------------------------------------------------------------
-- Capture: accept the phone typed on the landing page
-- ---------------------------------------------------------------------------

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
          updated_at = now()
      where l.id = v_lead.id;
      v_lead_id := v_lead.id;
    else
      insert into public.lh_leads as l (
        workspace_id, page_id, visitor_id, code, name, phone,
        channel, utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        campaign_id, adset_id, ad_id, campaign_name, adset_name, ad_name, placement, site_source_name,
        fbclid, gclid, fbc, fbp, url_params, ip_address, user_agent,
        landing_url, referrer, device, first_seen_at, extra
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
        v_data
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

-- Deletes rows (e.g. tests) with their events. Only for sessions opened from
-- the admin panel; attendants cannot delete.
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
  if not exists (
    select 1 from public.lh_sessions
    where token_hash = lh_private.sha256(p_token) and role = 'admin'
  ) then
    raise exception 'only admins can delete rows' using errcode = 'LH403';
  end if;

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
-- Admin panel
-- ---------------------------------------------------------------------------

create or replace function public.lh_admin_login(p_login text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.lh_admins;
  v_token text;
begin
  select * into v_admin from public.lh_admins where login = lower(trim(coalesce(p_login, '')));
  if not found or extensions.crypt(coalesce(p_password, ''), v_admin.password_hash) <> v_admin.password_hash then
    perform pg_sleep(0.5);
    return null;
  end if;
  delete from public.lh_admin_sessions where admin_id = v_admin.id and expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.lh_admin_sessions (token_hash, admin_id, expires_at)
  values (lh_private.sha256(v_token), v_admin.id, now() + interval '7 days');
  return jsonb_build_object('token', v_token, 'login', v_admin.login);
end;
$$;

create or replace function public.lh_admin_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.lh_admin_sessions where token_hash = lh_private.sha256(coalesce(p_token, ''))
$$;

create or replace function public.lh_admin_session(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'login', a.login)
  from public.lh_admins a
  where a.id = lh_private.admin_for(p_token)
$$;

create or replace function public.lh_admin_list_workspaces(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_for(p_token);
  return (
    select coalesce(jsonb_agg(lh_private.workspace_summary(w) order by w.created_at desc), '[]'::jsonb)
    from public.lh_workspaces w
  );
end;
$$;

create or replace function public.lh_admin_workspace(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.lh_workspaces;
begin
  perform lh_private.admin_for(p_token);
  select * into v_workspace from public.lh_workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  return lh_private.workspace_summary(v_workspace);
end;
$$;

/** Creates a client with its first landing page. Returns the attendant password once. */
create or replace function public.lh_admin_create_workspace(
  p_token text,
  p_name text,
  p_slug text,
  p_page_name text,
  p_domains text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text := lh_private.random_password();
  v_workspace public.lh_workspaces;
  v_page public.lh_pages;
begin
  perform lh_private.admin_for(p_token);
  insert into public.lh_workspaces (name, slug, password_hash)
  values (trim(p_name), lower(trim(p_slug)), lh_private.hash_password(v_password))
  returning * into v_workspace;
  insert into public.lh_pages (workspace_id, name, domains)
  values (v_workspace.id, coalesce(nullif(trim(p_page_name), ''), 'Landing Page'), coalesce(p_domains, '{}'))
  returning * into v_page;
  return jsonb_build_object(
    'workspace', lh_private.workspace_summary(v_workspace),
    'password', v_password
  );
end;
$$;

/** New attendant password; everyone logged in with the old one is signed out. */
create or replace function public.lh_admin_reset_password(p_token text, p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text := lh_private.random_password();
begin
  perform lh_private.admin_for(p_token);
  update public.lh_workspaces set password_hash = lh_private.hash_password(v_password)
  where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  delete from public.lh_sessions where workspace_id = p_workspace_id and role = 'atendente';
  return v_password;
end;
$$;

create or replace function public.lh_admin_add_page(p_token text, p_workspace_id uuid, p_name text, p_domains text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.lh_pages;
begin
  perform lh_private.admin_for(p_token);
  insert into public.lh_pages (workspace_id, name, domains)
  values (p_workspace_id, coalesce(nullif(trim(p_name), ''), 'Landing Page'), coalesce(p_domains, '{}'))
  returning * into v_page;
  return to_jsonb(v_page) - 'workspace_id';
end;
$$;

create or replace function public.lh_admin_update_page(
  p_token text,
  p_page_id uuid,
  p_name text,
  p_domains text[],
  p_whatsapp_code boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.lh_pages;
begin
  perform lh_private.admin_for(p_token);
  update public.lh_pages
  set name = coalesce(nullif(trim(p_name), ''), name),
      domains = coalesce(p_domains, '{}'),
      whatsapp_code = coalesce(p_whatsapp_code, whatsapp_code)
  where id = p_page_id
  returning * into v_page;
  if not found then
    raise exception 'page not found' using errcode = 'LH404';
  end if;
  return to_jsonb(v_page) - 'workspace_id';
end;
$$;

create or replace function public.lh_admin_list_events(p_token text, p_workspace_id uuid, p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_for(p_token);
  return (
    select coalesce(jsonb_agg(to_jsonb(e) - 'workspace_id' order by e.created_at desc), '[]'::jsonb)
    from (
      select e.* from public.lh_events e
      where e.workspace_id = p_workspace_id
      order by e.created_at desc
      limit least(greatest(p_limit, 1), 500)
    ) e
  );
end;
$$;

/** Opens a client's sheet as admin: a short client session with the admin role. */
create or replace function public.lh_admin_open_workspace(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.lh_workspaces;
  v_token text;
begin
  perform lh_private.admin_for(p_token);
  select * into v_workspace from public.lh_workspaces where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.lh_sessions (token_hash, workspace_id, expires_at, role)
  values (lh_private.sha256(v_token), v_workspace.id, now() + interval '12 hours', 'admin');
  return jsonb_build_object('token', v_token, 'slug', v_workspace.slug);
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
    'lh_session(text)',
    'lh_collect(text, text, jsonb)',
    'lh_delete_leads(text, uuid[])',
    'lh_admin_login(text, text)',
    'lh_admin_logout(text)',
    'lh_admin_session(text)',
    'lh_admin_list_workspaces(text)',
    'lh_admin_workspace(text, uuid)',
    'lh_admin_create_workspace(text, text, text, text, text[])',
    'lh_admin_reset_password(text, uuid)',
    'lh_admin_add_page(text, uuid, text, text[])',
    'lh_admin_update_page(text, uuid, text, text[], boolean)',
    'lh_admin_list_events(text, uuid, int)',
    'lh_admin_open_workspace(text, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
