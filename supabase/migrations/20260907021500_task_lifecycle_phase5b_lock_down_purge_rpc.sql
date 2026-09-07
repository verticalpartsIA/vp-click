-- Issue #185, gota 5 — fix: purge_expired_trash() ficou exposta via PostgREST
-- pra `anon`/`authenticated` (achado do security advisor logo após a
-- migration anterior). Mesma trava usada em claim_due_recurrence_rules
-- (#184 fase 5): só postgres/service_role podem chamar — o pg_cron roda
-- como postgres, não precisa de EXECUTE público. SECURITY DEFINER não deve
-- ficar acessível via /rest/v1/rpc/purge_expired_trash pra ninguém autenticado.
revoke execute on function public.purge_expired_trash(integer) from public;
revoke execute on function public.purge_expired_trash(integer) from anon;
revoke execute on function public.purge_expired_trash(integer) from authenticated;
