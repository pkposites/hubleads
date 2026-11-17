-- Alerts for sends refused because the site's address is not among the page's
-- domains (LH403). Until now they were dropped silently: a client moving the
-- landing page to a new address lost every contact without anyone noticing.
--
-- The app records each refusal (server secret only); the panel lists the open
-- alerts and lets the admin allow the address (added to the page's domains) or
-- dismiss it. Only the address is kept, never what was sent.

create table public.lh_origin_alerts (
  page_id uuid not null references public.lh_pages (id) on delete cascade,
  host text not null check (host ~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' and char_length(host) <= 253),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  -- Everything refused (visits included) and, among it, the contacts lost
  -- (WhatsApp clicks and forms sent).
  events integer not null default 0,
  leads integer not null default 0,
  -- Allowed or dismissed by an admin; a new lost contact opens it again.
  closed_at timestamptz,
  primary key (page_id, host)
);

alter table public.lh_origin_alerts enable row level security;
revoke all on public.lh_origin_alerts from anon, authenticated;

/** Server only: a send from p_host was refused for the page of p_key. */
create or replace function public.lh_server_note_refused_origin(p_secret text, p_key text, p_host text, p_lead boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_page public.lh_pages;
  v_host text := lower(left(coalesce(p_host, ''), 253));
begin
  perform lh_private.check_server(p_secret);
  -- Real site addresses only (no localhost, IPs or junk), on a known page.
  if v_host !~ '^[a-z0-9-]+(\.[a-z0-9-]+)+$' or v_host ~ '^[0-9.]+$' then
    return;
  end if;
  select * into v_page from public.lh_pages where public_key = p_key;
  if not found or cardinality(v_page.domains) = 0 then
    return;
  end if;
  -- Allowed meanwhile: nothing to warn about.
  if exists (
    select 1 from unnest(v_page.domains) d
    where v_host = d or (d like '*.%' and v_host like '%' || substr(d, 2))
  ) then
    return;
  end if;
  -- Anyone can post with any address: a few per page are enough to warn.
  if not exists (select 1 from public.lh_origin_alerts a where a.page_id = v_page.id and a.host = v_host)
     and (select count(*) from public.lh_origin_alerts a where a.page_id = v_page.id) >= 10 then
    return;
  end if;
  insert into public.lh_origin_alerts as a (page_id, host, events, leads)
  values (v_page.id, v_host, 1, case when p_lead then 1 else 0 end)
  on conflict (page_id, host) do update
    set events = a.events + 1,
        leads = a.leads + case when p_lead then 1 else 0 end,
        last_at = now(),
        closed_at = case when p_lead then null else a.closed_at end;
end;
$$;

/** Open alerts of the clients this admin sees (last 30 days). */
create or replace function public.lh_admin_origin_alerts(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'workspace_id', w.id, 'workspace_name', w.name, 'page_id', p.id, 'page_name', p.name,
      'host', a.host, 'events', a.events, 'leads', a.leads, 'first_at', a.first_at, 'last_at', a.last_at
    ) order by a.leads desc, a.last_at desc)
    from public.lh_origin_alerts a
    join public.lh_pages p on p.id = a.page_id
    join public.lh_workspaces w on w.id = p.workspace_id
    where a.closed_at is null
      and a.last_at > now() - interval '30 days'
      and lh_private.admin_sees_workspace(v_admin, w.id)
  ), '[]'::jsonb);
end;
$$;

/** Adds the address to the page's domains and closes the alert. */
create or replace function public.lh_admin_allow_origin(p_token text, p_page_id uuid, p_host text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, (select p.workspace_id from public.lh_pages p where p.id = p_page_id));
  -- Only an address that was actually refused for this page.
  if not exists (select 1 from public.lh_origin_alerts a where a.page_id = p_page_id and a.host = p_host) then
    raise exception 'alert not found' using errcode = 'LH404';
  end if;
  update public.lh_pages p
  set domains = case when p_host = any(p.domains) then p.domains else p.domains || p_host end
  where p.id = p_page_id;
  update public.lh_origin_alerts a set closed_at = now() where a.page_id = p_page_id and a.host = p_host;
end;
$$;

/** Closes the alert without allowing the address (a new lost contact opens it again). */
create or replace function public.lh_admin_dismiss_origin(p_token text, p_page_id uuid, p_host text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, (select p.workspace_id from public.lh_pages p where p.id = p_page_id));
  update public.lh_origin_alerts a set closed_at = now() where a.page_id = p_page_id and a.host = p_host;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_server_note_refused_origin(text, text, text, boolean)',
    'lh_admin_origin_alerts(text)',
    'lh_admin_allow_origin(text, uuid, text)',
    'lh_admin_dismiss_origin(text, uuid, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
