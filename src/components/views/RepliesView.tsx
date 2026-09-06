import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { avatarThumb } from '../../lib/avatarUrl';
import { relativeTimeBR, dateGroupLabelBR } from '../../lib/dates';
import { AppNotification, User } from '../../types';

interface RepliesViewProps {
  currentUser: User;
  users: User[];
  onOpenTask: (taskId: string) => void;
}

// relativeTime/dateGroupLabel agora vivem em lib/dates (issue #102, achado
// 3 — antes duplicadas idênticas em Inbox e Respostas).
const relativeTime = relativeTimeBR;
const dateGroupLabel = dateGroupLabelBR;

interface ReplyThread {
  key: string;
  commentId: string | undefined;
  taskId: string | undefined;
  latest: AppNotification;
  items: AppNotification[];
  read: boolean;
}

/**
 * Respostas (aba "Respostas" da sidebar, item 2 do Início estilo ClickUp):
 * notificações do tipo 'reply', agrupadas por thread (mesmo comment_id) para
 * não repetir uma linha por resposta — igual ao agrupamento por tarefa do
 * ClickUp.
 */
export function RepliesView({ currentUser, users, onOpenTask }: RepliesViewProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [isLoading, setIsLoading] = useState(true);

  const mapRow = (n: any): AppNotification => ({
    id: n.id,
    userId: n.user_id,
    actorId: n.actor_id,
    type: n.type,
    title: n.title,
    body: n.body || '',
    taskId: n.task_id,
    commentId: n.comment_id,
    read: n.read,
    createdAt: n.created_at,
  });

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('type', 'reply')
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (data) setNotifications(data.map(mapRow));
    } catch (err) {
      console.error('Erro ao carregar respostas:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    loadNotifications();
    const channel = supabase
      .channel(`replies-${currentUser.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload: any) => {
        if (payload.new && payload.new.type === 'reply') {
          setNotifications((prev) => [mapRow(payload.new), ...prev].slice(0, 200));
        }
      })
      .on('postgres_changes', {
        // Reflete leituras feitas em outro lugar (sino, Caixa de entrada, outra
        // aba) enquanto esta página está aberta.
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload: any) => {
        if (payload.new) setNotifications((prev) => prev.map((n) => (n.id === payload.new.id ? mapRow(payload.new) : n)));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser.id, loadNotifications]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    await supabase.from('notifications').update({ read: true }).in('id', ids);
  };

  // Agrupa por thread (mesmo comment_id = comentário raiz da conversa) para
  // mostrar "fulano e mais 2 responderam" em vez de uma linha por resposta.
  const threads = useMemo<ReplyThread[]>(() => {
    const byKey = new Map<string, ReplyThread>();
    const order: string[] = [];
    notifications.forEach((n) => {
      const key = n.commentId || n.id;
      if (!byKey.has(key)) {
        byKey.set(key, { key, commentId: n.commentId, taskId: n.taskId, latest: n, items: [], read: true });
        order.push(key);
      }
      const thread = byKey.get(key)!;
      thread.items.push(n);
      if (!n.read) thread.read = false;
    });
    return order.map((key) => byKey.get(key)!);
  }, [notifications]);

  const visibleThreads = filter === 'unread' ? threads.filter((t) => !t.read) : threads;

  const groups = useMemo(() => {
    const order = ['Hoje', 'Ontem', 'Esta semana', 'Mais antigas'];
    const byLabel = new Map<string, ReplyThread[]>();
    visibleThreads.forEach((t) => {
      const label = dateGroupLabel(t.latest.createdAt);
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push(t);
    });
    return order.filter((label) => byLabel.has(label)).map((label) => ({ label, items: byLabel.get(label)! }));
  }, [visibleThreads]);

  const handleClickThread = (t: ReplyThread) => {
    const unreadIds = t.items.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length > 0) markAsRead(unreadIds);
    if (t.taskId) onOpenTask(t.taskId);
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-800">Respostas</h2>
          {unreadCount > 0 && (
            <span className="bg-orange-100 text-orange-600 text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount} não lida{unreadCount === 1 ? '' : 's'}</span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={() => markAsRead(notifications.filter((n) => !n.read).map((n) => n.id))}
            className="text-xs text-orange-500 font-semibold hover:underline"
          >
            Marcar todas como lidas
          </button>
        )}
      </div>

      <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'all' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Todas
        </button>
        <button
          onClick={() => setFilter('unread')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'unread' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Não lidas
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading && (
          <p className="p-8 text-sm text-gray-400 text-center">Carregando...</p>
        )}
        {!isLoading && visibleThreads.length === 0 && (
          <p className="p-8 text-sm text-gray-400 text-center">
            {filter === 'unread' ? 'Nenhuma resposta não lida. 🎉' : 'Nenhuma resposta por aqui ainda.'}
          </p>
        )}
        {!isLoading && groups.map((group) => (
          <div key={group.label}>
            <div className="px-4 py-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/70 border-b border-gray-100">
              {group.label}
            </div>
            {group.items.map((t) => {
              const actor = users.find((u) => u.id === t.latest.actorId);
              const otherActorNames = [...new Set(t.items.map((n) => n.actorId))]
                .filter((id) => id && id !== t.latest.actorId)
                .map((id) => users.find((u) => u.id === id)?.name)
                .filter(Boolean);
              return (
                <button
                  key={t.key}
                  onClick={() => handleClickThread(t)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 flex gap-3 hover:bg-gray-50 transition-colors ${!t.read ? 'bg-orange-50/50' : ''}`}
                >
                  {actor ? (
                    <img src={avatarThumb(actor.avatar)} className="w-9 h-9 rounded-full shrink-0 mt-0.5" alt="" />
                  ) : (
                    <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5 text-base">💬</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm leading-snug ${!t.read ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>
                      {t.latest.title}
                      {otherActorNames.length > 0 && (
                        <span className="text-gray-400 font-normal"> e mais {otherActorNames.length}</span>
                      )}
                    </p>
                    {t.latest.body && <p className="text-xs text-gray-400 truncate mt-0.5">{t.latest.body}</p>}
                    <p className="text-[11px] text-gray-300 mt-1">
                      {relativeTime(t.latest.createdAt)}
                      {t.items.length > 1 && ` · ${t.items.length} respostas`}
                    </p>
                  </div>
                  {!t.read && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-2"></span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
