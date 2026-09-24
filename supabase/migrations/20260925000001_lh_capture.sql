-- Lead Hub v2: landing-page capture in spreadsheet form.
--
-- The landing page already knows the visit's UTMs, click ids and events. A
-- small script (public/tracker.js) sends them here; every click on a WhatsApp
-- button becomes one row in lh_leads. The phone is left for the attendant to
-- fill in, because visitors go straight to WhatsApp without a form.
--
-- Everything lives in `public` with an `lh_` prefix so the Data API exposes it
-- without extra configuration, next to other apps' tables. Tables are never
-- read by API roles directly: RLS is on with no policies and every access goes
-- through the SECURITY DEFINER functions below, which check either a landing
-- page's public key (capture) or a session token from lh_login (panel).

-- The first iteration lived in its own schemas; nothing uses it any more.
drop schema if exists leadhub cascade;
drop schema if exists leadhub_private cascade;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists lh_private;
revoke all on schema lh_private from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.lh_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table public.lh_sessions (
  token_hash text primary key,
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index lh_sessions_workspace_idx on public.lh_sessions (workspace_id);

create table public.lh_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  public_key text not null unique default 'pk_' || replace(gen_random_uuid()::text, '-', ''),
  -- Hostnames allowed to send data; empty means any (handy while testing).
  domains text[] not null default '{}',
  -- Append a short code to the WhatsApp message so the attendant can find the row.
  whatsapp_code boolean not null default true,
  created_at timestamptz not null default now()
);

create index lh_pages_workspace_idx on public.lh_pages (workspace_id);

create table public.lh_leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  page_id uuid references public.lh_pages (id) on delete set null,
  source text not null default 'lp' check (source in ('lp', 'manual')),
  visitor_id text,
  code text not null,
  -- Filled in by the attendant.
  name text,
  phone text,
  status text not null default 'novo'
    check (status in ('novo', 'em_atendimento', 'agendado', 'venda', 'perdido')),
  notes text,
  sale_value numeric(14, 2) check (sale_value is null or sale_value >= 0),
  -- Attribution of the first visit (captured by the landing page).
  channel text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  campaign_id text,
  adset_id text,
  ad_id text,
  fbclid text,
  gclid text,
  fbc text,
  fbp text,
  landing_url text,
  referrer text,
  device text,
  first_seen_at timestamptz,
  clicks int not null default 1,
  last_click_at timestamptz not null default now(),
  -- Anything else the landing page sends.
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per visitor per page; repeated clicks increment `clicks`.
create unique index lh_leads_visitor_uidx on public.lh_leads (page_id, visitor_id) where visitor_id is not null;
create index lh_leads_workspace_created_idx on public.lh_leads (workspace_id, created_at desc);
create index lh_leads_code_idx on public.lh_leads (workspace_id, code);

create table public.lh_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  page_id uuid not null references public.lh_pages (id) on delete cascade,
  lead_id uuid references public.lh_leads (id) on delete set null,
  visitor_id text,
  type text not null,
  url text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lh_events_workspace_created_idx on public.lh_events (workspace_id, created_at desc);
create index lh_events_visitor_idx on public.lh_events (page_id, visitor_id);

alter table public.lh_workspaces enable row level security;
alter table public.lh_sessions enable row level security;
alter table public.lh_pages enable row level security;
alter table public.lh_leads enable row level security;
alter table public.lh_events enable row level security;

revoke all on public.lh_workspaces, public.lh_sessions, public.lh_pages, public.lh_leads, public.lh_events
  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Private helpers (not exposed through the Data API)
-- ---------------------------------------------------------------------------

create or replace function lh_private.sha256(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(p, 'sha256'), 'hex')
$$;

-- Short, unambiguous code for the WhatsApp message (no 0/O/1/I).
create or replace function lh_private.random_code()
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 4)
$$;

