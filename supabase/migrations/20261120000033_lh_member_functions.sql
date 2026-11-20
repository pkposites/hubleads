-- The last two functions of 20261021000028 (resetting the password of a
-- person with access to a client and taking the access away) were never
-- applied in production. They come here, guarded against the client's team
-- account (team_workspace_id): it has no login, so it never gets a password,
-- and it is turned on and off only with "Integrações para a equipe".

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
  where a.id = p_admin_id and a.role = 'conta' and a.team_workspace_id is null
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
  -- The client's team account goes with "Integrações para a equipe", never from here.
  delete from public.lh_workspace_members m
  where m.workspace_id = p_workspace_id and m.admin_id = p_admin_id
    and not exists (select 1 from public.lh_admins a where a.id = p_admin_id and a.team_workspace_id is not null);
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
    'lh_admin_reset_member_password(text, uuid, uuid)',
    'lh_admin_remove_member(text, uuid, uuid)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
