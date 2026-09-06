import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { PRIORITY_COLORS } from '../../constants';
import { avatarThumb } from '../../lib/avatarUrl';
import { readRecentTaskIds } from '../../lib/recentTasks';
import { formatShortDateBR } from '../../lib/dates';
import { Task, User } from '../../types';

interface MyTasksViewProps {
  currentUser: User;
  users: User[];
  tasks: Task[];
  isLoading?: boolean;
  onOpenTask: (taskId: string) => void;
}

const DONE_KEYWORDS = ['conclu', 'done', 'closed', 'complete', 'finaliz', 'pronto', 'aprovado'];
// Mesma lista usada no ask-ai (supabase/functions/ask-ai/index.ts) — cancelada/
// recusada é um status terminal, mas não "feito": sem isso, tarefa cancelada
// contava como trabalho pendente em aberto/atrasado.
const CANCEL_KEYWORDS = ['cancel', 'recusad'];
const isDoneStatus = (status: string) => DONE_KEYWORDS.some((k) => (status || '').toLowerCase().includes(k));
const isCancelledStatus = (status: string) => CANCEL_KEYWORDS.some((k) => (status || '').toLowerCase().includes(k));

function todayLocalDateStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = (PRIORITY_COLORS as Record<string, string>)[priority] || 'bg-gray-100 text-gray-500';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{priority}</span>;
}

function TaskRow({ task, users, onOpenTask, rightSlot }: { task: Task; users: User[]; onOpenTask: (id: string) => void; rightSlot?: React.ReactNode }) {
  const assignee = users.find((u) => u.id === task.mainAssigneeId);
  return (
    <button
      onClick={() => onOpenTask(task.id)}
      className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
    >
      <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 shrink-0 group-hover:border-orange-400" />
      <span className="text-sm text-gray-700 truncate flex-1">{task.title}</span>
      {assignee && <img src={avatarThumb(assignee.avatar)} title={assignee.name} className="w-5 h-5 rounded-full shrink-0" alt="" />}
      <PriorityBadge priority={task.priority} />
      {rightSlot}
    </button>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-bold text-gray-700">{title}</h2>
        {action}
      </div>
      {children}
    </div>
  );
}

/**
 * Minhas tarefas (item 5 da sidebar "Início", estilo ClickUp — página "My
 * Tasks"/Home do ClickUp real): dashboard com os cards Recentes, Agenda, Meu
 * trabalho (abas Pendente/Feito/Delegado, agrupado por prazo) e Atribuídas a
 * mim. "Agenda" é só um placeholder visual — sem integração de calendário de
 * verdade, mesma decisão já tomada em Reuniões. "Delegado" mapeia pra
 * tarefas criadas por mim e atribuídas a outra pessoa (não temos "lembretes"
 * como entidade separada, só tarefa).
 */
