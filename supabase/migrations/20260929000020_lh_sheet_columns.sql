-- Lead Hub: the answers of forms and quizzes become columns of the sheet.
--
-- - Each client has its own column settings (lh_workspaces.sheet_columns):
--   answers can be renamed, hidden and reordered; the standard columns can be
--   hidden; new columns can be added for the attendants to fill in (stored in
--   lh_leads.extra, like the answers). Only a panel admin changes them.
-- - Answers found in the client's recent leads show up by themselves.
-- - Metrics: leads, bookings and sales by the answer to one question.
-- - History: changes to the added columns are recorded, and leads from forms
--   and sheets say where they came from.

alter table public.lh_workspaces add column sheet_columns jsonb not null default '[]'::jsonb
  check (jsonb_typeof(sheet_columns) = 'array' and pg_column_size(sheet_columns) <= 32768);

-- ---------------------------------------------------------------------------
-- Column settings
-- ---------------------------------------------------------------------------

/** The client's column settings and the answers found in its recent leads. */
create or replace function public.lh_sheet_config(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
begin
  return jsonb_build_object(
    'columns', (select w.sheet_columns from public.lh_workspaces w where w.id = v_workspace),
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

/** Saves the column settings (panel admin only). Returns what was stored. */
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
      or (v_kind = 'fixed' and v_key not in ('lp_events', 'origin', 'campaign', 'adset', 'ad', 'page', 'device', 'clicks', 'notes'))
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

-- ---------------------------------------------------------------------------
-- Editing: the added columns are filled in like the other cells
-- ---------------------------------------------------------------------------

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

  update public.lh_leads l set
    name = case when p_patch ? 'name' then nullif(left(trim(p_patch ->> 'name'), 120), '') else l.name end,
    phone = case when p_patch ? 'phone' then nullif(left(trim(p_patch ->> 'phone'), 40), '') else l.phone end,
    status = v_status,
    lost_reason = case when v_status = 'perdido' then v_reason else null end,
    notes = case when p_patch ? 'notes' then nullif(left(p_patch ->> 'notes', 2000), '') else l.notes end,
    sale_value = case when p_patch ? 'sale_value' then (nullif(p_patch ->> 'sale_value', ''))::numeric else l.sale_value end,
    next_contact_at = case when p_patch ? 'next_contact_at' then (nullif(p_patch ->> 'next_contact_at', ''))::timestamptz else l.next_contact_at end,
    extra = v_extra,
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

-- ---------------------------------------------------------------------------
-- Metrics by answer
-- ---------------------------------------------------------------------------

/** Leads of the period grouped by the answer to one question (or added column). */
create or replace function public.lh_answer_metrics(p_token text, p_key text, p_since timestamptz default null, p_until timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
begin
  return coalesce((
    select jsonb_agg(to_jsonb(a) order by a.leads desc, a.value)
    from (
      select coalesce(nullif(trim(l.extra ->> p_key), ''), '') as value,
        count(*)::int as leads,
        count(*) filter (where l.phone is not null)::int as with_phone,
        count(*) filter (where l.status in ('agendado', 'venda'))::int as scheduled,
        count(*) filter (where l.status = 'venda')::int as sales,
        coalesce(sum(l.sale_value) filter (where l.status = 'venda'), 0) as revenue
      from public.lh_leads l
      where l.workspace_id = v_workspace
        and (p_since is null or l.created_at >= p_since) and (p_until is null or l.created_at < p_until)
      group by 1
      order by 2 desc, 1
      limit 50
    ) a
  ), '[]'::jsonb);
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_sheet_config(text)',
    'lh_set_sheet_columns(text, jsonb)',
    'lh_update_lead(text, uuid, jsonb)',
    'lh_answer_metrics(text, text, timestamptz, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
