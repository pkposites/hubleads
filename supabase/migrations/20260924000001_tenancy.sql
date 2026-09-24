-- Lead Hub: multi-tenant foundation (blueprint §4, §7, §14, Appendix A/B).
--
-- All Lead Hub objects live in their own schemas (`leadhub` for the Data API,
-- `leadhub_private` for internal helpers) so the app can share a Supabase
-- project with other systems without touching their tables. `leadhub` must be
-- listed under Project Settings → Data API → Exposed schemas.
--
-- Every business table carries workspace_id and is protected by RLS. Policy
-- checks go through SECURITY DEFINER helpers in `leadhub_private` so that
-- policies on workspace_members do not recurse into themselves and so the
-- helpers are not exposed through the Data API.

create schema if not exists leadhub;
create schema if not exists leadhub_private;

-- Same baseline Supabase applies to `public`: API roles get privileges on new
-- objects, and RLS plus explicit revokes below narrow them down.
grant usage on schema leadhub to anon, authenticated, service_role;
alter default privileges in schema leadhub grant all on tables to anon, authenticated, service_role;
alter default privileges in schema leadhub grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema leadhub grant all on functions to anon, authenticated, service_role;

grant usage on schema leadhub_private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create or replace function leadhub_private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table leadhub.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leadhub.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  -- §5.5: first-touch retention window, configurable per workspace.
  attribution_window_days int not null default 90 check (attribution_window_days between 1 and 730),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table leadhub.workspace_members (
  workspace_id uuid not null references leadhub.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'sales', 'client', 'agent')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on leadhub.workspace_members (user_id);

create table leadhub.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references leadhub.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  -- Lets child tables use a composite FK that pins them to the same workspace.
  unique (workspace_id, id)
);

create trigger profiles_updated_at before update on leadhub.profiles
  for each row execute function leadhub_private.set_updated_at();
create trigger workspaces_updated_at before update on leadhub.workspaces
  for each row execute function leadhub_private.set_updated_at();
create trigger projects_updated_at before update on leadhub.projects
  for each row execute function leadhub_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers used by every policy
-- ---------------------------------------------------------------------------

create or replace function leadhub_private.member_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role
  from leadhub.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid()
$$;

create or replace function leadhub_private.is_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select leadhub_private.member_role(p_workspace_id) is not null
$$;

create or replace function leadhub_private.has_role(p_workspace_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(leadhub_private.member_role(p_workspace_id) = any (p_roles), false)
$$;

revoke all on all functions in schema leadhub_private from public, anon;
grant execute on function leadhub_private.member_role(uuid) to authenticated, service_role;
grant execute on function leadhub_private.is_member(uuid) to authenticated, service_role;
grant execute on function leadhub_private.has_role(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profiles are created automatically for every auth user
-- ---------------------------------------------------------------------------

create or replace function leadhub_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into leadhub.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger leadhub_on_auth_user_created
  after insert on auth.users
  for each row execute function leadhub_private.handle_new_user();

-- ---------------------------------------------------------------------------
-- A workspace must always keep at least one admin
-- ---------------------------------------------------------------------------

create or replace function leadhub_private.ensure_workspace_has_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     -- Cascading deletes of the whole workspace are fine.
     and exists (select 1 from leadhub.workspaces w where w.id = old.workspace_id)
     and not exists (
       select 1 from leadhub.workspace_members wm
       where wm.workspace_id = old.workspace_id
         and wm.role = 'admin'
         and wm.user_id <> old.user_id
     )
  then
    raise exception 'workspace must keep at least one admin'
      using errcode = 'check_violation';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger workspace_members_keep_admin
  before update or delete on leadhub.workspace_members
  for each row execute function leadhub_private.ensure_workspace_has_admin();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table leadhub.profiles enable row level security;
alter table leadhub.workspaces enable row level security;
alter table leadhub.workspace_members enable row level security;
alter table leadhub.projects enable row level security;

-- Nothing here is readable without a session.
revoke all on leadhub.profiles, leadhub.workspaces, leadhub.workspace_members, leadhub.projects from anon;

create policy "profiles: read self and co-members"
  on leadhub.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from leadhub.workspace_members mine
      join leadhub.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

create policy "profiles: update self"
  on leadhub.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "workspaces: members read"
  on leadhub.workspaces for select to authenticated
  using (leadhub_private.is_member(id));

create policy "workspaces: admins update"
  on leadhub.workspaces for update to authenticated
  using (leadhub_private.has_role(id, array['admin']))
  with check (leadhub_private.has_role(id, array['admin']));

-- Workspaces are created through leadhub.create_workspace() so the creator
-- becomes admin atomically. There is no insert/delete policy on purpose.

create policy "members: members read"
  on leadhub.workspace_members for select to authenticated
  using (leadhub_private.is_member(workspace_id));

create policy "members: admins insert"
  on leadhub.workspace_members for insert to authenticated
  with check (leadhub_private.has_role(workspace_id, array['admin']));

create policy "members: admins update"
  on leadhub.workspace_members for update to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin']))
  with check (leadhub_private.has_role(workspace_id, array['admin']));

create policy "members: admins delete"
  on leadhub.workspace_members for delete to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin']));

create policy "projects: members read"
  on leadhub.projects for select to authenticated
  using (leadhub_private.is_member(workspace_id));

create policy "projects: admins and managers insert"
  on leadhub.projects for insert to authenticated
  with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

create policy "projects: admins and managers update"
  on leadhub.projects for update to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin', 'manager']))
  with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

create policy "projects: admins delete"
  on leadhub.projects for delete to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin']));

-- ---------------------------------------------------------------------------
-- RPC: create a workspace and make the caller its admin
-- ---------------------------------------------------------------------------

create or replace function leadhub.create_workspace(p_name text, p_slug text)
returns leadhub.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace leadhub.workspaces;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into leadhub.workspaces (name, slug)
  values (trim(p_name), lower(trim(p_slug)))
  returning * into v_workspace;

  insert into leadhub.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_user, 'admin');

  return v_workspace;
end;
$$;

revoke all on function leadhub.create_workspace(text, text) from public, anon;
grant execute on function leadhub.create_workspace(text, text) to authenticated;
