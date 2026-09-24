-- Lead Hub: lead ingestion (blueprint §3.2 steps 4-5, §6.4, §8.2, §17.2).
--
-- Called only by the server-side ingestion API with the service role, after
-- it has authenticated the key, checked the Origin and normalised the input.
-- Everything a submission touches happens in this one transaction.

create or replace function leadhub.ingest_lead_conversion(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_project leadhub.projects;
  v_idempotency_key text := nullif(p ->> 'idempotency_key', '');
  v_request_hash text := nullif(p ->> 'request_hash', '');
  v_lead_in jsonb := coalesce(p -> 'lead', '{}'::jsonb);
  v_phone_norm text := nullif(v_lead_in ->> 'phone_norm', '');
  v_email_norm text := nullif(v_lead_in ->> 'email_norm', '');
  v_touch jsonb := coalesce(p -> 'touch', '{}'::jsonb);
  v_first_touch jsonb := coalesce(nullif(p -> 'first_touch', 'null'::jsonb), p -> 'touch', '{}'::jsonb);
  v_answers jsonb := coalesce(p -> 'answers', '{}'::jsonb);
  v_existing leadhub.lead_conversions;
  v_lead leadhub.leads;
  v_other_id uuid;
  v_needs_review boolean := false;
  v_created boolean := false;
  v_first_stage_id uuid;
  v_conversion leadhub.lead_conversions;
begin
  if jsonb_typeof(v_answers) <> 'object' then
    raise exception 'answers must be an object' using errcode = '22023';
  end if;

  select * into v_project
  from leadhub.projects
  where id = (p ->> 'project_id')::uuid and status = 'active';

  if not found then
    raise exception 'project not found' using errcode = 'LH404';
  end if;

  if v_phone_norm is null and v_email_norm is null then
    raise exception 'a phone or e-mail is required' using errcode = '22023';
  end if;

  -- Idempotency (§8.1, AC05): the same key returns the original result; the
  -- same key with a different payload is a conflict.
  if v_idempotency_key is not null then
    perform pg_advisory_xact_lock(hashtextextended('idem:' || v_project.id || ':' || v_idempotency_key, 0));

    select * into v_existing
    from leadhub.lead_conversions
    where project_id = v_project.id and idempotency_key = v_idempotency_key;

    if found then
      if v_existing.request_hash is distinct from v_request_hash then
        raise exception 'idempotency key reused with a different payload' using errcode = 'LH409';
      end if;

      return jsonb_build_object(
        'lead_id', v_existing.lead_id,
        'conversion_id', v_existing.id,
        'created', false,
        'duplicate', true,
        'replayed', true,
        'received_at', v_existing.created_at
      );
    end if;
  end if;

  -- Serialise submissions for the same person. Locks are always taken in the
  -- same order (phone, then e-mail) so they cannot deadlock.
  if v_phone_norm is not null then
    perform pg_advisory_xact_lock(hashtextextended('phone:' || v_project.id || ':' || v_phone_norm, 0));
  end if;
  if v_email_norm is not null then
    perform pg_advisory_xact_lock(hashtextextended('email:' || v_project.id || ':' || v_email_norm, 0));
  end if;

  -- Deduplication (§6.4): phone first, then e-mail. Never across projects.
  if v_phone_norm is not null then
    select * into v_lead
    from leadhub.leads
    where project_id = v_project.id and phone_norm = v_phone_norm;
  end if;

  if v_lead.id is null and v_email_norm is not null then
    select * into v_lead
    from leadhub.leads
    where project_id = v_project.id
      and email_norm = v_email_norm
      -- An e-mail match only counts when it cannot be a different phone.
      and (v_phone_norm is null or phone_norm is null)
    order by created_at desc
    limit 1;
  end if;

  if v_email_norm is not null then
    -- Is this e-mail already attached to someone else?
    select id into v_other_id
    from leadhub.leads
    where project_id = v_project.id
      and email_norm = v_email_norm
      and id is distinct from v_lead.id
    limit 1;
    v_needs_review := v_other_id is not null;
  end if;

  if v_lead.id is null then
    select s.id into v_first_stage_id
    from leadhub.pipeline_stages s
    where s.project_id = v_project.id
    order by s.position
    limit 1;

    insert into leadhub.leads (
      workspace_id, project_id, name, phone, phone_norm, email, email_norm,
      current_stage_id, needs_review, first_touch, last_touch, source_channel
    )
    values (
      v_project.workspace_id,
      v_project.id,
      nullif(v_lead_in ->> 'name', ''),
      nullif(v_lead_in ->> 'phone', ''),
      v_phone_norm,
      nullif(v_lead_in ->> 'email', ''),
      v_email_norm,
      v_first_stage_id,
      v_needs_review,
      v_first_touch,
      v_touch,
      coalesce(v_first_touch ->> 'channel', v_touch ->> 'channel')
    )
    returning * into v_lead;

    v_created := true;

    insert into leadhub.lead_stage_history (workspace_id, lead_id, from_stage_id, to_stage_id, metadata)
    values (v_lead.workspace_id, v_lead.id, null, v_first_stage_id, '{"reason": "created"}'::jsonb);
  else
    update leadhub.leads
    set name = coalesce(name, nullif(v_lead_in ->> 'name', '')),
        phone = coalesce(phone, nullif(v_lead_in ->> 'phone', '')),
        phone_norm = coalesce(phone_norm, v_phone_norm),
        email = coalesce(email, nullif(v_lead_in ->> 'email', '')),
        email_norm = coalesce(email_norm, v_email_norm),
        needs_review = needs_review or v_needs_review,
        first_touch = case when first_touch = '{}'::jsonb then v_first_touch else first_touch end,
        source_channel = coalesce(source_channel, v_first_touch ->> 'channel', v_touch ->> 'channel'),
        last_touch = case when v_touch = '{}'::jsonb then last_touch else v_touch end
    where id = v_lead.id
    returning * into v_lead;
  end if;

  insert into leadhub.lead_conversions (
    workspace_id, project_id, lead_id, form_id, landing_page_id, session_id,
    idempotency_key, request_hash, source_channel, answers, tracking, consent
  )
  values (
    v_project.workspace_id,
    v_project.id,
    v_lead.id,
    nullif(p ->> 'form_id', '')::uuid,
    nullif(p ->> 'landing_page_id', '')::uuid,
    nullif(p ->> 'session_id', ''),
    v_idempotency_key,
    v_request_hash,
    v_touch ->> 'channel',
    v_answers,
    coalesce(p -> 'tracking', '{}'::jsonb),
    coalesce(p -> 'consent', '{}'::jsonb)
  )
  returning * into v_conversion;

  insert into leadhub.lead_answers (conversion_id, workspace_id, lead_id, field_key, value)
  select v_conversion.id, v_lead.workspace_id, v_lead.id, a.key, a.value
  from jsonb_each_text(v_answers) as a (key, value);

  -- §9.2: every conversion emits lead.created.
  insert into leadhub.outbox_events
    (workspace_id, project_id, event_key, event_type, aggregate_type, aggregate_id, payload)
  values (
    v_lead.workspace_id,
    v_lead.project_id,
    'lead.created:' || v_conversion.id,
    'lead.created',
    'lead',
    v_lead.id,
    jsonb_strip_nulls(jsonb_build_object(
      'lead_id', v_lead.id,
      'conversion_id', v_conversion.id,
      'project_id', v_lead.project_id,
      'form_id', v_conversion.form_id,
      'new_lead', v_created,
      'channel', v_conversion.source_channel
    ))
  );

  return jsonb_build_object(
    'lead_id', v_lead.id,
    'conversion_id', v_conversion.id,
    'created', v_created,
    'duplicate', not v_created,
    'replayed', false,
    'received_at', v_conversion.created_at
  );
end;
$$;

-- Service role only: never callable from the browser.
revoke all on function leadhub.ingest_lead_conversion(jsonb) from public, anon, authenticated;
grant execute on function leadhub.ingest_lead_conversion(jsonb) to service_role;