export function MyTasksView({ currentUser, users, tasks, isLoading = false, onOpenTask }: MyTasksViewProps) {
  const [tab, setTab] = useState<'todo' | 'done' | 'delegated'>('todo');
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => { setRecentIds(readRecentTaskIds(currentUser.id)); }, [currentUser.id]);

  const myTasks = useMemo(
    () => tasks.filter((t) => t.mainAssigneeId === currentUser.id || (t.secondaryAssigneeIds || []).includes(currentUser.id)),
    [tasks, currentUser.id]
  );
  const pendingMine = useMemo(() => myTasks.filter((t) => !isDoneStatus(t.status) && !isCancelledStatus(t.status)), [myTasks]);
  const doneMine = useMemo(() => myTasks.filter((t) => isDoneStatus(t.status)), [myTasks]);
  const delegated = useMemo(
    () => tasks.filter((t) => t.createdBy === currentUser.id && t.mainAssigneeId !== currentUser.id),
    [tasks, currentUser.id]
  );

  const today = todayLocalDateStr();
  const buckets = useMemo(() => {
    const b = { hoje: [] as Task[], atraso: [] as Task[], proximo: [] as Task[], semData: [] as Task[] };
    pendingMine.forEach((t) => {
      if (!t.dueDate) b.semData.push(t);
      else if (t.dueDate < today) b.atraso.push(t);
      else if (t.dueDate === today) b.hoje.push(t);
      else b.proximo.push(t);
    });
    const byDueDate = (a: Task, bb: Task) => (a.dueDate || '').localeCompare(bb.dueDate || '');
    b.hoje.sort(byDueDate); b.atraso.sort(byDueDate); b.proximo.sort(byDueDate);
    return b;
  }, [pendingMine, today]);

  const assignedToMeTable = useMemo(
    () => [...pendingMine].sort((a, b) => (a.dueDate || '9999-99-99').localeCompare(b.dueDate || '9999-99-99')),
    [pendingMine]
  );

  const recentTasks = recentIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t);

  const tabItems = tab === 'todo' ? null : tab === 'done' ? doneMine : delegated;

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800 mb-4">{greeting()}, {currentUser.name.split(' ')[0]}</h2>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <Card title="Recentes">
            {isLoading ? (
              <p className="text-xs text-gray-400 py-2">Carregando tarefas...</p>
            ) : recentTasks.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">Nenhuma tarefa aberta recentemente.</p>
            ) : (
              <div className="space-y-0.5 max-h-64 overflow-y-auto custom-scrollbar">
                {recentTasks.map((t) => <TaskRow key={t.id} task={t} users={users} onOpenTask={onOpenTask} />)}
              </div>
            )}
          </Card>

          <Card
            title="Meu trabalho"
            action={
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
                {([['todo', 'Pendente'], ['done', 'Feito'], ['delegated', 'Delegado']] as const).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setTab(key)}
                    className={`px-2 py-1 text-[11px] font-semibold rounded-md transition-colors ${tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            }
          >
            {tab === 'todo' ? (
              <div className="space-y-3 max-h-96 overflow-y-auto custom-scrollbar">
                {([
                  ['Hoje', buckets.hoje],
                  ['Em atraso', buckets.atraso],
                  ['Próximo', buckets.proximo],
                  ['Não programado', buckets.semData],
                ] as const).map(([label, items]) => (
                  <div key={label}>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide px-2 mb-1">{label} <span className="text-gray-300">{items.length}</span></p>
                    {isLoading ? (
                      <p className="text-xs text-gray-300 px-2 pb-1">Carregando...</p>
                    ) : items.length === 0 ? (
                      <p className="text-xs text-gray-300 px-2 pb-1">Nada por aqui.</p>
                    ) : items.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        users={users}
                        onOpenTask={onOpenTask}
                        rightSlot={t.dueDate ? <span className="text-[10px] text-gray-400 shrink-0">{formatShortDateBR(t.dueDate)}</span> : undefined}
                      />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-0.5 max-h-96 overflow-y-auto custom-scrollbar">
                {isLoading && <p className="text-xs text-gray-400 py-2">Carregando tarefas...</p>}
                {!isLoading && tabItems && tabItems.length === 0 && (
                  <p className="text-xs text-gray-400 py-2">{tab === 'done' ? 'Nenhuma tarefa concluída ainda.' : 'Você ainda não delegou nenhuma tarefa.'}</p>
                )}
                {!isLoading && tabItems && tabItems.map((t) => (
                  <TaskRow
                    key={t.id}
                    task={t}
                    users={users}
                    onOpenTask={onOpenTask}
                    rightSlot={tab === 'delegated' ? <span className="text-[10px] text-gray-400 shrink-0">{users.find((u) => u.id === t.mainAssigneeId)?.name || 'Sem responsável'}</span> : undefined}
                  />
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Agenda">
            <div className="flex flex-col items-center text-center py-6 px-2">
              <p className="text-xs text-gray-400 mb-4">Conecte seu calendário para ver os próximos eventos e entrar na sua próxima chamada</p>
              <div className="w-full space-y-2">
                <button
                  onClick={() => toast.info('Integração com calendário ainda não disponível.')}
                  className="w-full flex items-center justify-between text-xs px-3 py-2 border rounded-lg hover:bg-gray-50"
                >
                  <span className="text-gray-600">Google Agenda</span>
                  <span className="font-semibold text-blue-500">Conectar</span>
                </button>
                <button
                  onClick={() => toast.info('Integração com calendário ainda não disponível.')}
                  className="w-full flex items-center justify-between text-xs px-3 py-2 border rounded-lg hover:bg-gray-50"
                >
                  <span className="text-gray-600">Microsoft Outlook</span>
                  <span className="font-semibold text-blue-500">Conectar</span>
                </button>
              </div>
            </div>
          </Card>

          <Card title="Atribuídas a mim" action={<span className="text-[11px] font-semibold text-gray-400">{assignedToMeTable.length} pendente{assignedToMeTable.length === 1 ? '' : 's'}</span>}>
            {isLoading ? (
              <p className="text-xs text-gray-400 py-2">Carregando tarefas...</p>
            ) : assignedToMeTable.length === 0 ? (
              <p className="text-xs text-gray-400 py-2">Nenhuma tarefa pendente atribuída a você. 🎉</p>
            ) : (
              <div className="max-h-96 overflow-y-auto custom-scrollbar">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[10px] text-gray-400 uppercase tracking-wide">
                      <th className="pb-2 font-semibold">Nome</th>
                      <th className="pb-2 font-semibold w-20">Prioridade</th>
                      <th className="pb-2 font-semibold w-24 text-right">Prazo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assignedToMeTable.map((t) => (
                      <tr key={t.id} onClick={() => onOpenTask(t.id)} className="cursor-pointer hover:bg-gray-50 border-t border-gray-50">
                        <td className="py-2 truncate max-w-[200px]">{t.title}</td>
                        <td className="py-2"><PriorityBadge priority={t.priority} /></td>
                        <td className="py-2 text-right text-xs text-gray-400">
                          {t.dueDate ? formatShortDateBR(t.dueDate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
