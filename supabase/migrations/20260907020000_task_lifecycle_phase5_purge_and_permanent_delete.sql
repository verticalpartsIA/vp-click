-- Issue #185, gota 5: exclusão definitiva restrita a ADMIN + purge automático
-- (seções 24-26 e 28 da issue).

-- 1) Aperta a RLS de DELETE em tasks: só ADMIN, e só quando a tarefa já está
--    na Lixeira (deleted_at preenchido) — impede qualquer chamada direta que
--    pule o fluxo de soft delete (seção 28: "Delete Forever não pode ser
--    burlado por chamada direta ao Supabase"). Antes: qualquer usuário com
--    can_access_task(id) podia fazer DELETE direto.
drop policy if exists tasks_del on public.tasks;
create policy tasks_del on public.tasks
  for delete
  using (public.is_admin() and deleted_at is not null);

-- 2) Purge automático: apaga em lotes, sempre pelas "folhas" primeiro
--    (tasks.parent_id é NO ACTION, não CASCADE) até não sobrar linha
--    expirada — assim uma árvore inteira (pai + subtarefas, todos com o
--    mesmo purge_after por terem sido excluídos juntos na gota 4) é
--    processada em algumas iterações do loop, nunca esbarrando na FK.
--    SECURITY DEFINER pra rodar via pg_cron sem depender de sessão de
--    usuário. Idempotente (seção 26): rodar de novo sem nada expirado
--    apenas retorna 0.
create or replace function public.purge_expired_trash(p_batch_size integer default 500)
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_total integer := 0;
  v_deleted integer;
  v_iterations integer := 0;
begin
  loop
    v_iterations := v_iterations + 1;
    exit when v_iterations > 1000; -- guarda de segurança contra loop infinito

    with candidates as (
      select t.id
      from public.tasks t
      where t.deleted_at is not null
        and t.purge_after <= now()
        and not exists (select 1 from public.tasks c where c.parent_id = t.id)
      limit p_batch_size
    )
    delete from public.tasks t
    using candidates c
    where t.id = c.id;

    get diagnostics v_deleted = row_count;
    v_total := v_total + v_deleted;
    exit when v_deleted = 0;
  end loop;
  return v_total;
end;
$function$;

-- 3) Agenda diária às 03:00 UTC (fora do horário comercial BR).
select cron.schedule('trash-purge-daily', '0 3 * * *', $$select public.purge_expired_trash();$$);
