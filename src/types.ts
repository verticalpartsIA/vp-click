
export enum UserRole {
  ADMIN = 'ADMIN',
  GESTOR = 'GESTOR',
  COLABORADOR = 'COLABORADOR'
}

export type StatusType = 'START' | 'ACTIVE' | 'DONE' | 'CANCELLED';

export interface StatusOption {
  id: string;
  groupId: string;
  label: string;
  color: string;
  type: StatusType;
  orderIndex: number;
}

export interface StatusGroup {
  id: string;
  name: string;
  options: StatusOption[];
}

export enum TaskPriority {
  BAIXA = 'Baixa',
  MEDIA = 'Média',
  ALTA = 'Alta',
  URGENTE = 'Urgente'
}

export enum CustomFieldType {
  DROPDOWN = 'Lista Suspensa',
  TEXT = 'Texto',
  TEXTAREA = 'Área de Texto',
  DATE = 'Data',
  NUMBER = 'Número',
  LABELS = 'Rótulos',
  CHECKBOX = 'Caixa de Seleção',
  MONEY = 'Dinheiro',
  WEBSITE = 'Site',
  RATING = 'Avaliação',
  PROGRESS = 'Progresso',
  FORMULA = 'Fórmula',
  CURRENCY = 'Moeda'
}

export interface CustomFieldOption {
  id: string;
  label: string;
  color: string;
  icon?: string;
}

export interface CustomField {
  id: string;
  name: string;
  type: CustomFieldType;
  isMandatory: boolean;
  defaultValue?: any;
  config?: {
    options?: CustomFieldOption[];
    currency?: string;
    precision?: number;
    allowTime?: boolean;
    min?: number;
    max?: number;
    formula?: string;
  };
  target: 'TASK' | 'LIST' | 'PROJECT';
  visibleTo: UserRole[];
  createdBy: string;
  createdAt: string;
}

export interface CustomFieldValue {
  fieldId: string;
  entityId: string; // ID da Tarefa, Lista ou Projeto
  value: any;
}

// Opções do fluxo de duplicação de tarefa (o que copiar da origem).
export interface DuplicateTaskOptions {
  title: string;
  listId: string;
  includeDescription: boolean;
  includeAssignees: boolean;
  includeDates: boolean;
  includePriority: boolean;
  includeSubtasks: boolean;
  includeChecklists: boolean;
  includeTags: boolean;
  includeCustomFields: boolean;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  role: UserRole;
  email: string;
  theme?: string;
}

