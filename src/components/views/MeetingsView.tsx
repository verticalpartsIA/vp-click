import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '../../lib/supabase';
import { avatarThumb } from '../../lib/avatarUrl';
import { formatMeetingDateTimeBR, formatWeekdayShortBR, formatDayMonthNumericBR } from '../../lib/dates';
import { Meeting, MeetingActionItem, MeetingRoom, List, User, UserRole } from '../../types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

interface MeetingsViewProps {
  currentUser: User;
  users: User[];
  lists: List[];
  onOpenTask: (taskId: string) => void;
  onCreateTaskFromActionItem: (item: { id: string; text: string }, listId: string) => Promise<string | null>;
  openMeetingId?: string | null;
  onOpenMeetingHandled?: () => void;
}

const DURATION_OPTIONS = [
  { minutes: 30, label: '30 min' },
  { minutes: 60, label: '1h' },
  { minutes: 90, label: '1h30' },
  { minutes: 120, label: '2h' },
  { minutes: 180, label: '3h' },
];

function mapMeetingRow(m: any, items: any[]): Meeting {
  return {
    id: m.id,
    title: m.title,
    meetingDate: m.meeting_date,
    endDate: m.end_date || undefined,
    roomId: m.room_id || undefined,
    participantIds: m.participant_ids || [],
    notes: m.notes || '',
    summary: m.summary || undefined,
    createdBy: m.created_by || undefined,
    createdAt: m.created_at,
    updatedAt: m.updated_at || undefined,
    actionItems: items
      .filter((i: any) => i.meeting_id === m.id)
      .map((i: any) => mapActionItemRow(i)),
  };
}

function mapRoomRow(r: any): MeetingRoom {
  return {
    id: r.id,
    name: r.name,
    isActive: r.is_active,
    createdBy: r.created_by || undefined,
    createdAt: r.created_at,
  };
}

