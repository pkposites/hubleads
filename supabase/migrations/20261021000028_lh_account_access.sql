-- Cadê o Lead: access for a person of the client ("pessoa da conta").
--
-- - A new admin role, 'conta', for someone on the client's side (an
--   attendant lead or the client's own admin) who sets up and follows only
--   the clients they were given: lh_workspace_members lists them.
-- - admin_check_workspace now lets in the master, the owner (gestor) and the
--   members of that client. Every public lh_admin_* function that takes a
--   client or a page already calls it first, so a member gets "not found" on
--   any other client exactly like a gestor does.
-- - A 'conta' person cannot create clients, cannot see gestores, sign-ups or
--   the infrastructure, and cannot give access to anyone: only the master and
--   the client's owner manage the members.
-- - Removing the last access of a person disables the account, like
--   deactivating a gestor.

alter table public.lh_admins drop constraint lh_admins_role_check;
alter table public.lh_admins add constraint lh_admins_role_check check (role in ('master', 'gestor', 'conta'));

create table public.lh_workspace_members (
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  admin_id uuid not null references public.lh_admins (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (workspace_id, admin_id)
);

alter table public.lh_workspace_members enable row level security;
revoke all on public.lh_workspace_members from anon, authenticated;
create index lh_workspace_members_admin_idx on public.lh_workspace_members (admin_id);

/** Whether the admin may see this client: master, owner or member. */
create or replace function lh_private.admin_sees_workspace(p_admin uuid, p_workspace_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select lh_private.admin_is_master(p_admin)
    or exists (select 1 from public.lh_workspaces w where w.id = p_workspace_id and w.owner_admin_id = p_admin)
    or exists (select 1 from public.lh_workspace_members m where m.workspace_id = p_workspace_id and m.admin_id = p_admin)
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
  if not lh_private.admin_sees_workspace(v_admin, p_workspace_id) then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  return v_admin;
end;
$$;

/** Master or the client's owner: the ones who give and take access. */
create or replace function lh_private.admin_check_workspace_manager(p_token text, p_workspace_id uuid)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_check_workspace(p_token, p_workspace_id);
begin
  if exists (select 1 from public.lh_admins a where a.id = v_admin and a.role = 'conta') then
    raise exception 'only the master or the owner can do this' using errcode = 'LH403';
  end if;
  return v_admin;
end;
$$;

-- New clients belong to the admin who creates them; people of a client do not create clients.
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
  if exists (select 1 from public.lh_admins a where a.id = v_admin and a.role = 'conta') then
    raise exception 'only the master or a gestor can create clients' using errcode = 'LH403';
  end if;
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
begin
  return (
    select coalesce(jsonb_agg(lh_private.workspace_summary(w) order by w.created_at desc), '[]'::jsonb)
    from public.lh_workspaces w
    where lh_private.admin_sees_workspace(v_admin, w.id)
  );
end;
$$;

-- Same body as migration 25; only the client rule changes (members too).
create or replace function public.lh_admin_all_leads(p_token text, p_filters jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
  v_filters jsonb := coalesce(p_filters, '{}'::jsonb);
  v_client uuid;
  v_search text := nullif(left(trim(coalesce(v_filters ->> 'search', '')), 100), '');
  v_digits text;
  v_status text := nullif(v_filters ->> 'status', '');
  v_source text := nullif(v_filters ->> 'source', '');
  v_days int := least(greatest(coalesce((v_filters ->> 'days')::int, 30), 0), 3650);
  v_limit int := least(greatest(coalesce((v_filters ->> 'limit')::int, 100), 1), 500);
begin
  begin
    v_client := nullif(v_filters ->> 'client', '')::uuid;
  exception when invalid_text_representation then
    raise exception 'invalid client' using errcode = '22023';
  end;
  v_digits := nullif(regexp_replace(coalesce(v_search, ''), '\D', '', 'g'), '');

  return (
    with mine as (
      select w.id, w.name, w.slug from public.lh_workspaces w
      where lh_private.admin_sees_workspace(v_admin, w.id)
        and (v_client is null or w.id = v_client)
    ),
    found as (
      select l.*, m.name as client_name, m.slug as client_slug
      from public.lh_leads l join mine m on m.id = l.workspace_id
      where (v_days = 0 or l.created_at > now() - make_interval(days => v_days))
        and (v_status is null or l.status = v_status)
        and (v_source is null or l.source = v_source)
        and (
          v_search is null
          or l.name ilike '%' || v_search || '%'
          or upper(l.code) = upper(v_search)
          or (v_digits is not null and length(v_digits) >= 4 and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') like '%' || v_digits || '%')
        )
    )
    select jsonb_build_object(
      'total', (select count(*) from found),
      'by_client', coalesce((
        select jsonb_agg(jsonb_build_object('id', c.workspace_id, 'name', c.client_name, 'count', c.n) order by c.n desc, c.client_name)
        from (select workspace_id, client_name, count(*) as n from found group by 1, 2) c
      ), '[]'::jsonb),
      'leads', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', f.id,
          'client_id', f.workspace_id,
          'client_name', f.client_name,
          'client_slug', f.client_slug,
          'code', f.code,
          'name', f.name,
          'phone', f.phone,
          'status', f.status,
          'color', f.color,
          'source', f.source,
          'channel', f.channel,
          'campaign', coalesce(f.campaign_name, f.utm_campaign),
          'sale_value', f.sale_value,
          'created_at', f.created_at
        ) order by f.created_at desc)
        from (select * from found order by created_at desc limit v_limit) f
      ), '[]'::jsonb)
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- People with access to a client
-- ---------------------------------------------------------------------------

/** People of this client (role 'conta'), for the master and the owner. */
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
    where m.workspace_id = p_workspace_id
  ), '[]'::jsonb);
