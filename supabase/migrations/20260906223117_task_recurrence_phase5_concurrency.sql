
-- Fase 5 da issue #184 (seção 20): impede que dois workers processem a
-- mesma regra ao mesmo tempo. O índice único (recurrence_rule_id,
-- scheduled_occurrence_at) já evita OCORRÊNCIA duplicada, mas não evita dois
-- workers concorrentes fazendo trabalho redundante (2x subtarefas clonadas
-- antes de uma delas colidir no insert da tarefa principal, por exemplo).
alter table public.task_recurrence_rules add column if not exists locked_at timestamptz;

-- UPDATE ... FROM (SELECT ... FOR UPDATE SKIP LOCKED) — claim atômico: só
-- pega regras não travadas (ou cujo lock expirou, caso o worker anterior
-- tenha morrido sem liberar) e já marca locked_at=now() no mesmo statement,
-- então dois workers concorrentes nunca pegam a mesma linha.
create or replace function public.claim_due_recurrence_rules(p_limit int default 50, p_lock_ttl_minutes int default 10)
returns setof public.task_recurrence_rules
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
  update public.task_recurrence_rules t
  set locked_at = now()
  from (
    select id from public.task_recurrence_rules
    where enabled = true
      and trigger_mode = 'on_schedule'
      and next_run_at is not null
      and next_run_at <= now()
      and (locked_at is null or locked_at < now() - (p_lock_ttl_minutes || ' minutes')::interval)
    order by next_run_at
    limit p_limit
    for update skip locked
  ) due
  where t.id = due.id
  returning t.*;
end;
$$;

revoke all on function public.claim_due_recurrence_rules(int, int) from public, anon, authenticated;
grant execute on function public.claim_due_recurrence_rules(int, int) to service_role;
