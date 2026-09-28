-- Lead Hub: steps, colours and a check before statuses that go to Meta.
--
-- - Step ("etapa"): each client has its own list of internal steps (set by a
--   panel admin); a lead can be put in one. Only for the team: never sent
--   to Meta and does not change the status.
-- - Colour: green / yellow / red to mark good and bad leads.
-- - The sheet can filter by step and colour ('-' = without one).
-- - lh_sheet_config also says which statuses go to Meta, so the panel asks
--   before sending them.

alter table public.lh_workspaces add column stages jsonb not null
  default '["Primeiro contato", "Em conversa", "Proposta enviada", "Negociando"]'::jsonb
  check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) <= 20);

alter table public.lh_leads
  add column stage text check (char_length(stage) between 1 and 60),
  add column color text check (color in ('verde', 'amarelo', 'vermelho'));

/** Saves the client's list of steps (panel admin only). Leads keep the step they are in. */
create or replace function public.lh_set_stages(p_token text, p_stages jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_clean jsonb := '[]'::jsonb;
  v_item jsonb;
  v_name text;
begin
  if lh_private.session_role(p_token) is distinct from 'admin' then
    raise exception 'only admins can change this' using errcode = 'LH403';
  end if;
  if jsonb_typeof(p_stages) <> 'array' or jsonb_array_length(p_stages) > 20 then
    raise exception 'invalid stages' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_stages) loop
    v_name := trim(v_item #>> '{}');
    if jsonb_typeof(v_item) <> 'string' or char_length(v_name) not between 1 and 60 or v_clean @> jsonb_build_array(v_name) then
      raise exception 'invalid stage' using errcode = '22023';
    end if;
    v_clean := v_clean || jsonb_build_array(v_name);
  end loop;
  update public.lh_workspaces set stages = v_clean where id = v_workspace;
  return v_clean;
end;
$$;

/** Column settings, answers found, steps, and which statuses go to Meta. */
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

create or replace function public.lh_update_lead(p_token text, p_lead_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_old public.lh_leads;
  v_lead public.lh_leads;
  v_status text;
  v_reason text;
  v_extra jsonb;
  v_columns jsonb;
  v_key text;
  v_value text;
  v_stages jsonb;
  v_stage text;
  v_color text;
begin
  perform lh_private.set_actor(lh_private.session_role(p_token));

  select * into v_old from public.lh_leads where id = p_lead_id and workspace_id = v_workspace for update;
  if not found then
    raise exception 'lead not found' using errcode = 'LH404';
  end if;

  v_status := case when p_patch ? 'status' then p_patch ->> 'status' else v_old.status end;
  v_reason := case when p_patch ? 'lost_reason' then nullif(left(trim(p_patch ->> 'lost_reason'), 200), '') else v_old.lost_reason end;
  if v_status = 'perdido' and v_reason is null then
    raise exception 'lost_reason is required when marking a lead as lost' using errcode = '22023';
  end if;

  -- Only the columns the admin added can be written; answers stay as sent.
  v_extra := coalesce(v_old.extra, '{}'::jsonb);
  if p_patch ? 'fields' then
    if jsonb_typeof(p_patch -> 'fields') <> 'object' then
      raise exception 'invalid fields' using errcode = '22023';
    end if;
    select w.sheet_columns into v_columns from public.lh_workspaces w where w.id = v_workspace;
    for v_key, v_value in select key, value from jsonb_each_text(p_patch -> 'fields') loop
      if not v_columns @> jsonb_build_array(jsonb_build_object('key', v_key, 'kind', 'custom')) then
        raise exception 'unknown field' using errcode = '22023';
      end if;
      v_value := nullif(left(trim(coalesce(v_value, '')), 500), '');
      v_extra := case when v_value is null then v_extra - v_key else jsonb_set(v_extra, array[v_key], to_jsonb(v_value)) end;
    end loop;
  end if;

  -- Step and colour are for the team only (never sent to Meta).
  v_stage := case when p_patch ? 'stage' then nullif(trim(p_patch ->> 'stage'), '') else v_old.stage end;
  if p_patch ? 'stage' and v_stage is not null then
    select w.stages into v_stages from public.lh_workspaces w where w.id = v_workspace;
    if not v_stages @> jsonb_build_array(v_stage) then
      raise exception 'unknown stage' using errcode = '22023';
    end if;
  end if;
  v_color := case when p_patch ? 'color' then nullif(p_patch ->> 'color', '') else v_old.color end;
  if v_color is not null and v_color not in ('verde', 'amarelo', 'vermelho') then
    raise exception 'invalid color' using errcode = '22023';
  end if;

  update public.lh_leads l set
    name = case when p_patch ? 'name' then nullif(left(trim(p_patch ->> 'name'), 120), '') else l.name end,
    phone = case when p_patch ? 'phone' then nullif(left(trim(p_patch ->> 'phone'), 40), '') else l.phone end,
    status = v_status,
    lost_reason = case when v_status = 'perdido' then v_reason else null end,
    notes = case when p_patch ? 'notes' then nullif(left(p_patch ->> 'notes', 2000), '') else l.notes end,
    sale_value = case when p_patch ? 'sale_value' then (nullif(p_patch ->> 'sale_value', ''))::numeric else l.sale_value end,
    next_contact_at = case when p_patch ? 'next_contact_at' then (nullif(p_patch ->> 'next_contact_at', ''))::timestamptz else l.next_contact_at end,
    extra = v_extra,
    stage = v_stage,
    color = v_color,
    -- Leaving "novo" means someone has talked to the lead.
    first_contact_at = case when l.first_contact_at is null and v_status <> 'novo' then now() else l.first_contact_at end,
    updated_at = now()
  where l.id = p_lead_id
  returning * into v_lead;

  return lh_private.lead_json(v_lead);
end;
$$;

create or replace function lh_private.track_lead_changes()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_actor text := coalesce(nullif(current_setting('lh.actor', true), ''), 'sistema');
  v_money text;
begin
  if tg_op = 'INSERT' then
    insert into public.lh_lead_history (lead_id, workspace_id, type, to_value, actor)
    values (new.id, new.workspace_id, 'created',
            case new.source
              when 'manual' then 'Adicionado à mão'
              when 'meta_form' then 'Formulário da Meta'
              when 'sheets' then 'Planilha'
              else 'Clique no WhatsApp'
            end,
            case new.source when 'manual' then v_actor when 'lp' then 'lp' else 'sistema' end);
    return new;
  end if;

  if new.clicks > old.clicks then
    insert into public.lh_lead_history (lead_id, workspace_id, type, to_value, actor)
    values (new.id, new.workspace_id, 'click', new.clicks::text, 'lp');
  end if;
  if new.status is distinct from old.status then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'status', old.status,
            new.status || coalesce(' · ' || new.lost_reason, ''), v_actor);
  end if;
  if new.phone is distinct from old.phone then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'phone', old.phone, new.phone,
            case when v_actor = 'sistema' then 'lp' else v_actor end);
  end if;
  if new.name is distinct from old.name then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'name', old.name, new.name,
            case when v_actor = 'sistema' then 'lp' else v_actor end);
  end if;
  if new.notes is distinct from old.notes then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'note', old.notes, new.notes, v_actor);
  end if;
  if new.sale_value is distinct from old.sale_value then
    v_money := new.sale_value::text;
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'sale_value', old.sale_value::text, v_money, v_actor);
  end if;
  if new.next_contact_at is distinct from old.next_contact_at then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'next_contact', old.next_contact_at::text, new.next_contact_at::text, v_actor);
  end if;
  if new.stage is distinct from old.stage then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'stage', old.stage, new.stage, v_actor);
  end if;
  if new.color is distinct from old.color then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    values (new.id, new.workspace_id, 'color', old.color, new.color, v_actor);
  end if;
  -- Columns filled in by people (from_value = column, to_value = new value).
  if new.extra is distinct from old.extra and v_actor in ('atendente', 'admin') then
    insert into public.lh_lead_history (lead_id, workspace_id, type, from_value, to_value, actor)
    select new.id, new.workspace_id, 'field', k.key, new.extra ->> k.key, v_actor
    from (
      select jsonb_object_keys(coalesce(new.extra, '{}'::jsonb)) as key
      union
      select jsonb_object_keys(coalesce(old.extra, '{}'::jsonb))
    ) k
    where (new.extra ->> k.key) is distinct from (old.extra ->> k.key);
  end if;
  return new;
