-- Lead Hub: admins manage their own password.
--
-- - "Minha conta": a logged-in admin (master or gestor) changes their password
--   by typing the current one. Their other sessions end.
-- - "Esqueci minha senha": the app's server asks for a one-time link for an
--   e-mail and sends it by e-mail. The link is valid for 30 minutes, only the
--   latest one works, at most 3 per hour per account, and using it ends every
--   session of that admin. Both steps need the server secret, so only the
--   app's server (which sends the e-mail) can create or use a link.
-- - Deactivated gestores cannot recover access; the master reactivates them.

create table lh_private.admin_password_resets (
  token_hash text primary key,
  admin_id uuid not null references public.lh_admins (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create index admin_password_resets_admin_idx on lh_private.admin_password_resets (admin_id, created_at);

create or replace function lh_private.check_new_password(p_password text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
begin
  if char_length(coalesce(p_password, '')) not between 10 and 200 then
    raise exception 'password must have between 10 and 200 characters' using errcode = '22023';
  end if;
end;
$$;

/**
 * Minha conta: changes the password of the logged-in admin. Returns
 * {ok: true}, {error: 'wrong_password'} or {error: 'locked', retry_after}; a
 * wrong current password counts as a failed login (so it is not raised,
 * which would undo that record).
 */
create or replace function public.lh_admin_change_password(p_token text, p_current text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := lh_private.admin_for(p_token);
  v_admin public.lh_admins;
  v_account text;
  v_wait int;
begin
  perform lh_private.check_new_password(p_new);
  select * into v_admin from public.lh_admins where id = v_id;
  v_account := 'admin:' || v_admin.login;
  v_wait := lh_private.login_wait(v_account, 'change-password');
  if v_wait > 0 then
    return jsonb_build_object('error', 'locked', 'retry_after', v_wait);
  end if;
  if extensions.crypt(coalesce(p_current, ''), v_admin.password_hash) <> v_admin.password_hash then
    perform lh_private.login_failed(v_account, 'change-password');
    return jsonb_build_object('error', 'wrong_password');
  end if;

  update public.lh_admins set password_hash = lh_private.hash_password(p_new) where id = v_admin.id;
  -- Keep this session; end the others (another device, an old login).
  delete from public.lh_admin_sessions
  where admin_id = v_admin.id and token_hash <> lh_private.sha256(p_token);
  delete from lh_private.admin_password_resets where admin_id = v_admin.id;
  return jsonb_build_object('ok', true);
end;
$$;

/**
 * Esqueci minha senha: a one-time token for this e-mail, or null when there is
 * no active admin with it or the account already asked 3 times in the hour.
 * The app answers the same thing in every case.
 */
create or replace function public.lh_server_admin_reset_request(p_secret text, p_login text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.lh_admins;
  v_token text;
begin
  perform lh_private.check_server(p_secret);
  delete from lh_private.admin_password_resets where created_at < now() - interval '1 day';

  select * into v_admin from public.lh_admins
  where login = lower(trim(coalesce(p_login, ''))) and disabled_at is null;
  if not found then
    return null;
  end if;
  if (select count(*) from lh_private.admin_password_resets r
      where r.admin_id = v_admin.id and r.created_at > now() - interval '1 hour') >= 3 then
    return null;
  end if;

  -- Only the latest link works.
  update lh_private.admin_password_resets set used_at = now() where admin_id = v_admin.id and used_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into lh_private.admin_password_resets (token_hash, admin_id, expires_at)
  values (lh_private.sha256(v_token), v_admin.id, now() + interval '30 minutes');
  return jsonb_build_object('token', v_token, 'login', v_admin.login);
end;
$$;

/** Whether a link can still be used (the page says so before asking for a password). */
create or replace function public.lh_server_admin_reset_valid(p_secret text, p_token text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform lh_private.check_server(p_secret);
  return exists (
    select 1 from lh_private.admin_password_resets r
    join public.lh_admins a on a.id = r.admin_id and a.disabled_at is null
    where r.token_hash = lh_private.sha256(coalesce(p_token, ''))
      and r.used_at is null and r.expires_at > now()
  );
end;
$$;

/** Sets the new password from a link. Returns the login, or null for an invalid/expired link. */
create or replace function public.lh_server_admin_reset_password(p_secret text, p_token text, p_new text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin public.lh_admins;
begin
  perform lh_private.check_server(p_secret);
  perform lh_private.check_new_password(p_new);

  select a.* into v_admin
  from lh_private.admin_password_resets r
  join public.lh_admins a on a.id = r.admin_id and a.disabled_at is null
  where r.token_hash = lh_private.sha256(coalesce(p_token, ''))
    and r.used_at is null and r.expires_at > now()
  for update of r;
  if not found then
    return null;
  end if;

  update public.lh_admins set password_hash = lh_private.hash_password(p_new) where id = v_admin.id;
  update lh_private.admin_password_resets set used_at = now() where admin_id = v_admin.id and used_at is null;
  delete from public.lh_admin_sessions where admin_id = v_admin.id;
  delete from lh_private.login_failures where account = 'admin:' || v_admin.login;
  return jsonb_build_object('login', v_admin.login);
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_admin_change_password(text, text, text)',
    'lh_server_admin_reset_request(text, text)',
    'lh_server_admin_reset_valid(text, text)',
    'lh_server_admin_reset_password(text, text, text)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
