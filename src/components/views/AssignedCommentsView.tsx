import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { avatarThumb } from '../../lib/avatarUrl';
import { relativeTimeBR } from '../../lib/dates';
import { User } from '../../types';

interface AssignedCommentsViewProps {
  currentUser: User;
  users: User[];
  onOpenTask: (taskId: string) => void;
}

interface AssignedComment {
  id: string;
  taskId: string;
  taskTitle: string;
  userId: string;
  text: string;
  createdAt: string;
  assignedTo?: string;
  assignedBy?: string;
  resolvedAt?: string;
  resolvedBy?: string;
}

// relativeTime agora vive em lib/dates como relativeTimeBR (issue #102,
// achado 3 — antes idêntica em 4 arquivos).
const relativeTime = relativeTimeBR;

/**
 * Comentários atribuídos (aba "Comentários atribuídos" da sidebar, item 3 do
 * Início estilo ClickUp): comentários/respostas que viraram itens de ação
 * ("Assign comments" do ClickUp). Diferente de Caixa de Entrada/Respostas,
 * não lê da tabela `notifications` — lê direto de `task_comments`, porque o
 * estado relevante aqui (resolvido ou não) mora na linha do comentário, não
 * numa notificação avulsa.
 */
export function AssignedCommentsView({ currentUser, users, onOpenTask }: AssignedCommentsViewProps) {
  const [comments, setComments] = useState<AssignedComment[]>([]);
  const [tab, setTab] = useState<'to_me' | 'by_me'>('to_me');
  const [showResolved, setShowResolved] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const mapRow = (c: any): AssignedComment => ({
    id: c.id,
    taskId: c.task_id,
    taskTitle: c.task?.title || '(tarefa removida)',
    userId: c.user_id,
    text: c.text,
    createdAt: c.created_at,
    assignedTo: c.assigned_to || undefined,
    assignedBy: c.assigned_by || undefined,
    resolvedAt: c.resolved_at || undefined,
    resolvedBy: c.resolved_by || undefined,
  });

  const loadComments = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('task_comments')
        .select('*, task:tasks(title)')
        .or(`assigned_to.eq.${currentUser.id},assigned_by.eq.${currentUser.id}`)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (data) setComments(data.map(mapRow));
    } catch (err) {
      console.error('Erro ao carregar comentários atribuídos:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    loadComments();
    const channel = supabase
      .channel(`assigned-comments-${currentUser.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'task_comments',
        filter: `assigned_to=eq.${currentUser.id}`,
      }, () => loadComments())
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'task_comments',
        filter: `assigned_by=eq.${currentUser.id}`,
      }, () => loadComments())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser.id, loadComments]);

  const resolveComment = async (c: AssignedComment) => {
    const now = new Date().toISOString();
    setComments((prev) => prev.map((x) => (x.id === c.id ? { ...x, resolvedAt: now, resolvedBy: currentUser.id } : x)));
    await supabase.from('task_comments').update({ resolved_at: now, resolved_by: currentUser.id }).eq('id', c.id);
    if (c.assignedBy && c.assignedBy !== currentUser.id) {
      const body = c.text.length > 140 ? `${c.text.slice(0, 140)}…` : c.text;
      await supabase.from('notifications').insert({
        user_id: c.assignedBy,
        actor_id: currentUser.id,
        type: 'comment_resolved',
        title: `${currentUser.name} resolveu o comentário atribuído em "${c.taskTitle}"`,
        body,
        task_id: c.taskId,
        comment_id: c.id,
      });
    }
  };

  const tabComments = useMemo(
    () => comments.filter((c) => (tab === 'to_me' ? c.assignedTo === currentUser.id : c.assignedBy === currentUser.id)),
    [comments, tab, currentUser.id]
  );
  const visible = showResolved ? tabComments : tabComments.filter((c) => !c.resolvedAt);
  const pendingToMeCount = comments.filter((c) => c.assignedTo === currentUser.id && !c.resolvedAt).length;

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-800">Comentários atribuídos</h2>
          {pendingToMeCount > 0 && (
            <span className="bg-purple-100 text-purple-600 text-xs font-bold px-2 py-0.5 rounded-full">{pendingToMeCount} pendente{pendingToMeCount === 1 ? '' : 's'}</span>
          )}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer select-none">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} className="rounded text-purple-500 focus:ring-purple-500" />
          Mostrar resolvidos
        </label>
      </div>

      <div className="flex items-center gap-1 mb-4 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => setTab('to_me')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'to_me' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Atribuído a mim
        </button>
        <button
          onClick={() => setTab('by_me')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${tab === 'by_me' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Delegado por mim
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading && (
          <p className="p-8 text-sm text-gray-400 text-center">Carregando...</p>
        )}
        {!isLoading && visible.length === 0 && (
          <p className="p-8 text-sm text-gray-400 text-center">
            {tab === 'to_me' ? 'Nenhum comentário atribuído a você.' : 'Você ainda não atribuiu nenhum comentário.'} 🎉
          </p>
        )}
        {!isLoading && visible.map((c) => {
          const author = users.find((u) => u.id === c.userId);
          const counterpart = tab === 'to_me'
            ? users.find((u) => u.id === c.assignedBy)
            : users.find((u) => u.id === c.assignedTo);
          return (
            <button
              key={c.id}
              onClick={() => onOpenTask(c.taskId)}
              className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 flex gap-3 hover:bg-gray-50 transition-colors"
            >
              {author ? (
                <img src={avatarThumb(author.avatar)} className="w-9 h-9 rounded-full shrink-0 mt-0.5" alt="" />
              ) : (
                <span className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center shrink-0 mt-0.5 text-base">📝</span>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug font-semibold text-gray-800 truncate">{c.taskTitle}</p>
                <p className="text-xs text-gray-500 truncate mt-0.5">{c.text}</p>
                <p className="text-[11px] text-gray-300 mt-1">
                  {tab === 'to_me' ? 'Atribuído por' : 'Atribuído a'} {counterpart?.name || '—'} · {relativeTime(c.createdAt)}
                  {c.resolvedAt && ' · resolvido'}
                </p>
              </div>
              {c.resolvedAt ? (
                <span className="text-[11px] font-semibold text-green-600 shrink-0 self-center">Resolvido</span>
              ) : (
                // Ambas as abas já filtram pra current user ser assignedTo (Atribuído a
                // mim) ou assignedBy (Delegado por mim) — então resolver é sempre válido aqui.
                <span
                  role="button"
                  onClick={(e) => { e.stopPropagation(); resolveComment(c); }}
                  className="text-[11px] font-semibold text-gray-400 hover:text-green-600 shrink-0 self-center px-2 py-1 rounded hover:bg-green-50 transition-colors"
                >
                  Resolver
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
