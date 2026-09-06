
-- Função que expõe o segredo do Vault SÓ pra service_role (usada pela Edge
-- Function via RPC, já que o schema vault não é exposto pelo PostgREST).
-- O job pg_cron (abaixo) roda dentro do Postgres e lê o Vault direto via SQL,
-- sem precisar desta função.
create or replace function public.get_recurrence_scheduler_secret()
returns text
language sql
security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'task_recurrence_scheduler_secret';
$$;

revoke all on function public.get_recurrence_scheduler_secret() from public, anon, authenticated;
grant execute on function public.get_recurrence_scheduler_secret() to service_role;

-- Job periódico: dispara a Edge Function a cada 5 minutos via pg_net.
-- Idempotente na criação (remove um job antigo de mesmo nome antes).
select cron.unschedule(jobid) from cron.job where jobname = 'task-recurrence-scheduler-tick';

select cron.schedule(
  'task-recurrence-scheduler-tick',
  '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://sfpnjwllcmentoocylow.supabase.co/functions/v1/task-recurrence-scheduler',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'task_recurrence_scheduler_secret')
    ),
    body := '{}'::jsonb
  );
  $cron$
);
