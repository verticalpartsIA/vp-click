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
import { CustomFieldValue, Task, TaskPriority } from '../types';

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
async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PostgrestResult<T>>,
  label: string,
  startFrom = 0,
): Promise<T[]> {
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

  const rows: CustomFieldValueRow[] = [];
  for (let i = 0; i < uniqueIds.length; i += SUBENTITY_CHUNK) {
    const slice = uniqueIds.slice(i, i + SUBENTITY_CHUNK);
    const { data, error } = await supabase
      .from('custom_field_values')
      .select('field_id, entity_id, value')
      .in('entity_id', slice);

    if (error) {
      console.error('taskRepo.fetchCustomFieldValuesByEntityIds: erro ao carregar lote:', error);
      continue;
    }
    if (data) rows.push(...(data as CustomFieldValueRow[]));
  }

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

// Busca uma sub-entidade filtrando por task_id em lotes seguros de IDs.
async function fetchSubEntityInChunks<T>(
  taskIds: string[],
  build: (ids: string[]) => PromiseLike<PostgrestResult<T>>,
  label: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < taskIds.length; i += SUBENTITY_CHUNK) {
    const slice = taskIds.slice(i, i + SUBENTITY_CHUNK);
    if (slice.length === 0) continue;
    const { data: part, error } = await build(slice);
    if (error) {
      console.error(`taskRepo.hydrateTaskRows: erro ao carregar ${label} (lote ${i / SUBENTITY_CHUNK}):`, error);
      continue;
    }
    if (part) out.push(...part);
  }
  return out;
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
