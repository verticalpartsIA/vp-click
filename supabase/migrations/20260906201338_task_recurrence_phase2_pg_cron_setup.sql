
-- Fase 2 da issue #184: motor de cálculo (código TS, fora do banco) + agendamento.
-- pg_cron dispara periodicamente; pg_net faz o POST pra Edge Function
-- task-recurrence-scheduler, que calcula e cria as ocorrências.
-- Instalados em 'extensions' (não 'public') pra não somar ao advisor
-- extension_in_public.
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- Segredo compartilhado entre o job pg_cron e a Edge Function, guardado no
-- Vault (nunca hardcoded em arquivo committado nem em supabase secrets).
-- Idempotente: só cria se ainda não existir.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'task_recurrence_scheduler_secret') then
    perform vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'task_recurrence_scheduler_secret');
  end if;
end $$;
