-- Issue #184 — Tarefas recorrentes, Fase 1: schema + RLS + índices + idempotência.
-- Cada ocorrência é uma tarefa real e independente (nunca reabre/sobrescreve a
-- mesma linha) — a regra fica numa tabela própria, referenciada pelas tarefas
-- que ela gera. Motor de cálculo/scheduler fica pra Fase 2; esta migration só
-- cria a base de dados sobre a qual ele vai rodar.

-- ── Tabela de regras de recorrência ──────────────────────────────────────
create table public.task_recurrence_rules (
  id uuid primary key default uuid_generate_v4(),

  -- Tarefa "modelo"/mais recente da série — ver tasks.recurrence_rule_id
  -- pra achar todas as ocorrências já geradas.
  task_id uuid not null references public.tasks(id) on delete cascade,
  list_id uuid not null references public.lists(id) on delete cascade,
  created_by uuid references public.profiles(id) on delete set null,
  enabled boolean not null default true,

  -- Frequência
  frequency_type text not null check (frequency_type in ('daily','weekly','monthly','yearly','custom')),
  "interval" integer not null default 1 check ("interval" > 0),
  weekdays integer[] not null default '{}',           -- 0=domingo..6=sábado (weekly)
  month_day integer check (month_day between 1 and 31), -- dia fixo do mês (monthly)
  month_week integer check (month_week between 1 and 5), -- 1º..4º, 5=último (monthly "nth weekday")
  month_weekday integer check (month_weekday between 0 and 6),

  -- Agenda
  start_at timestamptz not null,
  next_run_at timestamptz,
  timezone text not null default 'America/Sao_Paulo',

  -- Modo de disparo (ver seção 5 da issue — NÃO são equivalentes)
  trigger_mode text not null default 'on_schedule' check (trigger_mode in ('on_schedule','on_complete','days_after_complete')),
  days_after_complete integer check (days_after_complete > 0),

  create_new_task boolean not null default true,
  skip_weekends boolean not null default false,
  skip_holidays boolean not null default false,
  weekend_shift text not null default 'next_business_day' check (weekend_shift in ('next_business_day','previous_business_day','skip')),

  -- Encerramento da série
  end_mode text not null default 'forever' check (end_mode in ('forever','count','until')),
  end_at timestamptz,
  max_occurrences integer check (max_occurrences > 0),
  occurrences_created integer not null default 0,

  update_status_to text,
  inherit_options jsonb not null default '{}'::jsonb,
  overlap_policy text not null default 'create_and_flag' check (overlap_policy in ('create_anyway','skip_new','postpone','create_and_flag','escalate')),
  misfire_policy text not null default 'create_latest_only' check (misfire_policy in ('skip_past','create_latest_only','create_all_up_to_limit')),

  last_generated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint task_recurrence_rules_days_after_complete_requires_mode
    check (days_after_complete is null or trigger_mode = 'days_after_complete'),
  constraint task_recurrence_rules_end_mode_fields
    check (
      (end_mode = 'count' and max_occurrences is not null)
      or (end_mode = 'until' and end_at is not null)
      or (end_mode = 'forever' and max_occurrences is null and end_at is null)
    )
);

comment on table public.task_recurrence_rules is
  'Issue #184 fase 1: regra de recorrência. Motor de geração (scheduler) e UI ficam pra fases seguintes.';

create trigger task_recurrence_rules_updated_at
  before update on public.task_recurrence_rules
  for each row execute function public.update_updated_at_column();

-- ── Vínculo das ocorrências geradas com a regra/série ────────────────────
alter table public.tasks
  add column recurrence_rule_id uuid references public.task_recurrence_rules(id) on delete set null,
  add column recurrence_parent_task_id uuid references public.tasks(id) on delete set null,
  add column recurrence_sequence integer,
  add column scheduled_occurrence_at timestamptz;

comment on column public.tasks.recurrence_rule_id is 'Issue #184: regra que gerou esta ocorrência (null = tarefa comum).';
comment on column public.tasks.recurrence_parent_task_id is 'Issue #184: ocorrência anterior da mesma série (encadeamento, não obrigatório pro cálculo).';
comment on column public.tasks.recurrence_sequence is 'Issue #184: posição da ocorrência na série (1, 2, 3...).';
comment on column public.tasks.scheduled_occurrence_at is 'Issue #184: data/hora que esta ocorrência representa na agenda da regra — base da chave de idempotência.';

-- ── Idempotência (seção 19 da issue) ─────────────────────────────────────
-- Nunca duas tarefas para a mesma (regra, data agendada) — protege contra
-- retry, execução dupla do scheduler ou corrida entre workers.
create unique index task_recurrence_occurrence_unique
  on public.tasks (recurrence_rule_id, scheduled_occurrence_at)
  where recurrence_rule_id is not null;

-- ── Índices de performance (seção 27 da issue) ───────────────────────────
create index idx_task_recurrence_rules_next_run_at
  on public.task_recurrence_rules (next_run_at)
  where enabled = true;
create index idx_task_recurrence_rules_enabled on public.task_recurrence_rules (enabled);
create index idx_task_recurrence_rules_task_id on public.task_recurrence_rules (task_id);
create index idx_task_recurrence_rules_list_id on public.task_recurrence_rules (list_id);
create index idx_tasks_recurrence_rule_id on public.tasks (recurrence_rule_id) where recurrence_rule_id is not null;
create index idx_tasks_scheduled_occurrence_at on public.tasks (scheduled_occurrence_at) where scheduled_occurrence_at is not null;

-- ── RLS ───────────────────────────────────────────────────────────────────
-- Reaproveita as MESMAS funções de autorização já usadas por tasks/lists
-- (can_access_task, can_access_list) — mesma regra de acesso, nada paralelo
-- nem mais permissivo.
alter table public.task_recurrence_rules enable row level security;

create policy task_recurrence_rules_select on public.task_recurrence_rules
  for select
  using (public.can_access_task(task_id));

create policy task_recurrence_rules_ins on public.task_recurrence_rules
  for insert
  with check (public.can_access_list(list_id));

create policy task_recurrence_rules_upd on public.task_recurrence_rules
  for update
  using (public.can_access_task(task_id))
  with check (public.can_access_list(list_id));

create policy task_recurrence_rules_del on public.task_recurrence_rules
  for delete
  using (public.can_access_task(task_id));
