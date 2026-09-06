// taskRepo — porta de LEITURA de tarefas (Ports & Adapters).
//
// Concentra todo o acesso ao Supabase para *ler* tarefas: paginação (teto de
// ~1000 linhas do PostgREST), hidratação de sub-entidades em lotes, busca
// server-side, índice de contagem e carga sob demanda do detalhe. O App
// consome uma interface pequena e não conhece nomes de coluna nem o formato
// das linhas — esse conhecimento vive aqui. RLS continua sendo o portão de
// visibilidade no servidor.
//
// Sem React: são funções puras de acesso a dados, testáveis por si só (troque
// `supabase` por um fake no teste). Cobre leitura, escrita (nível-tarefa e
// sub-entidades), duplicação, dashboard e ações em massa. A orquestração e as
// regras de negócio continuam no App (viram um TaskService na Fase 2).
import { supabase } from './supabase';
import { CustomFieldValue, Task, TaskPriority, TaskRecurrenceRule } from '../types';

const PAGE_SIZE = 1000;
export const INITIAL_TASK_PAGE_SIZE = 100;
// Um único .in('task_id', [milhares de UUIDs]) gera uma URL de dezenas de
// milhares de caracteres e o servidor responde 400. Quebramos em lotes de 150
// IDs (URL segura) e concatenamos os resultados.
const SUBENTITY_CHUNK = 150;
const TASK_ROW_SELECT = [
  'id',
  'title',
  'description',
  'status',
  'priority',
  'main_assignee_id',
  'secondary_assignee_ids',
  'start_date',
  'due_date',
  'extension_count',
  'list_id',
  'project_id',
  'parent_id',
  'created_at',
  'created_by',
  'tags',
  'is_milestone',
  'recurrence_rule_id',
  'recurrence_parent_task_id',
  'recurrence_sequence',
  'scheduled_occurrence_at',
  'archived_at',
  'archived_by',
  'deleted_at',
  'deleted_by',
  'purge_after',
  'deletion_reason_code',
  'deletion_reason_text',
].join(',');

// ── Formato cru das linhas do banco (snake_case) ────────────────────────────
export interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  main_assignee_id: string;
  secondary_assignee_ids: string[] | null;
  start_date: string | null;
  due_date: string | null;
  extension_count: number | null;
  list_id: string | null;
  project_id: string | null;
  parent_id: string | null;
  created_at: string;
  created_by: string | null;
  tags: string[] | null;
  is_milestone: boolean | null;
  recurrence_rule_id: string | null;
  recurrence_parent_task_id: string | null;
  recurrence_sequence: number | null;
  scheduled_occurrence_at: string | null;
  archived_at: string | null;
  archived_by: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  purge_after: string | null;
  deletion_reason_code: string | null;
  deletion_reason_text: string | null;
}
interface AttachmentRow { id: string; task_id: string; name: string; url: string; type: string; size: number; uploaded_at: string; }
interface CommentRow {
  id: string; task_id: string; user_id: string; text: string; created_at: string; updated_at: string | null;
  parent_comment_id: string | null; assigned_to: string | null; assigned_by: string | null;
  resolved_at: string | null; resolved_by: string | null;
}
interface ExtensionLogRow { id: string; task_id: string; old_date: string | null; new_date: string | null; reason: string | null; updated_by: string | null; created_at: string; }
interface ChecklistRow { id: string; task_id: string; text: string; completed: boolean; }
interface ActivityRow { id: string; task_id: string; user_id: string; type: string; old_value: string | null; new_value: string | null; created_at: string; }
interface WatcherRow { task_id: string; user_id: string; }
interface CountRow { id: string; list_id: string | null; status: string }
export interface TaskCountSummary { listId: string | null; status: string; count: number }
interface TaskCountSummaryRow { list_id: string | null; status: string; total_count: number | string }
export interface DashboardSummaryRow {
  listId: string | null;
  mainAssigneeId: string | null;
  status: string;
  priority: string;
  healthKey: string;
  isExtended: boolean;
  count: number;
}
interface DashboardSummaryDbRow {
  list_id: string | null;
  main_assignee_id: string | null;
  status: string;
  priority: string;
  health_key: string;
  is_extended: boolean;
  count: number | string;
}
interface CustomFieldValueRow { field_id: string; entity_id: string; value: unknown }

// Resposta genérica do PostgREST usada nas assinaturas dos builders paginados.
type PostgrestResult<T> = { data: T[] | null; error: unknown };

// ── Mapeadores DB (snake_case) → domínio (camelCase) ────────────────────────
const mapAttachment = (a: AttachmentRow) => ({
  id: a.id, name: a.name, url: a.url, type: a.type, size: a.size, uploadedAt: a.uploaded_at,
});
const mapComment = (c: CommentRow) => ({
  id: c.id, userId: c.user_id, text: c.text, timestamp: c.created_at, updatedAt: c.updated_at || undefined,
  parentCommentId: c.parent_comment_id || undefined,
  assignedTo: c.assigned_to || undefined,
  assignedBy: c.assigned_by || undefined,
  resolvedAt: c.resolved_at || undefined,
  resolvedBy: c.resolved_by || undefined,
});
const mapLog = (l: ExtensionLogRow) => ({
  id: l.id, oldDate: l.old_date, newDate: l.new_date, reason: l.reason, updatedBy: l.updated_by, timestamp: l.created_at,
});
const mapChecklist = (ck: ChecklistRow) => ({ id: ck.id, text: ck.text, completed: ck.completed });
const mapActivity = (act: ActivityRow) => ({
  id: act.id, taskId: act.task_id, userId: act.user_id, type: act.type,
  oldValue: act.old_value, newValue: act.new_value, createdAt: act.created_at,
});

