import { useState, useEffect } from 'react';
import { Plus, Trash2, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WarningText } from '@/components/ui/warning-text';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from '@/components/ui/command';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toast } from 'sonner';
import {
  fetchTaskDependencies,
  addTaskDependency,
  removeTaskDependency,
} from '@/lib/supabase';
import type { Task, TaskDependency, DependencyType } from '@/types';

interface TaskDependenciesProps {
  task: Task;
  allTasks: Task[];
  currentUserId: string;
  readOnly?: boolean;
}

const TYPE_LABEL: Record<DependencyType, string> = {
  blocks:     'Bloqueia',
  blocked_by: 'Bloqueada por',
  relates_to: 'Relacionada a',
};

const TYPE_COLOR: Record<DependencyType, string> = {
  blocks:     'bg-red-500/10 text-red-400 border-red-500/30',
  blocked_by: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  relates_to: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
};

export function TaskDependencies({
  task,
  allTasks,
  currentUserId,
  readOnly = false,
}: TaskDependenciesProps) {
  const [dependencies, setDependencies] = useState<TaskDependency[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<DependencyType>('blocked_by');
  const [selectedTaskId, setSelectedTaskId] = useState<string>('');
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchTaskDependencies(task.id)
      .then(setDependencies)
      .catch(() => toast.error('Erro ao carregar dependências'))
      .finally(() => setLoading(false));
  }, [task.id]);

  const availableTasks = allTasks.filter(
    (t) =>
      t.id !== task.id &&
      !dependencies.some((d) => d.depends_on_id === t.id)
  );

  async function handleAdd() {
    if (!selectedTaskId) return;
    try {
      const dep = await addTaskDependency(task.id, selectedTaskId, selectedType, currentUserId);
      setDependencies((prev) => [...prev, dep]);
      setSelectedTaskId('');
      setOpen(false);
      toast.success('Dependência adicionada');
    } catch {
      toast.error('Erro ao adicionar dependência');
    }
  }

  async function handleRemove(depId: string) {
    try {
      await removeTaskDependency(depId);
      setDependencies((prev) => prev.filter((d) => d.id !== depId));
      toast.success('Dependência removida');
    } catch {
      toast.error('Erro ao remover dependência');
    }
  }

  const isBlocked = dependencies.some((d) => {
    if (d.type !== 'blocked_by') return false;
    const blocker = d.depends_on_task;
    if (!blocker) return false;
    const doneKeywords = ['conclu', 'done', 'closed', 'complete', 'finaliz', 'pronto', 'aprovado'];
    return !doneKeywords.some((kw) => blocker.status.toLowerCase().includes(kw));
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-900">
          <Link2 className="w-4 h-4" />
          Dependências
          {dependencies.length > 0 && (
            <span className="text-xs text-gray-400 font-normal">
              ({dependencies.length})
            </span>
          )}
        </div>
        {!readOnly && (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                <Plus className="w-3 h-3" /> Adicionar
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3 space-y-3" align="end">
              <p className="text-sm font-medium">Nova dependência</p>

              <Select value={selectedType} onValueChange={(v) => setSelectedType(v as DependencyType)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.entries(TYPE_LABEL) as [DependencyType, string][]).map(([val, label]) => (
                    <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Popover open={taskPickerOpen} onOpenChange={setTaskPickerOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full h-8 text-xs justify-start font-normal">
                    {selectedTaskId
                      ? allTasks.find((t) => t.id === selectedTaskId)?.title ?? 'Tarefa'
                      : 'Selecionar tarefa…'}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0">
                  <Command>
                    <CommandInput placeholder="Buscar tarefa…" className="h-8 text-xs" />
                    <CommandEmpty className="text-xs p-3 text-gray-400">
                      Nenhuma tarefa encontrada.
                    </CommandEmpty>
                    <CommandGroup className="max-h-48 overflow-y-auto">
                      {availableTasks.map((t) => (
                        <CommandItem
                          key={t.id}
                          value={t.title}
                          className="text-xs"
                          onSelect={() => {
                            setSelectedTaskId(t.id);
                            setTaskPickerOpen(false);
                          }}
                        >
                          {t.title}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </Command>
                </PopoverContent>
              </Popover>

              <Button
                size="sm"
                className="w-full h-8 text-xs"
                disabled={!selectedTaskId}
                onClick={handleAdd}
              >
                Confirmar
              </Button>
            </PopoverContent>
          </Popover>
        )}
      </div>

      {isBlocked && (
        <WarningText className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs">
          Esta tarefa está bloqueada. Conclua as dependências antes de prosseguir.
        </WarningText>
      )}

      {loading ? (
        <p className="text-xs text-gray-400">Carregando…</p>
      ) : dependencies.length === 0 ? (
        <p className="text-center py-8 text-sm text-gray-400 font-medium italic">Nenhuma dependência definida.</p>
      ) : (
        <ul className="space-y-2">
          {dependencies.map((dep) => (
            <li
              key={dep.id}
              className="flex items-center justify-between gap-2 text-xs rounded-xl border px-3 py-2 bg-gray-50"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 shrink-0 border ${TYPE_COLOR[dep.type]}`}
                >
                  {TYPE_LABEL[dep.type]}
                </Badge>
                <span className="truncate text-gray-700 font-medium">
                  {dep.depends_on_task?.title ?? dep.depends_on_id}
                </span>
                {dep.depends_on_task && (
                  <span className="shrink-0 text-[10px] text-gray-400">
                    · {dep.depends_on_task.status}
                  </span>
                )}
              </div>
              {!readOnly && (
                <button
                  onClick={() => handleRemove(dep.id)}
                  className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
