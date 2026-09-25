-- Lead Hub: tools for attendants and conversions back to Meta.
--
-- - Queue: leads waiting for a first contact (with the time since the click)
--   and follow-ups due today or overdue (next_contact_at).
-- - Ready-made WhatsApp messages per client (lh_templates). Sending one
--   records the first contact and moves a new lead to "em_atendimento".
-- - Lost reason required when a lead is marked "perdido".
-- - History of every lead (lh_lead_history), written by a trigger so no
--   change escapes it, whoever makes it (page, attendant, admin, system).
-- - Push notifications for new leads (lh_push_subscriptions).
-- - Meta Conversions API settings and delivery log (lh_meta_configs,
--   lh_meta_events). The access token never leaves the database except to
--   the app's server, which proves itself with a server secret.
-- - Metrics: median time to first contact and lost reasons.

-- ---------------------------------------------------------------------------
-- Columns and tables
-- ---------------------------------------------------------------------------

alter table public.lh_leads
  add column first_contact_at timestamptz,
  add column next_contact_at timestamptz,
  add column lost_reason text;

create index lh_leads_next_contact_idx on public.lh_leads (workspace_id, next_contact_at)
  where next_contact_at is not null;
create index lh_leads_status_idx on public.lh_leads (workspace_id, status, created_at);

create table public.lh_lead_history (
  id bigint generated always as identity primary key,
  lead_id uuid not null references public.lh_leads (id) on delete cascade,
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  type text not null,
  from_value text,
  to_value text,
  -- 'lp', 'atendente', 'admin' or 'sistema'.
  actor text not null default 'sistema',
  created_at timestamptz not null default now()
);

create index lh_lead_history_lead_idx on public.lh_lead_history (lead_id, created_at);

create table public.lh_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  body text not null check (char_length(body) between 1 and 1000),
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index lh_templates_workspace_idx on public.lh_templates (workspace_id, position);

create table public.lh_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create table public.lh_meta_configs (
  workspace_id uuid primary key references public.lh_workspaces (id) on delete cascade,
  pixel_id text not null check (pixel_id ~ '^[0-9]{5,30}$'),
  access_token text not null,
  test_event_code text,
  enabled boolean not null default false,
  send_schedule boolean not null default true,
  send_purchase boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.lh_meta_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.lh_workspaces (id) on delete cascade,
  lead_id uuid references public.lh_leads (id) on delete cascade,
  event_name text not null,
  event_id text not null,
  ok boolean not null,
  test boolean not null default false,
  response text,
  created_at timestamptz not null default now()
);

create index lh_meta_events_lead_idx on public.lh_meta_events (lead_id, created_at);

-- Only the hash of the app server's secret, used by lh_server_* functions.
create table lh_private.server_keys (
  key_hash text primary key,
  created_at timestamptz not null default now()
);

alter table public.lh_lead_history enable row level security;
alter table public.lh_templates enable row level security;
alter table public.lh_push_subscriptions enable row level security;
alter table public.lh_meta_configs enable row level security;
alter table public.lh_meta_events enable row level security;
revoke all on public.lh_lead_history, public.lh_templates, public.lh_push_subscriptions,
  public.lh_meta_configs, public.lh_meta_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function lh_private.session_role(p_token text)
returns text
language sql
stable
set search_path = ''
as $$
  select s.role from public.lh_sessions s
  where s.token_hash = lh_private.sha256(coalesce(p_token, '')) and s.expires_at > now()
$$;

-- Tags the changes made in this transaction for the history trigger.
create or replace function lh_private.set_actor(p_actor text)
returns void
language sql
set search_path = ''
as $$
  select set_config('lh.actor', p_actor, true)
$$;