// Campos de nível-tarefa (sem sub-entidades).
const mapTaskCore = (d: TaskRow) => ({
  id: d.id,
  title: d.title,
  description: d.description || '',
  status: d.status,
  priority: d.priority as TaskPriority,
  mainAssigneeId: d.main_assignee_id,
  secondaryAssigneeIds: d.secondary_assignee_ids || [],
  startDate: d.start_date,
  dueDate: d.due_date,
  extensionCount: d.extension_count || 0,
  listId: d.list_id,
  projectId: d.project_id,
  parentId: d.parent_id,
  createdAt: d.created_at,
  createdBy: d.created_by || undefined,
  tags: d.tags || [],
  isMilestone: d.is_milestone ?? false,
  recurrenceRuleId: d.recurrence_rule_id || undefined,
  recurrenceParentTaskId: d.recurrence_parent_task_id || undefined,
  recurrenceSequence: d.recurrence_sequence ?? undefined,
  scheduledOccurrenceAt: d.scheduled_occurrence_at || undefined,
  archivedAt: d.archived_at || undefined,
  archivedBy: d.archived_by || undefined,
  deletedAt: d.deleted_at || undefined,
  deletedBy: d.deleted_by || undefined,
  purgeAfter: d.purge_after || undefined,
  deletionReasonCode: d.deletion_reason_code || undefined,
  deletionReasonText: d.deletion_reason_text || undefined,
});

// Task "shell": campos preenchidos, sub-entidades vazias. Usado nas listagens,
// que escalam a milhares de tarefas justamente por não hidratar tudo — o
// detalhe é carregado sob demanda ao abrir a tarefa (ver fetchTaskDetails).
export function mapRowToTaskShell(d: TaskRow): Task {
  return {
    ...mapTaskCore(d),
    extensionHistory: [],
    checklists: [],
    comments: [],
    attachments: [],
    activities: [],
    watcherIds: [],
  } as Task;
}

// Paginação genérica: busca todas as páginas de `build` até esgotar.
//
// Com `countQuery`: pede a contagem exata primeiro (uma consulta leve, sem
// linhas — `head: true`) e, sabendo o total, dispara TODAS as páginas de
// dados em paralelo via Promise.all, em vez de uma atrás da outra. Sem isso,
// um escopo grande (ex.: pasta com ~3400 tarefas = 4 páginas de 1000) somava
// a latência de cada página em série — ~16s observados em produção pra essa
// pasta específica (achado em 2026-09-06, /equipamentos/02-projeto-em-
// andamento). Se a contagem falhar por qualquer motivo, cai pro loop
// sequencial de sempre — nunca fica sem dado por causa dessa otimização.
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PostgrestResult<T>>,
  label: string,
  startFrom = 0,
  countQuery?: () => PromiseLike<{ count: number | null; error: unknown }>,
): Promise<T[]> {
  if (countQuery) {
    try {
      const { count, error: countError } = await countQuery();
      if (!countError && typeof count === 'number') {
        if (count <= startFrom) return [];
        const pageStarts: number[] = [];
        for (let from = startFrom; from < count; from += PAGE_SIZE) pageStarts.push(from);
        const pages = await Promise.all(pageStarts.map((from) => build(from, from + PAGE_SIZE - 1)));
        const all: T[] = [];
        for (const { data: page, error } of pages) {
          if (error) {
            console.error(`taskRepo.${label}: erro ao paginar (paralelo):`, error);
            throw error;
          }
          if (page) all.push(...page);
        }
        return all;
      }
    } catch (err) {
      console.error(`taskRepo.${label}: contagem falhou, caindo para paginação sequencial:`, err);
    }
  }

  let all: T[] = [];
  let from = startFrom;
  while (true) {
    const { data: page, error } = await build(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error(`taskRepo.${label}: erro ao paginar:`, error);
      // Propaga o erro em vez de devolver o que já foi acumulado (possivelmente
      // vazio): um resultado parcial silencioso é indistinguível de "sem
      // tarefas" para quem chama, e a tela fica vazia até um F5 manual.
      throw error;
    }
    if (!page || page.length === 0) break;
    all = all.concat(page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

async function fetchTaskRowsRange(
  listIds: string[] | null,
  from: number,
  to: number,
  label: string,
): Promise<TaskRow[]> {
  const q = supabase.from('tasks').select(TASK_ROW_SELECT);
  const { data, error } = await (listIds ? q.in('list_id', listIds) : q)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to);

  if (error) {
    console.error(`taskRepo.${label}: erro ao carregar página:`, error);
    throw error;
  }
  return (data || []) as TaskRow[];
}

async function fetchTaskRowsBySingleListRange(
  listId: string,
  from: number,
  to: number,
  label: string,
): Promise<TaskRow[]> {
  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_ROW_SELECT)
    .eq('list_id', listId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .range(from, to);

  if (error) {
    console.error(`taskRepo.${label}: erro ao carregar página:`, error);
    throw error;
  }
  return (data || []) as TaskRow[];
}

// Linhas cruas de `tasks` no escopo. `listIds === null` = todas as visíveis
// (RLS restringe); caso contrário, filtra por esse conjunto de listas.
export function fetchTaskRowsByListIds(listIds: string[] | null): Promise<TaskRow[]> {
  return fetchAllPages<TaskRow>(
    (from, to) => {
      const q = supabase.from('tasks').select(TASK_ROW_SELECT);
      return (listIds ? q.in('list_id', listIds) : q)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to);
    },
    'fetchTaskRowsByListIds',
    0,
    async () => {
      const q = supabase.from('tasks').select('id', { count: 'exact', head: true });
      const { count, error } = await (listIds ? q.in('list_id', listIds) : q);
      return { count, error };
    },
  );
}

export function fetchInitialTaskRowsByListIds(listIds: string[] | null): Promise<TaskRow[]> {
  return fetchTaskRowsRange(listIds, 0, INITIAL_TASK_PAGE_SIZE - 1, 'fetchInitialTaskRowsByListIds');
}

export function fetchRemainingTaskRowsByListIds(listIds: string[] | null): Promise<TaskRow[]> {
  return fetchAllPages<TaskRow>(
    (from, to) => {
      const q = supabase.from('tasks').select(TASK_ROW_SELECT);
      return (listIds ? q.in('list_id', listIds) : q)
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to);
    },
    'fetchRemainingTaskRowsByListIds',
    INITIAL_TASK_PAGE_SIZE,
    async () => {
      const q = supabase.from('tasks').select('id', { count: 'exact', head: true });
      const { count, error } = await (listIds ? q.in('list_id', listIds) : q);
      return { count, error };
    },
  );
}

