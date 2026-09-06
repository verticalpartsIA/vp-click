import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut,
  Filter, Layers, X, Pencil, AlertTriangle, Link2
} from "lucide-react";
import { toast } from 'sonner';
import { Task, User, List, TaskPriority, TaskDependency, StatusGroup } from '../../types';
import { supabase, fetchTaskDependenciesForTasks, addTaskDependency, shiftTaskDates } from '../../lib/supabase';
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  format, addDays, subDays,
  differenceInDays, eachDayOfInterval, isWeekend, isToday, startOfWeek
} from 'date-fns';
import { ptBR } from 'date-fns/locale';
// exibe/edita sempre em dd/mm/aaaa, ao contrário do <input type="date"> cru
// (issue #102).
import { DateFieldEditor } from '@/components/DateFieldEditor';
import { parseLocalDate, formatLocalDate } from '@/lib/dates';

type GanttScale = 'day' | 'week' | 'month' | 'quarter';
type GanttGroupBy = 'none' | 'assignee' | 'status' | 'list';

interface GanttFilters {
  assigneeId: string;
  priority: string;
  status: string;
  listId: string;
  tag: string;
  overdueOnly: boolean;
}

const EMPTY_FILTERS: GanttFilters = { assigneeId: '', priority: '', status: '', listId: '', tag: '', overdueOnly: false };

// Densidade padrão (px/dia) de cada escala — o zoom fino (+/-) continua livre
// a partir daí; a escala só define o agrupamento do cabeçalho e o intervalo
// de dias carregado (mês/trimestre precisam enxergar mais dias de uma vez).
const SCALE_CONFIG: Record<GanttScale, { defaultZoom: number; minZoom: number; maxZoom: number; totalDays: number; label: string }> = {
  day: { defaultZoom: 30, minZoom: 15, maxZoom: 100, totalDays: 60, label: 'Dia' },
  week: { defaultZoom: 12, minZoom: 6, maxZoom: 40, totalDays: 180, label: 'Semana' },
  month: { defaultZoom: 4, minZoom: 2, maxZoom: 15, totalDays: 365, label: 'Mês' },
  quarter: { defaultZoom: 1.5, minZoom: 0.8, maxZoom: 6, totalDays: 730, label: 'Trimestre' },
};

const isDoneLikeStatus = (status: string) => {
  const s = (status || '').toLowerCase();
  return s.includes('conclu') || s.includes('aprovado') || s.includes('fechado') || s.includes('done') || s.includes('cancel');
};

interface GanttViewProps {
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
  // Mesmo formato de handleUpdateTask (App.tsx) usado pela TableView, só que
  // aqui o resultado importa: em falha precisamos desfazer a posição/tamanho
  // da barra que já tinha sido movida/redimensionada na tela (ver
  // dateOverrides abaixo — item 6 do Codex_Gantt_01/02: "restaurar as datas
  // anteriores").
  onUpdateTask?: (taskId: string, updates: Partial<Task>) => Promise<boolean> | void;
  users?: User[];
  lists?: List[];
  // Necessário só pra criar dependência (Codex_Gantt_03) — vira `created_by`.
  currentUserId?: string;
  // Escopa as opções de status do popover de edição rápida ao workflow da
  // lista da tarefa (Codex_Gantt_09) — sem isso o select oferecia todos os
  // status de todas as listas visíveis no Gantt, e salvar um status de outro
  // workflow fazia a tarefa sumir do Kanban da sua própria lista (achado do
  // review: App.tsx monta as colunas do Kanban a partir do status group
  // configurado da lista).
  statusGroups?: StatusGroup[];
}

// parseLocalDate/formatLocalDate agora vivem em lib/dates (issue #102,
// achado 3 — eram cópias idênticas às de App.tsx e CalendarView).

type DragMode = 'move' | 'resize-left' | 'resize-right';

interface DragState {
  taskId: string;
  mode: DragMode;
  startX: number;
  originalStart: Date;
  originalEnd: Date;
  currentDeltaDays: number;
  // Movimentação em lote (Codex_Gantt_10): presente só quando `mode ===
  // 'move'` e a tarefa arrastada faz parte de uma seleção com mais de uma
  // tarefa — todas as outras selecionadas (com barra visível) se movem
  // junto pelo mesmo delta de dias. Redimensionar continua sendo só da
  // barra individual (não faz sentido em lote).
  groupOriginals?: Record<string, { start: Date; end: Date }>;
}

interface VisualRow {
  type: 'group-header' | 'task';
  key: string;
  groupLabel?: string;
  groupCount?: number;
  task?: Task;
}

