/**
 * SESSION_04 — Tarefa 6
 * Painel de logs de execução de uma automação.
 */

import React, { useEffect, useState } from 'react';
import { X, CheckCircle2, XCircle, SkipForward, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchAutomationLogs } from '../lib/supabase';
import { formatDateTimeNumericBR } from '../lib/dates';
import type { AutomationLog } from '../types';

interface AutomationLogPanelProps {
  automationId: string;
  automationName: string;
  onClose: () => void;
}

const STATUS_ICON = {
  success: <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0" />,
  error:   <XCircle      className="w-4 h-4 text-red-500   shrink-0" />,
  skipped: <SkipForward  className="w-4 h-4 text-yellow-500 shrink-0" />,
};

const STATUS_LABEL = {
  success: 'Executado',
  error:   'Erro',
  skipped: 'Ignorado',
};

// formatDate agora vive em lib/dates como formatDateTimeNumericBR (issue
// #102, achado 3).
const formatDate = formatDateTimeNumericBR;

export const AutomationLogPanel: React.FC<AutomationLogPanelProps> = ({
  automationId,
  automationName,
  onClose,
}) => {
  const [logs, setLogs]     = useState<AutomationLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchAutomationLogs(automationId, 50);
      setLogs(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [automationId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card border rounded-xl shadow-2xl w-full max-w-lg mx-4 flex flex-col max-h-[80vh]">

        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0">
          <div>
            <h3 className="font-semibold text-sm">Histórico de execução</h3>
            <p className="text-xs text-muted-foreground truncate max-w-[300px]">{automationName}</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={load} title="Recarregar">
              <RefreshCw className="w-3.5 h-3.5" />
            </Button>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-full" onClick={onClose}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 p-4">
          {loading && (
            <div className="text-center py-10 text-sm text-muted-foreground">Carregando logs…</div>
          )}
          {!loading && error && (
            <div className="text-center py-10 text-sm text-red-500">{error}</div>
          )}
          {!loading && !error && logs.length === 0 && (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Nenhuma execução registrada ainda.
            </div>
          )}
          {!loading && !error && logs.length > 0 && (
            <div className="flex flex-col gap-2">
              {logs.map(log => (
                <div key={log.id} className="border rounded-lg p-3 flex flex-col gap-1.5 text-xs">
                  <div className="flex items-center gap-2">
                    {STATUS_ICON[log.status]}
                    <span className="font-medium">{STATUS_LABEL[log.status]}</span>
                    <span className="ml-auto text-muted-foreground">{formatDate(log.executed_at)}</span>
                  </div>

                  <div className="text-muted-foreground">
                    Gatilho: <span className="font-medium text-foreground">{log.triggered_by}</span>
                  </div>

                  {log.actions_taken && log.actions_taken.length > 0 && (
                    <div className="text-muted-foreground">
                      Ações:{' '}
                      <span className="font-medium text-foreground">
                        {log.actions_taken.map((a: any) => a.type).join(', ')}
                      </span>
                    </div>
                  )}

                  {log.error_message && (
                    <div className="mt-1 bg-red-500/10 text-red-600 rounded px-2 py-1 font-mono break-all">
                      {log.error_message}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end p-4 border-t shrink-0">
          <Button variant="outline" size="sm" onClick={onClose}>Fechar</Button>
        </div>
      </div>
    </div>
  );
};