// Caminho quente da sidebar: quando o usuário abre UMA lista, deixa a consulta
// explícita em list_id = X para o Postgres usar o índice mais direto possível.
export function fetchTaskRowsByListId(listId: string): Promise<TaskRow[]> {
  return fetchAllPages<TaskRow>(
    (from, to) => supabase
      .from('tasks')
      .select(TASK_ROW_SELECT)
      .eq('list_id', listId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    'fetchTaskRowsByListId',
    0,
    async () => {
      const { count, error } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', listId);
      return { count, error };
    },
  );
}

export function fetchInitialTaskRowsByListId(listId: string): Promise<TaskRow[]> {
  return fetchTaskRowsBySingleListRange(listId, 0, INITIAL_TASK_PAGE_SIZE - 1, 'fetchInitialTaskRowsByListId');
}

export function fetchRemainingTaskRowsByListId(listId: string): Promise<TaskRow[]> {
  return fetchAllPages<TaskRow>(
    (from, to) => supabase
      .from('tasks')
      .select(TASK_ROW_SELECT)
      .eq('list_id', listId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    'fetchRemainingTaskRowsByListId',
    INITIAL_TASK_PAGE_SIZE,
    async () => {
      const { count, error } = await supabase
        .from('tasks')
        .select('id', { count: 'exact', head: true })
        .eq('list_id', listId);
      return { count, error };
    },
  );
}

export function fetchMyTaskRows(userId: string): Promise<TaskRow[]> {
  return fetchAllPages<TaskRow>(
    (from, to) => supabase
      .from('tasks')
      .select(TASK_ROW_SELECT)
      .or(`main_assignee_id.eq.${userId},secondary_assignee_ids.cs.{${userId}},created_by.eq.${userId}`)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to),
    'fetchMyTaskRows',
  );
}

// Índice leve (list_id + status) de TODAS as tarefas visíveis — alimenta os
// contadores exatos por lista, independentes do escopo carregado.
// `listIds` (as listas acessíveis) filtra a busca por list_id: usa o índice
// idx_tasks_list_id em vez de varrer todas as ~7k tarefas avaliando a RLS
// can_access_task por linha (que sem filtro custa ~1,7s p/ não-admins). Como os
// badges só existem para listas acessíveis, filtrar por elas é equivalente e
// muito mais rápido. `null` = sem filtro (a RLS restringe; caminho antigo).
async function fetchTaskCountIndexFallback(listIds: string[] | null = null): Promise<TaskCountSummary[]> {
  if (listIds && listIds.length === 0) return [];
  const rows = await fetchAllPages<CountRow>(
    (from, to) => {
      const q = supabase.from('tasks').select('id, list_id, status');
      return (listIds ? q.in('list_id', listIds) : q)
        .order('list_id', { ascending: true, nullsFirst: true })
        .order('status', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to);
    },
    'fetchTaskCountIndex',
  );
  const map = new Map<string, TaskCountSummary>();
  for (const row of rows) {
    const key = `${row.list_id ?? ''}::${row.status}`;
    const current = map.get(key) ?? { listId: row.list_id, status: row.status, count: 0 };
    current.count += 1;
    map.set(key, current);
  }
  return Array.from(map.values());
}

// Contadores agregados no banco: reduz o tráfego da sidebar de milhares de
// linhas para poucas linhas por lista/status. O fallback evita janela quebrada
// caso o front novo seja publicado antes da migration/RPC estar aplicada.
export async function fetchTaskCountIndex(listIds: string[] | null = null): Promise<TaskCountSummary[]> {
  if (listIds && listIds.length === 0) return [];

  const { data, error } = await supabase.rpc('get_task_counts_by_list', {
    p_list_ids: listIds,
  });

  if (!error) {
    return ((data || []) as TaskCountSummaryRow[]).map((row) => ({
      listId: row.list_id,
      status: row.status,
      count: Number(row.total_count) || 0,
    }));
  }

  console.warn('taskRepo.fetchTaskCountIndex: fallback sem RPC:', error);
  return fetchTaskCountIndexFallback(listIds);
}

export type DashboardPeriod = 'all' | '7d' | '30d' | '90d';

// Resumo agregado do Dashboard (visão global): uma célula por combinação de
// lista/responsável/status/prioridade/saúde/extensão, calculada no banco
// (get_dashboard_summary) — evita baixar uma linha por tarefa (chegando a
// dezenas de milhares) só pra montar os widgets do Dashboard. `null` sinaliza
// pro chamador que a função ainda não foi migrada pro banco (precisa aplicar
// supabase/migrations/20260829013000_dashboard_summary_rpc.sql manualmente
// em produção — mesma ressalva de outras RPCs deste arquivo); sem fallback
// client-side aqui porque ele exigiria baixar exatamente as milhares de
// linhas que esta função existe pra evitar.
export async function fetchDashboardSummary(period: DashboardPeriod): Promise<DashboardSummaryRow[] | null> {
  const { data, error } = await supabase.rpc('get_dashboard_summary', { p_period: period });
  if (error) {
    console.warn('taskRepo.fetchDashboardSummary: RPC indisponível:', error);
    return null;
  }
  return ((data ?? []) as DashboardSummaryDbRow[]).map((row) => ({
    listId: row.list_id,
    mainAssigneeId: row.main_assignee_id,
    status: row.status,
    priority: row.priority,
    healthKey: row.health_key,
    isExtended: row.is_extended,
    count: Number(row.count) || 0,
  }));
}

export async function fetchCustomFieldValuesByEntityIds(entityIds: string[]): Promise<CustomFieldValue[]> {
  const uniqueIds = Array.from(new Set(entityIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  // Mesmo motivo do fetchSubEntityInChunks: lotes são requisições
  // independentes, então disparamos em paralelo em vez de um atrás do outro.
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += SUBENTITY_CHUNK) {
    chunks.push(uniqueIds.slice(i, i + SUBENTITY_CHUNK));
  }
  const chunkResults = await Promise.all(chunks.map(async (slice) => {
    const { data, error } = await supabase
      .from('custom_field_values')
      .select('field_id, entity_id, value')
      .in('entity_id', slice);

    if (error) {
      console.error('taskRepo.fetchCustomFieldValuesByEntityIds: erro ao carregar lote:', error);
      return [];
    }
    return (data as CustomFieldValueRow[]) ?? [];
  }));
  const rows: CustomFieldValueRow[] = chunkResults.flat();

  return rows.map((v) => ({
    fieldId: v.field_id,
    entityId: v.entity_id,
    value: v.value,
  }));
}

// Busca server-side por título/descrição. A RPC faz a busca perto do banco,
// aplica `can_access_task` explicitamente e evita varrer a lista carregada no
// navegador. O fallback preserva o comportamento durante a janela de deploy em
// que o front novo pode chegar antes da migration.
export async function searchTaskRowsByTitle(term: string, limit = 200): Promise<TaskRow[]> {
  const pattern = `%${term.replace(/[\\%_]/g, '\\$&')}%`;
  const { data: rpcData, error: rpcError } = await supabase.rpc('search_tasks', {
    p_term: term,
    p_limit: limit,
  });

  if (!rpcError) return (rpcData || []) as TaskRow[];
  console.warn('taskRepo.searchTaskRowsByTitle: fallback sem RPC:', rpcError);

  const { data, error } = await supabase
    .from('tasks')
    .select(TASK_ROW_SELECT)
    .ilike('title', pattern)
    .limit(limit);
  if (error) { console.error('taskRepo.searchTaskRowsByTitle: erro na busca:', error); return []; }
  return (data || []) as TaskRow[];
}

// Busca uma sub-entidade filtrando por task_id em lotes seguros de IDs. Os
// lotes são requisições independentes (o corte de 150 é só pra manter a URL
// dentro do limite, ver SUBENTITY_CHUNK) — disparar todos em paralelo em vez
// de um atrás do outro evita somar a latência de cada round-trip em série
// (ex.: uma pasta com ~3400 tarefas gera ~23 lotes; em série isso passava de
// meio minuto só nessa sub-entidade, achado em produção com /equipamentos/
// 02-projeto-em-andamento em 2026-09-06).
async function fetchSubEntityInChunks<T>(
  taskIds: string[],
  build: (ids: string[]) => PromiseLike<PostgrestResult<T>>,
  label: string,
): Promise<T[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < taskIds.length; i += SUBENTITY_CHUNK) {
    const slice = taskIds.slice(i, i + SUBENTITY_CHUNK);
    if (slice.length > 0) chunks.push(slice);
  }
  const results = await Promise.all(chunks.map(async (slice, idx) => {
    const { data: part, error } = await build(slice);
    if (error) {
      console.error(`taskRepo.hydrateTaskRows: erro ao carregar ${label} (lote ${idx}):`, error);
      return [];
    }
    return part ?? [];
  }));
  return results.flat();
}

// Hidrata linhas de `tasks` em objetos Task completos, buscando as
// sub-entidades em lotes seguros de IDs (ver SUBENTITY_CHUNK).
export async function hydrateTaskRows(rows: TaskRow[]): Promise<Task[]> {
  if (!rows || rows.length === 0) return [];
  const taskIds = rows.map((d) => d.id);

  const [attData, commData, logData, checkData, actData, watchData] = await Promise.all([
    fetchSubEntityInChunks<AttachmentRow>(taskIds, (ids) => supabase.from('task_attachments').select('*').in('task_id', ids), 'task_attachments'),
    fetchSubEntityInChunks<CommentRow>(taskIds, (ids) => supabase.from('task_comments').select('*').in('task_id', ids).is('deleted_at', null), 'task_comments'),
    fetchSubEntityInChunks<ExtensionLogRow>(taskIds, (ids) => supabase.from('task_extension_logs').select('*').in('task_id', ids), 'task_extension_logs'),
    fetchSubEntityInChunks<ChecklistRow>(taskIds, (ids) => supabase.from('task_checklists').select('*').in('task_id', ids), 'task_checklists'),
    fetchSubEntityInChunks<ActivityRow>(taskIds, (ids) => supabase.from('task_activities').select('*').in('task_id', ids), 'task_activities'),
    fetchSubEntityInChunks<WatcherRow>(taskIds, (ids) => supabase.from('task_watchers').select('task_id, user_id').in('task_id', ids), 'task_watchers'),
  ]);

  return rows.map((d) => ({
    ...mapTaskCore(d),
    extensionHistory: logData.filter((l) => l.task_id === d.id).map(mapLog),
    checklists: checkData.filter((ck) => ck.task_id === d.id).map(mapChecklist),
    comments: commData.filter((c) => c.task_id === d.id).map(mapComment),
    attachments: attData.filter((a) => a.task_id === d.id).map(mapAttachment),
    activities: actData.filter((act) => act.task_id === d.id).map(mapActivity),
    watcherIds: watchData.filter((w) => w.task_id === d.id).map((w) => w.user_id),
  } as Task));
}

// Sub-entidades de UMA tarefa (lazy-load ao abrir o detalhe).
export async function fetchTaskDetails(taskId: string): Promise<Partial<Task>> {
  const [attRes, commRes, logRes, checkRes, actRes, watchRes] = await Promise.all([
    supabase.from('task_attachments').select('*').eq('task_id', taskId),
    supabase.from('task_comments').select('*').eq('task_id', taskId).is('deleted_at', null),
    supabase.from('task_extension_logs').select('*').eq('task_id', taskId),
    supabase.from('task_checklists').select('*').eq('task_id', taskId),
    supabase.from('task_activities').select('*').eq('task_id', taskId),
    supabase.from('task_watchers').select('task_id, user_id').eq('task_id', taskId),
  ]);
  return {
    attachments: ((attRes.data || []) as AttachmentRow[]).map(mapAttachment),
    comments: ((commRes.data || []) as CommentRow[]).map(mapComment),
    extensionHistory: ((logRes.data || []) as ExtensionLogRow[]).map(mapLog),
    checklists: ((checkRes.data || []) as ChecklistRow[]).map(mapChecklist),
    activities: ((actRes.data || []) as ActivityRow[]).map(mapActivity),
    watcherIds: ((watchRes.data || []) as WatcherRow[]).map((w) => w.user_id),
  } as Partial<Task>;
}

// ── Escrita (mutações de nível-tarefa) ──────────────────────────────────────
// Regras de negócio (status padrão, validações, automações, estado otimista)
// continuam no App; aqui vive só o acesso ao banco + mapeamento. As funções
// devolvem um resultado em domínio (Task ou ok/erro), sem expor o formato de
// erro do PostgREST ao chamador.

export interface NewTaskInput {
  id?: string;
  title: string;
  description?: string;
  status: string;
  priority: TaskPriority;
  mainAssigneeId: string;
  secondaryAssigneeIds?: string[];
  startDate: string;
  dueDate: string;
  listId: string | null;
  projectId?: string | null;
  parentId?: string | null;
  createdBy: string;
}

function newUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// Insere uma tarefa e devolve o Task recém-criado (sub-entidades vazias).
// Com RLS ativa, o INSERT pode passar e o RETURNING falhar no SELECT da linha
// recém-criada. Por isso geramos o id no cliente e gravamos sem `.select()`.
export async function insertTask(input: NewTaskInput): Promise<{ task: Task } | { error: string }> {
  const id = input.id || newUuid();
  const createdAt = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .insert({
      id,
      title: input.title,
      description: input.description ?? '',
      status: input.status,
      priority: input.priority,
      main_assignee_id: input.mainAssigneeId,
      secondary_assignee_ids: input.secondaryAssigneeIds ?? [],
      start_date: input.startDate || null,
      // `''` (sem data) precisa virar `null` — as colunas são `date`
      // nullable, e o Postgres rejeita `''` como data (mesmo ajuste feito em
      // updateTaskFields acima).
      due_date: input.dueDate || null,
      list_id: input.listId,
      project_id: input.projectId ?? null,
      parent_id: input.parentId ?? null,
      created_by: input.createdBy,
    });
  if (error) return { error: error.message ?? 'Falha ao criar tarefa.' };
  return {
    task: {
      id,
      title: input.title,
      description: input.description ?? '',
      status: input.status,
      priority: input.priority,
      mainAssigneeId: input.mainAssigneeId,
      secondaryAssigneeIds: input.secondaryAssigneeIds ?? [],
      startDate: input.startDate,
      dueDate: input.dueDate,
      extensionCount: 0,
      extensionHistory: [],
      checklists: [],
      comments: [],
      attachments: [],
      activities: [],
      listId: input.listId || '',
      projectId: input.projectId ?? null,
      parentId: input.parentId ?? undefined,
      createdAt,
      createdBy: input.createdBy,
      tags: [],
      watcherIds: [],
    },
  };
}

// Atualiza os campos de nível-tarefa (não mexe em sub-entidades).
//
// `main_assignee_id` (uuid) e `start_date`/`due_date` (date) são colunas
// nullable no banco, mas `Task` tipa esses campos como `string` (convenção
// já usada em outras telas pra representar "vazio" como `''`, ver
// TableView/KanbanView) — sem o `|| null` aqui, uma tentativa de limpar um
// desses campos mandaria `''` pro Postgres, que rejeita `''` como uuid/date
// (erro silencioso do lado do cliente, valor antigo nunca muda no banco).
export async function updateTaskFields(task: Task): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase
    .from('tasks')
    .update({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      main_assignee_id: task.mainAssigneeId || null,
      secondary_assignee_ids: task.secondaryAssigneeIds,
      start_date: task.startDate || null,
      due_date: task.dueDate || null,
      list_id: task.listId,
      project_id: task.projectId,
      parent_id: task.parentId ?? null,
      extension_count: task.extensionCount,
      is_milestone: task.isMilestone ?? false,
    })
    .eq('id', task.id);
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

// Exclui uma tarefa por id. Enquanto a migration que torna parent_id CASCADE
// não estiver aplicada em todos os ambientes, remove a árvore de subtarefas de
// baixo para cima para não esbarrar na FK tasks_parent_id_fkey (NO ACTION).
async function deleteTaskTree(taskId: string, visited = new Set<string>()): Promise<{ ok: true } | { ok: false; message: string }> {
  if (visited.has(taskId)) {
    return { ok: false, message: 'Foi detectado um ciclo inválido entre tarefa e subtarefa.' };
  }
  visited.add(taskId);

  const { data: children, error: childrenError } = await supabase
    .from('tasks')
    .select('id')
    .eq('parent_id', taskId);
  if (childrenError) return { ok: false, message: childrenError.message };

  for (const child of children || []) {
    const result = await deleteTaskTree(child.id, visited);
    if (!result.ok) return result;
  }

  const { data, error } = await supabase
    .from('tasks')
    .delete()
    .eq('id', taskId)
    .select('id');
  if (error) return { ok: false, message: error.message };
  if (!data?.length) {
    return { ok: false, message: 'A tarefa não foi encontrada ou Você não possui permissão para excluí-la.' };
  }
  return { ok: true };
}

export async function deleteTask(taskId: string): Promise<{ ok: true } | { ok: false; message: string }> {
  return deleteTaskTree(taskId);
}

// ── Escrita de sub-entidades ────────────────────────────────────────────────
// Padrão de retorno `{ <dado>?, error }` espelhando o próprio Supabase: o App
// checa `error` e cuida do estado otimista/toasts. `error` é uma mensagem em
// texto (o formato do PostgREST não vaza para o chamador).

export async function insertAttachment(
  taskId: string,
  att: { name?: string; url?: string; type?: string; size?: number },
): Promise<{ attachment: ReturnType<typeof mapAttachment> | null; error: string | null }> {
  const uploadedAt = new Date().toISOString();
  const attachmentRow: AttachmentRow = {
    id: newUuid(),
    task_id: taskId,
    name: att.name || 'Anexo',
    url: att.url || '',
    type: att.type || 'application/octet-stream',
    size: att.size ?? 0,
    uploaded_at: uploadedAt,
  };

  const { error } = await supabase
    .from('task_attachments')
    .insert({
      id: attachmentRow.id,
      task_id: attachmentRow.task_id,
      name: attachmentRow.name,
      url: attachmentRow.url,
      type: attachmentRow.type,
      size: attachmentRow.size,
      uploaded_at: attachmentRow.uploaded_at,
    });
  if (error) return { attachment: null, error: error.message ?? 'registro não criado' };
  return { attachment: mapAttachment(attachmentRow), error: null };
}

// Exclui a linha do anexo e o arquivo físico do Storage. `notFound` distingue
// "registro inexistente" de erro do banco.
export async function deleteAttachment(attachmentId: string): Promise<{ error: string | null; notFound?: boolean }> {
  const { data, error } = await supabase.from('task_attachments').delete().eq('id', attachmentId).select();
  if (error) return { error: error.message };
  if (!data || data.length === 0) return { error: 'registro não encontrado.', notFound: true };
  // A URL pública contém bucket + caminho.
  const url = (data[0] as AttachmentRow)?.url || '';
  const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
  if (match) {
    const storagePath = decodeURIComponent(match[2]);
    const { error: storageError } = await supabase.storage.from(match[1]).remove([storagePath]);
    if (storageError) console.error('taskRepo.deleteAttachment: erro ao remover do Storage:', storageError);
  }
  return { error: null };
}

export async function insertComment(
  taskId: string,
  userId: string,
  text: string,
  parentCommentId?: string,
): Promise<{ comment: ReturnType<typeof mapComment> | null; error: string | null }> {
  const createdAt = new Date().toISOString();
  const commentRow: CommentRow = {
    id: newUuid(),
    task_id: taskId,
    user_id: userId,
    text,
    created_at: createdAt,
    updated_at: null,
    parent_comment_id: parentCommentId || null,
    assigned_to: null,
    assigned_by: null,
    resolved_at: null,
    resolved_by: null,
  };

  const { error } = await supabase
    .from('task_comments')
    .insert({
      id: commentRow.id,
      task_id: commentRow.task_id,
      user_id: commentRow.user_id,
      text: commentRow.text,
      created_at: commentRow.created_at,
      parent_comment_id: commentRow.parent_comment_id,
    });
  if (error) return { comment: null, error: error.message ?? 'registro não criado' };
  return { comment: mapComment(commentRow), error: null };
}

export async function updateCommentText(commentId: string, newText: string, updatedAt: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('task_comments').update({ text: newText, updated_at: updatedAt }).eq('id', commentId);
  return { error: error ? error.message : null };
}

// Soft delete do comentário E das respostas da thread (o soft delete não
// aciona o ON DELETE CASCADE, senão as respostas ficariam órfãs).
export async function softDeleteCommentThread(commentId: string, deletedAt: string): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('task_comments')
    .update({ deleted_at: deletedAt })
    .or(`id.eq.${commentId},parent_comment_id.eq.${commentId}`);
  return { error: error ? error.message : null };
}

