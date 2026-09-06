import React from 'react';
import { createPortal } from 'react-dom';
import { supabase } from './supabase';
import { linkifyText } from './linkify';
import { isDoneLikeStatus } from './taskService';
import { avatarThumb } from './avatarUrl';
import { Team, User, NotificationType } from '../types';

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Extrai menções de um texto de comentário no formato "@Nome Completo".
 * Os nomes são casados contra a lista real de usuários e Equipes do workspace.
 */
export function extractMentions(text: string, users: User[], teams: Team[]) {
  const mentionedUserIds = users
    .filter((u) => text.includes(`@${u.name}`))
    .map((u) => u.id);
  const mentionedTeams = teams.filter((t) => text.includes(`@${t.name}`));
  return { mentionedUserIds, mentionedTeams };
}

/**
 * Cria as notificações de menção (usuários e Equipes) após salvar um comentário.
 * Idempotente por chamada: deduplica destinatários e nunca notifica o próprio autor.
 */
export async function notifyMentions(params: {
  text: string;
  taskId: string;
  taskTitle: string;
  commentId?: string;
  actor: User;
  users: User[];
  teams: Team[];
}) {
  const { text, taskId, taskTitle, commentId, actor, users, teams } = params;
  const { mentionedUserIds, mentionedTeams } = extractMentions(text, users, teams);

  const rows: { user_id: string; type: NotificationType }[] = [];
  const seen = new Set<string>([actor.id]);

  mentionedUserIds.forEach((id) => {
    if (!seen.has(id)) {
      seen.add(id);
      rows.push({ user_id: id, type: 'mention' });
    }
  });
  mentionedTeams.forEach((team) => {
    team.memberIds.forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        rows.push({ user_id: id, type: 'team_mention' });
      }
    });
  });

  if (rows.length === 0) return;

  const body = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  const { error } = await supabase.from('notifications').insert(
    rows.map((r) => ({
      user_id: r.user_id,
      actor_id: actor.id,
      type: r.type,
      title:
        r.type === 'team_mention'
          ? `${actor.name} mencionou sua equipe em "${taskTitle}"`
          : `${actor.name} mencionou você em "${taskTitle}"`,
      body,
      task_id: taskId,
      comment_id: commentId || null,
    }))
  );
  if (error) console.error('Erro ao criar notificações de menção:', error);
}

/**
 * Cria as notificações de resposta ("Respostas" da sidebar): avisa quem já
 * participou da thread (autor do comentário raiz + quem já respondeu),
 * exceto quem acabou de responder.
 */
export async function notifyReply(params: {
  text: string;
  taskId: string;
  taskTitle: string;
  parentCommentId: string;
  threadParticipantIds: string[];
  actor: User;
}) {
  const { text, taskId, taskTitle, parentCommentId, threadParticipantIds, actor } = params;
  const targets = [...new Set(threadParticipantIds)].filter((id) => id && id !== actor.id);
  if (targets.length === 0) return;

  const body = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  const { error } = await supabase.from('notifications').insert(
    targets.map((id) => ({
      user_id: id,
      actor_id: actor.id,
      type: 'reply',
      title: `${actor.name} respondeu em "${taskTitle}"`,
      body,
      task_id: taskId,
      comment_id: parentCommentId,
    }))
  );
  if (error) console.error('Erro ao criar notificação de resposta:', error);
}

/** Notifica o atribuído quando um comentário vira um item de ação ("Comentários atribuídos"). */
export async function notifyCommentAssigned(params: {
  text: string;
  taskId: string;
  taskTitle: string;
  commentId: string;
  assignedToId: string;
  actor: User;
}) {
  const { text, taskId, taskTitle, commentId, assignedToId, actor } = params;
  if (!assignedToId || assignedToId === actor.id) return;

  const body = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  const { error } = await supabase.from('notifications').insert({
    user_id: assignedToId,
    actor_id: actor.id,
    type: 'comment_assigned',
    title: `${actor.name} atribuiu um comentário a você em "${taskTitle}"`,
    body,
    task_id: taskId,
    comment_id: commentId,
  });
  if (error) console.error('Erro ao criar notificação de comentário atribuído:', error);
}

/** Notifica quem atribuiu o comentário quando o atribuído marca como resolvido. */
export async function notifyCommentResolved(params: {
  text: string;
  taskId: string;
  taskTitle: string;
  commentId: string;
  assignedById: string;
  actor: User;
}) {
  const { text, taskId, taskTitle, commentId, assignedById, actor } = params;
  if (!assignedById || assignedById === actor.id) return;

  const body = text.length > 140 ? `${text.slice(0, 140)}…` : text;
  const { error } = await supabase.from('notifications').insert({
    user_id: assignedById,
    actor_id: actor.id,
    type: 'comment_resolved',
    title: `${actor.name} resolveu o comentário atribuído em "${taskTitle}"`,
    body,
    task_id: taskId,
    comment_id: commentId,
  });
  if (error) console.error('Erro ao criar notificação de comentário resolvido:', error);
}

