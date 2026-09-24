-- Lead Hub: multi-tenant foundation (blueprint §4, §7, §14, Appendix A/B).
--
-- Every business table carries workspace_id and is protected by RLS. Policy
-- checks go through SECURITY DEFINER helpers in the `private` schema so that
-- policies on workspace_members do not recurse into themselves and so the
-- helpers are not exposed through the Data API.

create schema if not exists private;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Generic helpers
-- ---------------------------------------------------------------------------

create or replace function private.set_updated_at()
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

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  -- §5.5: first-touch retention window, configurable per workspace.
  attribution_window_days int not null default 90 check (attribution_window_days between 1 and 730),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'manager', 'sales', 'client', 'agent')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members (user_id);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$'),
  status text not null default 'active' check (status in ('active', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  -- Lets child tables use a composite FK that pins them to the same workspace.
  unique (workspace_id, id)
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function private.set_updated_at();
create trigger workspaces_updated_at before update on public.workspaces
  for each row execute function private.set_updated_at();
create trigger projects_updated_at before update on public.projects
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Membership helpers used by every policy
-- ---------------------------------------------------------------------------

create or replace function private.member_role(p_workspace_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select wm.role
  from public.workspace_members wm
  where wm.workspace_id = p_workspace_id
    and wm.user_id = auth.uid()
$$;

create or replace function private.is_member(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.member_role(p_workspace_id) is not null
$$;

create or replace function private.has_role(p_workspace_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.member_role(p_workspace_id) = any (p_roles), false)
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.member_role(uuid) to authenticated, service_role;
grant execute on function private.is_member(uuid) to authenticated, service_role;
grant execute on function private.has_role(uuid, text[]) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Profiles are created automatically for every auth user
-- ---------------------------------------------------------------------------

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- A workspace must always keep at least one admin
-- ---------------------------------------------------------------------------

create or replace function private.ensure_workspace_has_admin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.role = 'admin'
     and (tg_op = 'DELETE' or new.role <> 'admin')
     -- Cascading deletes of the whole workspace are fine.
     and exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     and not exists (
       select 1 from public.workspace_members wm
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
  before update or delete on public.workspace_members
  for each row execute function private.ensure_workspace_has_admin();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.projects enable row level security;

-- Nothing here is readable without a session.
revoke all on public.profiles, public.workspaces, public.workspace_members, public.projects from anon;

create policy "profiles: read self and co-members"
  on public.profiles for select to authenticated
  using (
    id = auth.uid()
    or exists (
      select 1
      from public.workspace_members mine
      join public.workspace_members theirs on theirs.workspace_id = mine.workspace_id
      where mine.user_id = auth.uid()
        and theirs.user_id = profiles.id
    )
  );

create policy "profiles: update self"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "workspaces: members read"
  on public.workspaces for select to authenticated
  using (private.is_member(id));

create policy "workspaces: admins update"
  on public.workspaces for update to authenticated
  using (private.has_role(id, array['admin']))
  with check (private.has_role(id, array['admin']));

-- Workspaces are created through public.create_workspace() so the creator
-- becomes admin atomically. There is no insert/delete policy on purpose.

create policy "members: members read"
  on public.workspace_members for select to authenticated
  using (private.is_member(workspace_id));

create policy "members: admins insert"
  on public.workspace_members for insert to authenticated
  with check (private.has_role(workspace_id, array['admin']));

create policy "members: admins update"
  on public.workspace_members for update to authenticated
  using (private.has_role(workspace_id, array['admin']))
  with check (private.has_role(workspace_id, array['admin']));

create policy "members: admins delete"
  on public.workspace_members for delete to authenticated
  using (private.has_role(workspace_id, array['admin']));

create policy "projects: members read"
  on public.projects for select to authenticated
  using (private.is_member(workspace_id));

create policy "projects: admins and managers insert"
  on public.projects for insert to authenticated
  with check (private.has_role(workspace_id, array['admin', 'manager']));

create policy "projects: admins and managers update"
  on public.projects for update to authenticated
  using (private.has_role(workspace_id, array['admin', 'manager']))
  with check (private.has_role(workspace_id, array['admin', 'manager']));

create policy "projects: admins delete"
  on public.projects for delete to authenticated
  using (private.has_role(workspace_id, array['admin']));

-- ---------------------------------------------------------------------------
-- RPC: create a workspace and make the caller its admin
-- ---------------------------------------------------------------------------

create or replace function public.create_workspace(p_name text, p_slug text)
returns public.workspaces
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_workspace public.workspaces;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.workspaces (name, slug)
  values (trim(p_name), lower(trim(p_slug)))
  returning * into v_workspace;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, v_user, 'admin');

  return v_workspace;
end;
$$;

revoke all on function public.create_workspace(text, text) from public, anon;
grant execute on function public.create_workspace(text, text) to authenticated;
