-- Lead Hub: new-lead notifications on the admin's devices.
--
-- - An admin turns notifications on in the painel mãe; the device is linked
--   to the admin (not to a client).
-- - A new lead of any source notifies: the client's devices (as before), every
--   master's devices, and the devices of the gestor who owns the client.
--   Disabled admins get nothing. A device linked both ways gets one notice.

create table public.lh_admin_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references public.lh_admins (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index lh_admin_push_subscriptions_admin_idx on public.lh_admin_push_subscriptions (admin_id);
alter table public.lh_admin_push_subscriptions enable row level security;
revoke all on public.lh_admin_push_subscriptions from anon, authenticated;

create or replace function public.lh_admin_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
begin
  if p_endpoint is null or p_endpoint not like 'https://%' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into public.lh_admin_push_subscriptions (admin_id, endpoint, p256dh, auth)
  values (v_admin, left(p_endpoint, 1000), left(p_p256dh, 200), left(p_auth, 100))
  on conflict (endpoint) do update
    set admin_id = excluded.admin_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.lh_admin_push_unsubscribe(p_token text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.lh_admin_push_subscriptions
  where endpoint = p_endpoint and admin_id = lh_private.admin_for(p_token);
end;
$$;

/** Who to notify about a new lead (client devices and admins), and what to say. */
create or replace function public.lh_server_new_lead_push(p_secret text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.lh_leads;
  v_workspace public.lh_workspaces;
begin
  perform lh_private.check_server(p_secret);
  select * into v_lead from public.lh_leads where id = p_lead_id;
  if not found then
    return null;
  end if;
  select * into v_workspace from public.lh_workspaces where id = v_lead.workspace_id;
  return jsonb_build_object(
    'slug', v_workspace.slug,
    'workspace_id', v_workspace.id,
    'company', v_workspace.name,
    'lead', jsonb_build_object(
      'code', v_lead.code, 'name', v_lead.name, 'channel', v_lead.channel, 'source', v_lead.source,
      'ad', coalesce(v_lead.ad_name, v_lead.utm_content), 'campaign', coalesce(v_lead.campaign_name, v_lead.utm_campaign)
    ),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('kind', t.kind, 'endpoint', t.endpoint, 'p256dh', t.p256dh, 'auth', t.auth))
      from (
        -- One notice per device; the admin one wins (it names the client).
        select distinct on (u.endpoint) u.kind, u.endpoint, u.p256dh, u.auth
        from (
          select 'admin' as kind, 0 as rank, s.endpoint, s.p256dh, s.auth
          from public.lh_admin_push_subscriptions s
          join public.lh_admins a on a.id = s.admin_id and a.disabled_at is null
          where a.role = 'master' or a.id = v_workspace.owner_admin_id
          union all
          select 'client', 1, s.endpoint, s.p256dh, s.auth
          from public.lh_push_subscriptions s where s.workspace_id = v_workspace.id
        ) u
        order by u.endpoint, u.rank
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.lh_server_push_gone(p_secret text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  delete from public.lh_push_subscriptions where endpoint = p_endpoint;
  delete from public.lh_admin_push_subscriptions where endpoint = p_endpoint;
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_push_subscribe(text, text, text, text)',
    'lh_admin_push_unsubscribe(text, text)',
    'lh_server_new_lead_push(text, uuid)',
    'lh_server_push_gone(text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