create or replace function lh_private.workspace_for(p_token text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  select s.workspace_id into v_workspace
  from public.lh_sessions s
  where s.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and s.expires_at > now();
  if v_workspace is null then
    raise exception 'invalid or expired session' using errcode = 'LH401';
  end if;
  return v_workspace;
end;
$$;

-- Admin setup (run from SQL, never from the app).
create or replace function lh_private.create_workspace(p_name text, p_slug text, p_password text, p_page_name text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_workspace public.lh_workspaces;
  v_page public.lh_pages;
begin
  if char_length(coalesce(p_password, '')) < 8 then
    raise exception 'password must have at least 8 characters';
  end if;
  insert into public.lh_workspaces (name, slug, password_hash)
  values (p_name, p_slug, extensions.crypt(p_password, extensions.gen_salt('bf', 8)))
  returning * into v_workspace;
  insert into public.lh_pages (workspace_id, name) values (v_workspace.id, p_page_name)
  returning * into v_page;
  return jsonb_build_object('workspace_id', v_workspace.id, 'page_id', v_page.id, 'public_key', v_page.public_key);
end;
$$;

create or replace function lh_private.lead_json(l public.lh_leads)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select to_jsonb(l) - 'workspace_id' - 'visitor_id'
$$;

-- ---------------------------------------------------------------------------
-- Capture: called by the /api/collect route for every landing page event
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

-- ---------------------------------------------------------------------------
-- Panel access
-- ---------------------------------------------------------------------------

create or replace function public.lh_login(p_slug text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.lh_workspaces;
  v_token text;
begin
  select * into v_workspace from public.lh_workspaces where slug = lower(trim(p_slug));
  if not found or extensions.crypt(coalesce(p_password, ''), v_workspace.password_hash) <> v_workspace.password_hash then
    perform pg_sleep(0.3); -- slows down guessing
    return null;
  end if;

  delete from public.lh_sessions where workspace_id = v_workspace.id and expires_at < now();
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.lh_sessions (token_hash, workspace_id, expires_at)
  values (lh_private.sha256(v_token), v_workspace.id, now() + interval '30 days');

  return jsonb_build_object('token', v_token, 'slug', v_workspace.slug);
end;
$$;

create or replace function public.lh_logout(p_token text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.lh_sessions where token_hash = lh_private.sha256(coalesce(p_token, ''))
$$;

create or replace function public.lh_session(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug)
  from public.lh_workspaces w
  where w.id = lh_private.workspace_for(p_token)
$$;

create or replace function public.lh_list_leads(
  p_token text,
  p_since timestamptz default null,
  p_status text default null,
  p_channel text default null,
  p_search text default null,
  p_limit int default 200,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  with filtered as (
    select l.* from public.lh_leads l
    where l.workspace_id = v_workspace
      and (p_since is null or l.created_at >= p_since)
      and (p_status is null or l.status = p_status)
      and (p_channel is null or l.channel = p_channel)
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
$$;

create or replace function public.lh_update_lead(p_token text, p_lead_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_lead public.lh_leads;
begin
  update public.lh_leads l set
    name = case when p_patch ? 'name' then nullif(left(trim(p_patch ->> 'name'), 120), '') else l.name end,
    phone = case when p_patch ? 'phone' then nullif(left(trim(p_patch ->> 'phone'), 40), '') else l.phone end,
    status = case when p_patch ? 'status' then p_patch ->> 'status' else l.status end,
    notes = case when p_patch ? 'notes' then nullif(left(p_patch ->> 'notes', 2000), '') else l.notes end,
    sale_value = case when p_patch ? 'sale_value' then (nullif(p_patch ->> 'sale_value', ''))::numeric else l.sale_value end,
    updated_at = now()
  where l.id = p_lead_id and l.workspace_id = v_workspace
  returning * into v_lead;

  if not found then
    raise exception 'lead not found' using errcode = 'LH404';
  end if;
  return lh_private.lead_json(v_lead);
end;
$$;

create or replace function public.lh_create_lead(p_token text, p_name text, p_phone text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_lead public.lh_leads;
begin
  insert into public.lh_leads (workspace_id, source, code, name, phone, notes, channel)
  values (
    v_workspace, 'manual', lh_private.random_code(),
    nullif(left(trim(p_name), 120), ''), nullif(left(trim(p_phone), 40), ''),
    nullif(left(p_notes, 2000), ''), 'whatsapp_direto'
  )
  returning * into v_lead;
  return lh_private.lead_json(v_lead);
end;
$$;

create or replace function public.lh_stats(p_token text, p_since timestamptz default null)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  with ws as (select lh_private.workspace_for(p_token) as id)
  select jsonb_build_object(
    'visitors', (
      select count(distinct e.visitor_id) from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'page_view' and (p_since is null or e.created_at >= p_since)
    ),
    'clicks', (
      select count(*) from public.lh_events e, ws
      where e.workspace_id = ws.id and e.type = 'whatsapp_click' and (p_since is null or e.created_at >= p_since)
    ),
    'leads', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and (p_since is null or l.created_at >= p_since)
    ),
    'with_phone', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.phone is not null and (p_since is null or l.created_at >= p_since)
    ),
    'sales', (
      select count(*) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.status = 'venda' and (p_since is null or l.created_at >= p_since)
    ),
    'revenue', (
      select coalesce(sum(l.sale_value), 0) from public.lh_leads l, ws
      where l.workspace_id = ws.id and l.status = 'venda' and (p_since is null or l.created_at >= p_since)
    )
  )
$$;

create or replace function public.lh_list_events(p_token text, p_limit int default 100)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(e) - 'workspace_id' order by e.created_at desc), '[]'::jsonb)
  from (
    select e.* from public.lh_events e
    where e.workspace_id = lh_private.workspace_for(p_token)
    order by e.created_at desc
    limit least(greatest(p_limit, 1), 500)
  ) e
$$;

create or replace function public.lh_list_pages(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(to_jsonb(p) - 'workspace_id' order by p.created_at), '[]'::jsonb)
  from public.lh_pages p
  where p.workspace_id = lh_private.workspace_for(p_token)
$$;

create or replace function public.lh_update_page(
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
  update public.lh_pages
  set name = coalesce(nullif(trim(p_name), ''), name),
      domains = coalesce(p_domains, '{}'),
      whatsapp_code = coalesce(p_whatsapp_code, whatsapp_code)
  where id = p_page_id and workspace_id = lh_private.workspace_for(p_token)
  returning * into v_page;
  if not found then
    raise exception 'page not found' using errcode = 'LH404';
  end if;
  return to_jsonb(v_page) - 'workspace_id';
end;
$$;

-- Public read of what the tracker needs to behave (no personal data).
create or replace function public.lh_page_config(p_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('whatsapp_code', p.whatsapp_code)
  from public.lh_pages p where p.public_key = p_key
$$;

-- ---------------------------------------------------------------------------
-- Grants: the app talks to the database with the publishable (anon) key;
-- the functions above do the authorisation.
-- ---------------------------------------------------------------------------

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_collect(text, text, jsonb)',
    'lh_login(text, text)',
    'lh_logout(text)',
    'lh_session(text)',
    'lh_list_leads(text, timestamptz, text, text, text, int, int)',
    'lh_update_lead(text, uuid, jsonb)',
    'lh_create_lead(text, text, text, text)',
    'lh_stats(text, timestamptz)',
    'lh_list_events(text, int)',
    'lh_list_pages(text)',
    'lh_update_page(text, uuid, text, text[], boolean)',
    'lh_page_config(text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
