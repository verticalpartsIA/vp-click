import { createClient, processLock } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Supabase URL e Anon Key são obrigatórios. Verifique o arquivo .env');
}

// Toda request do supabase-js (auth, PostgREST, Storage, Functions) passa por
// aqui. Sem isso, um fetch que trava depois que a aba volta de segundo plano
// (throttling do navegador suspende a conexão em andamento, ex.: o refresh de
// token automático) nunca resolve nem rejeita — e como esse fetch roda DENTRO
// do processLock acima, o lock nunca é liberado e toda chamada seguinte na
// mesma aba (criar tarefa, salvar comentário, etc.) fica presa esperando o
// lock para sempre, sem erro nenhum na tela. Um timeout por request garante
// que o fetch sempre rejeita, o que libera o lock e deixa o catch/finally de
// cada handler (ex.: handleCreateTask) rodar normalmente e mostrar o erro.
// Upload de anexo (Storage) ganha um teto maior: é o único fluxo onde uma
// requisição legitimamente lenta (arquivo grande, rede ruim) é esperada.
const DEFAULT_FETCH_TIMEOUT_MS = 20_000;
const STORAGE_FETCH_TIMEOUT_MS = 120_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const timeoutMs = url.includes('/storage/v1/') ? STORAGE_FETCH_TIMEOUT_MS : DEFAULT_FETCH_TIMEOUT_MS;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    // Se o chamador já passou um signal (raro hoje, mas respeitamos), aborta
    // também quando ele abortar, sem perder o timeout acima.
    init?.signal?.addEventListener('abort', () => controller.abort());

    return fetch(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timeoutId));
};

// Cliente público (para autenticação de usuários)
// NUNCA crie um cliente com a service_role key aqui: qualquer env VITE_* é
// embutida em texto claro no bundle JS público. Operações privilegiadas
// (auth.admin.*, SSO, bypass de RLS) vivem em Supabase Edge Functions
// (ver supabase/functions/sso-exchange e supabase/functions/admin-user-management).
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        storageKey: 'vp-click-user-auth', // Garante que a chave de armazenamento seja única
        // Por padrão, o supabase-js serializa auth.getSession()/refresh entre
        // TODAS as abas do mesmo storageKey via navigator.locks (10s de timeout).
        // Uma aba em segundo plano que o navegador throttla (comportamento padrão
        // pra economizar CPU) pode segurar esse lock sem conseguir liberá-lo a
        // tempo — toda aba ATIVA que dependa da mesma chave trava por até 10s e
        // falha com "Acquiring an exclusive Navigator LockManager lock ... timed
        // out" (issues #38, #41). processLock serializa só DENTRO da mesma aba,
        // sem esperar outras abas — elimina esse travamento cruzado. O trade-off
        // aceito: duas abas podem, raramente, tentar renovar o token ao mesmo
        // tempo; o pior caso é uma delas precisar buscar sessão de novo, não um
        // travamento de 10s pro usuário.
        lock: processLock,
    },
    global: {
        fetch: fetchWithTimeout,
    },
});

export default supabase;

// ── Task Dependencies ─────────────────────────────────────
import type { TaskDependency, DependencyType, WorkspaceTag } from '../types';

export async function fetchTaskDependencies(taskId: string): Promise<TaskDependency[]> {
  const { data, error } = await supabase
    .from('task_dependencies')
    .select(`
      *,
      depends_on_task:tasks!depends_on_id (id, title, status, priority)
    `)
    .eq('task_id', taskId);

  if (error) throw error;
  return (data ?? []) as TaskDependency[];
}

// Versão em lote de fetchTaskDependencies — usada pelo Gantt (Codex_Gantt_03/
// #154), que precisa das dependências de dezenas/centenas de tarefas visíveis
// de uma vez (setas + bloqueio + caminho crítico). Uma chamada por tarefa
// vista faria N round-trips; aqui é um `IN (...)` por lote.
// GanttView passa TODAS as tarefas do escopo (não só as na janela de datas
// visível) — um espaço grande (ex.: ~5.900 tarefas) gera uma única URL com
// milhares de UUIDs (~200KB+), que o navegador/servidor rejeita direto
// (ERR_CONNECTION_RESET, reproduzido ao vivo). Mesmo chunk de 150 ids já
// usado em taskRepo.ts (fetchSubEntityInChunks) pro mesmo problema com
// task_id em outras sub-entidades.
const TASK_DEPENDENCIES_CHUNK = 150;
export async function fetchTaskDependenciesForTasks(taskIds: string[]): Promise<TaskDependency[]> {
  if (taskIds.length === 0) return [];
  const out: TaskDependency[] = [];
  for (let i = 0; i < taskIds.length; i += TASK_DEPENDENCIES_CHUNK) {
    const slice = taskIds.slice(i, i + TASK_DEPENDENCIES_CHUNK);
    const { data, error } = await supabase
      .from('task_dependencies')
      .select(`
        *,
        depends_on_task:tasks!depends_on_id (id, title, status, priority)
      `)
      .in('task_id', slice);

    if (error) throw error;
    if (data) out.push(...(data as TaskDependency[]));
  }
  return out;
}