export async function assignComment(commentId: string, assignedTo: string | null, assignedBy: string | null): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('task_comments')
    .update({ assigned_to: assignedTo, assigned_by: assignedBy, resolved_at: null, resolved_by: null })
    .eq('id', commentId);
  return { error: error ? error.message : null };
}

export async function resolveComment(commentId: string, resolvedBy: string, resolvedAt: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('task_comments').update({ resolved_at: resolvedAt, resolved_by: resolvedBy }).eq('id', commentId);
  return { error: error ? error.message : null };
}

export async function addWatcher(taskId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('task_watchers').insert({ task_id: taskId, user_id: userId });
  return { error: error ? error.message : null };
}

export async function removeWatcher(taskId: string, userId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('task_watchers').delete().eq('task_id', taskId).eq('user_id', userId);
  return { error: error ? error.message : null };
}

export async function insertActivity(
  taskId: string,
  userId: string,
  type: string,
  oldValue?: string,
  newValue?: string,
): Promise<{ activity: ReturnType<typeof mapActivity> | null; error: string | null }> {
  const { data, error } = await supabase
    .from('task_activities')
    .insert({ task_id: taskId, user_id: userId, type, old_value: oldValue, new_value: newValue })
    .select()
    .single();
  if (error || !data) return { activity: null, error: error?.message ?? 'registro não criado' };
  return { activity: mapActivity(data as ActivityRow), error: null };
}

