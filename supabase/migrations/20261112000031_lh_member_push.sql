-- New-lead notifications also reach the people given access to the client
-- (lh_workspace_members: "conta" people and gestores added as members), not
-- only the masters and the owning gestor. The client's team account
-- (team_workspace_id) uses the client's own devices, never these.

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
          join public.lh_admins a on a.id = s.admin_id and a.disabled_at is null and a.team_workspace_id is null
          where a.role = 'master'
            or a.id = v_workspace.owner_admin_id
            or exists (select 1 from public.lh_workspace_members m where m.workspace_id = v_workspace.id and m.admin_id = a.id)
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
