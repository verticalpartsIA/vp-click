import React, { useEffect, useMemo, useState } from 'react';
import { PRIORITY_COLORS } from '../../constants';
import { avatarThumb } from '../../lib/avatarUrl';
import { formatShortDateBR } from '../../lib/dates';
import { Task, User } from '../../types';
import { readRecentTaskIds } from '../../lib/recentTasks';

interface RecentTasksViewProps {
  currentUser: User;
  users: User[];
  tasks: Task[];
  onOpenTask: (taskId: string) => void;
}

function PriorityBadge({ priority }: { priority: string }) {
  const cls = (PRIORITY_COLORS as Record<string, string>)[priority] || 'bg-gray-100 text-gray-500';
  return <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`}>{priority}</span>;
}

/**
 * Todas as tarefas (item "Mais" do Início, estilo ClickUp): no ClickUp real
 * isso NÃO é "toda tarefa do workspace sem filtro" — é a lista de tarefas que
 * você abriu recentemente (o que a busca/Ctrl+K também mostra), com filtros
 * simples por atribuição. Reaproveita o mesmo registro de "recentes" já usado
 * no card "Recentes" de Minhas Tarefas.
 */
export function RecentTasksView({ currentUser, users, tasks, onOpenTask }: RecentTasksViewProps) {
  const [filter, setFilter] = useState<'all' | 'assigned' | 'created'>('all');
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => { setRecentIds(readRecentTaskIds(currentUser.id)); }, [currentUser.id]);

  const recentTasks = useMemo(
    () => recentIds.map((id) => tasks.find((t) => t.id === id)).filter((t): t is Task => !!t),
    [recentIds, tasks]
  );

  const visibleTasks = useMemo(() => {
    if (filter === 'assigned') {
      return recentTasks.filter((t) => t.mainAssigneeId === currentUser.id || (t.secondaryAssigneeIds || []).includes(currentUser.id));
    }
    if (filter === 'created') {
      return recentTasks.filter((t) => t.createdBy === currentUser.id);
    }
    return recentTasks;
  }, [recentTasks, filter, currentUser.id]);

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-gray-800">Todas as tarefas</h2>
        <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
          {([['all', 'Todas'], ['assigned', 'Atribuídas a mim'], ['created', 'Criadas por mim']] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${filter === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <p className="text-[11px] text-gray-400 mb-3">Tarefas que você abriu recentemente, mais recente primeiro.</p>
        {visibleTasks.length === 0 ? (
          <p className="text-xs text-gray-400 py-4 text-center">Nenhuma tarefa recente por aqui ainda. Abra uma tarefa para ela aparecer nesta lista.</p>
        ) : (
          <div className="space-y-0.5">
            {visibleTasks.map((t) => {
              const assignee = users.find((u) => u.id === t.mainAssigneeId);
              return (
                <button
                  key={t.id}
                  onClick={() => onOpenTask(t.id)}
                  className="w-full text-left flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors group"
                >
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 shrink-0 group-hover:border-orange-400" />
                  <span className="text-sm text-gray-700 truncate flex-1">{t.title}</span>
                  {assignee && <img src={avatarThumb(assignee.avatar)} title={assignee.name} className="w-5 h-5 rounded-full shrink-0" alt="" />}
                  <PriorityBadge priority={t.priority} />
                  {t.dueDate && (
                    <span className="text-[10px] text-gray-400 shrink-0">
                      {formatShortDateBR(t.dueDate)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