export async function insertExtensionLog(
  taskId: string,
  log: { oldDate: string | null; newDate: string | null; reason: string | null },
  updatedBy: string,
): Promise<{ error: string | null }> {
  const { error } = await supabase
    .from('task_extension_logs')
    .insert({ task_id: taskId, old_date: log.oldDate, new_date: log.newDate, reason: log.reason, updated_by: updatedBy });
  return { error: error ? error.message : null };
}

// ── Duplicação (clone de linha de tarefa) ───────────────────────────────────
// Distinto de insertTask: aceita tags/parent explícitos. Define created_by como
// quem executou a duplicação — a cópia é uma tarefa NOVA, então o criador é o
// duplicador (antes ficava nulo, o que aparecia como "Tarefa criada" sem autor).
// Usado tanto para a tarefa clonada quanto para as subtarefas.
export interface TaskCloneInput {
  title: string;
  description: string;
  status: string;
  priority: TaskPriority;
  mainAssigneeId: string;
  secondaryAssigneeIds: string[];
  startDate: string | null;
  dueDate: string | null;
  listId: string | null;
  projectId: string | null;
  parentId: string | null;
  tags: string[];
  createdBy: string;
}

export async function insertTaskClone(input: TaskCloneInput): Promise<{ task: Task } | { error: string }> {
  const id = newUuid();
  const createdAt = new Date().toISOString();
  const { error } = await supabase
    .from('tasks')
    .insert({
      id,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      main_assignee_id: input.mainAssigneeId,
      secondary_assignee_ids: input.secondaryAssigneeIds,
      start_date: input.startDate,
      due_date: input.dueDate,
      list_id: input.listId,
      project_id: input.projectId,
      parent_id: input.parentId,
      extension_count: 0,
      tags: input.tags,
      created_by: input.createdBy,
    });
  if (error) return { error: error.message ?? 'Falha ao duplicar tarefa.' };
  return {
    task: {
      id,
      title: input.title,
      description: input.description,
      status: input.status,
      priority: input.priority,
      mainAssigneeId: input.mainAssigneeId,
      secondaryAssigneeIds: input.secondaryAssigneeIds,
      startDate: input.startDate,
      dueDate: input.dueDate,
      extensionCount: 0,
      extensionHistory: [],
      checklists: [],
      comments: [],
      attachments: [],
      activities: [],
      listId: input.listId,
      projectId: input.projectId,
      parentId: input.parentId ?? undefined,
      createdAt,
      createdBy: input.createdBy,
      tags: input.tags,
      watcherIds: [],
    },
  };
}

