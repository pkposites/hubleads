-- Cadê o Lead: metrics of the sheet can be hidden per client, and the new
-- "Identificação Meta" column can be saved.
--
-- - lh_workspaces.hidden_metrics: the top tiles of the sheet this client does
--   not use (e.g. "visitors" for a client with no landing page). Only a panel
--   admin changes them, like the columns; lh_sheet_config returns them.
-- - lh_set_sheet_columns accepted only the standard columns of migration 20,
--   so saving the settings failed once the sheet had the "meta_ids" column.

alter table public.lh_workspaces add column hidden_metrics text[] not null default '{}'
  check (hidden_metrics <@ array['conversion', 'leads', 'visitors', 'clicks', 'with_phone', 'sales']);

/** Same as migration 20, with "meta_ids" among the standard columns. */
create or replace function public.lh_set_sheet_columns(p_token text, p_columns jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_clean jsonb := '[]'::jsonb;
  v_item jsonb;
  v_key text;
  v_kind text;
begin
  if lh_private.session_role(p_token) is distinct from 'admin' then
    raise exception 'only admins can change this' using errcode = 'LH403';
  end if;
  if jsonb_typeof(p_columns) <> 'array' or jsonb_array_length(p_columns) > 150 then
    raise exception 'invalid columns' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_columns) loop
    v_key := trim(v_item ->> 'key');
    v_kind := v_item ->> 'kind';
    if jsonb_typeof(v_item) <> 'object'
      or v_key is null or char_length(v_key) not between 1 and 120 or v_key = 'whatsapp_url'
      or v_kind is null or v_kind not in ('answer', 'custom', 'fixed')
      or (v_kind = 'fixed' and v_key not in ('lp_events', 'origin', 'campaign', 'adset', 'ad', 'page', 'device', 'clicks', 'notes', 'meta_ids'))
      or char_length(coalesce(v_item ->> 'label', '')) > 120
      or v_clean @> jsonb_build_array(jsonb_build_object('key', v_key))
    then
      raise exception 'invalid column' using errcode = '22023';
    end if;
    v_clean := v_clean || jsonb_build_array(jsonb_build_object(
      'key', v_key,
      'label', coalesce(nullif(trim(v_item ->> 'label'), ''), case when v_kind = 'custom' then v_key else '' end),
      'kind', v_kind,
      'hidden', coalesce((v_item ->> 'hidden')::boolean, false)
    ));
  end loop;
  update public.lh_workspaces set sheet_columns = v_clean where id = v_workspace;
  return v_clean;
end;
$$;

/** Same as migration 21, plus the hidden metrics. */
create or replace function public.lh_sheet_config(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_meta public.lh_meta_configs;
begin
  select * into v_meta from public.lh_meta_configs m where m.workspace_id = v_workspace;
  return jsonb_build_object(
    'columns', (select w.sheet_columns from public.lh_workspaces w where w.id = v_workspace),
    'stages', (select w.stages from public.lh_workspaces w where w.id = v_workspace),
    'hidden_metrics', (select to_jsonb(w.hidden_metrics) from public.lh_workspaces w where w.id = v_workspace),
    'meta', jsonb_build_object(
      'schedule', coalesce(v_meta.enabled and v_meta.send_schedule, false),
      'purchase', coalesce(v_meta.enabled and v_meta.send_purchase, false)
    ),
    'answers', coalesce((
      select jsonb_agg(jsonb_build_object('key', a.key, 'leads', a.leads) order by a.leads desc, a.key)
      from (
        select e.key, count(*)::int as leads
        from (
          select l.extra from public.lh_leads l
          where l.workspace_id = v_workspace and jsonb_typeof(l.extra) = 'object'
          order by l.created_at desc
          limit 2000
        ) r, jsonb_each_text(r.extra) e
        where e.value <> '' and e.key <> 'whatsapp_url'
        group by e.key
        order by count(*) desc, e.key
        limit 100
      ) a
    ), '[]'::jsonb)
  );
end;
$$;

/** Hides the sheet's top metrics this client does not use (panel admin only). */
create or replace function public.lh_set_hidden_metrics(p_token text, p_metrics text[])
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_clean text[] := coalesce((select array_agg(distinct m order by m) from unnest(p_metrics) m), '{}');
begin
  if lh_private.session_role(p_token) is distinct from 'admin' then
    raise exception 'only admins can change this' using errcode = 'LH403';
  end if;
  if not v_clean <@ array['conversion', 'leads', 'visitors', 'clicks', 'with_phone', 'sales'] then
    raise exception 'invalid metric' using errcode = '22023';
  end if;
  update public.lh_workspaces set hidden_metrics = v_clean where id = v_workspace;
  return v_clean;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_set_sheet_columns(text, jsonb)',
    'lh_sheet_config(text)',
    'lh_set_hidden_metrics(text, text[])'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
