-- Lead Hub: capture configuration, leads, pipeline, history and outbox
-- (blueprint §5, §6.4, §7, §9, Appendix A).

-- ---------------------------------------------------------------------------
-- Capture configuration
-- ---------------------------------------------------------------------------

-- A landing page authorises one or more hostnames to post leads into a
-- project with its public key (§5.1). The public key only grants ingestion.
create table leadhub.landing_pages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  domains text[] not null check (cardinality(domains) between 1 and 20),
  public_key text not null unique
    default 'pk_live_' || replace(gen_random_uuid()::text, '-', ''),
  status text not null default 'active' check (status in ('active', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade
);

create index landing_pages_project_idx on leadhub.landing_pages (project_id);

create table leadhub.forms (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  -- Public identifier used by the SDK and API, e.g. "frm_transplante".
  key text not null check (key ~ '^frm_[a-z0-9_]{1,60}$'),
  fields jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, key),
  unique (project_id, id),
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade
);

-- Server-to-server secret keys (§8.1). Only a SHA-256 hash is stored; the
-- plaintext is shown once when the key is created.
create table leadhub.project_api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text not null check (char_length(name) between 1 and 120),
  key_prefix text not null,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade
);

create index project_api_keys_project_idx on leadhub.project_api_keys (project_id);

-- ---------------------------------------------------------------------------
-- Pipeline (§9.1)
-- ---------------------------------------------------------------------------

create table leadhub.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null unique,
  name text not null default 'Pipeline',
  created_at timestamptz not null default now(),
  unique (project_id, id),
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade
);

create table leadhub.pipeline_stages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  pipeline_id uuid not null,
  key text not null check (key ~ '^[a-z0-9_]{1,40}$'),
  name text not null check (char_length(name) between 1 and 60),
  position int not null,
  -- won/lost are logical terminal states; leads can still be reopened (§9.1).
  kind text not null default 'open' check (kind in ('open', 'won', 'lost')),
  -- Canonical event emitted when a lead enters this stage (§9.2), if any.
  event_type text check (event_type in ('lead.qualified', 'lead.scheduled', 'lead.won', 'lead.lost')),
  created_at timestamptz not null default now(),
  unique (pipeline_id, key),
  unique (pipeline_id, position) deferrable initially deferred,
  unique (project_id, id),
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade,
  foreign key (project_id, pipeline_id) references leadhub.pipelines (project_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Leads and conversions (§6.4, §7)
-- ---------------------------------------------------------------------------

create table leadhub.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  name text,
  phone text,
  phone_norm text,
  email text,
  email_norm text,
  current_stage_id uuid,
  owner_id uuid references auth.users (id) on delete set null,
  estimated_value numeric(14, 2),
  sale_value numeric(14, 2),
  currency char(3) not null default 'BRL',
  lost_reason text,
  -- Set when phone and e-mail point at different people (§6.4).
  needs_review boolean not null default false,
  first_touch jsonb not null default '{}'::jsonb,
  last_touch jsonb not null default '{}'::jsonb,
  source_channel text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade,
  foreign key (project_id, current_stage_id) references leadhub.pipeline_stages (project_id, id)
);

create index leads_workspace_created_idx on leadhub.leads (workspace_id, created_at desc);
create index leads_project_created_idx on leadhub.leads (project_id, created_at desc);
create index leads_stage_idx on leadhub.leads (current_stage_id);
create index leads_owner_idx on leadhub.leads (owner_id) where owner_id is not null;
-- Phone is the preferred identity within a project; unique so concurrent
-- submissions cannot create two people for the same number.
create unique index leads_project_phone_uidx on leadhub.leads (project_id, phone_norm)
  where phone_norm is not null;
create index leads_project_email_idx on leadhub.leads (project_id, email_norm)
  where email_norm is not null;

create trigger leads_updated_at before update on leadhub.leads
  for each row execute function leadhub_private.set_updated_at();
create trigger landing_pages_updated_at before update on leadhub.landing_pages
  for each row execute function leadhub_private.set_updated_at();
create trigger forms_updated_at before update on leadhub.forms
  for each row execute function leadhub_private.set_updated_at();