// ── Regra de recorrência (issue #184, fase 3 — UI de configuração) ─────────
// RLS já garante acesso (task_recurrence_rules_select/ins/upd/del usam
// can_access_task/can_access_list, ver migration da fase 1) — sem
// auto-referência na policy de SELECT, então .insert().select() é seguro
// aqui (diferente de tasks/lists/folders, que precisaram de id-no-cliente).
interface RecurrenceRuleRow {
  id: string;
  task_id: string;
  list_id: string;
  created_by: string | null;
  enabled: boolean;
  frequency_type: string;
  interval: number;
  weekdays: number[];
  month_day: number | null;
  month_week: number | null;
  month_weekday: number | null;
  start_at: string;
  next_run_at: string | null;
  timezone: string;
  trigger_mode: string;
  days_after_complete: number | null;
  create_new_task: boolean;
  skip_weekends: boolean;
  skip_holidays: boolean;
  weekend_shift: string;
  end_mode: string;
  end_at: string | null;
  max_occurrences: number | null;
  occurrences_created: number;
  update_status_to: string | null;
  inherit_options: Record<string, boolean>;
  overlap_policy: string;
  misfire_policy: string;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRecurrenceRuleRow(r: RecurrenceRuleRow): TaskRecurrenceRule {
  return {
    id: r.id,
    taskId: r.task_id,
    listId: r.list_id,
    createdBy: r.created_by ?? undefined,
    enabled: r.enabled,
    frequencyType: r.frequency_type as TaskRecurrenceRule['frequencyType'],
    interval: r.interval,
    weekdays: r.weekdays || [],
    monthDay: r.month_day ?? undefined,
    monthWeek: r.month_week ?? undefined,
    monthWeekday: r.month_weekday ?? undefined,
    startAt: r.start_at,
    nextRunAt: r.next_run_at ?? undefined,
    timezone: r.timezone,
    triggerMode: r.trigger_mode as TaskRecurrenceRule['triggerMode'],
    daysAfterComplete: r.days_after_complete ?? undefined,
    createNewTask: r.create_new_task,
    skipWeekends: r.skip_weekends,
    skipHolidays: r.skip_holidays,
    weekendShift: r.weekend_shift as TaskRecurrenceRule['weekendShift'],
    endMode: r.end_mode as TaskRecurrenceRule['endMode'],
    endAt: r.end_at ?? undefined,
    maxOccurrences: r.max_occurrences ?? undefined,
    occurrencesCreated: r.occurrences_created,
    updateStatusTo: r.update_status_to ?? undefined,
    inheritOptions: r.inherit_options || {},
    overlapPolicy: r.overlap_policy as TaskRecurrenceRule['overlapPolicy'],
    misfirePolicy: r.misfire_policy as TaskRecurrenceRule['misfirePolicy'],
    lastGeneratedAt: r.last_generated_at ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function fetchRecurrenceRuleForTask(taskId: string): Promise<TaskRecurrenceRule | null> {
  const { data, error } = await supabase
    .from('task_recurrence_rules')
    .select('*')
    .eq('task_id', taskId)
    .maybeSingle();
  if (error || !data) return null;
  return mapRecurrenceRuleRow(data as RecurrenceRuleRow);
}

export interface RecurrenceRuleInput {
  taskId: string;
  listId: string;
  createdBy: string;
  frequencyType: TaskRecurrenceRule['frequencyType'];
  interval: number;
  weekdays: number[];
  monthDay?: number | null;
  monthWeek?: number | null;
  monthWeekday?: number | null;
  startAt: string;
  nextRunAt: string | null;
  timezone: string;
  skipWeekends: boolean;
  skipHolidays: boolean;
  weekendShift: TaskRecurrenceRule['weekendShift'];
  endMode: TaskRecurrenceRule['endMode'];
  endAt?: string | null;
  maxOccurrences?: number | null;
  inheritOptions: TaskRecurrenceRule['inheritOptions'];
  overlapPolicy: TaskRecurrenceRule['overlapPolicy'];
  misfirePolicy: TaskRecurrenceRule['misfirePolicy'];
}

// Cria ou substitui a regra de recorrência da tarefa (uma tarefa tem no
// máximo uma regra — upsert por task_id). Reseta occurrences_created/
// last_generated_at ao recriar porque muda os parâmetros do zero.
export async function upsertRecurrenceRule(
  input: RecurrenceRuleInput,
  existingRuleId: string | null,
): Promise<{ rule: TaskRecurrenceRule } | { error: string }> {
  const payload = {
    task_id: input.taskId,
    list_id: input.listId,
    created_by: input.createdBy,
    enabled: true,
    frequency_type: input.frequencyType,
    interval: input.interval,
    weekdays: input.weekdays,
    month_day: input.monthDay ?? null,
    month_week: input.monthWeek ?? null,
    month_weekday: input.monthWeekday ?? null,
    start_at: input.startAt,
    next_run_at: input.nextRunAt,
    timezone: input.timezone,
    trigger_mode: 'on_schedule',
    skip_weekends: input.skipWeekends,
    skip_holidays: input.skipHolidays,
    weekend_shift: input.weekendShift,
    end_mode: input.endMode,
    end_at: input.endAt ?? null,
    max_occurrences: input.maxOccurrences ?? null,
    inherit_options: input.inheritOptions,
    overlap_policy: input.overlapPolicy,
    misfire_policy: input.misfirePolicy,
  };

  const query = existingRuleId
    ? supabase.from('task_recurrence_rules').update(payload).eq('id', existingRuleId)
    : supabase.from('task_recurrence_rules').insert(payload);

  const { data, error } = await query.select('*').single();
  if (error || !data) return { error: error?.message ?? 'Falha ao salvar a regra de recorrência.' };
  return { rule: mapRecurrenceRuleRow(data as RecurrenceRuleRow) };
}

export async function setRecurrenceRuleEnabled(ruleId: string, enabled: boolean): Promise<{ error: string | null }> {
  const { error } = await supabase.from('task_recurrence_rules').update({ enabled }).eq('id', ruleId);
  return { error: error?.message ?? null };
}

export async function deleteRecurrenceRule(ruleId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('task_recurrence_rules').delete().eq('id', ruleId);
  return { error: error?.message ?? null };
}

// Copia os checklists de uma tarefa para outra. Devolve os itens já mapeados
// (ou lista vazia se a origem não tiver checklists).
export async function copyChecklists(
  fromTaskId: string,
  toTaskId: string,
): Promise<{ items: ReturnType<typeof mapChecklist>[] } | { error: string }> {
  const { data: src } = await supabase.from('task_checklists').select('text, completed').eq('task_id', fromTaskId);
  if (!src || src.length === 0) return { items: [] };
  const rows = (src as { text: string; completed: boolean }[]).map((it) => ({
    task_id: toTaskId, text: it.text, completed: it.completed,
  }));
  const { data: inserted, error } = await supabase.from('task_checklists').insert(rows).select();
  if (error) return { error: error.message };
  return { items: ((inserted || []) as ChecklistRow[]).map(mapChecklist) };
}

// ── Dashboard ───────────────────────────────────────────────────────────────
// Linha enxuta do Dashboard: só as colunas usadas (contadores, radar de saúde,
// performance por usuário). Evita baixar `description` (texto rico) das 7000+
// tarefas — payload gigante sem ganho visível.
interface DashboardRow {
  id: string; title: string; status: string; priority: string;
  main_assignee_id: string; start_date: string | null; due_date: string | null;
  extension_count: number | null; list_id: string | null; created_at: string;
}

// Carrega os dados do Dashboard: só as tarefas por trás de "Atividade
// Recente" (os widgets agregados vêm de fetchDashboardSummary/RPC) + a lista
// de listas para os rótulos.
// Antes isso paginava a tabela `tasks` INTEIRA (fetchAllPages) só pra achar
// as poucas tarefas citadas nas 200 atividades recentes — ~9 páginas de
// ~3-4s cada num workspace com 8 mil tarefas (30s+ medido ao vivo pra ADMIN,
// que não tem filtro de lista pra reduzir o total). As atividades JÁ dizem
// exatamente quais tarefas aparecem no widget: busca essas ≤200 tarefas por
// id em vez de escanear tudo — rápido independente do tamanho do workspace.
// `listIds` vira só um filtro extra defensivo (RLS já protege de qualquer
// forma); `null` = sem filtro adicional (ADMIN).
export async function fetchDashboardData(listIds: string[] | null): Promise<{ tasks: Task[]; lists: { id: string; name: string }[] }> {
  if (listIds !== null && listIds.length === 0) return { tasks: [], lists: [] };

  const [actResult, listsResult] = await Promise.all([
    supabase
      .from('task_activities')
      .select('id,task_id,user_id,type,old_value,new_value,created_at')
      .order('created_at', { ascending: false })
      .limit(200),
    supabase.from('lists').select('id,name'),
  ]);

  const activities = (actResult.data || []) as ActivityRow[];
  const taskIds = Array.from(new Set(activities.map((a) => a.task_id)));
  if (taskIds.length === 0) return { tasks: [], lists: (listsResult.data || []) as { id: string; name: string }[] };

  let taskQuery = supabase
    .from('tasks')
    .select('id, title, status, priority, main_assignee_id, start_date, due_date, extension_count, list_id, created_at')
    .in('id', taskIds);
  if (listIds) taskQuery = taskQuery.in('list_id', listIds);
  const { data: rowsData, error } = await taskQuery;
  if (error) {
    console.error('taskRepo.fetchDashboardData: erro ao carregar tarefas:', error);
    throw error;
  }
  const rows = (rowsData || []) as DashboardRow[];
  if (rows.length === 0) return { tasks: [], lists: (listsResult.data || []) as { id: string; name: string }[] };

  const actMap = new Map<string, ActivityRow[]>();
  activities.forEach((a) => {
    if (!actMap.has(a.task_id)) actMap.set(a.task_id, []);
    actMap.get(a.task_id)!.push(a);
  });

  const tasks = rows.map((d) => ({
    ...mapRowToTaskShell(d as TaskRow),
    activities: (actMap.get(d.id) || []).map(mapActivity),
  }));

  return { tasks, lists: (listsResult.data || []) as { id: string; name: string }[] };
}

// ── Ações em massa ──────────────────────────────────────────────────────────
export async function bulkUpdateStatus(ids: string[], status: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tasks').update({ status }).in('id', ids);
  return { error: error ? error.message : null };
}

export async function bulkUpdatePriority(ids: string[], priority: TaskPriority): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tasks').update({ priority }).in('id', ids);
  return { error: error ? error.message : null };
}

export async function bulkMove(ids: string[], listId: string): Promise<{ error: string | null }> {
  const { error } = await supabase.from('tasks').update({ list_id: listId }).in('id', ids);
  return { error: error ? error.message : null };
}

export async function bulkDelete(ids: string[]): Promise<{ error: string | null }> {
  for (const id of ids) {
    const result = await deleteTask(id);
    if (!result.ok) return { error: result.message };
  }
  return { error: null };
}