function formatTimeRange(start: string, end?: string) {
  const s = new Date(start).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (!end) return s;
  const e = new Date(end).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${s} – ${e}`;
}

function mapActionItemRow(i: any): MeetingActionItem {
  return {
    id: i.id,
    meetingId: i.meeting_id,
    text: i.text,
    completed: i.completed,
    taskId: i.task_id || undefined,
    createdAt: i.created_at,
  };
}

// formatMeetingDate agora vive em lib/dates como formatMeetingDateTimeBR
// (issue #102, achado 3).
const formatMeetingDate = formatMeetingDateTimeBR;

// Prefixo de dia pro resumo do status das salas: "" hoje, "amanhã " ou
// "seg 11/08 " — sem isso "próxima às 10:00" não dizia se era hoje ou dias
// depois, obrigando a expandir o card pra descobrir.
function roomDatePrefix(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(d) - startOfDay(now)) / 86400000);
  if (diffDays === 0) return '';
  if (diffDays === 1) return 'amanhã ';
  return `${formatWeekdayShortBR(d)} ${formatDayMonthNumericBR(d)} `;
}

/**
 * Reuniões (item 4 da sidebar "Início", estilo ClickUp) — versão manual + IA:
 * sem integração de calendário nem bot entrando em chamada de vídeo (o
 * AI Notetaker de verdade do ClickUp). O usuário registra a reunião e cola as
 * notas/transcrição depois dela; a IA (edge function summarize-meeting, mesmo
 * Claude do ask-ai) gera o resumo e extrai os itens de ação, que podem virar
 * tarefas de verdade com um clique.
 */
export function MeetingsView({ currentUser, users, lists, onOpenTask, onCreateTaskFromActionItem, openMeetingId, onOpenMeetingHandled }: MeetingsViewProps) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  // Reunião aberta ↔ `?meetingId=` — deep link/refresh reabrem na mesma
  // reunião. Usa `replace` (não `push`): trocar de reunião não precisa virar
  // uma entrada própria no histórico de voltar/avançar do navegador.
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string | null>(() => searchParams.get('meetingId'));
  useEffect(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (selectedId) next.set('meetingId', selectedId); else next.delete('meetingId');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDate, setNewDate] = useState('');
  const [newDurationMinutes, setNewDurationMinutes] = useState(60);
  const [newRoomId, setNewRoomId] = useState<string>('');
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [savingRoom, setSavingRoom] = useState(false);
  const [newParticipantIds, setNewParticipantIds] = useState<string[]>([]);
  const [participantSearch, setParticipantSearch] = useState('');
  const [newNotes, setNewNotes] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const [rooms, setRooms] = useState<MeetingRoom[]>([]);

  const [notesDraft, setNotesDraft] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [generatingId, setGeneratingId] = useState<string | null>(null);
  const [creatingTaskFor, setCreatingTaskFor] = useState<string | null>(null);

  const loadMeetings = useCallback(async () => {
    setIsLoading(true);
    const { data: meetingsData } = await supabase
      .from('meetings')
      .select('*')
      .order('meeting_date', { ascending: false })
      .limit(200);
    const ids = (meetingsData || []).map((m: any) => m.id);
    const { data: itemsData } = ids.length
      ? await supabase.from('meeting_action_items').select('*').in('meeting_id', ids)
      : { data: [] as any[] };
    setMeetings((meetingsData || []).map((m: any) => mapMeetingRow(m, itemsData || [])));
    setIsLoading(false);
  }, []);

  // Carrega todas as salas (inclusive arquivadas) — o seletor de criação só
  // lista as ativas, mas reuniões antigas continuam mostrando o nome certo
  // mesmo se a sala tiver sido arquivada depois.
  const loadRooms = useCallback(async () => {
    const { data } = await supabase.from('meeting_rooms').select('*').order('name');
    setRooms((data || []).map(mapRoomRow));
  }, []);

  useEffect(() => { loadRooms(); }, [loadRooms]);

  const createRoom = async () => {
    if (!newRoomName.trim()) return;
    setSavingRoom(true);
    const { data, error } = await supabase
      .from('meeting_rooms')
      .insert({ name: newRoomName.trim(), created_by: currentUser.id })
      .select()
      .single();
    setSavingRoom(false);
    if (error || !data) {
      toast.error('Não consegui criar a sala.');
      return;
    }
    const room = mapRoomRow(data);
    setRooms((prev) => [...prev, room].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')));
    setNewRoomId(room.id);
    setNewRoomName('');
    setIsAddingRoom(false);
  };

  // Conflito de sala: só avisa (não bloqueia) — mostra quem mais já reservou
  // aquela sala num horário que sobrepõe o que está sendo escolhido agora.
  // Consulta o Supabase direto (em vez de filtrar a lista `meetings` já
  // carregada, que só traz as 200 reuniões de meeting_date mais recente/
  // futuro): a partir de um certo volume de reuniões futuras, essa lista
  // em cache deixaria de conter reservas que ainda precisam ser checadas.
  const [roomConflicts, setRoomConflicts] = useState<{ id: string; title: string; meetingDate: string; endDate: string }[]>([]);
  useEffect(() => {
    if (!newRoomId) {
      setRoomConflicts([]);
      return;
    }
    let cancelled = false;
    // Mesmo padrão do createMeeting(): data em branco vira "agora" — sem
    // isso, escolher uma sala e criar a reunião imediatamente (sem preencher
    // o horário) não checava conflito nenhum, mesmo a reunião indo ocupar a
    // sala a partir de agora de verdade.
    const start = newDate ? new Date(newDate) : new Date();
    const end = new Date(start.getTime() + newDurationMinutes * 60_000);
    supabase
      .from('meetings')
      .select('id, title, meeting_date, end_date')
      .eq('room_id', newRoomId)
      .not('end_date', 'is', null)
      .lt('meeting_date', end.toISOString())
      .gt('end_date', start.toISOString())
      .then(({ data }) => {
        if (cancelled) return;
        setRoomConflicts((data || []).map((m: any) => ({ id: m.id, title: m.title, meetingDate: m.meeting_date, endDate: m.end_date })));
      });
    return () => { cancelled = true; };
  }, [newRoomId, newDate, newDurationMinutes]);

  useEffect(() => { loadMeetings(); }, [loadMeetings]);

  // Abre uma reunião por id mesmo que ela tenha ficado de fora do cache
  // truncado (200 mais recentes por data — ex: mais de 200 reuniões futuras
  // cadastradas): busca ela direto em vez de deixar o clique não abrir nada.
  // Usada tanto pela notificação de reunião quanto pelo painel de status das
  // salas (clicar numa reserva da lista expandida).
  const selectMeetingById = useCallback(async (id: string) => {
    if (meetings.some((m) => m.id === id)) {
      setSelectedId(id);
      return;
    }
    const { data: meetingRow } = await supabase.from('meetings').select('*').eq('id', id).maybeSingle();
    if (!meetingRow) return;
    const { data: itemsData } = await supabase.from('meeting_action_items').select('*').eq('meeting_id', id);
    const meeting = mapMeetingRow(meetingRow, itemsData || []);
    setMeetings((prev) => (prev.some((m) => m.id === meeting.id) ? prev : [meeting, ...prev]));
    setSelectedId(meeting.id);
  }, [meetings]);

  // Abre direto a reunião apontada por uma notificação (sino/Caixa de
  // entrada), depois de carregar a lista — só uma vez, pra não sequestrar de
  // volta a tela caso o usuário navegue pra outra reunião em seguida.
  useEffect(() => {
    if (!openMeetingId || meetings.length === 0) return;
    let cancelled = false;
    selectMeetingById(openMeetingId).finally(() => {
      if (!cancelled) onOpenMeetingHandled?.();
    });
    return () => { cancelled = true; };
  }, [openMeetingId, meetings, onOpenMeetingHandled, selectMeetingById]);

  const selected = meetings.find((m) => m.id === selectedId) || null;
  useEffect(() => { setNotesDraft(selected?.notes || ''); }, [selected?.id]);

  const visibleMeetings = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return meetings;
    return meetings.filter((m) =>
      m.title.toLowerCase().includes(q) ||
      (m.notes || '').toLowerCase().includes(q) ||
      (m.summary || '').toLowerCase().includes(q)
    );
  }, [meetings, search]);

  const resetCreateForm = () => {
    setShowCreateForm(false);
    setNewTitle('');
    setNewDate('');
    setNewDurationMinutes(60);
    setNewRoomId('');
    setIsAddingRoom(false);
    setNewRoomName('');
    setNewParticipantIds([]);
    setParticipantSearch('');
    setNewNotes('');
  };

  const createMeeting = async () => {
    if (!newTitle.trim()) return;
    setIsCreating(true);
    const start = newDate ? new Date(newDate) : new Date();
    const end = new Date(start.getTime() + newDurationMinutes * 60_000);
    const { data, error } = await supabase
      .from('meetings')
      .insert({
        title: newTitle.trim(),
        meeting_date: start.toISOString(),
        end_date: end.toISOString(),
        room_id: newRoomId || null,
        participant_ids: newParticipantIds,
        notes: newNotes,
        created_by: currentUser.id,
      })
      .select()
      .single();
    setIsCreating(false);
    if (error || !data) return;
    setMeetings((prev) => [mapMeetingRow(data, []), ...prev]);
    setSelectedId(data.id);

    const room = newRoomId ? rooms.find((r) => r.id === newRoomId) : undefined;
    const recipients = newParticipantIds.filter((id) => id !== currentUser.id);
    if (recipients.length > 0) {
      await supabase.from('notifications').insert(
        recipients.map((userId) => ({
          user_id: userId,
          actor_id: currentUser.id,
          type: 'meeting',
          title: `${currentUser.name} te adicionou na reunião "${newTitle.trim()}"`,
          body: `${formatMeetingDate(start.toISOString())}${room ? ` · ${room.name}` : ''}`,
          meeting_id: data.id,
        }))
      );
    }

    resetCreateForm();
  };

  const saveNotes = async () => {
    if (!selected) return;
    setSavingNotes(true);
    const { error } = await supabase.from('meetings').update({ notes: notesDraft, updated_at: new Date().toISOString() }).eq('id', selected.id);
    setSavingNotes(false);
    if (error) return;
    setMeetings((prev) => prev.map((m) => (m.id === selected.id ? { ...m, notes: notesDraft } : m)));
  };

  const generateSummary = async (meetingId: string) => {
    setGeneratingId(meetingId);

    // A edge function lê meetings.notes do banco — se o textarea tiver texto
    // ainda não salvo (usuário colou/editou e clicou direto em "Gerar resumo"
    // sem passar por "Salvar notas"), salva primeiro pra IA não trabalhar em
    // cima de notas desatualizadas ou vazias.
    const persisted = meetings.find((m) => m.id === meetingId)?.notes || '';
    if (meetingId === selected?.id && notesDraft !== persisted) {
      const { error: saveError } = await supabase.from('meetings').update({ notes: notesDraft, updated_at: new Date().toISOString() }).eq('id', meetingId);
      if (saveError) {
        toast.error('Erro ao salvar as notas antes de gerar o resumo.');
        setGeneratingId(null);
        return;
      }
      setMeetings((prev) => prev.map((m) => (m.id === meetingId ? { ...m, notes: notesDraft } : m)));
    }

    const { data, error } = await supabase.functions.invoke('summarize-meeting', { body: { meetingId } });
    if (error || data?.error) {
      toast.error(data?.error || 'Não consegui gerar o resumo agora. Tente novamente.');
    } else {
      toast.success('Resumo gerado.');
      setMeetings((prev) => prev.map((m) => (m.id === meetingId ? {
        ...m,
        summary: data.summary,
        actionItems: (data.actionItems || []).map(mapActionItemRow),
      } : m)));
    }
    setGeneratingId(null);
  };

  const canCancelMeeting = (meeting: Meeting) =>
    meeting.createdBy === currentUser.id || currentUser.role === UserRole.ADMIN || currentUser.role === UserRole.GESTOR;

  const cancelMeeting = async (meeting: Meeting) => {
    if (!canCancelMeeting(meeting)) return;
    if (!window.confirm(`Desmarcar a reunião "${meeting.title}"? Isso libera a sala e não pode ser desfeito.`)) return;
    const { error } = await supabase.from('meetings').delete().eq('id', meeting.id);
    if (error) {
      toast.error('Erro ao desmarcar a reunião: ' + error.message);
      return;
    }
    setMeetings((prev) => prev.filter((m) => m.id !== meeting.id));
    if (selectedId === meeting.id) setSelectedId(null);
    toast.success('Reunião desmarcada.');
  };

  const toggleActionItem = async (item: MeetingActionItem) => {
    const completed = !item.completed;
    setMeetings((prev) => prev.map((m) => (m.id !== item.meetingId ? m : {
      ...m,
      actionItems: m.actionItems.map((i) => (i.id === item.id ? { ...i, completed } : i)),
    })));
    await supabase.from('meeting_action_items').update({ completed }).eq('id', item.id);
  };

  const handleCreateTaskFromItem = async (item: MeetingActionItem, listId: string) => {
    setCreatingTaskFor(item.id);
    const taskId = await onCreateTaskFromActionItem({ id: item.id, text: item.text }, listId);
    setCreatingTaskFor(null);
    if (taskId) {
      setMeetings((prev) => prev.map((m) => (m.id !== item.meetingId ? m : {
        ...m,
        actionItems: m.actionItems.map((i) => (i.id === item.id ? { ...i, taskId } : i)),
      })));
    }
  };

  if (selected) {
    const pendingCount = selected.actionItems.filter((i) => !i.completed).length;
    return (
      <div className="max-w-2xl mx-auto">
        <button onClick={() => setSelectedId(null)} className="text-xs font-semibold text-gray-500 hover:text-gray-700 mb-4 flex items-center gap-1">
          ← Reuniões
        </button>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-xl font-bold text-gray-800">{selected.title}</h2>
            {canCancelMeeting(selected) && (
              <button
                onClick={() => cancelMeeting(selected)}
                className="text-xs font-semibold text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg px-2 py-1 transition-colors shrink-0"
              >
                Desmarcar reunião
              </button>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {formatMeetingDate(selected.meetingDate)}
            {selected.endDate && ` (${formatTimeRange(selected.meetingDate, selected.endDate)})`}
          </p>
          {selected.roomId && rooms.find((r) => r.id === selected.roomId) && (
            <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
              <svg className="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a2 2 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
              {rooms.find((r) => r.id === selected.roomId)!.name}
            </p>
          )}
          {selected.participantIds.length > 0 && (
            <div className="flex items-center -space-x-1.5 mt-2">
              {selected.participantIds.map((id) => {
                const u = users.find((usr) => usr.id === id);
                if (!u) return null;
                return <img key={id} src={avatarThumb(u.avatar)} title={u.name} className="w-6 h-6 rounded-full border-2 border-white" alt="" />;
              })}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-bold text-gray-700">Notas / transcrição</h2>
            <div className="flex items-center gap-2">
              <button onClick={saveNotes} disabled={savingNotes || notesDraft === selected.notes} className="text-xs font-semibold text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:hover:text-gray-500">
                {savingNotes ? 'Salvando...' : 'Salvar notas'}
              </button>
              <button
                onClick={() => generateSummary(selected.id)}
                disabled={generatingId === selected.id || !notesDraft.trim()}
                className="text-xs font-bold bg-purple-500 text-white px-3 py-1.5 rounded-lg hover:brightness-110 disabled:opacity-50"
              >
                {generatingId === selected.id ? 'Gerando...' : selected.summary ? '✨ Gerar novamente' : '✨ Gerar resumo com IA'}
              </button>
            </div>
          </div>
          <textarea
            value={notesDraft}
            onChange={(e) => setNotesDraft(e.target.value)}
            placeholder="Cole aqui a transcrição ou as notas da reunião..."
            rows={8}
            className="w-full text-sm p-3 border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-purple-300 bg-gray-50"
          />
        </div>

        {selected.summary && (
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 mb-4">
            <h2 className="text-sm font-bold text-gray-700 mb-2">Resumo</h2>
            <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{selected.summary}</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-sm font-bold text-gray-700 mb-3">
            Itens de ação {selected.actionItems.length > 0 && <span className="text-gray-400 font-normal">({pendingCount} pendente{pendingCount === 1 ? '' : 's'})</span>}
          </h2>
          {selected.actionItems.length === 0 && (
            <p className="text-xs text-gray-400">Nenhum item de ação ainda — gere o resumo com IA a partir das notas, ou ele aparecerá aqui.</p>
          )}
          <div className="space-y-2">
            {selected.actionItems.map((item) => (
              <div key={item.id} className="flex items-center gap-2 group">
                <input
                  type="checkbox"
                  checked={item.completed}
                  onChange={() => toggleActionItem(item)}
                  className="rounded text-purple-500 focus:ring-purple-500 shrink-0"
                />
                <span className={`text-sm flex-1 ${item.completed ? 'line-through text-gray-400' : 'text-gray-700'}`}>{item.text}</span>
                {item.taskId ? (
                  <button onClick={() => onOpenTask(item.taskId!)} className="text-[11px] font-semibold text-blue-500 hover:underline shrink-0">Ver tarefa</button>
                ) : (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button disabled={creatingTaskFor === item.id} className="text-[11px] font-semibold text-gray-400 hover:text-purple-500 shrink-0 disabled:opacity-40">
                        {creatingTaskFor === item.id ? 'Criando...' : 'Criar tarefa'}
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56 max-h-72 overflow-y-auto">
                      {[...lists].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((l) => (
                        <DropdownMenuItem key={l.id} onClick={() => handleCreateTaskFromItem(item, l.id)} className="text-sm">
                          {l.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col md:flex-row gap-6 items-start">
      <RoomStatusPanel rooms={rooms} users={users} onSelectMeeting={selectMeetingById} />
      <div className="w-full md:flex-1 md:max-w-2xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-gray-800">Reuniões</h2>
        <button
          onClick={() => setShowCreateForm((v) => !v)}
          className="text-xs font-bold bg-orange-500 text-white px-3 py-1.5 rounded-lg hover:brightness-110"
        >
          + Nova reunião
        </button>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Encontre decisões tomadas em reuniões anteriores..."
        className="w-full text-sm p-3 border rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-purple-300 bg-white shadow-sm"
      />

      {showCreateForm && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 mb-4 space-y-3">
          <input
            type="text"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Título da reunião"
            className="w-full text-sm p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
            autoFocus
          />
          <div className="flex gap-2">
            <input
              type="datetime-local"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="flex-1 text-sm p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
            />
            <select
              value={newDurationMinutes}
              onChange={(e) => setNewDurationMinutes(Number(e.target.value))}
              className="text-sm p-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
            >
              {DURATION_OPTIONS.map((d) => (
                <option key={d.minutes} value={d.minutes}>{d.label}</option>
              ))}
            </select>
          </div>

          <div>
            <p className="text-[10px] text-gray-400 font-bold mb-1 uppercase">Sala (opcional)</p>
            {!isAddingRoom ? (
              <div className="flex gap-2">
                <select
                  value={newRoomId}
                  onChange={(e) => setNewRoomId(e.target.value)}
                  className="flex-1 text-sm p-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-300"
                >
                  <option value="">Sem sala</option>
                  {rooms.filter((r) => r.isActive).map((r) => (
                    <option key={r.id} value={r.id}>{r.name}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setIsAddingRoom(true)}
                  className="text-xs font-semibold text-gray-500 hover:text-purple-600 px-2 rounded-lg border hover:bg-gray-50 shrink-0"
                >
                  + Nova sala
                </button>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  autoFocus
                  value={newRoomName}
                  onChange={(e) => setNewRoomName(e.target.value)}
                  placeholder="Nome da sala (ex: 2º Andar | Diretoria)"
                  className="flex-1 text-sm p-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-300"
                />
                <button
                  type="button"
                  onClick={createRoom}
                  disabled={savingRoom || !newRoomName.trim()}
                  className="text-xs font-bold bg-purple-500 text-white px-3 rounded-lg hover:brightness-110 disabled:opacity-50 shrink-0"
                >
                  {savingRoom ? '...' : 'Salvar'}
                </button>
                <button type="button" onClick={() => { setIsAddingRoom(false); setNewRoomName(''); }} className="text-xs text-gray-500 hover:text-gray-700 px-2 shrink-0">
                  Cancelar
                </button>
              </div>
            )}
            {roomConflicts.length > 0 && (
              <div className="mt-2 text-[11px] bg-amber-50 border border-amber-200 text-amber-700 rounded-lg p-2">
                ⚠️ Sala já reservada nesse horário por:
                <ul className="list-disc list-inside mt-0.5">
                  {roomConflicts.map((m) => (
                    <li key={m.id}>{m.title} ({formatTimeRange(m.meetingDate, m.endDate)})</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div>
            <p className="text-[10px] text-gray-400 font-bold mb-1 uppercase">Participantes</p>
            <input
              type="text"
              value={participantSearch}
              onChange={(e) => setParticipantSearch(e.target.value)}
              placeholder="Pesquisar..."
              className="w-full text-xs border rounded px-2 py-1 mb-1 bg-white focus:outline-none focus:ring-1 focus:ring-purple-300"
            />
            <div className="max-h-32 overflow-y-auto border rounded p-2 bg-gray-50 space-y-1 custom-scrollbar">
              {users
                .filter((u) => u.name.toLowerCase().includes(participantSearch.toLowerCase()))
                .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
                .map((u) => (
                  <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-white p-1 rounded">
                    <input
                      type="checkbox"
                      checked={newParticipantIds.includes(u.id)}
                      onChange={(e) => {
                        if (e.target.checked) setNewParticipantIds([...newParticipantIds, u.id]);
                        else setNewParticipantIds(newParticipantIds.filter((id) => id !== u.id));
                      }}
                      className="rounded text-purple-500 focus:ring-purple-500"
                    />
                    {u.name}
                  </label>
                ))}
            </div>
          </div>
          <textarea
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Cole aqui as notas/transcrição, se já tiver (opcional — dá pra colar depois também)"
            rows={4}
            className="w-full text-sm p-2 border rounded-lg resize-y focus:outline-none focus:ring-2 focus:ring-purple-300"
          />
          <div className="flex justify-end gap-2">
            <button onClick={resetCreateForm} className="text-xs text-gray-500 hover:text-gray-700 font-semibold px-2 py-1 rounded hover:bg-gray-100">Cancelar</button>
            <button onClick={createMeeting} disabled={isCreating || !newTitle.trim()} className="text-xs bg-orange-500 text-white font-bold px-3 py-1.5 rounded-lg hover:brightness-110 disabled:opacity-50">
              {isCreating ? '...' : 'Criar'}
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {isLoading && <p className="p-8 text-sm text-gray-400 text-center">Carregando...</p>}
        {!isLoading && visibleMeetings.length === 0 && (
          <p className="p-8 text-sm text-gray-400 text-center">
            {search ? 'Nenhuma reunião encontrada.' : 'Nenhuma reunião registrada ainda.'}
          </p>
        )}
        {!isLoading && visibleMeetings.map((m) => {
          const pending = m.actionItems.filter((i) => !i.completed).length;
          const room = m.roomId ? rooms.find((r) => r.id === m.roomId) : undefined;
          return (
            <button
              key={m.id}
              onClick={() => setSelectedId(m.id)}
              className="w-full text-left px-4 py-3 border-b border-gray-100 last:border-b-0 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-gray-800 truncate">{m.title}</p>
                <span className="text-[11px] text-gray-300 shrink-0">{formatMeetingDate(m.meetingDate)}</span>
              </div>
              <p className="text-xs text-gray-500 truncate mt-0.5">{m.summary || m.notes || 'Sem notas ainda.'}</p>
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center -space-x-1.5">
                    {m.participantIds.slice(0, 5).map((id) => {
                      const u = users.find((usr) => usr.id === id);
                      if (!u) return null;
                      return <img key={id} src={avatarThumb(u.avatar)} title={u.name} className="w-5 h-5 rounded-full border-2 border-white" alt="" />;
                    })}
                  </div>
                  {room && (
                    <span className="text-[11px] text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded truncate max-w-[160px]">{room.name}</span>
                  )}
                </div>
                {pending > 0 && (
                  <span className="text-[11px] font-semibold text-purple-600 shrink-0">{pending} item{pending === 1 ? '' : 's'} de ação pendente{pending === 1 ? '' : 's'}</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
      </div>
    </div>
  );
}

type RoomMeetingRow = {
  id: string;
  room_id: string;
  title: string;
  meeting_date: string;
  end_date: string;
  created_by: string | null;
  participant_ids: string[];
};

type RoomStatus = {
  state: 'busy' | 'soon' | 'free';
  current?: RoomMeetingRow;
  next?: RoomMeetingRow;
  // Todas as reservas futuras/em andamento da sala, ordenadas por horário —
  // alimenta tanto o contador quanto a lista que aparece ao clicar no card.
  upcoming: RoomMeetingRow[];
};

const ROOM_STATUS_POLL_MS = 60_000;
const SOON_WINDOW_MS = 30 * 60_000;

function computeRoomStatuses(rows: RoomMeetingRow[], roomIds: string[]): Record<string, RoomStatus> {
  const now = Date.now();
  const byRoom = new Map<string, RoomMeetingRow[]>();
  rows.forEach((r) => {
    if (!byRoom.has(r.room_id)) byRoom.set(r.room_id, []);
    byRoom.get(r.room_id)!.push(r);
  });
  const result: Record<string, RoomStatus> = {};
  roomIds.forEach((id) => {
    const upcoming = (byRoom.get(id) || []).sort((a, b) => new Date(a.meeting_date).getTime() - new Date(b.meeting_date).getTime());
    const current = upcoming.find((m) => new Date(m.meeting_date).getTime() <= now && new Date(m.end_date).getTime() > now);
    if (current) {
      result[id] = { state: 'busy', current, upcoming };
      return;
    }
    const next = upcoming.find((m) => new Date(m.meeting_date).getTime() > now);
    if (next && new Date(next.meeting_date).getTime() - now <= SOON_WINDOW_MS) {
      result[id] = { state: 'soon', next, upcoming };
      return;
    }
    result[id] = { state: 'free', next, upcoming };
  });
  return result;
}

/**
 * Painel de status das salas ("semáforo"): livre / ocupada agora / começa em
 * breve, com quem reservou e quantas reservas futuras existem. Clicar num
 * card expande a lista completa (título, responsável e participantes) —
 * cada uma abre a reunião de verdade. Consulta o Supabase direto (mesmo
 * motivo do checador de conflito acima) e atualiza sozinho a cada 60s, já
 * que é um status "agora" que fica velho rápido.
 */
function RoomStatusPanel({ rooms, users, onSelectMeeting }: { rooms: MeetingRoom[]; users: User[]; onSelectMeeting: (id: string) => void }) {
  const [statuses, setStatuses] = useState<Record<string, RoomStatus>>({});
  // Enquanto a primeira consulta não termina (ou se ela falhar), o status de
  // cada sala fica "desconhecido" em vez de cair pro verde "Livre" — mostrar
  // uma sala como livre sem confirmação pode levar alguém a ocupar uma sala
  // já reservada.
  const [hasLoaded, setHasLoaded] = useState(false);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const activeRooms = useMemo(() => rooms.filter((r) => r.isActive), [rooms]);
  const activeRoomIds = useMemo(() => activeRooms.map((r) => r.id), [activeRooms]);

  const load = useCallback(async () => {
    if (activeRoomIds.length === 0) {
      setStatuses({});
      setHasLoaded(true);
      return;
    }
    // Uma consulta por sala (em vez de um único `.in(...).limit(200)`
    // compartilhado entre todas): com um teto só pro conjunto, salas com
    // muitas reservas futuras podiam empurrar as reservas de outra sala pra
    // fora do corte, fazendo ela aparecer com contador/"Livre" errados.
    const results = await Promise.all(
      activeRoomIds.map((roomId) =>
        supabase
          .from('meetings')
          .select('id, room_id, title, meeting_date, end_date, created_by, participant_ids')
          .eq('room_id', roomId)
          .not('end_date', 'is', null)
          .gte('end_date', new Date().toISOString())
          .order('meeting_date', { ascending: true })
          .limit(200)
      )
    );
    if (results.some((r) => r.error)) return; // mantém o último status conhecido (ou "desconhecido") em vez de mascarar a falha
    const rows = results.flatMap((r) => (r.data || []) as RoomMeetingRow[]);
    setStatuses(computeRoomStatuses(rows, activeRoomIds));
    setHasLoaded(true);
  }, [activeRoomIds]);

  useEffect(() => {
    load();
    const interval = setInterval(load, ROOM_STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [load]);

  const nameOf = (userId: string | null | undefined) => users.find((u) => u.id === userId)?.name || 'Alguém';

  if (activeRooms.length === 0) return null;

  return (
    <div className="w-full md:w-56 md:shrink-0 space-y-2">
      <p className="text-[10px] text-gray-400 font-bold uppercase px-1">Status das salas</p>
      {activeRooms.map((room) => {
        const status = statuses[room.id];
        const style = !hasLoaded
          ? { dot: 'bg-gray-300 animate-pulse', bg: 'bg-gray-50 border-gray-200', label: 'Carregando...' }
          : status?.state === 'busy'
          ? { dot: 'bg-red-500', bg: 'bg-red-50 border-red-200', label: 'Em uso agora' }
          : status?.state === 'soon'
          ? { dot: 'bg-amber-500', bg: 'bg-amber-50 border-amber-200', label: 'Começa em breve' }
          : { dot: 'bg-green-500', bg: 'bg-green-50 border-green-200', label: 'Livre' };
        const upcoming = status?.upcoming || [];
        const extraCount = Math.max(upcoming.length - 1, 0);
        const isExpanded = expandedRoomId === room.id;
        return (
          <div key={room.id} className={`rounded-lg border ${style.bg}`}>
            <button
              type="button"
              onClick={() => setExpandedRoomId(isExpanded ? null : room.id)}
              className="w-full text-left p-2.5"
            >
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                <p className="text-xs font-semibold text-gray-700 truncate flex-1">{room.name}</p>
                {hasLoaded && upcoming.length > 0 && (
                  <span className="text-[10px] text-gray-400 shrink-0">
                    {upcoming.length} reserva{upcoming.length === 1 ? '' : 's'} {isExpanded ? '▾' : '▸'}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray-500 mt-1">
                {!hasLoaded && style.label}
                {hasLoaded && status?.state === 'busy' && status.current &&
                  `${style.label} · até ${roomDatePrefix(status.current.end_date)}${formatTimeRange(status.current.end_date)} · ${nameOf(status.current.created_by)}`}
                {hasLoaded && status?.state === 'soon' && status.next &&
                  `${style.label} · ${roomDatePrefix(status.next.meeting_date)}às ${formatTimeRange(status.next.meeting_date)} · ${nameOf(status.next.created_by)}`}
                {hasLoaded && (!status || status.state === 'free') &&
                  (status?.next
                    ? `Livre · próxima ${roomDatePrefix(status.next.meeting_date)}às ${formatTimeRange(status.next.meeting_date)} · ${nameOf(status.next.created_by)}`
                    : 'Livre')}
              </p>
              {hasLoaded && extraCount > 0 && (
                <p className="text-[10px] text-gray-400 mt-0.5">+{extraCount} depois</p>
              )}
            </button>
            {isExpanded && (
              <div className="border-t border-black/5 max-h-56 overflow-y-auto custom-scrollbar">
                {upcoming.length === 0 && (
                  <p className="p-2.5 text-[11px] text-gray-400">Nenhuma reserva futura.</p>
                )}
                {upcoming.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => onSelectMeeting(m.id)}
                    className="w-full text-left p-2.5 border-t border-black/5 first:border-t-0 hover:bg-white/60"
                  >
                    <p className="text-xs font-semibold text-gray-700 truncate">{m.title}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">{formatMeetingDate(m.meeting_date)}</p>
                    <p className="text-[11px] text-gray-500 mt-0.5">Responsável: {nameOf(m.created_by)}</p>
                    {m.participant_ids.length > 0 && (
                      <div className="flex items-center -space-x-1.5 mt-1">
                        {m.participant_ids.slice(0, 6).map((id) => {
                          const u = users.find((usr) => usr.id === id);
                          if (!u) return null;
                          return <img key={id} src={avatarThumb(u.avatar)} title={u.name} className="w-5 h-5 rounded-full border-2 border-white" alt="" />;
                        })}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