create table leadhub.lead_conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  lead_id uuid not null references leadhub.leads (id) on delete cascade,
  form_id uuid,
  landing_page_id uuid references leadhub.landing_pages (id) on delete set null,
  session_id text,
  idempotency_key text,
  -- Hash of the normalised request, to tell a replay from a key collision.
  request_hash text,
  source_channel text,
  answers jsonb not null default '{}'::jsonb,
  tracking jsonb not null default '{}'::jsonb,
  consent jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, idempotency_key),
  foreign key (workspace_id, project_id) references leadhub.projects (workspace_id, id) on delete cascade,
  foreign key (project_id, form_id) references leadhub.forms (project_id, id) on delete set null (form_id)
);

create index lead_conversions_lead_idx on leadhub.lead_conversions (lead_id, created_at desc);
create index lead_conversions_workspace_idx on leadhub.lead_conversions (workspace_id, created_at desc);

-- Answers flattened for filtering and reporting; the raw object stays on the
-- conversion.
create table leadhub.lead_answers (
  conversion_id uuid not null references leadhub.lead_conversions (id) on delete cascade,
  workspace_id uuid not null references leadhub.workspaces (id) on delete cascade,
  lead_id uuid not null references leadhub.leads (id) on delete cascade,
  field_key text not null,
  value text,
  primary key (conversion_id, field_key)
);

create index lead_answers_lead_idx on leadhub.lead_answers (lead_id);

-- Append-only: no update/delete policies and no grants for them.
create table leadhub.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references leadhub.workspaces (id) on delete cascade,
  lead_id uuid not null references leadhub.leads (id) on delete cascade,
  from_stage_id uuid references leadhub.pipeline_stages (id) on delete set null,
  to_stage_id uuid references leadhub.pipeline_stages (id) on delete set null,
  changed_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lead_stage_history_lead_idx on leadhub.lead_stage_history (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Outbox (§9.3). Written in the same transaction as the change it describes.
-- ---------------------------------------------------------------------------

create table leadhub.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references leadhub.workspaces (id) on delete cascade,
  project_id uuid references leadhub.projects (id) on delete cascade,
  event_key text not null unique,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  payload jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'retry', 'dead')),
  available_at timestamptz not null default now(),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index outbox_events_pending_idx on leadhub.outbox_events (available_at)
  where status in ('pending', 'retry');
create index outbox_events_aggregate_idx on leadhub.outbox_events (aggregate_type, aggregate_id);

create trigger outbox_events_updated_at before update on leadhub.outbox_events
  for each row execute function leadhub_private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Every new project gets the default pipeline (§9.1)
-- ---------------------------------------------------------------------------

create or replace function leadhub_private.create_default_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline_id uuid;
begin
  insert into leadhub.pipelines (workspace_id, project_id)
  values (new.workspace_id, new.id)
  returning id into v_pipeline_id;

  insert into leadhub.pipeline_stages
    (workspace_id, project_id, pipeline_id, key, name, position, kind, event_type)
  values
    (new.workspace_id, new.id, v_pipeline_id, 'new',       'Novo',        1, 'open', null),
    (new.workspace_id, new.id, v_pipeline_id, 'contacted', 'Contatado',   2, 'open', null),
    (new.workspace_id, new.id, v_pipeline_id, 'qualified', 'Qualificado', 3, 'open', 'lead.qualified'),
    (new.workspace_id, new.id, v_pipeline_id, 'scheduled', 'Agendado',    4, 'open', 'lead.scheduled'),
    (new.workspace_id, new.id, v_pipeline_id, 'won',       'Venda',       5, 'won',  'lead.won'),
    (new.workspace_id, new.id, v_pipeline_id, 'lost',      'Perdido',     6, 'lost', 'lead.lost');

  return new;
end;
$$;

create trigger projects_default_pipeline
  after insert on leadhub.projects
  for each row execute function leadhub_private.create_default_pipeline();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table leadhub.landing_pages enable row level security;
alter table leadhub.forms enable row level security;
alter table leadhub.project_api_keys enable row level security;
alter table leadhub.pipelines enable row level security;
alter table leadhub.pipeline_stages enable row level security;
alter table leadhub.leads enable row level security;
alter table leadhub.lead_conversions enable row level security;
alter table leadhub.lead_answers enable row level security;
alter table leadhub.lead_stage_history enable row level security;
alter table leadhub.outbox_events enable row level security;

