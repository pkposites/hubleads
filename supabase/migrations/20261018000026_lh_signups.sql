-- Cadê o Lead: sign-up requests from the home page ("Quero usar").
--
-- Visitors leave name, company, WhatsApp and how they advertise; the master
-- sees the list in the painel mãe and gets in touch. Only the app's server
-- can add a request (server secret), at most 5 per device per hour.

create table public.lh_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  company text not null check (char_length(company) between 2 and 120),
  whatsapp text not null check (char_length(whatsapp) between 8 and 40),
  email text check (email is null or char_length(email) <= 200),
  profile text check (profile in ('agencia', 'negocio', 'outro')),
  channels text[] not null default '{}',
  message text check (message is null or char_length(message) <= 1000),
  client text not null,
  contacted_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.lh_signups enable row level security;
revoke all on public.lh_signups from anon, authenticated;
create index lh_signups_client_idx on public.lh_signups (client, created_at);

/** Stores a sign-up request sent by the app's server. */
create or replace function public.lh_server_signup(p_secret text, p_client text, p_data jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_channels text[];
begin
  perform lh_private.check_server(p_secret);
  if (select count(*) from public.lh_signups s where s.client = left(coalesce(p_client, ''), 64) and s.created_at > now() - interval '1 hour') >= 5 then
    return jsonb_build_object('limited', true);
  end if;
  select coalesce(array_agg(c), '{}') into v_channels
  from jsonb_array_elements_text(coalesce(p_data -> 'channels', '[]'::jsonb)) c
  where c in ('lp', 'meta_form', 'sheets', 'whatsapp_direto', 'google', 'nao_anuncia');
  begin
    insert into public.lh_signups (name, company, whatsapp, email, profile, channels, message, client)
    values (
      trim(p_data ->> 'name'),
      trim(p_data ->> 'company'),
      trim(p_data ->> 'whatsapp'),
      nullif(lower(trim(coalesce(p_data ->> 'email', ''))), ''),
      nullif(p_data ->> 'profile', ''),
      v_channels,
      nullif(trim(coalesce(p_data ->> 'message', '')), ''),
      left(coalesce(p_client, ''), 64)
    );
  exception when check_violation or not_null_violation then
    raise exception 'invalid sign-up' using errcode = '22023';
  end;
  return jsonb_build_object('ok', true);
end;
$$;

/** Sign-up requests, newest first (master only). */
create or replace function public.lh_admin_list_signups(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
begin
  if not lh_private.admin_is_master(v_admin) then
    raise exception 'master only' using errcode = 'LH403';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(s) - 'client' order by s.created_at desc)
    from (select * from public.lh_signups order by created_at desc limit 100) s
  ), '[]'::jsonb);
end;
$$;

/** Marks a request as contacted (or back to new). */
create or replace function public.lh_admin_mark_signup(p_token text, p_signup_id uuid, p_contacted boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin uuid := lh_private.admin_for(p_token);
begin
  if not lh_private.admin_is_master(v_admin) then
    raise exception 'master only' using errcode = 'LH403';
  end if;
  update public.lh_signups set contacted_at = case when p_contacted then now() end where id = p_signup_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'lh_server_signup(text, text, jsonb)',
    'lh_admin_list_signups(text)',
    'lh_admin_mark_signup(text, uuid, boolean)'
  ] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('grant execute on function public.%s to anon, authenticated, service_role', f);
  end loop;
end
$$;