export interface ExtensionLog {
  id: string;
  oldDate: string;
  newDate: string;
  reason: string;
  updatedBy: string;
  timestamp: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

export interface Comment {
  id: string;
  userId: string;
  text: string;
  timestamp: string;
  updatedAt?: string;
  parentCommentId?: string;
  assignedTo?: string;
  assignedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// ── Reuniões (item 4 da sidebar "Início", estilo ClickUp) — versão manual +
// IA: sem calendário nem bot entrando em chamada, o resumo/itens de ação vêm
// de notas coladas à mão e processadas pela edge function summarize-meeting.
export interface MeetingActionItem {
  id: string;
  meetingId: string;
  text: string;
  completed: boolean;
  taskId?: string;
  createdAt: string;
}

export interface Meeting {
  id: string;
  title: string;
  meetingDate: string;
  endDate?: string;
  roomId?: string;
  participantIds: string[];
  notes: string;
  summary?: string;
  createdBy?: string;
  createdAt: string;
  updatedAt?: string;
  actionItems: MeetingActionItem[];
}

// ── Salas de reunião (reserva com detecção de conflito de horário) ───────
export interface MeetingRoom {
  id: string;
  name: string;
  isActive: boolean;
  createdBy?: string;
  createdAt: string;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  type: string;
  size: number;
  uploadedAt: string;
}

export interface TaskActivity {
  id: string;
  taskId: string;
  userId: string;
  type: string;
  oldValue?: string;
  newValue?: string;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: TaskPriority;
  mainAssigneeId: string;
  secondaryAssigneeIds: string[];
  startDate: string;
  dueDate: string;
  extensionCount: number;
  extensionHistory: ExtensionLog[];
  checklists: ChecklistItem[];
  comments: Comment[];
  attachments: Attachment[];
  activities: TaskActivity[];
  listId: string;
  projectId: string;
  parentId?: string;
  createdAt?: string;
  createdBy?: string;
  dependencies?: TaskDependency[];
  // Marco (Codex_Gantt_08): sem duração própria, renderizado no Gantt como
  // marcador pontual na `dueDate` em vez de barra com intervalo. Continua
  // sendo uma tarefa normal pra todo o resto do sistema (RLS, dependências,
  // busca) — ver supabase_migration_36_task_milestones.sql.
  isMilestone?: boolean;
  tags?: string[];
  watcherIds?: string[];
  // Issue #184 — tarefas recorrentes, fase 1 (schema). `recurrenceRuleId`
  // presente = esta tarefa é uma ocorrência gerada por uma série; ausente =
  // tarefa comum. Ver TaskRecurrenceRule.
  recurrenceRuleId?: string;
  recurrenceParentTaskId?: string;
  recurrenceSequence?: number;
  scheduledOccurrenceAt?: string;
  // Issue #185 — arquivar/excluir/restaurar, fase 1 (schema). Dimensões
  // independentes do `status` (uma tarefa DONE pode estar arquivada ou não;
  // uma tarefa ACTIVE pode estar na lixeira). `deletedAt` presente = na
  // lixeira/quarentena (purga definitiva em `purgeAfter`, ~30 dias depois).
  archivedAt?: string;
  archivedBy?: string;
  deletedAt?: string;
  deletedBy?: string;
  purgeAfter?: string;
  deletionReasonCode?: string;
  deletionReasonText?: string;
}

// ── Tarefas recorrentes (issue #184) ──────────────────────────────────────
// Fase 1: schema + RLS só. Motor de cálculo da próxima ocorrência e
// scheduler server-side (Fase 2) e UI de configuração (Fase 3) ainda não
// existem — este tipo já reflete a tabela `task_recurrence_rules` pra quem
// for construir em cima.
export type RecurrenceFrequencyType = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'custom';
export type RecurrenceTriggerMode = 'on_schedule' | 'on_complete' | 'days_after_complete';
export type RecurrenceWeekendShift = 'next_business_day' | 'previous_business_day' | 'skip';
export type RecurrenceEndMode = 'forever' | 'count' | 'until';
export type RecurrenceOverlapPolicy = 'create_anyway' | 'skip_new' | 'postpone' | 'create_and_flag' | 'escalate';
export type RecurrenceMisfirePolicy = 'skip_past' | 'create_latest_only' | 'create_all_up_to_limit';

// Quais campos a nova ocorrência herda da tarefa-base — mapeia (e estende
// quando preciso) DuplicateTaskOptions, sem duplicar a lógica de clonagem.
export interface RecurrenceInheritOptions {
  includeDescription?: boolean;
  includeAssignees?: boolean;
  includePriority?: boolean;
  includeSubtasks?: boolean;
  includeChecklists?: boolean;
  includeChecklistCheckedState?: boolean;
  includeTags?: boolean;
  includeCustomFields?: boolean;
  includeWatchers?: boolean;
  includeAttachments?: boolean;
  includeDependencies?: boolean;
  remapSubtaskDates?: boolean;
}

export interface TaskRecurrenceRule {
  id: string;
  taskId: string;
  listId: string;
  createdBy?: string;
  enabled: boolean;

  frequencyType: RecurrenceFrequencyType;
  interval: number;
  weekdays: number[]; // 0=domingo..6=sábado
  monthDay?: number;
  monthWeek?: number; // 1..4, 5=último
  monthWeekday?: number;

  startAt: string;
  nextRunAt?: string;
  timezone: string;

  triggerMode: RecurrenceTriggerMode;
  daysAfterComplete?: number;

  createNewTask: boolean;
  skipWeekends: boolean;
  skipHolidays: boolean;
  weekendShift: RecurrenceWeekendShift;

  endMode: RecurrenceEndMode;
  endAt?: string;
  maxOccurrences?: number;
  occurrencesCreated: number;

  updateStatusTo?: string;
  inheritOptions: RecurrenceInheritOptions;
  overlapPolicy: RecurrenceOverlapPolicy;
  misfirePolicy: RecurrenceMisfirePolicy;

  lastGeneratedAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Equipes (grupos de usuários, estilo ClickUp Teams) ───
export interface Team {
  id: string;
  name: string;
  description: string;
  color: string;
  memberIds: string[];
}

// ── Notificações in-app (sino) ────────────────────────────
export type NotificationType = 'mention' | 'team_mention' | 'assignment' | 'comment' | 'automation' | 'reply' | 'comment_assigned' | 'comment_resolved' | 'meeting';

export interface AppNotification {
  id: string;
  userId: string;
  actorId?: string;
  type: NotificationType;
  title: string;
  body: string;
  taskId?: string;
  commentId?: string;
  meetingId?: string;
  read: boolean;
  snoozedUntil?: string;
  createdAt: string;
}

// ── Task Dependencies ─────────────────────────────────────
export type DependencyType = 'blocks' | 'blocked_by' | 'relates_to';

export interface TaskDependency {
  id: string;
  task_id: string;
  depends_on_id: string;
  type: DependencyType;
  created_by: string | null;
  created_at: string;
  depends_on_task?: Pick<Task, 'id' | 'title' | 'status' | 'priority'>;
}

export interface List {
  id: string;
  name: string;
  folderId: string;
  statusGroupId: string;
  ownerId?: string;
}

// ── Lembretes ("Hoje e atrasadas", item 7 da sidebar "Início") ───────────
export type ReminderNotifyPreference = 'on_due' | '10_min_before' | '1_hour_before' | 'custom' | 'off';

export interface Reminder {
  id: string;
  title: string;
  details?: string;
  dueAt: string;
  notifyPreference: ReminderNotifyPreference;
  customNotifyAt?: string;
  userId: string;
  createdBy?: string;
  completed: boolean;
  completedAt?: string;
  taskId?: string;
  createdAt: string;
  updatedAt?: string;
}

export interface Folder {
  id: string;
  name: string;
  spaceId: string;
}

export interface Space {
  id: string;
  name: string;
  workspaceId: string;
  color: string;
  icon?: string;
  isSystem?: boolean; // true = space nativo do Hub, não pode ser deletado
  createdAt?: string;
}

export interface Workspace {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  name: string;
  department: string;
  managerId: string;
  status: 'Ativo' | 'Pausado' | 'Concluído';
  lists: string[];
}

export interface Doc {
  id: string;
  title: string;
  content: string;
  headerImage?: string;
  folderId: string;
  createdBy: string;
  attachments: Attachment[];
  parentId?: string | null;
  isWiki?: boolean;
}

export interface WorkspaceTag {
  id: string;
  workspace_id: string;
  name: string;
  color: string;
  created_by: string | null;
  created_at: string;
}

// ── Automations ───────────────────────────────────────────

export type AutomationTriggerType =
  | 'status_changed'
  | 'priority_changed'
  | 'assignee_changed'
  | 'due_date_arrives'
  | 'task_created'
  | 'task_moved'
  | 'custom_field_changed';

export type AutomationActionType =
  | 'change_status'
  | 'change_priority'
  | 'add_assignee'
  | 'remove_assignee'
  | 'post_comment'
  | 'add_tag'
  | 'remove_tag'
  | 'send_notification'
  | 'create_task'
  | 'create_subtask';

export type AutomationConditionOperator =
  | 'equals'
  | 'not_equals'
  | 'contains'
  | 'is_empty'
  | 'is_not_empty';

export interface AutomationCondition {
  field: string;
  operator: AutomationConditionOperator;
  value?: string;
}

export interface AutomationAction {
  type: AutomationActionType;
  config: Record<string, unknown>;
}

export interface AutomationTriggerConfig {
  from?: string;
  to?: string;
  field_id?: string;
  days_before?: number;
}

export interface Automation {
  id: string;
  workspace_id: string | null;
  list_id: string | null;
  name: string;
  enabled: boolean;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  run_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AutomationLog {
  id: string;
  automation_id: string;
  task_id: string | null;
  triggered_by: string;
  status: 'success' | 'error' | 'skipped';
  actions_taken: AutomationAction[];
  error_message: string | null;
  executed_at: string;
}

export interface AutomationTemplate {
  id: string;
  name: string;
  description: string;
  category: 'status' | 'prazo' | 'equipe' | 'qualidade';
  icon: string;
  trigger_type: AutomationTriggerType;
  trigger_config: AutomationTriggerConfig;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
}