-- §14.2: the browser SDK never touches these tables directly.
revoke all on
  leadhub.landing_pages, leadhub.forms, leadhub.project_api_keys, leadhub.pipelines,
  leadhub.pipeline_stages, leadhub.leads, leadhub.lead_conversions, leadhub.lead_answers,
  leadhub.lead_stage_history, leadhub.outbox_events
from anon;

-- Stage changes, history and outbox rows are only written by the functions
-- below, so the API role gets read access plus a narrow set of writes.
revoke insert, update, delete, truncate on
  leadhub.lead_conversions, leadhub.lead_answers, leadhub.lead_stage_history, leadhub.outbox_events
from authenticated;
revoke insert, update, delete, truncate on leadhub.leads from authenticated;
grant update (name, owner_id, estimated_value) on leadhub.leads to authenticated;
revoke update, truncate on leadhub.project_api_keys from authenticated;
grant update (name, revoked_at) on leadhub.project_api_keys to authenticated;
revoke truncate on
  leadhub.landing_pages, leadhub.forms, leadhub.pipelines, leadhub.pipeline_stages
from authenticated;

-- Configuration: readable by members, managed by admins and managers.
create policy "landing_pages: members read" on leadhub.landing_pages
  for select to authenticated using (leadhub_private.is_member(workspace_id));
create policy "landing_pages: managers write" on leadhub.landing_pages
  for all to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin', 'manager']))
  with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

create policy "forms: members read" on leadhub.forms
  for select to authenticated using (leadhub_private.is_member(workspace_id));
create policy "forms: managers write" on leadhub.forms
  for all to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin', 'manager']))
  with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

-- §4.3: credentials are visible to admins and managers only.
create policy "api_keys: managers read" on leadhub.project_api_keys
  for select to authenticated using (leadhub_private.has_role(workspace_id, array['admin', 'manager']));
create policy "api_keys: managers insert" on leadhub.project_api_keys
  for insert to authenticated with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));
create policy "api_keys: managers update" on leadhub.project_api_keys
  for update to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin', 'manager']))
  with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

create policy "pipelines: members read" on leadhub.pipelines
  for select to authenticated using (leadhub_private.is_member(workspace_id));

create policy "stages: members read" on leadhub.pipeline_stages
  for select to authenticated using (leadhub_private.is_member(workspace_id));