export async function addTaskDependency(
  taskId: string,
  dependsOnId: string,
  type: DependencyType,
  createdBy: string
): Promise<TaskDependency> {
  const { data, error } = await supabase
    .from('task_dependencies')
    .insert({ task_id: taskId, depends_on_id: dependsOnId, type, created_by: createdBy })
    .select(`*, depends_on_task:tasks!depends_on_id (id, title, status, priority)`)
    .single();

  if (error) throw error;
  return data as TaskDependency;
}

// Desloca start_date/due_date de várias tarefas pelo mesmo delta numa única
// operação atômica no banco (Codex_Gantt_10: "evitar loops frágeis no
// cliente"). Devolve só os ids que realmente foram atualizados — a RLS de
// `tasks` decide linha a linha (SECURITY INVOKER, padrão), então a diferença
// entre `taskIds` (pedido) e o retorno já é o sinal de sucesso parcial (sem
// permissão numa tarefa específica), sem precisar de uma segunda consulta.
// `null` sinaliza pro chamador usar o fallback sequencial (função
// `shift_task_dates` ainda não migrada pro banco — mesmo padrão de fallback
// já usado por fetchTaskCountIndex/searchTaskRowsByTitle em taskRepo.ts).
export async function shiftTaskDates(taskIds: string[], deltaDays: number): Promise<string[] | null> {
  if (taskIds.length === 0) return [];
  const { data, error } = await supabase.rpc('shift_task_dates', {
    p_task_ids: taskIds,
    p_delta_days: deltaDays,
  });
  if (error) {
    console.warn('supabase.shiftTaskDates: RPC indisponível, GanttView vai cair pro fallback sequencial:', error);
    return null;
  }
  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

export async function removeTaskDependency(dependencyId: string): Promise<void> {
  const { error } = await supabase
    .from('task_dependencies')
    .delete()
    .eq('id', dependencyId);

  if (error) throw error;
}

export async function isTaskBlocked(taskId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('task_dependencies')
    .select(`depends_on_task:tasks!depends_on_id (id, status)`)
    .eq('task_id', taskId)
    .eq('type', 'blocked_by');

  if (error || !data) return false;

  return data.some((dep: any) => {
    const status: string = dep.depends_on_task?.status ?? '';
    const doneKeywords = ['conclu', 'done', 'closed', 'complete', 'finaliz', 'pronto', 'aprovado'];
    return !doneKeywords.some(kw => status.toLowerCase().includes(kw));
  });
}

// ── Comentários atribuídos ("Assign comments" do ClickUp) ──
// Um comentário atribuído (raiz ou resposta) vira um item obrigatório: a
// tarefa não pode ser fechada enquanto ele não for resolvido.
export async function hasUnresolvedAssignedComments(taskId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('task_comments')
    .select('id')
    .eq('task_id', taskId)
    .is('deleted_at', null)
    .is('resolved_at', null)
    .not('assigned_to', 'is', null)
    .limit(1);

  if (error) return false;
  return (data ?? []).length > 0;
}

// ── Workspace Tags ─────────────────────────────────────────
export async function fetchWorkspaceTags(workspaceId: string): Promise<WorkspaceTag[]> {
  const { data, error } = await supabase
    .from('workspace_tags')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('name');

  if (error) throw error;
  return (data ?? []) as WorkspaceTag[];
}

export async function createWorkspaceTag(
  workspaceId: string,
  name: string,
  color: string,
  createdBy: string
): Promise<WorkspaceTag> {
  const { data, error } = await supabase
    .from('workspace_tags')
    .insert({ workspace_id: workspaceId, name, color, created_by: createdBy })
    .select()
    .single();

  if (error) throw error;
  return data as WorkspaceTag;
}

export async function deleteWorkspaceTag(tagId: string): Promise<void> {
  const { error } = await supabase
    .from('workspace_tags')
    .delete()
    .eq('id', tagId);

  if (error) throw error;
}

export async function updateTaskTags(taskId: string, tagNames: string[]): Promise<void> {
  const { error } = await supabase
    .from('tasks')
    .update({ tags: tagNames })
    .eq('id', taskId);

  if (error) throw error;
}

// ── Automations ────────────────────────────────────────────
import type { Automation, AutomationLog } from '../types';

export async function fetchAutomations(workspaceId: string): Promise<Automation[]> {
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Automation[];
}

export async function fetchAutomationsByList(listId: string): Promise<Automation[]> {
  const { data, error } = await supabase
    .from('automations')
    .select('*')
    .eq('list_id', listId)
    .order('created_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as Automation[];
}

export async function createAutomation(
  automation: Omit<Automation, 'id' | 'run_count' | 'created_at' | 'updated_at'>
): Promise<Automation> {
  const { data, error } = await supabase
    .from('automations')
    .insert(automation)
    .select()
    .single();

  if (error) throw error;
  return data as Automation;
}

export async function updateAutomation(
  id: string,
  changes: Partial<Pick<Automation, 'name' | 'enabled' | 'trigger_type' | 'trigger_config' | 'conditions' | 'actions'>>
): Promise<void> {
  const { error } = await supabase
    .from('automations')
    .update(changes)
    .eq('id', id);

  if (error) throw error;
}

export async function deleteAutomation(id: string): Promise<void> {
  const { error } = await supabase
    .from('automations')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

export async function fetchAutomationLogs(
  automationId: string,
  limit = 50
): Promise<AutomationLog[]> {
  const { data, error } = await supabase
    .from('automation_logs')
    .select('*')
    .eq('automation_id', automationId)
    .order('executed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as AutomationLog[];
}
