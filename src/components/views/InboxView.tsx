import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { avatarThumb } from '../../lib/avatarUrl';
import { relativeTimeBR, dateGroupLabelBR, formatDateTimeShortBR } from '../../lib/dates';
import { AppNotification, List, User } from '../../types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface InboxViewProps {
  currentUser: User;
  users: User[];
  lists: List[];
  onOpenTask: (taskId: string) => void;
  onOpenMeeting: (meetingId: string) => void;
  onOpenTaskComment: (taskId: string, commentId: string, action?: 'reply' | 'resolve') => void;
  onCreateTaskFromComment: (comment: { text: string }, listId: string) => Promise<string | null>;
}

// Qual ação já deixar pronta ao abrir o comentário que gerou a notificação:
// menção/resposta → campo de resposta focado; comentário atribuído a você →
// destaque no botão "Resolver". Os outros tipos de comentário (ex:
// comment_resolved) só rolam/destacam, sem abrir nada.
function commentFocusAction(type: string): 'reply' | 'resolve' | undefined {
  if (type === 'comment_assigned') return 'resolve';
  if (type === 'mention' || type === 'team_mention' || type === 'reply') return 'reply';
  return undefined;
}

const TYPE_ICONS: Record<string, string> = {
  mention: '💬',
  team_mention: '👥',
  assignment: '📌',
  comment: '💬',
  automation: '⚡',
  reply: '↩️',
  comment_assigned: '📝',
  comment_resolved: '✅',
  meeting: '🗓️',
};

const TYPE_LABELS: Record<string, string> = {
  mention: 'Menções',
  team_mention: 'Menções de equipe',
  reply: 'Respostas',
  comment_assigned: 'Comentários atribuídos',
  comment_resolved: 'Comentários resolvidos',
  assignment: 'Atribuições',
  meeting: 'Reuniões',
  automation: 'Automações',
  comment: 'Comentários',
};
const TYPE_ORDER = Object.keys(TYPE_LABELS);

type GroupBy = 'date' | 'type' | 'none';
type SortOrder = 'newest' | 'oldest';

const prefsKey = (userId: string) => `vpclick_inbox_prefs_${userId}`;

// Preferências de exibição/agrupamento/ordenação da Caixa de Entrada — só
// no navegador (localStorage), sem coluna no banco: é uma preferência de
// UI por usuário neste dispositivo, não um dado que precise sincronizar
// entre aparelhos.
function loadPrefs(userId: string): { groupBy: GroupBy; sortOrder: SortOrder; density: 'comfortable' | 'compact' } {
  try {
    const raw = localStorage.getItem(prefsKey(userId));
    if (raw) return { groupBy: 'date', sortOrder: 'newest', density: 'comfortable', ...JSON.parse(raw) };
  } catch {
    // ignora localStorage indisponível/corrompido — cai pro padrão
  }
  return { groupBy: 'date', sortOrder: 'newest', density: 'comfortable' };
}

// relativeTime/dateGroupLabel agora vivem em lib/dates (issue #102, achado
// 3 — antes duplicadas idênticas em Inbox e Respostas).
const relativeTime = relativeTimeBR;
const dateGroupLabel = dateGroupLabelBR;

function isSnoozedActive(n: AppNotification) {
  return !!n.snoozedUntil && new Date(n.snoozedUntil) > new Date();
}

// Opções de "adiar" (snooze), mesma ideia do Inbox do ClickUp: some da aba
// Todas/Não lidas até a data escolhida e some sozinha de volta depois.
const SNOOZE_OPTIONS: { label: string; getDate: () => Date }[] = [
  {
    label: 'Mais tarde hoje (+3h)',
    getDate: () => new Date(Date.now() + 3 * 60 * 60_000),
  },
  {
    label: 'Amanhã de manhã',
    getDate: () => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(9, 0, 0, 0); return d; },
  },
  {
    label: 'Semana que vem',
    getDate: () => { const d = new Date(); d.setDate(d.getDate() + 7); d.setHours(9, 0, 0, 0); return d; },
  },
];

function formatSnoozedUntil(d: string) {
  return `volta ${formatDateTimeShortBR(d)}`;
}

/**
 * Caixa de entrada (aba "Principal", inspirada no Inbox do ClickUp): a mesma
 * fonte de dados do sino de notificações, mas em página cheia — sem limite de
 * 30 itens, com filtro lido/não lido/adiadas, agrupamento por data e as
 * ações de apagar e adiar (as duas que faltavam pra virar um inbox de
 * verdade — antes só dava pra marcar como lida).
 */
