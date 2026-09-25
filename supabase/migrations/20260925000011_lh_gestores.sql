-- Lead Hub: separate panels for other managers ("gestores").
--
-- - Each admin is either the master (sees and manages every client and the
--   managers) or a gestor (sees only the clients they created or that the
--   master handed over to them). Admins created from SQL with
--   lh_private.create_admin are masters; gestores are created in the panel.
-- - Every client has an owner (owner_admin_id). Clients without an owner
--   belong to the master only.
-- - Every admin function that takes a client first checks that the logged-in
--   admin may see that client: the original functions move to lh_private and
--   a thin public function in front of each one does the check, so no rule
--   depends on each body remembering it. A client that is not yours looks
--   exactly like one that does not exist.
-- - Deactivating a gestor ends their sessions and makes their password
--   unusable; reactivating generates a new password.

alter table public.lh_admins
  add column role text not null default 'gestor' check (role in ('master', 'gestor')),
  add column disabled_at timestamptz;

-- Everyone who administers Lead Hub today is a master.
update public.lh_admins set role = 'master';

alter table public.lh_workspaces
  add column owner_admin_id uuid references public.lh_admins (id) on delete set null;

create index lh_workspaces_owner_idx on public.lh_workspaces (owner_admin_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

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
  join public.lh_admins a on a.id = s.admin_id and a.disabled_at is null
  where s.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and s.expires_at > now();
  if v_admin is null then
    raise exception 'invalid or expired admin session' using errcode = 'LH401';
  end if;
  return v_admin;
end;
$$;

create or replace function lh_private.admin_is_master(p_admin uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from public.lh_admins a where a.id = p_admin and a.role = 'master')
$$;

/** The admin of the session, if they may manage this client; otherwise "not found". */
create or replace function lh_private.admin_check_workspace(p_token text, p_workspace_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
begin
  if lh_private.admin_is_master(v_admin) then
    return v_admin;
  end if;
  if not exists (select 1 from public.lh_workspaces w where w.id = p_workspace_id and w.owner_admin_id = v_admin) then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  return v_admin;
end;
$$;

create or replace function lh_private.admin_require_master(p_token text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
begin
  if not lh_private.admin_is_master(v_admin) then
    raise exception 'only the master admin can do this' using errcode = 'LH403';
  end if;
  return v_admin;
end;
$$;

-- Admins created from SQL are masters (bootstrap); gestores come from the panel.
create or replace function lh_private.create_admin(p_login text, p_password text, p_role text default 'master')
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
  insert into public.lh_admins (login, password_hash, role)
  values (lower(trim(p_login)), lh_private.hash_password(p_password), p_role)
  on conflict (login) do update set password_hash = excluded.password_hash, disabled_at = null
  returning id into v_id;
  return v_id;
end;
$$;

drop function lh_private.create_admin(text, text);

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
    'owner_admin_id', w.owner_admin_id,
    'owner_login', (select a.login from public.lh_admins a where a.id = w.owner_admin_id),
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
-- The original admin functions move behind a check
-- ---------------------------------------------------------------------------

alter function public.lh_admin_workspace(p_token text, p_workspace_id uuid) set schema lh_private;
alter function public.lh_admin_reset_password(p_token text, p_workspace_id uuid) set schema lh_private;
alter function public.lh_admin_add_page(p_token text, p_workspace_id uuid, p_name text, p_domains text[]) set schema lh_private;
alter function public.lh_admin_list_events(p_token text, p_workspace_id uuid, p_limit integer) set schema lh_private;
alter function public.lh_admin_open_workspace(p_token text, p_workspace_id uuid) set schema lh_private;
alter function public.lh_admin_get_meta(p_token text, p_workspace_id uuid) set schema lh_private;
alter function public.lh_admin_set_meta(p_token text, p_workspace_id uuid, p_pixel_id text, p_access_token text, p_token_hint text, p_test_event_code text, p_enabled boolean, p_send_schedule boolean, p_send_purchase boolean) set schema lh_private;
alter function public.lh_admin_get_privacy(p_token text, p_workspace_id uuid) set schema lh_private;
alter function public.lh_admin_set_privacy(p_token text, p_workspace_id uuid, p_controller text, p_document text, p_email text, p_retention_months integer) set schema lh_private;
alter function public.lh_admin_lp_pixels(p_token text, p_workspace_id uuid) set schema lh_private;
alter function public.lh_admin_update_page(p_token text, p_page_id uuid, p_name text, p_domains text[], p_whatsapp_code boolean) set schema lh_private;
alter function public.lh_admin_create_workspace(p_token text, p_name text, p_slug text, p_page_name text, p_domains text[]) set schema lh_private;
alter function public.lh_admin_infra(p_token text) set schema lh_private;

create or replace function public.lh_admin_workspace(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_workspace(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_reset_password(p_token text, p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_reset_password(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_add_page(p_token text, p_workspace_id uuid, p_name text, p_domains text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_add_page(p_token, p_workspace_id, p_name, p_domains);
end;
$$;

create or replace function public.lh_admin_list_events(p_token text, p_workspace_id uuid, p_limit integer DEFAULT 100)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_list_events(p_token, p_workspace_id, p_limit);
end;
$$;

create or replace function public.lh_admin_open_workspace(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_open_workspace(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_get_meta(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_get_meta(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_set_meta(p_token text, p_workspace_id uuid, p_pixel_id text, p_access_token text, p_token_hint text, p_test_event_code text, p_enabled boolean, p_send_schedule boolean, p_send_purchase boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  perform lh_private.lh_admin_set_meta(p_token, p_workspace_id, p_pixel_id, p_access_token, p_token_hint, p_test_event_code, p_enabled, p_send_schedule, p_send_purchase);
end;
$$;

create or replace function public.lh_admin_get_privacy(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_get_privacy(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_set_privacy(p_token text, p_workspace_id uuid, p_controller text, p_document text, p_email text, p_retention_months integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  perform lh_private.lh_admin_set_privacy(p_token, p_workspace_id, p_controller, p_document, p_email, p_retention_months);
end;
$$;

create or replace function public.lh_admin_lp_pixels(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, p_workspace_id);
  return lh_private.lh_admin_lp_pixels(p_token, p_workspace_id);
end;
$$;

create or replace function public.lh_admin_update_page(p_token text, p_page_id uuid, p_name text, p_domains text[], p_whatsapp_code boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace(p_token, (select p.workspace_id from public.lh_pages p where p.id = p_page_id));
  return lh_private.lh_admin_update_page(p_token, p_page_id, p_name, p_domains, p_whatsapp_code);
end;
$$;

create or replace function public.lh_admin_infra(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_require_master(p_token);
  return lh_private.lh_admin_infra(p_token);
end;
$$;

-- New clients belong to the admin who creates them.
create or replace function public.lh_admin_create_workspace(p_token text, p_name text, p_slug text, p_page_name text, p_domains text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
  v_result jsonb;
begin
  v_result := lh_private.lh_admin_create_workspace(p_token, p_name, p_slug, p_page_name, p_domains);
  update public.lh_workspaces set owner_admin_id = v_admin where id = (v_result -> 'workspace' ->> 'id')::uuid;
  return v_result;
end;
$$;

create or replace function public.lh_admin_list_workspaces(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
  v_master boolean := lh_private.admin_is_master(v_admin);
begin
  return (
    select coalesce(jsonb_agg(lh_private.workspace_summary(w) order by w.created_at desc), '[]'::jsonb)
    from public.lh_workspaces w
    where v_master or w.owner_admin_id = v_admin
  );
end;
$$;

create or replace function public.lh_admin_session(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', a.id, 'login', a.login, 'role', a.role)
  from public.lh_admins a
  where a.id = lh_private.admin_for(p_token)
$$;

-- ---------------------------------------------------------------------------
-- Managing gestores (master only)
-- ---------------------------------------------------------------------------

create or replace function public.lh_admin_list_admins(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_require_master(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', a.id, 'login', a.login, 'role', a.role, 'active', a.disabled_at is null,
      'created_at', a.created_at,
      'clients', (select count(*) from public.lh_workspaces w where w.owner_admin_id = a.id),
      'last_login_at', (select max(s.created_at) from public.lh_admin_sessions s where s.admin_id = a.id)
    ) order by a.role desc, a.created_at)
    from public.lh_admins a
  ), '[]'::jsonb);
end;
$$;

/** Creates a gestor and returns the password (shown once). */
create or replace function public.lh_admin_create_gestor(p_token text, p_login text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text := lh_private.random_password();
  v_login text := lower(trim(coalesce(p_login, '')));
  v_id uuid;
begin
  perform lh_private.admin_require_master(p_token);
  if v_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid login' using errcode = '22023';
  end if;
  insert into public.lh_admins (login, password_hash, role)
  values (v_login, lh_private.hash_password(v_password), 'gestor')
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'login', v_login, 'password', v_password);
end;
$$;

create or replace function public.lh_admin_reset_admin_password(p_token text, p_admin_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text := lh_private.random_password();
begin
  perform lh_private.admin_require_master(p_token);
  update public.lh_admins
  set password_hash = lh_private.hash_password(v_password), disabled_at = null
  where id = p_admin_id and role = 'gestor';
  if not found then
    raise exception 'gestor not found' using errcode = 'LH404';
  end if;
  delete from public.lh_admin_sessions where admin_id = p_admin_id;
  return v_password;
end;
$$;

/** Deactivating ends the gestor's sessions and makes the password unusable. */
create or replace function public.lh_admin_deactivate_gestor(p_token text, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_require_master(p_token);
  update public.lh_admins
  set disabled_at = now(), password_hash = lh_private.hash_password(encode(extensions.gen_random_bytes(24), 'hex'))
  where id = p_admin_id and role = 'gestor';
  if not found then
    raise exception 'gestor not found' using errcode = 'LH404';
  end if;
  delete from public.lh_admin_sessions where admin_id = p_admin_id;
  -- Sheets the gestor had opened as admin stop working too.
  delete from public.lh_sessions s
  using public.lh_workspaces w
  where s.workspace_id = w.id and w.owner_admin_id = p_admin_id and s.role = 'admin';
end;
$$;

/** Hands a client to a gestor (or back to the master with null). */
create or replace function public.lh_admin_transfer_workspace(p_token text, p_workspace_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_require_master(p_token);
  if p_admin_id is not null and not exists (
    select 1 from public.lh_admins a where a.id = p_admin_id and a.role = 'gestor' and a.disabled_at is null
  ) then
    raise exception 'gestor not found' using errcode = 'LH404';
  end if;
  update public.lh_workspaces set owner_admin_id = p_admin_id where id = p_workspace_id;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  -- Admin sheets opened by the previous owner stop working.
  delete from public.lh_sessions where workspace_id = p_workspace_id and role = 'admin';
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
    'lh_admin_workspace(text, uuid)',
    'lh_admin_reset_password(text, uuid)',
    'lh_admin_add_page(text, uuid, text, text[])',
    'lh_admin_list_events(text, uuid, integer)',
    'lh_admin_open_workspace(text, uuid)',
    'lh_admin_get_meta(text, uuid)',
    'lh_admin_set_meta(text, uuid, text, text, text, text, boolean, boolean, boolean)',
    'lh_admin_get_privacy(text, uuid)',
    'lh_admin_set_privacy(text, uuid, text, text, text, integer)',
    'lh_admin_lp_pixels(text, uuid)',
    'lh_admin_update_page(text, uuid, text, text[], boolean)',
    'lh_admin_infra(text)',
    'lh_admin_create_workspace(text, text, text, text, text[])',
    'lh_admin_list_workspaces(text)',
    'lh_admin_session(text)',
    'lh_admin_list_admins(text)',
    'lh_admin_create_gestor(text, text)',
    'lh_admin_reset_admin_password(text, uuid)',
    'lh_admin_deactivate_gestor(text, uuid)',
    'lh_admin_transfer_workspace(text, uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
