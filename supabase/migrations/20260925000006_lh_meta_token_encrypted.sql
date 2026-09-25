-- Lead Hub: the Meta access token is stored encrypted.
--
-- The app's server encrypts the token with AES-256-GCM (key in the host's
-- LH_ENCRYPTION_KEY, never in the database) before saving it, and decrypts it
-- only to call Meta. A copy of the database, a backup or anyone with SQL
-- access sees ciphertext only. The constraint below rejects plain tokens, so a
-- mistake can never store one. The panel shows only the last 4 characters,
-- kept apart in token_hint.

delete from public.lh_meta_configs where access_token !~ '^enc:v1:';

alter table public.lh_meta_configs
  add column token_hint text check (char_length(token_hint) <= 8),
  add constraint lh_meta_configs_token_encrypted
    check (access_token ~ '^enc:v1:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$');

drop function public.lh_admin_set_meta(text, uuid, text, text, text, boolean, boolean, boolean);

/** p_access_token is the ciphertext from the app's server; blank keeps the saved one. */
create or replace function public.lh_admin_set_meta(
  p_token text,
  p_workspace_id uuid,
  p_pixel_id text,
  p_access_token text,
  p_token_hint text,
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
  if v_token is null then
    -- Keep the saved token: update only (an insert would need a token).
    update public.lh_meta_configs set
      pixel_id = trim(p_pixel_id),
      test_event_code = nullif(trim(coalesce(p_test_event_code, '')), ''),
      enabled = coalesce(p_enabled, false),
      send_schedule = coalesce(p_send_schedule, true),
      send_purchase = coalesce(p_send_purchase, true),
      updated_at = now()
    where workspace_id = p_workspace_id;
    if not found then
      raise exception 'access token is required' using errcode = '22023';
    end if;
    return;
  end if;
  insert into public.lh_meta_configs as c
    (workspace_id, pixel_id, access_token, token_hint, test_event_code, enabled, send_schedule, send_purchase)
  values (p_workspace_id, trim(p_pixel_id), v_token, left(p_token_hint, 8),
          nullif(trim(coalesce(p_test_event_code, '')), ''),
          coalesce(p_enabled, false), coalesce(p_send_schedule, true), coalesce(p_send_purchase, true))
  on conflict (workspace_id) do update set
    pixel_id = excluded.pixel_id,
    access_token = excluded.access_token,
    token_hint = excluded.token_hint,
    test_event_code = excluded.test_event_code,
    enabled = excluded.enabled,
    send_schedule = excluded.send_schedule,
    send_purchase = excluded.send_purchase,
    updated_at = now();
end;
$$;

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
    'token_hint', case when found then '••••' || coalesce(v_config.token_hint, '') end,
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

revoke all on function public.lh_admin_set_meta(text, uuid, text, text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.lh_admin_set_meta(text, uuid, text, text, text, text, boolean, boolean, boolean)
  to anon, authenticated, service_role;