export function InboxView({ currentUser, users, lists, onOpenTask, onOpenMeeting, onOpenTaskComment, onCreateTaskFromComment }: InboxViewProps) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'mentions' | 'snoozed'>('all');
  const [isLoading, setIsLoading] = useState(true);
  // Só local/desta sessão: qual tarefa nova já foi criada a partir de qual
  // notificação. Sem coluna de vínculo no banco (a notificação em si é
  // efêmera), então recarregar a página perde essa marca — aceitável, só
  // evita clicar duas vezes por engano sem sair da página.
  const [createdTaskByNotification, setCreatedTaskByNotification] = useState<Record<string, string>>({});
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null);

  const initialPrefs = useMemo(() => loadPrefs(currentUser.id), [currentUser.id]);
  const [groupBy, setGroupBy] = useState<GroupBy>(initialPrefs.groupBy);
  const [sortOrder, setSortOrder] = useState<SortOrder>(initialPrefs.sortOrder);
  const [density, setDensity] = useState<'comfortable' | 'compact'>(initialPrefs.density);
  useEffect(() => {
    localStorage.setItem(prefsKey(currentUser.id), JSON.stringify({ groupBy, sortOrder, density }));
  }, [currentUser.id, groupBy, sortOrder, density]);

  const mapRow = (n: any): AppNotification => ({
    id: n.id,
    userId: n.user_id,
    actorId: n.actor_id,
    type: n.type,
    title: n.title,
    body: n.body || '',
    taskId: n.task_id,
    commentId: n.comment_id,
    meetingId: n.meeting_id,
    read: n.read,
    snoozedUntil: n.snoozed_until || undefined,
    createdAt: n.created_at,
  });

  const loadNotifications = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      if (data) setNotifications(data.map(mapRow));
    } catch (err) {
      console.error('Erro ao carregar caixa de entrada:', err);
    } finally {
      setIsLoading(false);
    }
  }, [currentUser.id]);

  useEffect(() => {
    loadNotifications();
    const channel = supabase
      .channel(`inbox-${currentUser.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload: any) => {
        if (payload.new) setNotifications((prev) => [mapRow(payload.new), ...prev].slice(0, 200));
      })
      .on('postgres_changes', {
        // Reflete leituras/adiamentos feitos em outro lugar (sino do topo,
        // outra aba) enquanto esta página está aberta — sem isso o badge de
        // não lidas e os filtros aqui ficavam desatualizados até recarregar.
        event: 'UPDATE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload: any) => {
        if (payload.new) setNotifications((prev) => prev.map((n) => (n.id === payload.new.id ? mapRow(payload.new) : n)));
      })
      .on('postgres_changes', {
        // Reflete exclusões (apagar por aqui mesmo, em outra aba, ou cascata
        // ao desmarcar reunião) — sem isso o item ficava visível/clicável
        // até recarregar.
        event: 'DELETE',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${currentUser.id}`,
      }, (payload: any) => {
        if (payload.old) setNotifications((prev) => prev.filter((n) => n.id !== payload.old.id));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [currentUser.id, loadNotifications]);

  // Recalcula quem ainda está adiado a cada minuto — sem isso, o item ficava
  // preso em "Adiadas" (e fora de Todas/Não lidas) até a página recarregar
  // ou outra notificação mudar o array, mesmo com o prazo de adiamento já
  // vencido, já que os memos abaixo só reagem a mudanças em `notifications`.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(interval);
  }, []);

  // Adiadas ficam fora de Todas/Não lidas (e do contador) até a data voltar.
  const activeNotifications = useMemo(() => notifications.filter((n) => !isSnoozedActive(n)), [notifications, nowTick]);
  const snoozedNotifications = useMemo(
    () => notifications
      .filter(isSnoozedActive)
      .sort((a, b) => new Date(a.snoozedUntil!).getTime() - new Date(b.snoozedUntil!).getTime()),
    [notifications, nowTick]
  );
  const unreadCount = activeNotifications.filter((n) => !n.read).length;
  // "Diretas" = alguém te citou por nome (@Você); não inclui menção de
  // Equipe (team_mention) nem os outros tipos de notificação de comentário
  // (resposta, atribuído, resolvido) — só o caso mais específico de achar
  // rápido "quem me chamou".
  const mentionNotifications = useMemo(() => activeNotifications.filter((n) => n.type === 'mention'), [activeNotifications]);

  const markAsRead = async (ids: string[]) => {
    if (ids.length === 0) return;
    setNotifications((prev) => prev.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)));
    await supabase.from('notifications').update({ read: true }).in('id', ids);
  };

  const snooze = async (id: string, until: Date) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, snoozedUntil: until.toISOString() } : n)));
    await supabase.from('notifications').update({ snoozed_until: until.toISOString() }).eq('id', id);
  };

  const unsnooze = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, snoozedUntil: undefined } : n)));
    await supabase.from('notifications').update({ snoozed_until: null }).eq('id', id);
  };

  const deleteNotification = async (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
    await supabase.from('notifications').delete().eq('id', id);
  };

  const handleCreateTask = async (n: AppNotification, listId: string) => {
    setCreatingTaskFor(n.id);
    // n.body é só o preview da notificação (mentions.tsx trunca em 140
    // caracteres + "…") — busca o comentário de verdade pra não criar a
    // tarefa com o texto cortado. Cai pro preview só se o comentário já
    // tiver sido apagado.
    let text = n.body;
    if (n.commentId) {
      const { data } = await supabase.from('task_comments').select('text').eq('id', n.commentId).maybeSingle();
      if (data?.text) text = data.text;
    }
    const taskId = await onCreateTaskFromComment({ text }, listId);
    setCreatingTaskFor(null);
    if (taskId) setCreatedTaskByNotification((prev) => ({ ...prev, [n.id]: taskId }));
  };

  const handleClickNotification = (n: AppNotification) => {
    if (!n.read) markAsRead([n.id]);
    if (n.taskId && n.commentId) {
      // Vai direto pro comentário que gerou a notificação (rolado e
      // destacado), não só pra tarefa em geral — sem isso, numa tarefa com
      // muitos comentários, achar o que te mencionou era na mão.
      onOpenTaskComment(n.taskId, n.commentId, commentFocusAction(n.type));
    } else if (n.taskId) {
      onOpenTask(n.taskId);
    } else if (n.meetingId) {
      onOpenMeeting(n.meetingId);
    }
  };

  const visible =
    filter === 'snoozed' ? snoozedNotifications
    : filter === 'unread' ? activeNotifications.filter((n) => !n.read)
    : filter === 'mentions' ? mentionNotifications
    : activeNotifications;

  const groups = useMemo(() => {
    // Adiadas tem ordenação própria (retorno mais próximo primeiro) — não
    // faz sentido reordenar por data de criação nem agrupar por tipo ali.
    if (filter === 'snoozed') return [{ label: '', items: visible }];

    const ordered = sortOrder === 'oldest' ? [...visible].reverse() : visible;

    if (groupBy === 'none') return [{ label: '', items: ordered }];

    if (groupBy === 'type') {
      const byLabel = new Map<string, AppNotification[]>();
      ordered.forEach((n) => {
        const label = TYPE_LABELS[n.type] || n.type;
        if (!byLabel.has(label)) byLabel.set(label, []);
        byLabel.get(label)!.push(n);
      });
      const knownLabels = TYPE_ORDER.map((t) => TYPE_LABELS[t]).filter((label) => byLabel.has(label));
      const extraLabels = [...byLabel.keys()].filter((label) => !knownLabels.includes(label));
      return [...knownLabels, ...extraLabels].map((label) => ({ label, items: byLabel.get(label)! }));
    }

    // groupBy === 'date' (padrão)
    const dateOrder = sortOrder === 'oldest' ? ['Mais antigas', 'Esta semana', 'Ontem', 'Hoje'] : ['Hoje', 'Ontem', 'Esta semana', 'Mais antigas'];
    const byLabel = new Map<string, AppNotification[]>();
    ordered.forEach((n) => {
      const label = dateGroupLabel(n.createdAt);
      if (!byLabel.has(label)) byLabel.set(label, []);
      byLabel.get(label)!.push(n);
    });
    return dateOrder.filter((label) => byLabel.has(label)).map((label) => ({ label, items: byLabel.get(label)! }));
  }, [visible, filter, groupBy, sortOrder]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-gray-800">Caixa de entrada</h2>
          {unreadCount > 0 && (
            <span className="bg-orange-100 text-orange-600 text-xs font-bold px-2 py-0.5 rounded-full">{unreadCount} não lida{unreadCount === 1 ? '' : 's'}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {filter !== 'snoozed' && visible.some((n) => !n.read) && (
            <button
              onClick={() => markAsRead(visible.filter((n) => !n.read).map((n) => n.id))}
              className="text-xs text-orange-500 font-semibold hover:underline"
            >
              Marcar todas como lidas
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button title="Personalizar exibição" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 text-sm">
                ⚙️
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[10px] font-bold uppercase text-gray-400">Agrupar por</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={groupBy} onValueChange={(v) => setGroupBy(v as GroupBy)}>
                <DropdownMenuRadioItem value="date" className="text-sm">Data</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="type" className="text-sm">Tipo</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="none" className="text-sm">Nenhum</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-bold uppercase text-gray-400">Ordenar por</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={sortOrder} onValueChange={(v) => setSortOrder(v as SortOrder)}>
                <DropdownMenuRadioItem value="newest" className="text-sm">Mais recentes primeiro</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="oldest" className="text-sm">Mais antigas primeiro</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel className="text-[10px] font-bold uppercase text-gray-400">Exibição</DropdownMenuLabel>
              <DropdownMenuRadioGroup value={density} onValueChange={(v) => setDensity(v as 'comfortable' | 'compact')}>
                <DropdownMenuRadioItem value="comfortable" className="text-sm">Confortável</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="compact" className="text-sm">Compacta</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
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
        <button
          onClick={() => setFilter('mentions')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'mentions' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Menções{mentionNotifications.length > 0 ? ` (${mentionNotifications.length})` : ''}
        </button>
        <button
          onClick={() => setFilter('snoozed')}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${filter === 'snoozed' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
        >
          Adiadas{snoozedNotifications.length > 0 ? ` (${snoozedNotifications.length})` : ''}
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading && (
          <p className="p-8 text-sm text-gray-400 text-center">Carregando...</p>
        )}
        {!isLoading && visible.length === 0 && (
          <p className="p-8 text-sm text-gray-400 text-center">
            {filter === 'unread' && 'Nenhuma notificação não lida. 🎉'}
            {filter === 'mentions' && 'Nenhuma menção direta por aqui.'}
            {filter === 'snoozed' && 'Nenhuma notificação adiada.'}
            {filter === 'all' && 'Nenhuma notificação por aqui. 🎉'}
          </p>
        )}
        {!isLoading && groups.map((group) => (
          <div key={group.label || 'flat'}>
            {group.label && (
              <div className="px-4 py-2 text-[11px] font-bold text-gray-400 uppercase tracking-widest bg-gray-50/70 border-b border-gray-100">
                {group.label}
              </div>
            )}
            {group.items.map((n) => {
              const actor = users.find((u) => u.id === n.actorId);
              return (
                <div
                  key={n.id}
                  className={`flex items-stretch gap-1 border-b border-gray-100 last:border-b-0 ${!n.read ? 'bg-orange-50/50' : ''}`}
                >
                  <button
                    onClick={() => handleClickNotification(n)}
                    className={`flex-1 min-w-0 text-left flex gap-3 hover:bg-gray-50 transition-colors ${density === 'compact' ? 'px-4 py-1.5' : 'px-4 py-3'}`}
                  >
                    {actor ? (
                      <img src={avatarThumb(actor.avatar)} className={`rounded-full shrink-0 ${density === 'compact' ? 'w-6 h-6 mt-0.5' : 'w-9 h-9 mt-0.5'}`} alt="" />
                    ) : (
                      <span className={`rounded-full bg-gray-100 flex items-center justify-center shrink-0 ${density === 'compact' ? 'w-6 h-6 mt-0.5 text-sm' : 'w-9 h-9 mt-0.5 text-base'}`}>
                        {TYPE_ICONS[n.type] || '🔔'}
                      </span>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm leading-snug ${!n.read ? 'font-semibold text-gray-800' : 'text-gray-600'}`}>{n.title}</p>
                      {density === 'comfortable' && n.body && <p className="text-xs text-gray-400 truncate mt-0.5">{n.body}</p>}
                      <p className="text-[11px] text-gray-300 mt-1">
                        {filter === 'snoozed' && n.snoozedUntil ? formatSnoozedUntil(n.snoozedUntil) : relativeTime(n.createdAt)}
                      </p>
                    </div>
                    {!n.read && filter !== 'snoozed' && <span className="w-2 h-2 rounded-full bg-orange-500 shrink-0 mt-2"></span>}
                  </button>
                  <div className="flex items-center gap-0.5 pr-2 shrink-0">
                    {n.commentId && (
                      createdTaskByNotification[n.id] ? (
                        <button
                          onClick={() => onOpenTask(createdTaskByNotification[n.id])}
                          className="text-[11px] font-semibold text-blue-500 hover:underline px-1.5"
                        >
                          Ver tarefa
                        </button>
                      ) : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              disabled={creatingTaskFor === n.id}
                              title="Criar tarefa a partir do comentário"
                              className="text-[11px] font-semibold text-gray-400 hover:text-purple-500 px-1.5 disabled:opacity-40"
                            >
                              {creatingTaskFor === n.id ? 'Criando...' : 'Criar tarefa'}
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                            {[...lists].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((l) => (
                              <DropdownMenuItem key={l.id} onClick={() => handleCreateTask(n, l.id)} className="text-sm">
                                {l.name}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )
                    )}
                    {filter === 'snoozed' ? (
                      <button
                        onClick={() => unsnooze(n.id)}
                        title="Trazer de volta agora"
                        className="p-1.5 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 text-sm"
                      >
                        ↩️
                      </button>
                    ) : (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button title="Adiar" className="p-1.5 rounded-lg text-gray-400 hover:text-orange-500 hover:bg-orange-50 text-sm">
                            🕒
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          {SNOOZE_OPTIONS.map((opt) => (
                            <DropdownMenuItem key={opt.label} onClick={() => snooze(n.id, opt.getDate())} className="text-sm">
                              {opt.label}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <button
                      onClick={() => deleteNotification(n.id)}
                      title="Apagar"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 text-sm"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