create policy "stages: managers write" on leadhub.pipeline_stages
  for all to authenticated
  using (leadhub_private.has_role(workspace_id, array['admin', 'manager']))
  with check (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

-- §4.3: attendants ("agent") only see the leads assigned to them.
create or replace function leadhub_private.can_read_lead(p_workspace_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case leadhub_private.member_role(p_workspace_id)
    when 'admin' then true
    when 'manager' then true
    when 'sales' then true
    when 'client' then true
    -- An unassigned lead (null owner) is not the agent's.
    when 'agent' then coalesce(p_owner_id = auth.uid(), false)
    else false
  end
$$;

-- §4.3: who may edit a lead / move its stage.
create or replace function leadhub_private.can_edit_lead(p_workspace_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case leadhub_private.member_role(p_workspace_id)
    when 'admin' then true
    when 'manager' then true
    when 'sales' then true
    -- An unassigned lead (null owner) is not the agent's.
    when 'agent' then coalesce(p_owner_id = auth.uid(), false)
    else false
  end
$$;

revoke all on function leadhub_private.can_read_lead(uuid, uuid) from public, anon;
revoke all on function leadhub_private.can_edit_lead(uuid, uuid) from public, anon;
grant execute on function leadhub_private.can_read_lead(uuid, uuid) to authenticated, service_role;
grant execute on function leadhub_private.can_edit_lead(uuid, uuid) to authenticated, service_role;

create policy "leads: read" on leadhub.leads
  for select to authenticated using (leadhub_private.can_read_lead(workspace_id, owner_id));
create policy "leads: edit" on leadhub.leads
  for update to authenticated
  using (leadhub_private.can_edit_lead(workspace_id, owner_id))
  with check (leadhub_private.can_edit_lead(workspace_id, owner_id));

create policy "conversions: read with lead" on leadhub.lead_conversions
  for select to authenticated
  using (exists (select 1 from leadhub.leads l where l.id = lead_conversions.lead_id));

create policy "answers: read with lead" on leadhub.lead_answers
  for select to authenticated
  using (exists (select 1 from leadhub.leads l where l.id = lead_answers.lead_id));

create policy "history: read with lead" on leadhub.lead_stage_history
  for select to authenticated
  using (exists (select 1 from leadhub.leads l where l.id = lead_stage_history.lead_id));

create policy "outbox: managers read" on leadhub.outbox_events
  for select to authenticated using (leadhub_private.has_role(workspace_id, array['admin', 'manager']));

-- ---------------------------------------------------------------------------
-- RPC: move a lead to another stage (§9.2, §9.3, §13.3)
--
-- Updates the lead, appends history and enqueues the canonical event in one
-- transaction. A lead the caller cannot edit is reported exactly like a lead
-- that does not exist, so other workspaces' ids leak nothing.
-- ---------------------------------------------------------------------------

create or replace function leadhub.move_lead_stage(
  p_lead_id uuid,
  p_to_stage_id uuid,
  p_lost_reason text default null,
  p_sale_value numeric default null
)
returns leadhub.lead_stage_history
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead leadhub.leads;
  v_stage leadhub.pipeline_stages;
  v_history leadhub.lead_stage_history;
  v_reason text := nullif(trim(p_lost_reason), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_lead from leadhub.leads where id = p_lead_id for update;

  if not found or leadhub_private.can_edit_lead(v_lead.workspace_id, v_lead.owner_id) is not true then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  select * into v_stage
  from leadhub.pipeline_stages
  where id = p_to_stage_id and project_id = v_lead.project_id;

  if not found then
    raise exception 'stage not found in this project' using errcode = 'P0002';
  end if;

  if v_stage.kind = 'lost' and v_reason is null then
    raise exception 'lost_reason is required when moving to a lost stage'
      using errcode = '22023';
  end if;

  if p_sale_value is not null and p_sale_value < 0 then
    raise exception 'sale_value must not be negative' using errcode = '22023';
  end if;

  if v_lead.current_stage_id is not distinct from v_stage.id then
    raise exception 'lead is already in this stage' using errcode = '22023';
  end if;

  update leadhub.leads
  set current_stage_id = v_stage.id,
      lost_reason = case when v_stage.kind = 'lost' then v_reason else null end,
      sale_value = case when v_stage.kind = 'won' then coalesce(p_sale_value, sale_value) else sale_value end
  where id = v_lead.id;

  insert into leadhub.lead_stage_history (workspace_id, lead_id, from_stage_id, to_stage_id, changed_by, metadata)
  values (
    v_lead.workspace_id,
    v_lead.id,
    v_lead.current_stage_id,
    v_stage.id,
    auth.uid(),
    jsonb_strip_nulls(jsonb_build_object(
      'to_stage_key', v_stage.key,
      'lost_reason', case when v_stage.kind = 'lost' then v_reason end,
      'sale_value', case when v_stage.kind = 'won' then coalesce(p_sale_value, v_lead.sale_value) end
    ))
  )
  returning * into v_history;

  if v_stage.event_type is not null then
    insert into leadhub.outbox_events
      (workspace_id, project_id, event_key, event_type, aggregate_type, aggregate_id, payload)
    values (
      v_lead.workspace_id,
      v_lead.project_id,
      -- Immutable per transition, reused by every retry (§9.5).
      v_stage.event_type || ':' || v_history.id,
      v_stage.event_type,
      'lead',
      v_lead.id,
      jsonb_strip_nulls(jsonb_build_object(
        'lead_id', v_lead.id,
        'project_id', v_lead.project_id,
        'stage', v_stage.key,
        'stage_history_id', v_history.id,
        'sale_value', case when v_stage.kind = 'won' then coalesce(p_sale_value, v_lead.sale_value) end,
        'currency', case when v_stage.kind = 'won' then v_lead.currency end,
        -- Stable id for sale deduplication on media platforms (§9.5).
        'transaction_id', case when v_stage.kind = 'won' then v_history.id::text end,
        'lost_reason', case when v_stage.kind = 'lost' then v_reason end
      ))
    );
  end if;

  return v_history;
end;
$$;

revoke all on function leadhub.move_lead_stage(uuid, uuid, text, numeric) from public, anon;
grant execute on function leadhub.move_lead_stage(uuid, uuid, text, numeric) to authenticated;
