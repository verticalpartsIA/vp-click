import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useLocation, useNavigationType, useSearchParams } from 'react-router-dom';
import { MoreHorizontal, FileText, ListPlus, Link as LinkIcon, Image as ImageIcon, Paperclip, AlertTriangle as AlertTriangleIcon, Tag, Copy, ArrowUpDown, Search, Filter, RotateCcw, Check, X, Edit3, CalendarDays, UserCircle, Flag, MessageSquare, CheckSquare, GripVertical, Repeat, Pause, Play, Archive as ArchiveIcon } from "lucide-react";
import {
  User, Task, Workspace, Space, Folder, List, Project,
  UserRole, StatusType, StatusOption, StatusGroup, TaskPriority, ExtensionLog, Comment, ChecklistItem, Attachment,
  CustomField, CustomFieldType, CustomFieldValue, CustomFieldOption, Doc, TaskActivity, WorkspaceTag, Team, AppNotification, DuplicateTaskOptions,
  TaskRecurrenceRule, RecurrenceFrequencyType, RecurrenceWeekendShift, RecurrenceEndMode, RecurrenceOverlapPolicy, RecurrenceMisfirePolicy, RecurrenceInheritOptions
} from './types';
// import { MOCK_USERS, INITIAL_WORKSPACE, MOCK_SPACES, MOCK_FOLDERS, MOCK_LISTS, MOCK_TASKS, MOCK_PROJECTS, MOCK_CUSTOM_FIELDS, MOCK_CUSTOM_FIELD_VALUES } from './mockData';
import { INITIAL_WORKSPACE, MOCK_PROJECTS } from './mockData'; // MOCK_PROJECTS temporário se ainda necessário
import { Icons, PRIORITY_COLORS, COLORS } from './constants';
import { calcNextValidOccurrence, RecurrenceRuleForCalc } from './lib/recurrence';
import { fetchCompanyHolidays, addCompanyHoliday, deleteCompanyHoliday, CompanyHoliday } from './lib/holidaysRepo';
import { WIKI_INTRO_HTML, WIKI_TEMPLATE_SECTIONS } from './wikiTemplate';
import LoginScreen from './pages/LoginScreen';
import ChangePasswordModal from './components/ChangePasswordModal';
import CreateListModal from './components/CreateListModal';
import compactLogoWhite from './assets/logo-verticalparts-white.png';
import bootLogoVideo from './assets/logo-limpo-video.mp4';
import { recordRecentTaskId } from './lib/recentTasks';
import { buildSlugIndex, slugify, type SlugIndex } from './lib/slug';
import { lazyImportWithReload, clearChunkReloadFlag } from './lib/lazyRetry';
import { supabase } from './lib/supabase';
import * as taskRepo from './lib/taskRepo';
import { isDoneLikeStatus, resolveDefaultStatus, getTaskCloseBlockReason, duplicateTask } from './lib/taskService';
import { useDashboard } from './hooks/useDashboard';
import { useTaskCountIndex } from './hooks/useTaskCountIndex';
import { useUsers } from './hooks/useUsers';
import { AutomationEngine, AutomationContext, AutomationCallbacks } from './lib/AutomationEngine';
import { startVersionCheck, formatBuildTimeShort } from './lib/versionCheck';
import { trackEnter, trackExit } from './lib/trackActivity';
import { ssoToken, veioDoPortal } from './lib/ssoEntry';
import { avatarThumb } from './lib/avatarUrl';
import { TaskDependencies } from './components/TaskDependencies';
import { NotificationBell } from './components/NotificationBell';
import { TeamsModal } from './components/TeamsModal';
import { MentionTextarea } from './components/MentionTextarea';
import { AIPanel } from './components/AIPanel';
import { MentionText, notifyMentions, notifyAssignment, notifyReply, notifyCommentAssigned, notifyCommentResolved } from './lib/mentions';
import { linkifyText } from './lib/linkify';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TaskTagsInput } from './components/TaskTagsInput';
import { TagBadge } from './components/TagBadge';
import { AutomationModal } from './components/AutomationModal';
import { Session } from '@supabase/supabase-js';
import { Toaster, toast } from 'sonner';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { Checkbox } from "@/components/ui/checkbox";

const DashboardCharts = React.lazy(lazyImportWithReload(() =>
  import('./components/views/DashboardCharts').then((module) => ({ default: module.DashboardCharts }))
));

// Views carregadas sob demanda (só quando o usuário abre aquela aba). Reduz o
// bundle inicial — cada uma dessas é um módulo isolado (não referenciado de
// nenhum outro lugar do app fora daqui), então dá pra baixar só quando
// activeView realmente precisar dela (ver o <Suspense> em volta do bloco de
// views, mais abaixo). Achado da auditoria Lighthouse: index.js sozinho tinha
// 1,2 MB, boa parte código de abas que a maioria das sessões nunca abre
// (Gantt, Reuniões, Inbox, Admin etc.). `lazyImportWithReload` (ver
// lib/lazyRetry.ts) recarrega a página uma vez se o chunk pedido não existir
// mais no servidor (build antigo trocado por um deploy) em vez de derrubar a
// UI inteira no ErrorBoundary de topo.
const AdminPanel = React.lazy(lazyImportWithReload(() => import('./pages/AdminPanel')));
const TableView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/TableView').then((m) => ({ default: m.TableView }))
));
const CalendarView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/CalendarView').then((m) => ({ default: m.CalendarView }))
));
const GanttView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/GanttView').then((m) => ({ default: m.GanttView }))
));
const InboxView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/InboxView').then((m) => ({ default: m.InboxView }))
));
const RepliesView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/RepliesView').then((m) => ({ default: m.RepliesView }))
));
const AssignedCommentsView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/AssignedCommentsView').then((m) => ({ default: m.AssignedCommentsView }))
));
const MeetingsView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/MeetingsView').then((m) => ({ default: m.MeetingsView }))
));
const MyTasksView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/MyTasksView').then((m) => ({ default: m.MyTasksView }))
));
const RecentTasksView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/RecentTasksView').then((m) => ({ default: m.RecentTasksView }))
));
const RemindersView = React.lazy(lazyImportWithReload(() =>
  import('./components/views/RemindersView').then((m) => ({ default: m.RemindersView }))
));

const SSOHandler: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

// --- Types for Navigation Scope ---
type ScopeType = 'global' | 'space' | 'folder';
interface NavigationScope {
  type: ScopeType;
  id: string | null;
  name: string;
}

type ActiveView = 'List' | 'Kanban' | 'Calendar' | 'Gantt' | 'Table' | 'Dashboard' | 'Admin' | 'Doc' | 'Inbox' | 'Replies' | 'AssignedComments' | 'Meetings' | 'MyTasks' | 'Reminders' | 'RecentTasks';

// --- Navegação ↔ URL ---------------------------------------------------------
// Cada view "de workspace" (List/Kanban/Calendar/Gantt/Table/Dashboard) vira um
// path próprio (`/gantt`, `/kanban`...); a lista/pasta/espaço ativo e o filtro
// "Minhas Tarefas" (Atribuídas a mim) viajam como query params por cima desse
// path — mesmo mecanismo que o `?taskId=` já usava, só que agora cobrindo view
// e escopo também. Views "standalone" (Inbox, Reuniões etc.) e Doc não têm
// conceito de escopo, então viram só um path fixo (Doc leva o id da página).
const WORKSPACE_VIEWS: ActiveView[] = ['List', 'Kanban', 'Calendar', 'Gantt', 'Table', 'Dashboard'];

const VIEW_TO_SLUG: Record<ActiveView, string> = {
  Dashboard: '', // path canônico é a raiz ("/")
  List: 'list',
  Kanban: 'kanban',
  Calendar: 'calendar',
  Gantt: 'gantt',
  Table: 'table',
  Admin: 'admin',
  Doc: 'doc',
  Inbox: 'inbox',
  Replies: 'replies',
  AssignedComments: 'assigned-comments',
  Meetings: 'meetings',
  MyTasks: 'my-tasks',
  Reminders: 'reminders',
  RecentTasks: 'recent-tasks',
};

const SLUG_TO_VIEW: Record<string, ActiveView> = Object.fromEntries(
  Object.entries(VIEW_TO_SLUG).filter(([, slug]) => slug).map(([view, slug]) => [slug, view as ActiveView])
);
// Aceita "/dashboard" digitado manualmente, mesmo o path canônico sendo "/".
SLUG_TO_VIEW.dashboard = 'Dashboard';

interface ParsedNav {
  view: ActiveView;
  docId: string | null;
  listId: string | null;
  scopeType: ScopeType;
  scopeId: string | null;
  scopeName: string;
  mine: boolean;
  // Id completo — só quando veio do formato legado `?taskId=<uuid>` (já
  // resolvido, não depende de `tasks` estar carregado).
  taskId: string | null;
  // 8 primeiros chars do id — quando veio do path novo (.../tarefa/<slug>-
  // <8chars>). Precisa ser resolvido contra `tasks` já carregado pra virar
  // um `selectedTaskId` de verdade (ver `pendingTaskSlugId` no componente).
  taskSlugId: string | null;
}

// Segmento fixo que marca "o que vem depois é uma tarefa aberta" na URL,
// sempre no FINAL do path (depois de espaço/pasta/lista/view, se houver):
// .../tarefa/<slug-do-titulo>-<8-chars-do-id>. Os 8 chars (não o título)
// são a fonte da verdade — o título é só cosmético e pode ficar desatualizado
// se a tarefa for renomeada depois; o link continua funcionando.
const TASK_PATH_SEGMENT = 'tarefa';
const TASK_SLUG_ID_RE = /-([0-9a-f]{8})$/;

// Remove o `/tarefa/<slug>-<id>` do FINAL do path, se houver, devolvendo os
// segmentos restantes (pra parsear escopo/view normalmente) + o id curto.
function stripTaskSlugSegment(segments: string[]): { rest: string[]; taskSlugId: string | null } {
  if (segments.length < 2 || segments[segments.length - 2] !== TASK_PATH_SEGMENT) {
    return { rest: segments, taskSlugId: null };
  }
  const match = segments[segments.length - 1].match(TASK_SLUG_ID_RE);
  if (!match) return { rest: segments, taskSlugId: null };
  return { rest: segments.slice(0, -2), taskSlugId: match[1] };
}

// Índices slug<->id de espaços/pastas/listas, usados por parseNavPath (URL →
// estado) e computeNavPath (estado → URL) pra trocar `?scope=space&scopeId=
// <uuid>` por um path legível (`/suprimentos/importacao`). Ficam vazios até
// os dados carregarem (ver `workspaceMetaLoaded`) — nesse meio-tempo qualquer
// path de escopo cai no fallback global/Dashboard e é corrigido assim que os
// índices ficarem prontos (ver efeito de entrada mais abaixo).
interface NavSlugMaps {
  spaces: Pick<Space, 'id' | 'name'>[];
  folders: Pick<Folder, 'id' | 'name' | 'spaceId'>[];
  lists: Pick<List, 'id' | 'name' | 'folderId'>[];
  spaceIndex: SlugIndex;
  folderIndex: SlugIndex;
  listIndex: SlugIndex;
}

// URL → estado de navegação. Usada tanto na carga inicial (deep link/refresh)
// quanto quando o usuário navega pelo botão voltar/avançar do navegador.
function parseNavPath(pathname: string, search: string, slugMaps: NavSlugMaps): ParsedNav {
  const rawSegments = pathname.split('/').filter(Boolean);
  const { rest: segments, taskSlugId } = stripTaskSlugSegment(rawSegments);
  const params = new URLSearchParams(search);
  // `?taskId=` legado tem prioridade — já é um id completo e resolvido, não
  // depende de `tasks` estar carregado (ver taskSlugId, que sim depende).
  const taskId = params.get('taskId');
  if (segments[0] === 'doc') {
    return { view: 'Doc', docId: segments[1] || null, listId: null, scopeType: 'global', scopeId: null, scopeName: '', mine: false, taskId, taskSlugId: taskId ? null : taskSlugId };
  }

  // Primeiro segmento bate com uma view conhecida (ou path vazio = raiz) →
  // navegação "global" de sempre: view no path, escopo (se houver) em query
  // params legados (?scope=&scopeId=, ?listId=) — mantém links antigos
  // funcionando, o efeito de saída já reescreve pro formato novo em seguida.
  if (segments[0] === undefined || segments[0] in SLUG_TO_VIEW) {
    const view = SLUG_TO_VIEW[segments[0] || ''] || 'Dashboard';
    const listId = params.get('listId');
    const scopeParam = params.get('scope');
    const scopeId = params.get('scopeId');
    const mine = params.get('mine') === '1';
    const scopeType: ScopeType = (scopeParam === 'space' || scopeParam === 'folder') && scopeId ? scopeParam : 'global';
    const scopeName = scopeType === 'space'
      ? slugMaps.spaces.find(s => s.id === scopeId)?.name ?? ''
      : scopeType === 'folder'
        ? slugMaps.folders.find(f => f.id === scopeId)?.name ?? ''
        : mine ? 'Minhas Tarefas' : 'Dashboard';
    return {
      view,
      docId: null,
      listId: WORKSPACE_VIEWS.includes(view) ? listId : null,
      scopeType,
      scopeId: scopeType === 'global' ? null : scopeId,
      scopeName,
      mine: WORKSPACE_VIEWS.includes(view) && mine,
      taskId,
      taskSlugId: taskId ? null : taskSlugId,
    };
  }

  // Primeiro segmento não é view conhecida → candidato a slug de espaço
  // (/<space>[/<folder>[/<list>]][/<view>]). Se não resolver (slug inválido
  // OU índices ainda vazios porque os dados não carregaram), cai no
  // fallback Dashboard/global — o efeito de entrada re-tenta assim que os
  // índices ficarem prontos.
  const spaceId = slugMaps.spaceIndex.slugToId.get(` ${segments[0]}`);
  const space = spaceId ? slugMaps.spaces.find(s => s.id === spaceId) : undefined;
  if (!space) {
    return { view: 'Dashboard', docId: null, listId: null, scopeType: 'global', scopeId: null, scopeName: 'Dashboard', mine: false, taskId, taskSlugId: taskId ? null : taskSlugId };
  }

  // O último segmento pode ser a view (list/kanban/calendar/gantt/table/
  // dashboard) em vez de espaço/pasta/lista — ex.: /suprimentos/kanban ou
  // /suprimentos/importacao/kanban. Separa antes de resolver pasta/lista.
  const scopeSegments = segments.slice(1);
  let viewSlug: string | null = null;
  if (scopeSegments.length > 0) {
    const last = scopeSegments[scopeSegments.length - 1];
    const candidateView = SLUG_TO_VIEW[last];
    if (candidateView && WORKSPACE_VIEWS.includes(candidateView)) {
      viewSlug = last;
      scopeSegments.pop();
    }
  }

  let folderId: string | null = null;
  let folderName = '';
  if (scopeSegments[0]) {
    const resolvedFolderId = slugMaps.folderIndex.slugToId.get(`${space.id} ${scopeSegments[0]}`);
    const folder = resolvedFolderId ? slugMaps.folders.find(f => f.id === resolvedFolderId) : undefined;
    if (folder) {
      folderId = folder.id;
      folderName = folder.name;
    }
  }

  let listId: string | null = null;
  if (folderId && scopeSegments[1]) {
    const resolvedListId = slugMaps.listIndex.slugToId.get(`${folderId} ${scopeSegments[1]}`);
    if (resolvedListId && slugMaps.lists.some(l => l.id === resolvedListId)) {
      listId = resolvedListId;
    }
  }

  // Dashboard (Overview) só existe pra escopo de ESPAÇO (SpaceOverview) — não
  // há um "FolderOverview". O próprio handleNavigate já força `List` ao
  // navegar pra pasta/lista pelo clique da sidebar; replicamos a mesma regra
  // aqui pro default de uma URL sem segmento de view explícito, senão
  // pasta/lista sem view cai no Dashboard GLOBAL (sem filtro de escopo) por
  // engano. `?view=` continua aceito como fallback de link antigo.
  const legacyViewParam = params.get('view');
  const view = (viewSlug && SLUG_TO_VIEW[viewSlug])
    || (legacyViewParam && SLUG_TO_VIEW[legacyViewParam])
    || (folderId ? 'List' : 'Dashboard');
  const scopeType: ScopeType = listId ? 'global' : folderId ? 'folder' : 'space';
  const scopeId = listId ? null : folderId ?? space.id;
  const scopeName = listId ? '' : folderId ? folderName : space.name;
  return { view, docId: null, listId, scopeType, scopeId, scopeName, mine: false, taskId, taskSlugId: taskId ? null : taskSlugId };
}

// Estado de navegação → URL. `currentSearch` carrega params que não são de
// navegação por view/escopo (hoje só `tab`, da aba ativa dentro do modal de
// detalhe da tarefa) e é preservado por cima.
function computeNavPath(
  state: { activeView: ActiveView; activeListId: string | null; activeScope: NavigationScope; activeDocId: string | null; selectedTaskId: string | null },
  currentSearch: string,
  slugMaps: NavSlugMaps,
  tasksForTaskSlug: Pick<Task, 'id' | 'title'>[],
): string {
  const params = new URLSearchParams(currentSearch);
  params.delete('listId');
  params.delete('scope');
  params.delete('scopeId');
  params.delete('mine');
  params.delete('view');
  params.delete('taskId');

  // Tarefa aberta vira `/tarefa/<slug-do-título>-<8-chars-do-id>` no FINAL
  // do path (depois de escopo/view, se houver) — só os 8 chars do id são a
  // fonte da verdade na hora de resolver de volta (ver parseNavPath), o
  // título é cosmético e pode ficar desatualizado sem quebrar o link. Cai de
  // volta pro `?taskId=` legado só se a tarefa ainda não estiver em `tasks`
  // (não deveria acontecer: só chegamos aqui com selectedTaskId já
  // confirmado presente).
  let taskPathSuffix = '';
  if (state.selectedTaskId) {
    const task = tasksForTaskSlug.find(t => t.id === state.selectedTaskId);
    if (task) {
      taskPathSuffix = `/${TASK_PATH_SEGMENT}/${slugify(task.title)}-${task.id.slice(0, 8)}`;
    } else {
      params.set('taskId', state.selectedTaskId);
    }
  } else {
    // Sem tarefa selecionada, `tab` (do modal fechado) também não faz sentido.
    params.delete('tab');
  }

  // `meetingId` é lido/escrito pela própria MeetingsView (useSearchParams) —
  // só é limpo aqui quando o usuário sai da view, pra não vazar pra outras
  // rotas (ex: navegar pra /gantt não deveria carregar ?meetingId= a tiracolo).
  if (state.activeView !== 'Meetings') {
    params.delete('meetingId');
  }

  if (state.activeView === 'Doc') {
    const search = params.toString();
    return `/doc${state.activeDocId ? `/${state.activeDocId}` : ''}${taskPathSuffix}${search ? `?${search}` : ''}`;
  }

  if (!WORKSPACE_VIEWS.includes(state.activeView)) {
    const slug = VIEW_TO_SLUG[state.activeView] ?? '';
    const base = slug ? `/${slug}` : '/';
    const search = params.toString();
    return `${base}${taskPathSuffix}${search ? `?${search}` : ''}`;
  }

  // Tenta montar o path legível (/<space>[/<folder>[/<list>]]). Sem espaço
  // resolvido (escopo global, ou "Minhas Tarefas", ou dados ainda não
  // carregados), cai pro esquema antigo (view no path, escopo em query).
  let spaceId: string | null = null;
  let folderId: string | null = null;
  if (state.activeListId) {
    const list = slugMaps.lists.find(l => l.id === state.activeListId);
    const folder = list ? slugMaps.folders.find(f => f.id === list.folderId) : undefined;
    if (list && folder) {
      folderId = folder.id;
      spaceId = folder.spaceId;
    }
  } else if (state.activeScope.type === 'folder' && state.activeScope.id) {
    const folder = slugMaps.folders.find(f => f.id === state.activeScope.id);
    if (folder) {
      folderId = folder.id;
      spaceId = folder.spaceId;
    }
  } else if (state.activeScope.type === 'space' && state.activeScope.id) {
    spaceId = state.activeScope.id;
  }

  const spaceSlug = spaceId ? slugMaps.spaceIndex.idToSlug.get(spaceId) : undefined;
  if (spaceSlug) {
    const pathParts = [spaceSlug];
    const folderSlug = folderId ? slugMaps.folderIndex.idToSlug.get(folderId) : undefined;
    if (folderSlug) {
      pathParts.push(folderSlug);
      const listSlug = state.activeListId ? slugMaps.listIndex.idToSlug.get(state.activeListId) : undefined;
      if (listSlug) pathParts.push(listSlug);
    }
    // View vira segmento de path (/suprimentos/kanban,
    // /suprimentos/importacao/kanban) — só quando difere do default do
    // escopo: Dashboard (Overview) pra espaço puro, List pra pasta/lista
    // (não existe Overview de pasta — mesma regra de parseNavPath).
    const defaultView: ActiveView = folderSlug ? 'List' : 'Dashboard';
    if (state.activeView !== defaultView) {
      pathParts.push(VIEW_TO_SLUG[state.activeView] || 'dashboard');
    }
    const search = params.toString();
    return `/${pathParts.join('/')}${taskPathSuffix}${search ? `?${search}` : ''}`;
  }

  // Fallback legado: escopo ainda não resolvível em slug (índices vazios,
  // ou é "Minhas Tarefas"/global) — mantém o comportamento anterior.
  const slug = VIEW_TO_SLUG[state.activeView] ?? '';
  if (state.activeListId) {
    params.set('listId', state.activeListId);
  } else if (state.activeScope.type === 'space' && state.activeScope.id) {
    params.set('scope', 'space');
    params.set('scopeId', state.activeScope.id);
  } else if (state.activeScope.type === 'folder' && state.activeScope.id) {
    params.set('scope', 'folder');
    params.set('scopeId', state.activeScope.id);
  } else if (state.activeScope.name === 'Minhas Tarefas') {
    params.set('mine', '1');
  }
  const search = params.toString();
  return `${slug ? `/${slug}` : '/'}${taskPathSuffix}${search ? `?${search}` : ''}`;
}

// Troca (ou adiciona) o sufixo `/tarefa/<slug>-<id>` no final de um pathname
// — usado pelos botões "Compartilhar"/"Copiar link", que herdam o path da
// página atual (espaço/pasta/lista/view) mas podem apontar pra uma tarefa
// diferente da que está aberta ali (ex.: menu de contexto numa linha da
// lista). Sem `task` carregado (raro — id vindo de fora do `tasks` atual),
// só limpa um sufixo antigo e deixa o chamador decidir o fallback.
function withTaskPathSuffix(pathname: string, task: { id: string; title: string } | undefined): string {
  const base = pathname.replace(new RegExp(`/${TASK_PATH_SEGMENT}/[^/]+$`), '');
  if (!task) return base;
  return `${base}/${TASK_PATH_SEGMENT}/${slugify(task.title)}-${task.id.slice(0, 8)}`;
}

type DuplicateTaskBooleanOption = Exclude<keyof DuplicateTaskOptions, 'title' | 'listId'>;

// --- Theme presets (HSL tokens) ---
type ThemePresetId = "claro" | "grafite" | "oceano" | "floresta" | "ameixa";
const THEME_PRESETS: Record<ThemePresetId, { label: string; vars: Record<string, string> }> = {
  claro: {
    label: "Claro",
    vars: {
      "--background": "0 0% 100%",
      "--foreground": "222.2 84% 4.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "222.2 84% 4.9%",
      "--muted": "210 40% 96.1%",
      "--muted-foreground": "215.4 16.3% 46.9%",
      "--border": "214.3 31.8% 91.4%",
      "--input": "214.3 31.8% 91.4%",
      "--primary": "45 96% 51%",
      "--primary-foreground": "222.2 47.4% 11.2%",
      "--ring": "45 96% 51%",
      "--sidebar-background": "0 0% 98%",
      "--sidebar-foreground": "240 5.3% 26.1%",
      "--sidebar-accent": "240 4.8% 95.9%",
      "--sidebar-accent-foreground": "240 5.9% 10%",
      "--sidebar-border": "220 13% 91%",
    },
  },
  grafite: {
    label: "Grafite",
    vars: {
      "--background": "210 40% 98%",
      "--foreground": "222.2 84% 4.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "222.2 84% 4.9%",
      "--muted": "210 40% 96.1%",
      "--muted-foreground": "215.4 16.3% 46.9%",
      "--border": "214.3 31.8% 91.4%",
      "--input": "214.3 31.8% 91.4%",
      "--primary": "210 100% 56%",
      "--primary-foreground": "210 40% 98%",
      "--ring": "210 100% 56%",
      "--sidebar-background": "222.2 47.4% 11.2%",
      "--sidebar-foreground": "210 40% 98%",
      "--sidebar-accent": "217.2 32.6% 17.5%",
      "--sidebar-accent-foreground": "210 40% 98%",
      "--sidebar-border": "217.2 32.6% 17.5%",
    },
  },
  oceano: {
    label: "Oceano",
    vars: {
      "--background": "204 45% 98%",
      "--foreground": "222.2 84% 4.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "222.2 84% 4.9%",
      "--muted": "204 40% 94%",
      "--muted-foreground": "215.4 16.3% 46.9%",
      "--border": "205 30% 88%",
      "--input": "205 30% 88%",
      "--primary": "199 89% 48%",
      "--primary-foreground": "210 40% 98%",
      "--ring": "199 89% 48%",
      "--sidebar-background": "203 52% 14%",
      "--sidebar-foreground": "210 40% 98%",
      "--sidebar-accent": "203 45% 20%",
      "--sidebar-accent-foreground": "210 40% 98%",
      "--sidebar-border": "203 45% 20%",
    },
  },
  floresta: {
    label: "Floresta",
    vars: {
      "--background": "120 20% 98%",
      "--foreground": "222.2 84% 4.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "222.2 84% 4.9%",
      "--muted": "120 15% 94%",
      "--muted-foreground": "215.4 16.3% 46.9%",
      "--border": "120 12% 88%",
      "--input": "120 12% 88%",
      "--primary": "142 72% 38%",
      "--primary-foreground": "210 40% 98%",
      "--ring": "142 72% 38%",
      "--sidebar-background": "148 45% 14%",
      "--sidebar-foreground": "210 40% 98%",
      "--sidebar-accent": "148 35% 20%",
      "--sidebar-accent-foreground": "210 40% 98%",
      "--sidebar-border": "148 35% 20%",
    },
  },
  ameixa: {
    label: "Ameixa",
    vars: {
      "--background": "280 30% 98%",
      "--foreground": "222.2 84% 4.9%",
      "--card": "0 0% 100%",
      "--card-foreground": "222.2 84% 4.9%",
      "--muted": "280 20% 94%",
      "--muted-foreground": "215.4 16.3% 46.9%",
      "--border": "275 18% 88%",
      "--input": "275 18% 88%",
      "--primary": "280 72% 52%",
      "--primary-foreground": "210 40% 98%",
      "--ring": "280 72% 52%",
      "--sidebar-background": "276 45% 14%",
      "--sidebar-foreground": "210 40% 98%",
      "--sidebar-accent": "276 35% 20%",
      "--sidebar-accent-foreground": "210 40% 98%",
      "--sidebar-border": "276 35% 20%",
    },
  },
};

// ── CommentAssignmentBar: linha de "Atribuir"/"Resolver" de um comentário ou
// resposta ("Comentários atribuídos", item 3 da sidebar "Início", estilo
// ClickUp). Compartilhada entre CommentItem e ReplyItem — o widget é
// idêntico nos dois, só muda o que fica "por cima" dele. ──
function CommentAssignmentBar({ item, users, currentUserId, formatDate, onAssign, onResolve }: {
  item: any;
  users: any[];
  currentUserId: string;
  formatDate: (d: string) => string;
  onAssign: (userId: string | null) => void;
  onResolve: () => void;
}) {
  const assignee = item.assignedTo ? users.find((u: any) => u.id === item.assignedTo) : null;
  const isResolved = !!item.resolvedAt;
  const canResolve = !isResolved && (item.assignedTo === currentUserId || item.assignedBy === currentUserId);
  const assignableUsers = [...users]
    .filter((u: any) => u.email !== AI_AGENT_EMAIL)
    .sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR'));

  return (
    <div className="flex items-center gap-2 mt-2 flex-wrap">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={`text-[11px] font-semibold flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              assignee
                ? isResolved ? 'text-green-600 bg-green-50' : 'text-purple-600 bg-purple-50'
                : 'text-gray-400 hover:text-purple-500 hover:bg-purple-50'
            }`}
          >
            <Icons.UserCheck className="w-3 h-3" />
            {assignee ? assignee.name : 'Atribuir'}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56 max-h-72 overflow-y-auto">
          {assignee && (
            <>
              <DropdownMenuItem onClick={() => onAssign(null)} className="text-red-500 text-sm">Remover atribuição</DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}
          {assignableUsers.map((u: any) => (
            <DropdownMenuItem
              key={u.id}
              // Clicar em quem já está atribuído seria um no-op visual, mas
              // assignTaskComment sempre limpa resolved_at/resolved_by — sem
              // essa guarda, reabriria como pendente um item já resolvido.
              onClick={() => { if (u.id !== item.assignedTo) onAssign(u.id); }}
              className="flex items-center gap-2 text-sm"
            >
              <img src={avatarThumb(u.avatar) || `https://picsum.photos/seed/${u.id}/100`} className="w-5 h-5 rounded-full" alt="" />
              {u.name}
              {item.assignedTo === u.id && <Icons.Check className="w-3.5 h-3.5 ml-auto text-purple-500" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {assignee && (
        isResolved ? (
          <span className="text-[11px] font-semibold text-green-600 flex items-center gap-1" title={formatDate(item.resolvedAt)}>
            <Icons.CheckCircle2 className="w-3 h-3" /> Resolvido
          </span>
        ) : canResolve ? (
          <button onClick={onResolve} className="text-[11px] font-semibold text-gray-400 hover:text-green-600 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-green-50 transition-colors">
            <Icons.CheckCircle2 className="w-3 h-3" /> Resolver
          </button>
        ) : (
          <span className="text-[11px] text-gray-300 font-medium">pendente</span>
        )
      )}
    </div>
  );
}

// ── ReplyItem: resposta de comentário (edição/exclusão inline, sem sub-respostas) ──
function ReplyItem({ item, users, teams, currentUserId, taskId, onEdit, onDelete, onAssign, onResolve, formatDate }: {
  item: any;
  users: any[];
  teams: any[];
  currentUserId: string;
  taskId: string;
  onEdit: (taskId: string, commentId: string, text: string) => Promise<void>;
  onDelete: (taskId: string, commentId: string) => Promise<void>;
  onAssign: (taskId: string, commentId: string, userId: string | null) => void;
  onResolve: (taskId: string, commentId: string) => void;
  formatDate: (d: string) => string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(item.text);
  const [saving, setSaving] = React.useState(false);
  const author = users.find((u: any) => u.id === item.userId);
  const isOwn = item.userId === currentUserId;

  const handleSave = async () => {
    if (!editText.trim() || editText === item.text) { setEditing(false); return; }
    setSaving(true);
    try {
      await onEdit(taskId, item.id, editText.trim());
      setEditing(false);
    } catch (err) {
      console.error('Erro ao salvar resposta:', err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="relative group/comment">
      <div className="absolute -left-[22px] top-0 w-5 h-5 rounded-full border-2 border-white shadow-sm overflow-hidden bg-white hover:scale-150 z-10 transition-all cursor-pointer">
        <img src={avatarThumb(author?.avatar) || `https://picsum.photos/seed/${item.userId}/100`} alt="" />
      </div>
      <div className="bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-xs font-bold text-gray-900">{author?.name}</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-gray-300">{formatDate(item.timestamp)}{item.updatedAt ? ' · editado' : ''}</span>
            {isOwn && !editing && (
              <div className="flex items-center gap-1 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                <button onClick={() => { setEditText(item.text); setEditing(true); }} className="text-[10px] text-gray-400 hover:text-blue-500 font-semibold px-1.5 py-0.5 rounded hover:bg-blue-50 transition-all">Editar</button>
                <button onClick={() => onDelete(taskId, item.id)} className="text-[10px] text-gray-400 hover:text-red-500 font-semibold px-1.5 py-0.5 rounded hover:bg-red-50 transition-all">Excluir</button>
              </div>
            )}
          </div>
        </div>
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={e => setEditText(e.target.value)}
              className="w-full text-sm p-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
              rows={2}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); } if (e.key === 'Escape') setEditing(false); }}
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2 py-1 rounded hover:bg-gray-100">Cancelar</button>
              <button onClick={handleSave} disabled={saving || !editText.trim()} className="text-xs bg-orange-500 text-white font-bold px-3 py-1 rounded-lg hover:brightness-110 disabled:opacity-50">{saving ? '...' : 'Salvar'}</button>
            </div>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-600 leading-relaxed">
              <MentionText text={item.text} users={users || []} teams={teams} />
            </p>
            <CommentAssignmentBar
              item={item}
              users={users}
              currentUserId={currentUserId}
              formatDate={formatDate}
              onAssign={(userId) => onAssign(taskId, item.id, userId)}
              onResolve={() => onResolve(taskId, item.id)}
            />
          </>
        )}
      </div>
    </div>
  );
}

// ── CommentItem: comentário com edição/exclusão inline + thread de respostas ──
function CommentItem({ item, replies, users, teams, currentUserId, taskId, onEdit, onDelete, onReply, onAssign, onResolve, formatDate, autoFocus, onFocusHandled }: {
  item: any;
  replies: any[];
  users: any[];
  teams: any[];
  currentUserId: string;
  taskId: string;
  onEdit: (taskId: string, commentId: string, text: string) => Promise<void>;
  onDelete: (taskId: string, commentId: string) => Promise<void>;
  onReply: (taskId: string, parentCommentId: string, text: string) => Promise<boolean>;
  onAssign: (taskId: string, commentId: string, userId: string | null) => void;
  onResolve: (taskId: string, commentId: string) => void;
  formatDate: (d: string) => string;
  // Quando a tarefa é aberta a partir de uma notificação de comentário: rola
  // até aqui e destaca — 'reply' também abre o campo de resposta já
  // focado, 'resolve' só destaca mesmo (o botão "Resolver" já fica visível
  // no CommentAssignmentBar abaixo).
  autoFocus?: 'reply' | 'resolve' | 'view';
  onFocusHandled?: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [editText, setEditText] = React.useState(item.text);
  const [saving, setSaving] = React.useState(false);
  const [showReplyBox, setShowReplyBox] = React.useState(false);
  const [replyText, setReplyText] = React.useState('');
  const [sendingReply, setSendingReply] = React.useState(false);
  const [repliesOpen, setRepliesOpen] = React.useState(false);
  const [isHighlighted, setIsHighlighted] = React.useState(false);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const author = users.find((u: any) => u.id === item.userId);
  const isOwn = item.userId === currentUserId;

  React.useEffect(() => {
    if (!autoFocus) return;
    cardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setIsHighlighted(true);
    if (replies.length > 0) setRepliesOpen(true);
    if (autoFocus === 'reply') setShowReplyBox(true);
    onFocusHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFocus]);

  // Timer do destaque separado do efeito acima de propósito: `onFocusHandled`
  // limpa o foco no componente pai assim que consumido, o que já muda
  // `autoFocus` pra undefined no próximo render — se o timeout morasse no
  // mesmo efeito, o cleanup cancelaria ele antes de disparar, e o destaque
  // ficava preso ligado pro resto da vida do comentário montado.
  React.useEffect(() => {
    if (!isHighlighted) return;
    const timer = setTimeout(() => setIsHighlighted(false), 2500);
    return () => clearTimeout(timer);
  }, [isHighlighted]);

  const handleSave = async () => {
    if (!editText.trim() || editText === item.text) { setEditing(false); return; }
    setSaving(true);
    try {
      await onEdit(taskId, item.id, editText.trim());
      setEditing(false);
    } catch (err) {
      console.error('Erro ao salvar comentário:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSendReply = async () => {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      const ok = await onReply(taskId, item.id, replyText.trim());
      if (ok) {
        setReplyText('');
        setShowReplyBox(false);
        setRepliesOpen(true);
      }
    } finally {
      setSendingReply(false);
    }
  };

  return (
    <div>
      <div className="relative group/comment">
        <div className="absolute -left-[28px] top-0 w-6 h-6 rounded-full border-2 border-white shadow-sm overflow-hidden bg-white hover:scale-150 z-10 transition-all cursor-pointer">
          <img src={avatarThumb(author?.avatar) || `https://picsum.photos/seed/${item.userId}/100`} alt="" />
        </div>
        <div
          ref={cardRef}
          className={`p-4 rounded-2xl border ml-2 shadow-sm transition-colors duration-500 ${isHighlighted ? 'bg-orange-50 border-orange-300 ring-2 ring-orange-200' : 'bg-gray-50/50 border-gray-100'}`}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-bold text-gray-900">{author?.name}</span>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-300">{formatDate(item.date)}{item.updatedAt ? ' · editado' : ''}</span>
              {isOwn && !editing && (
                <div className="flex items-center gap-1 opacity-0 group-hover/comment:opacity-100 transition-opacity">
                  <button onClick={() => { setEditText(item.text); setEditing(true); }} className="text-[10px] text-gray-400 hover:text-blue-500 font-semibold px-1.5 py-0.5 rounded hover:bg-blue-50 transition-all">Editar</button>
                  <button onClick={() => onDelete(taskId, item.id)} className="text-[10px] text-gray-400 hover:text-red-500 font-semibold px-1.5 py-0.5 rounded hover:bg-red-50 transition-all">Excluir</button>
                </div>
              )}
            </div>
          </div>
          {editing ? (
            <div className="space-y-2">
              <textarea
                value={editText}
                onChange={e => setEditText(e.target.value)}
                className="w-full text-sm p-2 border rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-orange-300 bg-white"
                rows={3}
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSave(); } if (e.key === 'Escape') setEditing(false); }}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2 py-1 rounded hover:bg-gray-100">Cancelar</button>
                <button onClick={handleSave} disabled={saving || !editText.trim()} className="text-xs bg-orange-500 text-white font-bold px-3 py-1 rounded-lg hover:brightness-110 disabled:opacity-50">{saving ? '...' : 'Salvar'}</button>
              </div>
            </div>
          ) : (
            <>
              <p className="text-sm text-gray-600 leading-relaxed">
                <MentionText text={item.text} users={users || []} teams={teams} />
              </p>
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => setShowReplyBox(v => !v)}
                  className="text-[11px] font-semibold text-gray-400 hover:text-orange-500 flex items-center gap-1 transition-colors"
                >
                  <Icons.Reply className="w-3 h-3" /> Responder
                </button>
                {replies.length > 0 && (
                  <button
                    onClick={() => setRepliesOpen(v => !v)}
                    className="text-[11px] font-semibold text-blue-500 hover:underline"
                  >
                    {repliesOpen ? 'Ocultar' : 'Ver'} {replies.length} resposta{replies.length === 1 ? '' : 's'}
                  </button>
                )}
              </div>
              <CommentAssignmentBar
                item={item}
                users={users}
                currentUserId={currentUserId}
                formatDate={formatDate}
                onAssign={(userId) => onAssign(taskId, item.id, userId)}
                onResolve={() => onResolve(taskId, item.id)}
              />
            </>
          )}
        </div>
      </div>

      {showReplyBox && (
        <div className="ml-8 mt-2 bg-gray-50 rounded-xl p-3 border border-gray-100">
          <MentionTextarea
            placeholder="Escreva uma resposta... use @ para mencionar"
            value={replyText}
            onChange={setReplyText}
            onSubmit={handleSendReply}
            users={users || []}
            teams={teams}
            className="w-full bg-transparent border-none focus:ring-0 text-sm p-0 resize-none min-h-[40px]"
            autoFocus
          />
          <div className="flex justify-end gap-2 mt-2">
            <button onClick={() => { setShowReplyBox(false); setReplyText(''); }} className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2 py-1 rounded hover:bg-gray-100">Cancelar</button>
            <button onClick={handleSendReply} disabled={sendingReply || !replyText.trim()} className="text-xs bg-orange-500 text-white font-bold px-3 py-1 rounded-lg hover:brightness-110 disabled:opacity-50">{sendingReply ? '...' : 'Responder'}</button>
          </div>
        </div>
      )}

      {repliesOpen && replies.length > 0 && (
        <div className="ml-8 mt-2 space-y-2 border-l-2 border-gray-100 pl-4">
          {replies.map((r: any) => (
            <ReplyItem
              key={r.id}
              item={r}
              users={users}
              teams={teams}
              currentUserId={currentUserId}
              taskId={taskId}
              onEdit={onEdit}
              onDelete={onDelete}
              onAssign={onAssign}
              onResolve={onResolve}
              formatDate={formatDate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// --- Global Context Mock-up ---
const FALLBACK_USER: User = {
  id: 'loading',
  name: 'Carregando...',
  email: '',
  avatar: 'https://cdn-icons-png.flaticon.com/512/149/149071.png',
  role: UserRole.COLABORADOR,
};

// Conta de serviço usada para o rastro de atividade cross-sistema (ver
// src/lib/trackActivity.ts) — tem perfil em `profiles` (por isso aparece em
// adminUsers), mas não é uma pessoa de verdade: não deve ser oferecida como
// opção nova de responsável de tarefa, menção ou membro de equipe. Continua
// resolvível normalmente (avatar, nome) onde já estiver referenciada, e
// continua visível/gerenciável no Painel Admin.
const AI_AGENT_EMAIL = 'agente.ia@vpsistema.com';

function preserveLoadedTaskDetails(nextTask: Task, previousTask?: Task): Task {
  if (!previousTask) return nextTask;
  return {
    ...nextTask,
    extensionHistory: previousTask.extensionHistory || nextTask.extensionHistory || [],
    checklists: previousTask.checklists || nextTask.checklists || [],
    comments: previousTask.comments || nextTask.comments || [],
    attachments: previousTask.attachments || nextTask.attachments || [],
    activities: previousTask.activities || nextTask.activities || [],
    watcherIds: previousTask.watcherIds || nextTask.watcherIds || [],
  };
}

export default function App() {
  const [currentUser, setCurrentUser] = useState<User>(FALLBACK_USER);
  const [workspace] = useState<Workspace>(INITIAL_WORKSPACE);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [is2faVerified, setIs2faVerified] = useState(() => localStorage.getItem('vp_2fa_verified') === 'true');
  const [ssoError, setSsoError] = useState<string | null>(null);
  // Impede que getSession() libere a tela enquanto o SSO ainda está processando.
  // A URL já foi limpa do token antes do app montar (ver src/lib/ssoEntry.ts),
  // por isso a origem da informação é o módulo, não window.location.
  const isSSOProcessing = useRef(veioDoPortal);
  // true quando getSession()/loadUserProfile esbarra no timeout do LockManager
  // do navegador (disputa da mesma storageKey entre chamadas concorrentes ou
  // abas abertas ao mesmo tempo). É um erro transitório, não uma sessão
  // inválida — por isso mostramos uma tela de recuperação em vez de deixar
  // cair no redirect automático pro portal (ver LoginScreen).
  const [sessionConflict, setSessionConflict] = useState(false);
  const authInitializedRef = useRef(false);

  // Avisa quando uma nova versão foi publicada (deploy é um build estático,
  // sem invalidação — uma aba deixada aberta pode ficar rodando código
  // antigo por muito tempo). Ver src/lib/versionCheck.ts.
  useEffect(() => startVersionCheck(), []);

  // App montou com sucesso: libera um novo reload automático caso um chunk de
  // uma view lazy de um deploy FUTURO também fique stale nesta mesma aba (ver
  // src/lib/lazyRetry.ts — a flag sobrevive ao reload que ela mesma dispara).
  useEffect(() => clearChunkReloadFlag(), []);

  // --- SSO LOGIC ---
  // "Failed to send a request to the Edge Function" é o erro que o supabase-js
  // lança quando o fetch em si falha (rede instável, blip momentâneo do
  // provedor) — não é o sso-exchange recusando o token. Nesses casos vale a
  // pena tentar de novo antes de travar o usuário na tela de erro; já um erro
  // que o sso-exchange respondeu de verdade (token inválido/expirado) não
  // melhora com retry, então esse caso segue direto pro catch sem tentativas.
  const invokeSSOExchange = useCallback(async (token: string) => {
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAY_MS = 800;
    let lastNetworkError: unknown;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const { data, error: exchangeError } = await supabase.functions.invoke('sso-exchange', {
        body: { token },
      });

      if (!exchangeError) {
        if (data?.error) throw new Error(data.error);
        return data;
      }

      const isNetworkFailure = exchangeError.name === 'FunctionsFetchError'
        || /failed to send a request/i.test(exchangeError.message ?? '');
      if (!isNetworkFailure) throw new Error(exchangeError.message || 'Falha ao validar SSO');

      lastNetworkError = exchangeError;
      console.warn(`SSO: falha de rede ao chamar sso-exchange (tentativa ${attempt}/${MAX_ATTEMPTS})`, exchangeError);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
      }
    }

    throw lastNetworkError instanceof Error ? lastNetworkError : new Error('Falha ao validar SSO');
  }, []);

  const handleSSOToken = useCallback(async (token: string) => {
    try {
      console.log("SSO: Iniciando validação de token...");

      // Toda a parte privilegiada (validar o token central, criar/sincronizar
      // usuário e perfil, gerar o magic link) roda na Edge Function
      // sso-exchange, com a service_role key só no servidor. O front nunca
      // vê essa chave — só recebe de volta o token_hash de um magic link
      // recém-gerado e de uso único, que troca por sessão a seguir.
      const data = await invokeSSOExchange(token);

      const tokenHash = data?.token_hash;
      if (!tokenHash) throw new Error("hashed_token ausente");

      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type: 'magiclink',
      });

      if (verifyError) throw verifyError;

      // SSO bypassa 2FA — marcar como verificado
      localStorage.setItem('vp_2fa_verified', 'true');
      setIs2faVerified(true);
    } catch (err) {
      console.error("SSO Error:", err);
      setSsoError(err instanceof Error ? err.message : String(err));
      toast.error("Falha no login via SSO");
      setIsLoadingAuth(false);
    }
  }, [invokeSSOExchange]);

  useEffect(() => {
    // O token já foi lido e removido da URL antes do app montar; aqui só
    // processamos. A limpeza antecipada também preserva os outros parâmetros
    // (antes o `taskId` de um link direto era descartado junto com o token).
    if (ssoToken) {
      // Mantém loading enquanto SSO processa — evita redirect prematuro do LoginScreen
      setIsLoadingAuth(true);
      handleSSOToken(ssoToken).finally(() => {
        isSSOProcessing.current = false;
      });
    }
  }, [handleSSOToken]);

  // --- Persistence Handlers ---
  const uploadFile = useCallback(async (file: File, path: string, bucket: string = 'doc-files'): Promise<string | null> => {
    try {
      const { data, error } = await supabase.storage
        .from(bucket)
        .upload(path, file, { cacheControl: '3600', upsert: true });

      if (error) throw error;

      const { data: { publicUrl } } = supabase.storage
        .from(bucket)
        .getPublicUrl(data.path);

      return publicUrl;
    } catch (err: any) {
      console.error('Erro no upload:', err);
      const msg: string = err?.message || '';
      if (msg.includes('Bucket not found')) {
        toast.error(`Falha no upload: o bucket "${bucket}" não existe no Storage. Avise o administrador (migration 08).`);
      } else if (msg.includes('row-level security') || msg.includes('violates') || err?.statusCode === '403' || err?.status === 403) {
        toast.error('Falha no upload: sem permissão no Storage. Avise o administrador (políticas do bucket).');
      } else if (msg.includes('exceeded') || msg.includes('too large') || err?.statusCode === '413') {
        toast.error('Falha no upload: arquivo muito grande para o limite do bucket.');
      } else {
        toast.error(`Falha no upload do arquivo${msg ? `: ${msg}` : '.'}`);
      }
      return null;
    }
  }, []);

  const saveTaskAttachment = useCallback(async (taskId: string, attachment: Partial<Attachment>) => {
    try {
      const { attachment: created, error } = await taskRepo.insertAttachment(taskId, attachment);
      if (!created) {
        console.error('Erro ao salvar anexo:', error);
        toast.error(`Falha ao salvar o anexo${error ? `: ${error}` : '.'}`);
        return false;
      }

      setTasks(prev => prev.map(t => t.id === taskId
        ? { ...t, attachments: [...(t.attachments || []), created] }
        : t));
      return true;
    } catch (err: any) {
      console.error('Erro ao salvar anexo:', err);
      toast.error(`Falha ao salvar o anexo${err?.message ? `: ${err.message}` : '.'}`);
      return false;
    }
  }, []);

  const removeTaskAttachment = useCallback(async (taskId: string, attachmentId: string) => {
    const { error } = await taskRepo.deleteAttachment(attachmentId);
    if (error) {
      console.error('Erro ao excluir anexo:', error);
      toast.error(`Falha ao excluir o anexo: ${error}`);
      return;
    }

    setTasks(prev => prev.map(t => t.id === taskId
      ? { ...t, attachments: (t.attachments || []).filter(a => a.id !== attachmentId) }
      : t));
    toast.success('Anexo excluído.');
  }, []);

  // Retorna o id do comentário criado (não só true/false) — quem chama
  // precisa dele pra passar comentário/menção pra notifyMentions, senão a
  // notificação fica sem comment_id e o clique nunca sabe pra onde rolar.
  const saveTaskComment = useCallback(async (taskId: string, text: string, parentCommentId?: string): Promise<string | false> => {
    if (!currentUser) return false;
    try {
      const { comment, error } = await taskRepo.insertComment(taskId, currentUser.id, text, parentCommentId);
      if (comment) {
        setTasks(prev => prev.map(t => t.id === taskId
          ? { ...t, comments: [...(t.comments || []), comment] }
          : t));
        return comment.id;
      }
      console.error('Erro ao salvar comentário:', error);
      toast.error('Erro ao salvar comentário: ' + (error || 'tente novamente.'));
      return false;
    } catch (err) {
      console.error('Erro inesperado ao salvar comentário:', err);
      toast.error('Erro inesperado ao salvar comentário. Tente novamente.');
      return false;
    }
  }, [currentUser]);

  const editTaskComment = useCallback(async (taskId: string, commentId: string, newText: string) => {
    const now = new Date().toISOString();
    const { error } = await taskRepo.updateCommentText(commentId, newText, now);
    if (error) { toast.error('Erro ao editar comentário.'); return; }
    setTasks(prev => prev.map(t => t.id !== taskId ? t : {
      ...t,
      comments: (t.comments || []).map(c => c.id === commentId ? { ...c, text: newText, updatedAt: now } : c),
    }));
  }, []);

  const deleteTaskComment = useCallback(async (taskId: string, commentId: string) => {
    // Exclui o comentário e, junto, as respostas da thread (soft delete não
    // aciona o ON DELETE CASCADE do banco — sem isso as respostas ficariam
    // órfãs: continuariam na tabela mas sem comentário raiz pra aparecer).
    const { error } = await taskRepo.softDeleteCommentThread(commentId, new Date().toISOString());
    if (error) { toast.error('Erro ao excluir comentário.'); return; }
    setTasks(prev => prev.map(t => t.id !== taskId ? t : {
      ...t,
      comments: (t.comments || []).filter(c => c.id !== commentId && c.parentCommentId !== commentId),
    }));
    toast.success('Comentário excluído.');
  }, []);

  // Atribui (ou remove a atribuição de) um comentário/resposta a alguém —
  // "Comentários atribuídos" (item 3 da sidebar "Início", estilo ClickUp).
  // Reatribuir ou remover a atribuição também limpa uma resolução anterior:
  // o item volta a valer como pendente para o novo estado.
  const assignTaskComment = useCallback(async (taskId: string, commentId: string, userId: string | null) => {
    if (!currentUser) return;
    const { error } = await taskRepo.assignComment(commentId, userId, userId ? currentUser.id : null);
    if (error) { toast.error('Erro ao atribuir comentário.'); return; }
    setTasks(prev => prev.map(t => t.id !== taskId ? t : {
      ...t,
      comments: (t.comments || []).map(c => c.id === commentId ? {
        ...c,
        assignedTo: userId || undefined,
        assignedBy: userId ? currentUser.id : undefined,
        resolvedAt: undefined,
        resolvedBy: undefined,
      } : c),
    }));
  }, [currentUser]);

  // Marca um comentário/resposta atribuído como resolvido — a tarefa deixa de
  // ficar bloqueada por ele (ver hasUnresolvedAssignedComments).
  const resolveTaskComment = useCallback(async (taskId: string, commentId: string) => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    const { error } = await taskRepo.resolveComment(commentId, currentUser.id, now);
    if (error) { toast.error('Erro ao resolver comentário.'); return; }
    setTasks(prev => prev.map(t => t.id !== taskId ? t : {
      ...t,
      comments: (t.comments || []).map(c => c.id === commentId ? { ...c, resolvedAt: now, resolvedBy: currentUser.id } : c),
    }));
  }, [currentUser]);

  // isWatching vem do call site para evitar referência circular com tasks
  const toggleWatcher = useCallback(async (taskId: string, isWatching: boolean) => {
    if (!currentUser || currentUser.id === 'loading') return;
    if (isWatching) {
      const { error } = await taskRepo.removeWatcher(taskId, currentUser.id);
      if (error) { toast.error('Erro ao parar de observar.'); return; }
      setTasks(prev => prev.map(t => t.id !== taskId ? t : { ...t, watcherIds: (t.watcherIds || []).filter(id => id !== currentUser.id) }));
    } else {
      const { error } = await taskRepo.addWatcher(taskId, currentUser.id);
      if (error) { toast.error('Erro ao observar tarefa.'); return; }
      setTasks(prev => prev.map(t => t.id !== taskId ? t : { ...t, watcherIds: [...(t.watcherIds || []), currentUser.id] }));
      toast.success('Você está observando esta tarefa.');
    }
  }, [currentUser]);

  const saveTaskActivity = useCallback(async (taskId: string, type: string, oldValue?: string, newValue?: string) => {
    if (!currentUser || currentUser.id === 'loading') return null;
    const { activity, error } = await taskRepo.insertActivity(taskId, currentUser.id, type, oldValue, newValue);
    if (activity) {
      setTasks(prev => prev.map(t => t.id === taskId
        ? { ...t, activities: [activity, ...(t.activities || [])] }
        : t));
      return activity;
    }
    if (error) console.error('Erro ao registrar atividade:', error);
    return null;
  }, [currentUser]);

  const saveExtensionLog = useCallback(async (taskId: string, log: ExtensionLog) => {
    if (!currentUser) return;
    await taskRepo.insertExtensionLog(taskId, log, currentUser.id);
  }, [currentUser]);

  const loadUserProfile = useCallback(async (userId: string) => {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (data) {
        setCurrentUser({
          id: data.id,
          name: data.name,
          email: data.email,
          avatar: data.avatar || `https://picsum.photos/seed/${data.id}/100`,
          role: data.role as UserRole,
          theme: data.theme,
        });
      } else {
        // Fallback: busca dados diretamente do Auth e tenta criar perfil se faltar
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const isGeovane = user.email === 'geovane.silva@verticalparts.com.br';
          const userData = {
            id: user.id,
            name: user.user_metadata?.name || user.email?.split('@')[0] || 'Usuário',
            email: user.email || '',
            avatar: user.user_metadata?.avatar || `https://picsum.photos/seed/${user.id}/100`,
            role: (isGeovane ? UserRole.ADMIN : (user.user_metadata?.role as UserRole)) || UserRole.COLABORADOR,
          };

          // Criar perfil no banco para evitar violações de FK em outras tabelas.
          // Sem RETURNING: em ambiente com RLS, o insert pode passar e a leitura
          // da linha recém-criada falhar, prendendo o usuário em recarregamentos.
          const { error: profileInsertError } = await supabase.from('profiles').insert([userData]);
          if (profileInsertError) throw profileInsertError;

          setCurrentUser(userData);
        }
      }
    } catch (err: any) {
      console.error('Erro ao carregar perfil:', err);
      if (err?.isAcquireTimeout || err?.message?.includes('LockManager')) {
        if (!isSSOProcessing.current) setSessionConflict(true);
      } else {
        toast.error('Erro ao carregar dados do usuário. Tente recarregar.');
      }
    }
  }, []);

  // Fonte primária de auth: getSession ao montar (e de novo no "Tentar
  // novamente" da tela de conflito de sessão). Erro de LockManager é tratado
  // como transitório — não desloga ninguém, só pede pra tentar de novo.
  const checkSession = useCallback(async () => {
    setSessionConflict(false);
    try {
      const { data: { session: s }, error } = await supabase.auth.getSession();
      if (error) {
        if (error?.isAcquireTimeout || error.message?.includes('LockManager')) {
          if (!isSSOProcessing.current) setSessionConflict(true);
        } else {
          console.error("Erro ao obter sessão:", error);
        }
      } else {
        setSession(s);
        if (s) {
          try {
            await loadUserProfile(s.user.id);
          } catch (err) {
            console.error("Erro ao carregar perfil durante getSession:", err);
          }
        }
      }
    } catch (err: any) {
      console.error("Erro fatal ao verificar sessão:", err);
      if (err?.isAcquireTimeout || err?.message?.includes('LockManager')) {
        if (!isSSOProcessing.current) setSessionConflict(true);
      } else {
        toast.error("Erro ao verificar sessão. Por favor, recarregue a página.");
      }
    } finally {
      if (!isSSOProcessing.current) setIsLoadingAuth(false);
      authInitializedRef.current = true;
    }
  }, [loadUserProfile]);

  // Botão "Tentar novamente" da tela de conflito de sessão.
  const handleRetrySession = useCallback(() => {
    setIsLoadingAuth(true);
    checkSession();
  }, [checkSession]);

  // Botão "Sair e entrar novamente". Não usa supabase.auth.signOut(): esse
  // método também disputa o mesmo lock que já está travado, então pode
  // ficar pendurado do mesmo jeito. Como o objetivo aqui é uma saída
  // garantida do estado travado, limpamos a sessão local direto e recarregamos
  // — o próximo carregamento passa pelo fluxo normal (SSO do portal ou login).
  const handleSignOutAndRestart = useCallback(() => {
    try {
      localStorage.removeItem('vp-click-user-auth');
      localStorage.removeItem('vp_2fa_verified');
    } catch {
      // localStorage bloqueado — segue pro reload mesmo assim
    }
    window.location.href = '/';
  }, []);

  useEffect(() => {
    authInitializedRef.current = false;
    checkSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, s) => {
      // Ignorar eventos iniciais — checkSession() já cuida do carregamento
      if (!authInitializedRef.current && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
        return;
      }

      if (event === 'SIGNED_OUT') {
        setSession(null);
        setCurrentUser(FALLBACK_USER);
        setIs2faVerified(false);
        localStorage.removeItem('vp_2fa_verified');
        setIsLoadingAuth(false);
        return;
      }

      if (event === 'TOKEN_REFRESHED' && s) {
        // Apenas atualiza o token sem recarregar todo o perfil
        setSession(s);
        return;
      }

      // Outros eventos pós-login (ex: SIGNED_IN após logout/re-login)
      if (s) {
        setSession(s);
        try {
          await loadUserProfile(s.user.id);
        } catch (err) {
          console.error("Erro ao carregar perfil no onAuthStateChange:", err);
        }
        setIsLoadingAuth(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [checkSession, loadUserProfile]);

  // --- Rastro de acesso cross-sistema (timeline central do vpsistema) ---
  // Dispara "enter" uma única vez assim que a identidade real do usuário
  // (e-mail vindo do perfil local do VPClick, já sincronizado com o
  // vpsistema pelo fluxo de SSO acima) fica disponível — nunca antes disso
  // e nunca em loop. "exit" é disparado no pagehide da aba, reaproveitando
  // o mesmo session_id salvo em sessionStorage.
  const hasTrackedEnterRef = useRef(false);
  const currentUserRef = useRef(currentUser);
  currentUserRef.current = currentUser;

  useEffect(() => {
    if (currentUser.email && currentUser.id !== 'loading' && !hasTrackedEnterRef.current) {
      hasTrackedEnterRef.current = true;
      trackEnter(currentUser.email, currentUser.name);
    }
  }, [currentUser.email, currentUser.id, currentUser.name]);

  useEffect(() => {
    const onPageHide = () => {
      const u = currentUserRef.current;
      if (u.email && u.id !== 'loading') {
        trackExit(u.email, u.name);
      }
    };
    // pagehide (em vez de beforeunload) por causa do bfcache — dispara de
    // forma confiável tanto em navegação/fechamento quanto em bfcache.
    window.addEventListener('pagehide', onPageHide);
    return () => window.removeEventListener('pagehide', onPageHide);
  }, []);

  // Theme State (temas prontos)
  const [themePreset, setThemePreset] = useState<ThemePresetId>(() => {
    const saved = localStorage.getItem("vp_theme_preset") as ThemePresetId | null;
    return saved && saved in THEME_PRESETS ? saved : "claro";
  });
  const [uiScale, setUiScale] = useState(1); // 1 = 100%
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);

  const applyThemePreset = useCallback((presetId: ThemePresetId) => {
    const preset = THEME_PRESETS[presetId];
    if (!preset) return;

    Object.entries(preset.vars).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }, []);

  useEffect(() => {
    applyThemePreset(themePreset);
    localStorage.setItem("vp_theme_preset", themePreset);

    // Persist to Supabase if user is logged in
    if (currentUser && currentUser.id !== 'loading') {
      supabase.from('profiles').update({ theme: themePreset }).eq('id', currentUser.id)
        .then(({ error }) => {
          if (error) console.error('Erro ao salvar tema no perfil:', error);
        });
    }
  }, [themePreset, applyThemePreset, currentUser.id]);

  // Sync themePreset with currentUser when it's loaded
  useEffect(() => {
    if (currentUser.theme && currentUser.theme in THEME_PRESETS) {
      setThemePreset(currentUser.theme as ThemePresetId);
    }
  }, [currentUser.theme]);

  const [statusGroups, setStatusGroups] = useState<StatusGroup[]>([]);
  const [isCreateListModalOpen, setIsCreateListModalOpen] = useState(false);
  const [createListFolderId, setCreateListFolderId] = useState<string | null>(null);

  const [spaces, setSpaces] = useState<Space[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  // Fica `true` só depois que espaços/pastas/listas terminam de carregar (ver
  // loadInitialData) — antes disso os índices de slug abaixo estão vazios, e
  // qualquer URL de escopo (/suprimentos/importacao) cai no fallback global
  // até esse flag virar true (ver efeito de entrada, mais abaixo).
  const [workspaceMetaLoaded, setWorkspaceMetaLoaded] = useState(false);
  // `true` depois que a URL foi resolvida contra os dados reais pelo menos
  // uma vez (ver efeito de entrada/saída, mais abaixo). Também usada por
  // loadTasks (logo adiante): antes disso, activeView/activeScope ainda
  // podem estar no fallback Dashboard/global temporário de uma URL tipo
  // /suprimentos/importacao (índices de slug ainda vazios) — buscar tarefas
  // pra esse escopo FALSO e concluir "não existe" apagava um selectedTaskId
  // que só ainda não tinha tido chance de resolver pro escopo de verdade
  // (achado testando link direto pra tarefa numa pasta grande, 2026-09-06).
  const hasResolvedInitialUrlRef = useRef(false);
  const navSlugMaps = useMemo<NavSlugMaps>(() => ({
    spaces,
    folders,
    lists,
    spaceIndex: buildSlugIndex(spaces, s => s.id, s => s.name),
    folderIndex: buildSlugIndex(folders, f => f.id, f => f.name, f => f.spaceId),
    listIndex: buildSlugIndex(lists, l => l.id, l => l.name, l => l.folderId),
  }), [spaces, folders, lists]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [myTasks, setMyTasks] = useState<Task[]>([]);
  const [isTasksLoading, setIsTasksLoading] = useState(false);
  // Diferente de isTasksLoading (que já vira false após só a 1ª página, pra
  // UI parecer rápida — ver loadTasks): só vira true quando TODAS as páginas
  // do escopo terminaram. Usado pelo efeito "tarefa não existe mais" logo
  // abaixo, que senão dispara um falso positivo pra qualquer tarefa fora da
  // 1ª leva de 100.
  const [isTasksFullyLoaded, setIsTasksFullyLoaded] = useState(false);
  const [isMyTasksLoading, setIsMyTasksLoading] = useState(false);
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  const [fieldValues, setFieldValues] = useState<CustomFieldValue[]>([]);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [workspaceTags, setWorkspaceTags] = useState<WorkspaceTag[]>([]);
  const [filterTags, setFilterTags] = useState<string[]>([]);
  const [sortConfig, setSortConfig] = useState<{ field: 'created' | 'title' | 'priority' | 'dueDate' | 'status'; direction: 'asc' | 'desc' }>({ field: 'created', direction: 'asc' });
  // "Atribuídas a mim" (item 6 da sidebar "Início"): igual ao ClickUp, tarefas
  // concluídas ficam escondidas por padrão nessa visualização específica.
  const [showClosedInMyTasks, setShowClosedInMyTasks] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [isTeamsModalOpen, setIsTeamsModalOpen] = useState(false);

  useEffect(() => {
    // localStorage.removeItem("vp_docs"); // Clean up old mock data if needed
  }, []);

  // Campos personalizados visíveis por Lista (protótipo local)
  const [hiddenTaskFieldIdsByList, setHiddenTaskFieldIdsByList] = useState<Record<string, string[]>>({});

  // Colunas padrão visíveis por Lista (protótipo local)
  type StandardColumnKey = "status" | "priority" | "assignee" | "extensions" | "dueDate";
  const [hiddenStandardColumnKeysByList, setHiddenStandardColumnKeysByList] = useState<Record<string, StandardColumnKey[]>>({});

  // Ordem das colunas por Lista (protótipo local)
  const [columnOrderByList, setColumnOrderByList] = useState<Record<string, string[]>>(() => {
    const saved = localStorage.getItem("vp_column_order");
    return saved ? JSON.parse(saved) : {};
  });

  useEffect(() => {
    localStorage.setItem("vp_column_order", JSON.stringify(columnOrderByList));
  }, [columnOrderByList]);

  // Navegação (view/escopo/lista) ↔ URL — ver parseNavPath/computeNavPath.
  // `navigate`/`location`/`navigationType` alimentam os efeitos de sincronização
  // logo após handleNavigate; `initialNav` só é lido pelos inicializadores
  // preguiçosos de estado abaixo (roda uma vez, na primeira renderização).
  const navigate = useNavigate();
  const location = useLocation();
  const navigationType = useNavigationType();
  const initialNav = parseNavPath(window.location.pathname, window.location.search, navSlugMaps);

  // Lista ativa (selecionada na sidebar) — afeta filtro e configuração de colunas por lista
  const [activeListId, setActiveListId] = useState<string | null>(() => initialNav.listId);

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  const [activeView, setActiveView] = useState<ActiveView>(() => initialNav.view);
  const [isCommandOpen, setIsCommandOpen] = useState(false);
  const [isAutomationModalOpen, setIsAutomationModalOpen] = useState(false);
  const [automationListId, setAutomationListId] = useState<string | null>(null);

  // --- Inline Rename / Confirm modal state ---
  const [renameModal, setRenameModal] = useState<{ title: string; defaultValue: string; placeholder?: string; onSubmit: (v: string) => void } | null>(null);
  const [confirmModal, setConfirmModal] = useState<{ message: string; onConfirm: () => void; confirmLabel?: string; variant?: 'danger' | 'warning' } | null>(null);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsCommandOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);
  const [activeDocId, setActiveDocId] = useState<string | null>(() => initialNav.docId);
  const [activeScope, setActiveScope] = useState<NavigationScope>(() => ({
    type: initialNav.scopeType,
    id: initialNav.scopeId,
    name: initialNav.scopeName,
  }));

  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(() => initialNav.taskId);
  // Id curto (8 chars) de uma URL tipo .../tarefa/<slug>-<8chars> ainda não
  // resolvido pra um `selectedTaskId` completo — precisa esperar `tasks` do
  // escopo carregar pra achar a tarefa correspondente (ver efeito de
  // resolução logo após loadTasks, mais abaixo).
  const [pendingTaskSlugId, setPendingTaskSlugId] = useState<string | null>(() => initialNav.taskSlugId);
  const [openMeetingId, setOpenMeetingId] = useState<string | null>(null);
  const handleOpenMeeting = (meetingId: string) => {
    setOpenMeetingId(meetingId);
    setActiveView('Meetings');
  };
  const [isFieldManagerOpen, setIsFieldManagerOpen] = useState(false);
  // Quando o gerenciador de campos é aberto de DENTRO de uma tarefa, o escopo
  // deve ser a lista da tarefa — não o `fieldManagerListId` derivado do
  // activeListId (que pode ser outro se a tarefa foi aberta via busca/dashboard/
  // minhas tarefas). Este override carrega a lista da tarefa; null = usa a
  // resolução padrão (sidebar/listview).
  const [fieldManagerListIdOverride, setFieldManagerListIdOverride] = useState<string | null>(null);
  const [taskToDuplicate, setTaskToDuplicate] = useState<Task | null>(null);
  const [isDuplicatingTask, setIsDuplicatingTask] = useState(false);
  // Issue #184 fase 3: configuração de recorrência. A regra é carregada sob
  // demanda quando o modal abre (uma tarefa tem no máximo 1 regra).
  const [recurrenceConfigTask, setRecurrenceConfigTask] = useState<Task | null>(null);
  const [recurrenceConfigRule, setRecurrenceConfigRule] = useState<TaskRecurrenceRule | null>(null);
  const [isLoadingRecurrenceRule, setIsLoadingRecurrenceRule] = useState(false);
  const [isSavingRecurrenceRule, setIsSavingRecurrenceRule] = useState(false);
  // Regras das tarefas atualmente visíveis (carregado sob demanda por
  // openTaskRecurrenceModal e após mutações) — usado só pro indicador dentro
  // do TaskDetailModal, não precisa cobrir toda a lista/kanban.
  const [taskRecurrenceRuleCache, setTaskRecurrenceRuleCache] = useState<Record<string, TaskRecurrenceRule | null>>({});

  // New State for Creation Modals
  const [isSpaceModalOpen, setIsSpaceModalOpen] = useState(false);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);
  const [isCreateWikiModalOpen, setIsCreateWikiModalOpen] = useState(false);
  const [isTaskModalOpen, setIsTaskModalOpen] = useState(false); // New Task Modal State
  const [prefilledTaskData, setPrefilledTaskData] = useState<Partial<Task> | null>(null);
  const [targetSpaceId, setTargetSpaceId] = useState<string | null>(null);

  // User Menu State
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [showGlobalAI, setShowGlobalAI] = useState(false);
  const [isChangePasswordModalOpen, setIsChangePasswordModalOpen] = useState(false);

  // Admin - carregado do Supabase
  const [userAccess, setUserAccess] = useState<Record<string, { spaceIds: string[]; folderIds: string[] }>>({});
  // Diretório de usuários do workspace + operações de admin (ver useUsers).
  const {
    adminUsers,
    lastSignInMap,
    handleAdminUpdateRole,
    handleAdminUpdateAccess,
    handleAdminDeleteUser,
    handleAdminUpdateUserAvatar,
    handleAdminUpdatePassword,
    handleAdminCreateUser,
  } = useUsers({ session, currentUser, setCurrentUser, setUserAccess });

  // Listas acessíveis ao usuário (RLS já restringe `lists`): usadas para filtrar
  // o Dashboard e os contadores por lista no servidor, em vez de varrer todas
  // as tarefas avaliando a RLS linha a linha.
  const countListIds = useMemo(() => lists.map((l) => l.id), [lists]);

  // Dashboard: ADMIN já enxerga todas as listas (RLS permite tudo), então o
  // filtro por list_id só soma overhead ao `.in()` com centenas de IDs sem
  // eliminar nenhuma linha (medido: ~40% mais lento por página). `null` pula
  // o filtro nesse caso; GESTOR/COLABORADOR seguem filtrados por countListIds.
  const dashboardListIds = currentUser.role === UserRole.ADMIN ? null : countListIds;

  // Tarefas do Dashboard, filtradas pelas listas acessíveis ao usuário (ou sem
  // filtro para ADMIN — ver dashboardListIds acima).
  const { dashboardTasks, dashboardLists, isDashboardLoading, loadDashboardTasks } = useDashboard(session, activeView, dashboardListIds);

  const loadInitialData = useCallback(async () => {
    try {
      // As 13 leituras abaixo são independentes entre si (nenhuma usa o
      // resultado de outra) — disparar todas em paralelo em vez de uma atrás
      // da outra evita somar 13 round-trips de rede em sequência ao boot do
      // app (facilmente vários segundos a mais em conexão ruim).
      const [
        { data: spacesData },
        { data: foldersData },
        { data: listsData },
        { data: fieldsData },
        { data: docsData },
        { data: attachmentsData },
        { data: projectsData },
        { data: tagsData },
        { data: accessData },
        { data: teamsData },
        { data: teamMembersData },
        { data: groupsData },
        { data: optionsData },
      ] = await Promise.all([
        supabase.from('spaces').select('*'),
        supabase.from('folders').select('*'),
        supabase.from('lists').select('*'),
        supabase.from('custom_fields').select('*'),
        supabase.from('docs').select('*'),
        supabase.from('doc_attachments').select('*'),
        supabase.from('projects').select('*'),
        supabase.from('workspace_tags').select('*').eq('workspace_id', workspace.id).order('name'),
        supabase.from('user_access').select('*'),
        supabase.from('teams').select('*').order('name'),
        supabase.from('team_members').select('*'),
        supabase.from('task_status_groups').select('*'),
        supabase.from('task_status_options').select('*').order('order_index'),
      ]);

      if (spacesData) {
        setSpaces(spacesData.map((s: any) => ({
          id: s.id,
          name: s.name,
          workspaceId: s.workspace_id,
          color: s.color,
          icon: s.icon,
          isSystem: s.is_system ?? false,
          createdAt: s.created_at,
        })));
      }

      if (foldersData) {
        setFolders(foldersData.map((f: any) => ({
          id: f.id,
          name: f.name,
          spaceId: f.space_id
        })));
      }

      if (listsData) {
        // Lista pessoal (ver migration 18): privacidade só no client — a RLS
        // é permissiva, então o próprio carregamento do estado local precisa
        // excluir listas pessoais de outros usuários, senão qualquer lugar
        // que itere `lists` (paleta de comando, etc.) vaza pra qualquer um.
        const myId = session?.user?.id;
        setLists(listsData
          .filter((l: any) => !l.owner_id || l.owner_id === myId)
          .map((l: any) => ({
            id: l.id,
            name: l.name,
            folderId: l.folder_id,
            statusGroupId: l.status_group_id,
            ownerId: l.owner_id || undefined
          })));
      }

      if (fieldsData) {
        setCustomFields(fieldsData.map((f: any) => ({
          id: f.id,
          name: f.name,
          type: f.type as CustomFieldType,
          isMandatory: f.is_mandatory,
          defaultValue: f.default_value,
          config: f.config,
          target: f.target,
          visibleTo: f.visible_to,
          createdBy: f.created_by,
          createdAt: f.created_at
        })));
      }

      if (docsData) {
        setDocs(docsData.map((d: any) => {
          const docAttachments = (attachmentsData || [])
            .filter((a: any) => a.doc_id === d.id)
            .map((a: any) => ({
              id: a.id,
              name: a.name,
              url: a.url,
              type: a.type,
              size: a.size,
              uploadedAt: a.uploaded_at
            }));

          return {
            id: d.id,
            title: d.title,
            content: d.content || '',
            headerImage: d.header_image,
            folderId: d.folder_id,
            createdBy: d.created_by,
            attachments: docAttachments,
            parentId: d.parent_id,
            isWiki: d.is_wiki || false
          };
        }));
      }

      if (projectsData) {
        setProjects(projectsData.map((p: any) => ({
          id: p.id,
          name: p.name,
          department: p.department,
          managerId: p.manager_id,
          status: p.status,
          lists: []
        })));
      }

      if (tagsData) setWorkspaceTags(tagsData as WorkspaceTag[]);

      if (accessData) {
        const nextAccess: Record<string, { spaceIds: string[]; folderIds: string[] }> = {};
        accessData.forEach((a: any) => {
          nextAccess[a.user_id] = {
            spaceIds: a.space_ids || [],
            folderIds: a.folder_ids || [],
          };
        });
        setUserAccess(nextAccess);
      }

      if (teamsData) {
        setTeams(teamsData.map((t: any) => ({
          id: t.id,
          name: t.name,
          description: t.description || '',
          color: t.color || '#8b5cf6',
          memberIds: (teamMembersData || []).filter((m: any) => m.team_id === t.id).map((m: any) => m.user_id),
        })));
      }

      if (groupsData && optionsData) {
        setStatusGroups(groupsData.map((g: any) => ({
          id: g.id,
          name: g.name,
          options: optionsData.filter((o: any) => o.group_id === g.id).map((o: any) => ({
            id: o.id,
            groupId: o.group_id,
            label: o.label,
            color: o.color,
            type: o.type as StatusType,
            orderIndex: o.order_index
          }))
        })));
      }

      setWorkspaceMetaLoaded(true);
    } catch (err) {
      console.error('Erro ao carregar dados iniciais:', err);
    }
  }, [session]);

  useEffect(() => {
    if (session) {
      loadInitialData();
    }
  }, [session, loadInitialData]);

  // Realtime: atualiza userAccess + recarrega spaces/folders quando admin alterar permissões
  useEffect(() => {
    if (!session?.user?.id) return;
    const userId = session.user.id;
    const channel = supabase
      .channel(`user-access-${userId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'user_access',
        filter: `user_id=eq.${userId}`
      }, async (payload: any) => {
        const row = payload.new || payload.old;
        if (row && payload.eventType !== 'DELETE') {
          // Atualiza acesso
          setUserAccess(prev => ({
            ...prev,
            [userId]: {
              spaceIds: row.space_ids || [],
              folderIds: row.folder_ids || [],
            }
          }));
          // Recarrega spaces e folders para garantir que novos espaços criados
          // após o login do usuário sejam incluídos no array
          const { data: spacesData } = await supabase.from('spaces').select('*');
          if (spacesData) {
            setSpaces(spacesData.map((s: any) => ({
              id: s.id, name: s.name, workspaceId: s.workspace_id, color: s.color, icon: s.icon, isSystem: s.is_system ?? false, createdAt: s.created_at
            })));
          }
          const { data: foldersData } = await supabase.from('folders').select('*');
          if (foldersData) {
            setFolders(foldersData.map((f: any) => ({
              id: f.id, name: f.name, spaceId: f.space_id
            })));
          }
          const { data: listsData } = await supabase.from('lists').select('*');
          if (listsData) {
            setLists(listsData
              .filter((l: any) => !l.owner_id || l.owner_id === session?.user?.id)
              .map((l: any) => ({
                id: l.id, name: l.name, folderId: l.folder_id, statusGroupId: l.status_group_id, ownerId: l.owner_id || undefined
              })));
          }
          // Explícito (não via reação a `lists`/`folders` mudando de
          // referência): no escopo global e de lista específica,
          // `scopedListIds` fica estável (null) mesmo quando essas arrays
          // mudam, então loadTasks não reroda sozinho aqui — sem isso, um
          // usuário recém-liberado para um novo espaço/pasta só veria as
          // tarefas novas após um F5 (achado de review).
          loadTasksRef.current?.();
        }
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.user?.id]);

  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  // Contadores exatos por lista (badges da sidebar + progresso da SpaceOverview),
  // independentes do escopo carregado. `refreshTaskCountIndex` é religado no
  // realtime abaixo. `countListIds` é calculado mais acima (reaproveitado
  // também pelo Dashboard).
  const { listTaskCounts, listProgressMap, refreshTaskCountIndex } = useTaskCountIndex(session, countListIds);

  // `?taskId=` na carga inicial (deep link) já é lido pelo inicializador de
  // selectedTaskId acima (initialNav.taskId) — sem travar em somente-leitura:
  // quem recebe o link já está autenticado no app com seu próprio papel, não
  // é um visitante externo. Navegações POSTERIORES (voltar/avançar do
  // navegador) são tratadas pelo efeito de entrada logo após handleNavigate.

  // Issue #185, gota 3 ("mostrar arquivadas"): mantidas FORA de `tasks` de
  // propósito — evita ter que filtrar tarefas arquivadas em cada view
  // (Kanban/Calendário/Gantt/Tabela/Dashboard), que já não as recebem do
  // servidor (loadTasks usa taskRepo.selectNormalTasks). Só carregadas sob
  // demanda quando o painel de arquivadas é aberto (ver loadArchivedTasks).
  const [archivedTasks, setArchivedTasks] = useState<Task[]>([]);
  const [isArchivedPanelOpen, setIsArchivedPanelOpen] = useState(false);
  const [isArchivedLoading, setIsArchivedLoading] = useState(false);

  // Issue #185, gota 4 ("Lixeira"): mesmo raciocínio da gota 3 — fora de
  // `tasks` de propósito, carregada sob demanda ao abrir o painel.
  const [trashedTasks, setTrashedTasks] = useState<Task[]>([]);
  const [isTrashPanelOpen, setIsTrashPanelOpen] = useState(false);
  const [isTrashLoading, setIsTrashLoading] = useState(false);
  // Motivo da exclusão (seção 10 da issue) — perguntado antes de mover pra
  // Lixeira. Guarda só o id da tarefa (não o objeto) pra não prender uma
  // referência potencialmente desatualizada enquanto o modal fica aberto.
  const [trashReasonModal, setTrashReasonModal] = useState<{ taskId: string } | null>(null);

  // Issue #185, gotas 3/4: uma tarefa aberta a partir do painel "Tarefas
  // arquivadas" ou da "Lixeira" não está em `tasks` (loadTasks já filtra
  // archived_at/deleted_at) — sem este fallback, o efeito de "tarefa não
  // existe mais" logo abaixo a fecharia na hora.
  const selectedTask = useMemo(
    () => tasks.find(t => t.id === selectedTaskId)
      ?? archivedTasks.find(t => t.id === selectedTaskId)
      ?? trashedTasks.find(t => t.id === selectedTaskId),
    [tasks, archivedTasks, trashedTasks, selectedTaskId],
  );

  // Carrega a regra de recorrência da tarefa aberta (se houver) só pro
  // indicador visual no TaskDetailModal — não bloqueia a UI, chave ausente no
  // cache = "ainda não checou", null = "checou, não tem regra".
  useEffect(() => {
    if (!selectedTask) return;
    let cancelled = false;
    setTaskRecurrenceRuleCache((prev) => {
      if (selectedTask.id in prev) return prev; // já checado — não refaz a busca
      taskRepo.fetchRecurrenceRuleForTask(selectedTask.id).then((rule) => {
        if (!cancelled) setTaskRecurrenceRuleCache((cur) => ({ ...cur, [selectedTask.id]: rule }));
      });
      return prev;
    });
    return () => { cancelled = true; };
  }, [selectedTask]);

  // Qual comentário deixar rolado/destacado (e qual ação já deixar pronta —
  // responder ou resolver) quando a tarefa é aberta a partir de uma
  // notificação de comentário/menção, em vez de abrir só a tarefa em geral.
  const [taskCommentFocus, setTaskCommentFocus] = useState<{ commentId: string; action?: 'reply' | 'resolve' } | null>(null);
  const openTaskComment = useCallback((taskId: string, commentId: string, action?: 'reply' | 'resolve') => {
    setSelectedTaskId(taskId);
    setTaskCommentFocus({ commentId, action });
  }, []);

  // Notificação/link apontando pra uma tarefa que já foi apagada (ou que o
  // usuário não tem mais acesso): antes o clique simplesmente não abria nada
  // e não dava nenhuma pista do porquê. `tasks.length > 0` evita um falso
  // positivo enquanto a lista ainda está carregando pela primeira vez.
  useEffect(() => {
    if (
      selectedTaskId
      && isTasksFullyLoaded
      && !tasks.some(t => t.id === selectedTaskId)
      && !archivedTasks.some(t => t.id === selectedTaskId)
      && !trashedTasks.some(t => t.id === selectedTaskId)
    ) {
      toast.error('Essa tarefa não existe mais ou você não tem acesso a ela.');
      setSelectedTaskId(null);
      setTaskCommentFocus(null);
    }
  }, [selectedTaskId, tasks, archivedTasks, trashedTasks, isTasksFullyLoaded]);

  // Resolve .../tarefa/<slug>-<8chars> (ver pendingTaskSlugId) assim que
  // `tasks` do escopo carregar por completo: acha a tarefa cujo id começa
  // com esses 8 chars e vira selectedTaskId de verdade. Mesmo aviso de "não
  // existe mais" do efeito acima quando o escopo já carregou e ninguém bate
  // — espera `isTasksFullyLoaded`, não só a 1ª página, senão uma tarefa fora
  // das primeiras 100 (ordenadas por created_at) parecia "não existir".
  useEffect(() => {
    if (!pendingTaskSlugId || !isTasksFullyLoaded) return;
    const match = tasks.find(t => t.id.startsWith(pendingTaskSlugId));
    if (match) {
      setSelectedTaskId(match.id);
    } else {
      toast.error('Essa tarefa não existe mais ou você não tem acesso a ela.');
    }
    setPendingTaskSlugId(null);
  }, [pendingTaskSlugId, tasks, isTasksFullyLoaded]);

  // Card "Recentes" de Minhas Tarefas: registra toda tarefa aberta, pra
  // qualquer entrada (clique na lista, notificação, link direto etc.).
  useEffect(() => {
    if (selectedTaskId && currentUser?.id && currentUser.id !== 'loading') {
      recordRecentTaskId(currentUser.id, selectedTaskId);
    }
  }, [selectedTaskId, currentUser?.id]);

  // Guarda contra corrida: se o escopo mudar (ou o realtime disparar outro
  // reload) enquanto uma chamada de loadTasks() ainda está em andamento, uma
  // resposta antiga que chegue depois de uma mais nova sobrescreveria `tasks`
  // com os dados do escopo errado — a lista parece ter tarefas e "fecha"
  // sozinha (some) pouco depois, até um F5 disparar uma única chamada limpa.
  // Cada chamada carimba um id crescente; só grava quem tiver um id mais novo
  // que o da última chamada que efetivamente gravou (loadTasksCommittedIdRef)
  // — não simplesmente "quem for a mais recente em voo", pra uma chamada mais
  // nova que falhe (erro de rede) não invalidar/descartar o resultado bom de
  // uma mais antiga que ainda está terminando.
  const loadTasksRequestIdRef = useRef(0);
  const loadTasksCommittedIdRef = useRef(0);
  // Uma segunda tentativa automática por falha (não por request): erros de
  // rede/RLS logo após o login costumam ser transitórios e sumiam sem deixar
  // rastro (array vazio ficava travado até um F5 manual).
  const loadTasksRetriedRef = useRef(false);

  // Lazy-load das sub-entidades ao abrir uma tarefa. As listagens carregam as
  // tarefas SEM comentários/checklists/anexos/atividades/logs/watchers (para
  // escalar a milhares de tarefas — ver loadTasks). Quando a tarefa é aberta,
  // buscamos essas sub-entidades só para ela e mesclamos no array `tasks`, de
  // onde o modal de detalhe lê. Sempre refetch ao abrir (idempotente, poucas
  // queries) para refletir alterações feitas por outros usuários.
  useEffect(() => {
    const id = selectedTaskId;
    if (!id) return;
    let cancelled = false;
    (async () => {
      const subs = await taskRepo.fetchTaskDetails(id);
      if (cancelled) return;
      setTasks(prev => prev.map(t => t.id === id ? { ...t, ...subs } : t));
    })();
    return () => { cancelled = true; };
  }, [selectedTaskId]);

  // Resolve o escopo ativo (lista/pasta/espaço) para o conjunto de listas a
  // buscar. Memoizado (em vez de calculado dentro de loadTasks) para que,
  // no escopo global e no de lista específica — os dois casos abaixo em que
  // o resultado não depende de `lists`/`folders` — o valor fique
  // referencialmente estável (`null`) mesmo quando essas listas mudam de
  // referência (ex.: `loadInitialData` preenchendo-as logo após o login).
  // Sem isso, loadTasks (que tinha `lists`/`folders` cru nas deps) reiniciava
  // no meio de uma paginação em andamento — a segunda página em voo perdia a
  // corrida do guard de requestId e ficava descartada para sempre, deixando
  // `tasks` travado só na 1ª página (achado de QA: Calendário em branco no
  // 1º load global, e contagem parcial na Lista após "Atualizar agora").
  const scopedListIds = useMemo((): string[] | null => {
    if (!activeListId && activeScope.type === 'folder' && activeScope.id) {
      return lists.filter(l => l.folderId === activeScope.id).map(l => l.id);
    }
    if (activeScope.type === 'space' && activeScope.id) {
      const spaceFolderIds = folders.filter(f => f.spaceId === activeScope.id).map(f => f.id);
      return lists.filter(l => spaceFolderIds.includes(l.folderId)).map(l => l.id);
    }
    return null;
  }, [activeListId, activeScope, lists, folders]);

  const loadTasks = useCallback(async () => {
    if (!session) return;
    // `currentUser` ainda é o placeholder FALLBACK_USER (id 'loading') logo
    // após o login, antes do perfil real chegar — chamar fetchMyTaskRows com
    // esse id gera 400 (uuid inválido) toda vez que "Minhas Tarefas" carrega
    // nessa janela. O efeito que dispara loadTasks já reage a mudanças de
    // currentUser.id (ver abaixo), então essa corrida se resolve sozinha.
    if (currentUser.id === 'loading') return;
    // Antes da URL ser resolvida contra os dados reais (ver
    // hasResolvedInitialUrlRef), activeView/activeScope ainda podem estar no
    // fallback Dashboard/global temporário de uma URL tipo
    // /suprimentos/importacao — buscar tarefas pra esse escopo FALSO batia
    // isGlobalDashboard, marcava `isTasksFullyLoaded` na hora e apagava um
    // selectedTaskId (vindo de ?taskId= ou já resolvido) que só ainda não
    // tinha tido chance de carregar no escopo de verdade. O efeito de
    // entrada sempre cria um `activeScope` novo (objeto novo, mesmo quando o
    // valor não muda), então este loadTasks dispara de novo assim que ele
    // rodar — não fica travado pra sempre.
    if (!hasResolvedInitialUrlRef.current) return;

    const requestId = ++loadTasksRequestIdRef.current;
    // "Tarefa não existe mais" (ver efeito logo abaixo) só pode confiar em
    // `tasks` depois que a carga estiver DE VERDADE completa — a 1ª página
    // (100 linhas) já dispara `tasks.length > 0` bem antes das páginas
    // restantes chegarem, e uma tarefa fora dessas 100 primeiras (ordenadas
    // por created_at) parecia "não existir" e fechava o modal sozinha
    // (achado testando link direto pra uma tarefa antiga numa pasta com
    // 3374 tarefas, 2026-09-06).
    setIsTasksFullyLoaded(false);
    const isGlobalDashboard = activeView === 'Dashboard' && activeScope.type === 'global' && !activeListId;
    if (isGlobalDashboard) {
      setIsTasksLoading(false);
      setIsTasksFullyLoaded(true);
      return;
    }

    if (activeView === 'MyTasks') {
      setIsTasksLoading(false);
      setIsMyTasksLoading(true);
      try {
        const rows = await taskRepo.fetchMyTaskRows(currentUser.id);
        const mappedTasks = rows.map(taskRepo.mapRowToTaskShell);

        if (requestId < loadTasksCommittedIdRef.current) return;
        loadTasksCommittedIdRef.current = requestId;
        loadTasksRetriedRef.current = false;
        setMyTasks(mappedTasks);
        setTasks(prev => {
          const merged = new Map(prev.map(t => [t.id, t]));
          for (const t of mappedTasks) merged.set(t.id, preserveLoadedTaskDetails(t, merged.get(t.id)));
          return Array.from(merged.values());
        });
        setIsTasksFullyLoaded(true);
      } catch (err) {
        console.error('Erro ao carregar Minhas Tarefas:', err);
        if (requestId === loadTasksRequestIdRef.current && !loadTasksRetriedRef.current) {
          loadTasksRetriedRef.current = true;
          // Via loadTasksRef (não loadTasks() direto): se o escopo mudou durante
          // a espera do retry, essa closure ficaria presa no escopo antigo.
          setTimeout(() => { loadTasksRef.current?.(); }, 1500);
        } else {
          loadTasksRetriedRef.current = false;
          toast.error('Não foi possível carregar suas tarefas. Tente novamente.');
        }
      } finally {
        setIsMyTasksLoading(false);
      }
      return;
    }

    // Lista aberta usa um caminho dedicado (`list_id = X`), para não pagar o
    // custo das leituras amplas quando o usuário só quer aquele quadro.
    const listIds = scopedListIds;

    // Sub-entidades NÃO são hidratadas aqui (carregadas sob demanda ao abrir a
    // tarefa) — mantém o load barato mesmo com dezenas de milhares de tarefas.
    setIsTasksLoading(true);
    try {
      const firstRows = activeListId
        ? await taskRepo.fetchInitialTaskRowsByListId(activeListId)
        : await taskRepo.fetchInitialTaskRowsByListIds(listIds);

      if (requestId < loadTasksCommittedIdRef.current) return; // um resultado de escopo mais novo já foi gravado
      loadTasksCommittedIdRef.current = requestId;
      setTasks(prev => firstRows
        .map(taskRepo.mapRowToTaskShell)
        .map(task => preserveLoadedTaskDetails(task, prev.find(existing => existing.id === task.id))));
      setIsTasksLoading(false);

      if (firstRows.length < taskRepo.INITIAL_TASK_PAGE_SIZE) {
        // Só reseta o retry quando a carga terminou de verdade (única página) —
        // resetar logo após a 1ª página, com mais páginas ainda por vir, deixava
        // uma falha persistente em fetchRemainingTaskRows* reagendar retry pra
        // sempre (a cada volta a 1ª página carregava OK e zerava a flag nesse
        // ponto de novo) sem nunca chegar no toast de erro terminal.
        loadTasksRetriedRef.current = false;
        setIsTasksFullyLoaded(true);
        return;
      }

      const remainingRows = activeListId
        ? await taskRepo.fetchRemainingTaskRowsByListId(activeListId)
        : await taskRepo.fetchRemainingTaskRowsByListIds(listIds);

      if (requestId !== loadTasksRequestIdRef.current) return;
      setTasks(prev => [...firstRows, ...remainingRows]
        .map(taskRepo.mapRowToTaskShell)
        .map(task => preserveLoadedTaskDetails(task, prev.find(existing => existing.id === task.id))));
      loadTasksRetriedRef.current = false;
      setIsTasksFullyLoaded(true);
    } catch (err) {
      console.error('Erro ao carregar tarefas:', err);
      if (requestId === loadTasksRequestIdRef.current && !loadTasksRetriedRef.current) {
        loadTasksRetriedRef.current = true;
        // Via loadTasksRef (não loadTasks() direto): se o usuário navegar para
        // outro escopo durante a espera do retry, essa closure antiga ainda
        // apontaria pro escopo velho e poderia sobrescrever um resultado novo
        // e bom com dado do escopo errado.
        setTimeout(() => { loadTasksRef.current?.(); }, 1500);
      } else {
        loadTasksRetriedRef.current = false;
        setIsTasksFullyLoaded(true);
        toast.error('Não foi possível carregar as tarefas. Tente novamente.');
      }
    } finally {
      if (requestId === loadTasksRequestIdRef.current) {
        setIsTasksLoading(false);
      }
    }
  }, [session, activeListId, activeScope, activeView, currentUser.id, scopedListIds]);

  useEffect(() => {
    loadTasks();
  }, [loadTasks]);

  // Mantém uma referência sempre atualizada de loadTasks para o realtime não
  // precisar recriar o canal a cada mudança de escopo.
  const loadTasksRef = useRef(loadTasks);
  useEffect(() => { loadTasksRef.current = loadTasks; }, [loadTasks]);
  const refreshTaskCountIndexRef = useRef(refreshTaskCountIndex);
  useEffect(() => { refreshTaskCountIndexRef.current = refreshTaskCountIndex; }, [refreshTaskCountIndex]);
  const loadDashboardTasksRef = useRef(loadDashboardTasks);
  useEffect(() => { loadDashboardTasksRef.current = loadDashboardTasks; }, [loadDashboardTasks]);
  const activeViewRef = useRef(activeView);
  useEffect(() => { activeViewRef.current = activeView; }, [activeView]);
  const selectedTaskIdRef = useRef(selectedTaskId);
  useEffect(() => { selectedTaskIdRef.current = selectedTaskId; }, [selectedTaskId]);

  // ── Busca server-side de tarefas por título (bug #9 do #81) ──────────────
  // O array `tasks` é limitado à janela carregada: o PostgREST devolve no
  // máximo ~1000 linhas por request e o workspace tem milhares de tarefas.
  // Filtrar apenas localmente fazia a busca não encontrar tarefas fora dessa
  // janela. Aqui consultamos o banco por título e mesclamos os resultados
  // hidratados em `tasks`, para que tanto as views quanto o modal de detalhe
  // (que lê de `tasks`) os enxerguem. O filtro client-side em `filteredTasks`
  // continua aplicando escopo/papel/tags/ordenação por cima.
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) { setIsSearching(false); return; }
    let cancelled = false;
    setIsSearching(true);
    const handle = setTimeout(async () => {
      const rows = await taskRepo.searchTaskRowsByTitle(q, 200);
      if (cancelled) return;
      if (rows.length > 0) {
        const hydrated = await taskRepo.hydrateTaskRows(rows);
        if (cancelled) return;
        setTasks(prev => {
          const merged = new Map(prev.map(t => [t.id, t]));
          for (const t of hydrated) merged.set(t.id, t);
          return Array.from(merged.values());
        });
      }
      if (!cancelled) setIsSearching(false);
    }, 400);
    return () => { cancelled = true; clearTimeout(handle); };
  }, [searchQuery]);

  // Realtime de tarefas e comentários: reflete alterações feitas por outros
  // usuários/abas sem precisar recarregar a página. As tabelas precisam estar na
  // publicação `supabase_realtime` (migration 11). Recarrega o escopo atual com
  // debounce para não disparar múltiplas vezes em rajadas de eventos. Se a aba
  // aberta for o Dashboard, também recarrega os dados agregados dele — senão o
  // "dados em tempo real" do rodapé seria só o instantâneo de quando a aba foi
  // aberta, sem refletir mudanças feitas por outros usuários enquanto ela fica
  // visível.
  useEffect(() => {
    if (!session?.user?.id) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleReload = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        loadTasksRef.current?.();
        refreshTaskCountIndexRef.current?.();
        if (activeViewRef.current === 'Dashboard') loadDashboardTasksRef.current?.();
      }, 1200);
    };
    const refreshOpenTaskAttachments = async (payload: any) => {
      const taskId = payload?.new?.task_id || payload?.old?.task_id;
      if (!taskId || taskId !== selectedTaskIdRef.current) return;
      const subs = await taskRepo.fetchTaskDetails(taskId);
      setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...subs } : t));
    };
    const channel = supabase
      .channel('tasks-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tasks' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_comments' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_attachments' }, refreshOpenTaskAttachments)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(channel); };
  }, [session?.user?.id]);

  const belongsToMyTasks = useCallback((task: Task) => (
    task.mainAssigneeId === currentUser.id ||
    (task.secondaryAssigneeIds || []).includes(currentUser.id) ||
    task.createdBy === currentUser.id
  ), [currentUser.id]);

  const updateTask = useCallback(async (updatedTask: Task): Promise<boolean> => {
    try {
      const res = await taskRepo.updateTaskFields(updatedTask);
      if (res.ok) {
        setTasks(prev => prev.map(t => t.id === updatedTask.id ? { ...t, ...updatedTask } : t));
        setMyTasks(prev => {
          const nextTask = { ...(prev.find(t => t.id === updatedTask.id) || {}), ...updatedTask } as Task;
          if (belongsToMyTasks(nextTask)) {
            return prev.some(t => t.id === updatedTask.id)
              ? prev.map(t => t.id === updatedTask.id ? nextTask : t)
              : [nextTask, ...prev];
          }
          return prev.filter(t => t.id !== updatedTask.id);
        });
        return true;
      }
      console.error('Erro ao atualizar tarefa:', res.message);
      toast.error('Erro ao salvar tarefa: ' + res.message);
      return false;
    } catch (err) {
      console.error('Erro inesperado ao atualizar tarefa:', err);
      toast.error('Erro inesperado ao salvar tarefa.');
      return false;
    }
  }, [belongsToMyTasks]);

  const handleUpdateTask = useCallback(async (taskId: string, updates: Partial<Task>): Promise<boolean> => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return false;

    if (updates.status && isDoneLikeStatus(updates.status)) {
      const blockReason = await getTaskCloseBlockReason(taskId);
      if (blockReason) {
        toast.warning(blockReason);
        return false;
      }
    }

    const ok = await updateTask({ ...task, ...updates });
    // Achado na auditoria da Caixa de Entrada: esse é o caminho genérico da
    // Tabela (dropdown de responsável por linha e atribuição em massa, que
    // chama isso mesmo por tarefa) — nenhum dos dois notificava. Notifica só
    // quando o responsável de fato muda.
    if (ok && updates.mainAssigneeId !== undefined && updates.mainAssigneeId && updates.mainAssigneeId !== task.mainAssigneeId) {
      notifyAssignment({ userIds: [updates.mainAssigneeId], actor: currentUser, taskId, taskTitle: task.title });
    }
    return ok;
  }, [tasks, updateTask, currentUser]);

  // --- Bulk Actions (T701) ---
  const handleBulkStatusChange = async (ids: string[], status: string) => {
    let targetIds = ids;
    if (isDoneLikeStatus(status)) {
      const blockReasons = await Promise.all(ids.map(id => getTaskCloseBlockReason(id)));
      targetIds = ids.filter((_, i) => !blockReasons[i]);
      const blockedCount = ids.length - targetIds.length;
      if (blockedCount > 0) {
        toast.warning(`${blockedCount} tarefa(s) não foram alteradas: bloqueadas por dependência ou comentário atribuído pendente.`);
      }
      if (targetIds.length === 0) return;
    }

    const { error } = await taskRepo.bulkUpdateStatus(targetIds, status);
    if (!error) {
      setTasks(prev => prev.map(t => targetIds.includes(t.id) ? { ...t, status } : t));
      setMyTasks(prev => prev.map(t => targetIds.includes(t.id) ? { ...t, status } : t));
      toast.success(`${targetIds.length} tarefa(s) atualizadas para "${status}"`);
    } else {
      toast.error('Erro ao alterar status: ' + error);
    }
  };

  const handleBulkPriorityChange = async (ids: string[], priority: TaskPriority) => {
    const { error } = await taskRepo.bulkUpdatePriority(ids, priority);
    if (!error) {
      setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, priority } : t));
      setMyTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, priority } : t));
      toast.success(`${ids.length} tarefa(s) com prioridade alterada para "${priority}"`);
    } else {
      toast.error('Erro ao alterar prioridade: ' + error);
    }
  };

  const handleBulkDelete = (ids: string[]) => {
    setConfirmModal({
      message: `Excluir ${ids.length} tarefa(s) permanentemente?`,
      onConfirm: async () => {
        const { error } = await taskRepo.bulkDelete(ids);
        if (!error) {
          setTasks(prev => prev.filter(t => !ids.includes(t.id)));
          setMyTasks(prev => prev.filter(t => !ids.includes(t.id)));
          toast.success(`${ids.length} tarefa(s) removidas.`);
        } else {
          toast.error('Erro ao deletar tarefas: ' + error);
        }
      }
    });
  };

  const handleBulkMove = async (ids: string[], listId: string) => {
    const { error } = await taskRepo.bulkMove(ids, listId);
    if (!error) {
      setTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, listId } : t));
      setMyTasks(prev => prev.map(t => ids.includes(t.id) ? { ...t, listId } : t));
      toast.success(`${ids.length} tarefa(s) movidas.`);
    } else {
      toast.error('Erro ao mover tarefas: ' + error);
    }
  };

  // --- Deletion and Renaming Logic ---
  // Issue #185, gota 4 — soft delete real (seção 8/9 da issue): "Excluir" não
  // apaga mais na hora, abre o seletor de motivo (TrashReasonModal) e move
  // pra Lixeira. handleConfirmMoveToTrash faz o soft delete de verdade.
  const handleDeleteTask = (taskId: string) => {
    setTrashReasonModal({ taskId });
  };

  const handleConfirmMoveToTrash = async (reasonCode: string | null, reasonText: string | null) => {
    const taskId = trashReasonModal?.taskId;
    if (!taskId) return;
    setTrashReasonModal(null);
    const res = await taskRepo.softDeleteTaskTree(taskId, currentUser.id, reasonCode, reasonText);
    if (!res.ok) { toast.error('Erro ao mover tarefa para a Lixeira: ' + res.message); return; }
    // Só o nível de topo — o mesmo critério que o hard-delete anterior já
    // usava aqui (subtarefas somem do array local no próximo loadTasks/
    // realtime, não há remoção em cascata client-side).
    setTasks(prev => prev.filter(t => t.id !== taskId));
    setMyTasks(prev => prev.filter(t => t.id !== taskId));
    setArchivedTasks(prev => prev.filter(t => t.id !== taskId));
    if (selectedTaskId === taskId) setSelectedTaskId(null);
    await taskRepo.insertActivity(taskId, currentUser.id, 'TASK_MOVED_TO_TRASH', undefined, reasonCode ?? undefined);
    toast.success('Tarefa movida para a Lixeira.');
  };

  // Restaura (seção 13): a tarefa volta pro balde certo — `archivedTasks` se
  // já estava arquivada antes de ser excluída (softDeleteTaskTree nunca mexeu
  // em archived_at), `tasks` caso contrário.
  const handleRestoreTask = async (task: Task) => {
    const res = await taskRepo.restoreTaskTree(task.id);
    if (!res.ok) { toast.error('Erro ao restaurar tarefa: ' + res.message); return; }
    const restored: Task = {
      ...task,
      deletedAt: undefined,
      deletedBy: undefined,
      purgeAfter: undefined,
      deletionReasonCode: undefined,
      deletionReasonText: undefined,
    };
    if (restored.archivedAt) {
      setArchivedTasks(prev => prev.some(t => t.id === task.id) ? prev.map(t => t.id === task.id ? restored : t) : [restored, ...prev]);
    } else {
      setTasks(prev => prev.some(t => t.id === task.id) ? prev.map(t => t.id === task.id ? restored : t) : [...prev, restored]);
    }
    setTrashedTasks(prev => prev.filter(t => t.id !== task.id));
    await taskRepo.insertActivity(task.id, currentUser.id, 'TASK_RESTORED');
    toast.success('Tarefa restaurada.');
  };

  // Carrega sob demanda (só quando o painel "Lixeira" abre), mesmo escopo que
  // loadArchivedTasks/loadTasks usam.
  const loadTrashedTasks = useCallback(async () => {
    setIsTrashLoading(true);
    try {
      const rows = await taskRepo.fetchTrashedTasksByListIds(activeListId ? [activeListId] : scopedListIds);
      setTrashedTasks(rows.map(taskRepo.mapRowToTaskShell));
    } catch (err) {
      console.error('Erro ao carregar a Lixeira:', err);
      toast.error('Não foi possível carregar a Lixeira.');
    } finally {
      setIsTrashLoading(false);
    }
  }, [activeListId, scopedListIds]);

  // Issue #185, gota 2 — arquivar/desarquivar. Dimensão independente do
  // status (seção 1 da issue): NUNCA muda `status` aqui. Mantém a tarefa no
  // array local em memória mesmo depois de arquivada (só as próximas cargas
  // do servidor já filtram archived_at — ver taskRepo.selectNormalTasks) pra
  // não fechar o modal de detalhe sozinho logo depois de arquivar.
  const handleArchiveTask = (task: Task) => {
    const isDoneLike = isDoneLikeStatus(task.status);
    const doArchive = async () => {
      const res = await taskRepo.archiveTask(task.id, currentUser.id);
      if (!res.ok) { toast.error('Erro ao arquivar tarefa: ' + res.message); return; }
      const archivedAt = new Date().toISOString();
      const archived = { ...task, archivedAt, archivedBy: currentUser.id };
      setTasks(prev => prev.map(t => t.id === task.id ? archived : t));
      // Mantém o painel "Tarefas arquivadas" (gota 3) coerente sem precisar
      // reabrir/recarregar, caso já esteja aberto.
      setArchivedTasks(prev => prev.some(t => t.id === task.id)
        ? prev.map(t => t.id === task.id ? archived : t)
        : [archived, ...prev]);
      await taskRepo.insertActivity(task.id, currentUser.id, 'TASK_ARCHIVED');
      toast.success('Tarefa arquivada.');
    };
    if (isDoneLike) {
      doArchive();
    } else {
      setConfirmModal({
        message: 'Esta tarefa ainda não está concluída. Arquivá-la irá removê-la das visualizações normais, mas seu status continuará o mesmo.',
        confirmLabel: 'Arquivar mesmo assim',
        variant: 'warning',
        onConfirm: doArchive,
      });
    }
  };

  const handleUnarchiveTask = async (task: Task) => {
    const res = await taskRepo.unarchiveTask(task.id);
    if (!res.ok) { toast.error('Erro ao desarquivar tarefa: ' + res.message); return; }
    const unarchived = { ...task, archivedAt: undefined, archivedBy: undefined };
    // A tarefa pode ter vindo do painel de arquivadas (gota 3) e nunca ter
    // estado em `tasks` (loadTasks já filtra archived_at) — adiciona em vez
    // de só mapear, senão desarquivar por lá não reflete em lugar nenhum.
    setTasks(prev => prev.some(t => t.id === task.id)
      ? prev.map(t => t.id === task.id ? unarchived : t)
      : [...prev, unarchived]);
    setArchivedTasks(prev => prev.filter(t => t.id !== task.id));
    await taskRepo.insertActivity(task.id, currentUser.id, 'TASK_UNARCHIVED');
    toast.success('Tarefa desarquivada.');
  };

  // Issue #185, gota 3: carrega sob demanda (só quando o painel abre), no
  // mesmo escopo (lista/pasta/espaço ativo) que loadTasks usa pra tarefas
  // normais — ver scopedListIds acima.
  const loadArchivedTasks = useCallback(async () => {
    setIsArchivedLoading(true);
    try {
      const rows = await taskRepo.fetchArchivedTasksByListIds(activeListId ? [activeListId] : scopedListIds);
      setArchivedTasks(rows.map(taskRepo.mapRowToTaskShell));
    } catch (err) {
      console.error('Erro ao carregar tarefas arquivadas:', err);
      toast.error('Não foi possível carregar as tarefas arquivadas.');
    } finally {
      setIsArchivedLoading(false);
    }
  }, [activeListId, scopedListIds]);

  const handleDeleteSpace = (spaceId: string) => {
    // Bloquear exclusão de spaces nativos do Hub de Integrações
    const space = spaces.find(s => s.id === spaceId);
    if (space?.isSystem) {
      toast.error('🔒 Este espaço é nativo do VP Click e não pode ser excluído.');
      return;
    }
    setConfirmModal({
      message: 'Excluir este espaço e todas as suas pastas e tarefas?',
      onConfirm: async () => {
        const { error } = await supabase.from('spaces').delete().eq('id', spaceId).select();
        if (!error) {
          setSpaces(prev => prev.filter(s => s.id !== spaceId));
          setFolders(prev => prev.filter(f => f.spaceId !== spaceId));
          if (activeScope.type === 'space' && activeScope.id === spaceId) handleNavigate('global', null, 'Dashboard');
          toast.success('Espaço excluído.');
        } else { toast.error('Erro ao excluir espaço: ' + error.message); }
      }
    });
  };

  const handleRenameSpace = (spaceId: string, currentName: string) => {
    setRenameModal({
      title: 'Renomear Espaço', defaultValue: currentName,
      onSubmit: async (newName) => {
        const { error } = await supabase.from('spaces').update({ name: newName }).eq('id', spaceId);
        if (!error) {
          setSpaces(prev => prev.map(s => s.id === spaceId ? { ...s, name: newName } : s));
          if (activeScope.type === 'space' && activeScope.id === spaceId) setActiveScope(prev => ({ ...prev, name: newName }));
          toast.success('Espaço renomeado.');
        } else { toast.error('Erro: ' + error.message); }
      }
    });
  };

  const handleDeleteFolder = (folderId: string) => {
    setConfirmModal({
      message: 'Excluir esta pasta e todas as suas tarefas?',
      onConfirm: async () => {
        const { error } = await supabase.from('folders').delete().eq('id', folderId).select();
        if (!error) {
          setFolders(prev => prev.filter(f => f.id !== folderId));
          if (activeScope.type === 'folder' && activeScope.id === folderId) handleNavigate('global', null, 'Dashboard');
          toast.success('Pasta excluída.');
        } else { toast.error('Erro ao excluir pasta: ' + error.message); }
      }
    });
  };

  const handleBulkDeleteFolders = (folderIds: string[], onDone: () => void) => {
    setConfirmModal({
      message: `Excluir ${folderIds.length} pasta(s) e todos os seus projetos permanentemente?`,
      onConfirm: async () => {
        let errorCount = 0;
        for (const folderId of folderIds) {
          const { error } = await supabase.from('folders').delete().eq('id', folderId).select();
          if (error) { errorCount++; toast.error('Erro ao excluir pasta: ' + error.message); }
          else {
            setFolders(prev => prev.filter(f => f.id !== folderId));
            if (activeScope.type === 'folder' && activeScope.id === folderId) handleNavigate('global', null, 'Dashboard');
          }
        }
        if (errorCount === 0) toast.success(`${folderIds.length} pasta(s) excluída(s).`);
        onDone();
      }
    });
  };

  const handleRenameFolder = (folderId: string, currentName: string) => {
    setRenameModal({
      title: 'Renomear Pasta', defaultValue: currentName,
      onSubmit: async (newName) => {
        const { error } = await supabase.from('folders').update({ name: newName }).eq('id', folderId);
        if (!error) {
          setFolders(prev => prev.map(f => f.id === folderId ? { ...f, name: newName } : f));
          if (activeScope.type === 'folder' && activeScope.id === folderId) setActiveScope(prev => ({ ...prev, name: newName }));
          toast.success('Pasta renomeada.');
        } else { toast.error('Erro: ' + error.message); }
      }
    });
  };

  const handleDeleteList = (listId: string) => {
    setConfirmModal({
      message: 'Excluir esta lista e todas as suas tarefas permanentemente?',
      onConfirm: async () => {
        const { error } = await supabase.from('lists').delete().eq('id', listId).select();
        if (!error) {
          setLists(prev => prev.filter(l => l.id !== listId));
          setTasks(prev => prev.filter(t => t.listId !== listId));
          if (activeListId === listId) setActiveListId(null);
          toast.success('Lista excluída.');
        } else { toast.error('Erro ao excluir lista: ' + error.message); }
      }
    });
  };

  const handleRenameList = (listId: string, currentName: string) => {
    setRenameModal({
      title: 'Renomear Lista', defaultValue: currentName,
      onSubmit: async (newName) => {
        const { error } = await supabase.from('lists').update({ name: newName }).eq('id', listId);
        if (!error) {
          setLists(prev => prev.map(l => l.id === listId ? { ...l, name: newName } : l));
          toast.success('Lista renomeada.');
        } else { toast.error('Erro: ' + error.message); }
      }
    });
  };

  const handleDuplicateList = (listId: string, currentName: string) => {
    setRenameModal({
      title: 'Duplicar Projeto (Lista)', defaultValue: `${currentName} (cópia)`,
      onSubmit: async (newName) => {
        const sourceList = lists.find(l => l.id === listId);
        if (!sourceList) { toast.error('Lista de origem não encontrada.'); return; }

        const toastId = toast.loading('Duplicando projeto...');
        try {
          // 1. Cria a nova lista na mesma pasta, com o mesmo grupo de status
          const newListId = newUuid();
          const newListName = newName.trim();
          const { error: listError } = await supabase
            .from('lists')
            .insert({ id: newListId, name: newListName, folder_id: sourceList.folderId, status_group_id: sourceList.statusGroupId });
          if (listError) throw listError;

          // 2. Busca todas as tarefas da lista direto do banco (estado local pode estar filtrado)
          const { data: sourceTasks, error: tasksError } = await supabase
            .from('tasks').select('*').eq('list_id', listId);
          if (tasksError) throw tasksError;

          const idMap = new Map<string, string>();
          const allTasks = sourceTasks || [];
          const parents = allTasks.filter((t: any) => !t.parent_id);
          const children = allTasks.filter((t: any) => t.parent_id);

          const cloneRow = (t: any, parentId: string | null) => ({
            title: t.title,
            description: t.description || '',
            status: t.status,
            priority: t.priority,
            main_assignee_id: t.main_assignee_id,
            secondary_assignee_ids: t.secondary_assignee_ids || [],
            start_date: t.start_date,
            due_date: t.due_date,
            list_id: newListId,
            project_id: t.project_id || null,
            parent_id: parentId,
            extension_count: 0,
            tags: t.tags || [],
            // Quem duplica a lista é o criador das tarefas novas (antes ficava nulo).
            created_by: currentUser.id,
          });

          // 3. Insere tarefas principais em lote com IDs do cliente, sem RETURNING sob RLS.
          if (parents.length > 0) {
            const parentRows = parents.map((t: any) => {
              const id = newUuid();
              idMap.set(t.id, id);
              return { id, ...cloneRow(t, null) };
            });
            const { error: parentsError } = await supabase.from('tasks').insert(parentRows);
            if (parentsError) throw parentsError;
          }

          // 4. Insere subtarefas apontando para os novos pais
          const validChildren = children.filter((t: any) => idMap.has(t.parent_id));
          if (validChildren.length > 0) {
            const childRows = validChildren.map((t: any) => {
              const id = newUuid();
              idMap.set(t.id, id);
              return { id, ...cloneRow(t, idMap.get(t.parent_id)!) };
            });
            const { error: childrenError } = await supabase.from('tasks').insert(childRows);
            if (childrenError) throw childrenError;
          }

          const oldTaskIds = Array.from(idMap.keys());
          if (oldTaskIds.length > 0) {
            // 5. Copia checklists
            const { data: checklists } = await supabase
              .from('task_checklists').select('task_id, text, completed').in('task_id', oldTaskIds);
            if (checklists && checklists.length > 0) {
              await supabase.from('task_checklists').insert(
                checklists.map((c: any) => ({ task_id: idMap.get(c.task_id)!, text: c.text, completed: c.completed }))
              );
            }

            // 6. Copia valores de campos personalizados
            const { data: customValues } = await supabase
              .from('custom_field_values').select('field_id, entity_id, value').in('entity_id', oldTaskIds);
            if (customValues && customValues.length > 0) {
              await supabase.from('custom_field_values').insert(
                customValues.map((v: any) => ({ field_id: v.field_id, entity_id: idMap.get(v.entity_id)!, value: v.value }))
              );
            }
          }

          const newList: List = {
            id: newListId,
            name: newListName,
            folderId: sourceList.folderId,
            statusGroupId: sourceList.statusGroupId
          };
          setLists(prev => [...prev, newList]);
          setActiveListId(newList.id);
          toast.success(`Projeto duplicado: ${idMap.size} tarefa(s) copiada(s).`, { id: toastId });
        } catch (err: any) {
          console.error('Erro ao duplicar projeto:', err);
          toast.error(`Erro ao duplicar projeto: ${err?.message || 'tente novamente'}`, { id: toastId });
        }
      }
    });
  };

  const handleMoveList = async (listId: string, targetFolderId: string) => {
    const list = lists.find(l => l.id === listId);
    if (!list || list.folderId === targetFolderId) return;
    const { error } = await supabase.from('lists').update({ folder_id: targetFolderId }).eq('id', listId);
    if (!error) {
      setLists(prev => prev.map(l => l.id === listId ? { ...l, folderId: targetFolderId } : l));
      toast.success('Lista movida.');
    } else { toast.error('Erro ao mover lista: ' + error.message); }
  };

  const handleMoveFolder = async (folderId: string, targetSpaceId: string) => {
    const folder = folders.find(f => f.id === folderId);
    if (!folder || folder.spaceId === targetSpaceId) return;
    const { error } = await supabase.from('folders').update({ space_id: targetSpaceId }).eq('id', folderId);
    if (!error) {
      setFolders(prev => prev.map(f => f.id === folderId ? { ...f, spaceId: targetSpaceId } : f));
      toast.success('Pasta movida.');
    } else { toast.error('Erro ao mover pasta: ' + error.message); }
  };

  const handleCreateDoc = (folderId: string, parentId: string | null = null) => {
    setRenameModal({
      title: parentId ? 'Nova Subpágina' : 'Novo Documento', defaultValue: '', placeholder: 'Título do documento…',
      onSubmit: async (title) => {
        if (!title.trim()) return;
        const { data, error } = await supabase
          .from('docs')
          .insert({ title: title.trim(), content: 'Comece a escrever aqui...', folder_id: folderId, created_by: currentUser.id, parent_id: parentId })
          .select().single();
        if (data && !error) {
          const newDoc: Doc = { id: data.id, title: data.title, content: data.content || '', headerImage: data.header_image, folderId: data.folder_id, createdBy: data.created_by, attachments: [], parentId: data.parent_id, isWiki: data.is_wiki || false };
          setDocs(prev => [...prev, newDoc]);
          setActiveDocId(newDoc.id);
          setActiveView('Doc');
          if (!parentId) setActiveScope({ type: 'folder', id: folderId, name: title.trim() });
        } else { toast.error('Erro ao criar documento: ' + error?.message); }
      }
    });
  };

  // Cria uma pasta "Wiki Interna" no espaço escolhido, com um Doc raiz (marcado
  // como wiki) e 10 subpáginas pré-preenchidas — um atalho pra montar a
  // estrutura de base de conhecimento inteira de uma vez.
  const handleCreateWiki = async (spaceId: string) => {
    try {
      const { data: folderData, error: folderError } = await supabase
        .from('folders')
        .insert({ name: 'Wiki Interna', space_id: spaceId })
        .select().single();
      if (folderError || !folderData) throw folderError || new Error('Falha ao criar pasta da wiki.');

      const newFolder: Folder = { id: folderData.id, name: folderData.name, spaceId: folderData.space_id };
      setFolders(prev => [...prev, newFolder]);

      const { data: rootData, error: rootError } = await supabase
        .from('docs')
        .insert({
          title: 'Wiki Interna',
          content: WIKI_INTRO_HTML,
          folder_id: newFolder.id,
          created_by: currentUser.id,
          is_wiki: true
        })
        .select().single();
      if (rootError || !rootData) throw rootError || new Error('Falha ao criar o documento raiz da wiki.');

      const rootDoc: Doc = { id: rootData.id, title: rootData.title, content: rootData.content || '', headerImage: rootData.header_image, folderId: rootData.folder_id, createdBy: rootData.created_by, attachments: [], parentId: null, isWiki: true };

      const sectionsToInsert = WIKI_TEMPLATE_SECTIONS.map(s => ({
        title: s.title,
        content: s.html,
        folder_id: newFolder.id,
        created_by: currentUser.id,
        parent_id: rootDoc.id
      }));
      const { data: sectionsData, error: sectionsError } = await supabase
        .from('docs')
        .insert(sectionsToInsert)
        .select();
      if (sectionsError) throw sectionsError;

      const sectionDocs: Doc[] = (sectionsData || []).map((d: any) => ({
        id: d.id, title: d.title, content: d.content || '', headerImage: d.header_image, folderId: d.folder_id, createdBy: d.created_by, attachments: [], parentId: d.parent_id, isWiki: false
      }));

      setDocs(prev => [...prev, rootDoc, ...sectionDocs]);
      setActiveScope({ type: 'folder', id: newFolder.id, name: newFolder.name });
      setActiveDocId(rootDoc.id);
      setActiveView('Doc');
      toast.success('Wiki Interna criada com 10 páginas de base.');
    } catch (err: any) {
      console.error('Erro ao criar wiki:', err);
      toast.error(`Falha ao criar a wiki${err?.message ? `: ${err.message}` : '.'}`);
    }
  };

  const handleDeleteDoc = async (docId: string) => {
    setConfirmModal({
      message: 'Excluir este documento permanentemente?',
      onConfirm: async () => {
        const { error } = await supabase.from('docs').delete().eq('id', docId);
        if (!error) {
          setDocs(prev => prev.filter(d => d.id !== docId));
          if (activeDocId === docId) { setActiveDocId(null); setActiveView('Dashboard'); }
          toast.success('Documento excluído.');
        } else { toast.error('Erro ao excluir documento: ' + error.message); }
      }
    });
  };

  // --- Admin Persistence Handlers ---
  const handleUpdateDoc = async (updatedDoc: Doc) => {
    const { error } = await supabase
      .from('docs')
      .update({
        title: updatedDoc.title,
        content: updatedDoc.content,
        header_image: updatedDoc.headerImage,
        is_wiki: updatedDoc.isWiki || false
        // updated_at: um trigger no banco (docs_updated_at) já garante isso
        // em toda UPDATE, com o relógio do servidor — não do client.
      })
      .eq('id', updatedDoc.id);

    if (!error) {
      setDocs(prev => prev.map(d => d.id === updatedDoc.id ? updatedDoc : d));
    } else {
      console.error('Erro ao atualizar documento:', error);
    }
  };

  const handleStatusChange = useCallback(async (taskId: string, newStatus: string): Promise<boolean> => {
    if (isDoneLikeStatus(newStatus)) {
      const blockReason = await getTaskCloseBlockReason(taskId);
      if (blockReason) {
        toast.warning(blockReason);
        return false;
      }
    }

    const { error } = await supabase
      .from('tasks')
      .update({ status: newStatus })
      .eq('id', taskId);

    if (!error) {
      setTasks(prev => prev.map(t => {
        if (t.id === taskId) {
          const updatedTask = { ...t, status: newStatus };

          // SESSION_04 — AutomationEngine.evaluate() com context + callbacks
          const prevTask = t;
          const listId = t.listId;
          if (listId) {
            supabase
              .from('automations')
              .select('*')
              .eq('list_id', listId)
              .eq('enabled', true)
              .then(({ data: automationData }) => {
                if (!automationData?.length) return;
                const engine = new AutomationEngine(automationData as any[]);
                const ctx: AutomationContext = {
                  previousTask: prevTask,
                  triggerType: 'status_changed',
                  workspaceId: workspace.id,
                  currentUserId: currentUser.id,
                };
                const cbs: AutomationCallbacks = {
                  onChangeStatus:    (tid, s) => { supabase.from('tasks').update({ status: s }).eq('id', tid); },
                  onChangePriority:  (tid, p) => { supabase.from('tasks').update({ priority: p }).eq('id', tid); },
                  onAddAssignee:     (tid, uid) => { supabase.from('tasks').update({ main_assignee_id: uid }).eq('id', tid); },
                  onRemoveAssignee:  (tid) => { supabase.from('tasks').update({ main_assignee_id: null }).eq('id', tid); },
                  onPostComment:     (tid, text) => {
                    supabase.from('comments').insert({ task_id: tid, user_id: currentUser.id, text });
                  },
                  onAddTag: (tid, tag) => {
                    const task = tasks.find(tk => tk.id === tid);
                    if (!task) return;
                    const newTags = Array.from(new Set([...(task.tags ?? []), tag]));
                    supabase.from('tasks').update({ tags: newTags }).eq('id', tid);
                  },
                  onRemoveTag: (tid, tag) => {
                    const task = tasks.find(tk => tk.id === tid);
                    if (!task) return;
                    supabase.from('tasks').update({ tags: (task.tags ?? []).filter(tg => tg !== tag) }).eq('id', tid);
                  },
                  onSendNotification: (message, userId) => {
                    toast.info(message);
                    // Grava no sino: do destinatário configurado ou do responsável da tarefa
                    const targetId = userId || prevTask.mainAssigneeId;
                    if (targetId) {
                      supabase.from('notifications').insert({
                        user_id: targetId,
                        actor_id: currentUser.id,
                        type: 'automation',
                        title: `Automação: ${message}`,
                        body: `Tarefa "${prevTask.title}"`,
                        task_id: prevTask.id,
                      }).then(({ error }) => { if (error) console.error('Erro ao notificar automação:', error); });
                    }
                  },
                  onCreateTask: (taskData) => {
                    supabase.from('tasks').insert({
                      title: taskData.title ?? 'Nova tarefa',
                      list_id: taskData.listId ?? listId,
                      status: 'A fazer',
                      created_by: currentUser.id,
                    });
                  },
                  onCreateSubtask: (parentId, taskData) => {
                    supabase.from('tasks').insert({
                      title: taskData.title ?? 'Nova subtarefa',
                      parent_id: parentId,
                      list_id: listId,
                      status: 'A fazer',
                      created_by: currentUser.id,
                    });
                  },
                };
                engine.evaluate(updatedTask, ctx, cbs).catch(err =>
                  console.error('[AutomationEngine] status_changed:', err)
                );
              });
          }

          return updatedTask;
        }
        return t;
      }));
      return true;
    } else {
      console.error('Erro ao atualizar status:', error);
      toast.error('Erro ao atualizar status. A tarefa voltou ao estado anterior.');
      return false;
    }
  }, [currentUser, tasks, workspace.id]);

  const handleQuickUpdateTask = useCallback(async (taskId: string, updates: Partial<Task>): Promise<boolean> => {
    const previous = tasks.find(t => t.id === taskId);
    if (!previous) return false;

    if (updates.status && updates.status !== previous.status && isDoneLikeStatus(updates.status)) {
      const blockReason = await getTaskCloseBlockReason(taskId);
      if (blockReason) {
        toast.warning(blockReason);
        return false;
      }
    }

    const payload: Record<string, any> = {};
    if (updates.title !== undefined) payload.title = updates.title;
    if (updates.status !== undefined) payload.status = updates.status;
    if (updates.priority !== undefined) payload.priority = updates.priority;
    if (updates.mainAssigneeId !== undefined) payload.main_assignee_id = updates.mainAssigneeId;
    if (updates.dueDate !== undefined) payload.due_date = updates.dueDate || null;
    if (updates.tags !== undefined) payload.tags = updates.tags;

    if (Object.keys(payload).length === 0) return true;

    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
    const { error } = await supabase.from('tasks').update(payload).eq('id', taskId);

    if (error) {
      setTasks(prev => prev.map(t => t.id === taskId ? previous : t));
      console.error('Erro ao atualizar tarefa pelo Kanban:', error);
      toast.error('Erro ao salvar alteração. A tarefa voltou ao estado anterior.');
      return false;
    }

    // Achado na auditoria da Caixa de Entrada: só os botões de responsável do
    // modal de detalhe notificavam — trocar por aqui (quick-edit do Kanban)
    // não avisava ninguém. Notifica só quando o responsável de fato muda.
    if (updates.mainAssigneeId !== undefined && updates.mainAssigneeId && updates.mainAssigneeId !== previous.mainAssigneeId) {
      notifyAssignment({ userIds: [updates.mainAssigneeId], actor: currentUser, taskId, taskTitle: updates.title ?? previous.title });
    }

    toast.success('Tarefa atualizada.');
    return true;
  }, [tasks, currentUser]);

  const handleUpdateFieldValue = useCallback(async (fieldId: string, entityId: string, value: any) => {
    const { error } = await supabase
      .from('custom_field_values')
      .upsert({
        field_id: fieldId,
        entity_id: entityId,
        value
      }, { onConflict: 'field_id,entity_id' });

    if (!error) {
      setFieldValues(prev => {
        const existingIndex = prev.findIndex(v => v.fieldId === fieldId && v.entityId === entityId);
        if (existingIndex > -1) {
          const next = [...prev];
          next[existingIndex] = { ...next[existingIndex], value };
          return next;
        }
        return [...prev, { fieldId, entityId, value }];
      });
    } else {
      console.error('Erro ao salvar valor do campo:', error);
    }
  }, []);

  const handleCreateField = useCallback(async (newField: CustomField) => {
    const { data, error } = await supabase
      .from('custom_fields')
      .insert({
        name: newField.name,
        type: newField.type,
        is_mandatory: newField.isMandatory,
        default_value: newField.defaultValue,
        config: newField.config,
        target: newField.target,
        visible_to: newField.visibleTo,
        created_by: currentUser.id
      })
      .select()
      .single();

    if (data && !error) {
      const field: CustomField = {
        id: data.id,
        name: data.name,
        type: data.type as CustomFieldType,
        isMandatory: data.is_mandatory,
        defaultValue: data.default_value,
        config: data.config,
        target: data.target,
        visibleTo: data.visible_to,
        createdBy: data.created_by,
        createdAt: data.created_at
      };
      setCustomFields(prev => [...prev, field]);
    } else {
      console.error('Erro ao criar campo personalizado:', error);
    }
  }, [currentUser.id]);

  const handleReorderField = useCallback((index: number, direction: 'up' | 'down') => {
    // Para simplificar o protótipo, mantemos a reordenação local por enquanto.
    // Em um sistema real, haveria um campo 'order' no banco.
    setCustomFields(prev => {
      const newIndex = direction === 'up' ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= prev.length) return prev;
      const next = [...prev];
      const temp = next[index];
      next[index] = next[newIndex];
      next[newIndex] = temp;
      return next;
    });
  }, []);

  const handleUpdateField = useCallback(async (updatedField: CustomField) => {
    const { error } = await supabase
      .from('custom_fields')
      .update({
        name: updatedField.name,
        type: updatedField.type,
        is_mandatory: updatedField.isMandatory,
        default_value: updatedField.defaultValue,
        config: updatedField.config,
        target: updatedField.target,
        visible_to: updatedField.visibleTo
      })
      .eq('id', updatedField.id);

    if (!error) {
      setCustomFields(prev => prev.map(f => f.id === updatedField.id ? updatedField : f));
    } else {
      console.error('Erro ao atualizar campo personalizado:', error);
    }
  }, []);

  const handleDeleteField = useCallback(async (fieldId: string) => {
    if (window.confirm('Tem certeza que deseja excluir este campo personalizado permanentemente? Isso removerá todos os valores preenchidos em todas as tarefas.')) {
      const { error } = await supabase.from('custom_fields').delete().eq('id', fieldId);
      if (!error) {
        setCustomFields(prev => prev.filter(f => f.id !== fieldId));
        setFieldValues(prev => prev.filter(v => v.fieldId !== fieldId));
      } else {
        console.error('Erro ao excluir campo personalizado:', error);
      }
    }
  }, []);

  const handleToggleTaskFieldForList = useCallback((listId: string, fieldId: string) => {
    setHiddenTaskFieldIdsByList((prev) => {
      const current = prev[listId] ?? [];
      if (current.includes(fieldId)) {
        // Campo está oculto → remover da lista (habilitar novamente)
        return { ...prev, [listId]: current.filter(id => id !== fieldId) };
      }
      // Campo está visível → adicionar à lista (ocultar)
      return { ...prev, [listId]: [...current, fieldId] };
    });
  }, []);

  // Creation Handlers
  // Gera um UUID no cliente (com fallback caso crypto.randomUUID não exista).
  // Necessário porque, com a RLS (Fase 2a/2b), um space/folder/list recém-criado
  // por um NÃO-ADMIN ainda não é acessível a ele no MESMO statement (can_access_*
  // é STABLE e não enxerga a linha nova), então `.insert().select()` (RETURNING)
  // falha com 42501. Inserindo com id do cliente e SEM `.select()`, evitamos o
  // RETURNING; a linha fica acessível nas leituras seguintes.
  const newUuid = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  };

  const handleCreateSpace = async (name: string, color: string, icon: string = 'Layout') => {
    try {
      const newId = newUuid();
      const { error } = await supabase
        .from('spaces')
        .insert({ id: newId, name, workspace_id: workspace.id, color, icon });
      if (error) throw error;

      const newSpace: Space = {
        id: newId, name, workspaceId: workspace.id, color, icon, createdAt: new Date().toISOString(),
      };
      setSpaces([...spaces, newSpace]);
      if (currentUser.role !== UserRole.ADMIN) {
        // O trigger grant_space_creator_access já gravou o acesso no banco;
        // aqui só refletimos no estado do cliente.
        setUserAccess((prev) => {
          const cur = prev[currentUser.id] || { spaceIds: [], folderIds: [] };
          return { ...prev, [currentUser.id]: { ...cur, spaceIds: [...cur.spaceIds, newId] } };
        });
      }
      toast.success('Espaço criado com sucesso!');
      setIsSpaceModalOpen(false);
    } catch (err: any) {
      console.error('Erro ao criar espaço:', err);
      toast.error('Erro ao criar espaço: ' + (err?.message || 'tente novamente'));
    }
  };

  const handleCreateFolder = async (name: string) => {
    if (!targetSpaceId) return;
    try {
      // ids no cliente + sem `.select()` (ver newUuid): o RETURNING falharia para
      // não-admin. A pasta/lista ficam acessíveis via o espaço nas leituras seguintes.
      const folderId = newUuid();
      const { error: folderError } = await supabase
        .from('folders')
        .insert({ id: folderId, name, space_id: targetSpaceId });
      if (folderError) throw folderError;
      const newFolder: Folder = { id: folderId, name, spaceId: targetSpaceId };

      // Lista padrão 'Geral' com o primeiro grupo de status (Padrão)
      const defaultStatusGroupId = statusGroups.find(g => g.name === 'Padrão')?.id || statusGroups[0]?.id;
      const listId = newUuid();
      const { error: listError } = await supabase
        .from('lists')
        .insert({ id: listId, name: 'Geral', folder_id: folderId, status_group_id: defaultStatusGroupId });

      setFolders([...folders, newFolder]);
      if (!listError) {
        setLists([...lists, { id: listId, name: 'Geral', folderId, statusGroupId: defaultStatusGroupId }]);
      } else {
        console.error('Pasta criada, mas a lista padrão falhou:', listError);
      }

      if (currentUser.role !== UserRole.ADMIN) {
        // Pasta acessível via o espaço; só reflete no estado do cliente.
        setUserAccess((prev) => {
          const cur = prev[currentUser.id] || { spaceIds: [], folderIds: [] };
          const spaceIds = cur.spaceIds.includes(targetSpaceId) ? cur.spaceIds : [...cur.spaceIds, targetSpaceId];
          return { ...prev, [currentUser.id]: { spaceIds, folderIds: [...cur.folderIds, folderId] } };
        });
      }

      toast.success('Pasta criada com sucesso!');
      setIsFolderModalOpen(false);
      setTargetSpaceId(null);
    } catch (err: any) {
      console.error('Erro ao criar pasta:', err);
      toast.error('Erro ao criar pasta: ' + (err?.message || 'tente novamente'));
    }
  };

  const handleCreateList = useCallback(
    (folderId: string) => {
      setCreateListFolderId(folderId);
      setIsCreateListModalOpen(true);
    },
    [],
  );

  const handleConfirmCreateList = async (folderId: string, name: string, statusGroupId: string): Promise<void> => {
    const folder = folders.find((f) => f.id === folderId);

    // id no cliente + sem `.select()` (ver newUuid): o RETURNING falharia p/ não-admin.
    const listId = newUuid();
    const { error } = await supabase
      .from('lists')
      .insert({ id: listId, name: name.trim(), folder_id: folderId, status_group_id: statusGroupId });

    if (error) {
      console.error('Erro ao criar lista:', error);
      toast.error('Erro ao criar lista: ' + (error.message || 'tente novamente'));
      return;
    }

    const newList: List = {
      id: listId,
      name: name.trim(),
      folderId,
      statusGroupId,
    };

    setLists((prev) => [...prev, newList]);
    setActiveListId(newList.id);
    if (folder) {
      setActiveScope({ type: 'folder', id: folder.id, name: folder.name });
      setActiveView('List');
    }
    toast.success('Lista criada com sucesso!');
    setIsCreateListModalOpen(false);
    setCreateListFolderId(null);
  };

  const handleCreateTask = async (newTaskPartial: Partial<Task>) => {
    try {
      // Status inicial a partir do grupo de status da lista (regra de domínio).
      const defaultStatus = resolveDefaultStatus(newTaskPartial.listId, lists, statusGroups);

      if (!newTaskPartial.listId) {
        toast.error('Selecione uma lista antes de criar a tarefa.');
        return;
      }

      // `toISOString()` converte para UTC: à noite no Brasil (UTC-3) já é o dia
      // seguinte em UTC, o que fazia tarefas criadas de noite nascerem com data
      // de início/prazo erradas. Usamos data local.
      const mainAssigneeId = newTaskPartial.mainAssigneeId || currentUser.id;
      const res = await taskRepo.insertTask({
        title: newTaskPartial.title || 'Nova Tarefa',
        description: newTaskPartial.description || '',
        status: newTaskPartial.status || defaultStatus,
        priority: newTaskPartial.priority || TaskPriority.MEDIA,
        mainAssigneeId,
        secondaryAssigneeIds: [],
        startDate: formatLocalDate(new Date()),
        // Sem prazo inventado (achado de QA): antes toda tarefa nova sem
        // dueDate explícito ganhava +7 dias escondido, fazendo o usuário
        // achar que tinha definido um prazo quando não tinha — e virando
        // "atrasada" fantasma no dashboard de saúde depois.
        dueDate: newTaskPartial.dueDate || '',
        listId: newTaskPartial.listId,
        projectId: newTaskPartial.projectId || null,
        parentId: newTaskPartial.parentId || null,
        createdBy: currentUser.id,
      });

      if ('task' in res) {
        setTasks(prev => [res.task, ...prev]);
        if (belongsToMyTasks(res.task)) {
          setMyTasks(prev => [res.task, ...prev.filter(t => t.id !== res.task.id)]);
        }
        // Achado na auditoria da Caixa de Entrada: só as trocas de responsável
        // em tarefa já existente notificavam (handleSetMainAssignee etc.) —
        // criar já atribuída a outra pessoa não avisava ninguém.
        // notifyAssignment já filtra auto-notificação (criador = responsável).
        notifyAssignment({ userIds: [mainAssigneeId], actor: currentUser, taskId: res.task.id, taskTitle: res.task.title });
        setIsTaskModalOpen(false);
        setPrefilledTaskData(null);
        toast.success('Tarefa criada com sucesso!');
      } else {
        console.error('Erro ao criar tarefa:', res.error);
        toast.error('Erro ao criar tarefa: ' + res.error);
      }
    } catch (err) {
      console.error('Erro inesperado ao criar tarefa:', err);
      toast.error('Erro inesperado ao criar tarefa. Tente novamente.');
    }
  };

  // Converte um item de ação de reunião (ver MeetingsView) numa tarefa de
  // verdade — precisa de uma lista escolhida na hora, já que o resto do app
  // (handleCreateTask) trata list_id como obrigatório mesmo a coluna sendo
  // nullable no banco.
  // Base compartilhada por "criar tarefa a partir de X" (item de ação de
  // reunião, lembrete) — só muda qual tabela recebe o vínculo task_id depois.
  const createTaskFromTitle = useCallback(async (title: string, listId: string): Promise<Task | null> => {
    const defaultStatus = resolveDefaultStatus(listId, lists, statusGroups);

    const res = await taskRepo.insertTask({
      title,
      status: defaultStatus,
      priority: TaskPriority.MEDIA,
      mainAssigneeId: currentUser.id,
      secondaryAssigneeIds: [],
      startDate: formatLocalDate(new Date()),
      dueDate: '', // mesmo raciocínio de handleCreateTask acima: sem prazo inventado
      listId,
      createdBy: currentUser.id,
    });

    if ('error' in res) {
      toast.error('Erro ao criar tarefa: ' + res.error);
      return null;
    }
    setTasks(prev => [res.task, ...prev]);
    return res.task;
  }, [lists, statusGroups, currentUser]);

  const createTaskFromMeetingActionItem = useCallback(async (item: { id: string; text: string }, listId: string): Promise<string | null> => {
    const newTask = await createTaskFromTitle(item.text, listId);
    if (!newTask) return null;
    const { error: linkError } = await supabase.from('meeting_action_items').update({ task_id: newTask.id }).eq('id', item.id);
    if (linkError) console.error('Erro ao vincular tarefa ao item de ação:', linkError);
    toast.success('Tarefa criada a partir do item de ação.');
    return newTask.id;
  }, [createTaskFromTitle]);

  const createTaskFromReminder = useCallback(async (reminder: { id: string; title: string }, listId: string): Promise<string | null> => {
    const newTask = await createTaskFromTitle(reminder.title, listId);
    if (!newTask) return null;
    const { error: linkError } = await supabase.from('reminders').update({ task_id: newTask.id }).eq('id', reminder.id);
    if (linkError) console.error('Erro ao vincular tarefa ao lembrete:', linkError);
    toast.success('Tarefa criada a partir do lembrete.');
    return newTask.id;
  }, [createTaskFromTitle]);

  // Caixa de Entrada: transforma o texto de um comentário/menção notificado
  // numa tarefa nova. Sem coluna de vínculo (diferente de lembrete/item de
  // ação de reunião) — a notificação já aponta pra tarefa original via
  // taskId; esta é sempre uma tarefa NOVA e separada, então não há "a"
  // notificação pra atualizar de volta.
  const createTaskFromComment = useCallback(async (comment: { text: string }, listId: string): Promise<string | null> => {
    const newTask = await createTaskFromTitle(comment.text, listId);
    if (!newTask) return null;
    toast.success('Tarefa criada a partir do comentário.');
    return newTask.id;
  }, [createTaskFromTitle]);

  // Garante que exista uma lista pessoal (fora de qualquer pasta, ver
  // migration 18) pro usuário atual, criando na primeira vez que ele abre
  // "Lista pessoal". Privacidade só no client — a lista não aparece em
  // nenhuma árvore de Espaço/Pasta, só é alcançada por este caminho.
  const ensurePersonalList = useCallback(async (): Promise<string | null> => {
    const existing = lists.find(l => l.ownerId === currentUser.id);
    if (existing) return existing.id;

    const defaultGroupId = statusGroups.find(g => g.name === 'Padrão')?.id || statusGroups[0]?.id;
    if (!defaultGroupId) {
      toast.error('Nenhum grupo de status configurado no workspace.');
      return null;
    }

    const { data, error } = await supabase
      .from('lists')
      .insert({ name: 'Lista pessoal', folder_id: null, status_group_id: defaultGroupId, owner_id: currentUser.id })
      .select()
      .single();

    if (error || !data) {
      toast.error('Erro ao criar lista pessoal: ' + (error?.message || 'tente novamente'));
      return null;
    }

    const newList: List = { id: data.id, name: data.name, folderId: data.folder_id, statusGroupId: data.status_group_id, ownerId: data.owner_id || undefined };
    setLists(prev => [...prev, newList]);
    return newList.id;
  }, [lists, statusGroups, currentUser]);

  const handleDuplicateTask = async (sourceTask: Task, options: DuplicateTaskOptions) => {
    if (!sourceTask || isDuplicatingTask) return;
    if (!options.title.trim()) {
      toast.error('Informe um nome para a nova tarefa.');
      return;
    }
    if (!options.listId) {
      toast.error('Selecione uma lista de destino.');
      return;
    }

    setIsDuplicatingTask(true);
    try {
      const res = await duplicateTask(sourceTask, options, {
        currentUserId: currentUser.id,
        subtasks: tasks.filter(t => t.parentId === sourceTask.id),
        fieldValuesByEntity: (id) => fieldValues.filter(v => v.entityId === id),
      });
      if ('error' in res) throw new Error(res.error);

      setTasks(prev => [...res.tasks, ...prev]);
      if (res.fieldValues.length > 0) {
        setFieldValues(prev => [...prev, ...res.fieldValues]);
      }
      setTaskToDuplicate(null);
      setSelectedTaskId(res.tasks[0].id);
      toast.success(`Tarefa "${res.tasks[0].title}" duplicada com sucesso.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Erro ao duplicar tarefa:', err);
      toast.error('Erro ao duplicar tarefa: ' + message);
    } finally {
      setIsDuplicatingTask(false);
    }
  };

  // Issue #184 fase 3: abre o modal de recorrência buscando a regra atual da
  // tarefa (null se ainda não tem uma configurada — o modal nasce em modo
  // "criar" nesse caso).
  const openTaskRecurrenceModal = async (task: Task) => {
    setRecurrenceConfigTask(task);
    setIsLoadingRecurrenceRule(true);
    try {
      const rule = await taskRepo.fetchRecurrenceRuleForTask(task.id);
      setRecurrenceConfigRule(rule);
      setTaskRecurrenceRuleCache((prev) => ({ ...prev, [task.id]: rule }));
    } finally {
      setIsLoadingRecurrenceRule(false);
    }
  };

  const handleSaveRecurrenceRule = async (input: Omit<taskRepo.RecurrenceRuleInput, 'taskId' | 'listId' | 'createdBy'>) => {
    if (!recurrenceConfigTask || isSavingRecurrenceRule) return;
    setIsSavingRecurrenceRule(true);
    try {
      const res = await taskRepo.upsertRecurrenceRule(
        {
          ...input,
          taskId: recurrenceConfigTask.id,
          listId: recurrenceConfigTask.listId as string,
          createdBy: currentUser.id,
        },
        recurrenceConfigRule?.id ?? null,
      );
      if ('error' in res) throw new Error(res.error);
      setTaskRecurrenceRuleCache((prev) => ({ ...prev, [recurrenceConfigTask.id]: res.rule }));
      setRecurrenceConfigTask(null);
      setRecurrenceConfigRule(null);
      toast.success('Recorrência configurada com sucesso.');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error('Erro ao salvar recorrência: ' + message);
    } finally {
      setIsSavingRecurrenceRule(false);
    }
  };

  const handleToggleRecurrenceEnabled = async (rule: TaskRecurrenceRule, enabled: boolean) => {
    const { error } = await taskRepo.setRecurrenceRuleEnabled(rule.id, enabled);
    if (error) {
      toast.error('Erro ao ' + (enabled ? 'retomar' : 'pausar') + ' recorrência: ' + error);
      return;
    }
    const updated = { ...rule, enabled };
    setTaskRecurrenceRuleCache((prev) => ({ ...prev, [rule.taskId]: updated }));
    if (recurrenceConfigRule?.id === rule.id) setRecurrenceConfigRule(updated);
    toast.success(enabled ? 'Recorrência retomada.' : 'Recorrência pausada.');
  };

  const handleDeleteRecurrenceRule = async (rule: TaskRecurrenceRule) => {
    if (!window.confirm('Excluir a configuração de recorrência desta tarefa? As ocorrências já criadas não são apagadas.')) return;
    const { error } = await taskRepo.deleteRecurrenceRule(rule.id);
    if (error) {
      toast.error('Erro ao excluir recorrência: ' + error);
      return;
    }
    setTaskRecurrenceRuleCache((prev) => ({ ...prev, [rule.taskId]: null }));
    setRecurrenceConfigTask(null);
    setRecurrenceConfigRule(null);
    toast.success('Recorrência removida.');
  };

  const openFolderModal = (spaceId: string) => {
    setTargetSpaceId(spaceId);
    setIsFolderModalOpen(true);
  };

  // Navigation Handlers
  const handleNavigate = (type: ScopeType, id: string | null, name: string) => {
    setActiveScope({ type, id, name });

    // Ao trocar o escopo manualmente (global/space/folder), resetamos a lista ativa.
    // A seleção de lista na sidebar seta activeListId explicitamente.
    setActiveListId(null);

    // Navegação de escopo: espaço → Space Overview (Dashboard); pasta → List; global → Dashboard
    if (type === 'space' && activeView === 'Dashboard') {
      // Mantém Dashboard → SpaceOverview renderiza o overview do espaço
    } else if (type === 'folder' && activeView === 'Dashboard') {
      setActiveView('List');
    } else if (type === 'global') {
      setActiveView('Dashboard');
    }
  };

  // Saída: reflete view/lista/escopo atuais na URL (deep link, refresh e
  // compartilhamento de link) via history.pushState — cada navegação vira uma
  // entrada no histórico, então voltar/avançar do navegador funciona sem
  // precisar tocar nos ~40 pontos do arquivo que chamam setActiveView/
  // setActiveListId/setActiveScope diretamente. Não inclui `location`/`navigate`
  // nas deps de propósito: só deve rodar quando o ESTADO de navegação muda, não
  // a cada mudança de URL (senão loopa com o efeito de entrada abaixo).
  // hasResolvedInitialUrlRef declarada lá em cima (perto de workspaceMetaLoaded)
  // — também usada por loadTasks. Usada por este efeito E pelo de entrada logo abaixo.
  useEffect(() => {
    // Antes da primeira resolução (ver efeito de entrada logo abaixo), o
    // estado inicial de uma URL tipo /suprimentos/importacao ainda não foi
    // resolvido (índices de slug vazios) e vale um Dashboard/global
    // provisório — se este efeito navegasse pra `/` nesse meio-tempo, o
    // deep link seria destruído antes dos dados chegarem. Mesma lógica pra
    // pendingTaskSlugId: enquanto .../tarefa/<slug>-<id> ainda não resolveu
    // pra um selectedTaskId de verdade, esse efeito reescreveria a URL sem
    // o segmento de tarefa (selectedTaskId ainda é null) — espera resolver.
    if (!hasResolvedInitialUrlRef.current || pendingTaskSlugId) return;
    const targetPath = computeNavPath({ activeView, activeListId, activeScope, activeDocId, selectedTaskId }, location.search, navSlugMaps, tasks);
    const currentPath = `${location.pathname}${location.search}`;
    if (targetPath !== currentPath) {
      navigate(targetPath);
    }
    // `tasks` está nas deps só por causa do sufixo /tarefa/<slug>-<id>: uma
    // tarefa aberta antes de `tasks` do escopo terminar de carregar cai no
    // `?taskId=` legado (ver computeNavPath) até `tasks` chegar com o título
    // — sem essa dep, o efeito não roda de novo pra promover a URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView, activeListId, activeScope.type, activeScope.id, activeScope.name, activeDocId, selectedTaskId, navSlugMaps, pendingTaskSlugId, tasks]);

  // Entrada: aplica a URL de volta ao estado. Roda em duas situações:
  // (1) a URL mudou por ação do navegador (voltar/avançar, ou um link colado
  // na barra) — `navigationType === 'POP'` distingue isso de uma navegação
  // feita pelo efeito de saída acima (que usa PUSH), senão os dois efeitos
  // ficariam disputando entre si a cada navegação; (2) a primeira vez que
  // `workspaceMetaLoaded` vira true — nesse momento os índices de slug
  // (navSlugMaps) finalmente conseguem resolver um path tipo
  // /suprimentos/importacao que, no carregamento inicial (antes dos dados
  // chegarem), só tinha caído no fallback Dashboard/global.
  useEffect(() => {
    if (!workspaceMetaLoaded) return;
    const isFirstResolution = !hasResolvedInitialUrlRef.current;
    hasResolvedInitialUrlRef.current = true;
    if (!isFirstResolution && navigationType !== 'POP') return;
    const parsed = parseNavPath(location.pathname, location.search, navSlugMaps);
    setActiveView(parsed.view);
    setActiveListId(parsed.listId);
    setActiveDocId(parsed.docId);
    setSelectedTaskId(parsed.taskId);
    setPendingTaskSlugId(parsed.taskSlugId);
    setTaskCommentFocus(null);
    setActiveScope({ type: parsed.scopeType, id: parsed.scopeId, name: parsed.scopeName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname, location.search, navigationType, workspaceMetaLoaded, navSlugMaps]);

  const openAdminPanel = () => {
    setIsUserMenuOpen(false);
    setSelectedTaskId(null);
    setActiveScope({ type: 'global', id: null, name: 'Painel do Administrador' });
    setActiveView('Admin');
  };

  // Conjunto de pastas que o usuário pode ver: acesso a um ESPAÇO implica acesso
  // a TODAS as pastas daquele espaço (inclusive as criadas depois) — além das
  // pastas concedidas explicitamente. Isso evita o caso em que o colaborador tem
  // o espaço liberado mas o vê vazio porque folder_ids não acompanhou.
  const allowedFolderIdSet = useMemo(() => {
    if (currentUser.role === UserRole.ADMIN) return null; // null = acesso total
    const access = userAccess[currentUser.id];
    if (!access) return new Set<string>();
    const spaceIds = new Set(access.spaceIds || []);
    const ids = new Set<string>(access.folderIds || []);
    folders.forEach(f => { if (spaceIds.has(f.spaceId)) ids.add(f.id); });
    return ids;
  }, [folders, userAccess, currentUser]);

  // Filter Tasks based on Hierarchy ONLY (for Dashboard)
  const scopeTasks = useMemo(() => {
    let baseTasks = tasks;

    // Se não for ADMIN, filtramos as tarefas globais pelas pastas permitidas
    // SEMPRE incluímos tarefas onde o usuário é assignee direto (ex: tarefas do VPRequisições)
    if (currentUser.role !== UserRole.ADMIN) {
      const allowedFolderIds = allowedFolderIdSet ?? new Set<string>();
      const allowedListIds = lists.filter(l => allowedFolderIds.has(l.folderId)).map(l => l.id);
      const accessibleTasks = tasks.filter(t => allowedListIds.includes(t.listId));
      const assignedTasks = tasks.filter(t =>
        t.mainAssigneeId === currentUser.id ||
        (t.secondaryAssigneeIds ?? []).includes(currentUser.id)
      );
      // União sem duplicatas
      const seen = new Set<string>();
      baseTasks = [...accessibleTasks, ...assignedTasks].filter(t => {
        if (seen.has(t.id)) return false;
        seen.add(t.id);
        return true;
      });
    }

    let result = baseTasks;
    if (activeScope.type === 'folder' && activeScope.id) {
      const folderListIds = lists.filter(l => l.folderId === activeScope.id).map(l => l.id);
      result = result.filter(t => folderListIds.includes(t.listId));
    } else if (activeScope.type === 'space' && activeScope.id) {
      const spaceFolderIds = folders.filter(f => f.spaceId === activeScope.id).map(f => f.id);
      const spaceListIds = lists.filter(l => spaceFolderIds.includes(l.folderId)).map(l => l.id);
      result = result.filter(t => spaceListIds.includes(t.listId));
    }
    return result;
  }, [tasks, activeScope, lists, folders, currentUser, allowedFolderIdSet]);

  // ── Favorites (Supabase-synced, localStorage como seed inicial) ──────────
  const [favorites, setFavorites] = useState<{ type: 'list' | 'folder' | 'space'; id: string; name: string }[]>(() => {
    try { return JSON.parse(localStorage.getItem('vp_favorites') || '[]'); } catch { return []; }
  });

  // Carrega favoritos do Supabase ao autenticar (sobrescreve localStorage)
  useEffect(() => {
    if (!session?.user?.id) return;
    supabase.from('user_favorites').select('type, item_id, item_name').eq('user_id', session.user.id)
      .then(({ data }) => {
        if (!data) return;
        const favs = data.map((r: any) => ({ type: r.type as 'list' | 'folder' | 'space', id: r.item_id, name: r.item_name }));
        setFavorites(favs);
        localStorage.setItem('vp_favorites', JSON.stringify(favs));
      });
  }, [session?.user?.id]);

  const toggleFavorite = async (type: 'list' | 'folder' | 'space', id: string, name: string) => {
    const exists = favorites.some(f => f.type === type && f.id === id);
    const next = exists
      ? favorites.filter(f => !(f.type === type && f.id === id))
      : [...favorites, { type, id, name }];
    setFavorites(next);
    localStorage.setItem('vp_favorites', JSON.stringify(next));
    if (!session?.user?.id) return;
    if (exists) {
      await supabase.from('user_favorites').delete().eq('user_id', session.user.id).eq('type', type).eq('item_id', id);
    } else {
      await supabase.from('user_favorites').upsert({ user_id: session.user.id, type, item_id: id, item_name: name }, { onConflict: 'user_id,type,item_id' });
    }
  };

  // Filter Tasks based on Hierarchy + Search + Filters (for List/Kanban)
  const filteredTasks = useMemo(() => {
    let result = scopeTasks;

    // Se uma lista específica estiver selecionada na sidebar, filtramos por ela.
    if (activeListId) {
      result = result.filter((t) => t.listId === activeListId);
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(t =>
        t.title.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q)
      );
    }

    // Filter "Minhas Tarefas" view for ALL users
    if (activeScope.name === 'Minhas Tarefas') {
      result = result.filter(t => t.mainAssigneeId === currentUser.id || t.secondaryAssigneeIds?.includes(currentUser.id));
      // "Atribuídas a mim": esconde concluídas por padrão (igual ao ClickUp),
      // com toggle pra mostrar — mesmo critério de "fechada" já usado nos
      // badges de contagem por lista logo acima.
      if (!showClosedInMyTasks) {
        result = result.filter(t => {
          const s = (t.status || '').toLowerCase();
          const isClosed = s.includes('conclu') || s.includes('aprovado') || s.includes('fechado') || s.includes('done') || s.includes('cancel');
          return !isClosed;
        });
      }
    }

    // No escopo global (Início / sem espaço selecionado), COLABORADOR vê só suas tarefas.
    // Quando navega para um espaço ou pasta específica, vê todas as tarefas daquele contexto.
    if (currentUser.role === UserRole.COLABORADOR && activeScope.type === 'global') {
      result = result.filter(t => t.mainAssigneeId === currentUser.id || t.secondaryAssigneeIds?.includes(currentUser.id));
    }

    if (filterTags.length > 0) {
      result = result.filter(t => filterTags.some(tag => (t.tags ?? []).includes(tag)));
    }

    // Sort
    const PRIORITY_ORDER: Record<string, number> = { 'Urgente': 4, 'Alta': 3, 'Média': 2, 'Baixa': 1 };
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    result = [...result].sort((a, b) => {
      switch (sortConfig.field) {
        case 'title':
          return dir * a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
        case 'priority': {
          const pa = PRIORITY_ORDER[a.priority] ?? 0;
          const pb = PRIORITY_ORDER[b.priority] ?? 0;
          return dir * (pb - pa);
        }
        case 'dueDate': {
          const da = a.dueDate ? new Date(a.dueDate).getTime() : Infinity;
          const db = b.dueDate ? new Date(b.dueDate).getTime() : Infinity;
          return dir * (da - db);
        }
        case 'status':
          return dir * (a.status ?? '').localeCompare(b.status ?? '', 'pt-BR', { sensitivity: 'base' });
        default: // 'created'
          return dir * ((a.createdAt ?? '').localeCompare(b.createdAt ?? ''));
      }
    });

    return result;
  }, [scopeTasks, activeListId, searchQuery, currentUser, activeScope, filterTags, sortConfig, showClosedInMyTasks]);

  const fieldValueEntityIdsKey = useMemo(() => {
    const ids = new Set<string>();
    if (activeView === 'List' || activeView === 'Table') {
      filteredTasks.forEach((task) => ids.add(task.id));
    }
    if (selectedTaskId) ids.add(selectedTaskId);
    return Array.from(ids).sort().join(',');
  }, [activeView, filteredTasks, selectedTaskId]);

  useEffect(() => {
    if (!session) return;
    const entityIds = fieldValueEntityIdsKey ? fieldValueEntityIdsKey.split(',') : [];
    if (entityIds.length === 0) {
      setFieldValues([]);
      return;
    }

    let cancelled = false;
    taskRepo.fetchCustomFieldValuesByEntityIds(entityIds).then((values) => {
      if (!cancelled) setFieldValues(values);
    });
    return () => { cancelled = true; };
  }, [session, fieldValueEntityIdsKey]);

  // O modal "Gerenciar Campos Personalizados" precisa saber qual lista está
  // ativa pra ler/gravar quais campos estão ocultos — usa a mesma resolução
  // que o ListView (ver `resolveActiveListId`), senão os toggles gravam numa
  // chave que a tabela nunca consulta e parecem não ter efeito nenhum.
  const fieldManagerListId = useMemo(
    () => resolveActiveListId(activeListId, filteredTasks),
    [activeListId, filteredTasks],
  );

  const filteredSpaces = useMemo(() => {
    if (currentUser.role === UserRole.ADMIN) return spaces;
    const access = userAccess[currentUser.id];
    if (!access) return [];
    return spaces.filter((s) => access.spaceIds.includes(s.id));
  }, [spaces, userAccess, currentUser]);

  const filteredFolders = useMemo(() => {
    if (currentUser.role === UserRole.ADMIN) return folders;
    if (!allowedFolderIdSet) return folders;
    return folders.filter((f) => allowedFolderIdSet.has(f.id));
  }, [folders, allowedFolderIdSet, currentUser]);

  const uiScaleClass = uiScale <= 0.9 ? 'text-xs' : uiScale >= 1.2 ? 'text-base' : 'text-sm';

  // Conflito de sessão (LockManager) — checado antes de qualquer outra tela
  // de auth: mostra recuperação controlada em vez de deixar a pessoa presa em
  // "Carregando..." ou cair no redirect automático pro portal (LoginScreen).
  if (sessionConflict) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <div className="max-w-sm w-full bg-white/10 backdrop-blur-2xl border border-white/20 rounded-3xl p-8 text-center space-y-5">
          <div className="w-14 h-14 mx-auto rounded-full bg-yellow-400/20 flex items-center justify-center">
            <svg className="w-7 h-7 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <h2 className="text-white font-black text-lg">Conflito de sessão detectado</h2>
            <p className="text-slate-300 text-xs mt-2 leading-relaxed">
              Detectamos um conflito de sessão, provavelmente por outra aba do VP Click
              aberta ao mesmo tempo. Isso costuma se resolver sozinho — tente novamente
              antes de sair.
            </p>
          </div>
          <div className="space-y-2">
            <button
              onClick={handleRetrySession}
              className="w-full h-12 bg-yellow-400 hover:bg-yellow-300 text-slate-900 font-black rounded-2xl text-sm transition-all"
            >
              Tentar novamente
            </button>
            <button
              onClick={handleSignOutAndRestart}
              className="w-full h-12 bg-white/10 hover:bg-white/20 text-white font-bold rounded-2xl text-sm border border-white/20 transition-all"
            >
              Sair e entrar novamente
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Auth guard — a tela libera assim que a sessão for verificada. O vídeo do
  // logo é só decorativo aqui (toca em loop enquanto isso acontece); antes,
  // a tela ficava presa esperando o vídeo tocar por completo (~10s, com teto
  // de 12s) mesmo numa sessão que já validou em instantes — um piso artificial
  // de ~10s em TODO carregamento do app. Não há tela de login própria pra
  // cobrir aqui: a entrada é sempre via SSO do vpsistema.
  if (isLoadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <p className="text-slate-500 text-sm font-bold uppercase tracking-widest mb-3">Gestão de Tarefas</p>
          <video
            src={bootLogoVideo}
            autoPlay
            muted
            loop
            playsInline
            className="w-full max-w-sm mx-auto rounded-xl shadow-lg shadow-slate-200"
          />
          <p className="font-light text-2xl tracking-wide mt-4" style={{ color: COLORS.primary, fontFamily: 'Poppins, sans-serif' }}>VPCLICK</p>
          <div className="flex items-center justify-center gap-2 mt-4">
            <svg className="w-4 h-4 animate-spin" style={{ color: COLORS.primary }} fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-400 text-xs">Carregando...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!session || !is2faVerified) {
    return <LoginScreen onLogin={() => setIs2faVerified(true)} ssoError={ssoError} />;
  }

  return (
    <SSOHandler>
      <Toaster richColors position="top-right" />
      <div
        className={`flex h-screen bg-background text-foreground font-sans selection:bg-[var(--primary-color)]/30 ${uiScaleClass}`}
        onClick={() => setIsUserMenuOpen(false)}
        style={{
          ...(themePreset ? THEME_PRESETS[themePreset].vars : {}),
          "--primary-color": "hsl(var(--primary))",
          zoom: uiScale,
        } as React.CSSProperties}
      >
        {/* Sidebar */}
        <Sidebar
          themePreset={themePreset}
          spaces={filteredSpaces}
          folders={filteredFolders}
          lists={lists}
          activeView={activeView}
          activeScope={activeScope}
          activeListId={activeListId}
          onSetActiveListId={setActiveListId}
          onEnsurePersonalList={ensurePersonalList}
          onOpenAdminPanel={openAdminPanel}
          onNavigate={handleNavigate}
          onViewChange={setActiveView}
          isCollapsed={isSidebarCollapsed}
          onToggle={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          onOpenFields={() => setIsFieldManagerOpen(true)}
          onOpenCreateSpace={() => setIsSpaceModalOpen(true)}
          onOpenCreateFolder={openFolderModal}
          onCreateList={handleCreateList}
          userRole={currentUser.role}
          onRenameSpace={handleRenameSpace}
          onDeleteSpace={handleDeleteSpace}
          onRenameFolder={handleRenameFolder}
          onDeleteFolder={handleDeleteFolder}
          onBulkDeleteFolders={handleBulkDeleteFolders}
          onDeleteList={handleDeleteList}
          onRenameList={handleRenameList}
          onDuplicateList={handleDuplicateList}
          docs={docs}
          activeDocId={activeDocId}
          onSetActiveDocId={setActiveDocId}
          onCreateDoc={handleCreateDoc}
          onDeleteDoc={handleDeleteDoc}
          onMoveList={handleMoveList}
          onMoveFolder={handleMoveFolder}
          listTaskCounts={listTaskCounts}
          listProgressMap={listProgressMap}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
        />

        {/* Main Content */}
        <div className="flex-1 flex flex-col min-w-0 bg-muted">
          {/* Header */}
          <header className="h-14 border-b bg-card flex items-center justify-between px-6 shrink-0 z-10">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-bold text-gray-800 hidden md:block">
                {activeListId ? (lists.find(l => l.id === activeListId)?.name ?? activeScope.name) : activeScope.name}
              </h1>
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar tarefas..."
                  className="pl-8 pr-4 py-1.5 text-sm bg-gray-50 border rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)] w-48 sm:w-64"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                <div className="absolute left-2 top-2 text-gray-400">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                {isSearching && (
                  <svg className="w-4 h-4 animate-spin text-gray-400 absolute right-2 top-2" fill="none" viewBox="0 0 24 24" aria-label="Buscando">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
              </div>

              {/* Tag filter */}
              {workspaceTags.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${filterTags.length > 0 ? 'bg-orange-50 border-orange-300 text-orange-600' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                      <Tag className="w-3.5 h-3.5" />
                      Tags
                      {filterTags.length > 0 && (
                        <span className="ml-0.5 bg-orange-500 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold">
                          {filterTags.length}
                        </span>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-48 p-2" align="start">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Filtrar por tag</p>
                    {workspaceTags.map((tag) => (
                      <button
                        key={tag.id}
                        className="flex items-center gap-2 w-full px-2 py-1 rounded text-xs hover:bg-muted/50"
                        onClick={() =>
                          setFilterTags((prev) =>
                            prev.includes(tag.name)
                              ? prev.filter((t) => t !== tag.name)
                              : [...prev, tag.name]
                          )
                        }
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                        {filterTags.includes(tag.name) && (
                          <span className="ml-auto text-orange-500 font-bold">✓</span>
                        )}
                      </button>
                    ))}
                    {filterTags.length > 0 && (
                      <button
                        className="w-full text-xs text-muted-foreground mt-2 pt-2 border-t hover:text-foreground"
                        onClick={() => setFilterTags([])}
                      >
                        Limpar filtro
                      </button>
                    )}
                  </PopoverContent>
                </Popover>
              )}

              {/* "Atribuídas a mim": concluídas ficam escondidas por padrão, igual ao ClickUp.
                  Só faz sentido nas views que consomem filteredTasks (List/Table/Kanban) —
                  o dashboard "Minhas Tarefas" (MyTasksView) usa a lista de tarefas própria,
                  então o botão apareceria ali sem fazer nada. */}
              {activeScope.name === 'Minhas Tarefas' && activeView !== 'MyTasks' && (
                <button
                  onClick={() => setShowClosedInMyTasks(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${showClosedInMyTasks ? 'bg-orange-50 border-orange-300 text-orange-600' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                >
                  <Icons.CheckCircle2 className="w-3.5 h-3.5" />
                  {showClosedInMyTasks ? 'Ocultar concluídas' : 'Mostrar concluídas'}
                </button>
              )}

              {/* Sort button */}
              <Popover>
                <PopoverTrigger asChild>
                  <button className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${sortConfig.field !== 'created' ? 'bg-orange-50 border-orange-300 text-orange-600' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}>
                    <ArrowUpDown className="w-3.5 h-3.5" />
                    Ordenar
                    {sortConfig.field !== 'created' && (
                      <span className="ml-0.5 bg-orange-500 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center font-bold">1</span>
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-52 p-2" align="start">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Ordenar por</p>
                  {([
                    { field: 'created', label: 'Data de criação' },
                    { field: 'title',   label: 'Nome' },
                    { field: 'priority', label: 'Prioridade' },
                    { field: 'dueDate', label: 'Data limite' },
                    { field: 'status',  label: 'Status' },
                  ] as const).map(opt => {
                    const active = sortConfig.field === opt.field;
                    return (
                      <button
                        key={opt.field}
                        className={`flex items-center justify-between w-full px-2 py-1.5 rounded text-xs transition-colors ${active ? 'bg-orange-50 text-orange-600 font-semibold' : 'hover:bg-muted/50 text-foreground'}`}
                        onClick={() =>
                          setSortConfig(prev =>
                            prev.field === opt.field
                              ? { ...prev, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
                              : { field: opt.field, direction: 'asc' }
                          )
                        }
                      >
                        <span>{opt.label}</span>
                        {active && (
                          <span className="text-orange-500 font-bold">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </button>
                    );
                  })}
                  {sortConfig.field !== 'created' && (
                    <button
                      className="w-full text-xs text-muted-foreground mt-2 pt-2 border-t hover:text-foreground"
                      onClick={() => setSortConfig({ field: 'created', direction: 'asc' })}
                    >
                      Restaurar ordem padrão
                    </button>
                  )}
                </PopoverContent>
              </Popover>
            </div>

            <div className="flex items-center gap-4 relative">
              {(currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.GESTOR) && (
                <button
                  onClick={() => setIsCreateWikiModalOpen(true)}
                  title="Criar uma Wiki Interna (pasta + páginas de base já preenchidas)"
                  className="flex items-center gap-1.5 px-3 py-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-900 font-bold text-sm rounded-lg transition-colors"
                >
                  <FileText className="w-4 h-4" /> <span className="hidden md:inline">Wiki</span>
                </button>
              )}
              <button
                onClick={() => setShowGlobalAI(true)}
                title="IA do VP Click — modo Raio-X"
                className="flex items-center gap-1.5 px-3 py-1.5 text-purple-600 hover:bg-purple-50 font-bold text-sm rounded-lg transition-colors"
              >
                ✨ <span className="hidden md:inline">IA</span>
              </button>
              {showGlobalAI && (
                <div className="fixed inset-0 z-[95] bg-black/20" onClick={() => setShowGlobalAI(false)}>
                  <AIPanel onClose={() => setShowGlobalAI(false)} />
                </div>
              )}
              <NotificationBell
                currentUser={currentUser}
                users={adminUsers}
                onOpenTask={(taskId) => setSelectedTaskId(taskId)}
                onOpenMeeting={handleOpenMeeting}
                onOpenTaskComment={openTaskComment}
              />

              <div className="hidden sm:flex flex-col items-end">
                <span className="text-sm font-semibold">{currentUser.name}</span>
                <span className="text-xs text-gray-500 uppercase tracking-wider">{currentUser.role}</span>
              </div>

              <div
                className="relative cursor-pointer"
                onClick={(e) => { e.stopPropagation(); setIsUserMenuOpen(!isUserMenuOpen); }}
              >
                <img src={avatarThumb(currentUser.avatar)} alt="Avatar" className="w-10 h-10 rounded-full border-2 border-[var(--primary-color)] hover:opacity-90 transition-opacity" />

                {isUserMenuOpen && (
                  <div className="absolute right-0 top-12 w-56 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-[100] animate-in fade-in zoom-in-95 duration-100">
                    <div className="px-4 py-2 border-b mb-1">
                      <p className="font-bold text-gray-800">{currentUser.name}</p>
                      <p className="text-xs text-gray-500">{currentUser.email}</p>
                    </div>

                    <button
                      onClick={(e) => { e.stopPropagation(); setIsChangePasswordModalOpen(true); setIsUserMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11.5 17.5 14 20l-2.293 2.293c-.63.63-1.846.63-2.476 0l-2.293-2.293a1 1 0 00-1.414 0l-1.414 1.414a2 2 0 01-2.828 0 2 2 0 010-2.828l1.414-1.414a1 1 0 000-1.414l-1.414-1.414a2 2 0 010-2.828 2 2 0 012.828 0l2.293 2.293a1 1 0 001.414 0L13.257 8.257A6.002 6.002 0 0115 7z" /></svg>
                      Alterar senha
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setIsSettingsModalOpen(true); setIsUserMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                      Configurações
                    </button>

                    <button
                      onClick={(e) => { e.stopPropagation(); setIsTeamsModalOpen(true); setIsUserMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
                      Equipes
                    </button>

                    {(currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.GESTOR) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openAdminPanel();
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-[var(--primary-color)] font-bold hover:bg-gray-50 flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                        Painel Admin
                      </button>
                    )}

                    <div className="border-t my-1"></div>
                    <button
                      onClick={async () => {
                        setIsUserMenuOpen(false);
                        try {
                          await supabase.auth.signOut();
                        } catch (e) {
                          console.error("Erro no signOut:", e);
                        } finally {
                          setSession(null);
                          localStorage.clear();
                          sessionStorage.clear();
                          window.location.href = '/';
                        }
                      }}
                      className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                      Sair
                    </button>

                  </div>
                )}
              </div>
            </div>
          </header>

          {/* View Switcher / Toolbar */}
          <div className="h-12 border-b bg-white flex items-center px-6 gap-6 shrink-0 overflow-x-auto no-scrollbar">
            {activeView === 'Doc' ? (
              <div className="text-sm font-bold text-gray-800 flex items-center gap-2">
                <FileText className="h-4 w-4 text-orange-500" />
                Documento
              </div>
            ) : activeView !== 'Admin' ? (
              <>
                {activeScope.type === 'space' && (
                  <ViewTab active={activeView === 'Dashboard'} onClick={() => setActiveView('Dashboard')} label="Overview" />
                )}
                <ViewTab active={activeView === 'List'} onClick={() => setActiveView('List')} label="Lista" />
                <ViewTab active={activeView === 'Kanban'} onClick={() => setActiveView('Kanban')} label="Kanban" />
                <ViewTab active={activeView === 'Calendar'} onClick={() => setActiveView('Calendar')} label="Calendário" />
                <ViewTab active={activeView === 'Gantt'} onClick={() => setActiveView('Gantt')} label="Gantt" />
                <ViewTab active={activeView === 'Table'} onClick={() => setActiveView('Table')} label="Tabela" />
                {activeScope.type !== 'space' && (
                  <ViewTab active={activeView === 'Dashboard'} onClick={() => setActiveView('Dashboard')} label="Dashboards" />
                )}
                {activeListId && (
                  <button
                    onClick={() => { setAutomationListId(activeListId); setIsAutomationModalOpen(true); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 hover:text-gray-900 transition-colors font-medium whitespace-nowrap"
                    title="Gerenciar automações desta lista"
                  >
                    <Icons.Zap className="w-3.5 h-3.5 text-yellow-500" /> Automações
                  </button>
                )}
                {activeScope.type !== 'global' && (
                  <button
                    onClick={() => { setIsArchivedPanelOpen(true); loadArchivedTasks(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white hover:bg-amber-50 text-gray-600 hover:text-amber-700 transition-colors font-medium whitespace-nowrap"
                    title="Ver tarefas arquivadas deste escopo"
                  >
                    <ArchiveIcon className="w-3.5 h-3.5" /> Arquivadas
                  </button>
                )}
                {activeScope.type !== 'global' && (
                  <button
                    onClick={() => { setIsTrashPanelOpen(true); loadTrashedTasks(); }}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white hover:bg-red-50 text-gray-600 hover:text-red-600 transition-colors font-medium whitespace-nowrap"
                    title="Ver a Lixeira deste escopo"
                  >
                    <Icons.Trash className="w-3.5 h-3.5" /> Lixeira
                  </button>
                )}
                <div className="flex-1" />
                <button
                  onClick={() => setIsTaskModalOpen(true)}
                  aria-label="Criar tarefa"
                  aria-haspopup="dialog"
                  className="bg-[var(--primary-color)] hover:brightness-90 text-[#2c3e50] font-semibold text-sm px-4 py-1.5 rounded-md flex items-center gap-2 transition-all whitespace-nowrap"
                >
                  <Icons.Plus /> <span className="hidden sm:inline">Criar Tarefa</span>
                </button>
              </>
            ) : (
              <>
                <div className="text-sm font-bold text-gray-800">Gerenciamento</div>
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => { setActiveScope({ type: 'global', id: null, name: 'Dashboard' }); setActiveView('Dashboard'); }}
                  className="border rounded-md px-3 py-1.5 text-sm font-semibold bg-white hover:bg-gray-50"
                >
                  Voltar ao Dashboard
                </button>
              </>
            )}
          </div>

          {/* Dynamic View Area */}
          {/* Tabela é uma view de altura travada com scroll (vertical + horizontal)
              e cabeçalho sticky internos — precisa herdar altura definida do <main>
              em vez de "auto" (senão a própria página rola, o cabeçalho sticky não
              tem efeito e a barra horizontal só aparece depois de milhares de linhas,
              lá no rodapé real da página). As outras views continuam usando o scroll
              de página normal do <main>. */}
          <main className={`flex-1 custom-scrollbar ${activeView === 'Table' ? 'overflow-hidden flex flex-col' : 'overflow-auto p-4 sm:p-6'}`}>
          <div key={activeView} className={`animate-in fade-in slide-in-from-bottom-1 duration-200 ${activeView === 'Table' ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
          <React.Suspense
            fallback={
              <div className="flex items-center justify-center py-24">
                <div className="w-8 h-8 border-2 border-gray-200 border-t-orange-500 rounded-full animate-spin" />
              </div>
            }
          >
            {activeView === 'Admin' && (
              <AdminPanel
                spaces={spaces}
                folders={folders}
                users={adminUsers}
                lastSignInMap={lastSignInMap}
                access={userAccess}
                onAdminUpdateRole={handleAdminUpdateRole}
                onAdminUpdateAccess={handleAdminUpdateAccess}
                onAdminDeleteUser={handleAdminDeleteUser}
                onAdminCreateUser={handleAdminCreateUser}
                onAdminUpdateAvatar={handleAdminUpdateUserAvatar}
                onAdminUpdatePassword={handleAdminUpdatePassword}
                onBack={() => { setActiveScope({ type: 'global', id: null, name: 'Dashboard' }); setActiveView('Dashboard'); }}
              />
            )}
            {activeView === 'List' && (
              <ListView
                tasks={filteredTasks}
                onSelectTask={setSelectedTaskId}
                onStatusChange={handleStatusChange}
                context={activeListId
                  ? { ...activeScope, name: lists.find(l => l.id === activeListId)?.name ?? activeScope.name }
                  : activeScope}
                onQuickCreate={(prefill?: any) => {
                  setPrefilledTaskData(prefill || null);
                  setIsTaskModalOpen(true);
                }}
                onDeleteTask={handleDeleteTask}
                onDuplicateTask={setTaskToDuplicate}
                lists={lists}
                activeListId={activeListId}
                hiddenStandardColumnKeysByList={hiddenStandardColumnKeysByList}
                onToggleStandardColumn={(listId: string, key: any) => {
                  setHiddenStandardColumnKeysByList((prev) => {
                    const current = prev[listId] ?? [];
                    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
                    return { ...prev, [listId]: next };
                  });
                }}
                customFields={customFields}
                fieldValues={fieldValues}
                hiddenTaskFieldIdsByList={hiddenTaskFieldIdsByList}
                onCreateField={handleCreateField}
                onUpdateFieldValue={handleUpdateFieldValue}
                onHideTaskFieldForList={handleToggleTaskFieldForList}
                onOpenManager={() => setIsFieldManagerOpen(true)}
                columnOrder={activeListId ? columnOrderByList[activeListId] : undefined}
                onReorderColumns={(newOrder) => {
                  if (activeListId) {
                    setColumnOrderByList(prev => ({ ...prev, [activeListId]: newOrder }));
                  }
                }}
                currentUser={currentUser}
                users={adminUsers}
                statusGroups={statusGroups}
                onBulkStatusChange={handleBulkStatusChange}
                onBulkPriorityChange={handleBulkPriorityChange}
                onBulkDelete={handleBulkDelete}
                onBulkMove={handleBulkMove}
                isLoading={isTasksLoading}
              />
            )}
            {activeView === 'Kanban' && (
              <KanbanView
                tasks={filteredTasks}
                onSelectTask={setSelectedTaskId}
                onStatusChange={handleStatusChange}
                onQuickUpdateTask={handleQuickUpdateTask}
                onDeleteTask={handleDeleteTask}
                onDuplicateTask={setTaskToDuplicate}
                onCreateTask={handleCreateTask}
                onQuickCreate={(prefill?: any) => {
                  setPrefilledTaskData(prefill || null);
                  setIsTaskModalOpen(true);
                }}
                users={adminUsers}
                statusGroups={statusGroups}
                lists={lists}
                activeListId={activeListId}
                currentUser={currentUser}
                workspaceTags={workspaceTags}
              />
            )}
            {activeView === 'Dashboard' && (
              activeScope.type === 'space' && activeScope.id ? (
                <SpaceOverview
                  space={spaces.find((s: Space) => s.id === activeScope.id)!}
                  folders={folders.filter((f: Folder) => f.spaceId === activeScope.id)}
                  lists={lists}
                  listProgressMap={listProgressMap}
                  tasks={scopeTasks}
                  onNavigateFolder={(id: string, name: string) => handleNavigate('folder', id, name)}
                  onNavigateList={(listId: string) => { setActiveListId(listId); setActiveView('List'); }}
                  onCreateFolder={() => openFolderModal(activeScope.id!)}
                />
              ) : (
                // Dashboard global: usa dashboardTasks (todas as tarefas, sem filtro de escopo)
                // Fallback para scopeTasks enquanto carrega pela primeira vez
                <DashboardView
                  tasks={dashboardTasks.length > 0 ? dashboardTasks : scopeTasks}
                  users={adminUsers}
                  statusGroups={statusGroups}
                  activeListId={activeListId}
                  lists={lists}
                  allLists={dashboardLists.length > 0 ? dashboardLists : lists}
                  isLoading={isDashboardLoading && dashboardTasks.length === 0}
                  isAdmin={currentUser.role === UserRole.ADMIN}
                />
              )
            )}
            {activeView === 'Calendar' && (
              <CalendarView
                tasks={filteredTasks}
                users={adminUsers}
                onTaskClick={setSelectedTaskId}
                onAddTaskAtDate={(date) => {
                  setPrefilledTaskData({ dueDate: formatLocalDate(date) });
                  setIsTaskModalOpen(true);
                }}
                onCreateTask={handleCreateTask}
                onUpdateTask={handleUpdateTask}
                lists={lists}
                statusGroups={statusGroups}
                activeListId={activeListId}
                currentUser={currentUser}
              />
            )}
            {activeView === 'Gantt' && (
              <GanttView
                tasks={filteredTasks}
                onTaskClick={setSelectedTaskId}
                onUpdateTask={handleUpdateTask}
                users={adminUsers}
                lists={lists}
                currentUserId={currentUser.id}
                statusGroups={statusGroups}
              />
            )}
            {activeView === 'Inbox' && (
              <InboxView
                currentUser={currentUser}
                users={adminUsers}
                lists={lists}
                onOpenTask={setSelectedTaskId}
                onOpenMeeting={handleOpenMeeting}
                onOpenTaskComment={openTaskComment}
                onCreateTaskFromComment={createTaskFromComment}
              />
            )}
            {activeView === 'Replies' && (
              <RepliesView
                currentUser={currentUser}
                users={adminUsers}
                onOpenTask={setSelectedTaskId}
              />
            )}
            {activeView === 'AssignedComments' && (
              <AssignedCommentsView
                currentUser={currentUser}
                users={adminUsers}
                onOpenTask={setSelectedTaskId}
              />
            )}
            {activeView === 'Meetings' && (
              <MeetingsView
                currentUser={currentUser}
                users={adminUsers}
                lists={lists}
                onOpenTask={setSelectedTaskId}
                onCreateTaskFromActionItem={createTaskFromMeetingActionItem}
                openMeetingId={openMeetingId}
                onOpenMeetingHandled={() => setOpenMeetingId(null)}
              />
            )}
            {activeView === 'MyTasks' && (
              <MyTasksView
                currentUser={currentUser}
                users={adminUsers}
                tasks={(myTasks.length > 0 || isMyTasksLoading)
                  ? myTasks.map(t => tasks.find(existing => existing.id === t.id) || t)
                  : filteredTasks}
                isLoading={isMyTasksLoading && myTasks.length === 0}
                onOpenTask={setSelectedTaskId}
              />
            )}
            {activeView === 'Reminders' && (
              <RemindersView
                currentUser={currentUser}
                users={adminUsers}
                lists={lists}
                onOpenTask={setSelectedTaskId}
                onCreateTaskFromReminder={createTaskFromReminder}
              />
            )}
            {activeView === 'RecentTasks' && (
              <RecentTasksView
                currentUser={currentUser}
                users={adminUsers}
                tasks={tasks}
                onOpenTask={setSelectedTaskId}
              />
            )}
            {activeView === 'Table' && (
              <TableView
                tasks={filteredTasks}
                allTasks={tasks}
                customFields={customFields}
                fieldValues={fieldValues}
                users={adminUsers}
                lists={lists}
                folders={folders}
                spaces={spaces}
                activeListId={activeListId}
                activeScope={activeScope}
                currentUser={currentUser}
                statusGroups={statusGroups}
                onTaskClick={setSelectedTaskId}
                onUpdateTask={handleUpdateTask}
                onUpdateFieldValue={handleUpdateFieldValue}
                onCreateTask={handleCreateTask}
                onDeleteTask={handleDeleteTask}
                onDuplicateTask={setTaskToDuplicate}
                onBulkStatusChange={handleBulkStatusChange}
                onBulkPriorityChange={handleBulkPriorityChange}
                onBulkMove={handleBulkMove}
                onBulkDelete={handleBulkDelete}
                workspaceTags={workspaceTags}
              />
            )}
            {activeView === 'Doc' && activeDocId && (
              <DocView
                doc={docs.find(d => d.id === activeDocId)!}
                allDocs={docs}
                onUpdate={handleUpdateDoc}
                onSelectDoc={setActiveDocId}
                onCreateSubpage={(parentDoc: Doc) => handleCreateDoc(parentDoc.folderId, parentDoc.id)}
                currentUser={currentUser}
                uploadFile={uploadFile}
              />
            )}
          </React.Suspense>
          </div>
          </main>
        </div>

        {/* Task Detail Modal */}
        <CreateListModal
          isOpen={isCreateListModalOpen}
          onClose={() => setIsCreateListModalOpen(false)}
          onConfirm={async (name, statusGroupId) => {
            if (createListFolderId) {
              await handleConfirmCreateList(createListFolderId, name, statusGroupId);
            }
          }}
          statusGroups={statusGroups}
        />

        {selectedTask && (
          <ErrorBoundary
            key={selectedTask.id}
            onClose={() => {
              // Remover taskId (e tab) da URL fica a cargo do efeito de saída
              // da navegação (ver computeNavPath), que já roda sempre que
              // selectedTaskId muda — não precisa mexer na URL aqui.
              setSelectedTaskId(null);
              setTaskCommentFocus(null);
            }}
          >
            <TaskDetailModal
              task={selectedTask}
              users={adminUsers}
              tasks={tasks}
              onClose={() => {
                setSelectedTaskId(null);
                setTaskCommentFocus(null);
              }}
              focusCommentId={taskCommentFocus?.commentId ?? null}
              focusAction={taskCommentFocus?.action ?? null}
              onFocusHandled={() => setTaskCommentFocus(null)}
              onUpdate={updateTask}
              currentUser={currentUser}
              customFields={customFields}
              fieldValues={fieldValues}
              onUpdateFieldValue={handleUpdateFieldValue}
              hiddenTaskFieldIdsByList={hiddenTaskFieldIdsByList}
              onManageFields={(listId: string) => {
                setFieldManagerListIdOverride(listId || null);
                setIsFieldManagerOpen(true);
              }}
              onDelete={() => handleDeleteTask(selectedTask.id)}
              onDuplicate={() => setTaskToDuplicate(selectedTask)}
              onArchive={() => handleArchiveTask(selectedTask)}
              onUnarchive={() => handleUnarchiveTask(selectedTask)}
              onRestore={() => handleRestoreTask(selectedTask)}
              onConfigureRecurrence={() => openTaskRecurrenceModal(selectedTask)}
              recurrenceRule={taskRecurrenceRuleCache[selectedTask.id]}
              onSelectTask={setSelectedTaskId}
              onQuickCreate={(prefill?: any) => {
                setPrefilledTaskData(prefill || null);
                setIsTaskModalOpen(true);
              }}
              saveAttachment={saveTaskAttachment}
              removeAttachment={removeTaskAttachment}
              saveComment={saveTaskComment}
              editComment={editTaskComment}
              deleteComment={deleteTaskComment}
              assignComment={assignTaskComment}
              resolveComment={resolveTaskComment}
              toggleWatcher={toggleWatcher}
              saveExtensionLog={saveExtensionLog}
              saveTaskActivity={saveTaskActivity}
              uploadFile={uploadFile}
              statusGroups={statusGroups}
              lists={lists}
              folders={folders}
              workspaceId={workspace.id}
              teams={teams}
              onTagsChange={(taskId: string, tags: string[]) =>
                setTasks(prev => prev.map(t => t.id === taskId ? { ...t, tags } : t))
              }
            />
          </ErrorBoundary>
        )}

        <TeamsModal
          isOpen={isTeamsModalOpen}
          onClose={() => setIsTeamsModalOpen(false)}
          teams={teams}
          setTeams={setTeams}
          users={adminUsers}
          currentUser={currentUser}
        />

        {/* Create Task Modal */}
        {isTaskModalOpen && (
          <CreateTaskModal
            onClose={() => {
              setIsTaskModalOpen(false);
              setPrefilledTaskData(null);
            }}
            onCreate={handleCreateTask}
            users={adminUsers}
            spaces={filteredSpaces}
            additionalTasks={tasks}
            folders={filteredFolders}
            lists={lists}
            initialScope={activeScope}
            activeListId={activeListId}
            currentUser={currentUser}
            prefilledData={prefilledTaskData}
            statusGroups={statusGroups}
          />
        )}

        <DuplicateTaskModal
          task={taskToDuplicate}
          lists={lists}
          isOpen={!!taskToDuplicate}
          isSubmitting={isDuplicatingTask}
          onClose={() => {
            if (!isDuplicatingTask) setTaskToDuplicate(null);
          }}
          onDuplicate={(options) => {
            if (taskToDuplicate) handleDuplicateTask(taskToDuplicate, options);
          }}
        />

        <RecurrenceConfigModal
          task={recurrenceConfigTask}
          rule={recurrenceConfigRule}
          isOpen={!!recurrenceConfigTask}
          isLoading={isLoadingRecurrenceRule}
          isSubmitting={isSavingRecurrenceRule}
          onClose={() => {
            if (!isSavingRecurrenceRule) { setRecurrenceConfigTask(null); setRecurrenceConfigRule(null); }
          }}
          onSave={handleSaveRecurrenceRule}
          onToggleEnabled={handleToggleRecurrenceEnabled}
          onDelete={handleDeleteRecurrenceRule}
          currentUser={currentUser}
        />

        {/* Custom Fields Manager */}
        {isFieldManagerOpen && (
          <CustomFieldsManager
            onClose={() => { setIsFieldManagerOpen(false); setFieldManagerListIdOverride(null); }}
            fields={customFields}
            onCreateField={handleCreateField}
            onUpdateField={handleUpdateField}
            onDeleteField={handleDeleteField}
            onReorderField={handleReorderField}
            currentUser={currentUser}
            activeListId={fieldManagerListIdOverride ?? fieldManagerListId}
            hiddenStandardColumnKeysByList={hiddenStandardColumnKeysByList}
            onToggleStandardColumn={(listId: string, key: any) => {
              setHiddenStandardColumnKeysByList((prev) => {
                const current = prev[listId] ?? [];
                const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
                return { ...prev, [listId]: next };
              });
            }}
            hiddenTaskFieldIdsByList={hiddenTaskFieldIdsByList}
            onHideTaskFieldForList={handleToggleTaskFieldForList}
          />
        )}

        {/* Create Space Modal */}
        {isSpaceModalOpen && (
          <CreateSpaceModal
            onClose={() => setIsSpaceModalOpen(false)}
            onCreate={handleCreateSpace}
          />
        )}

        {/* Create Wiki Modal */}
        {isCreateWikiModalOpen && (
          <CreateWikiModal
            spaces={spaces}
            onClose={() => setIsCreateWikiModalOpen(false)}
            onCreate={async (spaceId: string) => {
              setIsCreateWikiModalOpen(false);
              await handleCreateWiki(spaceId);
            }}
          />
        )}

        {/* Change Password Modal */}
        {isChangePasswordModalOpen && (
          <ChangePasswordModal
            onClose={() => setIsChangePasswordModalOpen(false)}
          />
        )}

        {/* Automation Modal */}
        {isAutomationModalOpen && automationListId && (
          <AutomationModal
            listId={automationListId}
            listName={lists.find(l => l.id === automationListId)?.name || ''}
            currentUserId={currentUser.id}
            workspaceId={workspace.id}
            onClose={() => setIsAutomationModalOpen(false)}
            onCreated={() => setIsAutomationModalOpen(false)}
          />
        )}

        {/* Create Folder Modal */}
        {isFolderModalOpen && (
          <CreateFolderModal
            onClose={() => setIsFolderModalOpen(false)}
            onCreate={handleCreateFolder}
          />
        )}

        {/* Settings Modal */}
        {isSettingsModalOpen && (
          <SettingsModal
            onClose={() => setIsSettingsModalOpen(false)}
            themePreset={themePreset}
            setThemePreset={setThemePreset}
            uiScale={uiScale}
            setUiScale={setUiScale}
          />
        )}

        {/* Rename Modal */}
        {renameModal && (
          <RenameModal
            title={renameModal.title}
            defaultValue={renameModal.defaultValue}
            placeholder={renameModal.placeholder}
            onConfirm={(v) => { renameModal.onSubmit(v); setRenameModal(null); }}
            onClose={() => setRenameModal(null)}
          />
        )}

        {/* Confirm Modal */}
        {confirmModal && (
          <ConfirmModal
            message={confirmModal.message}
            confirmLabel={confirmModal.confirmLabel}
            variant={confirmModal.variant}
            onConfirm={() => { confirmModal.onConfirm(); setConfirmModal(null); }}
            onClose={() => setConfirmModal(null)}
          />
        )}

        {/* Issue #185, gota 3 — painel "Tarefas arquivadas" */}
        {isArchivedPanelOpen && (
          <ArchivedTasksModal
            isLoading={isArchivedLoading}
            tasks={archivedTasks}
            lists={lists}
            users={adminUsers}
            onClose={() => setIsArchivedPanelOpen(false)}
            onOpenTask={(taskId) => { setSelectedTaskId(taskId); setIsArchivedPanelOpen(false); }}
            onUnarchive={handleUnarchiveTask}
          />
        )}

        {/* Issue #185, gota 4 — painel "Lixeira" */}
        {isTrashPanelOpen && (
          <TrashModal
            isLoading={isTrashLoading}
            tasks={trashedTasks}
            lists={lists}
            users={adminUsers}
            onClose={() => setIsTrashPanelOpen(false)}
            onOpenTask={(taskId) => { setSelectedTaskId(taskId); setIsTrashPanelOpen(false); }}
            onRestore={handleRestoreTask}
          />
        )}

        {/* Issue #185, gota 4 — seletor de motivo antes de mover pra Lixeira */}
        {trashReasonModal && (
          <TrashReasonModal
            onClose={() => setTrashReasonModal(null)}
            onConfirm={handleConfirmMoveToTrash}
          />
        )}
      </div>
        <CommandDialog open={isCommandOpen} onOpenChange={setIsCommandOpen}>
          <CommandInput placeholder="Pesquisar tarefas, listas, espaços ou executar um comando..." />
          <CommandList>
            <CommandEmpty>Nenhum resultado encontrado.</CommandEmpty>

            {/* Espaços */}
            <CommandGroup heading="Espaços">
              {spaces.map((s: Space) => (
                <CommandItem key={`space-${s.id}`} value={`espaço ${s.name}`} onSelect={() => { handleNavigate('space', s.id, s.name); setIsCommandOpen(false); }}>
                  <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 font-bold text-[9px] text-white mr-2" style={{ backgroundColor: s.color || '#6366f1' }}>{s.name.charAt(0)}</div>
                  <span>{s.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">Espaço</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandSeparator />

            {/* Listas */}
            <CommandGroup heading="Listas">
              {lists.slice(0, 20).map((l: List) => {
                const folder = folders.find((f: Folder) => f.id === l.folderId);
                return (
                  <CommandItem key={`list-${l.id}`} value={`lista ${l.name} ${folder?.name || ''}`} onSelect={() => { setActiveListId(l.id); setActiveView('List'); setIsCommandOpen(false); }}>
                    <Icons.List className="mr-2 h-4 w-4 text-muted-foreground shrink-0" />
                    <span>{l.name}</span>
                    {folder && <span className="ml-2 text-xs text-muted-foreground truncate">em {folder.name}</span>}
                    <span className="ml-auto text-xs text-muted-foreground">Lista</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
            <CommandSeparator />

            {/* Ações rápidas */}
            <CommandGroup heading="Ações">
              <CommandItem value="criar nova tarefa" onSelect={() => { setIsTaskModalOpen(true); setIsCommandOpen(false); }}>
                <Icons.Plus className="mr-2 h-4 w-4" />
                <span>Criar Nova Tarefa</span>
                <span className="ml-auto text-xs text-muted-foreground">Ctrl+N</span>
              </CommandItem>
              <CommandItem value="minhas tarefas" onSelect={() => { handleNavigate('global', null, 'Minhas Tarefas'); setActiveView('MyTasks'); setIsCommandOpen(false); }}>
                <Icons.Check className="mr-2 h-4 w-4" />
                <span>Minhas Tarefas</span>
              </CommandItem>
              <CommandItem value="dashboard geral" onSelect={() => { handleNavigate('global', null, 'Dashboard'); setActiveView('Dashboard'); setIsCommandOpen(false); }}>
                <Icons.Home className="mr-2 h-4 w-4" />
                <span>Dashboard Geral</span>
              </CommandItem>
              <CommandItem value="view kanban quadro" onSelect={() => { setActiveView('Kanban'); setIsCommandOpen(false); }}>
                <Icons.Columns className="mr-2 h-4 w-4" />
                <span>Ir para Kanban</span>
              </CommandItem>
              <CommandItem value="view gantt cronograma" onSelect={() => { setActiveView('Gantt'); setIsCommandOpen(false); }}>
                <Icons.GanttIcon className="mr-2 h-4 w-4" />
                <span>Ir para Gantt</span>
              </CommandItem>
              <CommandItem value="view calendario" onSelect={() => { setActiveView('Calendar'); setIsCommandOpen(false); }}>
                <Icons.Calendar className="mr-2 h-4 w-4" />
                <span>Ir para Calendário</span>
              </CommandItem>
              {(currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.GESTOR) && (
                <CommandItem value="admin administracao configuracoes" onSelect={() => { openAdminPanel(); setIsCommandOpen(false); }}>
                  <Icons.Shield className="mr-2 h-4 w-4" />
                  <span>Painel Admin</span>
                </CommandItem>
              )}
            </CommandGroup>
            <CommandSeparator />

            {/* Tarefas */}
            <CommandGroup heading="Tarefas">
              {tasks.slice(0, 15).map((t: Task) => {
                const list = lists.find((l: List) => l.id === t.listId);
                return (
                  <CommandItem key={`task-${t.id}`} value={`tarefa ${t.title} ${list?.name || ''}`} onSelect={() => { setSelectedTaskId(t.id); setIsCommandOpen(false); }}>
                    <div className={`w-2 h-2 rounded-full mr-2 shrink-0 ${t.priority === TaskPriority.URGENTE ? 'bg-red-500' : t.priority === TaskPriority.ALTA ? 'bg-orange-400' : 'bg-blue-400'}`} />
                    <span className="truncate flex-1">{t.title}</span>
                    {list && <span className="ml-2 text-xs text-muted-foreground shrink-0">{list.name}</span>}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </SSOHandler>
  );
}

// ── Linkify: converte URLs de texto puro em <a> clicáveis ──────────────────
function linkifyHtml(html: string): string {
  // Divide o HTML em partes: já-linkificadas (<a>…</a>) e texto puro
  const parts = html.split(/(<a[\s>][\s\S]*?<\/a>)/gi);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part; // já é um <a>, preserva
      // Nos trechos de texto, linkifica URLs soltas
      return part.replace(
        /(?<![=/"'`])(https?:\/\/[^\s<>"'`\]]+)/g,
        (url) => {
          const clean = url.replace(/[.,;:!?)\]]+$/, '');
          const trail = url.slice(clean.length);
          return `<a href="${clean}" target="_blank" rel="noopener noreferrer">${clean}</a>${trail}`;
        }
      );
    })
    .join('');
}

// ── Space Overview — dashboard do espaço (estilo ClickUp) ─────────────────
function SpaceOverview({ space, folders, lists, listProgressMap, tasks, onNavigateFolder, onNavigateList, onCreateFolder }: {
  space: Space;
  folders: Folder[];
  lists: List[];
  listProgressMap: Map<string, { done: number; total: number }>;
  tasks: Task[];
  onNavigateFolder: (id: string, name: string) => void;
  onNavigateList: (listId: string) => void;
  onCreateFolder: () => void;
}) {
  if (!space) return null;

  const totalTasks = tasks.length;
  const doneTasks = tasks.filter(t => {
    const s = (t.status || '').toLowerCase();
    return s.includes('conclu') || s.includes('aprovado') || s.includes('fechado') || s.includes('done') || s.includes('cancel');
  }).length;
  const openTasks = totalTasks - doneTasks;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  // Recent lists (last 5 with tasks)
  const listsWithTasks = lists
    .filter(l => folders.some(f => f.id === l.folderId))
    .filter(l => (listProgressMap.get(l.id)?.total || 0) > 0)
    .slice(0, 6);

  // All lists in this space (via folders)
  const folderIds = new Set(folders.map(f => f.id));
  const spaceLists = lists.filter(l => folderIds.has(l.folderId));

  return (
    <div className="flex-1 overflow-y-auto p-6 bg-muted">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        {space.icon ? (
          (() => { const IconComponent = (Icons as any)[space.icon] || Icons.Layout; return <IconComponent className="w-8 h-8" style={{ color: space.color }} />; })()
        ) : (
          <div className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-lg text-white shadow-sm" style={{ backgroundColor: space.color || '#6366f1' }}>
            {space.name.charAt(0).toUpperCase()}
          </div>
        )}
        <div>
          <h1 className="text-2xl font-bold text-foreground">{space.name}</h1>
          <p className="text-sm text-muted-foreground">{folders.length} pasta{folders.length !== 1 ? 's' : ''} · {spaceLists.length} lista{spaceLists.length !== 1 ? 's' : ''} · {totalTasks} tarefa{totalTasks !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {/* Progress bar geral */}
      {totalTasks > 0 && (
        <div className="mb-6 bg-card rounded-xl p-4 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-foreground">Progresso Geral</span>
            <span className="text-sm text-muted-foreground">{doneTasks}/{totalTasks} concluídas ({progressPct}%)</span>
          </div>
          <div className="h-2.5 bg-muted rounded-full overflow-hidden">
            <div className="h-full bg-primary rounded-full transition-all duration-500" style={{ width: `${progressPct}%` }} />
          </div>
          <div className="flex gap-4 mt-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />{doneTasks} concluídas</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" />{openTasks} em aberto</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Pastas */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Icons.Folder className="w-4 h-4 text-muted-foreground" />
              Pastas
            </h2>
            <button
              onClick={onCreateFolder}
              className="text-xs text-primary hover:underline flex items-center gap-1"
            >
              <Icons.Plus className="w-3 h-3" /> Adicionar pasta
            </button>
          </div>
          {folders.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma pasta criada</p>
          ) : (
            <div className="space-y-1">
              {folders.map(folder => {
                const folderLists = lists.filter(l => l.folderId === folder.id);
                const folderTotalTasks = folderLists.reduce((sum, l) => sum + (listProgressMap.get(l.id)?.total || 0), 0);
                const folderDoneTasks = folderLists.reduce((sum, l) => sum + (listProgressMap.get(l.id)?.done || 0), 0);
                const folderPct = folderTotalTasks > 0 ? Math.round((folderDoneTasks / folderTotalTasks) * 100) : 0;
                return (
                  <div
                    key={folder.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted cursor-pointer group transition-colors"
                    onClick={() => onNavigateFolder(folder.id, folder.name)}
                  >
                    <Icons.Folder className="w-4 h-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium text-foreground flex-1 group-hover:text-primary transition-colors">{folder.name}</span>
                    <span className="text-xs text-muted-foreground">{folderLists.length} lista{folderLists.length !== 1 ? 's' : ''}</span>
                    {folderTotalTasks > 0 && (
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-primary rounded-full" style={{ width: `${folderPct}%` }} />
                        </div>
                        <span>{folderPct}%</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Listas com progresso */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
              <Icons.List className="w-4 h-4 text-muted-foreground" />
              Listas
            </h2>
          </div>
          {spaceLists.length === 0 ? (
            <p className="text-xs text-muted-foreground py-4 text-center">Nenhuma lista criada</p>
          ) : (
            <div className="space-y-2">
              {spaceLists.slice(0, 8).map(list => {
                const prog = listProgressMap.get(list.id) || { done: 0, total: 0 };
                const pct = prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : 0;
                const folder = folders.find(f => f.id === list.folderId);
                return (
                  <div
                    key={list.id}
                    className="cursor-pointer group hover:bg-muted rounded-lg px-3 py-2 transition-colors"
                    onClick={() => onNavigateList(list.id)}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icons.List className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm font-medium text-foreground flex-1 truncate group-hover:text-primary transition-colors">{list.name}</span>
                      {folder && <span className="text-[10px] text-muted-foreground shrink-0">{folder.name}</span>}
                      <span className="text-xs text-muted-foreground shrink-0">{prog.done}/{prog.total}</span>
                    </div>
                    {prog.total > 0 ? (
                      <div className="flex items-center gap-2 ml-5">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-7 text-right">{pct}%</span>
                      </div>
                    ) : (
                      <div className="ml-5 h-1.5 bg-muted/50 rounded-full" />
                    )}
                  </div>
                );
              })}
              {spaceLists.length > 8 && (
                <p className="text-xs text-muted-foreground text-center pt-1">+ {spaceLists.length - 8} mais listas</p>
              )}
            </div>
          )}
        </div>

        {/* Estatísticas rápidas */}
        <div className="bg-card rounded-xl border border-border shadow-sm p-4">
          <h2 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 16 16"><rect x="1" y="8" width="3" height="6" rx="0.5"/><rect x="6" y="5" width="3" height="9" rx="0.5"/><rect x="11" y="2" width="3" height="12" rx="0.5"/></svg>
            Resumo
          </h2>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Total', value: totalTasks, color: 'text-foreground' },
              { label: 'Em aberto', value: openTasks, color: 'text-blue-500' },
              { label: 'Concluídas', value: doneTasks, color: 'text-green-500' },
            ].map(stat => (
              <div key={stat.label} className="text-center bg-muted/50 rounded-lg py-3">
                <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function DocView({ doc, allDocs = [], onUpdate, onSelectDoc, onCreateSubpage, currentUser, uploadFile }: {
  doc: Doc,
  allDocs?: Doc[],
  onUpdate: (doc: Doc) => void,
  onSelectDoc?: (docId: string) => void,
  onCreateSubpage?: (parentDoc: Doc) => void,
  currentUser: User,
  uploadFile: (file: File, path: string, bucket?: string) => Promise<string | null>
}) {
  const parentDoc = doc.parentId ? allDocs.find(d => d.id === doc.parentId) : null;
  const childDocs = allDocs.filter(d => d.parentId === doc.id);
  const [headerImage, setHeaderImage] = useState(doc.headerImage || '');
  const [title, setTitle] = useState(doc.title);
  const [isUploading, setIsUploading] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setTitle(doc.title);
    setHeaderImage(doc.headerImage || '');
    if (contentRef.current) {
      const linked = linkifyHtml(doc.content);
      if (contentRef.current.innerHTML !== linked) {
        contentRef.current.innerHTML = linked;
      }
    }
  }, [doc]);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    onUpdate({ ...doc, title: e.target.value });
  };

  const handleContentBlur = () => {
    if (contentRef.current) {
      onUpdate({ ...doc, content: contentRef.current.innerHTML });
    }
  };

  // Ao colar texto puro, linkifica URLs antes de inserir
  const handlePaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const html = e.clipboardData.getData('text/html');
    const plain = e.clipboardData.getData('text/plain');
    if (!html && plain) {
      e.preventDefault();
      const escaped = plain
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
      document.execCommand('insertHTML', false, linkifyHtml(escaped));
    }
    // Se houver HTML (colar do Word/navegador), deixa o navegador inserir normalmente
    // e aplica linkify no blur
  };

  // contentEditable bloqueia cliques em <a>; abrimos manualmente
  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const link = (e.target as HTMLElement).closest('a');
    if (link) {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (href) window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  const handleAddLink = () => {
    const url = window.prompt("Digite o URL do link:");
    if (url) {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;

      // Save link as an attachment to database
      const newAttachment: Attachment = {
        id: crypto.randomUUID(),
        name: url,
        url: fullUrl,
        type: 'link',
        size: 0,
        uploadedAt: new Date().toISOString()
      };

      saveAttachmentToDb(newAttachment);
    }
  };

  const handleHeaderImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const safeName = file.name.replace(/[^\w.-]/g, '_');
    const path = `headers/${doc.id}_${Date.now()}_${safeName}`;
    const url = await uploadFile(file, path);
    setIsUploading(false);

    if (url) {
      setHeaderImage(url);
      onUpdate({ ...doc, headerImage: url });
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const safeName = file.name.replace(/[^\w.-]/g, '_');
    const path = `attachments/${doc.id}/${Date.now()}_${safeName}`;
    const url = await uploadFile(file, path);
    setIsUploading(false);

    if (url) {
      const newAttachment: Attachment = {
        id: crypto.randomUUID(), // Temporário até salvar no DB
        name: file.name,
        url,
        type: file.type,
        size: file.size,
        uploadedAt: new Date().toISOString()
      };

      saveAttachmentToDb(newAttachment);
    }
  };

  const saveAttachmentToDb = async (attachment: Attachment) => {
    try {
      const { data, error } = await supabase
        .from('doc_attachments')
        .insert({
          doc_id: doc.id,
          name: attachment.name,
          url: attachment.url,
          type: attachment.type,
          size: attachment.size,
          created_by: currentUser.id
        })
        .select()
        .single();

      if (error || !data) {
        console.error('Erro ao salvar anexo:', error);
        toast.error(`Falha ao salvar o anexo${error ? `: ${error.message}` : '.'}`);
        return;
      }

      const savedAttachment: Attachment = {
        ...attachment,
        id: data.id,
        uploadedAt: data.uploaded_at
      };
      onUpdate({
        ...doc,
        attachments: [...(doc.attachments || []), savedAttachment]
      });
    } catch (err: any) {
      console.error('Erro ao salvar anexo:', err);
      toast.error(`Falha ao salvar o anexo${err?.message ? `: ${err.message}` : '.'}`);
    }
  };

  const removeAttachment = async (id: string) => {
    const { data, error } = await supabase
      .from('doc_attachments')
      .delete()
      .eq('id', id)
      .select();

    if (error || !data || data.length === 0) {
      console.error('Erro ao remover anexo:', error);
      toast.error(`Falha ao excluir o anexo${error ? `: ${error.message}` : '.'}`);
      return;
    }

    const url: string = (data[0] as any)?.url || '';
    const match = url.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (match) {
      const storagePath = decodeURIComponent(match[2]);
      const { error: storageError } = await supabase.storage.from(match[1]).remove([storagePath]);
      if (storageError) console.error('Erro ao remover arquivo do Storage:', storageError);
    }

    onUpdate({
      ...doc,
      attachments: (doc.attachments || []).filter(a => a.id !== id)
    });
    toast.success('Anexo excluído.');
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="max-w-4xl mx-auto bg-white min-h-screen shadow-sm border-x flex flex-col mb-10 rounded-b-xl overflow-hidden">
      {/* Header Image */}
      <div className="relative h-56 bg-gray-100 overflow-hidden group">
        {headerImage ? (
          <img src={headerImage} alt="Header" className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gray-300 gap-2">
            <Icons.ImageIcon className="h-10 w-10 opacity-20" />
            <span className="text-sm font-medium">Sem imagem de cabeçalho</span>
          </div>
        )}
        <label className={`absolute bottom-6 right-6 bg-black/60 hover:bg-black/80 text-white text-xs font-bold px-4 py-2 rounded-full backdrop-blur-md transition-all opacity-0 group-hover:opacity-100 shadow-lg flex items-center gap-2 cursor-pointer ${isUploading ? 'opacity-100 animate-pulse' : ''}`}>
          <Icons.ImageIcon className="h-3.5 w-3.5" />
          {isUploading ? 'Enviando...' : (headerImage ? 'Alterar Imagem' : 'Adicionar Imagem')}
          <input type="file" className="hidden" accept="image/*" onChange={handleHeaderImageUpload} disabled={isUploading} />
        </label>
      </div>

      <div className="p-8 sm:p-16 space-y-8">
        {parentDoc && (
          <button
            onClick={() => onSelectDoc?.(parentDoc.id)}
            className="flex items-center gap-1.5 text-xs font-bold text-gray-400 hover:text-orange-500 transition-colors -mb-4"
          >
            <Icons.ChevronRight className="w-3 h-3 rotate-180" /> {parentDoc.title}
          </button>
        )}

        {/* Title + Wiki toggle */}
        <div className="flex items-start justify-between gap-4">
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            placeholder="Título do Documento"
            className="flex-1 text-5xl font-black text-gray-900 border-none focus:ring-0 placeholder:text-gray-100 p-0"
          />
          <button
            onClick={() => onUpdate({ ...doc, isWiki: !doc.isWiki })}
            title={doc.isWiki ? 'Marcado como Wiki — clique para desmarcar' : 'Marcar como Wiki (destaca este documento como fonte oficial)'}
            className={`shrink-0 mt-3 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition-all ${
              doc.isWiki
                ? 'bg-orange-50 border-orange-200 text-orange-600'
                : 'bg-white border-gray-200 text-gray-400 hover:text-gray-600 hover:border-gray-300'
            }`}
          >
            📌 {doc.isWiki ? 'Wiki' : 'Marcar como Wiki'}
          </button>
        </div>

        {/* Toolbar */}
        <div className="flex items-center gap-2 border-y py-3 sticky top-0 bg-white/80 backdrop-blur-sm z-[2]">
          <button
            onClick={handleAddLink}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors flex items-center gap-2 text-sm font-medium"
            title="Adicionar Link"
          >
            <Icons.LinkIcon className="h-4 w-4" />
            <span>Link</span>
          </button>

          <div className="w-px h-4 bg-gray-200 mx-1" />

          <label className={`p-2 hover:bg-gray-100 rounded-lg text-gray-600 transition-colors flex items-center gap-2 text-sm font-medium cursor-pointer ${isUploading ? 'opacity-50 cursor-not-allowed' : ''}`} title="Anexar PDF">
            <Icons.Paperclip className="h-4 w-4" />
            <span>{isUploading ? 'Anexando...' : 'Anexar PDF'}</span>
            <input type="file" className="hidden" accept="application/pdf" onChange={handleFileUpload} disabled={isUploading} />
          </label>

          <div className="w-px h-4 bg-gray-200 mx-2" />

          <button
            onClick={() => document.execCommand('bold')}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 font-bold"
            title="Negrito"
          >
            B
          </button>
          <button
            onClick={() => document.execCommand('italic')}
            className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 italic"
            title="Itálico"
          >
            I
          </button>
        </div>

        {/* Content Area */}
        <div
          ref={contentRef}
          contentEditable
          onBlur={handleContentBlur}
          onPaste={handlePaste}
          onClick={handleContentClick}
          dangerouslySetInnerHTML={{ __html: linkifyHtml(doc.content) }}
          className="w-full min-h-[300px] text-xl text-gray-700 leading-relaxed outline-none prose prose-orange max-w-none focus:prose-orange [&_a]:text-blue-600 [&_a]:underline [&_a]:cursor-pointer hover:[&_a]:text-blue-800"
        />

        {/* Subpáginas */}
        <div className="border-t pt-8 mt-8">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
              <Icons.Folder className="h-4 w-4" />
              Subpáginas ({childDocs.length})
            </h3>
            <button
              onClick={() => onCreateSubpage?.(doc)}
              className="text-xs font-bold text-orange-500 hover:underline"
            >
              + Nova subpágina
            </button>
          </div>
          {childDocs.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {childDocs.map((child) => (
                <button
                  key={child.id}
                  onClick={() => onSelectDoc?.(child.id)}
                  className="text-left group flex items-center gap-3 bg-gray-50 hover:bg-orange-50 border border-gray-100 hover:border-orange-200 rounded-xl p-4 transition-all"
                >
                  <div className="h-9 w-9 shrink-0 rounded-lg bg-white shadow-sm flex items-center justify-center text-orange-500">
                    <Icons.FileText className="h-5 w-5" />
                  </div>
                  <span className="text-sm font-bold text-gray-900 truncate">{child.title}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Attachments Section */}
        {(doc.attachments || []).length > 0 && (
          <div className="border-t pt-8 mt-8">
            <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
              <Icons.Paperclip className="h-4 w-4" />
              Anexos ({doc.attachments.length})
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {doc.attachments.map((file) => (
                <div key={file.id} className="group relative bg-gray-50 hover:bg-orange-50 border border-gray-100 hover:border-orange-200 rounded-xl p-4 transition-all flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-white shadow-sm flex items-center justify-center text-orange-500">
                    <Icons.FileText className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{file.name}</p>
                    <p className="text-[10px] font-medium text-gray-400 uppercase tracking-tight">
                      {file.type.split('/')[1] || 'FILE'} • {formatFileSize(file.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <a
                      href={file.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-orange-600 shadow-sm border border-transparent hover:border-orange-100 transition-all"
                      title="Visualizar"
                    >
                      <Icons.Eye />
                    </a>
                    <button
                      onClick={() => removeAttachment(file.id)}
                      className="p-2 hover:bg-white rounded-lg text-gray-500 hover:text-red-600 shadow-sm border border-transparent hover:border-red-100 transition-all"
                      title="Excluir"
                    >
                      <Icons.Trash />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function SettingsModal({ onClose, themePreset, setThemePreset, uiScale, setUiScale }: any) {
  const themeEntries = Object.entries(THEME_PRESETS) as Array<[ThemePresetId, (typeof THEME_PRESETS)[ThemePresetId]]>;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-card text-card-foreground rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
        <div className="p-4 border-b flex justify-between items-center bg-muted">
          <h3 className="font-bold flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
            Personalização do Sistema
          </h3>
          <button onClick={onClose} className="p-2 hover:bg-accent rounded-full transition-colors" aria-label="Fechar">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Theme presets */}
          <div>
            <label className="block text-sm font-bold mb-3">Tema do Sistema</label>
            <div className="grid grid-cols-2 gap-3">
              {themeEntries.map(([id, t]) => {
                const active = themePreset === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setThemePreset(id)}
                    className={
                      "rounded-lg border p-3 text-left transition-all hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring " +
                      (active ? "border-ring ring-2 ring-ring/30" : "border-border")
                    }
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold truncate">{t.label}</div>
                        <div className="text-xs text-muted-foreground">Fundo + menu + primária</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className="h-5 w-5 rounded-full border"
                          style={{ backgroundColor: `hsl(${t.vars["--sidebar-background"]})`, borderColor: `hsl(${t.vars["--border"]})` }}
                          aria-label="Prévia do menu"
                        />
                        <span
                          className="h-5 w-5 rounded-full border"
                          style={{ backgroundColor: `hsl(${t.vars["--background"]})`, borderColor: `hsl(${t.vars["--border"]})` }}
                          aria-label="Prévia do fundo"
                        />
                        <span
                          className="h-5 w-5 rounded-full border"
                          style={{ backgroundColor: `hsl(${t.vars["--primary"]})`, borderColor: `hsl(${t.vars["--border"]})` }}
                          aria-label="Prévia da cor primária"
                        />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground mt-2">A escolha é salva no seu perfil e sincronizada em todos os seus dispositivos.</p>
          </div>

          {/* Font Size / Scale */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <label className="block text-sm font-bold">Tamanho da Fonte / Escala</label>
              <span className="text-xs font-bold bg-muted px-2 py-1 rounded text-muted-foreground">{Math.round(uiScale * 100)}%</span>
            </div>
            <input
              type="range"
              min="0.8"
              max="1.3"
              step="0.05"
              value={uiScale}
              onChange={(e) => setUiScale(parseFloat(e.target.value))}
              className="w-full h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-[var(--primary-color)]"
            />
            <div className="flex justify-between text-xs text-muted-foreground mt-2 font-medium uppercase">
              <span>Pequeno</span>
              <span>Normal</span>
              <span>Grande</span>
              <span>Extra</span>
            </div>
          </div>
        </div>

        <div className="p-4 bg-muted border-t flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-primary text-primary-foreground font-bold rounded shadow-sm hover:shadow-md transition-all hover:brightness-95"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
}

function SidebarDocItem({ doc, allDocs, depth, activeDocId, folder, onSetActiveDocId, onViewChange, onNavigate, onDeleteDoc }: any) {
  const children = allDocs.filter((d: any) => d.parentId === doc.id);
  const isActive = activeDocId === doc.id;
  return (
    <>
      <div
        className={`text-[12px] flex items-center gap-2 px-2 py-1.5 cursor-pointer rounded transition-colors group relative ${isActive ? 'bg-orange-500/10 text-orange-500 font-semibold' : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => { e.stopPropagation(); onSetActiveDocId(doc.id); onViewChange('Doc'); onNavigate('folder', folder.id, doc.title); }}
      >
        <FileText className="h-3 w-3 text-sidebar-foreground/40 shrink-0" />
        <span className="truncate flex-1">{doc.title}</span>
        {doc.isWiki && <span className="text-[10px] shrink-0" title="Marcado como Wiki">📌</span>}
        <div className="opacity-0 group-hover:opacity-100 transition-opacity absolute right-1">
          <button onClick={(e: any) => { e.stopPropagation(); onDeleteDoc(doc.id); }} className="p-1 text-sidebar-foreground/40 hover:text-red-500"><Icons.Trash /></button>
        </div>
      </div>
      {children.map((child: any) => (
        <SidebarDocItem
          key={child.id}
          doc={child}
          allDocs={allDocs}
          depth={depth + 1}
          activeDocId={activeDocId}
          folder={folder}
          onSetActiveDocId={onSetActiveDocId}
          onViewChange={onViewChange}
          onNavigate={onNavigate}
          onDeleteDoc={onDeleteDoc}
        />
      ))}
    </>
  );
}

function Sidebar({
  themePreset,
  spaces, folders, lists, activeView, activeScope, activeListId, onSetActiveListId, onEnsurePersonalList, onOpenAdminPanel, onNavigate, onViewChange, isCollapsed, onToggle,
  onOpenFields, onOpenCreateSpace, onOpenCreateFolder, onCreateList, userRole,
  onRenameSpace, onDeleteSpace, onRenameFolder, onDeleteFolder, onBulkDeleteFolders,
  onDeleteList, onRenameList, onDuplicateList,
  docs, activeDocId, onSetActiveDocId, onCreateDoc, onDeleteDoc,
  onMoveList, onMoveFolder,
  listTaskCounts, listProgressMap,
  favorites, onToggleFavorite
}: any) {
  const compactLogo = "https://verticalparts.com.br/wp-content/uploads/2026/01/grp__NM__bg__NM__logo_compacto-1.png";
  const isNonLightTheme = themePreset !== "claro";
  const logoSrc = isNonLightTheme ? compactLogoWhite : compactLogo;
  const logoStyle = isNonLightTheme ? undefined : ({ filter: 'brightness(0)' } as React.CSSProperties);
  const canManageStructure = userRole === UserRole.ADMIN || userRole === UserRole.GESTOR;

  const [expandedSpaces, setExpandedSpaces] = useState<string[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [selectedFolderIds, setSelectedFolderIds] = useState<string[]>([]);

  // "Mais" (item 9 do Início, estilo ClickUp): escolher um item no dropdown
  // "fixa" ele na sidebar, substituindo o que estava fixado antes — só o
  // mecanismo de fixar, decidido com o usuário (os destinos reais do
  // ClickUp ali são Chat/Posts/Canais, que o VP Click não tem).
  const [pinnedMoreKey, setPinnedMoreKey] = useState<string | null>(() => localStorage.getItem('vp_pinned_more_item'));
  const [showAllSpacesModal, setShowAllSpacesModal] = useState(false);
  const moreCandidates = [
    {
      key: 'all-spaces',
      label: 'Todos os Espaços',
      icon: <Icons.Layout className="w-3.5 h-3.5 shrink-0" />,
      onSelect: () => setShowAllSpacesModal(true),
      isActive: false,
    },
    {
      // "Todas as tarefas" no ClickUp real não é "toda tarefa do workspace
      // sem filtro" — é a lista de tarefas vistas recentemente (o que a
      // busca/Ctrl+K também mostra). Reaproveita o registro de "recentes" já
      // usado no card Recentes de Minhas Tarefas, numa view dedicada.
      key: 'all-tasks',
      label: 'Todas as tarefas',
      icon: <Icons.List className="w-3.5 h-3.5 shrink-0" />,
      onSelect: () => { onNavigate('global', null, 'Todas as tarefas'); onViewChange('RecentTasks'); },
      isActive: activeView === 'RecentTasks',
    },
    (userRole === 'ADMIN' || userRole === 'GESTOR') && {
      key: 'admin',
      label: 'Painel do Administrador',
      icon: <Icons.Shield className="w-3.5 h-3.5 shrink-0" />,
      onSelect: () => onOpenAdminPanel(),
      isActive: activeView === 'Admin',
    },
  ].filter(Boolean) as { key: string; label: string; icon: React.ReactNode; onSelect: () => void; isActive: boolean }[];
  const pinnedMoreItem = moreCandidates.find((c) => c.key === pinnedMoreKey);

  const selectMoreItem = (key: string) => {
    setPinnedMoreKey(key);
    localStorage.setItem('vp_pinned_more_item', key);
    moreCandidates.find((c) => c.key === key)?.onSelect();
  };

  // "Todos os Espaços" (item "Mais" do Início, estilo ClickUp): espaços
  // ocultos somem da árvore principal, mas continuam existindo — preferência
  // só de cliente, mesmo nível/local de armazenamento já usado em
  // vp_sidebar_width/vp_pinned_more_item/vp_favorites.
  const [hiddenSpaceIds, setHiddenSpaceIds] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('vp_hidden_spaces');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const toggleHiddenSpace = (spaceId: string) => {
    setHiddenSpaceIds((prev) => {
      const next = prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId];
      localStorage.setItem('vp_hidden_spaces', JSON.stringify(next));
      return next;
    });
  };

  const [secInicioOpen, setSecInicioOpen] = useState(true);
  const [secMinhasTarefasOpen, setSecMinhasTarefasOpen] = useState(false);
  const [secFavoritosOpen, setSecFavoritosOpen] = useState(true);
  const [secEspacosOpen, setSecEspacosOpen] = useState(true);

  // Busca na sidebar (filtra espaços, pastas e listas pelo nome)
  const [showSidebarSearch, setShowSidebarSearch] = useState(false);
  const [sidebarSearchQuery, setSidebarSearchQuery] = useState('');
  const sidebarQuery = sidebarSearchQuery.trim().toLowerCase();
  const isSidebarSearching = sidebarQuery.length > 0;
  const listMatchesSearch = (list: List) => list.name.toLowerCase().includes(sidebarQuery);
  const folderMatchesSearch = (folder: Folder) =>
    folder.name.toLowerCase().includes(sidebarQuery) || (lists as List[]).some((l) => l.folderId === folder.id && listMatchesSearch(l));
  const spaceMatchesSearch = (space: Space) =>
    space.name.toLowerCase().includes(sidebarQuery) || (folders as Folder[]).some((f) => f.spaceId === space.id && folderMatchesSearch(f));
  const visibleSpaces = spaces.filter((s: Space) => !hiddenSpaceIds.includes(s.id));
  const filteredSpaces = isSidebarSearching ? visibleSpaces.filter(spaceMatchesSearch) : visibleSpaces;
  const filteredFavorites = (favorites || []).filter((fav: any) => !isSidebarSearching || fav.name.toLowerCase().includes(sidebarQuery));

  // Largura redimensionável da sidebar (arrastar borda direita; duplo clique restaura)
  const SIDEBAR_DEFAULT_W = 240;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('vp_sidebar_width'));
    return saved >= 200 && saved <= 520 ? saved : SIDEBAR_DEFAULT_W;
  });
  const startSidebarResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    let lastW = startW;
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    const onMove = (ev: MouseEvent) => {
      lastW = Math.min(520, Math.max(200, startW + ev.clientX - startX));
      setSidebarWidth(lastW);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      localStorage.setItem('vp_sidebar_width', String(lastW));
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Drag-and-drop state
  const [dragItem, setDragItem] = useState<{ type: 'list' | 'folder'; id: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{ type: 'folder' | 'space'; id: string } | null>(null);

  useEffect(() => {
    if (activeScope.type === 'space' && activeScope.id) {
      setExpandedSpaces(prev => prev.includes(activeScope.id!) ? prev : [...prev, activeScope.id!]);
    } else if (activeScope.type === 'folder' && activeScope.id) {
      const folder = folders.find((f: Folder) => f.id === activeScope.id);
      if (folder && !expandedSpaces.includes(folder.spaceId)) {
        setExpandedSpaces(prev => [...prev, folder.spaceId]);
      }
      if (folder && !expandedFolders.includes(folder.id)) {
        setExpandedFolders(prev => [...prev, folder.id]);
      }
    }
  }, [activeScope, folders]);

  const toggleSpace = (spaceId: string) => setExpandedSpaces(prev => prev.includes(spaceId) ? prev.filter(id => id !== spaceId) : [...prev, spaceId]);
  const toggleFolder = (folderId: string) => setExpandedFolders(prev => prev.includes(folderId) ? prev.filter(id => id !== folderId) : [...prev, folderId]);

  /* ── Icon Nav Bar items ── */
  const navItems = [
    { id: 'home', label: 'Início', icon: <Icons.Home />, action: () => { if (isCollapsed) onToggle(); onNavigate('global', null, 'Dashboard'); onViewChange('Dashboard'); }, active: activeView === 'Dashboard' && activeScope.type === 'global' },
    { id: 'tasks', label: 'Minhas Tarefas', icon: <Icons.Check />, action: () => { if (isCollapsed) onToggle(); onNavigate('global', null, 'Minhas Tarefas'); onViewChange('MyTasks'); }, active: activeView === 'MyTasks' && activeScope.type === 'global' },
    { id: 'calendar', label: 'Calendário', icon: <Icons.Calendar />, action: () => { if (isCollapsed) onToggle(); onViewChange('Calendar'); }, active: activeView === 'Calendar' },
    { id: 'gantt', label: 'Gantt', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 16 16"><rect x="1" y="3" width="8" height="2" rx="1"/><rect x="1" y="7" width="6" height="2" rx="1"/><rect x="4" y="11" width="10" height="2" rx="1"/></svg>, action: () => { if (isCollapsed) onToggle(); onViewChange('Gantt'); }, active: activeView === 'Gantt' },
    { id: 'dashboard', label: 'Dashboards', icon: <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 16 16"><rect x="1" y="8" width="4" height="6" rx="0.5"/><rect x="6" y="4" width="4" height="10" rx="0.5"/><rect x="11" y="2" width="4" height="12" rx="0.5"/></svg>, action: () => { if (isCollapsed) onToggle(); onNavigate('global', null, 'Dashboard'); onViewChange('Dashboard'); }, active: false },
  ];

  return (
    <div className="flex h-full shrink-0" onClick={(e) => e.stopPropagation()}>

      {/* ══ ICON NAV BAR (sempre visível, 48px) ══ */}
      <div className="w-12 flex flex-col items-center bg-sidebar border-r border-sidebar-border shrink-0 py-2 gap-0.5">
        {/* Logo */}
        <div className="mb-2 mt-1">
          <img src={logoSrc} alt="VP" className="w-7 h-7 object-contain" style={logoStyle} />
        </div>

        {/* Nav icons */}
        {navItems.map(item => (
          <button
            key={item.id}
            onClick={item.action}
            title={item.label}
            aria-label={`Ir para ${item.label}`}
            aria-current={item.active ? 'page' : undefined}
            className={`w-9 h-9 flex items-center justify-center rounded-lg transition-colors ${
              item.active
                ? 'bg-sidebar-accent text-primary'
                : 'text-sidebar-foreground/50 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
            }`}
          >
            {item.icon}
          </button>
        ))}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Space quick-access avatars */}
        {visibleSpaces.slice(0, 6).map((space: Space) => (
          <button
            key={space.id}
            title={space.name}
            onClick={() => { if (isCollapsed) onToggle(); onNavigate('space', space.id, space.name); }}
            className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] text-white mb-0.5 transition-all ${
              activeScope.type === 'space' && activeScope.id === space.id ? 'ring-2 ring-primary ring-offset-1' : 'opacity-80 hover:opacity-100'
            }`}
            style={{ backgroundColor: space.color || '#6366f1' }}
          >
            {space.name.charAt(0).toUpperCase()}
          </button>
        ))}

        {/* Fields / Settings */}
        {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
          <button
            onClick={onOpenFields}
            title="Campos Personalizados"
            className="w-9 h-9 flex items-center justify-center rounded-lg text-sidebar-foreground/40 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors mt-1 mb-1"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 16 16"><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M3.22 12.78l1.42-1.42M11.36 4.64l1.42-1.42"/><circle cx="8" cy="8" r="3"/></svg>
          </button>
        )}

        {/* Collapse toggle */}
        <button
          onClick={onToggle}
          title={isCollapsed ? 'Expandir sidebar' : 'Recolher sidebar'}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-sidebar-foreground/40 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors mb-1"
        >
          {isCollapsed ? (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M6 4l4 4-4 4"/></svg>
          ) : (
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M10 4l-4 4 4 4"/></svg>
          )}
        </button>
      </div>

      {/* ══ EXPANDED PANEL (colapsável) ══ */}
      {!isCollapsed && (
        <div style={{ width: sidebarWidth }} className="relative shrink-0 flex flex-col bg-sidebar border-r border-sidebar-border text-sidebar-foreground">
          {/* Alça de redimensionamento (segurar e arrastar; duplo clique restaura) */}
          <div
            onMouseDown={startSidebarResize}
            onDoubleClick={() => {
              setSidebarWidth(SIDEBAR_DEFAULT_W);
              localStorage.setItem('vp_sidebar_width', String(SIDEBAR_DEFAULT_W));
            }}
            title="Arraste para redimensionar · duplo clique restaura"
            className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize z-20 hover:bg-orange-400/50 active:bg-orange-500/60 transition-colors"
          />

          {/* Header */}
          <div className="flex items-center gap-1 px-2 py-2 border-b border-sidebar-border">
            {showSidebarSearch ? (
              <div className="relative flex-1">
                <svg className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-sidebar-foreground/40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
                <input
                  type="text"
                  autoFocus
                  value={sidebarSearchQuery}
                  onChange={(e) => setSidebarSearchQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') { setShowSidebarSearch(false); setSidebarSearchQuery(''); } }}
                  placeholder="Buscar espaços, pastas ou listas..."
                  className="w-full pl-6 pr-2 py-1 text-xs bg-sidebar-accent/40 border border-sidebar-border rounded focus:outline-none focus:ring-1 focus:ring-primary text-sidebar-foreground placeholder:text-sidebar-foreground/40"
                />
              </div>
            ) : (
              <span className="text-sm font-semibold text-sidebar-foreground flex-1 truncate px-1">Início</span>
            )}
            <button
              title={showSidebarSearch ? 'Fechar busca' : 'Pesquisar'}
              onClick={() => setShowSidebarSearch(v => { if (v) setSidebarSearchQuery(''); return !v; })}
              className={`p-1.5 rounded hover:bg-sidebar-accent transition-colors ${showSidebarSearch ? 'text-primary' : 'text-sidebar-foreground/50 hover:text-sidebar-foreground'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><circle cx="7" cy="7" r="4.5"/><path d="M11 11l3 3"/></svg>
            </button>
            <button title="Criar tarefa" onClick={() => { }} className="p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors">
              <Icons.Plus />
            </button>
            <button onClick={onToggle} title="Fechar barra lateral" className="p-1.5 rounded hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 16 16"><path d="M10 4l-4 4 4 4"/></svg>
            </button>
          </div>

          {/* Scrollable content */}
          <nav className="flex-1 overflow-y-auto custom-scrollbar overflow-x-hidden">

            {/* ── Seção Início ── */}
            <div>
              <button
                className="w-full flex items-center gap-1 px-3 py-2 text-[11px] font-semibold text-sidebar-foreground/60 uppercase tracking-widest hover:text-sidebar-foreground transition-colors group"
                onClick={() => setSecInicioOpen(v => !v)}
              >
                <svg className={`w-3 h-3 transition-transform shrink-0 ${secInicioOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 8 8"><path d="M2 1l4 3-4 3"/></svg>
                Início
              </button>
              {secInicioOpen && (
                <div className="pb-1">
                  {/* Caixa de entrada */}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${activeView === 'Inbox' && activeScope.type === 'global' ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                    onClick={() => { onNavigate('global', null, 'Caixa de entrada'); onViewChange('Inbox'); }}
                  >
                    <div className="w-3 h-3 shrink-0" />
                    <Icons.Bell />
                    <span className="flex-1 truncate">Caixa de entrada</span>
                  </div>

                  {/* Respostas */}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${activeView === 'Replies' && activeScope.type === 'global' ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                    onClick={() => { onNavigate('global', null, 'Respostas'); onViewChange('Replies'); }}
                  >
                    <div className="w-3 h-3 shrink-0" />
                    <Icons.Reply />
                    <span className="flex-1 truncate">Respostas</span>
                  </div>

                  {/* Comentários atribuídos */}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${activeView === 'AssignedComments' && activeScope.type === 'global' ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                    onClick={() => { onNavigate('global', null, 'Comentários atribuídos'); onViewChange('AssignedComments'); }}
                  >
                    <div className="w-3 h-3 shrink-0" />
                    <Icons.UserCheck />
                    <span className="flex-1 truncate">Comentários atribuídos</span>
                  </div>

                  {/* Reuniões */}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${activeView === 'Meetings' && activeScope.type === 'global' ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                    onClick={() => { onNavigate('global', null, 'Reuniões'); onViewChange('Meetings'); }}
                  >
                    <div className="w-3 h-3 shrink-0" />
                    <Icons.Video />
                    <span className="flex-1 truncate">Reuniões</span>
                  </div>

                  {/* Minhas Tarefas (expandível) */}
                  <div>
                    <div
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${activeView === 'MyTasks' && activeScope.type === 'global' ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                      onClick={() => { onNavigate('global', null, 'Minhas Tarefas'); onViewChange('MyTasks'); }}
                    >
                      <button
                        onClick={(e) => { e.stopPropagation(); setSecMinhasTarefasOpen(v => !v); }}
                        aria-label={secMinhasTarefasOpen ? 'Recolher Minhas Tarefas' : 'Expandir Minhas Tarefas'}
                        aria-expanded={secMinhasTarefasOpen}
                        className="text-sidebar-foreground/40 hover:text-sidebar-foreground shrink-0"
                      >
                        <svg className={`w-3 h-3 transition-transform ${secMinhasTarefasOpen ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 8 8"><path d="M2 1l4 3-4 3"/></svg>
                      </button>
                      <Icons.Check />
                      <span className="flex-1 truncate">Minhas Tarefas</span>
                    </div>
                    {secMinhasTarefasOpen && (
                      <div className="ml-7 border-l border-sidebar-border pl-2 mt-0.5 space-y-0.5">
                        <button
                          onClick={() => { onNavigate('global', null, 'Minhas Tarefas'); onViewChange('List'); }}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${activeView === 'List' && activeScope.name === 'Minhas Tarefas' && !lists.find((l: List) => l.id === activeListId)?.ownerId ? 'bg-sidebar-accent text-sidebar-foreground font-semibold' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                        >
                          <svg className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/40" fill="currentColor" viewBox="0 0 14 14"><circle cx="7" cy="7" r="5"/></svg>
                          Atribuídas a mim
                        </button>
                        <button
                          onClick={() => { onNavigate('global', null, 'Hoje e atrasadas'); onViewChange('Reminders'); }}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${activeView === 'Reminders' ? 'bg-sidebar-accent text-sidebar-foreground font-semibold' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                        >
                          <Icons.Calendar />
                          Hoje e atrasadas
                        </button>
                        <button
                          onClick={async () => {
                            // onNavigate reseta activeListId pra null e troca o nome do escopo —
                            // por isso vem ANTES de aplicar o id da lista pessoal de verdade.
                            // Sem isso, o escopo ficava "grudado" em 'Minhas Tarefas' (deixado por
                            // um clique anterior em "Atribuídas a mim"), vazando o filtro de
                            // "Mostrar concluídas" pra dentro da lista pessoal.
                            onNavigate('global', null, 'Lista pessoal');
                            const listId = await onEnsurePersonalList();
                            if (listId) { onSetActiveListId(listId); onViewChange('List'); }
                          }}
                          className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded text-[12px] transition-colors ${activeView === 'List' && lists.find((l: List) => l.id === activeListId)?.ownerId ? 'bg-sidebar-accent text-sidebar-foreground font-semibold' : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground'}`}
                        >
                          <Icons.List className="w-3.5 h-3.5 shrink-0" />
                          Lista pessoal
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Item fixado via "Mais" */}
                  {pinnedMoreItem && (
                    <div
                      className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${pinnedMoreItem.isActive ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                      onClick={pinnedMoreItem.onSelect}
                    >
                      <div className="w-3 h-3 shrink-0" />
                      {pinnedMoreItem.icon}
                      <span className="flex-1 truncate">{pinnedMoreItem.label}</span>
                    </div>
                  )}

                  {/* "Mais": escolher um item aqui fixa ele acima, substituindo o anterior */}
                  {moreCandidates.length > 0 && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button type="button" className="flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 text-sidebar-foreground/60 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-colors text-sm">
                          <div className="w-3 h-3 shrink-0" />
                          <span className="text-sm leading-none tracking-wider">•••</span>
                          <span className="flex-1 truncate">Mais</span>
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-56">
                        {moreCandidates.map((c) => (
                          <DropdownMenuItem key={c.key} onClick={() => selectMoreItem(c.key)} className="flex items-center gap-2 text-sm">
                            {c.icon}
                            {c.label}
                            {pinnedMoreKey === c.key && <Icons.Check className="w-3.5 h-3.5 ml-auto text-orange-500" />}
                          </DropdownMenuItem>
                        ))}
                        {(userRole === 'ADMIN' || userRole === 'GESTOR') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={onOpenFields} className="flex items-center gap-2 text-sm">
                              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 16 16"><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M3.22 12.78l1.42-1.42M11.36 4.64l1.42-1.42"/><circle cx="8" cy="8" r="3"/></svg>
                              Personalizar
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

                  {showAllSpacesModal && (
                    <AllSpacesModal
                      spaces={spaces}
                      hiddenSpaceIds={hiddenSpaceIds}
                      onToggleHidden={toggleHiddenSpace}
                      onCreateSpace={onOpenCreateSpace}
                      canCreateSpace={canManageStructure}
                      onNavigateToSpace={(id: string, name: string) => { onNavigate('space', id, name); onViewChange('Dashboard'); }}
                      onClose={() => setShowAllSpacesModal(false)}
                    />
                  )}

                  {/* Ir para Dashboard */}
                  <div
                    className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors text-sm ${activeView === 'Dashboard' && activeScope.type === 'global' ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
                    onClick={() => { onNavigate('global', null, 'Dashboard'); onViewChange('Dashboard'); }}
                  >
                    <div className="w-3 h-3 shrink-0" />
                    <Icons.Home />
                    <span className="flex-1 truncate">Dashboard</span>
                  </div>
                </div>
              )}
            </div>

            {/* ── Seção Favoritos ── */}
            <div>
              <button
                className="w-full flex items-center gap-1 px-3 py-2 text-[11px] font-semibold text-sidebar-foreground/60 uppercase tracking-widest hover:text-sidebar-foreground transition-colors group"
                onClick={() => setSecFavoritosOpen(v => !v)}
              >
                <svg className={`w-3 h-3 transition-transform shrink-0 ${secFavoritosOpen || isSidebarSearching ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 8 8"><path d="M2 1l4 3-4 3"/></svg>
                Favoritos
              </button>
              {(secFavoritosOpen || isSidebarSearching) && (
                <div className="pb-1">
                  {favorites && favorites.length === 0 && !isSidebarSearching && (
                    <p className="text-[11px] text-sidebar-foreground/40 flex items-center gap-1.5 px-4 py-2">
                      <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 14 14"><path d="M7 1l1.5 4h4l-3.3 2.4 1.3 4L7 9l-3.5 2.4 1.3-4L1.5 5h4z"/></svg>
                      Passe o mouse sobre uma lista ou pasta e clique ★
                    </p>
                  )}
                  {isSidebarSearching && filteredFavorites.length === 0 && favorites && favorites.length > 0 && (
                    <p className="text-[11px] text-sidebar-foreground/40 px-4 py-2">Nenhum favorito encontrado</p>
                  )}
                  {filteredFavorites.map((fav: any) => {
                    const isActiveList = fav.type === 'list' && activeListId === fav.id;
                    const isActiveFolder = fav.type === 'folder' && activeScope.type === 'folder' && activeScope.id === fav.id;
                    const isActiveSpace = fav.type === 'space' && activeScope.type === 'space' && activeScope.id === fav.id;
                    const isActive = isActiveList || isActiveFolder || isActiveSpace;
                    return (
                      <div
                        key={`${fav.type}-${fav.id}`}
                        className={`text-[12px] flex items-center gap-2 px-3 py-1.5 cursor-pointer rounded-lg mx-1 group transition-colors ${isActive ? 'bg-sidebar-accent text-primary font-semibold' : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'}`}
                        onClick={() => {
                          if (fav.type === 'list') { onSetActiveListId?.(fav.id); setTimeout(() => onViewChange?.('List'), 0); }
                          else if (fav.type === 'folder') { onNavigate('folder', fav.id, fav.name); }
                          else if (fav.type === 'space') { onNavigate('space', fav.id, fav.name); }
                        }}
                      >
                        {fav.type === 'list' ? <Icons.List /> : fav.type === 'folder' ? <Icons.Folder /> : <Icons.Layout />}
                        <span className="truncate flex-1">{fav.name}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(fav.type, fav.id, fav.name); }}
                          className="opacity-0 group-hover:opacity-100 text-yellow-400 transition-opacity"
                          title="Remover dos favoritos"
                        >
                          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 14 14"><path d="M7 1l1.5 4h4l-3.3 2.4 1.3 4L7 9l-3.5 2.4 1.3-4L1.5 5h4z"/></svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* ── Seção Espaços ── */}
            <div>
              <div className="flex items-center px-3 py-2 group">
                <button
                  className="flex items-center gap-1 text-[11px] font-semibold text-sidebar-foreground/60 uppercase tracking-widest hover:text-sidebar-foreground transition-colors flex-1 text-left"
                  onClick={() => setSecEspacosOpen(v => !v)}
                >
                  <svg className={`w-3 h-3 transition-transform shrink-0 ${secEspacosOpen || isSidebarSearching ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 8 8"><path d="M2 1l4 3-4 3"/></svg>
                  Espaços
                </button>
                {canManageStructure && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOpenCreateSpace(); }}
                    className="opacity-0 group-hover:opacity-100 text-sidebar-foreground/40 hover:text-primary transition-all p-1 rounded hover:bg-sidebar-accent"
                    title="Criar Espaço"
                  >
                    <Icons.Plus />
                  </button>
                )}
              </div>

              {(secEspacosOpen || isSidebarSearching) && (
                <div className="pb-2">
                  {isSidebarSearching && filteredSpaces.length === 0 && (
                    <p className="text-[11px] text-sidebar-foreground/40 px-4 py-2">Nenhum espaço, pasta ou lista encontrado para "{sidebarSearchQuery}"</p>
                  )}
                  {filteredSpaces.map((space: Space) => {
                    const isExpanded = isSidebarSearching ? true : expandedSpaces.includes(space.id);
                    const isSpaceDropTarget = dropTarget?.type === 'space' && dropTarget.id === space.id && dragItem?.type === 'folder';
                    return (
                      <div key={space.id} className="mb-0.5">
                        <div
                          className={`flex items-center gap-2 px-3 py-1.5 cursor-pointer group transition-colors relative rounded-lg mx-1 ${
                            isSpaceDropTarget
                              ? 'bg-primary/15 border border-primary/40 border-dashed'
                              : activeScope.type === 'space' && activeScope.id === space.id
                              ? 'bg-sidebar-accent'
                              : 'hover:bg-sidebar-accent/50'
                          }`}
                          onClick={() => {
                            const isActiveSpace = activeScope.type === 'space' && activeScope.id === space.id;
                            toggleSpace(space.id);
                            if (!isActiveSpace) onNavigate('space', space.id, space.name);
                          }}
                          onDragOver={(e) => {
                            if (dragItem?.type === 'folder') {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = 'move';
                              setDropTarget({ type: 'space', id: space.id });
                            }
                          }}
                          onDragLeave={() => setDropTarget(null)}
                          onDrop={(e) => {
                            e.preventDefault();
                            if (dragItem?.type === 'folder') {
                              onMoveFolder?.(dragItem.id, space.id);
                            }
                            setDragItem(null);
                            setDropTarget(null);
                          }}
                        >
                          <div className={`text-sidebar-foreground/40 transition-transform duration-200 shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                            <Icons.ChevronRight />
                          </div>
                          {space.icon ? (
                            (() => { const IconComponent = (Icons as any)[space.icon] || Icons.Layout; return <IconComponent className="w-4 h-4 shrink-0" color={space.color} />; })()
                          ) : (
                            <div className="w-4 h-4 rounded flex items-center justify-center shrink-0 font-bold text-[9px] text-white" style={{ backgroundColor: space.color }}>
                              {space.name.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <span className={`text-[13px] font-medium whitespace-nowrap overflow-hidden text-ellipsis flex-1 ${activeScope.type === 'space' && activeScope.id === space.id ? 'text-sidebar-foreground font-semibold' : 'text-sidebar-foreground/80'}`}>
                            {space.name}
                          </span>

                          {/* Space hover actions — só ADMIN/GESTOR (casa com a RLS is_manager) */}
                          {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 bg-sidebar/90 rounded px-0.5">
                            <button onClick={(e) => { e.stopPropagation(); onOpenCreateFolder(space.id); }} className="p-1 text-sidebar-foreground/40 hover:text-primary rounded" title="Criar pasta"><Icons.Plus /></button>
                            <button onClick={(e) => { e.stopPropagation(); onRenameSpace(space.id, space.name); }} className="p-1 text-sidebar-foreground/40 hover:text-blue-500 rounded" title="Renomear">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); onDeleteSpace(space.id); }} className="p-1 text-sidebar-foreground/40 hover:text-red-500 rounded" title="Excluir">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                            </button>
                          </div>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="ml-5 border-l border-sidebar-border pl-2 mt-0.5 space-y-0.5 animate-in slide-in-from-top-1 duration-150">
                            {selectedFolderIds.length > 0 && (
                              <div className="flex items-center justify-between px-2 py-1.5 mb-1 bg-red-50 border border-red-200 rounded text-xs">
                                <span className="text-red-600 font-medium">{selectedFolderIds.length} pasta(s) selecionada(s)</span>
                                <div className="flex gap-2">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); setSelectedFolderIds([]); }}
                                    className="text-gray-500 hover:text-gray-700 font-medium"
                                  >
                                    Cancelar
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onBulkDeleteFolders(selectedFolderIds, () => setSelectedFolderIds([]));
                                    }}
                                    className="text-red-600 hover:text-red-700 font-bold"
                                  >
                                    Excluir todas
                                  </button>
                                </div>
                              </div>
                            )}
                            {folders.filter((f: Folder) => f.spaceId === space.id && (!isSidebarSearching || folderMatchesSearch(f))).map((folder: Folder) => {
                              const isFolderExpanded = isSidebarSearching ? true : expandedFolders.includes(folder.id);
                              return (
                                <div key={folder.id}>
                                  <div
                                    draggable
                                    onDragStart={(e) => {
                                      e.stopPropagation();
                                      setDragItem({ type: 'folder', id: folder.id });
                                      e.dataTransfer.effectAllowed = 'move';
                                      e.dataTransfer.setData('text/plain', folder.id);
                                    }}
                                    onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
                                    onDragOver={(e) => {
                                      if (dragItem?.type === 'list') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.dataTransfer.dropEffect = 'move';
                                        setDropTarget({ type: 'folder', id: folder.id });
                                      }
                                    }}
                                    onDragLeave={(e) => {
                                      if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                        setDropTarget(null);
                                      }
                                    }}
                                    onDrop={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      if (dragItem?.type === 'list') {
                                        onMoveList?.(dragItem.id, folder.id);
                                        if (!expandedFolders.includes(folder.id)) toggleFolder(folder.id);
                                      }
                                      setDragItem(null);
                                      setDropTarget(null);
                                    }}
                                    className={`text-[12px] flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing rounded transition-colors group relative ${
                                      dropTarget?.type === 'folder' && dropTarget.id === folder.id && dragItem?.type === 'list'
                                        ? 'bg-primary/15 border border-primary/40 border-dashed'
                                        : activeScope.type === 'folder' && activeScope.id === folder.id
                                        ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                                        : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                                    }`}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const isActiveFolder = activeScope.type === 'folder' && activeScope.id === folder.id;
                                      toggleFolder(folder.id);
                                      if (!isActiveFolder) onNavigate('folder', folder.id, folder.name);
                                    }}
                                  >
                                    <input
                                      type="checkbox"
                                      className="w-3 h-3 rounded shrink-0 accent-orange-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                      style={selectedFolderIds.length > 0 ? { opacity: 1 } : {}}
                                      checked={selectedFolderIds.includes(folder.id)}
                                      onChange={(e) => {
                                        e.stopPropagation();
                                        setSelectedFolderIds(prev =>
                                          e.target.checked ? [...prev, folder.id] : prev.filter(id => id !== folder.id)
                                        );
                                      }}
                                      onClick={(e) => e.stopPropagation()}
                                    />
                                    <div className={`text-sidebar-foreground/40 transition-transform duration-200 shrink-0 ${isFolderExpanded ? 'rotate-90' : ''}`} aria-hidden>
                                      <Icons.ChevronRight />
                                    </div>
                                    <Icons.Folder />
                                    <span className="truncate flex-1">{folder.name}</span>
                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-sidebar/90 rounded px-0.5 absolute right-1">
                                      {/* Star: favorites */}
                                      <button
                                        onClick={(e) => { e.stopPropagation(); onToggleFavorite?.('folder', folder.id, folder.name); }}
                                        className={`p-1 transition-colors ${favorites?.some((f: any) => f.type === 'folder' && f.id === folder.id) ? 'text-yellow-400' : 'text-sidebar-foreground/40 hover:text-yellow-400'}`}
                                        title="Favoritar"
                                      >
                                        <svg className="w-3 h-3" fill={favorites?.some((f: any) => f.type === 'folder' && f.id === folder.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} viewBox="0 0 14 14"><path d="M7 1l1.5 4h4l-3.3 2.4 1.3 4L7 9l-3.5 2.4 1.3-4L1.5 5h4z"/></svg>
                                      </button>
                                      <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                          <button onClick={(e) => e.stopPropagation()} className="p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground" title="Ações">
                                            <MoreHorizontal className="h-3 w-3" />
                                          </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" sideOffset={6}>
                                          <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onToggleFavorite?.('folder', folder.id, folder.name); }}>
                                            {favorites?.some((f: any) => f.type === 'folder' && f.id === folder.id) ? '★ Remover dos favoritos' : '☆ Adicionar aos favoritos'}
                                          </DropdownMenuItem>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuSub>
                                            <DropdownMenuSubTrigger className="text-xs">Criar novo</DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent>
                                              {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
                                                <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onCreateList?.(folder.id); }}><ListPlus className="mr-2 h-3.5 w-3.5" />Criar lista</DropdownMenuItem>
                                              )}
                                              <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onCreateDoc(folder.id); }}><FileText className="mr-2 h-3.5 w-3.5" />Novo documento</DropdownMenuItem>
                                            </DropdownMenuSubContent>
                                          </DropdownMenuSub>
                                          {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (<>
                                          <DropdownMenuSeparator />
                                          <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onRenameFolder(folder.id, folder.name); }}>Renomear pasta</DropdownMenuItem>
                                          <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onDeleteFolder(folder.id); }}>Excluir pasta</DropdownMenuItem>
                                          </>)}
                                        </DropdownMenuContent>
                                      </DropdownMenu>
                                    </div>
                                  </div>

                                  {isFolderExpanded && (
                                    <div className="ml-5 mt-0.5 space-y-0.5 border-l border-sidebar-border pl-2">
                                      {(lists as List[]).filter((l) => l.folderId === folder.id && (!isSidebarSearching || listMatchesSearch(l))).map((list: List) => {
                                        const isActive = activeListId === list.id;
                                        return (
                                          <div
                                            key={list.id}
                                            draggable
                                            onDragStart={(e) => {
                                              e.stopPropagation();
                                              setDragItem({ type: 'list', id: list.id });
                                              e.dataTransfer.effectAllowed = 'move';
                                              e.dataTransfer.setData('text/plain', list.id);
                                            }}
                                            onDragEnd={() => { setDragItem(null); setDropTarget(null); }}
                                            className={`text-[12px] flex items-center gap-2 px-2 py-1.5 cursor-grab active:cursor-grabbing rounded transition-colors group relative ${
                                              dragItem?.type === 'list' && dragItem.id === list.id
                                                ? 'opacity-40 scale-95'
                                                : isActive
                                                ? 'bg-sidebar-accent text-sidebar-accent-foreground font-semibold'
                                                : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50'
                                            }`}
                                            onClick={(e) => { e.stopPropagation(); onSetActiveListId?.(list.id); setTimeout(() => onViewChange?.('List'), 0); }}
                                            title={list.name}
                                          >
                                            <Icons.List />
                                            <span className="truncate flex-1">{list.name}</span>
                                            {/* Badge: open task count */}
                                            {listTaskCounts?.get(list.id) ? (
                                              <span className="text-[10px] font-medium text-sidebar-foreground/50 bg-sidebar-accent/70 rounded px-1 min-w-[16px] text-center group-hover:hidden shrink-0">
                                                {listTaskCounts.get(list.id)}
                                              </span>
                                            ) : null}
                                            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-sidebar/90 rounded px-0.5 absolute right-1">
                                              {/* Star: favorites */}
                                              <button
                                                onClick={(e) => { e.stopPropagation(); onToggleFavorite?.('list', list.id, list.name); }}
                                                className={`p-1 transition-colors ${favorites?.some((f: any) => f.type === 'list' && f.id === list.id) ? 'text-yellow-400' : 'text-sidebar-foreground/40 hover:text-yellow-400'}`}
                                                title="Favoritar"
                                              >
                                                <svg className="w-3 h-3" fill={favorites?.some((f: any) => f.type === 'list' && f.id === list.id) ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.5} viewBox="0 0 14 14"><path d="M7 1l1.5 4h4l-3.3 2.4 1.3 4L7 9l-3.5 2.4 1.3-4L1.5 5h4z"/></svg>
                                              </button>
                                              <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                  <button onClick={(e) => e.stopPropagation()} className="p-1 text-sidebar-foreground/40 hover:text-sidebar-foreground"><MoreHorizontal className="h-3 w-3" /></button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" sideOffset={6}>
                                                  <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onToggleFavorite?.('list', list.id, list.name); }}>
                                                    {favorites?.some((f: any) => f.type === 'list' && f.id === list.id) ? '★ Remover dos favoritos' : '☆ Adicionar aos favoritos'}
                                                  </DropdownMenuItem>
                                                  {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (<>
                                                  <DropdownMenuSeparator />
                                                  <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onRenameList(list.id, list.name); }}>Renomear lista</DropdownMenuItem>
                                                  <DropdownMenuSub>
                                                    <DropdownMenuSubTrigger className="text-xs">Mover para</DropdownMenuSubTrigger>
                                                    <DropdownMenuSubContent>
                                                      {(folders as any[]).filter((f: any) => f.id !== list.folderId).map((f: any) => (
                                                        <DropdownMenuItem key={f.id} className="text-xs" onClick={(e) => { e.stopPropagation(); onMoveList?.(list.id, f.id); }}>
                                                          {f.name}
                                                        </DropdownMenuItem>
                                                      ))}
                                                      {(folders as any[]).filter((f: any) => f.id !== list.folderId).length === 0 && (
                                                        <DropdownMenuItem className="text-xs text-gray-400" disabled>Nenhuma outra pasta</DropdownMenuItem>
                                                      )}
                                                    </DropdownMenuSubContent>
                                                  </DropdownMenuSub>
                                                  <DropdownMenuItem className="text-xs" onClick={(e) => { e.stopPropagation(); onDuplicateList?.(list.id, list.name); }}>Duplicar projeto</DropdownMenuItem>
                                                  <DropdownMenuItem className="text-xs text-red-600 focus:text-red-600" onClick={(e) => { e.stopPropagation(); onDeleteList(list.id); }}>Excluir lista</DropdownMenuItem>
                                                  </>)}
                                                </DropdownMenuContent>
                                              </DropdownMenu>
                                            </div>
                                          </div>
                                        );
                                      })}

                                      {docs.filter((d: any) => d.folderId === folder.id && !d.parentId).map((doc: any) => (
                                        <SidebarDocItem
                                          key={doc.id}
                                          doc={doc}
                                          allDocs={docs}
                                          depth={0}
                                          activeDocId={activeDocId}
                                          folder={folder}
                                          onSetActiveDocId={onSetActiveDocId}
                                          onViewChange={onViewChange}
                                          onNavigate={onNavigate}
                                          onDeleteDoc={onDeleteDoc}
                                        />
                                      ))}

                                      {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
                                        <button
                                          onClick={(e) => { e.stopPropagation(); onCreateList?.(folder.id); }}
                                          className="w-full text-left text-[11px] text-sidebar-foreground/40 hover:text-primary flex items-center gap-1.5 px-2 py-1 rounded hover:bg-sidebar-accent/50 transition-colors"
                                        >
                                          <Icons.Plus /> Nova Lista
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                            {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
                              <button
                                onClick={(e) => { e.stopPropagation(); onOpenCreateFolder(space.id); }}
                                className="w-full text-left text-[11px] text-sidebar-foreground/40 hover:text-primary flex items-center gap-1.5 px-2 py-1 rounded hover:bg-sidebar-accent/50 transition-colors"
                              >
                                <Icons.Plus /> Nova Pasta
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
                    <button
                      onClick={(e) => { e.stopPropagation(); onOpenCreateSpace(); }}
                      className="w-full text-left text-[11px] text-sidebar-foreground/40 hover:text-primary flex items-center gap-1.5 px-4 py-1.5 rounded hover:bg-sidebar-accent/50 transition-colors mt-1"
                    >
                      <Icons.Plus /> Novo Espaço
                    </button>
                  )}
                </div>
              )}
            </div>
          </nav>

          {/* Footer */}
          <div className="border-t border-sidebar-border">
            {(userRole === UserRole.ADMIN || userRole === UserRole.GESTOR) && (
              <button
                onClick={onOpenFields}
                className="w-full flex items-center gap-2 px-3 py-2.5 text-[12px] text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
              >
                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 16 16"><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.22 3.22l1.42 1.42M11.36 11.36l1.42 1.42M3.22 12.78l1.42-1.42M11.36 4.64l1.42-1.42"/><circle cx="8" cy="8" r="3"/></svg>
                Personalizar a barra lateral
              </button>
            )}
            {formatBuildTimeShort(__APP_BUILD_TIME__) && (
              <div className="text-[10px] text-sidebar-foreground/30 text-center py-1.5">
                Última atualização: {formatBuildTimeShort(__APP_BUILD_TIME__)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SidebarItem({ icon, label, isCollapsed, active, onClick }: any) {
  return (
    <div
      onClick={onClick}
      className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all group ${isCollapsed ? 'justify-center' : ''} ${active ? 'bg-sidebar-accent text-primary' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/50'}`}
      title={isCollapsed ? label : ''}
    >
      <div className={`${active ? 'text-primary' : 'text-sidebar-foreground/40'} group-hover:text-primary transition-colors shrink-0`}>{icon}</div>
      {!isCollapsed && <span className="text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis">{label}</span>}
    </div>
  );
}

function ViewTab({ active, onClick, label }: any) {
  return (
    <button
      onClick={onClick}
      aria-label={`Visualização ${label}`}
      aria-current={active ? 'page' : undefined}
      className={`px-3 py-3 text-sm font-medium transition-all relative whitespace-nowrap ${active ? 'text-[var(--primary-color)]' : 'text-gray-500 hover:text-gray-900'
        }`}
    >
      {label}
      {active && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-[var(--primary-color)] animate-in fade-in duration-200" />}
    </button>
  );
}

/**
 * "Todos os Espaços" (item "Mais" do Início, estilo ClickUp): painel pra
 * ver/ocultar/ordenar/buscar todos os Espaços do workspace e criar um novo,
 * sem precisar navegar pela árvore. Ocultar aqui só esconde da árvore lateral
 * (preferência de cliente, vp_hidden_spaces) — não afeta ninguém mais.
 */
function AllSpacesModal({ spaces, hiddenSpaceIds, onToggleHidden, onCreateSpace, canCreateSpace, onNavigateToSpace, onClose }: {
  spaces: Space[];
  hiddenSpaceIds: string[];
  onToggleHidden: (id: string) => void;
  onCreateSpace: () => void;
  canCreateSpace: boolean;
  onNavigateToSpace: (id: string, name: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [sortBy, setSortBy] = useState<'recommended' | 'created' | 'alpha'>('recommended');

  const q = query.trim().toLowerCase();
  const matches = (s: Space) => !q || s.name.toLowerCase().includes(q);

  const sorted = useMemo(() => {
    const arr = spaces.filter(matches);
    if (sortBy === 'alpha') return [...arr].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
    if (sortBy === 'created') return [...arr].sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaces, query, sortBy]);

  const visible = sorted.filter((s) => !hiddenSpaceIds.includes(s.id));
  const hidden = sorted.filter((s) => hiddenSpaceIds.includes(s.id));

  const renderRow = (space: Space, isHidden: boolean) => (
    <div key={space.id} className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 group">
      <button
        onClick={() => onNavigateToSpace(space.id, space.name)}
        className="flex items-center gap-2 flex-1 min-w-0 text-left"
      >
        {space.icon ? (
          (() => { const IconComponent = (Icons as any)[space.icon] || Icons.Layout; return <IconComponent className="w-4 h-4 shrink-0" color={space.color} />; })()
        ) : (
          <div className="w-5 h-5 rounded flex items-center justify-center shrink-0 font-bold text-[9px] text-white" style={{ backgroundColor: space.color }}>
            {space.name.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="text-sm text-gray-700 truncate">{space.name}</span>
      </button>
      <button
        onClick={() => onToggleHidden(space.id)}
        className="text-[11px] font-semibold text-gray-400 hover:text-[var(--primary-color)] px-2 py-1 rounded-md hover:bg-gray-100 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      >
        {isHidden ? 'Mostrar na barra lateral' : 'Ocultar'}
      </button>
    </div>
  );

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h2 className="font-bold text-gray-800 text-base">Todos os Espaços</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-5 flex items-center gap-2 pb-3">
          <div className="relative flex-1">
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar espaços..."
              className="w-full pl-8 pr-3 py-1.5 text-sm bg-gray-50 border rounded-md focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
            />
            <Icons.Search className="w-4 h-4 text-gray-400 absolute left-2 top-2" />
          </div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            className="text-xs border rounded-md px-2 py-1.5 bg-gray-50 text-gray-600 focus:outline-none"
          >
            <option value="recommended">Recomendado</option>
            <option value="created">Data de criação</option>
            <option value="alpha">Alfabética</option>
          </select>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2">
          <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide px-3 pt-1 pb-1">Visíveis</p>
          {visible.length === 0 ? (
            <p className="text-xs text-gray-400 px-3 py-2">Nenhum espaço visível.</p>
          ) : visible.map((s) => renderRow(s, false))}

          {hidden.length > 0 && (
            <>
              <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide px-3 pt-3 pb-1">Ocultos</p>
              {hidden.map((s) => renderRow(s, true))}
            </>
          )}
        </div>

        {canCreateSpace && (
          <div className="border-t p-3">
            <button
              onClick={() => { onCreateSpace(); onClose(); }}
              className="w-full flex items-center justify-center gap-1.5 text-sm font-semibold text-gray-600 hover:text-[var(--primary-color)] py-2 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <Icons.Plus className="w-4 h-4" /> Novo Espaço
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function RenameModal({ title, defaultValue, placeholder, onConfirm, onClose }: { title: string; defaultValue: string; placeholder?: string; onConfirm: (v: string) => void; onClose: () => void }) {
  const [value, setValue] = React.useState(defaultValue);
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); if (value.trim()) onConfirm(value.trim()); };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <h2 className="font-bold text-gray-800 text-base">{title}</h2>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            autoFocus
            type="text"
            value={value}
            onChange={e => setValue(e.target.value)}
            placeholder={placeholder || 'Nome…'}
            className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]/50"
          />
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={!value.trim()} className="px-4 py-2 text-sm rounded-lg bg-[var(--primary-color)] text-gray-800 font-bold disabled:opacity-40 hover:brightness-95">Confirmar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function ConfirmModal({
  message,
  confirmLabel = 'Excluir',
  variant = 'danger',
  onConfirm,
  onClose,
}: {
  message: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onClose: () => void;
}) {
  // 'danger' (padrão) preserva o visual vermelho já usado pelas exclusões
  // existentes; 'warning' (âmbar) é pra ações reversíveis com aviso reforçado
  // (ex.: arquivar tarefa não concluída — issue #185 seção 5), pra não
  // assustar o usuário com a mesma cor de "isso vai apagar algo".
  const isDanger = variant === 'danger';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isDanger ? 'bg-red-100' : 'bg-amber-100'}`}>
            <svg className={`w-5 h-5 ${isDanger ? 'text-red-600' : 'text-amber-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg>
          </div>
          <div>
            <p className="font-semibold text-gray-800 text-sm">Confirmar ação</p>
            <p className="text-sm text-gray-500 mt-1">{message}</p>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2 text-sm rounded-lg text-white font-bold ${isDanger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-500 hover:bg-amber-600'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// Issue #185, gota 3 ("mostrar arquivadas"): fecha o loop aberto pela gota 2
// — sem isso, arquivar uma tarefa era uma ação sem volta prática pela UI (só
// um admin mexendo direto no banco conseguia desarquivar). Painel simples e
// separado do ListView (que já é complexo — seleção em massa, agrupamento por
// status) de propósito: aqui é só achar a tarefa e Abrir/Desarquivar.
function ArchivedTasksModal({
  isLoading,
  tasks,
  lists,
  users,
  onClose,
  onOpenTask,
  onUnarchive,
}: {
  isLoading: boolean;
  tasks: Task[];
  lists: List[];
  users: any[];
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onUnarchive: (task: Task) => void;
}) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-2">
            <ArchiveIcon className="w-4 h-4 text-amber-600" />
            <p className="font-semibold text-gray-800 text-sm">Tarefas arquivadas neste escopo</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-amber-500 rounded-full animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-12">Nenhuma tarefa arquivada neste escopo.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {tasks.map(task => {
                const list = lists.find(l => l.id === task.listId);
                const archivedByName = users.find((u: any) => u.id === task.archivedBy)?.name;
                return (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-transparent hover:bg-amber-50/50 hover:border-amber-100 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {list?.name ? `${list.name} · ` : ''}
                        Arquivada {task.archivedAt ? new Date(task.archivedAt).toLocaleDateString('pt-BR') : ''}
                        {archivedByName ? ` por ${archivedByName}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => onOpenTask(task.id)}
                        className="px-2.5 py-1 text-xs rounded-md border text-gray-600 hover:bg-gray-50"
                      >
                        Abrir
                      </button>
                      <button
                        onClick={() => onUnarchive(task)}
                        className="px-2.5 py-1 text-xs rounded-md bg-amber-500 hover:bg-amber-600 text-white font-medium"
                      >
                        Desarquivar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Issue #185, gota 4 ("Lixeira") — mesmo padrão do ArchivedTasksModal (gota
// 3): painel simples e separado do ListView, só achar/restaurar. Mostra a
// contagem regressiva até o purge (seção 12 da issue) — o purge automático em
// si (pg_cron/Edge Function) é uma gota futura; aqui só a exibição.
function TrashModal({
  isLoading,
  tasks,
  lists,
  users,
  onClose,
  onOpenTask,
  onRestore,
}: {
  isLoading: boolean;
  tasks: Task[];
  lists: List[];
  users: any[];
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onRestore: (task: Task) => void;
}) {
  const daysUntil = (iso?: string) => {
    if (!iso) return null;
    const diffMs = new Date(iso).getTime() - Date.now();
    return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
  };
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <div className="flex items-center gap-2">
              <Icons.Trash className="w-4 h-4 text-red-500" />
              <p className="font-semibold text-gray-800 text-sm">Lixeira</p>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">Itens excluídos ficam disponíveis para restauração por 30 dias. Depois disso, são excluídos permanentemente.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-gray-200 border-t-red-400 rounded-full animate-spin" />
            </div>
          ) : tasks.length === 0 ? (
            <p className="text-sm text-gray-500 text-center py-12">A Lixeira deste escopo está vazia.</p>
          ) : (
            <div className="flex flex-col gap-1">
              {tasks.map(task => {
                const list = lists.find(l => l.id === task.listId);
                const deletedByName = users.find((u: any) => u.id === task.deletedBy)?.name;
                const remaining = daysUntil(task.purgeAfter);
                const reasonLabel = DELETION_REASONS.find(r => r.code === task.deletionReasonCode)?.label;
                return (
                  <div
                    key={task.id}
                    className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-transparent hover:bg-red-50/50 hover:border-red-100 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {list?.name ? `${list.name} · ` : ''}
                        Excluída {task.deletedAt ? new Date(task.deletedAt).toLocaleDateString('pt-BR') : ''}
                        {deletedByName ? ` por ${deletedByName}` : ''}
                        {reasonLabel ? ` · ${reasonLabel}` : ''}
                        {task.deletionReasonText ? ` — "${task.deletionReasonText}"` : ''}
                      </p>
                      {remaining !== null && (
                        <p className={`text-[11px] font-semibold mt-0.5 ${remaining <= 5 ? 'text-red-600' : 'text-gray-400'}`}>
                          {remaining <= 5 ? '⚠ ' : ''}
                          {remaining > 0 ? `Exclusão permanente em ${remaining} dia${remaining === 1 ? '' : 's'}` : 'Exclusão permanente em breve'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        onClick={() => onOpenTask(task.id)}
                        className="px-2.5 py-1 text-xs rounded-md border text-gray-600 hover:bg-gray-50"
                      >
                        Abrir
                      </button>
                      <button
                        onClick={() => onRestore(task)}
                        className="px-2.5 py-1 text-xs rounded-md bg-emerald-500 hover:bg-emerald-600 text-white font-medium"
                      >
                        Restaurar
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Issue #185 seção 10 — motivo opcional antes de mover pra Lixeira.
const DELETION_REASONS: { code: string; label: string }[] = [
  { code: 'CRIADA_ENGANO', label: 'Criada por engano' },
  { code: 'DUPLICADA', label: 'Duplicada' },
  { code: 'NAO_NECESSARIA', label: 'Não será mais necessária' },
  { code: 'INFO_INCORRETA', label: 'Informação incorreta' },
  { code: 'SOLICITACAO_CANCELADA', label: 'Solicitação cancelada' },
  { code: 'OUTRO', label: 'Outro' },
];

function TrashReasonModal({
  onClose,
  onConfirm,
}: {
  onClose: () => void;
  onConfirm: (reasonCode: string | null, reasonText: string | null) => void;
}) {
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState('');
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col gap-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 bg-red-100">
            <Icons.Trash className="w-5 h-5 text-red-600" />
          </div>
          <div>
            <p className="font-semibold text-gray-800 text-sm">Mover tarefa para a Lixeira?</p>
            <p className="text-sm text-gray-500 mt-1">Esta tarefa permanecerá disponível para restauração durante 30 dias. Após esse período, ela será excluída permanentemente.</p>
          </div>
        </div>
        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2">Por que esta tarefa está sendo excluída? (opcional)</p>
          <div className="flex flex-col gap-1.5">
            {DELETION_REASONS.map(r => (
              <label key={r.code} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                <input
                  type="radio"
                  name="deletion_reason"
                  checked={reasonCode === r.code}
                  onChange={() => setReasonCode(r.code)}
                  className="accent-red-500"
                />
                {r.label}
              </label>
            ))}
          </div>
          {reasonCode && (
            <textarea
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Detalhes adicionais (opcional)"
              rows={2}
              className="mt-2 w-full text-sm border rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-red-200"
            />
          )}
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border text-gray-600 hover:bg-gray-50">Cancelar</button>
          <button
            onClick={() => onConfirm(reasonCode, reasonText.trim() || null)}
            className="px-4 py-2 text-sm rounded-lg text-white font-bold bg-red-600 hover:bg-red-700"
          >
            Mover para Lixeira
          </button>
        </div>
      </div>
    </div>
  );
}

function DuplicateTaskModal({
  task,
  lists,
  isOpen,
  isSubmitting,
  onClose,
  onDuplicate,
}: {
  task: Task | null;
  lists: List[];
  isOpen: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onDuplicate: (options: DuplicateTaskOptions) => void;
}) {
  const [options, setOptions] = useState<DuplicateTaskOptions>({
    title: '',
    listId: '',
    includeDescription: true,
    includeAssignees: true,
    includeDates: true,
    includePriority: true,
    includeSubtasks: true,
    includeChecklists: true,
    includeTags: true,
    includeCustomFields: true,
  });

  useEffect(() => {
    if (!task) return;
    setOptions({
      title: `Cópia de ${task.title}`,
      listId: task.listId,
      includeDescription: true,
      includeAssignees: true,
      includeDates: true,
      includePriority: true,
      includeSubtasks: true,
      includeChecklists: true,
      includeTags: true,
      includeCustomFields: true,
    });
  }, [task]);

  const toggle = (key: DuplicateTaskBooleanOption, value: boolean) => {
    setOptions((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!task || isSubmitting || !options.title.trim() || !options.listId) return;
    onDuplicate({ ...options, title: options.title.trim() });
  };

  const copyItems: Array<{ key: DuplicateTaskBooleanOption; label: string; description: string }> = [
    { key: 'includeDescription', label: 'Descrição', description: 'Copia o texto principal da tarefa.' },
    { key: 'includeAssignees', label: 'Responsáveis', description: 'Mantém responsável principal e acompanhantes.' },
    { key: 'includeDates', label: 'Datas', description: 'Mantém início e prazo da tarefa original.' },
    { key: 'includePriority', label: 'Prioridade', description: 'Mantém a prioridade atual.' },
    { key: 'includeSubtasks', label: 'Subtarefas', description: 'Cria cópias independentes das subtarefas diretas.' },
    { key: 'includeChecklists', label: 'Checklists', description: 'Copia itens de ação e seus estados.' },
    { key: 'includeTags', label: 'Etiquetas', description: 'Mantém as tags aplicadas.' },
    { key: 'includeCustomFields', label: 'Campos personalizados', description: 'Copia valores preenchidos nos campos customizados.' },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50/60">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Copy className="w-5 h-5 text-blue-500" />
              Duplicar tarefa
            </DialogTitle>
            <DialogDescription>
              Crie uma nova tarefa independente a partir da tarefa atual. Alterações na cópia não mudam a original.
            </DialogDescription>
          </DialogHeader>

          <div className="p-6 space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700" htmlFor="duplicate-task-title">
                Nome da nova tarefa
              </label>
              <input
                id="duplicate-task-title"
                autoFocus
                value={options.title}
                onChange={(event) => setOptions((prev) => ({ ...prev, title: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition-all focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                placeholder="Digite o nome da tarefa duplicada"
              />
              {task && (
                <p className="text-xs text-gray-400">
                  Original: <span className="font-medium text-gray-500">{task.title}</span>
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-semibold text-gray-700" htmlFor="duplicate-task-list">
                Lista de destino
              </label>
              <select
                id="duplicate-task-list"
                value={options.listId}
                onChange={(event) => setOptions((prev) => ({ ...prev, listId: event.target.value }))}
                className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none transition-all focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
              >
                {lists.map((list) => (
                  <option key={list.id} value={list.id}>{list.name}</option>
                ))}
              </select>
            </div>

            <div>
              <p className="text-sm font-semibold text-gray-700 mb-3">O que copiar</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {copyItems.map((item) => (
                  <label
                    key={item.key}
                    className="flex items-start gap-3 rounded-xl border border-gray-200 bg-white p-3 hover:border-blue-200 hover:bg-blue-50/30 transition-colors cursor-pointer"
                  >
                    <Checkbox
                      checked={Boolean(options[item.key])}
                      onCheckedChange={(checked) => toggle(item.key, checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-gray-800">{item.label}</span>
                      <span className="block text-xs text-gray-500 leading-snug">{item.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              Comentários e anexos não são copiados automaticamente. Assim a nova tarefa nasce limpa, sem duplicar histórico ou arquivos da original.
            </div>
          </div>

          <DialogFooter className="px-6 py-4 border-t bg-gray-50/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !options.title.trim() || !options.listId}
              className="px-5 py-2 rounded-lg bg-[var(--primary-color)] text-[#2c3e50] text-sm font-black hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Duplicando...' : 'Duplicar tarefa'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const WEEKDAY_LABELS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const NTH_WEEK_LABELS: Record<number, string> = { 1: '1ª', 2: '2ª', 3: '3ª', 4: '4ª', 5: 'última' };

// Converte um Date pra valor de <input type="datetime-local"> no fuso local
// do navegador (não usa toISOString — isso converteria pra UTC e descolaria
// a hora exibida da hora que o usuário quis dizer).
function toDatetimeLocalValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export interface RecurrenceFormState {
  frequencyType: RecurrenceFrequencyType;
  interval: number;
  weekdays: number[];
  monthMode: 'day' | 'nth';
  monthDay: number;
  monthWeek: number;
  monthWeekday: number;
  startAt: string; // valor de datetime-local
  skipWeekends: boolean;
  skipHolidays: boolean;
  weekendShift: RecurrenceWeekendShift;
  endMode: RecurrenceEndMode;
  endAt: string; // valor de date
  maxOccurrences: number;
  inheritOptions: RecurrenceInheritOptions;
  overlapPolicy: RecurrenceOverlapPolicy;
  misfirePolicy: RecurrenceMisfirePolicy;
}

export function defaultRecurrenceForm(task: Task | null): RecurrenceFormState {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  return {
    frequencyType: 'weekly',
    interval: 1,
    weekdays: task ? [now.getDay()] : [1],
    monthMode: 'day',
    monthDay: now.getDate(),
    monthWeek: 1,
    monthWeekday: 1,
    startAt: toDatetimeLocalValue(now),
    skipWeekends: false,
    skipHolidays: false,
    weekendShift: 'next_business_day',
    endMode: 'forever',
    endAt: '',
    maxOccurrences: 10,
    inheritOptions: {
      includeDescription: true, includePriority: true, includeAssignees: true, includeTags: true,
      includeSubtasks: false, remapSubtaskDates: true, includeChecklists: false, includeChecklistCheckedState: false,
      includeCustomFields: false, includeWatchers: false,
    },
    overlapPolicy: 'create_and_flag',
    misfirePolicy: 'create_latest_only',
  };
}

function ruleToRecurrenceForm(rule: TaskRecurrenceRule): RecurrenceFormState {
  return {
    frequencyType: rule.frequencyType,
    interval: rule.interval,
    weekdays: rule.weekdays.length > 0 ? rule.weekdays : [1],
    monthMode: rule.monthWeek != null && rule.monthWeekday != null ? 'nth' : 'day',
    monthDay: rule.monthDay ?? new Date(rule.startAt).getDate(),
    monthWeek: rule.monthWeek ?? 1,
    monthWeekday: rule.monthWeekday ?? 1,
    startAt: toDatetimeLocalValue(new Date(rule.startAt)),
    skipWeekends: rule.skipWeekends,
    skipHolidays: rule.skipHolidays,
    weekendShift: rule.weekendShift,
    endMode: rule.endMode,
    endAt: rule.endAt ? rule.endAt.slice(0, 10) : '',
    maxOccurrences: rule.maxOccurrences ?? 10,
    inheritOptions: rule.inheritOptions,
    overlapPolicy: rule.overlapPolicy,
    misfirePolicy: rule.misfirePolicy,
  };
}

// Valida o formulário e monta o payload que o backend consome — extraído do
// componente pra ser testável sem precisar montar o Dialog (issue #184 seção
// 30, "teste E2E/Cypress para configuração da recorrência pela UI": o
// projeto não usa Cypress, então a cobertura equivalente aqui é testar essa
// função pura diretamente, no mesmo estilo Vitest já usado no resto do repo).
export function buildRecurrenceRuleInput(
  form: RecurrenceFormState,
): { input: Omit<import('./lib/taskRepo').RecurrenceRuleInput, 'taskId' | 'listId' | 'createdBy'> } | { error: string } {
  const startAtDate = new Date(form.startAt);
  if (Number.isNaN(startAtDate.getTime())) {
    return { error: 'Informe uma data/hora de início válida.' };
  }
  if (form.frequencyType === 'weekly' && form.weekdays.length === 0) {
    return { error: 'Selecione ao menos um dia da semana.' };
  }

  return {
    input: {
      frequencyType: form.frequencyType,
      interval: Math.max(1, form.interval),
      weekdays: form.frequencyType === 'weekly' ? form.weekdays : [],
      monthDay: form.frequencyType === 'monthly' && form.monthMode === 'day' ? form.monthDay : null,
      monthWeek: form.frequencyType === 'monthly' && form.monthMode === 'nth' ? form.monthWeek : null,
      monthWeekday: form.frequencyType === 'monthly' && form.monthMode === 'nth' ? form.monthWeekday : null,
      startAt: startAtDate.toISOString(),
      // A primeira ocorrência gerada é exatamente o start_at — o scheduler
      // avança a partir daí a cada execução (ver task-recurrence-scheduler).
      nextRunAt: startAtDate.toISOString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
      skipWeekends: form.skipWeekends,
      skipHolidays: form.skipHolidays,
      weekendShift: form.weekendShift,
      endMode: form.endMode,
      endAt: form.endMode === 'until' && form.endAt ? new Date(`${form.endAt}T23:59:59`).toISOString() : null,
      maxOccurrences: form.endMode === 'count' ? Math.max(1, form.maxOccurrences) : null,
      inheritOptions: form.inheritOptions,
      overlapPolicy: form.overlapPolicy,
      misfirePolicy: form.misfirePolicy,
    },
  };
}

// Modal de configuração de recorrência (issue #184, fase 3). Cria ou edita a
// ÚNICA regra da tarefa — o motor de cálculo e o scheduler (pg_cron + Edge
// Function task-recurrence-scheduler) já rodam em produção desde a fase 2;
// este modal só monta o RecurrenceRuleInput que o backend consome.
function RecurrenceConfigModal({
  task,
  rule,
  isOpen,
  isLoading,
  isSubmitting,
  onClose,
  onSave,
  onToggleEnabled,
  onDelete,
  currentUser,
}: {
  task: Task | null;
  rule: TaskRecurrenceRule | null;
  isOpen: boolean;
  isLoading: boolean;
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (input: Omit<import('./lib/taskRepo').RecurrenceRuleInput, 'taskId' | 'listId' | 'createdBy'>) => void;
  onToggleEnabled: (rule: TaskRecurrenceRule, enabled: boolean) => void;
  onDelete: (rule: TaskRecurrenceRule) => void;
  currentUser: User;
}) {
  const [form, setForm] = useState<RecurrenceFormState>(() => defaultRecurrenceForm(task));

  useEffect(() => {
    if (!isOpen) return;
    setForm(rule ? ruleToRecurrenceForm(rule) : defaultRecurrenceForm(task));
  }, [isOpen, rule, task]);

  const toggleWeekday = (day: number) => {
    setForm((prev) => ({
      ...prev,
      weekdays: prev.weekdays.includes(day) ? prev.weekdays.filter((d) => d !== day) : [...prev.weekdays, day].sort(),
    }));
  };

  const toggleInherit = (key: keyof RecurrenceInheritOptions, value: boolean) => {
    setForm((prev) => ({ ...prev, inheritOptions: { ...prev.inheritOptions, [key]: value } }));
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isSubmitting) return;
    const result = buildRecurrenceRuleInput(form);
    if ('error' in result) {
      toast.error(result.error);
      return;
    }
    onSave(result.input);
  };

  const inheritItems: Array<{ key: keyof RecurrenceInheritOptions; label: string }> = [
    { key: 'includeDescription', label: 'Descrição' },
    { key: 'includePriority', label: 'Prioridade' },
    { key: 'includeAssignees', label: 'Responsáveis' },
    { key: 'includeTags', label: 'Etiquetas' },
    { key: 'includeSubtasks', label: 'Subtarefas' },
    { key: 'includeChecklists', label: 'Checklists' },
    { key: 'includeCustomFields', label: 'Campos personalizados' },
    { key: 'includeWatchers', label: 'Observadores' },
  ];

  const [isHolidaysManagerOpen, setIsHolidaysManagerOpen] = useState(false);

  // Preview client-side das próximas ocorrências previstas (issue #184
  // seção 25 — "ocorrências futuras virtuais"): calcula sem materializar
  // nada no banco, reaproveitando o mesmo motor puro do scheduler.
  const [holidaysForPreview, setHolidaysForPreview] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!isOpen) return;
    fetchCompanyHolidays().then((rows) => setHolidaysForPreview(new Set(rows.map((h) => h.date))));
  }, [isOpen]);

  const upcomingPreview = useMemo(() => {
    const startAtDate = new Date(form.startAt);
    if (Number.isNaN(startAtDate.getTime())) return [];
    const ruleForCalc: RecurrenceRuleForCalc = {
      frequencyType: form.frequencyType,
      interval: Math.max(1, form.interval),
      weekdays: form.frequencyType === 'weekly' ? form.weekdays : [],
      monthDay: form.frequencyType === 'monthly' && form.monthMode === 'day' ? form.monthDay : null,
      monthWeek: form.frequencyType === 'monthly' && form.monthMode === 'nth' ? form.monthWeek : null,
      monthWeekday: form.frequencyType === 'monthly' && form.monthMode === 'nth' ? form.monthWeekday : null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Sao_Paulo',
      skipWeekends: form.skipWeekends,
      skipHolidays: form.skipHolidays,
      weekendShift: form.weekendShift,
    };
    const dates: Date[] = [startAtDate];
    let cursor = startAtDate;
    for (let i = 0; i < 4; i++) {
      const next = calcNextValidOccurrence(ruleForCalc, cursor, startAtDate, holidaysForPreview);
      if (!next) break;
      dates.push(next);
      cursor = next;
    }
    return dates;
  }, [form.startAt, form.frequencyType, form.interval, form.weekdays, form.monthMode, form.monthDay, form.monthWeek, form.monthWeekday, form.skipWeekends, form.skipHolidays, form.weekendShift, holidaysForPreview]);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden max-h-[85vh] flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50/60 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Repeat className="w-5 h-5 text-blue-500" />
              {rule ? 'Editar recorrência' : 'Configurar recorrência'}
            </DialogTitle>
            <DialogDescription>
              Uma nova ocorrência desta tarefa é criada automaticamente conforme a frequência abaixo.
            </DialogDescription>
          </DialogHeader>

          {isLoading ? (
            <div className="p-8 text-center text-sm text-gray-400">Carregando...</div>
          ) : (
            <div className="p-6 space-y-5 overflow-y-auto">
              {rule && (
                <div className="flex items-center justify-between rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  <span>
                    {rule.enabled ? 'Ativa' : 'Pausada'} · {rule.occurrencesCreated} ocorrência{rule.occurrencesCreated === 1 ? '' : 's'} criada{rule.occurrencesCreated === 1 ? '' : 's'}
                    {rule.nextRunAt && rule.enabled && ` · próxima em ${new Date(rule.nextRunAt).toLocaleString('pt-BR')}`}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleEnabled(rule, !rule.enabled)}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 font-semibold text-gray-600 hover:bg-gray-100"
                  >
                    {rule.enabled ? <><Pause className="w-3 h-3" /> Pausar</> : <><Play className="w-3 h-3" /> Retomar</>}
                  </button>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Frequência</label>
                  <select
                    value={form.frequencyType}
                    onChange={(e) => setForm((prev) => ({ ...prev, frequencyType: e.target.value as RecurrenceFrequencyType }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="daily">Diária</option>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensal</option>
                    <option value="yearly">Anual</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">A cada</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={form.interval}
                      onChange={(e) => setForm((prev) => ({ ...prev, interval: Number(e.target.value) || 1 }))}
                      className="w-20 rounded-xl border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                    <span className="text-sm text-gray-500">
                      {{ daily: 'dia(s)', weekly: 'semana(s)', monthly: 'mês(es)', yearly: 'ano(s)', custom: 'período(s)' }[form.frequencyType]}
                    </span>
                  </div>
                </div>
              </div>

              {form.frequencyType === 'weekly' && (
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Dias da semana</label>
                  <div className="flex gap-1.5">
                    {WEEKDAY_LABELS.map((label, day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => toggleWeekday(day)}
                        className={`w-10 h-10 rounded-lg text-xs font-bold transition-colors ${form.weekdays.includes(day) ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {form.frequencyType === 'monthly' && (
                <div className="space-y-2">
                  <div className="flex gap-4 text-sm">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={form.monthMode === 'day'} onChange={() => setForm((prev) => ({ ...prev, monthMode: 'day' }))} />
                      Dia fixo do mês
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={form.monthMode === 'nth'} onChange={() => setForm((prev) => ({ ...prev, monthMode: 'nth' }))} />
                      Em um dia específico
                    </label>
                  </div>
                  {form.monthMode === 'day' ? (
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={form.monthDay}
                      onChange={(e) => setForm((prev) => ({ ...prev, monthDay: Number(e.target.value) || 1 }))}
                      className="w-24 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                    />
                  ) : (
                    <div className="flex items-center gap-2">
                      <select
                        value={form.monthWeek}
                        onChange={(e) => setForm((prev) => ({ ...prev, monthWeek: Number(e.target.value) }))}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      >
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{NTH_WEEK_LABELS[n]}</option>)}
                      </select>
                      <select
                        value={form.monthWeekday}
                        onChange={(e) => setForm((prev) => ({ ...prev, monthWeekday: Number(e.target.value) }))}
                        className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                      >
                        {WEEKDAY_LABELS.map((label, day) => <option key={day} value={day}>{label}-feira</option>)}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">Início da primeira ocorrência</label>
                <input
                  type="datetime-local"
                  value={form.startAt}
                  onChange={(e) => setForm((prev) => ({ ...prev, startAt: e.target.value }))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-gray-700">
                  <Checkbox checked={form.skipWeekends} onCheckedChange={(c) => setForm((prev) => ({ ...prev, skipWeekends: c === true }))} />
                  Pular fins de semana
                </label>
                {form.skipWeekends && (
                  <select
                    value={form.weekendShift}
                    onChange={(e) => setForm((prev) => ({ ...prev, weekendShift: e.target.value as RecurrenceWeekendShift }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="next_business_day">Mover para o próximo dia útil</option>
                    <option value="previous_business_day">Mover para o dia útil anterior</option>
                    <option value="skip">Pular esta ocorrência</option>
                  </select>
                )}
              </div>

              <div className="space-y-2">
                <label className="flex items-center justify-between gap-2 text-sm font-semibold text-gray-700">
                  <span className="flex items-center gap-2">
                    <Checkbox checked={form.skipHolidays} onCheckedChange={(c) => setForm((prev) => ({ ...prev, skipHolidays: c === true }))} />
                    Pular feriados
                  </span>
                  <button type="button" onClick={() => setIsHolidaysManagerOpen(true)} className="text-xs font-medium text-blue-500 hover:underline">
                    Gerenciar feriados
                  </button>
                </label>
              </div>

              {upcomingPreview.length > 1 && (
                <div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-600">
                  <p className="mb-1 font-semibold text-gray-700">Próximas ocorrências previstas</p>
                  <p>{upcomingPreview.map((d) => d.toLocaleDateString('pt-BR')).join(' · ')}</p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-semibold text-gray-700">Encerramento</label>
                <div className="flex gap-4 text-sm mb-2">
                  <label className="flex items-center gap-1.5"><input type="radio" checked={form.endMode === 'forever'} onChange={() => setForm((prev) => ({ ...prev, endMode: 'forever' }))} /> Nunca</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={form.endMode === 'count'} onChange={() => setForm((prev) => ({ ...prev, endMode: 'count' }))} /> Após N vezes</label>
                  <label className="flex items-center gap-1.5"><input type="radio" checked={form.endMode === 'until'} onChange={() => setForm((prev) => ({ ...prev, endMode: 'until' }))} /> Até uma data</label>
                </div>
                {form.endMode === 'count' && (
                  <input
                    type="number"
                    min={1}
                    value={form.maxOccurrences}
                    onChange={(e) => setForm((prev) => ({ ...prev, maxOccurrences: Number(e.target.value) || 1 }))}
                    className="w-24 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                )}
                {form.endMode === 'until' && (
                  <input
                    type="date"
                    value={form.endAt}
                    onChange={(e) => setForm((prev) => ({ ...prev, endAt: e.target.value }))}
                    className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  />
                )}
              </div>

              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">O que herdar na nova ocorrência</p>
                <div className="grid grid-cols-2 gap-2">
                  {inheritItems.map((item) => (
                    <label key={item.key} className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2.5 hover:border-blue-200 cursor-pointer">
                      <Checkbox checked={Boolean(form.inheritOptions[item.key])} onCheckedChange={(c) => toggleInherit(item.key, c === true)} />
                      <span className="text-sm text-gray-700">{item.label}</span>
                    </label>
                  ))}
                </div>
                {form.inheritOptions.includeSubtasks && (
                  <label className="mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2.5 hover:border-blue-200 cursor-pointer">
                    <Checkbox checked={Boolean(form.inheritOptions.remapSubtaskDates)} onCheckedChange={(c) => toggleInherit('remapSubtaskDates', c === true)} />
                    <span className="text-sm text-gray-700">Remapear datas das subtarefas (preserva o intervalo em relação à tarefa-pai)</span>
                  </label>
                )}
                {form.inheritOptions.includeChecklists && (
                  <label className="mt-2 flex items-center gap-2 rounded-xl border border-gray-200 bg-white p-2.5 hover:border-blue-200 cursor-pointer">
                    <Checkbox checked={Boolean(form.inheritOptions.includeChecklistCheckedState)} onCheckedChange={(c) => toggleInherit('includeChecklistCheckedState', c === true)} />
                    <span className="text-sm text-gray-700">Manter itens de checklist já marcados como concluídos</span>
                  </label>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Se a anterior ainda está aberta</label>
                  <select
                    value={form.overlapPolicy}
                    onChange={(e) => setForm((prev) => ({ ...prev, overlapPolicy: e.target.value as RecurrenceOverlapPolicy }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="create_anyway">Criar normalmente</option>
                    <option value="create_and_flag">Criar e sinalizar</option>
                    <option value="escalate">Criar e notificar</option>
                    <option value="skip_new">Pular esta ocorrência</option>
                    <option value="postpone">Esperar a anterior fechar</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-semibold text-gray-700">Se o sistema ficou parado</label>
                  <select
                    value={form.misfirePolicy}
                    onChange={(e) => setForm((prev) => ({ ...prev, misfirePolicy: e.target.value as RecurrenceMisfirePolicy }))}
                    className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-900 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-100"
                  >
                    <option value="skip_past">Pular ocorrências atrasadas</option>
                    <option value="create_latest_only">Criar só a mais recente</option>
                    <option value="create_all_up_to_limit">Criar todas as atrasadas</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          <DialogFooter className="px-6 py-4 border-t bg-gray-50/80 shrink-0">
            {rule && (
              <button
                type="button"
                onClick={() => onDelete(rule)}
                disabled={isSubmitting}
                className="mr-auto px-4 py-2 rounded-lg border border-red-200 bg-white text-sm font-semibold text-red-500 hover:bg-red-50 disabled:opacity-50"
              >
                Excluir recorrência
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg border border-gray-200 bg-white text-sm font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isLoading}
              className="px-5 py-2 rounded-lg bg-[var(--primary-color)] text-[#2c3e50] text-sm font-black hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Salvando...' : rule ? 'Salvar alterações' : 'Ativar recorrência'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
      <HolidaysManagerModal
        isOpen={isHolidaysManagerOpen}
        onClose={() => setIsHolidaysManagerOpen(false)}
        onChanged={(holidays) => setHolidaysForPreview(new Set(holidays.map((h) => h.date)))}
        currentUser={currentUser}
      />
    </Dialog>
  );
}

// Modal auxiliar do "Pular feriados" — CRUD do calendário corporativo
// (issue #184 seção 11). Escrita restrita a is_manager() via RLS; qualquer
// autenticado só lê (a própria regra de recorrência de um colaborador
// precisa enxergar os feriados pra calcular o deslocamento corretamente).
function HolidaysManagerModal({
  isOpen,
  onClose,
  onChanged,
  currentUser,
}: {
  isOpen: boolean;
  onClose: () => void;
  onChanged: (holidays: CompanyHoliday[]) => void;
  currentUser: User;
}) {
  const [holidays, setHolidays] = useState<CompanyHoliday[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [newName, setNewName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const reload = async () => {
    setIsLoading(true);
    const rows = await fetchCompanyHolidays();
    setHolidays(rows);
    onChanged(rows);
    setIsLoading(false);
  };

  useEffect(() => {
    if (isOpen) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const canManage = currentUser?.role === 'ADMIN' || currentUser?.role === 'GESTOR';

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDate || !newName.trim() || isSaving) return;
    setIsSaving(true);
    try {
      const res = await addCompanyHoliday(newDate, newName, currentUser.id);
      if ('error' in res) throw new Error(res.error);
      setNewDate('');
      setNewName('');
      await reload();
    } catch (err) {
      toast.error('Erro ao adicionar feriado: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    const { error } = await deleteCompanyHoliday(id);
    if (error) { toast.error('Erro ao excluir feriado: ' + error); return; }
    await reload();
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden max-h-[80vh] flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b bg-gray-50/60 shrink-0">
          <DialogTitle className="text-lg">Calendário de feriados</DialogTitle>
          <DialogDescription>Usado por qualquer regra com "Pular feriados" ativado.</DialogDescription>
        </DialogHeader>

        <div className="p-6 space-y-4 overflow-y-auto">
          {canManage && (
            <form onSubmit={handleAdd} className="flex items-end gap-2">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-semibold text-gray-500">Data</label>
                <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-semibold text-gray-500">Nome</label>
                <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Ex.: Natal" className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm outline-none focus:border-blue-400" />
              </div>
              <button type="submit" disabled={isSaving} className="px-3 py-1.5 rounded-lg bg-[var(--primary-color)] text-[#2c3e50] text-sm font-bold disabled:opacity-50">+</button>
            </form>
          )}

          {isLoading ? (
            <p className="text-sm text-gray-400">Carregando...</p>
          ) : holidays.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum feriado cadastrado ainda.</p>
          ) : (
            <ul className="space-y-1.5">
              {holidays.map((h) => (
                <li key={h.id} className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm">
                  <span>
                    <span className="font-semibold text-gray-700">{new Date(`${h.date}T00:00:00`).toLocaleDateString('pt-BR')}</span>
                    <span className="text-gray-500"> — {h.name}</span>
                  </span>
                  {canManage && (
                    <button type="button" onClick={() => handleDelete(h.id)} className="text-gray-400 hover:text-red-500">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Datas de tarefa (dueDate/startDate) são strings "YYYY-MM-DD" (sem hora).
// `new Date("YYYY-MM-DD")` interpreta isso como meia-noite UTC, que em fusos
// atrás de UTC (ex: Brasil) cai no dia anterior ao formatar/comparar em
// horário local. Parseamos os componentes manualmente para obter a
// meia-noite local do dia correto.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Inverso de parseLocalDate: formata um Date usando os componentes locais
// (ano/mês/dia), nunca `toISOString()` — que converte para UTC e pode
// arredondar para o dia errado em fusos atrás de UTC (ex: Brasil, UTC-3).
function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Reexportado para não quebrar `import { linkifyText } from './App'` já em uso
// (ex.: src/test/linkifyText.test.tsx). A implementação vive em ./lib/linkify
// porque MentionText (lib/mentions.tsx) também precisa dela, e mentions.tsx é
// importado por este arquivo — importar de volta daqui criaria um ciclo.
export { linkifyText };

// Resolve qual lista deve ser considerada "ativa" quando `activeListId` está
// vazio (ex: navegando por pasta/espaço em vez de uma lista específica): se
// todas as tarefas visíveis pertencem à mesma lista, usamos essa lista;
// senão é ambíguo e retornamos null. Usado tanto pela tabela (ListView)
// quanto pelo modal de campos personalizados — as duas telas PRECISAM
// concordar sobre qual lista está "ativa", senão os toggles de
// mostrar/ocultar campo gravam numa chave que a outra tela nunca lê.
export function resolveActiveListId(activeListId: string | null | undefined, tasks: { listId: string }[]): string | null {
  if (activeListId) return activeListId;
  const listIds = Array.from(new Set(tasks.map((t) => t.listId)));
  return listIds.length === 1 ? listIds[0] : null;
}

function getTaskHealth(task: Task) {
  const status = (task.status || '').toLowerCase();

  // ── 1. Terminal / concluído ───────────────────────────────────────────────
  if (status.includes('conclu') || status.includes('aprovado') || status.includes('fechado')) {
    return { emoji: '🎉', label: 'Missão cumprida!', bg: 'bg-green-100', text: 'text-green-800', border: 'border-green-200' };
  }

  // ── 2. Cancelado / Reprovado — terminal, não conta como atraso ───────────
  if (status.includes('cancel') || status.includes('reprova')) {
    return { emoji: '🚫', label: 'Cancelado / Reprovado', bg: 'bg-gray-100', text: 'text-gray-500', border: 'border-gray-200' };
  }

  // ── 3. Aguardando / Bloqueado / Pendente — em espera, NÃO é atraso ───────
  if (
    status.includes('aguardando') ||
    status.includes('pendente') ||
    status.includes('enviada') ||
    status.includes('em espera') ||
    status.includes('bloqueada') ||
    status.includes('em analise') ||
    status.includes('em análise')
  ) {
    return { emoji: '⏳', label: 'Aguardando / Em espera', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' };
  }

  if (!task.dueDate) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const due = parseLocalDate(task.dueDate); due.setHours(23, 59, 59, 999);
  const start = task.startDate ? parseLocalDate(task.startDate) : null;

  if (start && today < start) {
    return { emoji: '⏰', label: 'Preparando para decolar!', bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' };
  }
  if (today > due) {
    return { emoji: '😡', label: 'Atrasado! Corra!', bg: 'bg-red-100', text: 'text-red-800', border: 'border-red-200' };
  }

  const ref = start ?? today;
  const total = due.getTime() - ref.getTime();
  const remaining = due.getTime() - today.getTime();
  const pct = total > 0 ? remaining / total : 1;

  if (pct > 0.5) return { emoji: '😄', label: 'Tranquilo, em dia!', bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
  if (pct > 0.2) return { emoji: '😅', label: 'Atenção, prazo chegando!', bg: 'bg-yellow-100', text: 'text-yellow-800', border: 'border-yellow-200' };
  return { emoji: '😰', label: 'Cuidado, últimos dias!', bg: 'bg-orange-100', text: 'text-orange-800', border: 'border-orange-200' };
}

function ListView({
  tasks,
  onSelectTask,
  onStatusChange,
  context,
  onQuickCreate,
  onDeleteTask,
  onDuplicateTask,
  lists,
  statusGroups,
  activeListId,
  hiddenStandardColumnKeysByList,
  onToggleStandardColumn,
  customFields,
  fieldValues,
  hiddenTaskFieldIdsByList,
  onCreateField,
  onUpdateFieldValue,
  onHideTaskFieldForList,
  columnOrder,
  onReorderColumns,
  onOpenManager,
  currentUser,
  users,
  onBulkStatusChange,
  onBulkPriorityChange,
  onBulkDelete,
  onBulkMove,
  isLoading = false,
}: any) {
  // --- Bulk Selection State (T701) ---
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const toggleSelection = (id: string) => setSelectedTaskIds(prev => {
    const next = new Set(prev);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    return next;
  });
  const clearSelection = () => setSelectedTaskIds(new Set());

  // Encontrar o grupo de status para a visualização atual
  const activeList = lists?.find((l: any) => l.id === activeListId);
  const activeStatusGroup = statusGroups?.find((g: any) => g.id === activeList?.statusGroupId) || statusGroups?.[0];
  const activeStatusOptions = activeStatusGroup?.options || [];

  const statusOrder = useMemo(() => {
    let order: string[] = [];
    if (activeListId && activeStatusOptions.length > 0) {
      order = activeStatusOptions.map((o: any) => o.label);
    } else {
      // Caso contrário, coletar todos os status únicos das tarefas presentes
      const uniqueStatuses = Array.from(new Set<string>(tasks.map((t: Task) => t.status)));
      // Tentar manter uma ordem razoável baseada no grupo padrão
      const defaultOrder = statusGroups?.[0]?.options.map((o: any) => o.label) || [];
      order = uniqueStatuses.sort((a: any, b: any) => {
        const idxA = defaultOrder.indexOf(a);
        const idxB = defaultOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });
    }
    return order;
    // Usamos JSON.stringify para evitar novos arrays idênticos disparando o useEffect
    // Adicionamos t.status para que mudanças de status disparem a re-calculação mesmo se tasks.length não mudar
  }, [tasks.length, activeListId, JSON.stringify(activeStatusOptions), JSON.stringify(tasks.map(t => t.status)), JSON.stringify(statusGroups?.[0]?.options)]);

  const [expandedStatuses, setExpandedStatuses] = useState<string[]>([]);

  // Cada grupo expandido monta uma <table> com todas as linhas daquele status
  // (sem virtualização). Expandir tudo por padrão travava o navegador em
  // escopos grandes (ex.: um espaço com ~6.000 tarefas tentava montar milhares
  // de <tr> de uma vez). Acima do limiar, começa tudo fechado — o usuário
  // ainda expande qualquer grupo com um clique, sem perder a funcionalidade.
  const AUTO_EXPAND_TASK_LIMIT = 300;
  useEffect(() => {
    const nextExpanded = tasks.length > AUTO_EXPAND_TASK_LIMIT ? [] : statusOrder;
    if (JSON.stringify(expandedStatuses) !== JSON.stringify(nextExpanded)) {
      setExpandedStatuses(nextExpanded);
    }
  }, [statusOrder, tasks.length]);

  const [expandedTasks, setExpandedTasks] = useState<Set<string>>(new Set());

  // Cada linha renderizada monta subtarefas recursivas, editores de campo
  // customizado e menus — cara demais pra montar tudo de um grupo grande de
  // uma vez (ex.: 684 tarefas em "A Fazer" travava o navegador ao expandir).
  // Em vez de virtualizar essa árvore recursiva (reescrita maior, sem rede de
  // segurança de testes), cada grupo revela em lotes: só as primeiras
  // VISIBLE_ROWS_STEP raízes desse status viram <tr>, com um botão "carregar
  // mais" pro resto — mesmo efeito prático (nunca monta milhares de uma vez),
  // risco bem menor.
  const VISIBLE_ROWS_STEP = 200;
  const [visibleRowsByStatus, setVisibleRowsByStatus] = useState<Record<string, number>>({});
  const showMoreRows = useCallback((status: string, total: number) => {
    setVisibleRowsByStatus((prev) => ({ ...prev, [status]: Math.min((prev[status] ?? VISIBLE_ROWS_STEP) + VISIBLE_ROWS_STEP, total) }));
  }, []);

  const toggleStatus = useCallback((status: string) => {
    setExpandedStatuses((prev) => (prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]));
  }, []);

  const getStatusStyle = useCallback((statusLabel: string) => {
    const sLower = (statusLabel || '').toLowerCase();
    const opt = activeStatusOptions.find((o: any) => o.label?.toLowerCase() === sLower) ||
      statusGroups?.flatMap((g: any) => g.options).find((o: any) => o.label?.toLowerCase() === sLower);

    if (opt?.color) {
      return {
        backgroundColor: opt.color,
        color: '#ffffff',
        border: `1px solid ${opt.color}`
      };
    }

    if (sLower.includes('conclu') || sLower.includes('fechado') || sLower.includes('aprovado')) return { backgroundColor: '#dcfce7', color: '#15803d' };
    if (sLower.includes('espera') || sLower.includes('aguarda') || sLower.includes('pendente')) return { backgroundColor: '#fef9c3', color: '#a16207' };
    if (sLower.includes('andamento') || sLower.includes('progresso')) return { backgroundColor: '#dbeafe', color: '#1d4ed8' };
    if (sLower.includes('cancel') || sLower.includes('repro') || sLower.includes('risco')) return { backgroundColor: '#fee2e2', color: '#b91c1c' };

    return { backgroundColor: '#f1f5f9', color: '#475569' };
  }, [activeStatusOptions, statusGroups]);

  const toggleTaskExpansion = useCallback((taskId: string) => {
    setExpandedTasks((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const listIdsInView = useMemo(() => {
    const ids = new Set<string>();
    (tasks as Task[]).forEach((t) => ids.add(t.listId));
    return Array.from(ids);
  }, [tasks]);

  const derivedActiveListId = useMemo(
    () => resolveActiveListId(activeListId, tasks),
    [activeListId, tasks],
  );

  const hiddenTaskFieldIdsForActiveList = useMemo(() => {
    if (!derivedActiveListId) return [];
    return (hiddenTaskFieldIdsByList as Record<string, string[]> | undefined)?.[derivedActiveListId] ?? [];
  }, [derivedActiveListId, hiddenTaskFieldIdsByList]);

  const taskCustomFields = useMemo(() => {
    return (customFields as CustomField[])
      .filter((f) => f.target === 'TASK')
      .filter((f) => ((f.visibleTo as UserRole[] | undefined) ?? []).includes(currentUser.role))
      .filter((f) => !hiddenTaskFieldIdsForActiveList.includes(f.id));
  }, [customFields, currentUser.role, hiddenTaskFieldIdsForActiveList]);

  const hiddenStandardColumnsForActiveList = useMemo(() => {
    if (!derivedActiveListId) return [];
    return (hiddenStandardColumnKeysByList as Record<string, any[]> | undefined)?.[derivedActiveListId] ?? [];
  }, [derivedActiveListId, hiddenStandardColumnKeysByList]);

  const isStandardVisible = useCallback(
    (key: any) => !hiddenStandardColumnsForActiveList.includes(key),
    [hiddenStandardColumnsForActiveList],
  );

  const getFieldValue = useCallback(
    (fieldId: string, entityId: string) => {
      return (fieldValues as CustomFieldValue[]).find(
        (v) => v.fieldId === fieldId && v.entityId === entityId,
      )?.value;
    },
    [fieldValues],
  );


  const sortTasksNaturally = (a: Task, b: Task) =>
    a.title.localeCompare(b.title, 'pt-BR', { numeric: true, sensitivity: 'base' });

  const grouped = useMemo(() => {
    return statusOrder
      .map((status) => ({
        status,
        tasks: (tasks as Task[])
          .filter((t) => t.status === status && !t.parentId)
          .sort(sortTasksNaturally),
      }))
      .filter((g) => g.tasks.length > 0);
  }, [tasks, statusOrder]);

  // --- Dynamic Column Management ---
  const allAvailableColumns = useMemo(() => {
    const cols: { id: string, name: string, type: 'standard' | 'custom' }[] = [];

    if (isStandardVisible("status")) cols.push({ id: 'status', name: 'Status', type: 'standard' });
    if (isStandardVisible("priority")) cols.push({ id: 'priority', name: 'Prioridade', type: 'standard' });
    if (isStandardVisible("assignee")) cols.push({ id: 'assignee', name: 'Responsável', type: 'standard' });
    if (isStandardVisible("extensions")) cols.push({ id: 'extensions', name: 'Prorrog.', type: 'standard' });
    if (isStandardVisible("dueDate")) cols.push({ id: 'dueDate', name: 'Data Limite', type: 'standard' });

    taskCustomFields.forEach(f => {
      cols.push({ id: f.id, name: f.name, type: 'custom' });
    });

    return cols;
  }, [isStandardVisible, taskCustomFields]);

  const orderedColumns = useMemo(() => {
    if (!columnOrder) return allAvailableColumns;

    // Filter out columns that might have been removed or hidden
    const availableIds = allAvailableColumns.map(c => c.id);
    const filteredOrder = columnOrder.filter(id => availableIds.includes(id));

    // Append any new available columns that are not in the order yet
    const missing = allAvailableColumns.filter(c => !filteredOrder.includes(c.id));

    const finalOrder = [...filteredOrder, ...missing.map(c => c.id)];
    return finalOrder.map(id => allAvailableColumns.find(c => c.id === id)!);
  }, [allAvailableColumns, columnOrder]);

  // --- Column Resize Logic ---
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  const resizeActiveRef = useRef<{ colId: string; startX: number; startWidth: number } | null>(null);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const th = (e.target as HTMLElement).closest('th') as HTMLElement | null;
    const startWidth = th ? th.getBoundingClientRect().width : (colWidths[colId] || 150);
    resizeActiveRef.current = { colId, startX: e.clientX, startWidth };

    const onMouseMove = (ev: MouseEvent) => {
      if (!resizeActiveRef.current) return;
      const delta = ev.clientX - resizeActiveRef.current.startX;
      const newWidth = Math.max(60, resizeActiveRef.current.startWidth + delta);
      setColWidths(prev => ({ ...prev, [resizeActiveRef.current!.colId]: newWidth }));
    };
    const onMouseUp = () => {
      resizeActiveRef.current = null;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }, [colWidths]);

  const handleResizeDblClick = useCallback((e: React.MouseEvent, colId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setColWidths(prev => { const next = { ...prev }; delete next[colId]; return next; });
  }, []);

  // --- Drag and Drop Logic ---
  const [draggedColumnId, setDraggedColumnId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedColumnId(id);
    e.dataTransfer.effectAllowed = 'move';
    // Adiciona uma imagem vazia como drag preview para evitar o "fantasma" padrão se quisermos Custom
    // Mas o padrão costuma ser bom o suficiente. Vamos apenas garantir que o ID está lá.
    e.dataTransfer.setData('text/plain', id);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (!draggedColumnId || draggedColumnId === targetId) return;

    // "Live" reordering: troca as colunas enquanto arrasta
    const currentIds = orderedColumns.map(c => c.id);
    const fromIndex = currentIds.indexOf(draggedColumnId);
    const toIndex = currentIds.indexOf(targetId);

    if (fromIndex === -1 || toIndex === -1) return;

    const newOrder = [...currentIds];
    newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, draggedColumnId);

    onReorderColumns(newOrder);
  };

  const handleDragEnd = () => {
    setDraggedColumnId(null);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDraggedColumnId(null);
  };

  return (
    <div
      className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden overflow-x-auto custom-scrollbar flex flex-col h-full"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Inline Quick Create Trigger */}
      <div
        className="p-3 border-b flex items-center gap-3 bg-gray-50/50 hover:bg-gray-100 cursor-pointer transition-colors"
        onClick={() => onQuickCreate(activeListId ? { listId: activeListId } : undefined)}
      >
        <div className="w-4 h-4 rounded-full border-2 border-gray-300 flex items-center justify-center text-gray-400">
          <span className="text-xs">+</span>
        </div>
        <span className="text-sm text-gray-500">
          {/* `onClick={onQuickCreate}` direto passava o SyntheticEvent do
              clique como "prefill" (achado de QA: modal nunca vinha
              pré-selecionado). Além disso, sem `activeListId` (contexto
              agregado — pasta/espaço/Dashboard, não uma lista de verdade)
              não existe um alvo único pra pré-selecionar, então o rótulo não
              promete mais um contexto que a criação não vai respeitar. */}
          {activeListId ? (
            <>+ Adicionar nova tarefa em <span className="font-semibold">{context.name}</span>...</>
          ) : (
            '+ Adicionar nova tarefa...'
          )}
        </span>
      </div>

      {tasks.length === 0 ? (
        <div className="px-4 py-12 text-center text-gray-400 italic">
          {isLoading ? 'Carregando tarefas deste contexto...' : 'Nenhuma tarefa encontrada neste contexto.'}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          {grouped.map(({ status, tasks: statusTasks }) => {
            const isExpanded = expandedStatuses.includes(status);

            return (
              <section key={status} className="border-b last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleStatus(status)}
                  className="w-full px-4 py-3 bg-white sticky top-0 z-[1] border-b flex items-center justify-between hover:bg-gray-50 transition-colors"
                  aria-expanded={isExpanded}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="px-2 py-1 rounded text-[11px] font-extrabold uppercase"
                      style={getStatusStyle(status)}
                    >
                      {status}
                    </span>
                    <span className="text-[11px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded">
                      {statusTasks.length}
                    </span>
                  </div>

                  <div className={`text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}>
                    <Icons.ChevronRight />
                  </div>
                </button>

                {isExpanded && (
                  <table className="w-full text-left border-collapse min-w-[900px]" style={{ tableLayout: 'fixed' }}>
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="w-10 px-3 py-3 border-r border-gray-200">
                          <input
                            type="checkbox"
                            className="rounded border-gray-300 cursor-pointer"
                            checked={tasks.length > 0 && tasks.every((t: Task) => selectedTaskIds.has(t.id))}
                            onChange={() => {
                              const allIds = tasks.map((t: Task) => t.id);
                              const allSelected = allIds.every((id: string) => selectedTaskIds.has(id));
                              if (allSelected) {
                                clearSelection();
                              } else {
                                setSelectedTaskIds(new Set(allIds));
                              }
                            }}
                          />
                        </th>
                        <th
                          className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase border-r border-gray-200 relative overflow-hidden"
                          style={{ width: colWidths['tarefa'] || 300, minWidth: 120 }}
                        >
                          Tarefa
                          <div
                            className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400 transition-colors z-10 opacity-0 hover:opacity-60"
                            style={{ cursor: 'col-resize' }}
                            onMouseDown={(e) => handleResizeMouseDown(e, 'tarefa')}
                            onDoubleClick={(e) => handleResizeDblClick(e, 'tarefa')}
                          />
                        </th>

                        {orderedColumns.map((col) => (
                          <th
                            key={col.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, col.id)}
                            onDragOver={handleDragOver}
                            onDragEnter={(e) => handleDragEnter(e, col.id)}
                            onDragEnd={handleDragEnd}
                            onDrop={handleDrop}
                            className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase cursor-move hover:bg-gray-100 transition-colors border-r border-gray-200 relative overflow-hidden ${draggedColumnId === col.id ? 'bg-blue-50 opacity-40' : ''}`}
                            style={{ width: colWidths[col.id] || 150, minWidth: 60 }}
                          >
                            <div className="flex items-center gap-2 whitespace-nowrap">
                              <span className="truncate">{col.name}</span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (col.type === 'standard') {
                                    if (!derivedActiveListId) return;
                                    onToggleStandardColumn?.(derivedActiveListId, col.id as any);
                                  } else {
                                    let targetListId = derivedActiveListId;
                                    if (!targetListId) {
                                      const chosen = window.prompt('Digite o ID da lista para ocultar este campo:', listIdsInView[0] ?? '');
                                      if (!chosen) return;
                                      targetListId = chosen;
                                    }
                                    if (!window.confirm(`Ocultar o campo "${col.name}" apenas nesta lista: ${targetListId}?`)) return;
                                    onHideTaskFieldForList(targetListId, col.id);
                                  }
                                }}
                                className="h-6 w-6 shrink-0 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                                title={`Ocultar ${col.name}`}
                              >
                                {col.type === 'standard' ? <Icons.EyeOff /> : <Icons.Trash />}
                              </button>
                            </div>
                            {/* Resize handle */}
                            <div
                              className="absolute right-0 top-0 h-full w-1.5 hover:bg-blue-400 hover:opacity-60 transition-colors z-10"
                              style={{ cursor: 'col-resize' }}
                              onMouseDown={(e) => handleResizeMouseDown(e, col.id)}
                              onDoubleClick={(e) => handleResizeDblClick(e, col.id)}
                            />
                          </th>
                        ))}

                        <th className="px-2 py-3 w-10 border-r border-gray-200">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onOpenManager?.();
                            }}
                            className="h-7 w-7 inline-flex items-center justify-center rounded-md border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors"
                            title="Gerenciar campos"
                          >
                            <Icons.Plus />
                          </button>
                        </th>
                        <th className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {statusTasks.slice(0, visibleRowsByStatus[status] ?? VISIBLE_ROWS_STEP).flatMap((rootTask: Task) => {
                        const renderRecursiveRows = (t: Task, depth: number = 0): React.ReactNode[] => {
                          if (depth >= 7) return [];

                          const subtasks = (tasks as Task[]).filter(child => child.parentId === t.id);
                          const hasChildren = subtasks.length > 0;
                          const isTaskExpanded = expandedTasks.has(t.id);

                          const currentRow = (
                            <tr
                              key={t.id}
                              className={`hover:bg-gray-50 cursor-pointer group transition-colors border-b border-gray-100 ${depth > 0 ? 'bg-gray-50/30' : ''} ${selectedTaskIds.has(t.id) ? 'bg-blue-50/40' : ''}`}
                              onClick={() => onSelectTask(t.id)}
                            >
                              <td className="w-10 px-3 py-3 border-r border-gray-200" onClick={e => e.stopPropagation()}>
                                <input
                                  type="checkbox"
                                  className="rounded border-gray-300 cursor-pointer"
                                  checked={selectedTaskIds.has(t.id)}
                                  onChange={() => toggleSelection(t.id)}
                                />
                              </td>
                              <td className="px-4 py-3 border-r border-gray-200 overflow-hidden" style={{ maxWidth: colWidths['tarefa'] || 300 }}>
                                <div className="flex items-center gap-2" style={{ paddingLeft: `${depth * 24}px` }}>
                                  <div
                                    className={`w-1 h-10 rounded-full shrink-0 ${t.priority === TaskPriority.URGENTE ? 'bg-red-500' : 'bg-transparent'}`}
                                  />
                                  <div className="flex items-center gap-1">
                                    {hasChildren && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          toggleTaskExpansion(t.id);
                                        }}
                                        className={`p-1 hover:bg-gray-200 rounded transition-transform ${isTaskExpanded ? 'rotate-90' : ''}`}
                                        title={isTaskExpanded ? "Recolher subtarefas" : "Expandir subtarefas"}
                                      >
                                        <Icons.ChevronRight className="w-3 h-3 text-gray-500" />
                                      </button>
                                    )}
                                    <span className={`${depth > 0 ? 'text-sm' : 'font-medium'} text-gray-800 line-clamp-1`}>
                                    {t.title}
                                    </span>
                                    {(() => {
                                      const isOwner = currentUser?.id === t.mainAssigneeId;
                                      const isPrivileged = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.GESTOR;
                                      if (!isOwner && !isPrivileged) return null;
                                      const h = getTaskHealth(t);
                                      if (!h) return null;
                                      return (
                                        <span className={`ml-1 shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${h.bg} ${h.text} ${h.border} whitespace-nowrap`}>
                                          {h.emoji} {h.label}
                                        </span>
                                      );
                                    })()}
                                    {depth < 6 && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          onQuickCreate({ parentId: t.id });
                                        }}
                                        className="ml-2 opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded text-gray-400 hover:text-gray-600 transition-all"
                                        title="Adicionar subtarefa"
                                      >
                                        <Icons.Plus className="w-3.5 h-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {orderedColumns.map((col) => {
                                if (col.type === 'standard') {
                                  switch (col.id) {
                                    case 'status':
                                      return (
                                        <td key={col.id} className="px-4 py-3 border-r border-gray-200">
                                          <span
                                            className="px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap"
                                            style={getStatusStyle(t.status)}
                                          >
                                            {t.status}
                                          </span>
                                        </td>
                                      );
                                    case 'priority':
                                      return (
                                        <td key={col.id} className="px-4 py-3 border-r border-gray-200">
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase whitespace-nowrap ${PRIORITY_COLORS[t.priority]}`}>
                                            {t.priority}
                                          </span>
                                        </td>
                                      );
                                    case 'assignee':
                                      return (
                                        <td key={col.id} className="px-4 py-3 border-r border-gray-200">
                                          <div className="flex -space-x-2">
                                            {t.mainAssigneeId ? (
                                              <img
                                                src={avatarThumb(users?.find((u: User) => u.id === t.mainAssigneeId)?.avatar) || `https://picsum.photos/seed/${t.mainAssigneeId}/100`}
                                                className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-[3] hover:z-50 transition-all cursor-pointer bg-white"
                                                alt="Assignee"
                                                title={users?.find((u: User) => u.id === t.mainAssigneeId)?.name}
                                              />
                                            ) : (
                                              <div className="w-6 h-6 rounded-full border-2 border-white bg-gray-100 flex items-center justify-center text-[10px] text-gray-400">—</div>
                                            )}
                                            {(t.secondaryAssigneeIds || []).map((id: string) => (
                                              <img
                                                key={id}
                                                src={avatarThumb(users?.find((u: User) => u.id === id)?.avatar) || `https://picsum.photos/seed/${id}/100`}
                                                className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-[3] hover:z-50 transition-all cursor-pointer bg-white"
                                                alt="Assignee"
                                                title={users?.find((u: User) => u.id === id)?.name}
                                              />
                                            ))}
                                          </div>
                                        </td>
                                      );
                                    case 'extensions':
                                      return (
                                        <td key={col.id} className="px-4 py-3 text-center border-r border-gray-200">
                                          <span className={`text-xs font-bold ${t.extensionCount > 0 ? 'text-red-500' : 'text-gray-400'}`}>
                                            {t.extensionCount}
                                          </span>
                                        </td>
                                      );
                                    case 'dueDate':
                                      return (
                                        <td key={col.id} className="px-4 py-3 text-[10px] text-gray-500 font-medium whitespace-nowrap uppercase border-r border-gray-200">
                                          {t.dueDate ? (() => { const [y, m, d] = t.dueDate.split('-'); return `${d}/${m}/${y}`; })() : '—'}
                                        </td>
                                      );
                                    default:
                                      return <td key={col.id}></td>;
                                  }
                                } else {
                                  // Custom Field Value
                                  const field = customFields.find((f: CustomField) => f.id === col.id);
                                  if (!field) return <td key={col.id}></td>;
                                  const currentValue = getFieldValue(field.id, t.id);
                                  return (
                                  <td key={col.id} className="px-4 py-3 border-r border-gray-200" onClick={(e) => e.stopPropagation()}>
                                    {field.type === CustomFieldType.FORMULA ? (
                                      <div className="text-xs font-mono text-blue-600 bg-blue-50 px-2 py-1 rounded border border-blue-100 italic">
                                        <FormulaValue
                                          formula={field.config?.formula || ''}
                                          context={{ ...t, ...Object.fromEntries(fieldValues.filter(fv => fv.entityId === t.id).map(fv => [customFields.find(f => f.id === fv.fieldId)?.name || '', fv.value])) }}
                                        />
                                      </div>
                                    ) : field.type === CustomFieldType.DROPDOWN ? (
                                        <DropdownMenu>
                                          <DropdownMenuTrigger asChild>
                                            <div className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 flex items-center justify-between cursor-pointer hover:bg-gray-50 transition-all group overflow-hidden">
                                              {(() => {
                                                const opt = field.config?.options?.find((o: CustomFieldOption) => o.id === currentValue);
                                                const IconComp = opt?.icon ? (Icons as any)[opt.icon] : null;
                                                return (
                                                  <div className="flex items-center gap-2 overflow-hidden w-full">
                                                    {opt ? (
                                                      <div
                                                        className="px-2 py-0.5 rounded text-[10px] font-bold text-white flex items-center gap-1 whitespace-nowrap overflow-hidden"
                                                        style={{ backgroundColor: opt.color }}
                                                      >
                                                        {IconComp && <IconComp className="h-3 w-3 shrink-0" color="white" />}
                                                        <span className="truncate">{opt.label}</span>
                                                      </div>
                                                    ) : (
                                                      <span className="text-[10px] text-gray-400 font-medium">—</span>
                                                    )}
                                                  </div>
                                                );
                                              })()}
                                              <Icons.ChevronDown className="h-3 w-3 text-gray-400 group-hover:text-gray-600 shrink-0 ml-1" />
                                            </div>
                                          </DropdownMenuTrigger>
                                          <DropdownMenuContent className="w-56 max-h-64 overflow-y-auto" align="end">
                                            <DropdownMenuItem onClick={() => onUpdateFieldValue(field.id, t.id, '')} className="text-xs text-gray-400 italic">
                                              — Limpar seleção
                                            </DropdownMenuItem>
                                            {field.config?.options?.map((opt: CustomFieldOption) => {
                                              const OptIcon = opt.icon ? (Icons as any)[opt.icon] : null;
                                              return (
                                                <DropdownMenuItem
                                                  key={opt.id}
                                                  onClick={() => onUpdateFieldValue(field.id, t.id, opt.id)}
                                                  className="p-1"
                                                >
                                                  <div
                                                    className="flex items-center justify-center gap-2 w-full py-1.5 rounded text-[10px] font-bold text-white transition-opacity hover:opacity-90"
                                                    style={{ backgroundColor: opt.color }}
                                                  >
                                                    {OptIcon && <OptIcon className="h-3 w-3" color="white" />}
                                                    <span>{opt.label}</span>
                                                    {currentValue === opt.id && <Icons.Check className="ml-auto h-3 w-3" color="white" />}
                                                  </div>
                                                </DropdownMenuItem>
                                              );
                                            })}
                                          </DropdownMenuContent>
                                        </DropdownMenu>
                                      ) : field.type === CustomFieldType.DATE ? (
                                        <DateFieldEditor
                                          value={currentValue}
                                          onCommit={(v) => onUpdateFieldValue(field.id, t.id, v)}
                                          className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[var(--primary-color)]"
                                        />
                                      ) : field.type === CustomFieldType.RATING ? (
                                        <BufferedRating
                                          value={currentValue}
                                          onCommit={(star) => onUpdateFieldValue(field.id, t.id, star)}
                                          className="flex gap-1"
                                        />
                                      ) : field.type === CustomFieldType.PROGRESS ? (
                                        <BufferedProgressEditor
                                          value={currentValue}
                                          onCommit={(v) => onUpdateFieldValue(field.id, t.id, v)}
                                          compact
                                        />
                                      ) : (
                                        <div className="relative">
                                          {(field.type === CustomFieldType.MONEY || field.type === CustomFieldType.CURRENCY) && (
                                            <div className="absolute left-2 top-2 text-[10px] text-gray-400 font-bold">
                                              {field.config?.currency || 'R$'}
                                            </div>
                                          )}
                                          <BufferedFieldInput
                                            type={field.type === CustomFieldType.NUMBER || field.type === CustomFieldType.MONEY || field.type === CustomFieldType.CURRENCY ? 'number' : 'text'}
                                            value={currentValue}
                                            onCommit={(v) => onUpdateFieldValue(field.id, t.id, v)}
                                            className={`h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-sm font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500 transition-all ${(field.type === CustomFieldType.MONEY || field.type === CustomFieldType.CURRENCY) ? 'pl-8' : ''}`}
                                            placeholder="—"
                                          />
                                        </div>
                                      )}
                                    </td>
                                  );
                                }
                              })}

                              <td className="px-2 py-3" />

                              <td className="px-4 py-3">
                                <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDuplicateTask?.(t);
                                    }}
                                    className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-colors"
                                    title="Duplicar Tarefa"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onDeleteTask(t.id);
                                    }}
                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                    title="Excluir Tarefa"
                                  >
                                    <Icons.Trash />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                          const rows: React.ReactNode[] = [currentRow];
                          if (isTaskExpanded && hasChildren) {
                            subtasks.forEach(child => {
                              rows.push(...renderRecursiveRows(child, depth + 1));
                            });
                          }
                          
                          // Quick Create button for subtasks (only if expanded)
                          if (isTaskExpanded) {
                            rows.push(
                              <tr key={`${t.id}-add-sub`} className="bg-gray-50/20">
                                <td className="px-4 py-2" colSpan={orderedColumns.length + 4}>
                                  <div className="flex items-center gap-2" style={{ paddingLeft: `${(depth + 1) * 24 + 24}px` }}>
                                    <button
                                      onClick={() => onQuickCreate({ parentId: t.id })}
                                      className="text-[11px] text-gray-400 hover:text-[var(--primary-color)] font-bold transition-colors flex items-center gap-2"
                                    >
                                      <Icons.Plus className="w-3 h-3" />
                                      Adicionar Subtarefa
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          }
                          return rows;
                        };

                        return renderRecursiveRows(rootTask, 0);
                      })}
                    </tbody>
                  </table>
                )}
                {isExpanded && statusTasks.length > (visibleRowsByStatus[status] ?? VISIBLE_ROWS_STEP) && (
                  <button
                    type="button"
                    onClick={() => showMoreRows(status, statusTasks.length)}
                    className="w-full px-4 py-3 text-xs font-semibold text-gray-500 hover:bg-gray-50 border-t border-gray-100 transition-colors"
                  >
                    Carregar mais {Math.min(VISIBLE_ROWS_STEP, statusTasks.length - (visibleRowsByStatus[status] ?? VISIBLE_ROWS_STEP))} de {statusTasks.length - (visibleRowsByStatus[status] ?? VISIBLE_ROWS_STEP)} restantes
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Bulk Action Bar — T701 */}
      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-900 text-white px-4 py-3 rounded-xl shadow-2xl border border-gray-700">
          <span className="text-sm font-medium whitespace-nowrap">{selectedTaskIds.size} selecionada(s)</span>
          <div className="w-px h-5 bg-gray-600" />
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { onBulkStatusChange([...selectedTaskIds], e.target.value); clearSelection(); e.target.value = ''; } }}
            className="text-sm bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white cursor-pointer"
          >
            <option value="" disabled>Status...</option>
            {activeStatusOptions.map((o: any) => (
              <option key={o.label} value={o.label}>{o.label}</option>
            ))}
          </select>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { onBulkPriorityChange([...selectedTaskIds], e.target.value as TaskPriority); clearSelection(); e.target.value = ''; } }}
            className="text-sm bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white cursor-pointer"
          >
            <option value="" disabled>Prioridade...</option>
            {Object.values(TaskPriority).map(p => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <select
            defaultValue=""
            onChange={e => { if (e.target.value) { onBulkMove([...selectedTaskIds], e.target.value); clearSelection(); e.target.value = ''; } }}
            className="text-sm bg-gray-800 border border-gray-600 rounded px-2 py-1 text-white cursor-pointer"
          >
            <option value="" disabled>Mover para...</option>
            {lists?.map((l: any) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
          <div className="w-px h-5 bg-gray-600" />
          <button
            onClick={() => { onBulkDelete([...selectedTaskIds]); clearSelection(); }}
            className="text-sm text-red-400 hover:text-red-300 px-2 transition-colors"
          >
            Deletar
          </button>
          <button
            onClick={clearSelection}
            className="text-sm text-gray-400 hover:text-white px-2 transition-colors"
          >
            ✕
          </button>
        </div>
      )}
    </div>
  );
}

function KanbanView({ tasks, onSelectTask, onStatusChange, onQuickUpdateTask, onDeleteTask, onDuplicateTask, onCreateTask, onQuickCreate, users, lists, statusGroups, activeListId, currentUser, workspaceTags }: any) {
  const draggingTaskIdRef = useRef<string | null>(null);
  const draggedColumnRef = useRef<string | null>(null);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ status: string; index: number } | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);
  const [inlineCreateCol, setInlineCreateCol] = useState<string | null>(null);
  const [inlineCreateTitle, setInlineCreateTitle] = useState('');
  const [boardSearch, setBoardSearch] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [filterAssignee, setFilterAssignee] = useState('');
  const [filterTag, setFilterTag] = useState('');
  const [showOnlyOverdue, setShowOnlyOverdue] = useState(false);
  const [quickEditTaskId, setQuickEditTaskId] = useState<string | null>(null);
  const [quickDraft, setQuickDraft] = useState<{ title: string; priority: TaskPriority; mainAssigneeId: string; dueDate: string; tags: string[] } | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  const kanbanPrefsKey = `vp_kanban_prefs_${currentUser?.id || 'anon'}_${activeListId || 'global'}`;
  const [localTaskOrder, setLocalTaskOrder] = useState<Record<string, string[]>>(() => {
    try {
      const saved = localStorage.getItem(`${kanbanPrefsKey}_tasks`);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const [localColumnOrder, setLocalColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`${kanbanPrefsKey}_columns`);
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const persistKanbanPreference = (key: string, value: unknown) => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      console.warn('Preferência local do Kanban não pôde ser salva.');
    }
  };

  useEffect(() => {
    persistKanbanPreference(`${kanbanPrefsKey}_tasks`, localTaskOrder);
  }, [kanbanPrefsKey, localTaskOrder]);

  useEffect(() => {
    persistKanbanPreference(`${kanbanPrefsKey}_columns`, localColumnOrder);
  }, [kanbanPrefsKey, localColumnOrder]);

  useEffect(() => {
    setQuickEditTaskId(null);
    setQuickDraft(null);
  }, [activeListId]);

  const activeList = lists?.find((l: any) => l.id === activeListId);
  const activeStatusGroup = statusGroups?.find((g: any) => g.id === activeList?.statusGroupId) || statusGroups?.[0];
  const activeStatusOptions = activeStatusGroup?.options || [];
  const canManageBoard = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.GESTOR;
  const availableUsers = (users || []).filter((u: User) => u?.id && u.id !== 'loading');

  const canEditTask = (task: Task) => {
    if (!currentUser) return false;
    if (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.GESTOR) return true;
    return task.mainAssigneeId === currentUser.id || (task.secondaryAssigneeIds || []).includes(currentUser.id);
  };

  const statusLabels = useMemo(() => {
    let labels: string[];
    if (activeListId && activeStatusOptions.length > 0) {
      labels = activeStatusOptions.map((o: any) => o.label);
    } else {
      const uniqueStatuses = Array.from(new Set(tasks.map((t: Task) => t.status).filter(Boolean))) as string[];
      const defaultOrder = statusGroups?.[0]?.options.map((o: any) => o.label) || [];
      labels = uniqueStatuses.sort((a, b) => {
        const idxA = defaultOrder.indexOf(a);
        const idxB = defaultOrder.indexOf(b);
        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;
        return a.localeCompare(b);
      });
    }
    const seen = new Set<string>();
    return labels.filter(label => {
      const key = label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [tasks, activeListId, JSON.stringify(activeStatusOptions), JSON.stringify(statusGroups?.[0]?.options)]);

  const columns = useMemo(() => {
    const valid = localColumnOrder.filter(status => statusLabels.includes(status));
    const missing = statusLabels.filter(status => !valid.includes(status));
    return [...valid, ...missing];
  }, [statusLabels, localColumnOrder]);

  const boardTasks = useMemo(() => {
    const q = boardSearch.trim().toLowerCase();
    return tasks.filter((task: Task) => {
      if (q) {
        const haystack = [
          task.title,
          task.description,
          task.status,
          task.priority,
          ...(task.tags || []),
          lists?.find((l: any) => l.id === task.listId)?.name || '',
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      if (filterPriority && task.priority !== filterPriority) return false;
      if (filterAssignee && task.mainAssigneeId !== filterAssignee && !(task.secondaryAssigneeIds || []).includes(filterAssignee)) return false;
      if (filterTag && !(task.tags || []).includes(filterTag)) return false;
      if (showOnlyOverdue) {
        if (!task.dueDate) return false;
        const due = parseLocalDate(task.dueDate);
        due.setHours(23, 59, 59, 999);
        if (due >= new Date()) return false;
      }
      return true;
    });
  }, [tasks, boardSearch, filterPriority, filterAssignee, filterTag, showOnlyOverdue, lists]);

  const getOrderedColumnTasks = (status: string) => {
    const columnTasks = boardTasks.filter((t: Task) => t.status?.toLowerCase() === status.toLowerCase());
    const savedOrder = localTaskOrder[status] || [];
    if (savedOrder.length === 0) return columnTasks;
    const byId = new Map(columnTasks.map((task: Task) => [task.id, task]));
    return [
      ...savedOrder.map(id => byId.get(id)).filter(Boolean),
      ...columnTasks.filter((task: Task) => !savedOrder.includes(task.id)),
    ] as Task[];
  };

  const getStatusColor = (statusLabel: string) => {
    const sLower = (statusLabel || '').toLowerCase();
    const opt = activeStatusOptions.find((o: any) => o.label?.toLowerCase() === sLower) ||
      statusGroups?.flatMap((g: any) => g.options).find((o: any) => o.label?.toLowerCase() === sLower);
    return opt?.color || '#94a3b8';
  };

  const PRIORITY_FLAG: Record<string, { color: string; label: string }> = {
    Urgente: { color: '#ef4444', label: 'Urgente' },
    Alta: { color: '#f97316', label: 'Alta' },
    Média: { color: '#3b82f6', label: 'Média' },
    Media: { color: '#3b82f6', label: 'Média' },
    Baixa: { color: '#94a3b8', label: 'Baixa' },
  };

  const activeFilterCount = [filterPriority, filterAssignee, filterTag, showOnlyOverdue].filter(Boolean).length;

  const resetBoardFilters = () => {
    setBoardSearch('');
    setFilterPriority('');
    setFilterAssignee('');
    setFilterTag('');
    setShowOnlyOverdue(false);
  };

  const resetLocalOrder = () => {
    setLocalTaskOrder({});
    setLocalColumnOrder([]);
    toast.success('Ordem visual do Kanban restaurada.');
  };

  const confirmInlineCreate = async (status: string) => {
    const title = inlineCreateTitle.trim();
    if (title) {
      // `activeListId` pode ter mudado (navegação/realtime) enquanto a caixa
      // de criação inline estava aberta — sem isso, o título digitado era
      // descartado em silêncio, sem toast nem qualquer sinal pro usuário.
      if (activeListId) {
        await onCreateTask({ title, status, listId: activeListId });
      } else {
        toast.error('Não foi possível criar a tarefa: nenhuma lista está selecionada.');
      }
    }
    setInlineCreateCol(null);
    setInlineCreateTitle('');
  };

  const openInlineCreate = (status: string) => {
    setInlineCreateCol(status);
    setInlineCreateTitle('');
    setTimeout(() => inlineInputRef.current?.focus(), 50);
  };

  const openQuickEdit = (task: Task) => {
    setQuickEditTaskId(task.id);
    setQuickDraft({
      title: task.title,
      priority: task.priority,
      mainAssigneeId: task.mainAssigneeId || '',
      dueDate: task.dueDate || '',
      tags: [...(task.tags || [])],
    });
  };

  const saveQuickEdit = async (task: Task) => {
    if (!quickDraft || savingQuickEdit) return;
    const title = quickDraft.title.trim();
    if (!title) {
      toast.error('Informe um título para a tarefa.');
      return;
    }
    setSavingQuickEdit(true);
    const ok = await onQuickUpdateTask?.(task.id, {
      title,
      priority: quickDraft.priority,
      mainAssigneeId: quickDraft.mainAssigneeId,
      dueDate: quickDraft.dueDate,
      tags: quickDraft.tags,
    });
    setSavingQuickEdit(false);
    if (ok !== false) {
      setQuickEditTaskId(null);
      setQuickDraft(null);
    }
  };

  const copyTaskLink = async (taskId: string) => {
    // Preserva o path/params já presentes (ex: espaço/pasta atual) em vez de
    // descartá-los — sem isso, o link compartilhado perdia o contexto de
    // onde a tarefa foi aberta. O sufixo /tarefa/<slug>-<id> troca (ou
    // adiciona) só o final do path — ver withTaskPathSuffix.
    const task = tasks.find(t => t.id === taskId);
    const url = new URL(window.location.href);
    url.searchParams.delete('taskId');
    url.pathname = withTaskPathSuffix(url.pathname, task);
    if (!task) url.searchParams.set('taskId', taskId); // fallback: tarefa ainda não carregada localmente
    try {
      await navigator.clipboard.writeText(url.toString());
      toast.success('Link da tarefa copiado.');
    } catch {
      toast.error('Não foi possível copiar o link.');
    }
  };

  const handleTaskDragStart = (e: React.DragEvent, taskId: string) => {
    draggingTaskIdRef.current = taskId;
    setDraggingTaskId(taskId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', taskId);
    e.dataTransfer.setData('application/x-vpclick-kanban', 'task');
  };

  const finishTaskDrag = () => {
    draggingTaskIdRef.current = null;
    setDraggingTaskId(null);
    setDragOver(null);
    setDragOverColumn(null);
  };

  const handleCardDragOver = (e: React.DragEvent, status: string, index: number) => {
    if (e.dataTransfer.types.includes('application/x-vpclick-kanban-column')) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const nextIndex = e.clientY > rect.top + rect.height / 2 ? index + 1 : index;
    setDragOver({ status, index: nextIndex });
    setDragOverColumn(status);
  };

  const handleColumnDragOver = (e: React.DragEvent, status: string, index: number) => {
    if (e.dataTransfer.types.includes('application/x-vpclick-kanban-column')) {
      e.preventDefault();
      if (draggedColumnRef.current && draggedColumnRef.current !== status) {
        setLocalColumnOrder(prev => {
          const base = prev.length ? prev.filter(s => columns.includes(s)) : columns;
          const next = [...base];
          const from = next.indexOf(draggedColumnRef.current!);
          const to = next.indexOf(status);
          if (from === -1 || to === -1 || from === to) return prev;
          next.splice(from, 1);
          next.splice(to, 0, draggedColumnRef.current!);
          return next;
        });
      }
      return;
    }
    e.preventDefault();
    setDragOver({ status, index });
    setDragOverColumn(status);
  };

  const handleDrop = async (e: React.DragEvent, status: string) => {
    e.preventDefault();
    if (e.dataTransfer.types.includes('application/x-vpclick-kanban-column')) return;
    const taskId = draggingTaskIdRef.current || e.dataTransfer.getData('text/plain');
    const task = tasks.find((t: Task) => t.id === taskId);
    if (!task || !canEditTask(task)) {
      finishTaskDrag();
      return;
    }

    const targetIndex = dragOver?.status === status ? dragOver.index : getOrderedColumnTasks(status).length;
    const previousOrder = localTaskOrder;
    setLocalTaskOrder(prev => {
      const next: Record<string, string[]> = {};
      columns.forEach(col => {
        next[col] = (prev[col] || getOrderedColumnTasks(col).map((t: Task) => t.id)).filter(id => id !== taskId);
      });
      const target = [...(next[status] || [])];
      target.splice(Math.max(0, Math.min(targetIndex, target.length)), 0, taskId);
      next[status] = target;
      return next;
    });

    if (task.status?.toLowerCase() !== status.toLowerCase()) {
      const ok = await onStatusChange(taskId, status);
      if (ok === false) setLocalTaskOrder(previousOrder);
    }
    finishTaskDrag();
  };

  const handleColumnDragStart = (e: React.DragEvent, status: string) => {
    if (!canManageBoard) return;
    draggedColumnRef.current = status;
    setDraggedColumn(status);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/x-vpclick-kanban-column', status);
  };

  const finishColumnDrag = () => {
    draggedColumnRef.current = null;
    setDraggedColumn(null);
  };

  const renderDropLine = (status: string, index: number) => (
    dragOver?.status === status && dragOver.index === index ? (
      <div className="h-2 rounded-full bg-blue-400/80 shadow-[0_0_0_3px_rgba(96,165,250,0.18)]" />
    ) : null
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 px-2 pb-4" onClick={(e) => e.stopPropagation()}>
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-sm">
        <div className="relative min-w-[220px] flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            value={boardSearch}
            onChange={(e) => setBoardSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setBoardSearch(''); }}
            placeholder="Buscar no Kanban"
            className="h-8 w-full rounded-md border border-gray-200 bg-gray-50 pl-8 pr-3 text-xs outline-none transition focus:border-blue-300 focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <select value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)} className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none">
          <option value="">Prioridade</option>
          {Object.values(TaskPriority).map(priority => <option key={priority} value={priority}>{priority}</option>)}
        </select>
        <select value={filterAssignee} onChange={(e) => setFilterAssignee(e.target.value)} className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none">
          <option value="">Responsável</option>
          {availableUsers.map((user: User) => <option key={user.id} value={user.id}>{user.name}</option>)}
        </select>
        <select value={filterTag} onChange={(e) => setFilterTag(e.target.value)} className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs text-gray-600 outline-none">
          <option value="">Tag</option>
          {(workspaceTags || []).map((tag: WorkspaceTag) => <option key={tag.id} value={tag.name}>{tag.name}</option>)}
        </select>
        <button
          onClick={() => setShowOnlyOverdue(v => !v)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition ${showOnlyOverdue ? 'border-red-200 bg-red-50 text-red-600' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}
          title="Mostrar apenas tarefas atrasadas"
        >
          <Filter className="h-3.5 w-3.5" />
          Atrasadas
        </button>
        {(activeFilterCount > 0 || boardSearch) && (
          <button onClick={resetBoardFilters} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50">
            <X className="h-3.5 w-3.5" />
            Limpar
          </button>
        )}
        <button onClick={resetLocalOrder} className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-500 hover:bg-gray-50" title="Restaurar ordem visual">
          <RotateCcw className="h-3.5 w-3.5" />
          Ordem
        </button>
      </div>

      <div className="flex min-h-0 flex-1 gap-4 overflow-x-auto pb-2 custom-scrollbar items-start">
        {columns.map(status => {
          const statusColor = getStatusColor(status);
          const columnTasks = getOrderedColumnTasks(status);
          const isColumnHot = dragOverColumn === status;

          return (
            <div
              key={status}
              data-kanban-col={status}
              className={`w-72 shrink-0 flex max-h-full flex-col rounded-lg border bg-[#f8f9fa] transition-all ${isColumnHot ? 'border-blue-300 bg-blue-50/40 shadow-md shadow-blue-100' : 'border-gray-200'} ${draggedColumn === status ? 'opacity-50' : ''}`}
              onDragOver={(e) => handleColumnDragOver(e, status, columnTasks.length)}
              onDrop={(e) => handleDrop(e, status)}
            >
              <div
                className="flex items-center justify-between px-3 pt-3 pb-2"
                draggable={canManageBoard}
                onDragStart={(e) => handleColumnDragStart(e, status)}
                onDragEnd={finishColumnDrag}
                title={canManageBoard ? 'Arraste para reordenar a coluna visualmente' : undefined}
              >
                <div className="flex min-w-0 items-center gap-2">
                  {canManageBoard && <GripVertical className="h-3.5 w-3.5 shrink-0 text-gray-300" />}
                  <span
                    className="max-w-[160px] truncate rounded px-2 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-white"
                    style={{ backgroundColor: statusColor }}
                  >
                    {status}
                  </span>
                  <span className="text-xs font-semibold text-gray-400">{columnTasks.length}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => activeListId ? openInlineCreate(status) : onQuickCreate?.({ status })}
                    className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors"
                    title="Adicionar tarefa"
                  >
                    <Icons.Plus />
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="p-1 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 transition-colors" title="Ações da coluna">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => activeListId ? openInlineCreate(status) : onQuickCreate?.({ status })}>
                        Adicionar tarefa
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={resetLocalOrder}>
                        Restaurar ordem visual
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="flex min-h-[64px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2 custom-scrollbar">
                {renderDropLine(status, 0)}
                {columnTasks.map((task: Task, index: number) => {
                  const editable = canEditTask(task);
                  const isDragging = draggingTaskId === task.id;
                  const listName = lists?.find((l: any) => l.id === task.listId)?.name;
                  const subtaskCount = tasks.filter((t: Task) => t.parentId === task.id).length;
                  const completedChecklist = (task.checklists || []).filter((item: ChecklistItem) => item.completed).length;
                  const assignee = users?.find((u: User) => u.id === task.mainAssigneeId);
                  const secondaryAssignees = (task.secondaryAssigneeIds || [])
                    .map((id: string) => users?.find((u: User) => u.id === id))
                    .filter(Boolean);
                  const allAssignees = [assignee, ...secondaryAssignees].filter(Boolean);
                  const hasDueDate = task.dueDate && !isNaN(parseLocalDate(task.dueDate).getTime());
                  const dueEnd = hasDueDate ? parseLocalDate(task.dueDate) : null;
                  if (dueEnd) dueEnd.setHours(23, 59, 59, 999);
                  const isOverdue = !!dueEnd && dueEnd < new Date() && !isDoneLikeStatus(task.status || '');
                  const priorityFlag = PRIORITY_FLAG[task.priority];
                  const h = getTaskHealth(task);
                  const isQuickEditing = quickEditTaskId === task.id && quickDraft;

                  return (
                    <React.Fragment key={task.id}>
                      <div
                        draggable={editable}
                        onDragStart={(e) => editable && handleTaskDragStart(e, task.id)}
                        onDragOver={(e) => handleCardDragOver(e, status, index)}
                        onDragEnd={finishTaskDrag}
                        onDrop={(e) => handleDrop(e, status)}
                        onClick={() => onSelectTask(task.id)}
                        className={`group relative select-none rounded-lg border bg-white transition-all ${editable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${isDragging ? 'opacity-30' : 'hover:border-gray-300 hover:shadow-sm'} ${isOverdue ? 'border-red-200' : 'border-gray-200'}`}
                        style={{ borderLeftWidth: 3, borderLeftColor: statusColor }}
                      >
                        <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                          {editable && (
                            <button
                              onClick={(e) => { e.stopPropagation(); openQuickEdit(task); }}
                              className="rounded p-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600"
                              title="Edição rápida"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                            </button>
                          )}
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                onClick={(e) => e.stopPropagation()}
                                className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                                title="Ações da tarefa"
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                              <DropdownMenuItem onClick={() => onSelectTask(task.id)}>Abrir tarefa</DropdownMenuItem>
                              {editable && <DropdownMenuItem onClick={() => openQuickEdit(task)}>Edição rápida</DropdownMenuItem>}
                              {editable && <DropdownMenuItem onClick={() => onQuickCreate?.({ parentId: task.id, status, listId: task.listId })}>Adicionar subtarefa</DropdownMenuItem>}
                              <DropdownMenuItem onClick={() => copyTaskLink(task.id)}>Copiar link</DropdownMenuItem>
                              {editable && <DropdownMenuItem onClick={() => onDuplicateTask?.(task)}>Duplicar</DropdownMenuItem>}
                              {editable && <DropdownMenuSeparator />}
                              {editable && <DropdownMenuItem className="text-red-600" onClick={() => onDeleteTask(task.id)}>Excluir</DropdownMenuItem>}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>

                        <div className="px-3 pb-2 pt-3">
                          {task.extensionCount > 0 && (
                            <div className="mb-1 flex items-center gap-1 text-[10px] font-bold text-red-500">
                              <Icons.Clock /> {task.extensionCount}x prorrogado
                            </div>
                          )}

                          <p className="mb-1 flex items-start gap-1 pr-10 text-sm font-semibold leading-snug text-gray-800 line-clamp-2">
                            {task.dependencies?.some((d: any) => d.type === 'blocked_by') && (
                              <span title="Tarefa bloqueada" className="mt-0.5 shrink-0">
                                <AlertTriangleIcon className="h-3 w-3 text-amber-400" />
                              </span>
                            )}
                            {task.recurrenceRuleId && (
                              <span title="Ocorrência de tarefa recorrente" className="mt-0.5 shrink-0">
                                <Repeat className="h-3 w-3 text-blue-400" />
                              </span>
                            )}
                            {task.title}
                          </p>

                          {(task.tags ?? []).length > 0 && (
                            <div className="mb-1.5 flex flex-wrap gap-1">
                              {(task.tags ?? []).map((tagName: string) => {
                                const tag = (workspaceTags ?? []).find((t: WorkspaceTag) => t.name === tagName);
                                if (!tag) return null;
                                return <TagBadge key={tagName} name={tag.name} color={tag.color} size="xs" />;
                              })}
                            </div>
                          )}

                          {listName && <p className="mb-2 text-[11px] text-gray-400">Em {listName}</p>}

                          {h && (
                            <div className={`mb-2 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${h.bg} ${h.text} ${h.border}`}>
                              <span>{h.emoji}</span><span>{h.label}</span>
                            </div>
                          )}

                          <div className="mt-2 flex items-center gap-3">
                            <div className="flex -space-x-1.5 items-center" title={allAssignees.map((u: any) => u.name).join(', ') || 'Sem responsável'}>
                              {allAssignees.length > 0 ? allAssignees.slice(0, 3).map((u: any) => (
                                <img key={u.id} src={avatarThumb(u.avatar) || `https://picsum.photos/seed/${u.id}/100`} className="h-5 w-5 rounded-full border-2 border-white shadow-sm" alt={u.name} />
                              )) : (
                                <UserCircle className="h-4 w-4 text-gray-300" />
                              )}
                            </div>

                            <div className={`flex items-center gap-0.5 text-[11px] font-medium ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}>
                              <CalendarDays className="h-3.5 w-3.5" />
                              <span>{hasDueDate ? (() => { const [y,m,d] = (task.dueDate as string).split('-'); return `${d}/${m}/${y.slice(2)}`; })() : '-'}</span>
                            </div>

                            <div className="flex items-center gap-0.5 text-[11px] font-medium" style={{ color: priorityFlag?.color || '#94a3b8' }} title={priorityFlag?.label || 'Sem prioridade'}>
                              <Flag className="h-3.5 w-3.5 fill-current" />
                              <span>{priorityFlag?.label || '-'}</span>
                            </div>
                          </div>
                        </div>

                        {(subtaskCount > 0 || (task.comments || []).length > 0 || (task.attachments || []).length > 0 || (task.checklists || []).length > 0) && (
                          <div className="flex items-center gap-3 border-t border-gray-100 px-3 py-1.5 text-[11px] text-gray-400">
                            {subtaskCount > 0 && <span className="inline-flex items-center gap-1"><ListPlus className="h-3 w-3" />{subtaskCount}</span>}
                            {(task.checklists || []).length > 0 && <span className="inline-flex items-center gap-1"><CheckSquare className="h-3 w-3" />{completedChecklist}/{task.checklists.length}</span>}
                            {(task.comments || []).length > 0 && <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{task.comments.length}</span>}
                            {(task.attachments || []).length > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" />{task.attachments.length}</span>}
                          </div>
                        )}

                        {isQuickEditing && (
                          <div className="space-y-2 border-t border-blue-100 bg-blue-50/40 p-2" onClick={(e) => e.stopPropagation()}>
                            <input
                              value={quickDraft.title}
                              onChange={(e) => setQuickDraft({ ...quickDraft, title: e.target.value })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') saveQuickEdit(task);
                                if (e.key === 'Escape') { setQuickEditTaskId(null); setQuickDraft(null); }
                              }}
                              className="h-8 w-full rounded-md border border-blue-200 bg-white px-2 text-xs font-medium outline-none focus:ring-2 focus:ring-blue-100"
                            />
                            <div className="grid grid-cols-2 gap-2">
                              <select value={quickDraft.priority} onChange={(e) => setQuickDraft({ ...quickDraft, priority: e.target.value as TaskPriority })} className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs">
                                {Object.values(TaskPriority).map(priority => <option key={priority} value={priority}>{priority}</option>)}
                              </select>
                              <input type="date" value={quickDraft.dueDate || ''} onChange={(e) => setQuickDraft({ ...quickDraft, dueDate: e.target.value })} className="h-8 rounded-md border border-gray-200 bg-white px-2 text-xs" />
                            </div>
                            <select value={quickDraft.mainAssigneeId} onChange={(e) => setQuickDraft({ ...quickDraft, mainAssigneeId: e.target.value })} className="h-8 w-full rounded-md border border-gray-200 bg-white px-2 text-xs">
                              {availableUsers.map((user: User) => <option key={user.id} value={user.id}>{user.name}</option>)}
                            </select>
                            {(workspaceTags || []).length > 0 && (
                              <div className="flex max-h-16 flex-wrap gap-1 overflow-y-auto">
                                {(workspaceTags || []).map((tag: WorkspaceTag) => {
                                  const active = quickDraft.tags.includes(tag.name);
                                  return (
                                    <button
                                      key={tag.id}
                                      onClick={() => setQuickDraft({
                                        ...quickDraft,
                                        tags: active ? quickDraft.tags.filter(t => t !== tag.name) : [...quickDraft.tags, tag.name],
                                      })}
                                      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${active ? 'bg-white text-gray-800' : 'bg-transparent text-gray-500 opacity-70'}`}
                                      style={{ borderColor: tag.color }}
                                    >
                                      {tag.name}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                            <div className="flex justify-end gap-1">
                              <button onClick={() => { setQuickEditTaskId(null); setQuickDraft(null); }} className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs text-gray-500 hover:bg-white">
                                <X className="h-3.5 w-3.5" /> Cancelar
                              </button>
                              <button onClick={() => saveQuickEdit(task)} disabled={savingQuickEdit} className="inline-flex h-7 items-center gap-1 rounded-md bg-blue-600 px-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
                                <Check className="h-3.5 w-3.5" /> {savingQuickEdit ? 'Salvando' : 'Salvar'}
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      {renderDropLine(status, index + 1)}
                    </React.Fragment>
                  );
                })}

                {columnTasks.length === 0 && (
                  <div className="flex h-16 items-center justify-center rounded-lg border-2 border-dashed border-gray-200 text-xs text-gray-400">
                    {boardTasks.length === 0 && (boardSearch || activeFilterCount > 0) ? 'Nada corresponde aos filtros' : 'Sem tarefas'}
                  </div>
                )}
              </div>

              {inlineCreateCol === status ? (
                <div className="border-t border-gray-100 px-2 pb-2 pt-1">
                  <input
                    ref={inlineInputRef}
                    type="text"
                    value={inlineCreateTitle}
                    onChange={e => setInlineCreateTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') confirmInlineCreate(status);
                      if (e.key === 'Escape') { setInlineCreateCol(null); setInlineCreateTitle(''); }
                    }}
                    onBlur={() => confirmInlineCreate(status)}
                    placeholder="Nome da tarefa..."
                    className="w-full rounded border border-blue-300 bg-white px-2 py-1.5 text-xs outline-none focus:ring-1 focus:ring-blue-400"
                  />
                  <p className="mt-1 px-1 text-[10px] text-gray-400">Enter para salvar · Esc para cancelar</p>
                </div>
              ) : (
                <button
                  onClick={() => activeListId ? openInlineCreate(status) : onQuickCreate?.({ status })}
                  className="flex w-full items-center gap-2 rounded-b-lg border-t border-gray-100 px-3 py-2.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                >
                  <Icons.Plus />
                  Adicionar Tarefa
                </button>
              )}
            </div>
          );
        })}

        <div className="w-64 shrink-0">
          <button
            className="flex w-full items-center gap-2 rounded-lg border-2 border-dashed border-gray-200 px-4 py-3 text-sm text-gray-400 transition-all hover:border-gray-300 hover:bg-white hover:text-gray-600"
            title="Os grupos seguem os status configurados da lista"
          >
            <Icons.Plus />
            Adicionar grupo
          </button>
        </div>
      </div>
    </div>
  );
}

function DashboardView({ tasks, users, statusGroups, activeListId, lists, allLists, isLoading, isAdmin }: any) {
  // Resolve CSS custom property so Recharts SVG fill works correctly
  const primaryChartColor = useMemo(() => {
    const val = getComputedStyle(document.documentElement).getPropertyValue('--primary').trim();
    return val ? `hsl(${val})` : '#f5c518';
  }, []);

  // --- Period filter ---
  type PeriodKey = '7d' | '30d' | '90d' | 'all';
  const [period, setPeriod] = useState<PeriodKey>('all');

  const activeList = lists?.find((l: any) => l.id === activeListId);
  const activeStatusGroup = statusGroups?.find((g: any) => g.id === activeList?.statusGroupId) || statusGroups?.[0];
  const activeStatusOptions = activeStatusGroup?.options || [];

  // --- Resumo agregado (Total/Concluídas/Atrasadas/Em Dia/Aguardando/
  // Prorrogadas, Radar de Saúde, pizza de status, ranking por usuário,
  // distribuição por prioridade e resumo por lista) ---
  //
  // Calculado no banco (get_dashboard_summary), NÃO a partir de `tasks`: o
  // Dashboard global pode ter dezenas de milhares de tarefas, e baixar uma
  // linha por tarefa só pra somar esses números deixava a tela em branco no
  // primeiro carregamento (achado de QA — o carregamento de `tasks` nem
  // chegava a acontecer nesse escopo). `tasks` continua sendo usado só pela
  // "Atividade Recente" mais abaixo, que precisa dos registros de verdade
  // (não dá pra agregar no banco uma lista de itens individuais).
  const [summaryRows, setSummaryRows] = useState<taskRepo.DashboardSummaryRow[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    taskRepo.fetchDashboardSummary(period).then(rows => {
      if (!cancelled) setSummaryRows(rows ?? []);
    });
    return () => { cancelled = true; };
  }, [period]);

  const summaryTotal = useMemo(() => (summaryRows || []).reduce((s, r) => s + r.count, 0), [summaryRows]);

  // --- Health buckets (usa health_key já classificado no banco — mesmas
  // categorias de getTaskHealth, ver migration get_dashboard_summary) ---
  const HEALTH_BUCKET_META: Record<string, { label: string; emoji: string; color: string; bg: string }> = {
    done:      { label: 'Missão cumprida',        emoji: '🎉', color: '#10b981', bg: '#d1fae5' },
    ok:        { label: 'Tranquilo, em dia',      emoji: '😄', color: '#3b82f6', bg: '#dbeafe' },
    warning:   { label: 'Atenção ao prazo',       emoji: '😅', color: '#f59e0b', bg: '#fef9c3' },
    urgent:    { label: 'Cuidado, últimos dias',  emoji: '😰', color: '#f97316', bg: '#ffedd5' },
    late:      { label: 'Atrasado! Corra',        emoji: '😡', color: '#ef4444', bg: '#fee2e2' },
    waiting:   { label: 'Aguardando início',      emoji: '⏰', color: '#6b7280', bg: '#f3f4f6' },
    blocked:   { label: 'Aguardando / Em espera', emoji: '⏳', color: '#8b5cf6', bg: '#ede9fe' },
    cancelled: { label: 'Cancelado / Reprovado',  emoji: '🚫', color: '#9ca3af', bg: '#f3f4f6' },
    nodate:    { label: 'Sem prazo definido',     emoji: '—',  color: '#d1d5db', bg: '#f9fafb' },
  };
  const healthBuckets = useMemo(() => {
    const counts: Record<string, number> = {};
    Object.keys(HEALTH_BUCKET_META).forEach(k => { counts[k] = 0; });
    (summaryRows || []).forEach(r => { counts[r.healthKey] = (counts[r.healthKey] || 0) + r.count; });
    return Object.entries(HEALTH_BUCKET_META).map(([key, meta]) => ({ ...meta, count: counts[key] || 0 }));
  }, [summaryRows]);

  const totalWithHealth = summaryTotal || 1;

  // --- Status distribution (grupos consolidados — evita torta com 13 fatias) ---
  const STATUS_GROUPS_DASH = [
    { name: '✅ Concluído',    color: '#10b981', test: (s: string) => s.includes('conclu') || s.includes('aprovado') || s.includes('fechado') },
    { name: '⏳ Aguardando',   color: '#8b5cf6', test: (s: string) => s.includes('aguardando') || s.includes('pendente') || s.includes('enviada') || s.includes('em espera') || s.includes('bloqueada') || s.includes('em analise') || s.includes('em análise') },
    { name: '📋 A Fazer',      color: '#6b7280', test: (s: string) => s.includes('a fazer') || s.includes('semana') || s.includes('backlog') || s.includes('todo') },
    { name: '🔄 Em Andamento', color: '#3b82f6', test: (s: string) => s.includes('andamento') || s.includes('progresso') || s.includes('revisão') || s.includes('revisao') || s.includes('em revisão') },
    { name: '🚫 Cancelado',    color: '#ef4444', test: (s: string) => s.includes('cancel') || s.includes('reprova') },
  ];
  const statusData = useMemo(() => {
    const groups = STATUS_GROUPS_DASH.map(g => ({
      name: g.name,
      value: (summaryRows || []).filter(r => g.test((r.status || '').toLowerCase())).reduce((sum, r) => sum + r.count, 0),
      color: g.color,
    }));
    // Status que não batem em nenhum grupo (ex.: "Aberto", "Não Iniciado") ainda
    // contam no Total do KPI — sem esse catch-all a pizza somava menos que o total.
    const semGrupo = summaryTotal - groups.reduce((sum, g) => sum + g.value, 0);
    if (semGrupo > 0) groups.push({ name: '📌 Outros', value: semGrupo, color: '#94a3b8' });
    return groups.filter(d => d.value > 0);
  }, [summaryRows, summaryTotal]);

  // --- User performance ---
  const userPerformance = useMemo(() =>
    users
      .map((u: User) => {
        const rows = (summaryRows || []).filter(r => r.mainAssigneeId === u.id);
        const totalU = rows.reduce((s, r) => s + r.count, 0);
        const concluidasU = rows.filter(r => r.healthKey === 'done').reduce((s, r) => s + r.count, 0);
        const atrasadasU = rows.filter(r => r.healthKey === 'late').reduce((s, r) => s + r.count, 0);
        return {
          name: u.name.split(' ')[0],
          fullName: u.name,
          avatar: u.avatar,
          total: totalU,
          concluidas: concluidasU,
          atrasadas: atrasadasU,
        };
      })
      .filter((u: any) => u.total > 0)
      // Ranking por desempenho: quem mais concluiu (primário) → maior taxa (desempate)
      .sort((a: any, b: any) => {
        if (b.concluidas !== a.concluidas) return b.concluidas - a.concluidas;
        const taxaA = a.total > 0 ? a.concluidas / a.total : 0;
        const taxaB = b.total > 0 ? b.concluidas / b.total : 0;
        return taxaB - taxaA;
      })
  , [summaryRows, users]);

  // --- Priority breakdown ---
  const PRIORITY_CFG = [
    { key: 'URGENTE',        label: '🔴 Urgente',       color: '#ef4444' },
    { key: 'ALTA',           label: '🟠 Alta',           color: '#f97316' },
    { key: 'MÉDIA',          label: '🟡 Média',          color: '#f59e0b' },
    { key: 'BAIXA',          label: '🔵 Baixa',          color: '#3b82f6' },
    { key: 'SEM PRIORIDADE', label: '⚪ Sem prioridade', color: '#9ca3af' },
  ];
  // Remove acentos antes de comparar: o banco tem grafias inconsistentes para a
  // mesma prioridade (ex.: "Média" e "Media" sem acento), que sem isso caíam
  // incorretamente em "Sem prioridade".
  const normalizePriorityKey = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  const priorityData = useMemo(() => {
    const counts: Record<string, number> = {};
    PRIORITY_CFG.forEach(c => { counts[normalizePriorityKey(c.key)] = 0; });
    (summaryRows || []).forEach(r => {
      const p = normalizePriorityKey(r.priority || 'SEM PRIORIDADE');
      if (counts[p] !== undefined) counts[p] += r.count;
      else counts[normalizePriorityKey('SEM PRIORIDADE')] += r.count;
    });
    return PRIORITY_CFG
      .map(c => ({ name: c.label, color: c.color, count: counts[normalizePriorityKey(c.key)] }))
      .filter(d => d.count > 0);
  }, [summaryRows]);

  // --- KPI values ---
  const total = summaryTotal;
  const concluidas = healthBuckets.find(b => b.emoji === '🎉')?.count || 0;
  const atrasadas = healthBuckets.find(b => b.emoji === '😡')?.count || 0;
  const emDia = healthBuckets.find(b => b.emoji === '😄')?.count || 0;
  const aguardando = healthBuckets.find(b => b.emoji === '⏳')?.count || 0;
  const prorrogadas = useMemo(() => (summaryRows || []).filter(r => r.isExtended).reduce((s, r) => s + r.count, 0), [summaryRows]);
  const taxaConclusao = total > 0 ? Math.round((concluidas / total) * 100) : 0;

  // --- Resumo por lista (todos os projetos) — usa allLists (dados globais) ---
  const listSummary = useMemo(() => {
    // Prefere allLists (carregado globalmente) → cai no lists local como fallback
    const availLists = (allLists && allLists.length > 0) ? allLists : (lists || []);
    const map = new Map<string, { name: string; total: number; done: number }>();
    (summaryRows || []).forEach(r => {
      if (!r.listId) return;
      const list = availLists.find((l: any) => l.id === r.listId);
      if (!list) return;
      const cur = map.get(r.listId) || { name: list.name, total: 0, done: 0 };
      map.set(r.listId, {
        name: list.name,
        total: cur.total + r.count,
        done: cur.done + (r.healthKey === 'done' ? r.count : 0),
      });
    });
    return Array.from(map.values())
      .filter(l => l.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);
  }, [summaryRows, lists, allLists]);

  // --- Atividade recente (últimas mudanças de status — usa tasks completo, não filtrado por período) ---
  const recentActivity = useMemo(() => {
    const acts: { taskTitle: string; type: string; newValue: string; createdAt: string }[] = [];
    tasks.forEach((t: Task) => {
      (t.activities || []).forEach((a: any) => {
        if (a.type === 'status_changed') {
          acts.push({ taskTitle: t.title, type: a.type, newValue: a.newValue, createdAt: a.createdAt });
        }
      });
    });
    return acts
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 8);
  }, [tasks]);

  // Loading state: mostra skeleton enquanto carrega dados globais pela primeira
  // vez — `summaryRows === null` cobre o resumo agregado (get_dashboard_summary,
  // widgets principais), `isLoading` cobre `tasks` (só usado por "Atividade
  // Recente" abaixo).
  if (summaryRows === null || isLoading) {
    return (
      <div className="flex flex-col gap-6 animate-pulse">
        <div className="h-8 bg-gray-100 rounded-lg w-48 ml-auto" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-28 bg-gray-100 rounded-xl" />
          ))}
        </div>
        <div className="h-40 bg-gray-100 rounded-xl" />
        <div className="grid grid-cols-3 gap-6">
          <div className="h-72 bg-gray-100 rounded-xl col-span-2" />
          <div className="h-72 bg-gray-100 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" onClick={(e) => e.stopPropagation()}>

      {/* ── Period Filter ── */}
      <div className="flex items-center gap-2 justify-end">
        <span className="text-xs text-gray-400 font-medium">Período:</span>
        {([['7d','7 dias'],['30d','30 dias'],['90d','90 dias'],['all','Todos']] as [PeriodKey, string][]).map(([k, l]) => (
          <button
            key={k}
            onClick={() => setPeriod(k)}
            className={`px-3 py-1 text-xs rounded-full font-semibold transition-all border ${period === k ? 'bg-[var(--primary-color)] text-gray-800 border-[var(--primary-color)]' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}
          >{l}</button>
        ))}
      </div>

      {/* ── Row 1: KPI Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {[
          { emoji: '📋', title: 'Total', value: total, sub: isAdmin ? 'tarefas no workspace' : 'tarefas visíveis para você', bg: 'bg-blue-50', text: 'text-blue-700' },
          { emoji: '🎉', title: 'Concluídas', value: concluidas, sub: `${taxaConclusao}% do total`, bg: 'bg-green-50', text: 'text-green-700' },
          { emoji: '😡', title: 'Atrasadas', value: atrasadas, sub: 'passaram do prazo', bg: 'bg-red-50', text: 'text-red-700' },
          { emoji: '😄', title: 'Em Dia', value: emDia, sub: 'dentro do prazo', bg: 'bg-sky-50', text: 'text-sky-700' },
          { emoji: '⏳', title: 'Aguardando', value: aguardando, sub: 'em espera / bloqueadas', bg: 'bg-purple-50', text: 'text-purple-700' },
          { emoji: '⚠️', title: 'Prorrogadas', value: prorrogadas, sub: 'tiveram extensão de prazo', bg: 'bg-yellow-50', text: 'text-yellow-700' },
        ].map(k => (
          <div key={k.title} className={`${k.bg} rounded-xl p-4 border border-white shadow-sm flex flex-col gap-1 hover:scale-[1.03] transition-transform`}>
            <span className="text-2xl">{k.emoji}</span>
            <p className={`text-2xl font-black ${k.text}`}>{k.value}</p>
            <p className="text-xs font-bold text-gray-600">{k.title}</p>
            <p className="text-[10px] text-gray-400">{k.sub}</p>
          </div>
        ))}
      </div>

      {/* ── Row 2: Health Radar (full width) ── */}
      <div className="bg-white rounded-xl border shadow-sm p-6">
        <h2 className="font-bold text-gray-700 mb-5 flex items-center gap-2 text-base">
          🩺 Radar de Saúde das Tarefas
          <span className="ml-auto text-xs text-gray-400 font-normal">{total} tarefa{total !== 1 ? 's' : ''} · {period === 'all' ? 'todos os tempos' : `últimos ${period.replace('d',' dias')}`}</span>
        </h2>
        <div className="flex flex-col gap-3">
          {healthBuckets.filter(b => b.count > 0).map(b => {
            const pct = Math.round((b.count / totalWithHealth) * 100);
            return (
              <div key={b.label} className="flex items-center gap-3">
                <span className="text-xl w-7 shrink-0 text-center">{b.emoji}</span>
                <span className="text-xs font-medium text-gray-600 w-44 shrink-0">{b.label}</span>
                <div className="flex-1 bg-gray-100 rounded-full h-5 overflow-hidden">
                  <div
                    className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                    style={{ width: `${Math.max(pct, 4)}%`, backgroundColor: b.color }}
                  >
                    <span className="text-[10px] font-bold text-white">{pct > 8 ? `${pct}%` : ''}</span>
                  </div>
                </div>
                <span className="text-xs font-bold text-gray-700 w-12 text-right shrink-0">{b.count} tarefa{b.count !== 1 ? 's' : ''}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Row 3: Performance + Status ── */}
      <React.Suspense
        fallback={
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-pulse">
            <div className="bg-white p-6 rounded-xl border shadow-sm lg:col-span-2">
              <div className="h-5 bg-gray-100 rounded w-56 mb-5" />
              <div className="h-[260px] bg-gray-100 rounded-xl" />
            </div>
            <div className="bg-white p-6 rounded-xl border shadow-sm">
              <div className="h-5 bg-gray-100 rounded w-44 mb-5" />
              <div className="h-[200px] bg-gray-100 rounded-xl" />
            </div>
          </div>
        }
      >
        <DashboardCharts
          userPerformance={userPerformance}
          statusData={statusData}
          total={total}
          primaryChartColor={primaryChartColor}
        />
      </React.Suspense>

      {/* ── Row 4: Priority breakdown + Team Ranking ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl border shadow-sm">
          <h2 className="font-bold text-gray-700 mb-5">🔥 Distribuição por Prioridade</h2>
          <div className="flex flex-col gap-4">
            {priorityData.map(p => {
              const pct = Math.round((p.count / (total || 1)) * 100);
              return (
                <div key={p.name} className="flex flex-col gap-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-gray-700">{p.name}</span>
                    <span className="text-gray-400">{pct}% · <span className="font-bold text-gray-700">{p.count}</span> tarefas</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-5 overflow-hidden">
                    <div className="h-full rounded-full flex items-center justify-end pr-2 transition-all duration-500"
                      style={{ width: `${Math.max(pct, 3)}%`, backgroundColor: p.color }}>
                      {pct > 10 && <span className="text-[10px] font-bold text-white">{pct}%</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Nota de contexto */}
          <p className="text-[10px] text-gray-400 mt-5 text-center">Baseado em {total} tarefas do workspace</p>
        </div>

        <div className="bg-white p-6 rounded-xl border shadow-sm">
          <h2 className="font-bold text-gray-700 mb-1">🏆 Ranking da Equipe</h2>
          <p className="text-[10px] text-gray-400 mb-4">Ordenado por tarefas concluídas</p>
          <div className="flex flex-col gap-2">
            {userPerformance.slice(0, 7).map((u: any, i: number) => {
              const taxa = u.total > 0 ? Math.round((u.concluidas / u.total) * 100) : 0;
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`;
              const barColor = taxa >= 80 ? '#10b981' : taxa >= 50 ? '#3b82f6' : taxa >= 30 ? '#f59e0b' : '#ef4444';
              return (
                <div key={u.fullName} className="flex items-center gap-3 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                  <span className="text-base w-7 text-center shrink-0">{medal}</span>
                  <img src={avatarThumb(u.avatar) || `https://picsum.photos/seed/${u.fullName}/100`} className="w-7 h-7 rounded-full border shrink-0" alt={u.name} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{u.fullName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <div className="flex-1 bg-gray-100 rounded-full h-2">
                        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${taxa}%`, backgroundColor: barColor }} />
                      </div>
                      <span className="text-[10px] font-bold shrink-0" style={{ color: barColor }}>{taxa}%</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-bold text-gray-700">{u.concluidas}<span className="text-gray-400 font-normal">/{u.total}</span></p>
                    {u.atrasadas > 0 && <p className="text-[10px] text-red-500">😡 {u.atrasadas}</p>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── Row 5: Resumo por Lista + Atividade Recente ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

        {/* Resumo por lista/projeto */}
        <div className="bg-white p-6 rounded-xl border shadow-sm">
          <h2 className="font-bold text-gray-700 mb-5">📁 Resumo por Lista / Projeto</h2>
          {listSummary.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhuma tarefa com lista atribuída.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {listSummary.map(l => {
                const pct = l.total > 0 ? Math.round((l.done / l.total) * 100) : 0;
                return (
                  <div key={l.name} className="flex items-center gap-3">
                    <span className="text-xs font-medium text-gray-600 w-36 shrink-0 truncate" title={l.name}>{l.name}</span>
                    <div className="flex-1 bg-gray-100 rounded-full h-4 overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${Math.max(pct, 2)}%`, backgroundColor: pct === 100 ? '#10b981' : pct >= 60 ? '#3b82f6' : pct >= 30 ? '#f59e0b' : '#ef4444' }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-10 text-right shrink-0">{pct}%</span>
                    <span className="text-[10px] text-gray-400 w-14 text-right shrink-0">{l.done}/{l.total}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Atividade recente */}
        <div className="bg-white p-6 rounded-xl border shadow-sm">
          <h2 className="font-bold text-gray-700 mb-5">⚡ Atividade Recente</h2>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-8">Nenhuma atividade registrada no período.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {recentActivity.map((a, i) => {
                const statusColor = (a.newValue || '').toLowerCase().includes('conclu') ? '#10b981'
                  : (a.newValue || '').toLowerCase().includes('andamento') ? '#3b82f6'
                  : (a.newValue || '').toLowerCase().includes('cancel') ? '#6b7280'
                  : '#f59e0b';
                const dt = new Date(a.createdAt);
                const label = dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
                return (
                  <div key={i} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: statusColor }} />
                    <p className="flex-1 text-xs text-gray-700 truncate" title={a.taskTitle}>{a.taskTitle}</p>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 text-white" style={{ backgroundColor: statusColor }}>
                      {a.newValue}
                    </span>
                    <span className="text-[10px] text-gray-400 shrink-0">{label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fonte dos dados */}
      <p className="text-center text-[10px] text-gray-300 pb-2">
        {isAdmin ? 'Dashboard global' : 'Seu dashboard'} · {total} tarefas · dados em tempo real do Supabase
      </p>
    </div>
  );
}

function CreateTaskModal({ onClose, onCreate, users, spaces, folders, lists, initialScope, activeListId, currentUser, prefilledData, additionalTasks, statusGroups }: any) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<string>('');
  const [priority, setPriority] = useState<TaskPriority>(TaskPriority.MEDIA);
  const [mainAssigneeId, setMainAssigneeId] = useState(currentUser.id);
  const [secondaryAssigneeIds, setSecondaryAssigneeIds] = useState<string[]>([]);
  const [assigneeSearch, setAssigneeSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [duration, setDuration] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const todayLabel = new Date().toLocaleDateString('pt-BR');

  // Esc fecha este modal (não tinha nenhum jeito de fechar por teclado antes).
  // Ouve na fase de CAPTURA (como o próprio Radix faz) e marca o evento como
  // tratado (`preventDefault`) antes que ele chegue no listener de Esc do
  // TaskDetailModal por baixo (que abre este modal pra criar subtarefa) — sem
  // isso, fechar "+ Nova Subtarefa" com Esc fechava o detalhe da tarefa junto
  // (achado de review). Ignora quando o foco está num campo de texto, pra não
  // fechar o formulário sozinho por reflexo.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // Duração é opcional, mas se preenchida precisa ser um número de dias (ex: 5)
  // ou horas no formato `3h`. Qualquer outra coisa (ex: `abc`) é sinalizada.
  const trimmedDuration = duration.trim();
  const durationError = trimmedDuration !== '' &&
    !/^\d+(\.\d+)?\s*h$/i.test(trimmedDuration) &&
    !/^\d+(\.\d+)?$/.test(trimmedDuration)
      ? 'Duração inválida. Use um número de dias (ex: 5) ou horas (ex: 3h).'
      : '';

  const handleStartOrDurationChange = (newStart: string, newDuration: string) => {
    if (!newStart || !newDuration.trim()) return;
    const isHours = /^\d+(\.\d+)?\s*h$/i.test(newDuration.trim());
    const numericValue = parseFloat(newDuration);
    if (isNaN(numericValue) || numericValue <= 0) return;
    // newStart é "YYYY-MM-DD" (sem hora); `new Date(newStart)` interpreta
    // isso como meia-noite UTC, o que em fusos atrás de UTC (ex: Brasil)
    // faz `getDate()`/`setDate()` operarem no dia anterior. Usamos o parser
    // local do app para não perder um dia no cálculo da data limite.
    const d = parseLocalDate(newStart);
    if (isHours) {
      // Horas: mantém o mesmo dia da data de início
      setDueDate(newStart);
    } else {
      // Dias: soma à data de início
      d.setDate(d.getDate() + Math.round(numericValue));
      setDueDate(formatLocalDate(d));
    }
  };

  // Hierarchy Selection State
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');
  const [selectedFolderId, setSelectedFolderId] = useState<string>('');
  const [selectedListId, setSelectedListId] = useState<string>('');

  // Prazo pré-preenchido (ex: ao clicar num dia no Calendário). Continua
  // editável até o usuário informar início/duração, que aí recalcula e
  // sobrescreve esse valor.
  useEffect(() => {
    if (prefilledData?.dueDate) setDueDate(prefilledData.dueDate);
  }, [prefilledData?.dueDate]);

  // Initialize selection based on current scope or prefilled data
  useEffect(() => {
    if (prefilledData?.parentId) {
      // Tenta achar a tarefa pai em additionalTasks; usa prefilledData.listId como fallback direto
      const parentTask = additionalTasks.find((t: Task) => t.id === prefilledData.parentId);
      const resolvedListId = parentTask?.listId || prefilledData.listId || '';
      if (resolvedListId) {
        setSelectedListId(resolvedListId);
        // Tenta resolver space/folder para o dropdown visual (não bloqueia o salvamento)
        const list = lists.find((l: List) => l.id === resolvedListId);
        if (list) {
          const folder = folders.find((f: Folder) => f.id === list.folderId);
          if (folder) {
            setSelectedSpaceId(folder.spaceId);
            setSelectedFolderId(folder.id);
          }
        }
      }
    } else if (activeListId) {
      // Se há uma lista ativa selecionada na sidebar, usá-la diretamente.
      // Lista pessoal (ver migration 18) não tem pasta — sem o list.folderId
      // resolver pra um folder de verdade, o cascading Espaço→Pasta→Lista
      // nunca achava a lista e selectedListId ficava vazio, bloqueando a
      // criação de tarefa com "Selecione um Espaço, Pasta e Lista". Seta
      // selectedListId sempre que a lista existir; espaço/pasta só quando
      // aplicável (a lista pessoal fica sem esses dois, o que é esperado).
      const list = lists.find((l: List) => l.id === activeListId);
      if (list) {
        setSelectedListId(activeListId);
        const folder = folders.find((f: Folder) => f.id === list.folderId);
        if (folder) {
          setSelectedSpaceId(folder.spaceId);
          setSelectedFolderId(folder.id);
        }
      }
    } else if (initialScope.type === 'space') {
      setSelectedSpaceId(initialScope.id || '');
    } else if (initialScope.type === 'folder') {
      // Need to find spaceId for this folder
      const folder = folders.find((f: Folder) => f.id === initialScope.id);
      if (folder) {
        setSelectedSpaceId(folder.spaceId);
        setSelectedFolderId(folder.id);
      }
    }
  }, [initialScope, folders, prefilledData, additionalTasks, lists, activeListId]);

  // Derived Options
  const availableFolders = useMemo(() => folders.filter((f: Folder) => f.spaceId === selectedSpaceId), [folders, selectedSpaceId]);
  const availableLists = useMemo(() => lists.filter((l: List) => l.folderId === selectedFolderId), [lists, selectedFolderId]);

  // NÃO auto-selecionamos o primeiro espaço: no escopo global isso apontava para
  // um espaço REAL (ex.: SUPRIMENTOS) e o usuário podia criar tarefa em produção
  // sem perceber. O espaço só é pré-selecionado quando vem de um contexto explícito
  // (lista/pasta/espaço ativos ou subtarefa) — ver o efeito de inicialização acima.

  // Auto-select primeira pasta disponível quando nenhuma está selecionada
  // (só dispara após um espaço ter sido escolhido deliberadamente)
  useEffect(() => {
    if (availableFolders.length > 0 && !selectedFolderId) {
      setSelectedFolderId(availableFolders[0].id);
    }
  }, [availableFolders, selectedFolderId]);

  // Auto-select primeira lista disponível quando nenhuma está selecionada
  useEffect(() => {
    if (availableLists.length > 0 && !selectedListId) {
      setSelectedListId(availableLists[0].id);
    }
  }, [availableLists, selectedListId]);

  const currentStatusOptions = useMemo(() => {
    const list = lists.find((l: List) => l.id === selectedListId);
    if (!list) return [];
    const group = statusGroups.find((g: StatusGroup) => g.id === list.statusGroupId) || statusGroups[0];
    return group?.options || [];
  }, [selectedListId, lists, statusGroups]);

  useEffect(() => {
    if (currentStatusOptions.length > 0 && !status) {
      setStatus(currentStatusOptions[0].label);
    } else if (currentStatusOptions.length > 0 && !currentStatusOptions.find(o => o.label === status)) {
      // Se a lista mudou e o status atual não existe na nova lista, resetar para o primeiro
      setStatus(currentStatusOptions[0].label);
    }
  }, [currentStatusOptions, status]);

  const handleSubmit = async () => {
    // Guarda contra duplo-envio: enquanto o insert está em andamento, novos
    // cliques são ignorados (evita criar a mesma tarefa várias vezes).
    if (isSubmitting) return;

    if (!title.trim()) {
      toast.error('Informe o nome da tarefa.');
      return;
    }

    if (durationError) {
      toast.error(durationError);
      return;
    }

    // Se uma pasta foi escolhida mas não existe lista, direcionamos o usuário a criar uma lista primeiro.
    if (selectedFolderId && availableLists.length === 0) {
      toast.error('Esta pasta ainda não tem listas. Crie uma lista na sidebar e depois crie a tarefa.');
      return;
    }

    if (!selectedListId) {
      toast.error('Selecione um Espaço, Pasta e Lista antes de criar a tarefa.');
      return;
    }

    setIsSubmitting(true);
    try {
      await onCreate({
        title,
        description,
        status,
        priority,
        mainAssigneeId,
        secondaryAssigneeIds,
        startDate: startDate || undefined,
        dueDate: dueDate || undefined,
        listId: selectedListId,
        parentId: prefilledData?.parentId
      });
    } finally {
      // No sucesso o modal é desmontado pelo componente pai; no erro,
      // reabilitamos o botão para o usuário poder tentar de novo.
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={(e) => e.stopPropagation()}>
      <div role="dialog" aria-modal="true" aria-labelledby="create-task-title" className="bg-white w-full max-w-2xl flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in duration-200 max-h-[90vh]">
        <div className="p-6 border-b flex items-center justify-between bg-gray-50">
          <div>
            <h3 id="create-task-title" className="text-lg font-bold text-gray-800">
              {prefilledData?.parentId ? 'Adicionar Subtarefa' : 'Criar Nova Tarefa'}
            </h3>
            {prefilledData?.parentId && (
              <p className="text-xs text-gray-500 mt-1">
                Tarefa Superior: <span className="font-semibold">{additionalTasks.find((t: Task) => t.id === prefilledData.parentId)?.title}</span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
          {/* Hierarchy Selection */}
          <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl border ${!selectedListId ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-100'}`}>
            {!selectedListId && (
              <div className="sm:col-span-2 flex items-center gap-2 text-amber-700 text-xs font-semibold mb-1">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                Selecione Espaço → Pasta → Lista para habilitar a criação
              </div>
            )}
            <div>
              <label className={`text-xs font-bold uppercase ${!selectedSpaceId ? 'text-amber-600' : 'text-gray-400'}`}>Espaço *</label>
              <select
                required
                aria-required="true"
                className={`w-full p-2 border rounded mt-1 text-sm bg-white focus:ring-2 focus:ring-[var(--primary-color)] outline-none ${!selectedSpaceId ? 'border-amber-300' : ''}`}
                value={selectedSpaceId}
                onChange={(e) => { setSelectedSpaceId(e.target.value); setSelectedFolderId(''); setSelectedListId(''); }}
              >
                <option value="">Selecione...</option>
                {spaces.map((s: Space) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className={`text-xs font-bold uppercase ${selectedSpaceId && !selectedFolderId ? 'text-amber-600' : 'text-gray-400'}`}>Pasta *</label>
              <select
                required
                aria-required="true"
                className={`w-full p-2 border rounded mt-1 text-sm bg-white focus:ring-2 focus:ring-[var(--primary-color)] outline-none ${selectedSpaceId && !selectedFolderId ? 'border-amber-300' : ''}`}
                value={selectedFolderId}
                onChange={(e) => { setSelectedFolderId(e.target.value); setSelectedListId(''); }}
                disabled={!selectedSpaceId}
              >
                <option value="">Selecione...</option>
                {availableFolders.map((f: Folder) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className={`text-xs font-bold uppercase ${selectedFolderId && !selectedListId ? 'text-amber-600' : 'text-gray-400'}`}>Lista *</label>
              <select
                required
                aria-required="true"
                className={`w-full p-2 border rounded mt-1 text-sm bg-white focus:ring-2 focus:ring-[var(--primary-color)] outline-none ${selectedFolderId && !selectedListId ? 'border-amber-300' : ''}`}
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                disabled={!selectedFolderId || availableLists.length === 0}
              >
                <option value="">Selecione uma lista...</option>
                {availableLists.map((l: List) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs font-bold text-gray-400 uppercase">Nome da Tarefa *</label>
              <input
                type="text"
                required
                aria-required="true"
                className="w-full p-3 border rounded-lg mt-1 text-lg font-medium focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="O que precisa ser feito?"
                autoFocus
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase">Status</label>
                <select
                  className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  {currentStatusOptions.map(o => <option key={o.id} value={o.label}>{o.label}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase">Prioridade</label>
                <select
                  className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as TaskPriority)}
                >
                  {Object.values(TaskPriority).map(p => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div className="col-span-1 sm:col-span-2">
                <label className="text-xs font-bold text-gray-400 uppercase">Responsáveis</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-1">
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold mb-1">Principal</p>
                    <select
                      className="w-full p-2 border rounded text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                      value={mainAssigneeId}
                      onChange={(e) => setMainAssigneeId(e.target.value)}
                    >
                      {[...users].filter((u: User) => u.email !== AI_AGENT_EMAIL || u.id === mainAssigneeId).sort((a: User, b: User) => a.name.localeCompare(b.name, 'pt-BR')).map((u: User) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold mb-1">Adicionais</p>
                    <input
                      type="text"
                      value={assigneeSearch}
                      onChange={e => setAssigneeSearch(e.target.value)}
                      placeholder="Pesquisar..."
                      className="w-full text-xs border rounded px-2 py-1 mb-1 bg-white focus:outline-none focus:ring-1 focus:ring-[var(--primary-color)]"
                    />
                    <div className="max-h-32 overflow-y-auto border rounded p-2 bg-gray-50 space-y-1 custom-scrollbar">
                      {users
                        .filter((u: User) => u.id !== mainAssigneeId)
                        .filter((u: User) => u.email !== AI_AGENT_EMAIL || secondaryAssigneeIds.includes(u.id))
                        .filter((u: User) => u.name.toLowerCase().includes(assigneeSearch.toLowerCase()))
                        .sort((a: User, b: User) => a.name.localeCompare(b.name, 'pt-BR'))
                        .map((u: User) => (
                          <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white p-1 rounded">
                            <input
                              type="checkbox"
                              checked={secondaryAssigneeIds.includes(u.id)}
                              onChange={(e) => {
                                if (e.target.checked) setSecondaryAssigneeIds([...secondaryAssigneeIds, u.id]);
                                else setSecondaryAssigneeIds(secondaryAssigneeIds.filter(id => id !== u.id));
                              }}
                              className="rounded text-[var(--primary-color)] focus:ring-[var(--primary-color)]"
                            />
                            {u.name}
                          </label>
                        ))}
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase">Data de Início</label>
                  <DateFieldEditor
                    className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                    value={startDate}
                    onCommit={(v) => {
                      setStartDate(v);
                      handleStartOrDurationChange(v, duration);
                    }}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-gray-400 uppercase">Duração (dias ou horas)</label>
                  <input
                    type="text"
                    placeholder="Ex: 5 ou 3h"
                    aria-invalid={!!durationError}
                    className={`w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none ${durationError ? 'border-red-400 focus:ring-red-300' : ''}`}
                    value={duration}
                    onChange={(e) => {
                      setDuration(e.target.value);
                      handleStartOrDurationChange(startDate, e.target.value);
                    }}
                  />
                  {durationError && (
                    <p className="text-[10px] text-red-500 mt-1">{durationError}</p>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase">Data Limite</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded mt-1 text-sm bg-gray-50 text-gray-500 cursor-not-allowed outline-none"
                  value={isoToBr(dueDate)}
                  placeholder="dd/mm/aaaa"
                  readOnly
                />
                <p className="text-[10px] text-gray-400 mt-1">Calculada automaticamente a partir da data de início + duração</p>
              </div>
              <div>
                <label className="text-xs font-bold text-gray-400 uppercase">Criada em</label>
                <p className="mt-1 text-sm text-gray-500 border rounded p-2 bg-gray-50">{todayLabel}</p>
              </div>
            </div>

            <div>
              <label className="text-xs font-bold text-gray-400 uppercase">Descrição</label>
              <textarea
                className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Adicione detalhes..."
              />
            </div>
          </div>
        </div>

        <div className="p-6 border-t bg-gray-50 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} disabled={isSubmitting} className="px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed">Cancelar</button>
          <button
            onClick={handleSubmit}
            disabled={!title.trim() || !selectedListId || !!durationError || isSubmitting}
            className="px-6 py-2 bg-[var(--primary-color)] text-[#2c3e50] font-bold rounded shadow-sm hover:shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {isSubmitting && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {isSubmitting ? 'Criando...' : 'Criar Tarefa'}
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskDetailModal(props: any) {
  const {
    task,
    users,
    onClose,
    onUpdate,
    currentUser,
    customFields,
    fieldValues,
    onUpdateFieldValue,
    onManageFields,
    hiddenTaskFieldIdsByList,
    onDelete,
    onDuplicate,
    onArchive,
    onUnarchive,
    onRestore,
    onConfigureRecurrence,
    recurrenceRule,
    tasks,
    onSelectTask,
    onQuickCreate,
    isReadOnly = false,
    saveAttachment,
    removeAttachment: removeTaskAttachment,
    saveComment,
    editComment,
    deleteComment,
    assignComment,
    resolveComment,
    toggleWatcher,
    saveExtensionLog,
    saveTaskActivity,
    uploadFile,
    statusGroups,
    lists,
    folders,
    workspaceId,
    onTagsChange,
    teams = [],
    focusCommentId = null,
    focusAction = null,
    onFocusHandled,
  } = props;

  const currentList = lists?.find((l: any) => l.id === task.listId);
  const currentFolder = folders?.find((f: any) => f.id === currentList?.folderId);
  const statusGroup = statusGroups?.find((g: any) => g.id === currentList?.statusGroupId) || statusGroups?.[0];
  const statusOptions = statusGroup?.options || [];

  const getStatusStyle = (statusLabel: string) => {
    const sLower = (statusLabel || '').toLowerCase();
    const opt = statusOptions.find((o: any) => o.label?.toLowerCase() === sLower);

    if (opt?.color) {
      return {
        backgroundColor: opt.color,
        color: '#ffffff',
        border: `1px solid ${opt.color}`
      };
    }

    if (sLower.includes('conclu') || sLower.includes('fechado') || sLower.includes('aprovado')) return { backgroundColor: '#dcfce7', color: '#15803d' };
    if (sLower.includes('espera') || sLower.includes('aguarda') || sLower.includes('pendente')) return { backgroundColor: '#fef9c3', color: '#a16207' };
    if (sLower.includes('andamento') || sLower.includes('progresso')) return { backgroundColor: '#dbeafe', color: '#1d4ed8' };
    if (sLower.includes('cancel') || sLower.includes('repro') || sLower.includes('risco')) return { backgroundColor: '#fee2e2', color: '#b91c1c' };

    return { backgroundColor: '#f1f5f9', color: '#475569' };
  };

  // Renamed to avoid shadowing
  const [searchParams, setSearchParams] = useSearchParams();
  const [detailActiveTab, setDetailActiveTab] = useState<'info' | 'history' | 'checklist' | 'attachments' | 'custom' | 'subtasks' | 'dependencies' | 'watchers'>(() => {
    const fromUrl = searchParams.get('tab');
    const validTabs = ['info', 'history', 'checklist', 'attachments', 'custom', 'subtasks', 'dependencies', 'watchers'] as const;
    return (validTabs as readonly string[]).includes(fromUrl || '') ? (fromUrl as typeof validTabs[number]) : 'info';
  });

  // Reflete a aba ativa em `?tab=` — deep link/refresh reabrem na mesma aba.
  // Usa `replace` (não `push`): trocar de aba não deve virar uma entrada
  // própria no histórico de voltar/avançar do navegador.
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (detailActiveTab === 'info') next.delete('tab'); else next.set('tab', detailActiveTab);
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailActiveTab]);

  // Esc fecha o detalhe da tarefa (achado de QA: só o botão "voltar" do
  // navegador funcionava). Ignora quando o foco está num campo de texto —
  // edição de título/comentário já trata Esc localmente (cancelar a edição),
  // e sem essa checagem as duas coisas aconteceriam juntas no mesmo evento.
  // Também ignora um Esc já `preventDefault()`-ado por outra camada acima
  // (achado de review): os dropdowns Radix daqui dentro (status/responsável)
  // e o modal de criar subtarefa (irmão, fora desta árvore) marcam o evento
  // como tratado ao fechar — sem essa checagem, dispensar um DropdownMenu ou
  // fechar "+ Nova Subtarefa" com Esc fechava o detalhe da tarefa junto.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const [newDueDate, setNewDueDate] = useState(task.dueDate);
  const [extensionReason, setExtensionReason] = useState('');
  const [isExtending, setIsExtending] = useState(false);
  const [isSavingExtension, setIsSavingExtension] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [newComment, setNewComment] = useState('');
  const [isSendingComment, setIsSendingComment] = useState(false);
  const [showAIPanel, setShowAIPanel] = useState(false);
  const [newChecklistText, setNewChecklistText] = useState('');
  const [description, setDescription] = useState(task.description || '');
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(task.title);
  const [showActivityStats, setShowActivityStats] = useState(false);
  const [activityFilter, setActivityFilter] = useState<'all' | 'history'>('all');
  const [showActivitySearch, setShowActivitySearch] = useState(false);
  const [activitySearchQuery, setActivitySearchQuery] = useState('');

  const unifiedTimeline = useMemo(() => {
    const all = [
      // Respostas (task.comments com parentCommentId) não entram na timeline
      // principal: aparecem aninhadas sob o comentário raiz (ver CommentItem).
      ...(task.comments || []).filter((c: any) => !c.parentCommentId).map((c: any) => ({ ...c, unifiedType: 'COMMENT', date: c.timestamp })),
      ...(task.activities || []).map((a: any) => ({ ...a, unifiedType: 'ACTIVITY', date: a.createdAt || a.date })),
      ...(task.extensionHistory || []).map((e: any) => ({ ...e, unifiedType: 'EXTENSION', date: e.timestamp }))
    ];
    if (task.createdAt) {
      // Autoria real: resolve o nome pelo created_by da tarefa. Tarefas antigas/
      // importadas têm created_by nulo — nesse caso um texto neutro, nunca um
      // nome inventado (antes era hardcoded "Logística criou esta tarefa").
      const creator = task.createdBy
        ? (users || []).find((u: any) => u.id === task.createdBy)?.name
        : null;
      all.push({
        id: 'creation',
        unifiedType: 'CREATION',
        date: task.createdAt,
        text: creator ? `${creator} criou esta tarefa` : 'Tarefa criada'
      });
    }
    return all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [task.comments, task.activities, task.extensionHistory, task.createdAt, task.createdBy, users]);

  // Texto pesquisável de cada item da timeline (usado pela lupa de busca)
  const getTimelineItemText = (item: any): string => {
    const userName = users.find((u: any) => u.id === (item.userId || item.updatedBy))?.name || '';
    switch (item.unifiedType) {
      case 'COMMENT':
        return `${userName} ${item.text || ''}`;
      case 'ACTIVITY':
        return `${userName} ${item.type || ''} ${item.oldValue || ''} ${item.newValue || ''}`;
      case 'EXTENSION':
        return `${userName} ${item.reason || ''} ${item.newDate || ''} ${item.oldDate || ''}`;
      case 'CREATION':
        return item.text || '';
      default:
        return '';
    }
  };

  const visibleTimeline = useMemo(() => {
    let result = unifiedTimeline;
    if (activityFilter === 'history') {
      result = result.filter((item: any) => item.unifiedType !== 'COMMENT');
    }
    const q = activitySearchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((item: any) => getTimelineItemText(item).toLowerCase().includes(q));
    }
    return result;
  }, [unifiedTimeline, activityFilter, activitySearchQuery, users]);

  const activityStats = useMemo(() => {
    const activities = task.activities || [];
    const statusChanges = activities.filter((a: any) => a.type === 'STATUS_CHANGE').length;
    const priorityChanges = activities.filter((a: any) => a.type === 'PRIORITY_CHANGE').length;
    const assigneeChanges = activities.filter((a: any) =>
      ['MAIN_RESPONSIBLE_CHANGE', 'RESPONSIBLE_ADDED', 'RESPONSIBLE_REMOVED', 'TEAM_ASSIGNED'].includes(a.type)
    ).length;
    const extensions = (task.extensionHistory || []).length;
    const comments = (task.comments || []).length;
    const daysOpen = task.createdAt
      ? Math.max(0, Math.floor((Date.now() - new Date(task.createdAt).getTime()) / 86400000))
      : null;
    return { statusChanges, priorityChanges, assigneeChanges, extensions, comments, daysOpen };
  }, [task.activities, task.extensionHistory, task.comments, task.createdAt]);

  const formatDate = (date: string) => {
    if (!date) return '';
    const d = new Date(date);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).replace(' de ', ' ').replace('.', '');
  };

  const taskCustomFields = useMemo(() => {
    // Respeita os campos ocultados por lista (toggles de "Adicionar um
    // existente" no gerenciador): um campo desligado para a lista desta tarefa
    // some também daqui, não só da tabela — senão a aba Detalhes fica enorme.
    const hiddenForList: string[] = (task.listId && hiddenTaskFieldIdsByList?.[task.listId]) || [];
    return (customFields || []).filter((f: CustomField) =>
      f.target === 'TASK' &&
      (f.visibleTo ?? []).includes(currentUser.role) &&
      !hiddenForList.includes(f.id)
    );
  }, [customFields, currentUser.role, task.listId, hiddenTaskFieldIdsByList]);

  // Registro de atividade é auxiliar (histórico/auditoria) — nunca deve impedir
  // a mudança real (status, prioridade, responsável) de acontecer. Antes, uma
  // falha aqui (rede, RLS, etc.) travava silenciosamente o onUpdate() seguinte:
  // o usuário clicava numa opção e "nada acontecia", sem nenhum erro visível.
  const logActivitySafe = async (...args: Parameters<NonNullable<typeof saveTaskActivity>>) => {
    if (!saveTaskActivity) return;
    try {
      await saveTaskActivity(...args);
    } catch (err) {
      console.error('Falha ao registrar atividade (não bloqueia a atualização):', err);
    }
  };

  const handleUpdateStatus = async (status: string) => {
    if (status === task.status) return;
    onUpdate({ ...task, status });
    logActivitySafe(task.id, 'STATUS_CHANGE', task.status, status);
  };

  const handleUpdatePriority = async (priority: TaskPriority) => {
    if (priority === task.priority) return;
    onUpdate({ ...task, priority });
    logActivitySafe(task.id, 'PRIORITY_CHANGE', task.priority, priority);
  };

  const handleToggleSecondaryAssignee = async (userId: string) => {
    const isMain = task.mainAssigneeId === userId;
    if (isMain) return; // Can't remove main this way

    const isSecondary = (task.secondaryAssigneeIds || []).includes(userId);
    let nextSecondaryIds = [...(task.secondaryAssigneeIds || [])];

    if (isSecondary) {
      nextSecondaryIds = nextSecondaryIds.filter(id => id !== userId);
      logActivitySafe(task.id, 'RESPONSIBLE_REMOVED', users.find((u: any) => u.id === userId)?.name);
    } else {
      nextSecondaryIds.push(userId);
      logActivitySafe(task.id, 'RESPONSIBLE_ADDED', '', users.find((u: any) => u.id === userId)?.name);
      notifyAssignment({ userIds: [userId], actor: currentUser, taskId: task.id, taskTitle: task.title });
    }

    onUpdate({ ...task, secondaryAssigneeIds: nextSecondaryIds });
  };

  // Atribui uma Equipe inteira como responsáveis adicionais (estilo ClickUp Teams)
  const handleAssignTeam = async (team: Team) => {
    const current = new Set<string>(task.secondaryAssigneeIds || []);
    const newIds = team.memberIds.filter((id: string) => id !== task.mainAssigneeId && !current.has(id));
    if (newIds.length === 0) {
      toast.info(`Todos da equipe ${team.name} já estão na tarefa.`);
      return;
    }
    notifyAssignment({ userIds: newIds, actor: currentUser, taskId: task.id, taskTitle: task.title, teamName: team.name });
    onUpdate({ ...task, secondaryAssigneeIds: [...(task.secondaryAssigneeIds || []), ...newIds] });
    logActivitySafe(task.id, 'TEAM_ASSIGNED', '', team.name);
  };

  const handleSetMainAssignee = async (userId: string) => {
    if (task.mainAssigneeId === userId) return;

    const oldMainName = users.find((u: any) => u.id === task.mainAssigneeId)?.name;
    const newMainName = users.find((u: any) => u.id === userId)?.name;

    // Move current main to secondary if not already there, and remove new main from secondary
    const nextSecondaryIds = (task.secondaryAssigneeIds || []).filter(id => id !== userId);
    if (!nextSecondaryIds.includes(task.mainAssigneeId)) {
      nextSecondaryIds.push(task.mainAssigneeId);
    }

    notifyAssignment({ userIds: [userId], actor: currentUser, taskId: task.id, taskTitle: task.title });
    onUpdate({ ...task, mainAssigneeId: userId, secondaryAssigneeIds: nextSecondaryIds });
    logActivitySafe(task.id, 'MAIN_RESPONSIBLE_CHANGE', oldMainName, newMainName);
  };

  const handleSaveDueDate = async () => {
    if (!newDueDate) {
      toast.warning('Selecione uma nova data de vencimento.');
      return;
    }
    if (newDueDate === task.dueDate) {
      toast.warning('A nova data é igual à data atual. Escolha uma data diferente.');
      return;
    }
    if (!extensionReason.trim()) {
      toast.warning('Informe uma justificativa para alterar o prazo.');
      return;
    }

    setIsSavingExtension(true);
    try {
      const log: ExtensionLog = {
        id: Math.random().toString(36).substr(2, 9),
        oldDate: task.dueDate,
        newDate: newDueDate,
        reason: extensionReason.trim(),
        updatedBy: currentUser.id,
        timestamp: new Date().toISOString()
      };

      // Salva o log de extensão — falha silenciosa não bloqueia o update da tarefa
      if (saveExtensionLog) {
        try {
          await saveExtensionLog(task.id, log);
        } catch (logErr) {
          console.warn('Falha ao salvar log de extensão (não crítico):', logErr);
        }
      }

      // Atualiza a tarefa com nova data e contador
      const ok = await onUpdate({
        ...task,
        dueDate: newDueDate,
        extensionCount: (task.extensionCount || 0) + 1,
        extensionHistory: [log, ...(task.extensionHistory || [])]
      });

      // updateTask retorna false em caso de erro (e já mostra toast de erro)
      if (ok !== false) {
        toast.success('Prazo alterado com sucesso!');
        setIsExtending(false);
        setExtensionReason('');
      }
    } catch (err: any) {
      console.error('Erro ao alterar prazo:', err);
      toast.error('Erro ao alterar prazo: ' + (err?.message || 'tente novamente.'));
    } finally {
      setIsSavingExtension(false);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    // Copia a FileList ANTES de limpar o input: event.target.files é uma
    // lista "viva" — zerar o value esvazia a própria lista, e iterar depois
    // não encontraria nenhum arquivo (upload silenciosamente não acontecia).
    const files = Array.from(event.target.files || []);
    // Permite selecionar o mesmo arquivo novamente após uma falha
    event.target.value = '';
    if (files.length === 0) return;

    for (const file of files) {
      if (uploadFile && saveAttachment) {
        try {
          const safeName = file.name.replace(/[^\w.-]/g, '_');
          const path = `tasks/${task.id}/${Date.now()}_${safeName}`;
          const url = await uploadFile(file, path, 'task-files');
          if (url) {
            const saved = await saveAttachment(task.id, {
              name: file.name,
              url,
              type: file.type,
              size: file.size
            });
            if (saved !== false) {
              toast.success(`Anexo "${file.name}" enviado.`);
            }
          }
        } catch (err: any) {
          console.error('Erro ao anexar arquivo:', err);
          toast.error(`Falha ao anexar "${file.name}"${err?.message ? `: ${err.message}` : '.'}`);
        }
      }
    }
  };

  const removeAttachment = (id: string) => {
    if (removeTaskAttachment) {
      removeTaskAttachment(task.id, id);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleAddComment = async () => {
    // Sem essa guarda o botão nunca fica "ocupado" visualmente: se a rede
    // demorar (ex.: mesmo cenário de lock/timeout do fetch do Supabase), o
    // usuário via só um clique sem efeito nenhum e não dava pra distinguir
    // "processando" de "travado" — dava clique de novo, disparando o mesmo
    // comentário duplicado quando a primeira chamada finalmente respondia.
    if (!newComment.trim() || isSendingComment) return;

    if (saveComment) {
      const text = newComment;
      setIsSendingComment(true);
      try {
        const newCommentId = await saveComment(task.id, text);
        if (newCommentId) {
          setNewComment('');
          // Notifica usuários e Equipes mencionados com @ (fire-and-forget)
          notifyMentions({
            text,
            taskId: task.id,
            taskTitle: task.title,
            actor: currentUser,
            users: users || [],
            teams,
            commentId: newCommentId,
          });
        }
      } finally {
        setIsSendingComment(false);
      }
    }
  };

  const handleAddReply = async (taskIdArg: string, parentCommentId: string, text: string) => {
    if (!saveComment) return false;
    const newCommentId = await saveComment(taskIdArg, text, parentCommentId);
    if (newCommentId) {
      // Notifica usuários e Equipes mencionados com @ (fire-and-forget) — o
      // comentário raiz (parentCommentId), não a resposta em si: é ele que
      // tem o âncora de rolagem no painel de Atividade.
      notifyMentions({
        text,
        taskId: taskIdArg,
        taskTitle: task.title,
        actor: currentUser,
        users: users || [],
        teams,
        commentId: parentCommentId,
      });
      // Notifica quem já participou da thread (autor do comentário raiz + demais respostas).
      // Busca no banco em vez de usar o `task.comments` local: se duas pessoas
      // responderem quase ao mesmo tempo, o estado local pode não ter a resposta
      // alheia ainda, e essa pessoa ficaria de fora da notificação.
      const { data: threadRows } = await supabase
        .from('task_comments')
        .select('user_id')
        .or(`id.eq.${parentCommentId},parent_comment_id.eq.${parentCommentId}`)
        .is('deleted_at', null);
      const threadParticipantIds = (threadRows || []).map((r: any) => r.user_id);
      notifyReply({
        text,
        taskId: taskIdArg,
        taskTitle: task.title,
        parentCommentId,
        threadParticipantIds,
        actor: currentUser,
      });
    }
    return !!newCommentId;
  };

  const handleAssignComment = async (taskIdArg: string, commentId: string, userId: string | null) => {
    if (!assignComment) return;
    await assignComment(taskIdArg, commentId, userId);
    if (userId) {
      const comment = (task.comments || []).find((c: any) => c.id === commentId);
      notifyCommentAssigned({
        text: comment?.text || '',
        taskId: taskIdArg,
        taskTitle: task.title,
        commentId,
        assignedToId: userId,
        actor: currentUser,
      });
    }
  };

  const handleResolveComment = async (taskIdArg: string, commentId: string) => {
    if (!resolveComment) return;
    await resolveComment(taskIdArg, commentId);
    const comment = (task.comments || []).find((c: any) => c.id === commentId);
    if (comment?.assignedBy) {
      notifyCommentResolved({
        text: comment.text || '',
        taskId: taskIdArg,
        taskTitle: task.title,
        commentId,
        assignedById: comment.assignedBy,
        actor: currentUser,
      });
    }
  };

  const handleAddLink = async () => {
    const url = window.prompt("Digite o URL do link:");
    if (url && saveAttachment) {
      const fullUrl = url.startsWith('http') ? url : `https://${url}`;
      await saveAttachment(task.id, {
        name: url,
        url: fullUrl,
        type: 'link',
        size: 0
      });
    }
  };

  if (!task) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={(e) => e.stopPropagation()}>
      <div className="relative bg-white w-full max-w-[1280px] h-[90vh] flex flex-col rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in duration-300">
        {showAIPanel && (
          <AIPanel
            context={[
              `Título: ${task.title}`,
              `Status: ${task.status} | Prioridade: ${task.priority}`,
              task.startDate ? `Início: ${parseLocalDate(task.startDate).toLocaleDateString('pt-BR')}` : '',
              task.dueDate ? `Prazo: ${parseLocalDate(task.dueDate).toLocaleDateString('pt-BR')}` : '',
              `Responsável: ${users?.find((u: User) => u.id === task.mainAssigneeId)?.name || 'Sem responsável'}`,
              (task.secondaryAssigneeIds || []).length > 0
                ? `Acompanhantes: ${(task.secondaryAssigneeIds || []).map((id: string) => users?.find((u: User) => u.id === id)?.name).filter(Boolean).join(', ')}`
                : '',
              task.extensionCount ? `Prorrogações de prazo: ${task.extensionCount}x` : '',
              `\nDescrição:\n${task.description || '(sem descrição)'}`,
              tasks.filter((t: any) => t.parentId === task.id).length > 0
                ? `\nSubtarefas:\n${tasks.filter((t: any) => t.parentId === task.id).map((s: any) => `- [${s.status}] ${s.title}`).join('\n')}`
                : '',
              (task.checklists || []).length > 0
                ? `\nItens de ação:\n${(task.checklists || []).map((c: ChecklistItem) => `- [${c.completed ? 'x' : ' '}] ${c.text}`).join('\n')}`
                : '',
              (task.comments || []).length > 0
                ? `\nComentários (do mais antigo ao mais novo):\n${(task.comments || []).map((c: any) => `${users?.find((u: User) => u.id === c.userId)?.name || 'Alguém'}: ${c.text}`).join('\n')}`
                : '',
            ].filter(Boolean).join('\n')}
            onClose={() => setShowAIPanel(false)}
          />
        )}
        <div className="p-4 border-b shrink-0 flex items-center justify-between bg-white px-8">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={onClose}
              title="Voltar"
              className="text-gray-400 p-1 hover:bg-gray-100 rounded cursor-pointer"
            >
              <Icons.ChevronRight className="w-5 h-5 rotate-180" />
            </button>
            <div className="flex items-center gap-2 text-xs font-semibold text-gray-400 uppercase tracking-widest">
              <span>VerticalParts</span>
              <span>/</span>
              <span>{currentFolder?.name || currentList?.name || 'Sem projeto'}</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                // Preserva o path/params já presentes — sem isso, o link
                // compartilhado perdia o contexto de onde a tarefa foi
                // aberta. Ver withTaskPathSuffix.
                const url = new URL(window.location.href);
                url.searchParams.delete('taskId');
                url.pathname = withTaskPathSuffix(url.pathname, task);
                navigator.clipboard.writeText(url.toString());
                alert('Link da tarefa copiado!');
              }}
              className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 text-gray-500 text-sm font-medium rounded-lg transition-all"
            >
              <LinkIcon className="w-4 h-4" /> Compartilhar
            </button>
            {!isReadOnly && onDuplicate && (
              <button
                onClick={() => onDuplicate(task)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-blue-50 text-gray-500 hover:text-blue-600 text-sm font-medium rounded-lg transition-all"
                title="Duplicar tarefa"
              >
                <Copy className="w-4 h-4" /> Duplicar
              </button>
            )}
            {task.recurrenceRuleId ? (
              <span
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-600 text-xs font-semibold"
                title="Esta tarefa foi gerada automaticamente por uma regra de recorrência"
              >
                <Repeat className="w-3.5 h-3.5" /> Ocorrência recorrente
              </span>
            ) : (
              !isReadOnly && onConfigureRecurrence && (
                <button
                  onClick={onConfigureRecurrence}
                  className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${recurrenceRule ? (recurrenceRule.enabled ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500') : 'hover:bg-blue-50 text-gray-500 hover:text-blue-600'}`}
                  title="Configurar recorrência"
                >
                  <Repeat className="w-4 h-4" /> {recurrenceRule ? (recurrenceRule.enabled ? 'Recorrente' : 'Recorrência pausada') : 'Recorrência'}
                </button>
              )
            )}
            {/* Issue #185, gota 4: uma tarefa na Lixeira só mostra Restaurar
                (seção 32 da issue) — arquivar/desarquivar e mover pra Lixeira
                de novo não fazem sentido nesse estado. */}
            {!isReadOnly && task.deletedAt && onRestore && (
              <button
                onClick={() => onRestore(task)}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-emerald-50 text-emerald-600 text-sm font-medium rounded-lg transition-all"
                title="Restaurar tarefa"
              >
                <RotateCcw className="w-4 h-4" /> Restaurar
              </button>
            )}
            {!isReadOnly && !task.deletedAt && (task.archivedAt ? onUnarchive : onArchive) && (
              <button
                onClick={task.archivedAt ? onUnarchive : onArchive}
                className="flex items-center gap-2 px-3 py-1.5 hover:bg-amber-50 text-gray-500 hover:text-amber-600 text-sm font-medium rounded-lg transition-all"
                title={task.archivedAt ? 'Desarquivar tarefa' : 'Arquivar tarefa'}
              >
                <ArchiveIcon className="w-4 h-4" /> {task.archivedAt ? 'Desarquivar' : 'Arquivar'}
              </button>
            )}
            {!isReadOnly && !task.deletedAt && onDelete && (
              <button onClick={onDelete} className="p-2 hover:bg-red-50 text-red-400 rounded-lg transition-colors" title="Mover para Lixeira">
                <Icons.Trash />
              </button>
            )}
            <div className="w-px h-6 bg-gray-200 mx-1"></div>
            <button onClick={onClose} className="p-2 hover:bg-gray-100 text-gray-400 rounded-lg transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Main Content (Left) */}
          <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar bg-white">
            <div className="p-8 pb-4">
              <div className="flex items-center gap-3 mb-6">
                <div className="flex items-center gap-1.5 px-2 py-1 bg-gray-100 rounded text-[10px] font-bold text-gray-500 uppercase">
                  <Icons.Check className="w-3 h-3" /> Tarefa
                </div>
                <span className="text-gray-300 text-sm font-medium">{task.id.slice(0, 8)}</span>
                {task.archivedAt && (
                  <span
                    className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-700 rounded text-[10px] font-bold uppercase"
                    title={`Arquivada em ${formatDate(task.archivedAt)}${task.archivedBy ? ' por ' + (users.find((u: any) => u.id === task.archivedBy)?.name || 'alguém') : ''}`}
                  >
                    <ArchiveIcon className="w-3 h-3" /> Arquivada
                  </span>
                )}
                {task.deletedAt && (
                  <span
                    className="flex items-center gap-1.5 px-2 py-1 bg-red-50 text-red-700 rounded text-[10px] font-bold uppercase"
                    title={`Excluída em ${formatDate(task.deletedAt)}${task.deletedBy ? ' por ' + (users.find((u: any) => u.id === task.deletedBy)?.name || 'alguém') : ''}${task.purgeAfter ? ' · exclusão definitiva em ' + formatDate(task.purgeAfter) : ''}`}
                  >
                    <Icons.Trash className="w-3 h-3" /> Na Lixeira
                  </span>
                )}
                <button
                  onClick={() => setShowAIPanel(v => !v)}
                  className={`flex items-center gap-1.5 px-3 py-1 font-bold text-xs rounded transition-colors ml-2 ${showAIPanel ? 'bg-purple-100 text-purple-700' : 'text-purple-600 hover:bg-purple-50'}`}
                >
                  ✨ Pergunte à IA
                </button>
              </div>

              {editingTitle && !isReadOnly ? (
                <input
                  className="text-3xl font-bold text-gray-900 mb-4 leading-tight w-full border-b-2 border-orange-400 outline-none bg-transparent"
                  value={titleDraft}
                  autoFocus
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onBlur={() => {
                    setEditingTitle(false);
                    if (titleDraft.trim() && titleDraft !== task.title) {
                      onUpdate({ ...task, title: titleDraft.trim() }).then((ok: boolean) => {
                        if (ok) toast.success('Título atualizado.');
                      });
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.currentTarget.blur(); }
                    if (e.key === 'Escape') { setTitleDraft(task.title); setEditingTitle(false); }
                  }}
                />
              ) : (
                <h2
                  className={`text-3xl font-bold text-gray-900 mb-4 leading-tight ${!isReadOnly ? 'cursor-text hover:text-orange-700 transition-colors group' : ''}`}
                  onClick={() => { if (!isReadOnly) { setTitleDraft(task.title); setEditingTitle(true); } }}
                  title={!isReadOnly ? 'Clique para renomear' : undefined}
                >
                  {task.title}
                  {!isReadOnly && <span className="inline-block ml-2 opacity-0 group-hover:opacity-100 transition-opacity text-sm text-orange-400">✏️</span>}
                </h2>
              )}

              {/* Health Banner */}
              {(() => {
                const isOwner = currentUser?.id === task.mainAssigneeId;
                const isPrivileged = currentUser?.role === UserRole.ADMIN || currentUser?.role === UserRole.GESTOR;
                if (!isOwner && !isPrivileged) return null;
                const h = getTaskHealth(task);
                if (!h) return null;
                const assignee = users?.find((u: User) => u.id === task.mainAssigneeId);
                const name = assignee?.name || 'Responsável';
                return (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border mb-6 ${h.bg} ${h.border}`}>
                    <span className="text-2xl">{h.emoji}</span>
                    <div>
                      <p className={`text-sm font-semibold ${h.text}`}>{name} está: {h.label}</p>
                      {task.dueDate && (
                        <p className={`text-xs mt-0.5 ${h.text} opacity-75`}>
                          Prazo: {parseLocalDate(task.dueDate).toLocaleDateString('pt-BR')}
                          {task.startDate && ` · Início: ${parseLocalDate(task.startDate).toLocaleDateString('pt-BR')}`}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })()}

              <div className="grid grid-cols-2 gap-y-6 gap-x-12 mb-12">
                <div className="flex items-center gap-8">
                  <span className="w-24 text-sm font-medium text-gray-400">Status</span>
                  {!isReadOnly ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div
                          className="px-3 py-1 rounded text-[10px] font-bold uppercase transition-all cursor-pointer hover:brightness-95"
                          style={getStatusStyle(task.status)}
                        >
                          {task.status}
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        {statusOptions.map((opt: any) => (
                          <DropdownMenuItem key={opt.id} onClick={() => handleUpdateStatus(opt.label)}>
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: opt.color }} />
                              {opt.label}
                            </div>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <div
                      className="px-3 py-1 rounded text-[10px] font-bold uppercase transition-all"
                      style={getStatusStyle(task.status)}
                    >
                      {task.status}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-8">
                  <span className="w-24 text-sm font-medium text-gray-400">Responsáveis</span>
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <div className="relative cursor-pointer group">
                          <img
                            src={avatarThumb(users?.find((u: any) => u.id === task.mainAssigneeId)?.avatar) || `https://picsum.photos/seed/${task.mainAssigneeId}/100`}
                            className="w-7 h-7 rounded-full border-2 border-white shadow-sm hover:scale-[3] hover:z-50 transition-all cursor-pointer bg-white group-hover:ring-2 group-hover:ring-orange-200"
                            alt=""
                          />
                          <div className="absolute -bottom-1 -right-1 bg-blue-500 rounded-full p-0.5 border border-white">
                            <Icons.Check className="w-2 h-2 text-white" />
                          </div>
                        </div>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-64 max-h-80 overflow-y-auto">
                        <div className="p-2 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/50 mb-1 rounded-sm">Principal</div>
                        {[...users].filter((u: any) => u.email !== AI_AGENT_EMAIL || u.id === task.mainAssigneeId).sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR')).map((u: any) => (
                          <DropdownMenuItem key={u.id} onClick={() => handleSetMainAssignee(u.id)} className="flex items-center gap-3 py-2">
                            <img src={avatarThumb(u.avatar) || `https://picsum.photos/seed/${u.id}/100`} className="w-6 h-6 rounded-full" alt="" />
                            <span className={`text-sm ${task.mainAssigneeId === u.id ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{u.name}</span>
                            {task.mainAssigneeId === u.id && <Icons.Check className="w-4 h-4 ml-auto text-blue-500" />}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <div className="p-2 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/50 mb-1 rounded-sm">Adicionais</div>
                        {users.filter((u: any) => u.id !== task.mainAssigneeId && (u.email !== AI_AGENT_EMAIL || (task.secondaryAssigneeIds || []).includes(u.id))).sort((a: any, b: any) => a.name.localeCompare(b.name, 'pt-BR')).map((u: any) => (
                          <DropdownMenuItem key={u.id} onClick={() => handleToggleSecondaryAssignee(u.id)} className="flex items-center gap-3 py-2">
                            <div className="relative">
                              <img src={avatarThumb(u.avatar) || `https://picsum.photos/seed/${u.id}/100`} className="w-6 h-6 rounded-full" alt="" />
                              {(task.secondaryAssigneeIds || []).includes(u.id) && (
                                <div className="absolute -bottom-1 -right-1 bg-green-500 rounded-full p-0.5 border border-white">
                                  <Icons.Check className="w-2 h-2 text-white" />
                                </div>
                              )}
                            </div>
                            <span className={`text-sm ${(task.secondaryAssigneeIds || []).includes(u.id) ? 'font-bold text-gray-900' : 'text-gray-600'}`}>{u.name}</span>
                            {(task.secondaryAssigneeIds || []).includes(u.id) && <Icons.Check className="w-4 h-4 ml-auto text-green-500" />}
                          </DropdownMenuItem>
                        ))}
                        {teams.length > 0 && (
                          <>
                            <DropdownMenuSeparator />
                            <div className="p-2 text-[10px] font-black text-gray-400 uppercase tracking-widest bg-gray-50/50 mb-1 rounded-sm">Equipes</div>
                            {teams.map((team: Team) => (
                              <DropdownMenuItem key={team.id} onClick={() => handleAssignTeam(team)} className="flex items-center gap-3 py-2">
                                <span className="w-6 h-6 rounded-full flex items-center justify-center text-white shrink-0" style={{ backgroundColor: team.color }}>
                                  <Icons.Users className="w-3.5 h-3.5" />
                                </span>
                                <span className="text-sm text-gray-600">{team.name}</span>
                                <span className="ml-auto text-[10px] text-gray-400">{team.memberIds.length} {team.memberIds.length === 1 ? 'membro' : 'membros'}</span>
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="flex -space-x-1.5">
                      {(task.secondaryAssigneeIds || []).map(id => (
                        <img
                          key={id}
                          src={avatarThumb(users?.find((u: any) => u.id === id)?.avatar) || `https://picsum.photos/seed/${id}/100`}
                          className="w-7 h-7 rounded-full border-2 border-white shadow-sm hover:scale-[3] hover:z-50 transition-all cursor-pointer bg-white"
                          alt=""
                          title={users.find((u: any) => u.id === id)?.name}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <span className="w-24 text-sm font-medium text-gray-400">Datas</span>
                  <div
                    onClick={() => { if (!isReadOnly) setIsExtending(true); }}
                    className={`flex items-center gap-2 text-sm font-medium transition-all ${!isReadOnly ? 'cursor-pointer hover:text-orange-500 hover:bg-orange-50 px-2 py-1 -ml-2 rounded-xl group border-2 border-transparent hover:border-orange-100' : 'text-gray-600'}`}
                  >
                    <Icons.Calendar className={`w-4 h-4 ${!isReadOnly ? 'text-orange-400' : 'text-gray-400'}`} />
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">Entrega:</span>
                        <span className={(task.extensionCount || 0) > 0 ? 'text-red-500 font-bold' : 'text-gray-900 group-hover:text-orange-600'}>
                          {(() => { const [y, m, d] = (task.dueDate || '').split('T')[0].split('-'); return d ? `${d}/${m}/${y}` : task.dueDate; })()}
                        </span>
                        {(task.extensionCount || 0) > 0 && (
                          <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded-full uppercase font-black">
                            {task.extensionCount}x
                          </span>
                        )}
                        {!isReadOnly && <Icons.Edit size={12} className="text-gray-300 group-hover:text-orange-400" />}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-8">
                  <span className="w-24 text-sm font-medium text-gray-400">Prioridade</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <div className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 -ml-2 rounded-xl transition-all group">
                        <span className={`w-3 h-3 rounded-sm ${task.priority === TaskPriority.ALTA ? 'bg-red-500' : task.priority === TaskPriority.URGENTE ? 'bg-red-700' : task.priority === TaskPriority.MEDIA ? 'bg-cyan-500' : 'bg-slate-400'}`}></span>
                        <span className="text-sm font-bold text-gray-700 group-hover:text-gray-900">{task.priority}</span>
                        <Icons.ChevronDown className="w-3 h-3 text-gray-300 group-hover:text-gray-500" />
                      </div>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {Object.values(TaskPriority).map((priority) => (
                        <DropdownMenuItem key={priority} onClick={() => handleUpdatePriority(priority)}>
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${PRIORITY_COLORS[priority].split(' ')[0].replace('bg-', 'bg-')}`} style={{ backgroundColor: PRIORITY_COLORS[priority].includes('slate') ? '#94a3b8' : PRIORITY_COLORS[priority].includes('cyan') ? '#0891b2' : PRIORITY_COLORS[priority].includes('orange') ? '#ea580c' : '#dc2626' }}></span>
                            {priority}
                          </div>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>

              <div className="bg-gray-50/50 p-6 rounded-2xl border border-gray-100 mb-8 group relative transition-all hover:bg-gray-100/50">
                {isEditingDescription ? (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                    <textarea
                      className="w-full p-4 border rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none min-h-[150px] bg-white shadow-inner text-gray-700 leading-relaxed"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      autoFocus
                      placeholder="Adicione detalhes..."
                    />
                    <div className="flex justify-end gap-2 text-xs">
                      <button
                        onClick={() => { setIsEditingDescription(false); setDescription(task.description || ''); }}
                        className="px-4 py-2 font-bold text-gray-400 hover:text-gray-600 transition-colors uppercase tracking-widest"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={() => {
                          onUpdate({ ...task, description });
                          setIsEditingDescription(false);
                        }}
                        className="px-6 py-2 bg-[var(--primary-color)] text-[#2c3e50] font-black rounded-lg shadow-sm hover:shadow-md transition-all uppercase tracking-widest"
                      >
                        Salvar Alterações
                      </button>
                    </div>
                  </div>
                ) : (
                  <div
                    onClick={() => !isReadOnly && setIsEditingDescription(true)}
                    className={`prose prose-sm max-w-none text-gray-600 leading-relaxed italic ${!isReadOnly ? 'cursor-text' : ''}`}
                  >
                    {task.description ? linkifyText(task.description) : "Nenhuma descrição fornecida."}
                    {!isReadOnly && (
                      <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                        <Icons.Edit className="w-3.5 h-3.5" /> Editar
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="flex border-b text-sm font-bold bg-white sticky top-0 z-10 px-8">
              {[
                { id: 'info', label: 'Detalhes' },
                { id: 'subtasks', label: 'Subtarefas' },
                { id: 'dependencies', label: 'Dependências' },
                { id: 'watchers', label: 'Observadores' },
                { id: 'checklist', label: 'Itens de ação' },
                { id: 'attachments', label: 'Anexos', count: task.attachments?.length || 0 }
              ].map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setDetailActiveTab(tab.id as any)}
                  className={`py-4 mr-8 relative transition-all ${detailActiveTab === tab.id ? 'text-orange-500' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {tab.label} {tab.count !== undefined ? `(${tab.count})` : ''}
                  {detailActiveTab === tab.id && <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-orange-500 rounded-full" />}
                </button>
              ))}
            </div>

            <div className="p-8 flex-1">
              {detailActiveTab === 'info' && (
                <div className="space-y-12">
                  <section>
                    <TaskTagsInput
                      taskId={task.id}
                      workspaceId={workspaceId}
                      currentTags={task.tags ?? []}
                      currentUserId={currentUser.id}
                      readOnly={currentUser.role === UserRole.COLABORADOR}
                      onTagsChange={(tags) => {
                        onTagsChange?.(task.id, tags);
                        onUpdate({ ...task, tags });
                      }}
                    />
                  </section>
                  <section>
                    <div className="flex items-center justify-between mb-6">
                      <h3 className="text-sm font-bold text-gray-900">Campos personalizados</h3>
                      {!isReadOnly && onManageFields && (currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.GESTOR) && (
                        <button
                          type="button"
                          onClick={() => onManageFields(task.listId)}
                          className="flex items-center gap-1.5 text-xs font-bold text-orange-500 hover:text-orange-600 hover:underline transition-colors"
                          title="Criar, adicionar, mostrar/ocultar e reordenar campos desta lista"
                        >
                          <Icons.Settings className="w-3.5 h-3.5" />
                          Gerenciar campos
                        </button>
                      )}
                    </div>
                    <div className="space-y-6">
                      {(taskCustomFields || []).map((field: CustomField) => {
                        const currentValue = (fieldValues || []).find(v => v.fieldId === field.id && v.entityId === task.id)?.value;
                        return (
                          <div key={field.id} className="flex items-center gap-12 group">
                            <span className="w-48 flex items-center gap-2 text-sm text-gray-400 group-hover:text-gray-600 transition-colors">
                              <Icons.ChevronRight className="w-3.5 h-3.5" />
                              {field.name}
                            </span>
                            <div className="flex-1">
                              <CustomFieldInput
                                field={field}
                                value={currentValue}
                                onChange={(val: any) => { onUpdateFieldValue(field.id, task.id, val); }}
                                formulaContext={{
                                  ...task,
                                  ...Object.fromEntries(
                                    (fieldValues || [])
                                      .filter((fv: CustomFieldValue) => fv.entityId === task.id)
                                      .map((fv: CustomFieldValue) => [customFields.find((f: CustomField) => f.id === fv.fieldId)?.name || '', fv.value])
                                  ),
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              )}
              {detailActiveTab === 'subtasks' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-900">Subtarefas ({tasks.filter((t: any) => t.parentId === task.id).length})</h3>
                    {!isReadOnly && <button onClick={() => onQuickCreate({ parentId: task.id, listId: task.listId })} className="text-xs font-bold text-orange-500 hover:underline">+ Nova Subtarefa</button>}
                  </div>
                  {tasks.filter((t: any) => t.parentId === task.id).map((sub: any) => (
                    <div key={sub.id} onClick={() => onSelectTask(sub.id)} className="flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl border border-gray-100 transition-all cursor-pointer">
                      <Icons.Check className="w-4 h-4" style={{ color: getStatusStyle(sub.status).color }} />
                      <span className="text-sm font-medium flex-1">{sub.title}</span>
                      <div className="flex items-center gap-4">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded uppercase ${PRIORITY_COLORS[sub.priority as TaskPriority]}`}>{sub.priority}</span>
                        <img
                          src={avatarThumb(users?.find((u: any) => u.id === sub.mainAssigneeId)?.avatar) || `https://picsum.photos/seed/${sub.mainAssigneeId}/100`}
                          className="w-6 h-6 rounded-full border-2 border-white shadow-sm hover:scale-[3] hover:z-50 transition-all cursor-pointer bg-white"
                          alt=""
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {detailActiveTab === 'checklist' && (
                <div className="space-y-4">
                  <h3 className="text-sm font-bold text-gray-900 mb-4">
                    Itens de ação ({(task.checklists || []).filter((i: ChecklistItem) => i.completed).length}/{(task.checklists || []).length})
                  </h3>
                  {(task.checklists || []).map((item: ChecklistItem) => (
                    <div key={item.id} className="group flex items-center gap-4 p-4 hover:bg-gray-50 rounded-xl transition-all border border-transparent hover:border-gray-100">
                      <div
                        onClick={async () => {
                          if (isReadOnly) return;
                          const completed = !item.completed;
                          const { error } = await supabase.from('task_checklists').update({ completed }).eq('id', item.id);
                          if (!error) {
                            onUpdate({
                              ...task,
                              checklists: (task.checklists || []).map((c: ChecklistItem) => c.id === item.id ? { ...c, completed } : c),
                            });
                          }
                        }}
                        className="w-5 h-5 rounded border-2 border-gray-300 flex items-center justify-center cursor-pointer hover:border-orange-400 transition-colors"
                      >
                        {item.completed && <div className="w-3 h-3 bg-orange-500 rounded-sm"></div>}
                      </div>
                      <span className={`text-sm flex-1 ${item.completed ? 'line-through text-gray-300 font-medium' : 'text-gray-700 font-medium'}`}>{item.text}</span>
                      {!isReadOnly && (
                        <button
                          onClick={async () => {
                            const { error } = await supabase.from('task_checklists').delete().eq('id', item.id);
                            if (!error) {
                              onUpdate({
                                ...task,
                                checklists: (task.checklists || []).filter((c: ChecklistItem) => c.id !== item.id),
                              });
                            }
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-all"
                          title="Excluir item"
                        >
                          <Icons.Trash />
                        </button>
                      )}
                    </div>
                  ))}
                  {!isReadOnly && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const text = newChecklistText.trim();
                        if (!text) return;
                        const { data, error } = await supabase
                          .from('task_checklists')
                          .insert({ task_id: task.id, text })
                          .select()
                          .single();
                        if (!error && data) {
                          setNewChecklistText('');
                          onUpdate({
                            ...task,
                            checklists: [...(task.checklists || []), { id: data.id, text: data.text, completed: false }],
                          });
                        }
                      }}
                      className="flex items-center gap-3 pt-2"
                    >
                      <input
                        value={newChecklistText}
                        onChange={(e) => setNewChecklistText(e.target.value)}
                        placeholder="Novo item de ação... (Enter para adicionar)"
                        className="flex-1 px-4 py-2.5 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-200"
                      />
                      <button type="submit" disabled={!newChecklistText.trim()} className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-bold rounded-xl transition-colors">
                        Adicionar
                      </button>
                    </form>
                  )}
                </div>
              )}
              {detailActiveTab === 'attachments' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-gray-900">Anexos ({task.attachments?.length || 0})</h3>
                    {!isReadOnly && (
                      <div className="flex items-center gap-4">
                        <button onClick={handleAddLink} className="text-xs font-bold text-orange-500 hover:underline">+ Link</button>
                        <button onClick={() => fileInputRef.current?.click()} className="text-xs font-bold text-orange-500 hover:underline">+ Arquivo</button>
                      </div>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {(task.attachments || []).map((attachment: Attachment) => (
                      <div key={attachment.id} className="group flex items-center gap-4 p-4 bg-gray-50 rounded-2xl border border-gray-100 hover:border-orange-200 transition-all">
                        <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                          <Icons.Paperclip className="w-5 h-5 text-gray-400" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-gray-900 truncate">{linkifyText(attachment.name)}</p>
                          <p className="text-[10px] text-gray-500">{formatFileSize(attachment.size)} • {new Date(attachment.uploadedAt).toLocaleDateString()}</p>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <a href={attachment.url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-white rounded-lg text-gray-400 hover:text-gray-600 transition-colors">
                            <Icons.ChevronRight className="w-4 h-4" />
                          </a>
                          {!isReadOnly && (
                            <button onClick={() => removeAttachment(attachment.id)} className="p-2 hover:bg-white rounded-lg text-red-400 hover:text-red-600 transition-colors">
                              <Icons.Trash className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    {(task.attachments || []).length === 0 && (
                      <div className="col-span-2 py-12 flex flex-col items-center justify-center bg-gray-50/50 rounded-3xl border-2 border-dashed border-gray-100">
                        <Icons.Paperclip className="w-12 h-12 text-gray-200 mb-4" />
                        <p className="text-sm text-gray-400 font-medium">Nenhum anexo encontrado.</p>
                        {!isReadOnly && <button onClick={() => fileInputRef.current?.click()} className="mt-4 text-xs font-bold text-orange-500 hover:bg-orange-50 px-4 py-2 rounded-lg transition-all">Clique para enviar</button>}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {detailActiveTab === 'dependencies' && (
                <TaskDependencies
                  task={task}
                  allTasks={tasks}
                  currentUserId={currentUser.id}
                  readOnly={currentUser.role === UserRole.COLABORADOR}
                />
              )}
              {detailActiveTab === 'watchers' && (
                <div className="space-y-4">
                  {(() => {
                    const amWatching = (task.watcherIds || []).includes(currentUser.id);
                    return (
                      <>
                        <div className="flex items-center justify-between">
                          <h3 className="text-sm font-bold text-gray-900">Observadores</h3>
                          <button
                            onClick={() => toggleWatcher(task.id, amWatching)}
                            className={`text-xs font-bold px-3 py-1.5 rounded-lg transition-all ${
                              amWatching
                                ? 'bg-orange-100 text-orange-600 hover:bg-orange-200'
                                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                            }`}
                          >
                            {amWatching ? '✓ Observando' : '+ Observar'}
                          </button>
                        </div>
                        <p className="text-[11px] text-gray-400">Observadores recebem notificações de comentários e mudanças nesta tarefa.</p>
                        {(task.watcherIds || []).length === 0 ? (
                          <p className="text-center py-8 text-sm text-gray-400 italic">Nenhum observador ainda.</p>
                        ) : (
                          <div className="space-y-2">
                            {(task.watcherIds || []).map((uid: string) => {
                              const watcher = users.find((u: any) => u.id === uid);
                              if (!watcher) return null;
                              return (
                                <div key={uid} className="flex items-center gap-3 p-2 rounded-xl hover:bg-gray-50">
                                  <img src={avatarThumb(watcher.avatar)} className="w-8 h-8 rounded-full" alt="" />
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm font-semibold text-gray-800 truncate">{watcher.name}</p>
                                    <p className="text-[11px] text-gray-400 truncate">{watcher.email}</p>
                                  </div>
                                  {uid === currentUser.id && (
                                    <button onClick={() => toggleWatcher(task.id, true)} className="text-[10px] text-red-400 hover:text-red-600 font-semibold">Sair</button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          </div>

          {/* Activity Bar (Right) */}
          <div className="w-[380px] border-l bg-white flex flex-col shrink-0">
            <div className="p-6 border-b shrink-0 flex items-center justify-between bg-white text-gray-900">
              <h3 className="text-base font-bold">Atividade</h3>
              <div className="flex items-center gap-3 text-gray-400">
                <button
                  type="button"
                  onClick={() => setShowActivityStats(v => !v)}
                  title="Estatísticas da tarefa"
                  className={`transition-colors ${showActivityStats ? 'text-orange-500' : 'hover:text-gray-600'}`}
                >
                  <Icons.Chart className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setActivityFilter(f => (f === 'history' ? 'all' : 'history'))}
                  title={activityFilter === 'history' ? 'Mostrando só o histórico do sistema — clique para ver os comentários também' : 'Mostrar só o histórico do sistema (sem comentários)'}
                  className={`transition-colors ${activityFilter === 'history' ? 'text-orange-500' : 'hover:text-gray-600'}`}
                >
                  <Icons.Clock className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setShowActivitySearch(v => { if (v) setActivitySearchQuery(''); return !v; })}
                  title="Buscar na atividade"
                  className={`transition-colors ${showActivitySearch ? 'text-orange-500' : 'hover:text-gray-600'}`}
                >
                  <Icons.Search className="w-4 h-4" />
                </button>
              </div>
            </div>

            {showActivitySearch && (
              <div className="px-6 pt-4 shrink-0">
                <input
                  type="text"
                  autoFocus
                  value={activitySearchQuery}
                  onChange={(e) => setActivitySearchQuery(e.target.value)}
                  placeholder="Buscar em comentários e atividades..."
                  className="w-full px-3 py-2 text-sm border rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-200"
                />
              </div>
            )}

            {showActivityStats && (
              <div className="px-6 pt-4 shrink-0">
                <div className="grid grid-cols-2 gap-2 bg-gray-50 border border-gray-100 rounded-2xl p-4 text-xs">
                  <div><span className="text-gray-400">Aberta há</span> <span className="font-bold text-gray-900">{activityStats.daysOpen ?? '—'}{activityStats.daysOpen !== null ? ' dias' : ''}</span></div>
                  <div><span className="text-gray-400">Comentários</span> <span className="font-bold text-gray-900">{activityStats.comments}</span></div>
                  <div><span className="text-gray-400">Mudanças de status</span> <span className="font-bold text-gray-900">{activityStats.statusChanges}</span></div>
                  <div><span className="text-gray-400">Mudanças de prioridade</span> <span className="font-bold text-gray-900">{activityStats.priorityChanges}</span></div>
                  <div><span className="text-gray-400">Mudanças de responsável</span> <span className="font-bold text-gray-900">{activityStats.assigneeChanges}</span></div>
                  <div><span className="text-gray-400">Prorrogações</span> <span className={`font-bold ${activityStats.extensions > 0 ? 'text-red-500' : 'text-gray-900'}`}>{activityStats.extensions}</span></div>
                </div>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-8">
              <div className="relative pl-6 space-y-8">
                <div className="absolute left-1.5 top-2 bottom-0 w-px bg-gray-100"></div>
                {visibleTimeline.length === 0 && (
                  <p className="text-xs text-gray-400 italic pl-2">Nenhum resultado encontrado.</p>
                )}
                {visibleTimeline.map((item: any) => {
                  if (item.unifiedType === 'CREATION') {
                    return (
                      <div key="creation" className="relative">
                        <div className="absolute -left-[22px] top-1.5 w-2 h-2 rounded-full bg-gray-200 border-2 border-white shadow-sm"></div>
                        <div className="text-xs">
                          <span className="text-gray-500">{item.text}</span>
                          <span className="text-gray-300 ml-2">{formatDate(item.date)}</span>
                        </div>
                      </div>
                    );
                  }

                  if (item.unifiedType === 'COMMENT') {
                    const replies = (task.comments || [])
                      .filter((c: any) => c.parentCommentId === item.id)
                      .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
                    const isFocusTarget = focusCommentId === item.id;
                    return (
                      <div key={item.id} id={`comment-${item.id}`}>
                        <CommentItem
                          item={item}
                          replies={replies}
                          users={users}
                          teams={teams}
                          currentUserId={currentUser.id}
                          taskId={task.id}
                          onEdit={editComment}
                          onDelete={deleteComment}
                          onReply={handleAddReply}
                          onAssign={handleAssignComment}
                          onResolve={handleResolveComment}
                          formatDate={formatDate}
                          autoFocus={isFocusTarget ? (focusAction || 'view') : undefined}
                          onFocusHandled={isFocusTarget ? onFocusHandled : undefined}
                        />
                      </div>
                    );
                  }

                  if (item.unifiedType === 'ACTIVITY') {
                    const typeStyles: Record<string, string> = {
                      'STATUS_CHANGE': 'bg-blue-50/30 border-blue-50 text-blue-600 circle-blue-400',
                      'PRIORITY_CHANGE': 'bg-cyan-50/30 border-cyan-50 text-cyan-600 circle-cyan-400',
                      'MAIN_RESPONSIBLE_CHANGE': 'bg-purple-50/30 border-purple-50 text-purple-600 circle-purple-400',
                      'RESPONSIBLE_ADDED': 'bg-green-50/30 border-green-50 text-green-600 circle-green-400',
                      'RESPONSIBLE_REMOVED': 'bg-red-50/30 border-red-50 text-red-600 circle-red-400',
                      'TEAM_ASSIGNED': 'bg-purple-50/30 border-purple-50 text-purple-600 circle-purple-400',
                      'TASK_DUPLICATED': 'bg-indigo-50/30 border-indigo-50 text-indigo-600 circle-indigo-400',
                      'TASK_RECURRENCE_GENERATED': 'bg-indigo-50/30 border-indigo-50 text-indigo-600 circle-indigo-400',
                      'TASK_ARCHIVED': 'bg-amber-50/30 border-amber-50 text-amber-600 circle-amber-400',
                      'TASK_UNARCHIVED': 'bg-amber-50/30 border-amber-50 text-amber-600 circle-amber-400'
                    };

                    const style = typeStyles[item.type] || 'bg-gray-50/30 border-gray-50 text-gray-600 circle-gray-400';
                    const [bgClass, borderClass, textAccentClass, circleClass] = style.split(' ');

                    return (
                      <div key={item.id} className="relative">
                        <div className={`absolute -left-[22px] top-1.5 w-2 h-2 rounded-full border-2 border-white shadow-sm ${circleClass.replace('circle-', 'bg-')}`}></div>
                        <div className={`text-xs leading-relaxed ${bgClass} p-3 rounded-2xl ml-2 border ${borderClass} shadow-sm transition-all hover:shadow-md`}>
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-gray-900">{users.find((u: any) => u.id === item.userId)?.name || 'Recorrência automática'}</span>
                            <span className="text-[10px] text-gray-300">{formatDate(item.date)}</span>
                          </div>
                          <p className="text-gray-600 mt-1">
                            {item.type === 'TASK_DUPLICATED' && (
                              <>duplicou esta tarefa a partir de <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span></>
                            )}
                            {item.type === 'TASK_RECURRENCE_GENERATED' && (
                              <>tarefa gerada automaticamente pela recorrência de <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span></>
                            )}
                            {item.type === 'TASK_ARCHIVED' && <>arquivou esta tarefa</>}
                            {item.type === 'TASK_UNARCHIVED' && <>desarquivou esta tarefa</>}
                            {item.type === 'STATUS_CHANGE' && (
                              <>alterou o status para <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span></>
                            )}
                            {item.type === 'PRIORITY_CHANGE' && (
                              <>alterou a prioridade para <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span></>
                            )}
                            {item.type === 'MAIN_RESPONSIBLE_CHANGE' && (
                              <>alterou o responsável principal para <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span></>
                            )}
                            {item.type === 'RESPONSIBLE_ADDED' && (
                              <>adicionou <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span> como responsável adicional</>
                            )}
                            {item.type === 'RESPONSIBLE_REMOVED' && (
                              <>removeu <span className={`font-bold ${textAccentClass}`}>{item.oldValue}</span> dos responsáveis adicionais</>
                            )}
                            {item.type === 'TEAM_ASSIGNED' && (
                              <>atribuiu a equipe <span className={`font-bold ${textAccentClass}`}>{item.newValue}</span> à tarefa</>
                            )}
                          </p>
                        </div>
                      </div>
                    );
                  }

                  if (item.unifiedType === 'EXTENSION') {
                    return (
                      <div key={item.id} className="relative">
                        <div className="absolute -left-[22px] top-1.5 w-2 h-2 rounded-full bg-red-400 border-2 border-white shadow-sm"></div>
                        <div className="text-xs leading-relaxed bg-red-50/30 p-2 rounded-lg ml-2 border border-red-50">
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-gray-900">{users.find((u: any) => u.id === item.updatedBy)?.name}</span>
                            <span className="text-[10px] text-gray-300">{formatDate(item.date)}</span>
                          </div>
                          <span className="text-gray-500"> alterou o vencimento para </span>
                          <span className="font-bold text-red-500">{(() => { const s = item.newDate?.split('T')[0] || item.newDate; const [y, m, d] = (s || '').split('-'); return d ? `${d}/${m}/${y}` : s; })()}</span>
                          {item.reason && <p className="mt-1 text-[10px] italic text-gray-400">"{item.reason}"</p>}
                        </div>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </div>

            <div className="p-6 border-t bg-white shrink-0">
              <input type="file" ref={fileInputRef} className="hidden" multiple onChange={handleFileUpload} />
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 shadow-inner">
                <MentionTextarea
                  placeholder="Escreva um comentário... use @ para mencionar pessoas ou Equipes"
                  value={newComment}
                  onChange={setNewComment}
                  onSubmit={handleAddComment}
                  users={users || []}
                  teams={teams}
                  className="w-full bg-transparent border-none focus:ring-0 text-sm p-0 resize-none min-h-[60px] custom-scrollbar text-gray-700"
                />
                <div className="flex items-center justify-between mt-3">
                  <div className="flex items-center gap-3 text-gray-400">
                    <div onClick={() => fileInputRef.current?.click()} className="cursor-pointer hover:text-gray-600 transition-colors">
                      <Icons.Paperclip className="w-4 h-4" />
                    </div>
                  </div>
                  <button
                    onClick={handleAddComment}
                    disabled={!newComment.trim() || isSendingComment}
                    title={isSendingComment ? 'Enviando...' : undefined}
                    className="bg-orange-500 p-2 rounded-xl text-white hover:brightness-110 shadow-lg shadow-orange-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isSendingComment ? (
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" /></svg>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Extension Modal (inside main area z-index) */}
        {isExtending && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4 animate-in fade-in duration-200" onClick={(e) => { e.stopPropagation(); setIsExtending(false); }}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in duration-300" onClick={e => e.stopPropagation()}>
              <div className="p-6 border-b bg-gray-50/50 flex justify-between items-center">
                <div>
                  <h3 className="font-black text-gray-900 text-lg uppercase tracking-tight">Alterar Prazo</h3>
                  <p className="text-xs text-gray-400 font-medium mt-1">É necessário um motivo para prorrogar.</p>
                </div>
                <button onClick={() => setIsExtending(false)} className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-400">
                  <Icons.Plus className="w-5 h-5 rotate-45" />
                </button>
              </div>
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Novo Vencimento</label>
                  <DateFieldEditor
                    className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-orange-500 focus:ring-4 focus:ring-orange-50 outline-none transition-all font-bold text-gray-900"
                    value={newDueDate}
                    onCommit={(v) => setNewDueDate(v)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Justificativa</label>
                  <textarea
                    className="w-full p-4 bg-gray-50 border-2 border-gray-100 rounded-2xl focus:border-orange-500 focus:ring-4 focus:ring-orange-50 outline-none transition-all text-sm min-h-[120px] resize-none font-medium"
                    placeholder="Por que esta data está sendo alterada?"
                    value={extensionReason}
                    onChange={(e) => setExtensionReason(e.target.value)}
                  />
                </div>
              </div>
              <div className="p-6 bg-gray-100/50 flex gap-3">
                <button
                  onClick={() => setIsExtending(false)}
                  className="flex-1 py-3 text-sm font-bold text-gray-500 hover:text-gray-700 transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSaveDueDate}
                  disabled={isSavingExtension || !newDueDate || newDueDate === task.dueDate || !extensionReason.trim()}
                  className="flex-[2] py-3 bg-orange-500 text-white font-black rounded-2xl shadow-xl shadow-orange-100 hover:brightness-110 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:scale-100 flex items-center justify-center gap-2"
                >
                  {isSavingExtension ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
                      Salvando...
                    </>
                  ) : 'Salvar Novo Prazo'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const PRESET_COLORS = [
  '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', // Grays
  '#fecaca', '#f87171', '#ef4444', '#dc2626', '#b91c1c', // Reds
  '#fed7aa', '#fb923c', '#f97316', '#ea580c', '#c2410c', // Oranges
  '#fef08a', '#facc15', '#eab308', '#ca8a04', '#a16207', // Yellows
  '#bbf7d0', '#4ade80', '#22c55e', '#16a34a', '#15803d', // Greens
  '#99f6e4', '#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', // Teals
  '#bfdbfe', '#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', // Blues
  '#000080', '#0000cd', '#0000ff', '#4169e1', '#6495ed', // Dark Blues
  '#ddd6fe', '#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', // Purples
  '#fbcfe8', '#f472b6', '#ec4899', '#db2777', '#be185d', // Pinks
];

function CustomFieldsManager(props: any) {
  const {
    onClose,
    fields,
    onCreateField,
    onUpdateField,
    onDeleteField,
    onReorderField,
    currentUser,
    activeListId,
    hiddenStandardColumnKeysByList,
    onToggleStandardColumn,
    hiddenTaskFieldIdsByList,
    onHideTaskFieldForList: onToggleTaskFieldForList
  } = props;
  const [activeTab, setActiveTab] = useState<'existing' | 'create'>(activeListId ? 'existing' : 'create');
  const [fieldSearch, setFieldSearch] = useState('');

  const [name, setName] = useState('');
  const [type, setType] = useState<CustomFieldType>(CustomFieldType.TEXT);
  const [target, setTarget] = useState<'TASK' | 'LIST' | 'PROJECT'>('TASK');
  const [options, setOptions] = useState<CustomFieldOption[]>([]);
  const [optionSearch, setOptionSearch] = useState('');
  const [editingFieldId, setEditingFieldId] = useState<string | null>(null);
  const [formula, setFormula] = useState('');
  const [currencySymbol, setCurrencySymbol] = useState('R$');

  const STANDARD_FIELDS_MAP = [
    { id: 'status', label: 'Status' },
    { id: 'priority', label: 'Prioridade' },
    { id: 'assignee', label: 'Responsável' },
    { id: 'extensions', label: 'Prorrog.' },
    { id: 'dueDate', label: 'Data Limite' },
  ];

  const filteredFields = fields.filter((f: CustomField) =>
    f.name.toLowerCase().includes(fieldSearch.toLowerCase())
  );

  const filteredStandard = STANDARD_FIELDS_MAP.filter(f =>
    f.label.toLowerCase().includes(fieldSearch.toLowerCase())
  );

  const isFieldHidden = (fieldId: string) => {
    if (!activeListId) return false;
    return (hiddenTaskFieldIdsByList[activeListId] || []).includes(fieldId);
  };

  const isStandardHidden = (key: string) => {
    if (!activeListId) return false;
    return (hiddenStandardColumnKeysByList[activeListId] || []).includes(key);
  };

  const handleAddOption = (label: string) => {
    if (!label.trim()) return;
    const newOption: CustomFieldOption = {
      id: Math.random().toString(36).substr(2, 9),
      label: label.trim(),
      color: PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
    };
    setOptions([...options, newOption]);
    setOptionSearch('');
  };

  const updateOption = (id: string, updates: Partial<CustomFieldOption>) => {
    setOptions(options.map(o => o.id === id ? { ...o, ...updates } : o));
  };

  const removeOption = (id: string) => {
    setOptions(options.filter(o => o.id !== id));
  };

  const startEditing = (field: CustomField) => {
    setEditingFieldId(field.id);
    setName(field.name);
    setType(field.type);
    setTarget(field.target);
    setOptions(field.config?.options || []);
    setFormula(field.config?.formula || '');
    setCurrencySymbol(field.config?.currency || 'R$');
  };

  const cancelEditing = () => {
    setEditingFieldId(null);
    setName('');
    setType(CustomFieldType.TEXT);
    setOptions([]);
    setFormula('');
    setCurrencySymbol('R$');
  };

  const handleSave = () => {
    if (!name) return;
    const config =
      type === CustomFieldType.DROPDOWN ? { options: options.filter(o => o.label.trim() !== '') } :
      type === CustomFieldType.FORMULA ? { formula } :
      (type === CustomFieldType.MONEY || type === CustomFieldType.CURRENCY) ? { currency: currencySymbol.trim() || 'R$' } :
      undefined;
    const fieldData: any = {
      name,
      type,
      target,
      config,
    };

    if (editingFieldId) {
      const existingField = fields.find((f: any) => f.id === editingFieldId);
      onUpdateField({ ...existingField, ...fieldData });
    } else {
      const newField: CustomField = {
        ...fieldData,
        id: Math.random().toString(36).substr(2, 9),
        isMandatory: false,
        visibleTo: [UserRole.ADMIN, UserRole.GESTOR, UserRole.COLABORADOR],
        createdBy: currentUser.id,
        createdAt: new Date().toISOString()
      };
      onCreateField(newField);
    }
    cancelEditing();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in duration-200">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <h3 className="font-bold text-gray-800">Gerenciar Campos Personalizados</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="px-6 py-4 border-b">
          <div className="relative">
            <input
              type="text"
              className="w-full p-2.5 pl-4 border-2 border-orange-100 rounded-lg text-sm focus:border-orange-500 focus:ring-4 focus:ring-orange-50 outline-none transition-all placeholder:text-gray-400"
              placeholder="Pesquise campos novos ou existentes"
              value={fieldSearch}
              onChange={(e) => setFieldSearch(e.target.value)}
            />
          </div>

          <div className="flex gap-6 mt-4 border-b">
            <button
              onClick={() => setActiveTab('create')}
              className={`pb-2 text-sm font-bold transition-all relative ${activeTab === 'create' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Criar novo
              {activeTab === 'create' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-orange-500 rounded-t-full" />}
            </button>
            <button
              onClick={() => setActiveTab('existing')}
              className={`pb-2 text-sm font-bold transition-all relative ${activeTab === 'existing' ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}
            >
              Adicionar um existente
              {activeTab === 'existing' && <div className="absolute bottom-0 left-0 right-0 h-1 bg-orange-500 rounded-t-full" />}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6">
          {activeTab === 'existing' ? (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1 text-xs font-bold text-gray-500 uppercase">
                  <span>Mostrados</span>
                  <Icons.ChevronDown className="w-3 h-3" />
                </div>
                <button
                  onClick={() => {
                    if (!activeListId) return;
                    const allHidden =
                      filteredStandard.every((f) => isStandardHidden(f.id)) &&
                      filteredFields.every((f) => isFieldHidden(f.id));
                    // Mostrar tudo: reexibe o que estava oculto. Ocultar tudo: oculta o que estava visível.
                    filteredStandard.forEach((f) => {
                      if (allHidden ? isStandardHidden(f.id) : !isStandardHidden(f.id)) {
                        onToggleStandardColumn(activeListId, f.id);
                      }
                    });
                    filteredFields.forEach((f) => {
                      if (allHidden ? isFieldHidden(f.id) : !isFieldHidden(f.id)) {
                        onToggleTaskFieldForList(activeListId, f.id);
                      }
                    });
                  }}
                  disabled={!activeListId}
                  className="text-xs font-bold text-gray-400 hover:text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {filteredStandard.every((f) => isStandardHidden(f.id)) && filteredFields.every((f) => isFieldHidden(f.id))
                    ? 'Mostrar tudo'
                    : 'Ocultar tudo'}
                </button>
              </div>

              {!activeListId && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Selecione uma lista específica na barra lateral para mostrar/ocultar campos — como há mais de uma lista neste escopo, não é possível saber em qual delas aplicar a alteração.
                </p>
              )}

              <div className="space-y-1">
                {/* Standard Fields */}
                {filteredStandard.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-2 group">
                    <div className="flex items-center gap-3">
                      <span className="text-gray-400 font-medium text-sm w-6 text-center">Aa</span>
                      <span className="text-sm font-medium text-gray-700">{f.label}</span>
                    </div>
                    <button
                      onClick={() => onToggleStandardColumn(activeListId, f.id)}
                      disabled={!activeListId}
                      className={`w-10 h-6 rounded-full transition-all relative disabled:opacity-40 disabled:cursor-not-allowed ${!isStandardHidden(f.id) ? 'bg-orange-500' : 'bg-gray-200'}`}
                    >
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${!isStandardHidden(f.id) ? 'left-5' : 'left-1'}`} />
                    </button>
                  </div>
                ))}

                {/* Custom Fields */}
                {filteredFields.map(f => (
                  <div key={f.id} className="flex items-center justify-between py-2 group">
                    <div className="flex items-center gap-3">
                      <div className="p-1 px-1.5 rounded border border-gray-200">
                        <div className="w-3 h-3 border-2 border-blue-500 rounded-sm" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">{f.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      {/* Existing management buttons shown on hover */}
                      <div className="hidden group-hover:flex items-center gap-1">
                        <button onClick={() => startEditing(f)} className="p-1 text-gray-400 hover:text-blue-500"><Icons.Edit size={14} /></button>
                        <button onClick={() => onDeleteField(f.id)} className="p-1 text-gray-400 hover:text-red-500"><Icons.Trash size={14} /></button>
                      </div>
                      <button
                        onClick={() => onToggleTaskFieldForList(activeListId, f.id)}
                        disabled={!activeListId}
                        className={`w-10 h-6 rounded-full transition-all relative disabled:opacity-40 disabled:cursor-not-allowed ${!isFieldHidden(f.id) ? 'bg-orange-500' : 'bg-gray-200'}`}
                      >
                        <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-all ${!isFieldHidden(f.id) ? 'left-5' : 'left-1'}`} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <h4 className="font-bold text-gray-800 text-sm">
                {editingFieldId ? 'Editar Campo' : 'Criar Novo Campo'}
              </h4>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Nome do Campo</label>
                <input
                  type="text"
                  className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Orçamento Estimado"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-gray-500 uppercase">Tipo de Dado</label>
                <select
                  className="w-full p-2 border rounded mt-1 text-sm bg-white focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                  value={type}
                  onChange={(e) => setType(e.target.value as CustomFieldType)}
                >
                  {Object.values(CustomFieldType).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {type === CustomFieldType.DROPDOWN && (
                <div className="space-y-3 bg-gray-50 p-4 rounded-lg border border-gray-100">
                  <div className="space-y-4">
                    <label className="text-xs font-bold text-gray-500 uppercase">Opções da Lista</label>

                    {/* Quick Add Input */}
                    <div className="relative">
                      <input
                        type="text"
                        className="w-full p-2.5 pl-3 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-[var(--primary-color)] outline-none shadow-sm transition-all"
                        placeholder="Pesquise ou adicione opções..."
                        value={optionSearch}
                        onChange={(e) => setOptionSearch(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddOption(optionSearch);
                          }
                        }}
                      />
                      {optionSearch.trim() && !options.some(o => o.label.toLowerCase() === optionSearch.toLowerCase()) && (
                        <button
                          onClick={() => handleAddOption(optionSearch)}
                          className="absolute right-2 top-2 px-2 py-0.5 bg-gray-100 hover:bg-gray-200 rounded text-[10px] font-bold text-gray-600 transition-colors"
                        >
                          Enter para adicionar
                        </button>
                      )}
                    </div>

                    <div className="space-y-1.5 max-h-60 overflow-y-auto custom-scrollbar pr-1">
                      {options.map((opt, idx) => (
                        <div key={opt.id} className="flex items-center gap-2 group/opt animate-in slide-in-from-left duration-200" style={{ '--delay': `${idx * 40}ms` } as any}>
                          <div className="p-1 cursor-grab active:cursor-grabbing text-gray-300">
                            <Icons.Grip size={14} />
                          </div>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                className="flex-1 py-1.5 px-4 rounded font-bold text-white text-xs text-center shadow-sm hover:brightness-95 active:scale-[0.98] transition-all truncate"
                                style={{ backgroundColor: opt.color }}
                              >
                                {opt.label}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent className="p-4 w-64 shadow-2xl rounded-xl border-gray-200 z-[250]" align="center" side="right">
                              <div className="space-y-4">
                                <input
                                  type="text"
                                  value={opt.label}
                                  onChange={(e) => updateOption(opt.id, { label: e.target.value })}
                                  className="w-full p-2 border border-orange-500 rounded-lg text-sm font-medium focus:ring-0 outline-none"
                                  autoFocus
                                />

                                <div className="grid grid-cols-6 gap-2">
                                  {PRESET_COLORS.map(c => (
                                    <button
                                      key={c}
                                      onClick={() => updateOption(opt.id, { color: c })}
                                      className={`w-6 h-6 rounded-full border transition-all hover:scale-125 ${opt.color === c ? 'ring-2 ring-offset-2 ring-blue-500 scale-125 z-10' : 'border-transparent'}`}
                                      style={{ backgroundColor: c }}
                                    />
                                  ))}
                                </div>

                                <div className="pt-2 border-t">
                                  <button
                                    onClick={() => removeOption(opt.id)}
                                    className="w-full flex items-center justify-center gap-2 py-2 text-xs font-bold text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                                  >
                                    <Icons.Trash size={14} />
                                    Excluir
                                  </button>
                                </div>
                              </div>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      ))}
                      {options.length === 0 && (
                        <div className="text-center py-8 border-2 border-dashed border-gray-100 rounded-xl bg-white/50">
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                            Nenhuma opção definida
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {type === CustomFieldType.FORMULA && (
                <div className="space-y-2 bg-gray-50 p-4 rounded-lg border border-gray-100">
                  <label className="text-xs font-bold text-gray-500 uppercase">Fórmula</label>
                  <input
                    type="text"
                    className="w-full p-2 border rounded text-sm font-mono focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                    value={formula}
                    onChange={(e) => setFormula(e.target.value)}
                    placeholder="Ex: {{Preço}} * {{Quantidade}}"
                  />
                  <p className="text-[11px] text-gray-400">
                    Use <code className="bg-white border rounded px-1">{'{{Nome do Campo}}'}</code> para referenciar outros campos numéricos da tarefa. Calculado automaticamente, não é editável.
                  </p>
                </div>
              )}

              {(type === CustomFieldType.MONEY || type === CustomFieldType.CURRENCY) && (
                <div className="space-y-2 bg-gray-50 p-4 rounded-lg border border-gray-100">
                  <label className="text-xs font-bold text-gray-500 uppercase">Símbolo da Moeda</label>
                  <input
                    type="text"
                    className="w-24 p-2 border rounded text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
                    value={currencySymbol}
                    onChange={(e) => setCurrencySymbol(e.target.value)}
                    placeholder="R$"
                    maxLength={5}
                  />
                </div>
              )}
            </div>
          )}
        </div>
        <div className="p-4 bg-gray-50 border-t flex justify-end gap-2">
          {editingFieldId ? (
            <>
              <button onClick={cancelEditing} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded font-medium">Cancelar</button>
              <button onClick={handleSave} className="px-4 py-2 text-sm bg-blue-600 text-white font-bold rounded hover:shadow-md transition-all">Salvar Alterações</button>
            </>
          ) : (
            <>
              <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded font-medium">Fechar</button>
              <button onClick={handleSave} disabled={!name} className="px-4 py-2 text-sm bg-[var(--primary-color)] text-[#2c3e50] font-bold rounded hover:shadow-md disabled:opacity-50 transition-all">Criar Campo</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CreateSpaceModal({ onClose, onCreate }: any) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const [icon, setIcon] = useState('Layout');
  const [searchQuery, setSearchQuery] = useState('');

  const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#6b7280', '#ffce05'];

  const availableIcons = Object.keys(Icons).filter(key =>
    key.toLowerCase().includes(searchQuery.toLowerCase()) &&
    !['Home', 'Check', 'ChevronRight', 'ChevronUp', 'ChevronDown', 'ChevronLeft', 'Plus', 'Grip', 'MoreHorizontal'].includes(key)
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50/50">
          <h3 className="font-bold text-gray-800">Criar Novo Espaço</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
          {/* Icon & Name Preview */}
          <div className="flex items-center gap-4">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm border"
              style={{ backgroundColor: color + '15', borderColor: color + '30' }}
            >
              {(() => {
                const IconComp = (Icons as any)[icon] || Icons.Layout;
                return <IconComp className="w-6 h-6" color={color} />;
              })()}
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Nome do Espaço</label>
              <input
                type="text"
                className="w-full p-2 border-b-2 border-transparent focus:border-[var(--primary-color)] transition-all text-sm font-medium outline-none placeholder:text-gray-300"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Suporte T.I."
                autoFocus
              />
            </div>
          </div>

          {/* Icon Picker Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Escolha um Ícone</label>
              <div className="relative">
                <Icons.Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                <input
                  type="text"
                  placeholder="Pesquisar..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-7 pr-2 py-1 bg-gray-50 border rounded-md text-[11px] outline-none focus:ring-1 focus:ring-[var(--primary-color)] w-32 transition-all"
                />
              </div>
            </div>

            <div className="grid grid-cols-6 gap-2 bg-gray-50 p-3 rounded-xl border border-gray-100 max-h-48 overflow-y-auto custom-scrollbar">
              {availableIcons.map(iconKey => {
                const IconComp = (Icons as any)[iconKey];
                const isActive = icon === iconKey;
                return (
                  <button
                    key={iconKey}
                    onClick={() => setIcon(iconKey)}
                    className={`w-10 h-10 flex items-center justify-center rounded-lg transition-all ${isActive ? 'bg-white shadow-md scale-110 active:scale-95' : 'hover:bg-white/50 text-gray-400 hover:text-gray-600'
                      }`}
                    title={iconKey}
                  >
                    <IconComp className="w-5 h-5" color={isActive ? color : 'currentColor'} />
                  </button>
                );
              })}
            </div>
          </div>

          {/* Color Picker */}
          <div className="space-y-3">
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Cor de Identificação</label>
            <div className="flex flex-wrap gap-2.5">
              {colors.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-8 h-8 rounded-full transition-all relative ${color === c ? 'scale-125' : 'hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                >
                  {color === c && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-white shadow-sm" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-50 border-t flex justify-end gap-3 mt-auto">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs text-gray-500 hover:bg-gray-200 rounded-lg font-bold transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={() => onCreate(name, color, icon)}
            disabled={!name.trim()}
            className="px-6 py-2 text-xs bg-[var(--primary-color)] text-[#2c3e50] font-black rounded-lg hover:shadow-lg disabled:opacity-50 transition-all flex items-center gap-2"
          >
            Continuar
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateWikiModal({ spaces, onClose, onCreate }: any) {
  const [spaceId, setSpaceId] = useState(spaces?.[0]?.id || '');
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleConfirm = async () => {
    if (!spaceId || isCreating) return;
    setIsCreating(true);
    try {
      await onCreate(spaceId);
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={(e) => { e.stopPropagation(); if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
        <div className="p-4 border-b flex justify-between items-center bg-gray-50/50">
          <h3 className="font-bold text-gray-800 flex items-center gap-2"><FileText className="w-4 h-4 text-orange-500" /> Criar Wiki Interna</h3>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-gray-500 leading-relaxed">
            Cria uma pasta <strong>"Wiki Interna"</strong> no espaço escolhido, com um documento raiz e 10 subpáginas já preenchidas
            (Visão geral, Processos, Procedimentos, Políticas, Manuais, FAQ, Responsáveis, Modelos, Decisões e Manutenção) — pronto pra ajustar e usar.
          </p>
          <div>
            <label className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1 block">Espaço</label>
            <select
              className="w-full p-2.5 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-orange-200"
              value={spaceId}
              onChange={(e) => setSpaceId(e.target.value)}
            >
              {(spaces || []).map((s: Space) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50/50 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-xs font-bold text-gray-500 hover:text-gray-700">Cancelar</button>
          <button
            onClick={handleConfirm}
            disabled={!spaceId || isCreating}
            className="px-6 py-2 text-xs bg-[var(--primary-color)] text-[#2c3e50] font-black rounded-lg hover:shadow-lg disabled:opacity-50 transition-all"
          >
            {isCreating ? 'Criando...' : 'Criar Wiki'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateFolderModal({ onClose, onCreate }: any) {
  const [name, setName] = useState('');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md p-4" onClick={(e) => e.stopPropagation()}>
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in duration-200">
        <div className="p-4 border-b flex justify-between items-center">
          <h3 className="font-bold text-gray-800">Criar Nova Pasta</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="text-xs font-bold text-gray-500 uppercase">Nome da Pasta</label>
            <input
              type="text"
              className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Projetos Q1"
              autoFocus
            />
          </div>
        </div>
        <div className="p-4 bg-gray-50 border-t flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-200 rounded font-medium">Cancelar</button>
          <button onClick={() => onCreate(name)} disabled={!name} className="px-6 py-2 text-sm bg-[var(--primary-color)] text-[#2c3e50] font-bold rounded hover:shadow-md disabled:opacity-50 transition-all">Criar Pasta</button>
        </div>
      </div>
    </div>
  );
}

// Input de data para campos personalizados/tabela. Inputs nativos <input
// type="date"> disparam onChange a cada tecla digitada, inclusive enquanto
// a data está incompleta (ex: só o dia e mês, ou só 1-2 dígitos do ano) —
// nesses casos `e.target.value` vem vazio. Sem tratamento isso causava dois
// problemas: (1) cada tecla parcial disparava um upsert salvando valor
// vazio, criando uma corrida entre requisições que podia sobrescrever a
// data completa digitada por último com uma parcial que resolveu depois;
// (2) como o valor exibido é controlado pela prop `value` (só atualizada
// depois que o upsert assíncrono termina), qualquer re-render do app nesse
// intervalo (ex: outra tarefa mudando via realtime) forçava o campo de
// volta ao valor antigo, apagando visualmente o que o usuário tinha
// acabado de digitar — exatamente o sintoma relatado de "a data não fica
// gravada assim que termino de digitar o ano". Por isso: (a) mantemos um
// valor local que não depende do round-trip de rede para continuar exibindo
// o que foi digitado, e (b) só disparamos onCommit quando o usuário termina
// uma data válida ou explicitamente limpa um valor que já existia.
// ISO 'YYYY-MM-DD' (formato de armazenamento) → 'dd/mm/aaaa' (exibição pt-BR).
function isoToBr(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// 'dd/mm/aaaa' → ISO 'YYYY-MM-DD'. Retorna '' se a data estiver incompleta ou
// for inválida (ex: 31/02) — assim só persistimos datas completas e reais.
function brToIso(br: string): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((br || '').trim());
  if (!m) return '';
  const dd = Number(m[1]), mo = Number(m[2]), yyyy = Number(m[3]);
  if (mo < 1 || mo > 12 || dd < 1 || dd > 31) return '';
  const dt = new Date(yyyy, mo - 1, dd);
  if (dt.getFullYear() !== yyyy || dt.getMonth() !== mo - 1 || dt.getDate() !== dd) return '';
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// Aplica a máscara dd/mm/aaaa a uma sequência crua de dígitos.
function maskBrDate(raw: string): string {
  const d = (raw || '').replace(/\D/g, '').slice(0, 8);
  if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
  if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return d;
}

// Editor de data para campos personalizados/tabela. Exibe e aceita entrada
// SEMPRE em dd/mm/aaaa — o <input type="date"> nativo formatava no locale do
// NAVEGADOR (mostrava mm/dd/aaaa para muitos usuários, apesar da página ser
// pt-BR). Aqui o texto é um input mascarado determinístico; o calendário nativo
// continua disponível num input oculto acionado pelo botão (showPicker). O valor
// persistido continua ISO 'YYYY-MM-DD'. O buffer local preserva o que foi
// digitado independentemente do round-trip do upsert (ver histórico abaixo).
export function DateFieldEditor({ value, onCommit, className }: { value: any; onCommit: (v: string) => void; className?: string }) {
  const [text, setText] = useState(() => isoToBr(value ?? ''));
  const pickerRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(isoToBr(value ?? '')); }, [value]);

  const commitFromText = (raw: string) => {
    const masked = maskBrDate(raw);
    setText(masked);
    if (masked === '') { if (value) onCommit(''); return; }
    const iso = brToIso(masked);
    if (iso) onCommit(iso); // só persiste data completa e válida
  };

  return (
    <div className="relative">
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/aaaa"
        value={text}
        onChange={(e) => commitFromText(e.target.value)}
        className={`${className ?? ''} pr-9`}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label="Abrir calendário"
        onClick={() => pickerRef.current?.showPicker?.()}
        className="absolute inset-y-0 right-0 flex items-center px-2 text-gray-400 hover:text-gray-600"
      >
        <Icons.Calendar className="h-4 w-4" />
      </button>
      <input
        ref={pickerRef}
        type="date"
        value={value ?? ''}
        onChange={(e) => { const v = e.target.value; setText(isoToBr(v)); if (v || value) onCommit(v); }}
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only absolute right-0 bottom-0"
      />
    </div>
  );
}

// Input de texto/número para campos personalizados/tabela. Mesmo problema do
// DateFieldEditor, mas mais severo aqui: como o valor exibido dependia
// diretamente da prop `value` (só atualizada depois que o upsert assíncrono
// termina), o React reverte o input pro valor antigo a cada tecla — antes
// mesmo da tecla seguinte ser digitada. Na prática, digitar "hello" salvava
// só "o" (confirmado em navegador real, não só em teste). Corrigido com o
// mesmo buffer local: o que aparece na tela nunca depende do round-trip de
// rede, só o que é persistido.
export function BufferedFieldInput({ value, onCommit, type = 'text', className, placeholder }: { value: any; onCommit: (v: string) => void; type?: string; className?: string; placeholder?: string }) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => { setLocal(value ?? ''); }, [value]);
  return (
    <input
      type={type}
      value={local}
      placeholder={placeholder}
      onChange={(e) => {
        setLocal(e.target.value);
        onCommit(e.target.value);
      }}
      className={className}
    />
  );
}

// Mesmo problema do BufferedFieldInput, mas para checkbox: sem buffer local,
// o clique liga o checkbox visualmente e, como o `checked` exibido também só
// reflete o valor depois do upsert assíncrono terminar, o React desmarca o
// checkbox de volta antes da resposta chegar — parece que o clique "não
// pegou" (só funciona se a rede responder rápido o suficiente).
export function BufferedCheckbox({ checked, onCommit, className }: { checked: any; onCommit: (v: boolean) => void; className?: string }) {
  const [local, setLocal] = useState(!!checked);
  useEffect(() => { setLocal(!!checked); }, [checked]);
  return (
    <input
      type="checkbox"
      checked={local}
      onChange={(e) => {
        setLocal(e.target.checked);
        onCommit(e.target.checked);
      }}
      className={className}
    />
  );
}

// Avaliação por estrelas: buffer local pelo mesmo motivo dos outros — sem
// ele, clicar numa estrela podia "voltar" pra nota anterior por uma fração
// de segundo (ou de vez, se outro re-render acontecesse) até o upsert
// assíncrono terminar.
export function BufferedRating({ value, onCommit, max = 5, className }: { value: any; onCommit: (v: number) => void; max?: number; className?: string }) {
  const [local, setLocal] = useState(Number(value) || 0);
  useEffect(() => { setLocal(Number(value) || 0); }, [value]);
  return (
    <div className={className}>
      {Array.from({ length: max }, (_, i) => i + 1).map((star) => (
        // Icons.* não repassa `onClick` pro <svg> (só aceita className/size/color),
        // então o clique precisa ficar num elemento que realmente o recebe.
        <button
          key={star}
          type="button"
          onClick={() => {
            setLocal(star);
            onCommit(star);
          }}
          className="cursor-pointer"
        >
          <Icons.Star
            className={`w-4 h-4 transition-colors ${
              local >= star ? 'text-yellow-400 fill-yellow-400' : 'text-gray-200 hover:text-yellow-200'
            }`}
          />
        </button>
      ))}
    </div>
  );
}

// Slider de progresso: mesmo problema do BufferedFieldInput, só que mais
// grave, porque arrastar dispara `onChange` continuamente — sem buffer local
// o "bolinha" do slider (e o rótulo/barra de progresso, que também dependem
// do mesmo valor) ficam travando/voltando durante o próprio arraste, só
// acompanhando de verdade depois que cada upsert assíncrono termina.
export function BufferedProgressEditor({ value, onCommit, compact = false }: { value: any; onCommit: (v: string) => void; compact?: boolean }) {
  const [local, setLocal] = useState(Number(value) || 0);
  useEffect(() => { setLocal(Number(value) || 0); }, [value]);
  const barColor = local > 75 ? '#22c55e' : local > 30 ? '#eab308' : '#ef4444';
  return (
    <div className={compact ? 'w-full space-y-1' : 'mt-2 space-y-1'}>
      <div className={`flex justify-between font-bold text-gray-400 ${compact ? 'text-[9px] uppercase' : 'text-xs'}`}>
        <span>Progresso</span>
        <span>{local}%</span>
      </div>
      <div className="h-1.5 w-full bg-gray-100 rounded-full overflow-hidden border border-gray-200">
        <div className="h-full transition-all duration-500" style={{ width: `${local}%`, backgroundColor: barColor }} />
      </div>
      <input
        type="range"
        min="0"
        max="100"
        value={local}
        onChange={(e) => {
          setLocal(Number(e.target.value));
          onCommit(e.target.value);
        }}
        className={compact ? 'w-full h-1 opacity-0 hover:opacity-100 transition-opacity cursor-pointer accent-orange-500' : 'w-full accent-[var(--primary-color)]'}
      />
    </div>
  );
}

// FormulaParser depende de mathjs, uma biblioteca relativamente pesada.
// Carregamos por import dinâmico (chunk separado) em vez de estático, pra
// não inflar o bundle inicial de quem nunca usa um campo do tipo Fórmula.
let formulaParserPromise: Promise<typeof import('./lib/FormulaParser')> | null = null;
function loadFormulaParser() {
  if (!formulaParserPromise) formulaParserPromise = import('./lib/FormulaParser');
  return formulaParserPromise;
}

export function FormulaValue({ formula, context }: { formula: string; context: Record<string, any> }) {
  const [result, setResult] = useState<number | string>('…');
  // `context` é um objeto novo a cada render (montado inline pelo chamador);
  // comparamos pelo conteúdo serializado pra não reavaliar a cada re-render.
  const contextKey = JSON.stringify(context);
  useEffect(() => {
    let active = true;
    loadFormulaParser().then(({ FormulaParser }) => {
      if (active) setResult(FormulaParser.evaluate(formula, JSON.parse(contextKey)));
    });
    return () => { active = false; };
  }, [formula, contextKey]);
  return <>{result}</>;
}

function CustomFieldInput({ field, value, onChange, formulaContext }: any) {
  switch (field.type) {
    case CustomFieldType.TEXT:
    case CustomFieldType.WEBSITE:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <BufferedFieldInput
            type="text"
            className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none transition-shadow"
            value={value}
            onCommit={onChange}
            placeholder={field.type === CustomFieldType.WEBSITE ? 'https://...' : 'Digite aqui...'}
          />
        </div>
      );
    case CustomFieldType.NUMBER:
    case CustomFieldType.MONEY:
    case CustomFieldType.CURRENCY:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <div className="relative mt-1">
            {(field.type === CustomFieldType.MONEY || field.type === CustomFieldType.CURRENCY) && (
              <div className="absolute left-3 top-2 text-gray-400 text-sm font-medium">{field.config?.currency || 'R$'}</div>
            )}
            <BufferedFieldInput
              type="number"
              className={`w-full p-2 border rounded text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none transition-shadow ${(field.type === CustomFieldType.MONEY || field.type === CustomFieldType.CURRENCY) ? 'pl-9' : ''}`}
              value={value}
              onCommit={onChange}
            />
          </div>
        </div>
      );
    case CustomFieldType.RATING:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <BufferedRating value={value} onCommit={onChange} className="flex gap-1 mt-2" />
        </div>
      );
    case CustomFieldType.PROGRESS:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <BufferedProgressEditor value={value} onCommit={onChange} />
        </div>
      );
    case CustomFieldType.FORMULA:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <div className="mt-1 text-sm font-mono text-blue-600 bg-blue-50 px-3 py-2 rounded border border-blue-100 italic">
            <FormulaValue formula={field.config?.formula || ''} context={formulaContext || {}} />
          </div>
        </div>
      );
    case CustomFieldType.DATE:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <DateFieldEditor
            value={value}
            onCommit={onChange}
            className="w-full p-2 border rounded mt-1 text-sm focus:ring-2 focus:ring-[var(--primary-color)] outline-none transition-shadow"
          />
        </div>
      );
    case CustomFieldType.DROPDOWN: {
      const currentOpt = field.config?.options?.find((o: CustomFieldOption) => o.id === value);
      const IconComp = currentOpt?.icon ? (Icons as any)[currentOpt.icon] : null;

      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <div className="mt-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <div className="w-full h-10 border rounded-md px-3 flex items-center justify-between bg-white hover:bg-gray-50 cursor-pointer group transition-all">
                  <div className="flex items-center gap-2 overflow-hidden">
                    {currentOpt ? (
                      <div
                        className="px-3 py-1 rounded text-xs font-bold text-white flex items-center gap-1.5 whitespace-nowrap"
                        style={{ backgroundColor: currentOpt.color }}
                      >
                        {IconComp && <IconComp className="h-3.5 w-3.5" color="white" />}
                        {currentOpt.label}
                      </div>
                    ) : (
                      <span className="text-sm text-gray-400 font-medium">Selecione...</span>
                    )}
                  </div>
                  <Icons.ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-gray-600 transition-colors shrink-0" />
                </div>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64 max-h-72 overflow-y-auto" align="start">
                <DropdownMenuItem onClick={() => onChange('')} className="text-xs text-gray-400 italic">
                  — Limpar seleção
                </DropdownMenuItem>
                {field.config?.options?.map((opt: CustomFieldOption) => {
                  const OptIcon = opt.icon ? (Icons as any)[opt.icon] : null;
                  return (
                    <DropdownMenuItem
                      key={opt.id}
                      onClick={() => onChange(opt.id)}
                      className="p-1"
                    >
                      <div
                        className="flex items-center justify-center gap-2 w-full py-1.5 rounded text-xs font-bold text-white transition-opacity hover:opacity-90"
                        style={{ backgroundColor: opt.color }}
                      >
                        {OptIcon && <OptIcon className="h-3.5 w-3.5" color="white" />}
                        <span>{opt.label}</span>
                        {value === opt.id && <Icons.Check className="ml-auto h-3 w-3" color="white" />}
                      </div>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      );
    }
    case CustomFieldType.CHECKBOX:
      return (
        <div className="flex items-center gap-3 mt-4 p-3 bg-gray-50 rounded-lg border border-transparent hover:border-gray-200 transition-colors">
          <BufferedCheckbox
            checked={value}
            onCommit={onChange}
            className="w-5 h-5 text-[var(--primary-color)] focus:ring-[var(--primary-color)] border-gray-300 rounded cursor-pointer"
          />
          <label className="text-sm font-semibold text-gray-700 cursor-pointer" onClick={() => onChange(!value)}>{field.name}</label>
        </div>
      );
    default:
      return (
        <div>
          <label className="text-xs font-bold text-gray-400 uppercase">{field.name}</label>
          <p className="text-sm text-gray-400 italic mt-1 border p-2 rounded bg-gray-50">Tipo de campo ({field.type}) não suportado.</p>
        </div>
      );
  }
}
