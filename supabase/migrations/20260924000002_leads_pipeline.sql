-- Lead Hub: capture configuration, leads, pipeline, history and outbox
-- (blueprint §5, §6.4, §7, §9, Appendix A).

-- ---------------------------------------------------------------------------
-- Capture configuration
-- ---------------------------------------------------------------------------

-- A landing page authorises one or more hostnames to post leads into a
-- project with its public key (§5.1). The public key only grants ingestion.
create table public.landing_pages (
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
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade
);

create index landing_pages_project_idx on public.landing_pages (project_id);

create table public.forms (
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
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade
);

-- Server-to-server secret keys (§8.1). Only a SHA-256 hash is stored; the
-- plaintext is shown once when the key is created.
create table public.project_api_keys (
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
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade
);

create index project_api_keys_project_idx on public.project_api_keys (project_id);

-- ---------------------------------------------------------------------------
-- Pipeline (§9.1)
-- ---------------------------------------------------------------------------

create table public.pipelines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null unique,
  name text not null default 'Pipeline',
  created_at timestamptz not null default now(),
  unique (project_id, id),
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade
);

create table public.pipeline_stages (
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
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (project_id, pipeline_id) references public.pipelines (project_id, id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- Leads and conversions (§6.4, §7)
-- ---------------------------------------------------------------------------

create table public.leads (
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
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (project_id, current_stage_id) references public.pipeline_stages (project_id, id)
);

create index leads_workspace_created_idx on public.leads (workspace_id, created_at desc);
create index leads_project_created_idx on public.leads (project_id, created_at desc);
create index leads_stage_idx on public.leads (current_stage_id);
create index leads_owner_idx on public.leads (owner_id) where owner_id is not null;
-- Phone is the preferred identity within a project; unique so concurrent
-- submissions cannot create two people for the same number.
create unique index leads_project_phone_uidx on public.leads (project_id, phone_norm)
  where phone_norm is not null;
create index leads_project_email_idx on public.leads (project_id, email_norm)
  where email_norm is not null;

create trigger leads_updated_at before update on public.leads
  for each row execute function private.set_updated_at();
create trigger landing_pages_updated_at before update on public.landing_pages
  for each row execute function private.set_updated_at();
create trigger forms_updated_at before update on public.forms
  for each row execute function private.set_updated_at();

create table public.lead_conversions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  project_id uuid not null,
  lead_id uuid not null references public.leads (id) on delete cascade,
  form_id uuid,
  landing_page_id uuid references public.landing_pages (id) on delete set null,
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
  foreign key (workspace_id, project_id) references public.projects (workspace_id, id) on delete cascade,
  foreign key (project_id, form_id) references public.forms (project_id, id) on delete set null (form_id)
);

create index lead_conversions_lead_idx on public.lead_conversions (lead_id, created_at desc);
create index lead_conversions_workspace_idx on public.lead_conversions (workspace_id, created_at desc);

-- Answers flattened for filtering and reporting; the raw object stays on the
-- conversion.
create table public.lead_answers (
  conversion_id uuid not null references public.lead_conversions (id) on delete cascade,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  field_key text not null,
  value text,
  primary key (conversion_id, field_key)
);

create index lead_answers_lead_idx on public.lead_answers (lead_id);

-- Append-only: no update/delete policies and no grants for them.
create table public.lead_stage_history (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  lead_id uuid not null references public.leads (id) on delete cascade,
  from_stage_id uuid references public.pipeline_stages (id) on delete set null,
  to_stage_id uuid references public.pipeline_stages (id) on delete set null,
  changed_by uuid references auth.users (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index lead_stage_history_lead_idx on public.lead_stage_history (lead_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Outbox (§9.3). Written in the same transaction as the change it describes.
-- ---------------------------------------------------------------------------

create table public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  project_id uuid references public.projects (id) on delete cascade,
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

create index outbox_events_pending_idx on public.outbox_events (available_at)
  where status in ('pending', 'retry');
create index outbox_events_aggregate_idx on public.outbox_events (aggregate_type, aggregate_id);

create trigger outbox_events_updated_at before update on public.outbox_events
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Every new project gets the default pipeline (§9.1)
-- ---------------------------------------------------------------------------

create or replace function private.create_default_pipeline()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pipeline_id uuid;
begin
  insert into public.pipelines (workspace_id, project_id)
  values (new.workspace_id, new.id)
  returning id into v_pipeline_id;

  insert into public.pipeline_stages
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
  after insert on public.projects
  for each row execute function private.create_default_pipeline();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.landing_pages enable row level security;
alter table public.forms enable row level security;
alter table public.project_api_keys enable row level security;
alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.leads enable row level security;
alter table public.lead_conversions enable row level security;
alter table public.lead_answers enable row level security;
alter table public.lead_stage_history enable row level security;
alter table public.outbox_events enable row level security;

-- §14.2: the browser SDK never touches these tables directly.
revoke all on
  public.landing_pages, public.forms, public.project_api_keys, public.pipelines,
  public.pipeline_stages, public.leads, public.lead_conversions, public.lead_answers,
  public.lead_stage_history, public.outbox_events
from anon;

-- Stage changes, history and outbox rows are only written by the functions
-- below, so the API role gets read access plus a narrow set of writes.
revoke insert, update, delete, truncate on
  public.lead_conversions, public.lead_answers, public.lead_stage_history, public.outbox_events
from authenticated;
revoke insert, update, delete, truncate on public.leads from authenticated;
grant update (name, owner_id, estimated_value) on public.leads to authenticated;
revoke update, truncate on public.project_api_keys from authenticated;
grant update (name, revoked_at) on public.project_api_keys to authenticated;
revoke truncate on
  public.landing_pages, public.forms, public.pipelines, public.pipeline_stages
from authenticated;

-- Configuration: readable by members, managed by admins and managers.
create policy "landing_pages: members read" on public.landing_pages
  for select to authenticated using (private.is_member(workspace_id));
create policy "landing_pages: managers write" on public.landing_pages
  for all to authenticated
  using (private.has_role(workspace_id, array['admin', 'manager']))
  with check (private.has_role(workspace_id, array['admin', 'manager']));

create policy "forms: members read" on public.forms
  for select to authenticated using (private.is_member(workspace_id));
create policy "forms: managers write" on public.forms
  for all to authenticated
  using (private.has_role(workspace_id, array['admin', 'manager']))
  with check (private.has_role(workspace_id, array['admin', 'manager']));

-- §4.3: credentials are visible to admins and managers only.
create policy "api_keys: managers read" on public.project_api_keys
  for select to authenticated using (private.has_role(workspace_id, array['admin', 'manager']));
create policy "api_keys: managers insert" on public.project_api_keys
  for insert to authenticated with check (private.has_role(workspace_id, array['admin', 'manager']));
create policy "api_keys: managers update" on public.project_api_keys
  for update to authenticated
  using (private.has_role(workspace_id, array['admin', 'manager']))
  with check (private.has_role(workspace_id, array['admin', 'manager']));

create policy "pipelines: members read" on public.pipelines
  for select to authenticated using (private.is_member(workspace_id));

create policy "stages: members read" on public.pipeline_stages
  for select to authenticated using (private.is_member(workspace_id));
create policy "stages: managers write" on public.pipeline_stages
  for all to authenticated
  using (private.has_role(workspace_id, array['admin', 'manager']))
  with check (private.has_role(workspace_id, array['admin', 'manager']));

-- §4.3: attendants ("agent") only see the leads assigned to them.
create or replace function private.can_read_lead(p_workspace_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.member_role(p_workspace_id)
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
create or replace function private.can_edit_lead(p_workspace_id uuid, p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.member_role(p_workspace_id)
    when 'admin' then true
    when 'manager' then true
    when 'sales' then true
    -- An unassigned lead (null owner) is not the agent's.
    when 'agent' then coalesce(p_owner_id = auth.uid(), false)
    else false
  end
$$;

revoke all on function private.can_read_lead(uuid, uuid) from public, anon;
revoke all on function private.can_edit_lead(uuid, uuid) from public, anon;
grant execute on function private.can_read_lead(uuid, uuid) to authenticated, service_role;
grant execute on function private.can_edit_lead(uuid, uuid) to authenticated, service_role;

create policy "leads: read" on public.leads
  for select to authenticated using (private.can_read_lead(workspace_id, owner_id));
create policy "leads: edit" on public.leads
  for update to authenticated
  using (private.can_edit_lead(workspace_id, owner_id))
  with check (private.can_edit_lead(workspace_id, owner_id));

create policy "conversions: read with lead" on public.lead_conversions
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_conversions.lead_id));

create policy "answers: read with lead" on public.lead_answers
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_answers.lead_id));

create policy "history: read with lead" on public.lead_stage_history
  for select to authenticated
  using (exists (select 1 from public.leads l where l.id = lead_stage_history.lead_id));

create policy "outbox: managers read" on public.outbox_events
  for select to authenticated using (private.has_role(workspace_id, array['admin', 'manager']));

-- ---------------------------------------------------------------------------
-- RPC: move a lead to another stage (§9.2, §9.3, §13.3)
--
-- Updates the lead, appends history and enqueues the canonical event in one
-- transaction. A lead the caller cannot edit is reported exactly like a lead
-- that does not exist, so other workspaces' ids leak nothing.
-- ---------------------------------------------------------------------------

create or replace function public.move_lead_stage(
  p_lead_id uuid,
  p_to_stage_id uuid,
  p_lost_reason text default null,
  p_sale_value numeric default null
)
returns public.lead_stage_history
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead public.leads;
  v_stage public.pipeline_stages;
  v_history public.lead_stage_history;
  v_reason text := nullif(trim(p_lost_reason), '');
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;

  if not found or private.can_edit_lead(v_lead.workspace_id, v_lead.owner_id) is not true then
    raise exception 'lead not found' using errcode = 'P0002';
  end if;

  select * into v_stage
  from public.pipeline_stages
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

  update public.leads
  set current_stage_id = v_stage.id,
      lost_reason = case when v_stage.kind = 'lost' then v_reason else null end,
      sale_value = case when v_stage.kind = 'won' then coalesce(p_sale_value, sale_value) else sale_value end
  where id = v_lead.id;

  insert into public.lead_stage_history (workspace_id, lead_id, from_stage_id, to_stage_id, changed_by, metadata)
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
    insert into public.outbox_events
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

revoke all on function public.move_lead_stage(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.move_lead_stage(uuid, uuid, text, numeric) to authenticated;
