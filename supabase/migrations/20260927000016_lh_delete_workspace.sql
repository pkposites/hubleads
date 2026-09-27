-- Lead Hub: delete a client from the admin panel.
--
-- - Master only (a gestor asks the master). The client must also pass
--   admin_check_workspace, like every lh_admin_* function taking a client.
-- - The exact client name must be typed to confirm.
-- - Everything of the client goes: Landing Pages, leads, events, history,
--   sessions, templates, Meta settings and logs, push subscriptions and
--   visit counts (all by foreign keys with on delete cascade).
-- - lh_audit keeps a record of the deletion (who, when, how many leads),
--   without names or phones, like the other entries.

create or replace function public.lh_admin_delete_workspace(p_token text, p_workspace_id uuid, p_confirm_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_check_workspace(p_token, p_workspace_id);
  v_workspace public.lh_workspaces;
  v_leads int;
  v_login text;
begin
  perform lh_private.admin_require_master(p_token);
  select * into v_workspace from public.lh_workspaces where id = p_workspace_id for update;
  if not found then
    raise exception 'workspace not found' using errcode = 'LH404';
  end if;
  if lower(trim(coalesce(p_confirm_name, ''))) <> lower(trim(v_workspace.name)) then
    raise exception 'confirmation does not match the client name' using errcode = '22023';
  end if;

  select count(*) into v_leads from public.lh_leads where workspace_id = p_workspace_id;
  select login into v_login from public.lh_admins where id = v_admin;

  perform set_config('lh.actor', 'admin', true);
  insert into public.lh_audit (workspace_id, action, actor, detail)
  values (p_workspace_id, 'delete_workspace', 'admin', jsonb_build_object('leads', v_leads, 'slug', v_workspace.slug, 'by', v_login));

  delete from public.lh_workspaces where id = p_workspace_id;
  return jsonb_build_object('leads', v_leads);
end;
$$;

revoke all on function public.lh_admin_delete_workspace(text, uuid, text) from public;
grant execute on function public.lh_admin_delete_workspace(text, uuid, text) to anon, authenticated, service_role;
