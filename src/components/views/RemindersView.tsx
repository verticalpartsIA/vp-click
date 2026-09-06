import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { avatarThumb } from '../../lib/avatarUrl';
import { formatDateTimeShortBR } from '../../lib/dates';
import { List, Reminder, ReminderNotifyPreference, User } from '../../types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface RemindersViewProps {
  currentUser: User;
  users: User[];
  lists: List[];
  onOpenTask: (taskId: string) => void;
  onCreateTaskFromReminder: (reminder: { id: string; title: string }, listId: string) => Promise<string | null>;
}

const NOTIFY_LABELS: Record<ReminderNotifyPreference, string> = {
  on_due: 'Na hora',
  '10_min_before': '10 minutos antes',
  '1_hour_before': '1 hora antes',
  custom: 'Personalizado',
  off: 'Desativado',
};

// YYYY-MM-DD em hora LOCAL — dueAt vem em UTC (timestamptz); usar
// `dueAt.slice(0, 10)' direto pegaria a data em UTC, que em fusos negativos
// (Brasil, EUA) empurra um lembrete de fim de noite pro dia seguinte,
// classificando "hoje às 23h30" como "Próximo" em vez de "Hoje".
function localDateStr(date: Date | string) {
  const d = typeof date === 'string' ? new Date(date) : date;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayLocalDateStr() {
  return localDateStr(new Date());
}

// Formato aceito por <input type="datetime-local">: YYYY-MM-DDTHH:mm, em hora local.
function toDatetimeLocalValue(iso: string) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:${min}`;
}

// formatDueAt agora vive em lib/dates como formatDateTimeShortBR (issue
// #102, achado 3).
const formatDueAt = formatDateTimeShortBR;

function mapRow(r: any): Reminder {
  return {
    id: r.id,
    title: r.title,
    details: r.details || undefined,
    dueAt: r.due_at,
    notifyPreference: r.notify_preference,
    customNotifyAt: r.custom_notify_at || undefined,
    userId: r.user_id,
    createdBy: r.created_by || undefined,
    completed: r.completed,
    completedAt: r.completed_at || undefined,
    taskId: r.task_id || undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at || undefined,
  };
}

/**
 * Lembretes ("Hoje e atrasadas", item 7 da sidebar "Início", estilo ClickUp):
 * entidade separada de tarefa — a tela real do ClickUp mostra "tarefas E OS
 * LEMBRETES atribuídos a você aqui". As tarefas por prazo já ficam no
 * dashboard de Minhas Tarefas (MyTasksView); esta página cobre só os
 * lembretes de verdade. Preferência de notificação é só guardada (sem
 * cron/disparo real — decisão consciente, ver migration 19).
 */
export function RemindersView({ currentUser, users, lists, onOpenTask, onCreateTaskFromReminder }: RemindersViewProps) {
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<'pending' | 'done' | 'delegated'>('pending');
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null);
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleValue, setRescheduleValue] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDueAt, setNewDueAt] = useState('');
  const [newDetails, setNewDetails] = useState('');
  const [newNotify, setNewNotify] = useState<ReminderNotifyPreference>('off');
  const [newCustomNotifyAt, setNewCustomNotifyAt] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const loadReminders = useCallback(async () => {
    setIsLoading(true);
    const { data } = await supabase
      .from('reminders')
      .select('*')
      .or(`user_id.eq.${currentUser.id},created_by.eq.${currentUser.id}`)
      .order('due_at', { ascending: true })
      .limit(300);
    if (data) setReminders(data.map(mapRow));
    setIsLoading(false);
  }, [currentUser.id]);

  useEffect(() => { loadReminders(); }, [loadReminders]);

  const createReminder = async () => {
    if (!newTitle.trim() || !newDueAt) return;
    setIsCreating(true);
    const { data, error } = await supabase
      .from('reminders')
      .insert({
        title: newTitle.trim(),
        details: newDetails.trim() || null,
        due_at: new Date(newDueAt).toISOString(),
        notify_preference: newNotify,
        custom_notify_at: newNotify === 'custom' && newCustomNotifyAt ? new Date(newCustomNotifyAt).toISOString() : null,
        user_id: currentUser.id,
        created_by: currentUser.id,
      })
      .select()
      .single();
    setIsCreating(false);
    if (error || !data) { toast.error('Erro ao criar lembrete.'); return; }
    setReminders((prev) => [...prev, mapRow(data)].sort((a, b) => a.dueAt.localeCompare(b.dueAt)));
    setShowForm(false);
    setNewTitle(''); setNewDueAt(''); setNewDetails(''); setNewNotify('off'); setNewCustomNotifyAt('');
  };

  const toggleCompleted = async (r: Reminder) => {
    const completed = !r.completed;
    const completedAt = completed ? new Date().toISOString() : undefined;
    setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, completed, completedAt } : x)));
    await supabase.from('reminders').update({ completed, completed_at: completedAt || null }).eq('id', r.id);
  };

  const startReschedule = (r: Reminder) => {
    setReschedulingId(r.id);
    setRescheduleValue(toDatetimeLocalValue(r.dueAt));
  };

  const confirmReschedule = async (r: Reminder) => {
    if (!rescheduleValue) return;
    const dueAt = new Date(rescheduleValue).toISOString();
    setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, dueAt } : x)));
    setReschedulingId(null);
    await supabase.from('reminders').update({ due_at: dueAt, updated_at: new Date().toISOString() }).eq('id', r.id);
  };

  const delegateReminder = async (r: Reminder, toUserId: string) => {
    setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, userId: toUserId } : x)));
    await supabase.from('reminders').update({ user_id: toUserId }).eq('id', r.id);
    toast.success('Lembrete delegado.');
  };

  const handleCreateTask = async (r: Reminder, listId: string) => {
    setCreatingTaskFor(r.id);
    const taskId = await onCreateTaskFromReminder({ id: r.id, title: r.title }, listId);
    setCreatingTaskFor(null);
    if (taskId) setReminders((prev) => prev.map((x) => (x.id === r.id ? { ...x, taskId } : x)));
  };

  const mine = useMemo(() => reminders.filter((r) => r.userId === currentUser.id), [reminders, currentUser.id]);
  const delegated = useMemo(
    () => reminders.filter((r) => r.createdBy === currentUser.id && r.userId !== currentUser.id),
    [reminders, currentUser.id]
  );
  const pending = useMemo(() => mine.filter((r) => !r.completed), [mine]);
  const done = useMemo(() => mine.filter((r) => r.completed), [mine]);

  const today = todayLocalDateStr();
  const buckets = useMemo(() => {
    const b = { hoje: [] as Reminder[], atraso: [] as Reminder[], proximo: [] as Reminder[] };
    pending.forEach((r) => {
      const d = localDateStr(r.dueAt);
      if (d < today) b.atraso.push(r);
      else if (d === today) b.hoje.push(r);
      else b.proximo.push(r);
    });
    return b;
  }, [pending, today]);

  const pendingBadge = buckets.atraso.length + buckets.hoje.length;

  const renderRow = (r: Reminder, opts?: { showDelegatedTo?: boolean }) => {
    const isOverdue = !r.completed && localDateStr(r.dueAt) < today;
    return (
      <div key={r.id} className="px-2 py-2 rounded-lg hover:bg-gray-50 transition-colors">
        <div className="flex items-center gap-2">
          {tab !== 'delegated' && (
            <input type="checkbox" checked={r.completed} onChange={() => toggleCompleted(r)} className="rounded text-purple-500 focus:ring-purple-500 shrink-0" />
          )}
          <span className={`text-sm flex-1 truncate ${r.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>{r.title}</span>
          {reschedulingId === r.id ? (
            <>
              <input
                type="datetime-local"
                value={rescheduleValue}
                onChange={(e) => setRescheduleValue(e.target.value)}
                className="text-xs border rounded px-1.5 py-1"
              />
              <button onClick={() => confirmReschedule(r)} className="text-[11px] font-semibold text-purple-600 hover:underline shrink-0">Salvar</button>
              <button onClick={() => setReschedulingId(null)} className="text-[11px] text-gray-400 hover:text-gray-600 shrink-0">Cancelar</button>
            </>
          ) : (
            <button
              onClick={() => startReschedule(r)}
              className={`text-[11px] font-semibold shrink-0 hover:underline ${isOverdue ? 'text-red-500' : 'text-gray-400'}`}
              title="Reagendar"
            >
              {formatDueAt(r.dueAt)}
            </button>
          )}
          {r.taskId ? (
            <button onClick={() => onOpenTask(r.taskId!)} className="text-[11px] font-semibold text-blue-500 hover:underline shrink-0">Ver tarefa</button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button disabled={creatingTaskFor === r.id} className="text-[11px] font-semibold text-gray-400 hover:text-purple-500 shrink-0 disabled:opacity-40">
                  {creatingTaskFor === r.id ? 'Criando...' : 'Converter em tarefa'}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                {[...lists].filter((l) => !l.ownerId).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((l) => (
                  <DropdownMenuItem key={l.id} onClick={() => handleCreateTask(r, l.id)} className="text-sm">
                    {l.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {tab !== 'delegated' && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="text-[11px] font-semibold text-gray-400 hover:text-purple-500 shrink-0">Delegar</button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                {users.filter((u) => u.id !== currentUser.id).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((u) => (
                  <DropdownMenuItem key={u.id} onClick={() => delegateReminder(r, u.id)} className="flex items-center gap-2 text-sm">
                    <img src={avatarThumb(u.avatar)} className="w-5 h-5 rounded-full" alt="" />
                    {u.name}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {opts?.showDelegatedTo && (
          <p className="text-[11px] text-gray-400 pl-6">Delegado a {users.find((u) => u.id === r.userId)?.name || '—'}</p>
        )}
        {r.details && <p className="text-xs text-gray-400 pl-6 mt-0.5 truncate">{r.details}</p>}
      </div>
    );
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-800">Hoje e atrasadas</h2>
          {pendingBadge > 0 && (
            <span className="bg-purple-100 text-purple-600 text-xs font-bold px-2 py-0.5 rounded-full">{pendingBadge}</span>
          )}
        </div>
        <button onClick={() => setShowForm((v) => !v)} className="text-xs font-bold bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:brightness-110">
          + Novo lembrete
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4 space-y-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nome do lembrete"
            className="w-full text-sm p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
            autoFocus
          />
          <input
            type="datetime-local"
            value={newDueAt}
            onChange={(e) => setNewDueAt(e.target.value)}
            className="w-full text-sm p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <textarea
            value={newDetails}
            onChange={(e) => setNewDetails(e.target.value)}
            placeholder="Detalhes (opcional)"
            rows={2}
            className="w-full text-sm p-2 border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <div>
            <p className="text-[10px] text-gray-400 font-bold mb-1 uppercase">Notificação</p>
            <select
              value={newNotify}
              onChange={(e) => setNewNotify(e.target.value as ReminderNotifyPreference)}
              className="w-full text-sm p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
            >
              {(Object.keys(NOTIFY_LABELS) as ReminderNotifyPreference[]).map((k) => (
                <option key={k} value={k}>{NOTIFY_LABELS[k]}</option>
              ))}
            </select>
            {newNotify === 'custom' && (
              <input
                type="datetime-local"
                value={newCustomNotifyAt}
                onChange={(e) => setNewCustomNotifyAt(e.target.value)}
                className="w-full text-sm p-2 border rounded-lg mt-2 focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            )}
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowForm(false)} className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2 py-1 rounded hover:bg-gray-100">Cancelar</button>
            <button onClick={createReminder} disabled={isCreating || !newTitle.trim() || !newDueAt} className="text-xs bg-orange-500 text-white font-bold px-3 py-1.5 rounded-lg hover:brightness-110 disabled:opacity-50">
              {isCreating ? '...' : 'Criar Lembrete'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        {([['pending', 'Pendente'], ['done', 'Feito'], ['delegated', 'Delegado']] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden p-2">
        {isLoading && <p className="p-8 text-sm text-gray-400 text-center">Carregando...</p>}

        {!isLoading && tab === 'pending' && (
          pending.length === 0 ? (
            <p className="p-8 text-sm text-gray-400 text-center">As tarefas e os lembretes atribuídos a você serão exibidos aqui.</p>
          ) : (
            <div className="space-y-3">
              {([['Em atraso', buckets.atraso], ['Hoje', buckets.hoje], ['Próximo', buckets.proximo]] as const).map(([label, items]) => (
                items.length === 0 ? null : (
                  <div key={label}>
                    <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wide px-2 mb-1">{label} <span className="text-gray-300">{items.length}</span></p>
                    {items.map((r) => renderRow(r))}
                  </div>
                )
              ))}
            </div>
          )
        )}

        {!isLoading && tab === 'done' && (
          done.length === 0 ? (
            <p className="p-8 text-sm text-gray-400 text-center">Nenhum lembrete concluído ainda.</p>
          ) : done.map((r) => renderRow(r))
        )}

        {!isLoading && tab === 'delegated' && (
          delegated.length === 0 ? (
            <p className="p-8 text-sm text-gray-400 text-center">Você ainda não delegou nenhum lembrete.</p>
          ) : delegated.map((r) => renderRow(r, { showDelegatedTo: true }))
        )}
      </div>
    </div>
  );
}
