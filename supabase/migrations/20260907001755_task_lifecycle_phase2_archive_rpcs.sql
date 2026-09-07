
-- Issue #185, gota 2 (arquivar/desarquivar): revisa as RPCs de contagem/
-- dashboard/busca pra ignorar tarefas arquivadas ou na lixeira por padrão
-- (seção 29/30/31 da issue) — sem isso, arquivar uma tarefa a esconderia da
-- Lista/Kanban mas ela continuaria contando nos badges e no Dashboard.
create or replace function public.get_task_counts_by_list(p_list_ids uuid[] default null::uuid[])
returns table(list_id uuid, status text, total_count bigint)
language sql
stable
set search_path to 'public'
as $function$
  select
    t.list_id,
    t.status,
    count(*)::bigint as total_count
  from public.tasks t
  where
    t.archived_at is null
    and t.deleted_at is null
    and (
      p_list_ids is null
      or (
        cardinality(p_list_ids) > 0
        and t.list_id = any(p_list_ids)
      )
    )
  group by t.list_id, t.status
  order by t.list_id, t.status;
$function$;

create or replace function public.get_dashboard_summary(p_period text default 'all'::text)
returns table(list_id uuid, main_assignee_id uuid, status text, priority text, health_key text, is_extended boolean, count bigint)
language sql
stable
set search_path to 'public'
as $function$
  with cutoff as (
    select case p_period
      when '7d' then (current_date - 7)
      when '30d' then (current_date - 30)
      when '90d' then (current_date - 90)
      else null
    end as cutoff_date
  ),
  scoped as (
    select t.*
    from public.tasks t
    cross join cutoff c
    where t.archived_at is null
      and t.deleted_at is null
      and (
        c.cutoff_date is null
        or coalesce(t.due_date, t.start_date, t.created_at::date) >= c.cutoff_date
      )
  ),
  classified as (
    select
      list_id,
      main_assignee_id,
      status,
      priority,
      coalesce(extension_count, 0) > 0 as is_extended,
      case
        when lower(status) like '%conclu%' or lower(status) like '%aprovado%' or lower(status) like '%fechado%'
          then 'done'
        when lower(status) like '%cancel%' or lower(status) like '%reprova%'
          then 'cancelled'
        when lower(status) like '%aguardando%' or lower(status) like '%pendente%' or lower(status) like '%enviada%'
          or lower(status) like '%em espera%' or lower(status) like '%bloqueada%'
          or lower(status) like '%em analise%' or lower(status) like '%em análise%'
          then 'blocked'
        when due_date is null
          then 'nodate'
        when start_date is not null and current_date < start_date
          then 'waiting'
        when current_date > due_date
          then 'late'
        when (due_date - coalesce(start_date, current_date)) <= 0
          then 'ok'
        when (due_date - current_date)::numeric / (due_date - coalesce(start_date, current_date))::numeric > 0.5
          then 'ok'
        when (due_date - current_date)::numeric / (due_date - coalesce(start_date, current_date))::numeric > 0.2
          then 'warning'
        else 'urgent'
      end as health_key
    from scoped
  )
  select
    list_id,
    main_assignee_id,
    status,
    priority,
    health_key,
    is_extended,
    count(*)::bigint as count
  from classified
  group by list_id, main_assignee_id, status, priority, health_key, is_extended;
$function$;

create or replace function public.search_tasks(p_term text, p_limit integer default 200)
returns table(id uuid, title text, description text, status text, priority text, main_assignee_id uuid, secondary_assignee_ids uuid[], start_date date, due_date date, extension_count integer, list_id uuid, project_id uuid, parent_id uuid, created_at timestamp with time zone, created_by uuid, tags text[])
language sql
stable security definer
set search_path to 'public', 'extensions'
as $function$
  with search_input as (
    select
      nullif(trim(p_term), '') as raw_term,
      lower(nullif(trim(p_term), '')) as normalized_term,
      replace(
        replace(
          replace(lower(nullif(trim(p_term), '')), '\', '\\'),
          '%',
          '\%'
        ),
        '_',
        '\_'
      ) as like_term,
      greatest(1, least(coalesce(p_limit, 200), 200)) as safe_limit
  )
  select
    t.id,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.main_assignee_id,
    t.secondary_assignee_ids,
    t.start_date,
    t.due_date,
    t.extension_count,
    t.list_id,
    t.project_id,
    t.parent_id,
    t.created_at,
    t.created_by,
    t.tags
  from public.tasks t
  cross join search_input s
  where
    s.raw_term is not null
    and t.archived_at is null
    and t.deleted_at is null
    and public.can_access_task(t.id)
    and (
      lower(t.title) like '%' || s.like_term || '%' escape '\'
      or lower(coalesce(t.description, '')) like '%' || s.like_term || '%' escape '\'
    )
  order by
    case
      when lower(t.title) = s.normalized_term then 0
      when lower(t.title) like s.like_term || '%' escape '\' then 1
      when lower(t.title) like '%' || s.like_term || '%' escape '\' then 2
      else 3
    end,
    t.created_at desc,
    t.id asc
  limit (select safe_limit from search_input);
$function$;
