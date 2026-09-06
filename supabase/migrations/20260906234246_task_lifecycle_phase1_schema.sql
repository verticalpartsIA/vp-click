
-- Issue #185 (arquivar/excluir/restaurar tarefas) — fase 1: só o modelo de
-- dados. Arquivamento e exclusão são dimensões INDEPENDENTES do status (seção
-- 1 da issue) — nunca modelar como status = ARCHIVED/DELETED.
alter table public.tasks
  add column if not exists archived_at timestamptz,
  add column if not exists archived_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists purge_after timestamptz,
  add column if not exists deletion_reason_code text,
  add column if not exists deletion_reason_text text;

-- Índices parciais (só nas linhas que realmente estão em cada estado) —
-- consultas normais (deleted_at/archived_at IS NULL) já usam os índices
-- existentes de list_id/created_at; estes aqui servem pras views de
-- arquivadas/lixeira e pro scheduler de purge (seção 36 da issue).
create index if not exists idx_tasks_archived_at on public.tasks (archived_at) where archived_at is not null;
create index if not exists idx_tasks_deleted_at on public.tasks (deleted_at) where deleted_at is not null;
create index if not exists idx_tasks_purge_after on public.tasks (purge_after) where deleted_at is not null;
