-- Lead Hub: limits against mass sending to /api/collect (step 1 of 2).
--
-- The page key is public (it is in the landing page's HTML), and so is the
-- database's publishable key (the Supabase project is shared with another
-- app whose pages use it). Someone could script hundreds of fake clicks into
-- a client's sheet. From now on events go through functions that only the
-- app's server can call (server secret), with limits per device:
--
-- - all events: 120 per minute;
-- - WhatsApp clicks and contacts (they create or change rows): 20 per minute
--   and 100 per hour;
-- - anonymous visits: 60 per minute.
--
-- The device is a keyed hash of the visitor's IP made by the app (the IP is
-- never stored). Counters are per minute and are deleted after two hours.
-- Limits are generous because many phones share one IP on mobile networks.
--
-- Step 2 (next migration, after the app is published) removes public access
-- to lh_collect and lh_count_visit, so this cannot be bypassed.

create table lh_private.collect_hits (
  client text not null,
  bucket text not null,
  minute timestamptz not null,
  hits int not null default 0,
  primary key (client, bucket, minute)
);

create index collect_hits_minute_idx on lh_private.collect_hits (minute);

/** Counts one hit and says whether the device is still within the limits. */
create or replace function lh_private.collect_allowed(p_client text, p_type text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_minute timestamptz := date_trunc('minute', now());
  v_bucket text := case
    when p_type in ('whatsapp_click', 'identify') then 'lead'
    when p_type = 'visit' then 'visit'
    else 'other'
  end;
  v_all int;
  v_this_minute int;
  v_hour int;
begin
  if coalesce(p_client, '') = '' then
    return true; -- no IP (should not happen behind Netlify): nothing to limit by
  end if;
  delete from lh_private.collect_hits where minute < now() - interval '2 hours';

  insert into lh_private.collect_hits as h (client, bucket, minute, hits)
  values (left(p_client, 64), v_bucket, v_minute, 1)
  on conflict (client, bucket, minute) do update set hits = h.hits + 1
  returning hits into v_this_minute;

  select coalesce(sum(h.hits), 0) into v_all
  from lh_private.collect_hits h
  where h.client = left(p_client, 64) and h.minute = v_minute;

  if v_all > 120 then
    return false;
  end if;
  if v_bucket = 'visit' then
    return v_this_minute <= 60;
  end if;
  if v_bucket = 'lead' then
    if v_this_minute > 20 then
      return false;
    end if;
    select coalesce(sum(h.hits), 0) into v_hour
    from lh_private.collect_hits h
    where h.client = left(p_client, 64) and h.bucket = 'lead' and h.minute > now() - interval '1 hour';
    return v_hour <= 100;
  end if;
  return true;
end;
$$;

/**
 * lh_collect for the app's server: checks the secret and the limits first.
 * Returns {limited: true} when the device went over a limit.
 */
create or replace function public.lh_server_collect(p_secret text, p_client text, p_key text, p_origin_host text, p_event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  if not lh_private.collect_allowed(p_client, p_event ->> 'type') then
    return jsonb_build_object('limited', true);
  end if;
  return public.lh_collect(p_key, p_origin_host, p_event);
end;
$$;

create or replace function public.lh_server_count_visit(
  p_secret text, p_client text, p_key text, p_origin_host text, p_visitor text, p_dims jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  if not lh_private.collect_allowed(p_client, 'visit') then
    return jsonb_build_object('limited', true);
  end if;
  perform public.lh_count_visit(p_key, p_origin_host, p_visitor, p_dims);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_server_collect(text, text, text, text, jsonb)',
    'lh_server_count_visit(text, text, text, text, text, jsonb)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
