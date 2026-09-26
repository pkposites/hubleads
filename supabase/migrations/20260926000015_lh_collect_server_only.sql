-- Lead Hub: limits against mass sending (step 2 of 2).
--
-- With the app already calling lh_server_collect / lh_server_count_visit,
-- the original functions leave the public API: nobody can call them directly
-- with the publishable key and skip the limits.

alter function public.lh_collect(p_key text, p_origin_host text, p_event jsonb) set schema lh_private;
alter function public.lh_count_visit(p_key text, p_origin_host text, p_client text, p_dims jsonb) set schema lh_private;

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
  return lh_private.lh_collect(p_key, p_origin_host, p_event);
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
  perform lh_private.lh_count_visit(p_key, p_origin_host, p_visitor, p_dims);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on all functions in schema lh_private from public, anon, authenticated;