end;
$$;

drop function public.lh_list_leads(text, timestamptz, text, text, text, integer, integer, timestamptz, text);

create function public.lh_list_leads(p_token text, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone, p_status text DEFAULT NULL::text, p_channel text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200, p_offset integer DEFAULT 0, p_until timestamp with time zone DEFAULT NULL::timestamp with time zone, p_source text DEFAULT NULL::text, p_stage text DEFAULT NULL::text, p_color text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_result jsonb;
begin
  with filtered as (
    select l.* from public.lh_leads l
    where l.workspace_id = v_workspace
      and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
      and (p_status is null or l.status = p_status)
      and (p_channel is null or l.channel = p_channel)
      and (p_source is null or l.source = p_source)
      and (p_stage is null or l.stage is not distinct from nullif(p_stage, '-'))
      and (p_color is null or l.color is not distinct from nullif(p_color, '-'))
      and (
        v_search is null
        or l.name ilike '%' || v_search || '%'
        or l.phone ilike '%' || v_search || '%'
        or l.code ilike v_search
        or l.utm_campaign ilike '%' || v_search || '%'
        or l.notes ilike '%' || v_search || '%'
      )
  )
  select jsonb_build_object(
    'total', (select count(*) from filtered),
    'rows', coalesce((
      select jsonb_agg(lh_private.lead_json(f) order by f.created_at desc)
      from (
        select * from filtered order by created_at desc
        limit least(greatest(p_limit, 1), 1000) offset greatest(p_offset, 0)
      ) f
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$function$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_set_stages(text, jsonb)',
    'lh_sheet_config(text)',
    'lh_update_lead(text, uuid, jsonb)',
    'lh_list_leads(text, timestamptz, text, text, text, integer, integer, timestamptz, text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
