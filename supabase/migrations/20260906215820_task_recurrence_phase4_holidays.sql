
-- Fase 4 da issue #184 (seção 11): fonte própria de feriados, não hardcoded.
-- Uma linha por data (feriados móveis como Carnaval mudam de dia a cada ano,
-- então não dá pra representar só mês/dia fixo) — o RH/admin cadastra o
-- calendário do ano.
create table public.company_holidays (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  name text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index company_holidays_date_unique on public.company_holidays (date);

alter table public.company_holidays enable row level security;

-- Leitura livre pra qualquer autenticado (o cliente também usa isso pra
-- pré-visualizar "próximas ocorrências" respeitando feriados); escrita só
-- is_manager() (mesma função já usada pra config de custom_fields/status).
create policy company_holidays_select on public.company_holidays
  for select to authenticated using (true);
create policy company_holidays_write on public.company_holidays
  for all to authenticated using (is_manager()) with check (is_manager());
