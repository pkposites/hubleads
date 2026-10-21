-- Cadê o Lead: integrations for the client's team, with the attendant password.
--
-- - Each client can turn on "Atendentes podem configurar integrações"
--   (lh_workspaces.attendants_configure, off by default; only the master or
--   the owner switch it).
-- - When it is on, the sheet shows an "Integrações" tab. Opening it starts a
--   session of the client's team account: an admin of role 'conta' tied to
--   that client (lh_admins.team_workspace_id), member of that client only.
--   Every rule of the 'conta' role applies (no other client, no new clients,
--   no giving access), plus: the team account cannot change the attendant
--   password nor open the sheet as administrator.
-- - Nobody logs in as the team account: its password is random and never
--   shown. Its sessions last 8 hours, and with the switch off it sees no
--   client at all.

alter table public.lh_workspaces add column attendants_configure boolean not null default false;

alter table public.lh_admins
  add column team_workspace_id uuid unique references public.lh_workspaces (id) on delete cascade;

/** Whether the admin may see this client: master, owner or member (team accounts only while the switch is on). */
create or replace function lh_private.admin_sees_workspace(p_admin uuid, p_workspace_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select lh_private.admin_is_master(p_admin)
    or exists (select 1 from public.lh_workspaces w where w.id = p_workspace_id and w.owner_admin_id = p_admin)
    or exists (
      select 1
      from public.lh_workspace_members m
      join public.lh_admins a on a.id = m.admin_id
      join public.lh_workspaces w on w.id = m.workspace_id
      where m.workspace_id = p_workspace_id and m.admin_id = p_admin
        and (a.team_workspace_id is null or w.attendants_configure)
    )
$$;

/** The admin of the session, refused when it is a client's team account. */
create or replace function lh_private.admin_check_not_team(p_token text, p_workspace_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_check_workspace(p_token, p_workspace_id);
begin
  if exists (select 1 from public.lh_admins a where a.id = v_admin and a.team_workspace_id is not null) then
    raise exception 'not for the team account' using errcode = 'LH403';
  end if;
  return v_admin;
end;
$$;

create or replace function public.lh_admin_reset_password(p_token text, p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_not_team(p_token, p_workspace_id);
  return lh_private.lh_admin_reset_password(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_open_workspace(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_not_team(p_token, p_workspace_id);
  return lh_private.lh_admin_open_workspace(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_session(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'login', a.login, 'role', a.role,
    'team', case when a.team_workspace_id is not null then (
      select jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug) from public.lh_workspaces w where w.id = a.team_workspace_id
    ) end
  )
  from public.lh_admins a
  where a.id = lh_private.admin_for(p_token)
$$;

-- Same as migration 28, without the team account (it is not a person).
create or replace function public.lh_admin_list_members(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace_manager(p_token, p_workspace_id);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'login', a.login, 'active', a.disabled_at is null, 'since', m.created_at,
      'last_login_at', (select max(s.created_at) from public.lh_admin_sessions s where s.admin_id = a.id)
    ) order by m.created_at)
    from public.lh_workspace_members m join public.lh_admins a on a.id = m.admin_id
    where m.workspace_id = p_workspace_id and a.team_workspace_id is null
  ), '[]'::jsonb);
end;
$$;

/** Whether the client's attendants can configure integrations. */
create or replace function public.lh_admin_get_team_access(p_token text, p_workspace_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return (select w.attendants_configure from public.lh_workspaces w where w.id = p_workspace_id);
end;
$$;

/** Turns the integrations tab of the attendants on or off (master or owner). */
create or replace function public.lh_admin_set_team_access(p_token text, p_workspace_id uuid, p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace_manager(p_token, p_workspace_id);
  update public.lh_workspaces set attendants_configure = coalesce(p_enabled, false) where id = p_workspace_id;
end;
$$;

create or replace function public.lh_session(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', w.id, 'name', w.name, 'slug', w.slug, 'role', s.role, 'configure', w.attendants_configure)
  from public.lh_sessions s
  join public.lh_workspaces w on w.id = s.workspace_id
  where s.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and s.expires_at > now()
$$;

/**
 * From the sheet (attendant session): opens the integrations of this client
 * as its team account, when the switch is on. Returns an admin session token
 * valid for 8 hours.
 */
create or replace function public.lh_session_open_integrations(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace public.lh_workspaces;
  v_admin uuid;
  v_token text;
begin
  select w.* into v_workspace
  from public.lh_sessions s
  join public.lh_workspaces w on w.id = s.workspace_id
  where s.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and s.expires_at > now();
  if v_workspace.id is null then
    raise exception 'invalid or expired session' using errcode = 'LH401';
  end if;
  if not v_workspace.attendants_configure then
    raise exception 'integrations are not open to the attendants' using errcode = 'LH403';
  end if;

  insert into public.lh_admins (login, password_hash, role, team_workspace_id)
  values (
    'equipe:' || v_workspace.id,
    lh_private.hash_password(encode(extensions.gen_random_bytes(24), 'hex')),
    'conta',
    v_workspace.id
  )
  on conflict (login) do update set disabled_at = null
  returning id into v_admin;
  insert into public.lh_workspace_members (workspace_id, admin_id) values (v_workspace.id, v_admin)
  on conflict do nothing;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.lh_admin_sessions (token_hash, admin_id, expires_at)
  values (lh_private.sha256(v_token), v_admin, now() + interval '8 hours');
  return jsonb_build_object('token', v_token, 'workspace_id', v_workspace.id);
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_reset_password(text, uuid)',
    'lh_admin_open_workspace(text, uuid)',
    'lh_admin_session(text)',
    'lh_admin_list_members(text, uuid)',
    'lh_admin_get_team_access(text, uuid)',
    'lh_admin_set_team_access(text, uuid, boolean)',
    'lh_session(text)',
    'lh_session_open_integrations(text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;