create or replace function lh_private.check_server(p_secret text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if not exists (select 1 from lh_private.server_keys where key_hash = lh_private.sha256(coalesce(p_secret, ''))) then
    raise exception 'invalid server secret' using errcode = 'LH401';
  end if;
end;
$$;

-- Setup from SQL: select lh_private.set_server_secret('<secret>');
create or replace function lh_private.set_server_secret(p_secret text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if char_length(coalesce(p_secret, '')) < 32 then
    raise exception 'server secret must have at least 32 characters';
  end if;
  delete from lh_private.server_keys;
  insert into lh_private.server_keys (key_hash) values (lh_private.sha256(p_secret));
end;
$$;

create or replace function lh_private.seed_templates(p_workspace_id uuid)
returns void
language sql
set search_path = ''
as $$
  insert into public.lh_templates (workspace_id, name, body, position) values
    (p_workspace_id, 'Primeiro contato',
     'Olá, {nome}! Aqui é da equipe {empresa}. Recebemos seu contato pelo site e vou te ajudar. Posso te fazer algumas perguntas rápidas?', 1),
    (p_workspace_id, 'Confirmar avaliação',
     'Olá, {nome}! Passando para confirmar seu horário conosco. Podemos manter o combinado?', 2),
    (p_workspace_id, 'Retorno',
     'Oi, {nome}! Tudo bem? Estou retomando nossa conversa. Ficou alguma dúvida em que eu possa ajudar?', 3)
$$;

create or replace function lh_private.after_workspace_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform lh_private.seed_templates(new.id);
  return new;
end;
$$;

create trigger lh_workspaces_seed_templates
  after insert on public.lh_workspaces
  for each row execute function lh_private.after_workspace_insert();

select lh_private.seed_templates(w.id) from public.lh_workspaces w
where not exists (select 1 from public.lh_templates t where t.workspace_id = w.id);

-- ---------------------------------------------------------------------------
-- History trigger
-- ---------------------------------------------------------------------------

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
            case new.source when 'manual' then 'Adicionado à mão' else 'Clique no WhatsApp' end,
            case new.source when 'manual' then v_actor else 'lp' end);
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
  return new;
end;
$$;

create trigger lh_leads_history
  after insert or update on public.lh_leads
  for each row execute function lh_private.track_lead_changes();

-- ---------------------------------------------------------------------------
-- Panel: editing with lost reason, follow-up date and first contact
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

  update public.lh_leads l set
    name = case when p_patch ? 'name' then nullif(left(trim(p_patch ->> 'name'), 120), '') else l.name end,
    phone = case when p_patch ? 'phone' then nullif(left(trim(p_patch ->> 'phone'), 40), '') else l.phone end,
    status = v_status,
    lost_reason = case when v_status = 'perdido' then v_reason else null end,
    notes = case when p_patch ? 'notes' then nullif(left(p_patch ->> 'notes', 2000), '') else l.notes end,
    sale_value = case when p_patch ? 'sale_value' then (nullif(p_patch ->> 'sale_value', ''))::numeric else l.sale_value end,
    next_contact_at = case when p_patch ? 'next_contact_at' then (nullif(p_patch ->> 'next_contact_at', ''))::timestamptz else l.next_contact_at end,
    -- Leaving "novo" means someone has talked to the lead.
    first_contact_at = case when l.first_contact_at is null and v_status <> 'novo' then now() else l.first_contact_at end,
    updated_at = now()
  where l.id = p_lead_id
  returning * into v_lead;

  return lh_private.lead_json(v_lead);
end;
$$;

create or replace function public.lh_create_lead(p_token text, p_name text, p_phone text, p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_lead public.lh_leads;
begin
  perform lh_private.set_actor(lh_private.session_role(p_token));
  insert into public.lh_leads (workspace_id, source, code, name, phone, notes, channel)
  values (
    v_workspace, 'manual', lh_private.random_code(),
    nullif(left(trim(p_name), 120), ''), nullif(left(trim(p_phone), 40), ''),
    nullif(left(p_notes, 2000), ''), 'whatsapp_direto'
  )
  returning * into v_lead;
  return lh_private.lead_json(v_lead);
end;
$$;

/** A message was sent from a template: first contact, and "novo" becomes "em_atendimento". */
create or replace function public.lh_log_contact(p_token text, p_lead_id uuid, p_template text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_role text := lh_private.session_role(p_token);
  v_lead public.lh_leads;
begin
  perform lh_private.set_actor(v_role);
  update public.lh_leads l set
    first_contact_at = coalesce(l.first_contact_at, now()),
    status = case when l.status = 'novo' then 'em_atendimento' else l.status end,
    updated_at = now()
  where l.id = p_lead_id and l.workspace_id = v_workspace
  returning * into v_lead;
  if not found then
    raise exception 'lead not found' using errcode = 'LH404';
  end if;
  insert into public.lh_lead_history (lead_id, workspace_id, type, to_value, actor)
  values (v_lead.id, v_workspace, 'message', left(coalesce(p_template, 'WhatsApp'), 60), v_role);
  return lh_private.lead_json(v_lead);
end;
$$;

create or replace function public.lh_lead_detail(p_token text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_lead public.lh_leads;
begin
  select * into v_lead from public.lh_leads where id = p_lead_id and workspace_id = v_workspace;
  if not found then
    raise exception 'lead not found' using errcode = 'LH404';
  end if;
  return jsonb_build_object(
    'lead', lh_private.lead_json(v_lead),
    'history', coalesce((
      select jsonb_agg(jsonb_build_object(
        'type', h.type, 'from', h.from_value, 'to', h.to_value, 'actor', h.actor, 'at', h.created_at
      ) order by h.created_at, h.id)
      from public.lh_lead_history h where h.lead_id = v_lead.id
    ), '[]'::jsonb),
    'meta', coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', m.event_name, 'ok', m.ok, 'test', m.test, 'at', m.created_at
      ) order by m.created_at)
      from public.lh_meta_events m where m.lead_id = v_lead.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Leads waiting for a first contact (oldest first) and follow-ups due.
create or replace function public.lh_queue(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
  v_today_end timestamptz := (date_trunc('day', now() at time zone 'America/Sao_Paulo') + interval '1 day')
                              at time zone 'America/Sao_Paulo';
begin
  return jsonb_build_object(
    'waiting', coalesce((
      select jsonb_agg(lh_private.lead_json(l) order by l.created_at)
      from (select * from public.lh_leads
            where workspace_id = v_workspace and status = 'novo'
            order by created_at limit 200) l
    ), '[]'::jsonb),
    'overdue', coalesce((
      select jsonb_agg(lh_private.lead_json(l) order by l.next_contact_at)
      from public.lh_leads l
      where l.workspace_id = v_workspace and l.next_contact_at < now()
        and l.status not in ('venda', 'perdido')
    ), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(lh_private.lead_json(l) order by l.next_contact_at)
      from public.lh_leads l
      where l.workspace_id = v_workspace and l.next_contact_at >= now() and l.next_contact_at < v_today_end
        and l.status not in ('venda', 'perdido')
    ), '[]'::jsonb)
  );
end;
$$;

-- Counts for the navigation badge and the new-lead sound, cheap enough to poll.
create or replace function public.lh_queue_count(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'waiting', count(*) filter (where l.status = 'novo'),
    'due', count(*) filter (where l.next_contact_at < now() and l.status not in ('venda', 'perdido')),
    'latest', max(l.created_at)
  )
  from public.lh_leads l
  where l.workspace_id = lh_private.workspace_for(p_token)
$$;

-- ---------------------------------------------------------------------------
-- Templates
-- ---------------------------------------------------------------------------

create or replace function public.lh_list_templates(p_token text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'body', t.body, 'position', t.position)
                            order by t.position, t.created_at), '[]'::jsonb)
  from public.lh_templates t
  where t.workspace_id = lh_private.workspace_for(p_token)
$$;

create or replace function lh_private.require_admin_session(p_token text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
begin
  if lh_private.session_role(p_token) <> 'admin' then
    raise exception 'only admins can change this' using errcode = 'LH403';
  end if;
  return v_workspace;
end;
$$;

create or replace function public.lh_save_template(p_token text, p_id uuid, p_name text, p_body text, p_position int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.require_admin_session(p_token);
  v_template public.lh_templates;
begin
  if p_id is null then
    insert into public.lh_templates (workspace_id, name, body, position)
    values (v_workspace, trim(p_name), trim(p_body), coalesce(p_position, 99))
    returning * into v_template;
  else
    update public.lh_templates
    set name = trim(p_name), body = trim(p_body), position = coalesce(p_position, position)
    where id = p_id and workspace_id = v_workspace
    returning * into v_template;
    if not found then
      raise exception 'template not found' using errcode = 'LH404';
    end if;
  end if;
  return jsonb_build_object('id', v_template.id, 'name', v_template.name, 'body', v_template.body, 'position', v_template.position);
end;
$$;

create or replace function public.lh_delete_template(p_token text, p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.lh_templates where id = p_id and workspace_id = lh_private.require_admin_session(p_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- Push notifications
-- ---------------------------------------------------------------------------

create or replace function public.lh_push_subscribe(p_token text, p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
begin
  insert into public.lh_push_subscriptions (workspace_id, endpoint, p256dh, auth)
  values (v_workspace, left(p_endpoint, 1000), left(p_p256dh, 200), left(p_auth, 100))
  on conflict (endpoint) do update
    set workspace_id = excluded.workspace_id, p256dh = excluded.p256dh, auth = excluded.auth;
end;
$$;

create or replace function public.lh_push_unsubscribe(p_token text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.lh_push_subscriptions
  where endpoint = p_endpoint and workspace_id = lh_private.workspace_for(p_token);
end;
$$;

-- ---------------------------------------------------------------------------
-- Server-only functions (the app's server proves itself with its secret)
-- ---------------------------------------------------------------------------

/** Who to notify about a new lead, and what to say. */
create or replace function public.lh_server_new_lead_push(p_secret text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.lh_leads;
  v_slug text;
begin
  perform lh_private.check_server(p_secret);
  select * into v_lead from public.lh_leads where id = p_lead_id;
  if not found then
    return null;
  end if;
  select slug into v_slug from public.lh_workspaces where id = v_lead.workspace_id;
  return jsonb_build_object(
    'slug', v_slug,
    'lead', jsonb_build_object(
      'code', v_lead.code, 'name', v_lead.name, 'channel', v_lead.channel,
      'ad', coalesce(v_lead.ad_name, v_lead.utm_content), 'campaign', coalesce(v_lead.campaign_name, v_lead.utm_campaign)
    ),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
      from public.lh_push_subscriptions s where s.workspace_id = v_lead.workspace_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.lh_server_push_gone(p_secret text, p_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  delete from public.lh_push_subscriptions where endpoint = p_endpoint;
end;
$$;

/** Everything needed to send a lead's conversions to Meta, or null when not configured. */
create or replace function public.lh_server_meta_payload(p_secret text, p_lead_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.lh_leads;
  v_config public.lh_meta_configs;
begin
  perform lh_private.check_server(p_secret);
  select * into v_lead from public.lh_leads where id = p_lead_id;
  if not found then
    return null;
  end if;
  select * into v_config from public.lh_meta_configs where workspace_id = v_lead.workspace_id and enabled;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'config', jsonb_build_object(
      'pixel_id', v_config.pixel_id, 'access_token', v_config.access_token,
      'test_event_code', v_config.test_event_code,
      'send_schedule', v_config.send_schedule, 'send_purchase', v_config.send_purchase
    ),
    'lead', to_jsonb(v_lead),
    'sent', coalesce((
      select jsonb_agg(distinct m.event_name) from public.lh_meta_events m
      where m.lead_id = v_lead.id and m.ok and not m.test
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.lh_server_meta_config(p_secret text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lh_meta_configs;
begin
  perform lh_private.check_server(p_secret);
  select * into v_config from public.lh_meta_configs where workspace_id = p_workspace_id;
  if not found then
    return null;
  end if;
  return to_jsonb(v_config);
end;
$$;

create or replace function public.lh_server_meta_log(
  p_secret text,
  p_workspace_id uuid,
  p_lead_id uuid,
  p_event_name text,
  p_event_id text,
  p_ok boolean,
  p_test boolean,
  p_response text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  insert into public.lh_meta_events (workspace_id, lead_id, event_name, event_id, ok, test, response)
  values (p_workspace_id, p_lead_id, left(p_event_name, 60), left(p_event_id, 200), p_ok, coalesce(p_test, false), left(p_response, 2000));
  if p_lead_id is not null then
    insert into public.lh_lead_history (lead_id, workspace_id, type, to_value, actor)
    values (p_lead_id, p_workspace_id, 'meta', p_event_name || case when p_ok then ' enviado' else ' falhou' end, 'sistema');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admin: Meta settings (the token is write-only from the panel)
-- ---------------------------------------------------------------------------

create or replace function public.lh_admin_get_meta(p_token text, p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_config public.lh_meta_configs;
begin
  perform lh_private.admin_for(p_token);
  select * into v_config from public.lh_meta_configs where workspace_id = p_workspace_id;
  return jsonb_build_object(
    'configured', found,
    'pixel_id', v_config.pixel_id,
    'token_hint', case when found then '••••' || right(v_config.access_token, 4) end,
    'test_event_code', v_config.test_event_code,
    'enabled', coalesce(v_config.enabled, false),
    'send_schedule', coalesce(v_config.send_schedule, true),
    'send_purchase', coalesce(v_config.send_purchase, true),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('event', m.event_name, 'ok', m.ok, 'test', m.test, 'at', m.created_at, 'response', m.response)
                       order by m.created_at desc)
      from (select * from public.lh_meta_events where workspace_id = p_workspace_id order by created_at desc limit 10) m
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.lh_admin_set_meta(
  p_token text,
  p_workspace_id uuid,
  p_pixel_id text,
  p_access_token text,
  p_test_event_code text,
  p_enabled boolean,
  p_send_schedule boolean,
  p_send_purchase boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := nullif(trim(coalesce(p_access_token, '')), '');
begin
  perform lh_private.admin_for(p_token);
  if v_token is null and not exists (select 1 from public.lh_meta_configs where workspace_id = p_workspace_id) then
    raise exception 'access token is required' using errcode = '22023';
  end if;
  insert into public.lh_meta_configs as c (workspace_id, pixel_id, access_token, test_event_code, enabled, send_schedule, send_purchase)
  values (p_workspace_id, trim(p_pixel_id), coalesce(v_token, ''), nullif(trim(coalesce(p_test_event_code, '')), ''),
          coalesce(p_enabled, false), coalesce(p_send_schedule, true), coalesce(p_send_purchase, true))
  on conflict (workspace_id) do update set
    pixel_id = excluded.pixel_id,
    access_token = coalesce(v_token, c.access_token),
    test_event_code = excluded.test_event_code,
    enabled = excluded.enabled,
    send_schedule = excluded.send_schedule,
    send_purchase = excluded.send_purchase,
    updated_at = now();
end;
$$;

-- ---------------------------------------------------------------------------
-- Metrics: add time to first contact and lost reasons
-- ---------------------------------------------------------------------------

create or replace function public.lh_attendance_metrics(p_token text, p_since timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid := lh_private.workspace_for(p_token);
begin
  return jsonb_build_object(
    'first_contact_median_min', (
      select round((percentile_cont(0.5) within group (
        order by extract(epoch from (l.first_contact_at - l.created_at)) / 60))::numeric, 1)
      from public.lh_leads l
      where l.workspace_id = v_workspace and l.first_contact_at is not null
        and (p_since is null or l.created_at >= p_since)
    ),
    'contacted', (
      select count(*) from public.lh_leads l
      where l.workspace_id = v_workspace and l.first_contact_at is not null
        and (p_since is null or l.created_at >= p_since)
    ),
    'within_5_min', (
      select count(*) from public.lh_leads l
      where l.workspace_id = v_workspace and l.first_contact_at is not null
        and l.first_contact_at - l.created_at <= interval '5 minutes'
        and (p_since is null or l.created_at >= p_since)
    ),
    'waiting', (
      select count(*) from public.lh_leads l
      where l.workspace_id = v_workspace and l.status = 'novo'
    ),
    'lost_reasons', coalesce((
      select jsonb_agg(jsonb_build_object('reason', r.reason, 'count', r.n) order by r.n desc)
      from (
        select coalesce(l.lost_reason, 'Não informado') as reason, count(*) as n
        from public.lh_leads l
        where l.workspace_id = v_workspace and l.status = 'perdido'
          and (p_since is null or l.created_at >= p_since)
        group by 1
      ) r
    ), '[]'::jsonb)
  );
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
    'lh_update_lead(text, uuid, jsonb)',
    'lh_create_lead(text, text, text, text)',
    'lh_log_contact(text, uuid, text)',
    'lh_lead_detail(text, uuid)',
    'lh_queue(text)',
    'lh_queue_count(text)',
    'lh_list_templates(text)',
    'lh_save_template(text, uuid, text, text, int)',
    'lh_delete_template(text, uuid)',
    'lh_push_subscribe(text, text, text, text)',
    'lh_push_unsubscribe(text, text)',
    'lh_server_new_lead_push(text, uuid)',
    'lh_server_push_gone(text, text)',
    'lh_server_meta_payload(text, uuid)',
    'lh_server_meta_config(text, uuid)',
    'lh_server_meta_log(text, uuid, uuid, text, text, boolean, boolean, text)',
    'lh_admin_get_meta(text, uuid)',
    'lh_admin_set_meta(text, uuid, text, text, text, boolean, boolean, boolean)',
    'lh_attendance_metrics(text, timestamptz)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