end;
$$;

/**
 * Gives a person access to this client. A new e-mail creates the account and
 * returns its password (shown once); an existing 'conta' person just gains
 * this client. E-mails of the master or of gestores are refused.
 */
create or replace function public.lh_admin_add_member(p_token text, p_workspace_id uuid, p_login text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_login text := lower(trim(coalesce(p_login, '')));
  v_existing public.lh_admins;
  v_password text;
  v_id uuid;
begin
  perform lh_private.admin_check_workspace_manager(p_token, p_workspace_id);
  if v_login !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid login' using errcode = '22023';
  end if;
  select * into v_existing from public.lh_admins a where a.login = v_login;
  if v_existing.id is not null and v_existing.role <> 'conta' then
    raise exception 'login in use' using errcode = 'LH409';
  end if;
  if v_existing.id is null or v_existing.disabled_at is not null then
    v_password := lh_private.random_password();
    insert into public.lh_admins (login, password_hash, role)
    values (v_login, lh_private.hash_password(v_password), 'conta')
    on conflict (login) do update set password_hash = excluded.password_hash, disabled_at = null
    returning id into v_id;
  else
    v_id := v_existing.id;
  end if;
  insert into public.lh_workspace_members (workspace_id, admin_id) values (p_workspace_id, v_id)
  on conflict do nothing;
  return jsonb_strip_nulls(jsonb_build_object('id', v_id, 'login', v_login, 'password', v_password));
end;
$$;

/** New password for a person of this client (the old one stops working). */
create or replace function public.lh_admin_reset_member_password(p_token text, p_workspace_id uuid, p_admin_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_password text := lh_private.random_password();
begin
  perform lh_private.admin_check_workspace_manager(p_token, p_workspace_id);
  update public.lh_admins a
  set password_hash = lh_private.hash_password(v_password), disabled_at = null
  where a.id = p_admin_id and a.role = 'conta'
    and exists (select 1 from public.lh_workspace_members m where m.workspace_id = p_workspace_id and m.admin_id = a.id);
  if not found then
    raise exception 'member not found' using errcode = 'LH404';
  end if;
  delete from public.lh_admin_sessions where admin_id = p_admin_id;
  return v_password;
end;
$$;

/** Takes the access away at once; without any client left, the account is disabled. */
create or replace function public.lh_admin_remove_member(p_token text, p_workspace_id uuid, p_admin_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.admin_check_workspace_manager(p_token, p_workspace_id);
  delete from public.lh_workspace_members where workspace_id = p_workspace_id and admin_id = p_admin_id;
  if not found then
    raise exception 'member not found' using errcode = 'LH404';
  end if;
  if not exists (select 1 from public.lh_workspace_members m where m.admin_id = p_admin_id) then
    update public.lh_admins
    set disabled_at = now(), password_hash = lh_private.hash_password(encode(extensions.gen_random_bytes(24), 'hex'))
    where id = p_admin_id and role = 'conta';
    delete from public.lh_admin_sessions where admin_id = p_admin_id;
  end if;
  -- Sheets opened as admin on this client stop working (they reopen from the panel).
  delete from public.lh_sessions where workspace_id = p_workspace_id and role = 'admin';
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_create_workspace(text, text, text, text, text[])',
    'lh_admin_list_workspaces(text)',
    'lh_admin_all_leads(text, jsonb)',
    'lh_admin_list_members(text, uuid)',
    'lh_admin_add_member(text, uuid, text)',
    'lh_admin_reset_member_password(text, uuid, uuid)',
    'lh_admin_remove_member(text, uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;