/** Cria uma notificação de atribuição de tarefa (responsável principal/adicional/equipe). */
export async function notifyAssignment(params: {
  userIds: string[];
  actor: User;
  taskId: string;
  taskTitle: string;
  teamName?: string;
}) {
  const { userIds, actor, taskId, taskTitle, teamName } = params;
  const targets = [...new Set(userIds)].filter((id) => id && id !== actor.id);
  if (targets.length === 0) return;

  const { error } = await supabase.from('notifications').insert(
    targets.map((id) => ({
      user_id: id,
      actor_id: actor.id,
      type: 'assignment',
      title: teamName
        ? `${actor.name} atribuiu a equipe ${teamName} à tarefa "${taskTitle}"`
        : `${actor.name} atribuiu você à tarefa "${taskTitle}"`,
      body: '',
      task_id: taskId,
    }))
  );
  if (error) console.error('Erro ao criar notificação de atribuição:', error);
}

// Card leve com info do usuário mencionado — abre ao clicar numa @menção
// (ver MentionText). Busca a contagem de tarefas em aberto sob demanda (não
// carrega nada pesado antes do clique); classifica "em aberto" com a mesma
// palavra-chave já usada no resto do app (ver isDoneLikeStatus), sem
// duplicar a lógica em SQL.
function MentionUserCard({ user, x, y, onClose }: { user: User; x: number; y: number; onClose: () => void }) {
  const [openCount, setOpenCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    supabase
      .from('tasks')
      .select('status')
      .eq('main_assignee_id', user.id)
      .limit(500)
      .then(({ data }) => {
        if (cancelled || !data) return;
        setOpenCount(data.filter((t: { status: string }) => !isDoneLikeStatus(t.status)).length);
      });
    return () => { cancelled = true; };
  }, [user.id]);

  React.useEffect(() => {
    const onDocClick = () => onClose();
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Próximo tick: o próprio clique que abriu o card não pode fechá-lo na hora.
    const t = setTimeout(() => {
      document.addEventListener('click', onDocClick);
      document.addEventListener('keydown', onEsc);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('click', onDocClick);
      document.removeEventListener('keydown', onEsc);
    };
  }, [onClose]);

  // Mantém dentro da viewport (o clique pode acontecer perto da borda).
  const left = Math.min(x, window.innerWidth - 260);
  const top = Math.min(y, window.innerHeight - 140);

  // Portal pra document.body: MentionText roda dentro de um <p> (texto de
  // comentário) e este card tem <div>s dentro — aninhar div dentro de p é
  // HTML inválido (React avisa em dev). Portal também evita o card ser
  // cortado por overflow:hidden de algum ancestral do comentário.
  return createPortal(
    <div
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', left, top, zIndex: 9999 }}
      className="w-60 bg-white rounded-lg shadow-xl border border-gray-200 p-3"
    >
      <div className="flex items-center gap-2">
        {user.avatar ? (
          <img src={avatarThumb(user.avatar)} alt={user.name} className="w-9 h-9 rounded-full object-cover" />
        ) : (
          <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center font-semibold text-sm">
            {user.name.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0">
          <div className="font-semibold text-sm text-gray-800 truncate">{user.name}</div>
          <div className="text-xs text-gray-500">{user.role}</div>
        </div>
      </div>
      <div className="mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
        {openCount === null
          ? 'Carregando tarefas…'
          : `${openCount}${openCount >= 500 ? '+' : ''} tarefa${openCount === 1 ? '' : 's'} em aberto`}
      </div>
    </div>,
    document.body,
  );
}

/**
 * Renderiza o texto de um comentário destacando as menções "@Nome" conhecidas
 * (usuários em azul, Equipes em roxo). Menção de usuário é clicável — abre um
 * card com foto/cargo/tarefas em aberto (MentionUserCard).
 */
export function MentionText({ text, users, teams }: { text: string; users: User[]; teams: Team[] }) {
  const [openUser, setOpenUser] = React.useState<{ user: User; x: number; y: number } | null>(null);
  const names = [
    ...users.map((u) => ({ name: u.name, kind: 'user' as const })),
    ...teams.map((t) => ({ name: t.name, kind: 'team' as const })),
  ].sort((a, b) => b.name.length - a.name.length);

  if (names.length === 0 || !text.includes('@')) return <>{linkifyText(text)}</>;

  const pattern = new RegExp(`@(${names.map((n) => escapeRegex(n.name)).join('|')})`, 'g');
  const parts = text.split(pattern);

  return (
    <>
      {parts.map((part, i) => {
        const match = names.find((n) => n.name === part);
        // O split com grupo de captura alterna texto comum e nomes capturados
        if (i % 2 === 1 && match) {
          if (match.kind === 'user') {
            const user = users.find((u) => u.name === part);
            return (
              <span
                key={i}
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  if (user) setOpenUser({ user, x: e.clientX, y: e.clientY });
                }}
                className="font-semibold rounded px-1 py-0.5 bg-blue-50 text-blue-600 cursor-pointer hover:bg-blue-100"
              >
                @{part}
              </span>
            );
          }
          return (
            <span key={i} className="font-semibold rounded px-1 py-0.5 bg-purple-50 text-purple-600">
              @{part}
            </span>
          );
        }
        return <React.Fragment key={i}>{linkifyText(part)}</React.Fragment>;
      })}
      {openUser && (
        <MentionUserCard user={openUser.user} x={openUser.x} y={openUser.y} onClose={() => setOpenUser(null)} />
      )}
    </>
  );
}