export const GanttView: React.FC<GanttViewProps> = ({ tasks, onTaskClick, onUpdateTask, users = [], lists = [], currentUserId, statusGroups = [] }) => {
  const [scale, setScale] = useState<GanttScale>('day');
  const [zoomLevel, setZoomLevel] = useState(SCALE_CONFIG.day.defaultZoom); // pixels per day
  const [viewStart, setViewStart] = useState(subDays(new Date(), 7));
  const [groupBy, setGroupBy] = useState<GanttGroupBy>('none');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<GanttFilters>(EMPTY_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);

  // Seleção múltipla pra movimentação em lote (Codex_Gantt_10) — arrastar
  // qualquer barra selecionada move o conjunto inteiro pelo mesmo delta de
  // dias, preservando a duração individual de cada uma.
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      return next;
    });
  };

  // Edição rápida (Codex_Gantt_09) — altera dados básicos sem sair do Gantt
  // nem abrir o modal completo (que continua disponível via clique na barra).
  const [quickEditTaskId, setQuickEditTaskId] = useState<string | null>(null);
  const [quickDraft, setQuickDraft] = useState<{
    title: string; priority: TaskPriority; mainAssigneeId: string; status: string; startDate: string; dueDate: string; isMilestone: boolean;
  } | null>(null);
  const [savingQuickEdit, setSavingQuickEdit] = useState(false);
  // Alternativa sem drag pra criar dependência (Codex_Gantt_03), embutida no
  // mesmo popover de edição rápida — select de "depende de" + botão.
  const [quickDependsOnId, setQuickDependsOnId] = useState('');

  // Sobrepõe otimisticamente as datas de tarefas recém-arrastadas/redimensio-
  // nadas, até `tasks` (prop, vinda do App) refletir a mesma tarefa já
  // salva — ou até a persistência falhar, quando é removido (rollback).
  const [dateOverrides, setDateOverrides] = useState<Record<string, { startDate: string; dueDate: string }>>({});

  // Dependências das tarefas visíveis (Codex_Gantt_03/#154) — chave é
  // `task_id` (a tarefa DEPENDENTE), valor são as dependências dela, no
  // mesmo formato de fetchTaskDependencies (usado no modal de detalhe), só
  // que buscadas em lote pra não fazer um round-trip por tarefa visível.
  const [dependenciesByTask, setDependenciesByTask] = useState<Record<string, TaskDependency[]>>({});
  const taskIdsKey = useMemo(() => tasks.map(t => t.id).sort().join(','), [tasks]);
  useEffect(() => {
    if (!taskIdsKey) { setDependenciesByTask({}); return; }
    let cancelled = false;
    const visibleIds = taskIdsKey.split(',');

    const reloadDependencies = () => fetchTaskDependenciesForTasks(visibleIds)
      .then(deps => {
        if (cancelled) return;
        const byTask: Record<string, TaskDependency[]> = {};
        deps.forEach(d => { (byTask[d.task_id] ||= []).push(d); });
        setDependenciesByTask(byTask);
      })
      .catch(() => { if (!cancelled) toast.error('Não foi possível carregar as dependências do Gantt.'); });

    reloadDependencies();

    // Realtime (Codex_Gantt_11): dependências criadas/removidas por drag,
    // quick edit e lote já atualizam `dependenciesByTask` local direto (sem
    // esperar isso aqui) — este canal é só pra pegar mudanças feitas em
    // OUTRA aba/sessão enquanto este Gantt está aberto, que sem isso só
    // apareceriam no próximo recarregamento de `tasks`. Sem filtro de linha
    // (mesmo padrão do canal `tasks-realtime` em App.tsx) porque o filtro de
    // igualdade do Realtime não cobre "task_id in (...)"; a checagem de
    // relevância é feita aqui mesmo, comparando com as tarefas visíveis.
    const visibleIdSet = new Set(visibleIds);
    const channel = supabase
      .channel('gantt-task-dependencies-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'task_dependencies' }, (payload) => {
        const row = (payload.new ?? payload.old) as { task_id?: string; depends_on_id?: string } | null;
        if (!row) return;
        if (visibleIdSet.has(row.task_id || '') || visibleIdSet.has(row.depends_on_id || '')) {
          reloadDependencies();
        }
      })
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [taskIdsKey]);

  const barRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const dragStateRef = useRef<DragState | null>(null);
  const justDraggedRef = useRef<Set<string>>(new Set());

  // Conexão de dependência arrastando de uma barra a outra (Codex_Gantt_03).
  const connectStateRef = useRef<{ sourceTaskId: string; sourceX: number; sourceY: number } | null>(null);
  const connectLineRef = useRef<SVGPathElement | null>(null);
  const svgContainerRef = useRef<SVGSVGElement | null>(null);

  const handleScaleChange = (next: GanttScale) => {
    setScale(next);
    setZoomLevel(SCALE_CONFIG[next].defaultZoom);
  };

  const timelineDays = useMemo(() => {
    return eachDayOfInterval({
      start: viewStart,
      end: addDays(viewStart, SCALE_CONFIG[scale].totalDays),
    });
  }, [viewStart, scale]);

  // Cabeçalho: no dia-a-dia cada célula é um dia; nas escalas mais largas,
  // agrupa os dias em semana/mês/trimestre (célula única, com o rótulo do
  // período) — senão as células diárias ficariam pixels ilegíveis.
  const headerGroups = useMemo(() => {
    if (scale === 'day') return null;
    const keyFn = scale === 'week'
      ? (d: Date) => format(startOfWeek(d, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      : scale === 'month'
        ? (d: Date) => format(d, 'yyyy-MM')
        : (d: Date) => `${d.getFullYear()}-Q${Math.floor(d.getMonth() / 3) + 1}`;
    const groups: { key: string; days: Date[] }[] = [];
    for (const day of timelineDays) {
      const key = keyFn(day);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.days.push(day);
      else groups.push({ key, days: [day] });
    }
    return groups.map(g => {
      const first = g.days[0];
      const label = scale === 'week'
        ? `Sem ${format(first, 'dd/MM', { locale: ptBR })}`
        : scale === 'month'
          ? format(first, 'MMM yyyy', { locale: ptBR })
          : `T${Math.floor(first.getMonth() / 3) + 1} ${first.getFullYear()}`;
      return { key: g.key, label, width: g.days.length * zoomLevel };
    });
  }, [scale, timelineDays, zoomLevel]);

  // Opções de filtro derivadas das próprias tarefas visíveis — evita precisar
  // de mais props (statusGroups/workspaceTags) só pra listar os valores.
  const filterOptions = useMemo(() => {
    const statuses = new Set<string>();
    const tags = new Set<string>();
    tasks.forEach(t => {
      if (t.status) statuses.add(t.status);
      (t.tags || []).forEach(tag => tags.add(tag));
    });
    return { statuses: Array.from(statuses).sort(), tags: Array.from(tags).sort() };
  }, [tasks]);

  const activeFilterCount = Object.values(filters).filter(v => v !== '' && v !== false).length;

  // Status disponíveis pra edição rápida (Codex_Gantt_09), restritos ao
  // workflow (status group) da LISTA da tarefa em edição — ao contrário de
  // `filterOptions.statuses` acima (que existe só pra filtrar, e por isso
  // agrega todas as listas visíveis de propósito). Usar `filterOptions` aqui
  // deixava salvar um status de outro workflow, e a tarefa sumia do Kanban
  // da própria lista (App.tsx monta as colunas do Kanban a partir do status
  // group configurado da lista, não reconhece um status de fora).
  const quickEditStatusOptions = useMemo(() => {
    if (!quickEditTaskId) return [];
    const task = tasks.find(t => t.id === quickEditTaskId);
    const list = task ? lists.find(l => l.id === task.listId) : undefined;
    const group = list ? statusGroups.find(g => g.id === list.statusGroupId) : undefined;
    const labels = group ? group.options.map(o => o.label) : [];
    // Garante que o valor atual do rascunho sempre apareça no select, mesmo
    // que esteja fora do workflow configurado (dado legado/inconsistente) —
    // senão o select ficaria sem nenhuma opção selecionada.
    return quickDraft && !labels.includes(quickDraft.status) ? [quickDraft.status, ...labels] : labels;
  }, [quickEditTaskId, tasks, lists, statusGroups, quickDraft]);

  const filteredTasks = useMemo(() => {
    if (activeFilterCount === 0) return tasks;
    const today = formatLocalDate(new Date());
    return tasks.filter(t => {
      if (filters.assigneeId && t.mainAssigneeId !== filters.assigneeId && !t.secondaryAssigneeIds?.includes(filters.assigneeId)) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.listId && t.listId !== filters.listId) return false;
      if (filters.tag && !(t.tags || []).includes(filters.tag)) return false;
      if (filters.overdueOnly && !(t.dueDate && t.dueDate < today && !isDoneLikeStatus(t.status))) return false;
      return true;
    });
  }, [tasks, filters, activeFilterCount]);

  // Agrupamento é só uma projeção visual (Codex_Gantt_06): nunca move a
  // tarefa de lista/pasta nem altera dado nenhum, só decide em que "seção"
  // ela aparece e a ordem das linhas.
  const visualRows = useMemo((): VisualRow[] => {
    if (groupBy === 'none') {
      return filteredTasks.map(t => ({ type: 'task', key: t.id, task: t }));
    }
    const groups = new Map<string, { label: string; tasks: Task[] }>();
    filteredTasks.forEach(t => {
      let key: string;
      let label: string;
      if (groupBy === 'assignee') {
        key = t.mainAssigneeId || '__none__';
        label = users.find(u => u.id === t.mainAssigneeId)?.name || 'Sem responsável';
      } else if (groupBy === 'status') {
        key = t.status || '__none__';
        label = t.status || 'Sem status';
      } else {
        key = t.listId || '__none__';
        label = lists.find(l => l.id === t.listId)?.name || 'Sem lista';
      }
      if (!groups.has(key)) groups.set(key, { label, tasks: [] });
      groups.get(key)!.tasks.push(t);
    });
    const rows: VisualRow[] = [];
    Array.from(groups.entries())
      .sort((a, b) => a[1].label.localeCompare(b[1].label, 'pt-BR'))
      .forEach(([key, group]) => {
        rows.push({ type: 'group-header', key: `group:${key}`, groupLabel: group.label, groupCount: group.tasks.length });
        if (!collapsedGroups.has(key)) {
          group.tasks.forEach(t => rows.push({ type: 'task', key: t.id, task: t }));
        }
      });
    return rows;
  }, [filteredTasks, groupBy, users, lists, collapsedGroups]);

  const taskRowIndex = useMemo(() => {
    const map = new Map<string, number>();
    visualRows.forEach((row, idx) => { if (row.type === 'task' && row.task) map.set(row.task.id, idx); });
    return map;
  }, [visualRows]);

  const taskBars = useMemo(() => {
    return filteredTasks.filter(t => t.startDate || t.dueDate).map(task => {
      const override = dateOverrides[task.id];
      const startStr = override?.startDate ?? task.startDate;
      const endStr = override?.dueDate ?? task.dueDate;
      const start = startStr ? parseLocalDate(startStr) : parseLocalDate(endStr!);
      const end = endStr ? parseLocalDate(endStr) : parseLocalDate(startStr!);

      const left = differenceInDays(start, viewStart) * zoomLevel;
      const duration = Math.max(1, differenceInDays(end, start) + 1);
      const width = duration * zoomLevel;

      return {
        ...task,
        start,
        end,
        left,
        width,
        isOverlapping: left < 0 && (left + width) < 0
      };
    }).filter(b => !b.isOverlapping);
  }, [filteredTasks, viewStart, zoomLevel, dateOverrides]);

  // Bloqueio (Codex_Gantt_04): só depende da dependência DIRETA da própria
  // tarefa, então é confiável mesmo sem enxergar o grafo inteiro — ao
  // contrário do caminho crítico abaixo, que precisa de todo o subgrafo
  // visível pra não inventar um resultado.
  const blockedTaskIds = useMemo(() => {
    const blocked = new Set<string>();
    Object.entries(dependenciesByTask).forEach(([taskId, deps]) => {
      const isBlocked = deps.some(d => d.type === 'blocked_by' && d.depends_on_task && !isDoneLikeStatus(d.depends_on_task.status));
      if (isBlocked) blocked.add(taskId);
    });
    return blocked;
  }, [dependenciesByTask]);

  // Caminho crítico (Codex_Gantt_04): caminho mais longo (em dias) através da
  // cadeia de dependências "blocked_by" — igual ao CPM clássico (maior soma
  // de durações num DAG). Só calcula se o subgrafo das tarefas visíveis for
  // acíclico e todas as tarefas envolvidas tiverem início/fim válidos; caso
  // contrário devolve `available: false` e a view não destaca nada em vez de
  // arriscar um resultado inventado (restrição explícita da issue).
  const criticalPath = useMemo(() => {
    const durationByTask = new Map<string, number>();
    taskBars.forEach(b => durationByTask.set(b.id, differenceInDays(b.end, b.start) + 1));

    // Arestas predecessor -> sucessor, só entre tarefas com data válida.
    const successors = new Map<string, string[]>();
    const visibleIds = new Set(durationByTask.keys());
    Object.entries(dependenciesByTask).forEach(([taskId, deps]) => {
      if (!visibleIds.has(taskId)) return;
      deps.forEach(d => {
        if (d.type !== 'blocked_by' || !visibleIds.has(d.depends_on_id)) return;
        const list = successors.get(d.depends_on_id) || [];
        list.push(taskId);
        successors.set(d.depends_on_id, list);
      });
    });

    // Detecta ciclo (DFS com pilha de recursão) — se houver, não calcula.
    const WHITE = 0, GRAY = 1, BLACK = 2;
    const color = new Map<string, number>();
    let hasCycle = false;
    const dfs = (node: string) => {
      color.set(node, GRAY);
      for (const next of successors.get(node) || []) {
        const c = color.get(next) ?? WHITE;
        if (c === GRAY) { hasCycle = true; return; }
        if (c === WHITE) dfs(next);
        if (hasCycle) return;
      }
      color.set(node, BLACK);
    };
    for (const id of visibleIds) {
      if (hasCycle) break;
      if ((color.get(id) ?? WHITE) === WHITE) dfs(id);
    }

    if (hasCycle || visibleIds.size === 0) return { available: false, taskIds: new Set<string>() };

    // Ordena topologicamente (Kahn) e propaga o maior término acumulado.
    const inDegree = new Map<string, number>();
    visibleIds.forEach(id => inDegree.set(id, 0));
    successors.forEach(list => list.forEach(to => inDegree.set(to, (inDegree.get(to) || 0) + 1)));
    const queue = Array.from(visibleIds).filter(id => (inDegree.get(id) || 0) === 0);
    const longestEnd = new Map<string, number>();
    const predecessor = new Map<string, string>();
    visibleIds.forEach(id => longestEnd.set(id, durationByTask.get(id) || 0));
    const order: string[] = [];
    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const next of successors.get(node) || []) {
        const candidate = (longestEnd.get(node) || 0) + (durationByTask.get(next) || 0);
        if (candidate > (longestEnd.get(next) || 0)) {
          longestEnd.set(next, candidate);
          predecessor.set(next, node);
        }
        inDegree.set(next, (inDegree.get(next) || 0) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }
    if (order.length !== visibleIds.size) return { available: false, taskIds: new Set<string>() }; // não deveria acontecer sem ciclo, mas por segurança

    let endNode = '';
    let best = -1;
    longestEnd.forEach((val, id) => { if (val > best) { best = val; endNode = id; } });
    const path = new Set<string>();
    let cursor: string | undefined = endNode;
    while (cursor) { path.add(cursor); cursor = predecessor.get(cursor); }
    // Caminho de uma tarefa só (sem nenhuma dependência de verdade) não é
    // "crítico" no sentido do CPM — não há nada a destacar.
    return { available: path.size > 1, taskIds: path.size > 1 ? path : new Set<string>() };
  }, [taskBars, dependenciesByTask]);

  // Ciclo transitivo: adicionar `dependentId.depends_on(newPredecessorId)`
  // criaria um ciclo se `newPredecessorId` já depende (direta ou
  // transitivamente) de `dependentId`. Restrito ao subgrafo carregado
  // (tarefas hoje visíveis no Gantt) — mesma limitação prática de qualquer
  // checagem client-side; o insert ainda pode falhar no servidor se o grafo
  // real for maior, e nesse caso o erro só aparece via toast do catch.
  const wouldCreateCycle = useCallback((dependentId: string, newPredecessorId: string): boolean => {
    if (dependentId === newPredecessorId) return true;
    const visited = new Set<string>();
    const stack = [newPredecessorId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === dependentId) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      (dependenciesByTask[current] || []).forEach(d => stack.push(d.depends_on_id));
    }
    return false;
  }, [dependenciesByTask]);

  const persistDates = useCallback(async (taskId: string, newStart: Date, newEnd: Date) => {
    const startDateStr = formatLocalDate(newStart);
    const dueDateStr = formatLocalDate(newEnd);

    // Otimista: aplica local antes de esperar a persistência (o próximo
    // render já mostra a barra na posição/tamanho final).
    setDateOverrides(prev => ({ ...prev, [taskId]: { startDate: startDateStr, dueDate: dueDateStr } }));

    if (!onUpdateTask) return;
    const ok = await onUpdateTask(taskId, { startDate: startDateStr, dueDate: dueDateStr });
    if (ok === false) {
      // Falha de persistência: restaura as datas anteriores (remove o
      // override — a barra volta a refletir `task.startDate/dueDate`, que
      // nunca chegaram a mudar no servidor nem no estado do App).
      setDateOverrides(prev => {
        const next = { ...prev };
        delete next[taskId];
        return next;
      });
    }
  }, [onUpdateTask]);

  // Conflito de dependência (Codex_Gantt_10): só alerta, não impede — um
  // deslocamento em lote pode deixar uma tarefa começando antes do fim do seu
  // predecessor (ou um predecessor terminando depois do início de um
  // sucessor que não fazia parte do lote). Só considera a dependência DIRETA
  // já carregada (mesmo escopo confiável de blockedTaskIds/criticalPath
  // acima, não transitivo).
  const findDependencyConflicts = useCallback((movedItems: { taskId: string; newStart: Date; newEnd: Date }[]): string[] => {
    const movedById = new Map(movedItems.map(i => [i.taskId, i]));
    const conflicts: string[] = [];
    const titleOf = (id: string) => tasks.find(t => t.id === id)?.title || id;

    movedItems.forEach(({ taskId, newStart }) => {
      (dependenciesByTask[taskId] || []).forEach(dep => {
        if (dep.type !== 'blocked_by') return;
        const predMoved = movedById.get(dep.depends_on_id);
        const predEnd = predMoved ? predMoved.newEnd : taskBars.find(b => b.id === dep.depends_on_id)?.end;
        if (predEnd && newStart < predEnd) {
          conflicts.push(`"${titleOf(taskId)}" começaria antes do fim de "${titleOf(dep.depends_on_id)}"`);
        }
      });
    });

    Object.entries(dependenciesByTask).forEach(([successorId, deps]) => {
      if (movedById.has(successorId)) return; // já coberto acima (o par foi tratado como predecessor movido)
      deps.forEach(dep => {
        if (dep.type !== 'blocked_by') return;
        const predMoved = movedById.get(dep.depends_on_id);
        if (!predMoved) return;
        const successorStart = taskBars.find(b => b.id === successorId)?.start;
        if (successorStart && successorStart < predMoved.newEnd) {
          conflicts.push(`"${titleOf(dep.depends_on_id)}" passaria a terminar depois do início de "${titleOf(successorId)}"`);
        }
      });
    });

    return conflicts;
  }, [dependenciesByTask, taskBars, tasks]);

  // Movimentação em lote (Codex_Gantt_10): tenta a operação batch/atômica no
  // banco primeiro (uma única instrução SQL, RLS decide linha a linha) e só
  // cai pro loop sequencial (via onUpdateTask, tarefa a tarefa) se a função
  // ainda não tiver sido migrada — nunca ignora silenciosamente permissão nem
  // burla RLS em nenhum dos dois caminhos.
  const persistDatesForMany = useCallback(async (items: { taskId: string; newStart: Date; newEnd: Date }[], deltaDays: number) => {
    if (items.length === 0) return;

    const conflicts = findDependencyConflicts(items);
    if (conflicts.length > 0) {
      toast.error(`Deslocamento gerou ${conflicts.length} conflito(s) de dependência: ${conflicts.slice(0, 2).join('; ')}${conflicts.length > 2 ? '…' : ''}`);
    }

    const overridesEntries: Record<string, { startDate: string; dueDate: string }> = {};
    items.forEach(({ taskId, newStart, newEnd }) => {
      overridesEntries[taskId] = { startDate: formatLocalDate(newStart), dueDate: formatLocalDate(newEnd) };
    });
    // Otimista: aplica local antes de esperar a persistência, igual ao caso
    // de uma tarefa só acima.
    setDateOverrides(prev => ({ ...prev, ...overridesEntries }));

    const requestedIds = items.map(i => i.taskId);
    const rpcResult = await shiftTaskDates(requestedIds, deltaDays).catch(() => null);

    let succeededIds: Set<string>;
    if (rpcResult !== null) {
      // Caminho batch: RLS já filtrou linha a linha — o que não veio no
      // retorno é o que falhou (sem permissão ou id inexistente).
      succeededIds = new Set(rpcResult);
    } else if (onUpdateTask) {
      // Fallback (função ainda não migrada pro banco): sequencial, mas ainda
      // tarefa a tarefa via onUpdateTask (já respeita permissão/RLS).
      const results = await Promise.all(items.map(async ({ taskId }) => {
        const ok = await onUpdateTask(taskId, { startDate: overridesEntries[taskId].startDate, dueDate: overridesEntries[taskId].dueDate });
        return { taskId, ok };
      }));
      succeededIds = new Set(results.filter(r => r.ok !== false).map(r => r.taskId));
    } else {
      succeededIds = new Set();
    }

    const failedIds = requestedIds.filter(id => !succeededIds.has(id));
    if (failedIds.length > 0) {
      // Sucesso parcial (ou falha total): desfaz o override só das que
      // falharam — as bem-sucedidas continuam refletindo a posição nova.
      setDateOverrides(prev => {
        const next = { ...prev };
        failedIds.forEach(id => delete next[id]);
        return next;
      });
      const failedTitles = failedIds.slice(0, 3).map(id => tasks.find(t => t.id === id)?.title || id).join(', ');
      toast.error(
        failedIds.length === requestedIds.length
          ? 'Não foi possível mover nenhuma das tarefas selecionadas (verifique permissão).'
          : `${failedIds.length} de ${requestedIds.length} tarefa(s) não puderam ser movidas (sem permissão?): ${failedTitles}${failedIds.length > 3 ? '…' : ''}.`
      );
    } else {
      toast.success(`${requestedIds.length} tarefa(s) movida(s) em lote.`);
    }
  }, [onUpdateTask, tasks, findDependencyConflicts]);

  // Sincronização visual das setas de dependência durante o arrasto
  // (Codex_Gantt_11): mover/redimensionar já atualiza a barra via DOM direto
  // (sem re-render, ver handleWindowMouseMove) por performance — sem isso as
  // setas ficavam "presas" na posição antiga até soltar o mouse. As mesmas
  // setas já são recalculadas de forma reativa (useMemo) a cada mudança real
  // de estado (data, escala, agrupamento, filtro); isto aqui só cobre o
  // instante intermediário do drag, que não passa por estado do React.
  const dependencyEdges = useMemo(() => {
    const edges: { key: string; sourceId: string; targetId: string }[] = [];
    filteredTasks.forEach(task => {
      (dependenciesByTask[task.id] || []).forEach(dep => {
        edges.push({ key: `${dep.depends_on_id}-${task.id}`, sourceId: dep.depends_on_id, targetId: task.id });
      });
    });
    return edges;
  }, [filteredTasks, dependenciesByTask]);

  const edgesByTaskId = useMemo(() => {
    const map = new Map<string, { key: string; sourceId: string; targetId: string }[]>();
    const push = (id: string, edge: { key: string; sourceId: string; targetId: string }) => {
      const list = map.get(id);
      if (list) list.push(edge); else map.set(id, [edge]);
    };
    dependencyEdges.forEach(edge => { push(edge.sourceId, edge); push(edge.targetId, edge); });
    return map;
  }, [dependencyEdges]);

  const pathRefs = useRef<Record<string, SVGPathElement | null>>({});

  // Posição "ao vivo" de uma barra: igual a `taskBars` (base), mas aplicando
  // por cima o delta do drag em andamento, se a tarefa fizer parte dele —
  // os mesmos cálculos (clamps inclusive) de handleWindowMouseMove abaixo,
  // só que devolvidos em vez de escritos direto num elemento específico.
  const getLiveBarRect = useCallback((taskId: string): { left: number; width: number } | null => {
    const base = taskBars.find(b => b.id === taskId);
    if (!base) return null;
    let { left, width } = base;
    const drag = dragStateRef.current;
    const isDragging = drag && (drag.taskId === taskId || drag.groupOriginals?.[taskId]);
    if (drag && isDragging) {
      if (drag.mode === 'move') {
        left = base.left + drag.currentDeltaDays * zoomLevel;
      } else if (drag.mode === 'resize-right') {
        const newEnd = addDays(drag.originalEnd, drag.currentDeltaDays);
        const clampedEnd = newEnd < drag.originalStart ? drag.originalStart : newEnd;
        width = Math.max(1, differenceInDays(clampedEnd, drag.originalStart) + 1) * zoomLevel;
      } else if (drag.mode === 'resize-left') {
        const newStart = addDays(drag.originalStart, drag.currentDeltaDays);
        const clampedStart = newStart > drag.originalEnd ? drag.originalEnd : newStart;
        width = Math.max(1, differenceInDays(drag.originalEnd, clampedStart) + 1) * zoomLevel;
        left = base.left + differenceInDays(clampedStart, drag.originalStart) * zoomLevel;
      }
    }
    return { left, width };
  }, [taskBars, zoomLevel]);

  const updateDependencyPath = useCallback((edge: { key: string; sourceId: string; targetId: string }) => {
    const pathEl = pathRefs.current[edge.key];
    if (!pathEl) return;
    const sourceIdx = taskRowIndex.get(edge.sourceId);
    const targetIdx = taskRowIndex.get(edge.targetId);
    if (sourceIdx === undefined || targetIdx === undefined) return;
    const sourceRect = getLiveBarRect(edge.sourceId);
    const targetRect = getLiveBarRect(edge.targetId);
    if (!sourceRect || !targetRect) return;
    const x1 = sourceRect.left + sourceRect.width;
    const y1 = sourceIdx * 40 + 20;
    const x2 = targetRect.left;
    const y2 = targetIdx * 40 + 20;
    const midX = x1 + (x2 - x1) / 2;
    pathEl.setAttribute('d', `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`);
  }, [taskRowIndex, getLiveBarRect]);

  const handleWindowMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragStateRef.current;
    if (!drag) return;
    const deltaPixels = e.clientX - drag.startX;
    const deltaDays = Math.round(deltaPixels / zoomLevel);
    if (deltaDays === drag.currentDeltaDays) return;
    drag.currentDeltaDays = deltaDays;

    const el = barRefs.current[drag.taskId];
    if (!el) return;

    if (drag.mode === 'move') {
      const dx = deltaDays * zoomLevel;
      if (drag.groupOriginals) {
        Object.keys(drag.groupOriginals).forEach(id => {
          const groupEl = barRefs.current[id];
          if (groupEl) groupEl.style.transform = `translateX(${dx}px)`;
        });
      } else {
        el.style.transform = `translateX(${dx}px)`;
      }
    } else if (drag.mode === 'resize-right') {
      const newEnd = addDays(drag.originalEnd, deltaDays);
      const clampedEnd = newEnd < drag.originalStart ? drag.originalStart : newEnd;
      const newDuration = Math.max(1, differenceInDays(clampedEnd, drag.originalStart) + 1);
      el.style.width = `${newDuration * zoomLevel}px`;
    } else if (drag.mode === 'resize-left') {
      const newStart = addDays(drag.originalStart, deltaDays);
      const clampedStart = newStart > drag.originalEnd ? drag.originalEnd : newStart;
      const newDuration = Math.max(1, differenceInDays(drag.originalEnd, clampedStart) + 1);
      el.style.width = `${newDuration * zoomLevel}px`;
      el.style.transform = `translateX(${differenceInDays(clampedStart, drag.originalStart) * zoomLevel}px)`;
    }

    // Setas de dependência conectadas a qualquer tarefa que se moveu neste
    // frame (a arrastada, ou todo o grupo em movimentação em lote) — sem
    // isso ficariam apontando pra posição antiga até soltar o mouse.
    const movedIds = drag.groupOriginals ? Object.keys(drag.groupOriginals) : [drag.taskId];
    const edgesToUpdate = new Map<string, { key: string; sourceId: string; targetId: string }>();
    movedIds.forEach(id => (edgesByTaskId.get(id) || []).forEach(edge => edgesToUpdate.set(edge.key, edge)));
    edgesToUpdate.forEach(updateDependencyPath);
  }, [zoomLevel, edgesByTaskId, updateDependencyPath]);

  const handleWindowMouseUp = useCallback(() => {
    const drag = dragStateRef.current;
    window.removeEventListener('mousemove', handleWindowMouseMove);
    window.removeEventListener('mouseup', handleWindowMouseUp);
    dragStateRef.current = null;
    if (!drag) return;

    if (drag.mode === 'move' && drag.groupOriginals) {
      // Movimentação em lote: reseta a transform de TODAS as barras do
      // grupo (não só a que foi arrastada) e persiste o mesmo delta em cada
      // uma, preservando a duração individual de cada tarefa.
      Object.keys(drag.groupOriginals).forEach(id => {
        const groupEl = barRefs.current[id];
        if (groupEl) groupEl.style.transform = '';
      });
      if (drag.currentDeltaDays === 0) return; // clique simples, sem arrastar de verdade
      const deltaDays = drag.currentDeltaDays;
      const items = Object.entries(drag.groupOriginals).map(([taskId, { start, end }]) => {
        justDraggedRef.current.add(taskId);
        return { taskId, newStart: addDays(start, deltaDays), newEnd: addDays(end, deltaDays) };
      });
      persistDatesForMany(items, deltaDays);
      return;
    }

    const el = barRefs.current[drag.taskId];
    if (el) {
      el.style.transform = '';
      el.style.width = '';
    }

    if (drag.currentDeltaDays === 0) return; // clique simples, sem arrastar de verdade

    justDraggedRef.current.add(drag.taskId);

    let newStart = drag.originalStart;
    let newEnd = drag.originalEnd;
    if (drag.mode === 'move') {
      newStart = addDays(drag.originalStart, drag.currentDeltaDays);
      newEnd = addDays(drag.originalEnd, drag.currentDeltaDays);
    } else if (drag.mode === 'resize-right') {
      newEnd = addDays(drag.originalEnd, drag.currentDeltaDays);
      if (newEnd < newStart) newEnd = newStart;
    } else if (drag.mode === 'resize-left') {
      newStart = addDays(drag.originalStart, drag.currentDeltaDays);
      if (newStart > newEnd) newStart = newEnd;
    }

    persistDates(drag.taskId, newStart, newEnd);
  }, [handleWindowMouseMove, persistDates, persistDatesForMany]);

  // Segurança: se o componente desmontar (trocou de view) no meio de um
  // arrasto, não deixa listeners de window vivos apontando pra um bar
  // desmontado.
  useEffect(() => {
    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [handleWindowMouseMove, handleWindowMouseUp]);

  // Cria a dependência de verdade, com as mesmas checagens (ciclo/duplicata)
  // usadas pelo drag — chamada tanto pelo drop do arrasto quanto pela
  // alternativa acessível sem drag (select dentro do popover de edição
  // rápida, ver #159/#153: "existe alternativa não baseada exclusivamente em
  // drag").
  const createDependency = useCallback(async (dependentTaskId: string, predecessorTaskId: string) => {
    if (!currentUserId) return;
    if (dependentTaskId === predecessorTaskId) return;
    if ((dependenciesByTask[dependentTaskId] || []).some(d => d.depends_on_id === predecessorTaskId)) {
      toast.error('Essa dependência já existe.');
      return;
    }
    if (wouldCreateCycle(dependentTaskId, predecessorTaskId)) {
      toast.error('Isso criaria um ciclo de dependências.');
      return;
    }
    try {
      const dep = await addTaskDependency(dependentTaskId, predecessorTaskId, 'blocked_by', currentUserId);
      setDependenciesByTask(prev => ({ ...prev, [dependentTaskId]: [...(prev[dependentTaskId] || []), dep] }));
      toast.success('Dependência criada.');
    } catch {
      toast.error('Erro ao criar dependência.');
    }
  }, [currentUserId, dependenciesByTask, wouldCreateCycle]);

  const clearConnectLine = () => {
    connectStateRef.current = null;
    connectLineRef.current?.setAttribute('d', '');
  };

  const handleConnectMouseMove = useCallback((e: MouseEvent) => {
    const connect = connectStateRef.current;
    const svg = svgContainerRef.current;
    if (!connect || !svg) return;
    const rect = svg.getBoundingClientRect();
    const x2 = e.clientX - rect.left;
    const y2 = e.clientY - rect.top;
    connectLineRef.current?.setAttribute('d', `M ${connect.sourceX} ${connect.sourceY} L ${x2} ${y2}`);
  }, []);

  const handleConnectMouseUp = useCallback((e: MouseEvent) => {
    const connect = connectStateRef.current;
    window.removeEventListener('mousemove', handleConnectMouseMove);
    window.removeEventListener('mouseup', handleConnectMouseUp);
    clearConnectLine();
    if (!connect) return;

    // Alvo = qualquer barra sob o cursor no momento do drop (não precisa
    // acertar o ponto exato do outro lado — mais tolerante que exigir soltar
    // em cima do "ponto" de destino).
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const targetEl = el?.closest('[data-gantt-task-id]') as HTMLElement | null;
    const targetTaskId = targetEl?.dataset.ganttTaskId;
    if (!targetTaskId || targetTaskId === connect.sourceTaskId) return;

    // Arrastar do conector direito de A pro conector esquerdo de B: "A tem
    // que terminar antes de B começar" — B fica com depends_on_id = A.
    createDependency(targetTaskId, connect.sourceTaskId);
  }, [handleConnectMouseMove, createDependency]);

  // Esc cancela a conexão em andamento (item explícito da #153).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connectStateRef.current) {
        window.removeEventListener('mousemove', handleConnectMouseMove);
        window.removeEventListener('mouseup', handleConnectMouseUp);
        clearConnectLine();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('mousemove', handleConnectMouseMove);
      window.removeEventListener('mouseup', handleConnectMouseUp);
    };
  }, [handleConnectMouseMove, handleConnectMouseUp]);

  const startConnect = (e: React.MouseEvent, task: Task) => {
    if (!currentUserId) return;
    e.preventDefault();
    e.stopPropagation();
    const bar = taskBars.find(b => b.id === task.id);
    const svg = svgContainerRef.current;
    if (!bar || !svg) return;
    const rect = svg.getBoundingClientRect();
    connectStateRef.current = {
      sourceTaskId: task.id,
      sourceX: e.clientX - rect.left,
      sourceY: e.clientY - rect.top,
    };
    window.addEventListener('mousemove', handleConnectMouseMove);
    window.addEventListener('mouseup', handleConnectMouseUp);
  };

  const startDrag = (e: React.MouseEvent, task: Task, mode: DragMode) => {
    if (!onUpdateTask) return; // sem permissão/serviço de update, barra fica só clicável
    e.preventDefault();
    e.stopPropagation();
    const bar = taskBars.find(b => b.id === task.id);
    if (!bar) return;

    // Movimentação em lote (Codex_Gantt_10): se a tarefa arrastada faz parte
    // de uma seleção com mais de uma tarefa, todas as outras selecionadas
    // (com barra visível) se movem junto pelo mesmo delta — só faz sentido
    // pra "mover" (resize continua sendo só da barra individual).
    let groupOriginals: Record<string, { start: Date; end: Date }> | undefined;
    if (mode === 'move' && selectedTaskIds.has(task.id) && selectedTaskIds.size > 1) {
      groupOriginals = {};
      selectedTaskIds.forEach(id => {
        const b = taskBars.find(x => x.id === id);
        if (b) groupOriginals![id] = { start: b.start, end: b.end };
      });
    }

    dragStateRef.current = {
      taskId: task.id,
      mode,
      startX: e.clientX,
      originalStart: bar.start,
      originalEnd: bar.end,
      currentDeltaDays: 0,
      groupOriginals,
    };
    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);
  };

  const handleBarClick = (taskId: string) => {
    // Suprime o clique que "sobra" logo depois de um arrasto de verdade —
    // sem isso, soltar a barra também abria o modal de detalhe da tarefa.
    if (justDraggedRef.current.has(taskId)) {
      justDraggedRef.current.delete(taskId);
      return;
    }
    onTaskClick(taskId);
  };

  const openQuickEdit = (task: Task) => {
    setQuickEditTaskId(task.id);
    setQuickDraft({
      title: task.title,
      priority: task.priority,
      mainAssigneeId: task.mainAssigneeId || '',
      status: task.status,
      startDate: task.startDate || '',
      dueDate: task.dueDate || '',
      isMilestone: task.isMilestone ?? false,
    });
  };

  const closeQuickEdit = () => {
    setQuickEditTaskId(null);
    setQuickDraft(null);
    setQuickDependsOnId('');
  };

  const saveQuickEdit = async () => {
    if (!quickDraft || !quickEditTaskId || savingQuickEdit || !onUpdateTask) return;
    const title = quickDraft.title.trim();
    if (!title) return;
    if (!quickDraft.isMilestone && quickDraft.startDate && quickDraft.dueDate && quickDraft.startDate > quickDraft.dueDate) return;

    // Marco (Codex_Gantt_08) não tem intervalo — só um ponto no tempo
    // (due_date). Alinhamos startDate=dueDate pra o cálculo de duração do
    // Gantt (differenceInDays+1) dar exatamente 1 dia sem precisar de um
    // caso especial na renderização da barra/arrasto.
    const startDate = quickDraft.isMilestone ? quickDraft.dueDate : quickDraft.startDate;

    const taskId = quickEditTaskId;
    // Otimista, igual a persistDates/persistDatesForMany acima: substitui
    // (não só desfaz) o override de data por aquilo que acabou de ser salvo —
    // sem isso, uma tarefa arrastada antes e depois editada por aqui via data
    // continuava mostrando a barra na posição do drag antigo até o próximo
    // reload completo (achado do review). Se as duas datas ficaram vazias
    // (marco sem data, por exemplo), remove o override em vez de gravar ''/''
    // — `taskBars` não sabe desenhar uma barra sem nenhuma data válida.
    const previousOverride = dateOverrides[taskId];
    const hasAnyDate = !!(startDate || quickDraft.dueDate);
    setDateOverrides(prev => {
      const next = { ...prev };
      if (hasAnyDate) next[taskId] = { startDate, dueDate: quickDraft.dueDate };
      else delete next[taskId];
      return next;
    });

    setSavingQuickEdit(true);
    const ok = await onUpdateTask(taskId, {
      title,
      priority: quickDraft.priority,
      // `''` (não `undefined`) representa "limpar" nessa base de código (ver
      // KanbanView) — `undefined` some do payload no spread de handleUpdateTask
      // e o Supabase nunca chega a tocar a coluna, deixando o valor antigo no
      // banco (achado do review: campo "limpo" na tela voltava sozinho no
      // próximo reload). updateTaskFields (taskRepo.ts) converte '' -> null.
      mainAssigneeId: quickDraft.mainAssigneeId,
      status: quickDraft.status,
      startDate,
      dueDate: quickDraft.dueDate,
      isMilestone: quickDraft.isMilestone,
    });
    setSavingQuickEdit(false);

    if (ok === false) {
      // Falha: desfaz o override otimista, restaurando o que havia antes
      // (posição de um drag anterior, se houver, ou nada).
      setDateOverrides(prev => {
        const next = { ...prev };
        if (previousOverride) next[taskId] = previousOverride; else delete next[taskId];
        return next;
      });
      // `onUpdateTask` (App.tsx) já mostra o toast de erro — aqui só decide
      // se fecha o popover (sucesso) ou deixa o rascunho aberto pra tentar de
      // novo (falha).
      return;
    }
    closeQuickEdit();
  };

  const toggleGroupCollapsed = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const timelineWidth = scale === 'day'
    ? timelineDays.length * zoomLevel
    : (headerGroups || []).reduce((sum, g) => sum + g.width, 0);

  return (
    <div className="flex flex-col h-full bg-background overflow-hidden">
      {/* Gantt Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 p-4 border-b">
        <div className="flex items-center gap-4">
          <Button variant="outline" size="sm" onClick={() => setViewStart(subDays(viewStart, 7))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setViewStart(subDays(new Date(), 7))}>Hoje</Button>
          <Button variant="outline" size="sm" onClick={() => setViewStart(addDays(viewStart, 7))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
          <span className="text-sm font-semibold capitalize">
            {format(viewStart, 'MMMM yyyy', { locale: ptBR })}
          </span>
          {/* Seleção pra movimentação em lote (Codex_Gantt_10): quantidade
              selecionada + ação clara pra limpar, sempre visível quando há
              alguma tarefa marcada (independente de onde na tela). */}
          {selectedTaskIds.size > 0 && (
            <div className="flex items-center gap-1.5 bg-primary/10 text-primary text-xs font-medium rounded-full pl-3 pr-1 py-1">
              {selectedTaskIds.size} selecionada{selectedTaskIds.size > 1 ? 's' : ''}
              <button
                type="button"
                onClick={() => setSelectedTaskIds(new Set())}
                className="h-5 w-5 flex items-center justify-center rounded-full hover:bg-primary/20"
                title="Limpar seleção"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
           <div className="flex items-center bg-muted rounded-lg p-1">
              {(Object.keys(SCALE_CONFIG) as GanttScale[]).map(s => (
                <Button
                  key={s}
                  variant={scale === s ? 'default' : 'ghost'}
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => handleScaleChange(s)}
                >
                  {SCALE_CONFIG[s].label}
                </Button>
              ))}
           </div>
           <div className="flex items-center bg-muted rounded-lg p-1">
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoomLevel(Math.max(SCALE_CONFIG[scale].minZoom, zoomLevel - SCALE_CONFIG[scale].defaultZoom * 0.15))}>
                <ZoomOut className="w-4 h-4" />
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoomLevel(Math.min(SCALE_CONFIG[scale].maxZoom, zoomLevel + SCALE_CONFIG[scale].defaultZoom * 0.15))}>
                <ZoomIn className="w-4 h-4" />
              </Button>
           </div>

           <select
             value={groupBy}
             onChange={(e) => setGroupBy(e.target.value as GanttGroupBy)}
             className="h-8 text-xs border rounded-md px-2 bg-background"
             title="Agrupar por"
           >
             <option value="none">Sem agrupamento</option>
             <option value="assignee">Responsável</option>
             <option value="status">Status</option>
             <option value="list">Lista</option>
           </select>

           <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
             <PopoverTrigger asChild>
               <Button variant="outline" size="sm" className="gap-1.5">
                 <Filter className="w-4 h-4" /> Filtros
                 {activeFilterCount > 0 && (
                   <span className="ml-1 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold">
                     {activeFilterCount}
                   </span>
                 )}
               </Button>
             </PopoverTrigger>
             <PopoverContent className="w-80 p-3 space-y-2" align="end">
               <div className="flex items-center justify-between">
                 <p className="text-sm font-semibold">Filtros</p>
                 {activeFilterCount > 0 && (
                   <button
                     onClick={() => setFilters(EMPTY_FILTERS)}
                     className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
                   >
                     <X className="w-3 h-3" /> Limpar
                   </button>
                 )}
               </div>

               <select
                 value={filters.assigneeId}
                 onChange={(e) => setFilters(f => ({ ...f, assigneeId: e.target.value }))}
                 className="w-full h-8 text-xs border rounded-md px-2 bg-background"
               >
                 <option value="">Responsável (todos)</option>
                 {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
               </select>

               <select
                 value={filters.priority}
                 onChange={(e) => setFilters(f => ({ ...f, priority: e.target.value }))}
                 className="w-full h-8 text-xs border rounded-md px-2 bg-background"
               >
                 <option value="">Prioridade (todas)</option>
                 <option value="Urgente">Urgente</option>
                 <option value="Alta">Alta</option>
                 <option value="Média">Média</option>
                 <option value="Baixa">Baixa</option>
               </select>

               <select
                 value={filters.status}
                 onChange={(e) => setFilters(f => ({ ...f, status: e.target.value }))}
                 className="w-full h-8 text-xs border rounded-md px-2 bg-background"
               >
                 <option value="">Status (todos)</option>
                 {filterOptions.statuses.map(s => <option key={s} value={s}>{s}</option>)}
               </select>

               <select
                 value={filters.listId}
                 onChange={(e) => setFilters(f => ({ ...f, listId: e.target.value }))}
                 className="w-full h-8 text-xs border rounded-md px-2 bg-background"
               >
                 <option value="">Lista (todas)</option>
                 {lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
               </select>

               {filterOptions.tags.length > 0 && (
                 <select
                   value={filters.tag}
                   onChange={(e) => setFilters(f => ({ ...f, tag: e.target.value }))}
                   className="w-full h-8 text-xs border rounded-md px-2 bg-background"
                 >
                   <option value="">Tag (todas)</option>
                   {filterOptions.tags.map(t => <option key={t} value={t}>{t}</option>)}
                 </select>
               )}

               <label className="flex items-center gap-2 text-xs pt-1 cursor-pointer">
                 <input
                   type="checkbox"
                   checked={filters.overdueOnly}
                   onChange={(e) => setFilters(f => ({ ...f, overdueOnly: e.target.checked }))}
                 />
                 Só tarefas atrasadas
               </label>
             </PopoverContent>
           </Popover>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Task Labels Sidebar */}
        <div className="w-64 border-r flex flex-col bg-muted/5">
          <div className="h-16 border-b flex items-center px-4 font-semibold text-xs text-muted-foreground uppercase">
            Tarefa
          </div>
          <div className="flex-1 overflow-hidden">
            {visualRows.map(row => row.type === 'group-header' ? (
              <div
                key={row.key}
                className="h-10 border-b flex items-center px-3 text-xs font-semibold bg-muted/40 cursor-pointer select-none gap-1.5"
                onClick={() => toggleGroupCollapsed(row.key.replace(/^group:/, ''))}
              >
                <Layers className="w-3 h-3 text-muted-foreground shrink-0" />
                <span className="truncate">{row.groupLabel}</span>
                <span className="text-muted-foreground font-normal shrink-0">({row.groupCount})</span>
              </div>
            ) : (
              <div key={row.key} className="h-10 border-b flex items-center gap-2 px-4 text-sm hover:bg-muted/10 cursor-pointer transition-colors"
                onClick={() => onTaskClick(row.task!.id)}>
                {onUpdateTask && (
                  <input
                    type="checkbox"
                    className="shrink-0"
                    checked={selectedTaskIds.has(row.task!.id)}
                    title="Selecionar para movimentação em lote"
                    onClick={(e) => e.stopPropagation()}
                    onChange={() => toggleTaskSelection(row.task!.id)}
                  />
                )}
                <span className="truncate">{row.task!.title}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Timeline Grid */}
        <div className="flex-1 overflow-auto relative custom-scrollbar">
          {/* Timeline Header */}
          <div className="h-16 border-b flex sticky top-0 bg-background z-20" style={{ width: timelineWidth }}>
            {scale === 'day' ? timelineDays.map(day => (
              <div key={day.toISOString()}
                className={`flex-shrink-0 border-r text-[10px] flex flex-col items-center justify-center
                  ${isWeekend(day) ? 'bg-muted/30' : ''}
                  ${isToday(day) ? 'bg-primary/5' : ''}
                `}
                style={{ width: zoomLevel }}>
                <span className="text-muted-foreground">{format(day, 'eee', { locale: ptBR })}</span>
                <span className={`font-bold ${isToday(day) ? 'text-primary' : ''}`}>{format(day, 'd')}</span>
              </div>
            )) : (headerGroups || []).map(g => (
              <div key={g.key}
                className="flex-shrink-0 border-r text-[11px] font-semibold flex items-center justify-center capitalize"
                style={{ width: g.width }}>
                {g.label}
              </div>
            ))}
          </div>

          {/* Timeline Body */}
          <div className="relative" style={{ width: timelineWidth }}>
            {/* Grid Lines — só no dia-a-dia; nas escalas mais largas as linhas
                de grupo (semana/mês/trimestre) já servem de referência visual
                e uma linha por dia ficaria denso demais pra enxergar. */}
            {scale === 'day' && (
              <div className="absolute inset-0 flex pointer-events-none">
                 {timelineDays.map(day => (
                   <div key={`line-${day.toISOString()}`}
                      className={`border-r h-full ${isWeekend(day) ? 'bg-muted/10' : ''} ${isToday(day) ? 'border-primary/20' : ''}`}
                      style={{ width: zoomLevel }}
                   />
                 ))}
              </div>
            )}

            {/* Dependency arrows */}
            <svg
              ref={svgContainerRef}
              className="absolute inset-0 pointer-events-none z-0"
              style={{ width: timelineWidth, height: visualRows.length * 40 }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
                </marker>
                <marker id="arrowhead-critical" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                  <polygon points="0 0, 10 3.5, 0 7" fill="#ef4444" />
                </marker>
              </defs>
              {dependencyEdges.map((edge) => {
                // `dependencyEdges` já filtra pelas tarefas visíveis
                // (deriva de filteredTasks) — mas o predecessor pode ter
                // ficado de fora do recorte atual (filtro/grupo recolhido)
                // mesmo sendo dependência de uma tarefa visível, daí o
                // `taskRowIndex`/`taskBars` ainda precisarem confirmar os
                // dois lados antes de desenhar (Codex_Gantt_11: "não
                // desenhar linhas incorretas" quando um lado some da tela).
                const sourceIdx = taskRowIndex.get(edge.sourceId);
                const targetIdx = taskRowIndex.get(edge.targetId);
                if (sourceIdx === undefined || targetIdx === undefined) return null;

                const sourceBar = taskBars.find(b => b.id === edge.sourceId);
                const targetBar = taskBars.find(b => b.id === edge.targetId);
                if (!sourceBar || !targetBar) return null;

                const x1 = sourceBar.left + sourceBar.width;
                const y1 = (sourceIdx * 40) + 20; // 40 is row height, 20 is center
                const x2 = targetBar.left;
                const y2 = (targetIdx * 40) + 20;

                // Simple path: ┐ then ┘
                const midX = x1 + (x2 - x1) / 2;
                const isCritical = criticalPath.available && criticalPath.taskIds.has(edge.sourceId) && criticalPath.taskIds.has(edge.targetId);

                return (
                  <path
                    key={edge.key}
                    ref={(el) => { pathRefs.current[edge.key] = el; }}
                    d={`M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`}
                    fill="none"
                    stroke={isCritical ? '#ef4444' : '#94a3b8'}
                    strokeWidth={isCritical ? 2 : 1.5}
                    markerEnd={isCritical ? 'url(#arrowhead-critical)' : 'url(#arrowhead)'}
                    className="transition-all duration-300"
                  />
                );
              })}
              {/* Linha temporária enquanto o usuário arrasta de uma barra a
                  outra pra criar uma dependência (Codex_Gantt_03) — atualizada
                  via DOM direto (ver handleConnectMouseMove), sem re-render. */}
              <path ref={connectLineRef} fill="none" stroke="#3b82f6" strokeWidth="2" strokeDasharray="4 3" />
            </svg>

            {/* Bars */}
            <div className="relative z-10 py-1">
              {visualRows.map((row) => {
                if (row.type === 'group-header') {
                  return <div key={row.key} className="h-10 border-b bg-muted/40" />;
                }
                const task = row.task!;
                const bar = taskBars.find(b => b.id === task.id);
                return (
                  <div key={row.key} className="h-10 border-b flex items-center relative group">
                    {bar && (
                      <div
                        ref={(el) => { barRefs.current[task.id] = el; }}
                        data-gantt-task-id={task.id}
                        title={
                          task.isMilestone
                            ? `${task.title} · ${format(bar.start, 'dd/MM/yyyy', { locale: ptBR })}`
                            : (blockedTaskIds.has(task.id) ? 'Bloqueada por dependência pendente' : undefined)
                        }
                        className={`absolute h-6 flex items-center transition-[filter] hover:brightness-110
                          ${onUpdateTask ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}
                          ${task.isMilestone
                            ? ''
                            : `px-2 text-[10px] text-white font-medium rounded-md shadow-sm
                               ${task.priority === 'Urgente' ? 'bg-destructive' : 'bg-primary'}
                               ${blockedTaskIds.has(task.id) ? 'opacity-80 [background-image:repeating-linear-gradient(135deg,rgba(0,0,0,0.15)_0_6px,transparent_6px_12px)]' : ''}`
                          }
                          ${criticalPath.available && criticalPath.taskIds.has(task.id) ? (task.isMilestone ? '' : 'ring-2 ring-red-500 ring-offset-1') : ''}
                        `}
                        style={{ left: bar.left, width: bar.width }}
                        onMouseDown={(e) => startDrag(e, task, 'move')}
                        onClick={() => handleBarClick(task.id)}
                      >
                         {task.isMilestone ? (
                           <>
                             {/* Marco (Codex_Gantt_08): marcador pontual (losango)
                                 na data — não é uma barra com intervalo, então o
                                 título fica ao lado, fora da caixa de 1 dia. */}
                             <div
                               className={`absolute left-1/2 top-1/2 w-3.5 h-3.5 -translate-x-1/2 -translate-y-1/2 rotate-45 shadow-sm
                                 ${task.priority === 'Urgente' ? 'bg-destructive' : 'bg-primary'}
                                 ${criticalPath.available && criticalPath.taskIds.has(task.id) ? 'ring-2 ring-red-500' : ''}
                               `}
                             />
                             {blockedTaskIds.has(task.id) && (
                               <AlertTriangle className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-[220%] w-3 h-3 text-amber-500" />
                             )}
                             <span className="absolute left-full ml-2 whitespace-nowrap text-[10px] font-medium text-foreground pointer-events-none">
                               {task.title}
                             </span>
                           </>
                         ) : (
                           <>
                             {blockedTaskIds.has(task.id) && <AlertTriangle className="w-2.5 h-2.5 shrink-0 mr-0.5" />}
                             <span className="truncate pointer-events-none">{task.title}</span>
                           </>
                         )}

                         {/* Handles de redimensionar (início/fim) — só aparecem com
                             permissão de editar (onUpdateTask presente) e no hover,
                             pra manter a barra limpa no resto do tempo. Marco não
                             tem duração pra redimensionar. */}
                         {onUpdateTask && !task.isMilestone && (
                           <>
                             <div
                               role="presentation"
                               className="absolute left-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/40 rounded-l-md"
                               onMouseDown={(e) => startDrag(e, task, 'resize-left')}
                             />
                             <div
                               role="presentation"
                               className="absolute right-0 top-0 bottom-0 w-1.5 cursor-ew-resize opacity-0 group-hover:opacity-100 bg-white/40 rounded-r-md"
                               onMouseDown={(e) => startDrag(e, task, 'resize-right')}
                             />
                           </>
                         )}

                         {/* Pontos de dependência (Codex_Gantt_03): o da direita
                             inicia a conexão (arrastar até outra barra cria
                             "esta tarefa bloqueia aquela"); o da esquerda é só
                             indicativo (o alvo é a barra inteira, não precisa
                             acertar o pixel do ponto). */}
                         <div className="absolute -left-1 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-white border border-primary opacity-0 group-hover:opacity-100 pointer-events-none" />
                         {currentUserId && (
                           <div
                             role="presentation"
                             title="Arraste para criar uma dependência"
                             className="absolute -right-1 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-2 border-primary opacity-0 group-hover:opacity-100 cursor-crosshair"
                             onMouseDown={(e) => startConnect(e, task)}
                           />
                         )}

                         {/* Edição rápida (Codex_Gantt_09): botão só aparece no
                             hover, sobrepondo o canto superior da própria
                             barra (não flutuando acima dela) — um gap solto
                             fica fora da caixa da própria linha (`.group`) e
                             quebra a cadeia de hover ao mover o mouse da
                             barra até o botão (achado do review: o botão
                             desaparecia antes de dar tempo de clicar, e na
                             primeira linha ficava atrás do cabeçalho fixo). */}
                         {onUpdateTask && (
                           <Popover
                             open={quickEditTaskId === task.id}
                             onOpenChange={(open) => { if (!open) closeQuickEdit(); }}
                           >
                             <PopoverTrigger asChild>
                               <button
                                 type="button"
                                 className="absolute -top-1 right-1 hidden group-hover:flex h-5 w-5 items-center justify-center rounded-full border bg-white text-gray-500 shadow-sm hover:text-gray-900 z-10"
                                 title="Edição rápida"
                                 onMouseDown={(e) => e.stopPropagation()}
                                 onClick={(e) => { e.stopPropagation(); openQuickEdit(task); }}
                               >
                                 <Pencil className="w-3 h-3" />
                               </button>
                             </PopoverTrigger>
                             <PopoverContent
                               className="w-72 p-3 space-y-2"
                               align="start"
                               onMouseDown={(e) => e.stopPropagation()}
                               onClick={(e) => e.stopPropagation()}
                             >
                               {quickDraft && (
                                 <>
                                   <input
                                     autoFocus
                                     value={quickDraft.title}
                                     onChange={(e) => setQuickDraft({ ...quickDraft, title: e.target.value })}
                                     onKeyDown={(e) => { if (e.key === 'Enter') saveQuickEdit(); }}
                                     className="w-full h-8 text-sm font-medium border rounded-md px-2"
                                     placeholder="Título da tarefa"
                                   />
                                   <div className="grid grid-cols-2 gap-2">
                                     <select
                                       value={quickDraft.priority}
                                       onChange={(e) => setQuickDraft({ ...quickDraft, priority: e.target.value as TaskPriority })}
                                       className="h-8 text-xs border rounded-md px-2"
                                     >
                                       {Object.values(TaskPriority).map(p => <option key={p} value={p}>{p}</option>)}
                                     </select>
                                     <select
                                       value={quickDraft.status}
                                       onChange={(e) => setQuickDraft({ ...quickDraft, status: e.target.value })}
                                       className="h-8 text-xs border rounded-md px-2"
                                     >
                                       {quickEditStatusOptions.map(s => (
                                         <option key={s} value={s}>{s}</option>
                                       ))}
                                     </select>
                                   </div>
                                   <select
                                     value={quickDraft.mainAssigneeId}
                                     onChange={(e) => setQuickDraft({ ...quickDraft, mainAssigneeId: e.target.value })}
                                     className="w-full h-8 text-xs border rounded-md px-2"
                                   >
                                     <option value="">Sem responsável</option>
                                     {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                                   </select>
                                   <label className="flex items-center gap-2 text-xs cursor-pointer">
                                     <input
                                       type="checkbox"
                                       checked={quickDraft.isMilestone}
                                       onChange={(e) => setQuickDraft({ ...quickDraft, isMilestone: e.target.checked })}
                                     />
                                     Marco (sem duração, só uma data)
                                   </label>
                                   <div className="grid grid-cols-2 gap-2">
                                     {!quickDraft.isMilestone && (
                                       <DateFieldEditor
                                         value={quickDraft.startDate}
                                         onCommit={(v) => setQuickDraft({ ...quickDraft, startDate: v })}
                                         className="h-8 text-xs border rounded-md px-2"
                                         ariaLabel="Início"
                                       />
                                     )}
                                     <DateFieldEditor
                                       value={quickDraft.dueDate}
                                       onCommit={(v) => setQuickDraft({ ...quickDraft, dueDate: v })}
                                       className={`h-8 text-xs border rounded-md px-2 ${quickDraft.isMilestone ? 'col-span-2' : ''}`}
                                       ariaLabel={quickDraft.isMilestone ? 'Data do marco' : 'Fim'}
                                     />
                                   </div>
                                   {!quickDraft.isMilestone && quickDraft.startDate && quickDraft.dueDate && quickDraft.startDate > quickDraft.dueDate && (
                                     <p className="text-[11px] text-destructive">Início não pode ser depois do fim.</p>
                                   )}

                                   {/* Alternativa sem drag pra criar dependência
                                       (Codex_Gantt_03) — o mesmo resultado de
                                       arrastar o conector direito da barra. */}
                                   {currentUserId && (
                                     <div className="border-t pt-2 space-y-1.5">
                                       <p className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                                         <Link2 className="w-3 h-3" /> Depende de
                                       </p>
                                       <div className="flex gap-1.5">
                                         <select
                                           value={quickDependsOnId}
                                           onChange={(e) => setQuickDependsOnId(e.target.value)}
                                           className="flex-1 h-7 text-xs border rounded-md px-1.5"
                                         >
                                           <option value="">Selecionar tarefa…</option>
                                           {tasks
                                             .filter(t => t.id !== quickEditTaskId && !(dependenciesByTask[quickEditTaskId!] || []).some(d => d.depends_on_id === t.id))
                                             .map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                                         </select>
                                         <Button
                                           size="sm"
                                           variant="outline"
                                           className="h-7 text-xs shrink-0"
                                           disabled={!quickDependsOnId}
                                           onClick={() => { createDependency(quickEditTaskId!, quickDependsOnId); setQuickDependsOnId(''); }}
                                         >
                                           Vincular
                                         </Button>
                                       </div>
                                     </div>
                                   )}

                                   <div className="flex justify-end gap-2 pt-1">
                                     <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={closeQuickEdit}>Cancelar</Button>
                                     <Button size="sm" className="h-7 text-xs" disabled={savingQuickEdit} onClick={saveQuickEdit}>
                                       {savingQuickEdit ? 'Salvando…' : 'Salvar'}
                                     </Button>
                                   </div>
                                 </>
                               )}
                             </PopoverContent>
                           </Popover>
                         )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
