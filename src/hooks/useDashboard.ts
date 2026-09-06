import { useState, useEffect, useCallback, useRef } from 'react';
import { Session } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Task } from '../types';
import * as taskRepo from '../lib/taskRepo';

// Estado do Dashboard global: todas as tarefas visíveis (projeção enxuta, com
// atividades recentes) + a lista de listas para rótulos. Recarrega ao entrar na
// view de Dashboard. É "fino": a carga de dados vive no taskRepo; aqui só mora
// o estado do React e o efeito de disparo.
export function useDashboard(session: Session | null, activeView: string, listIds: string[] | null) {
  const [dashboardTasks, setDashboardTasks] = useState<Task[]>([]);
  const [dashboardLists, setDashboardLists] = useState<{ id: string; name: string }[]>([]);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);

  // true depois de já ter tentado de novo uma vez para a tentativa em curso —
  // evita loop de retry, mas dá uma segunda chance automática para a falha
  // transitória mais comum (RLS/sessão ainda se firmando logo após o login).
  const hasRetriedRef = useRef(false);

  const loadDashboardTasks = useCallback(async () => {
    if (!session) return;
    setIsDashboardLoading(true);
    try {
      const { tasks: dashTasks, lists: dashLists } = await taskRepo.fetchDashboardData(listIds);
      setDashboardTasks(dashTasks);
      setDashboardLists(dashLists);
      hasRetriedRef.current = false;
      setIsDashboardLoading(false);
    } catch (err) {
      console.error('Erro ao carregar tarefas para Dashboard:', err);
      if (!hasRetriedRef.current) {
        hasRetriedRef.current = true;
        // Mantém isDashboardLoading em true durante a espera: evita mostrar
        // "sem tarefas" por 1.5s antes da segunda tentativa.
        setTimeout(() => { loadDashboardTasks(); }, 1500);
        return;
      }
      hasRetriedRef.current = false;
      setIsDashboardLoading(false);
      toast.error('Não foi possível carregar o Dashboard. Tente novamente.');
    }
  }, [session, listIds]);

  // Recarrega o Dashboard sempre que a view muda para Dashboard.
  useEffect(() => {
    if (activeView === 'Dashboard') {
      loadDashboardTasks();
    }
  }, [activeView, loadDashboardTasks]);

  return { dashboardTasks, dashboardLists, isDashboardLoading, loadDashboardTasks };
}
