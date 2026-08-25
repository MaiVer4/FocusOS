import { useState, useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { notificationService } from '../lib/notifications';
import { Block, Task, TaskStatus, BlockType, BlockPriority, BlockStatus } from '../lib/types';
import { ParsedItem } from '../lib/ai-classifier';
import {
  getBlockColor,
  getBlockLabel,
  getBlockStatusLabel,
  getDifficultyLabel,
  getTaskStatusColor,
  getCategoryColor,
  formatTo12h,
  addMinutesToTime,
  addMinutesToDatetime,
  durationBetween,
  todayStr,
  formatDateDisplay,
  generateUUID,
} from '../lib/helpers';
import {
  Plus,
  Trash2,
  CalendarIcon,
  BookOpen,
  Clock,
  Pencil,
  Sparkles,
  Loader2,
  Package,
  ChevronDown,
  FolderOpen,
  ListChecks,
  Check,
  GraduationCap,
  CalendarDays,
  Brain,
} from 'lucide-react';
import { googleAuth } from '../lib/google-auth';
import { ClassroomTask } from '../lib/google-classroom';
import { CalendarEventItem } from '../lib/google-calendar';
import { googleSync, SyncResult } from '../lib/google-sync';
import { cloudSync } from '../lib/cloud-sync';

// Subcomponentes modulares
import { TaskModal } from './planner/TaskModal';
import { BlockModal } from './planner/BlockModal';
import { SmartImportModal } from './planner/SmartImportModal';
import { ClassroomModal } from './planner/ClassroomModal';
import { CalendarModal } from './planner/CalendarModal';
import { DailySetupModal } from './planner/DailySetupModal';
import { ConfirmModal } from './planner/ConfirmModal';

export function Planner() {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [activeTab, setActiveTab] = useState<'blocks' | 'tasks'>('blocks');

  // Modals state
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showDailySetup, setShowDailySetup] = useState(false);
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [showClassroom, setShowClassroom] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [classroomConnected, setClassroomConnected] = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiInsights, setAiInsights] = useState<string[] | null>(null);

  const refreshData = () => {
    setBlocks(store.getBlocks(selectedDate).sort((a, b) => a.startTime.localeCompare(b.startTime)));
    setTasks(store.getTasksForDayWithCarryOver(selectedDate));
    setAllTasks(
      store.getTasks()
        .filter(t => t.status !== 'terminada')
        .sort((a, b) => {
          if (!a.dueDate && !b.dueDate) return 0;
          if (!a.dueDate) return 1;
          if (!b.dueDate) return -1;
          return a.dueDate.localeCompare(b.dueDate);
        })
    );

    // Programar notificaciones para entregables
    if (notificationService.hasPermission()) {
      store.getTasksForDayWithCarryOver(selectedDate)
        .filter(t => t.isDeliverable && t.status !== 'terminada' && t.status !== 'aplazada')
        .forEach(t => notificationService.scheduleDeliverableNotifications(t));
    }
  };

  const refreshRef = useRef(refreshData);
  refreshRef.current = refreshData;

  useEffect(() => {
    refreshData();
    setClassroomConnected(googleAuth.isAuthenticated() || googleAuth.wasConnected());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // Auto-limpieza de bloques expirados
  useEffect(() => {
    const cleaned = store.cleanExpiredBlocks();
    if (cleaned > 0) refreshRef.current();

    const interval = setInterval(() => {
      const removed = store.cleanExpiredBlocks();
      if (removed > 0) refreshRef.current();
    }, 60_000);

    return () => clearInterval(interval);
  }, []);

  // Auto-Sync con Google
  useEffect(() => {
    const unsub = googleSync.subscribe((result) => {
      setSyncResult(result);
      if (result.status === 'success' && (result.newTasks > 0 || result.updatedTasks > 0 || result.removedTasks > 0)) {
        refreshRef.current();
      }
      setClassroomConnected(googleAuth.isAuthenticated() || googleAuth.wasConnected());
    });

    if (googleAuth.isAuthenticated() || googleAuth.wasConnected()) {
      setClassroomConnected(true);
      googleSync.startAutoSync();
    }

    return () => {
      unsub();
      googleSync.stopAutoSync();
    };
  }, []);

  // Escuchar cambios del store (incluyendo actualizaciones remotas vía cloudSync)
  useEffect(() => {
    const unsubStore = store.subscribe(() => {
      refreshRef.current();
    });
    return () => { unsubStore(); };
  }, []);

  const handleManualSync = async () => {
    if (!googleAuth.isAuthenticated()) {
      try {
        const forceConsent = !googleAuth.wasConnected();
        await googleAuth.authenticate(forceConsent);
        setClassroomConnected(true);
        googleSync.startAutoSync();
        cloudSync.connect();
      } catch {
        return;
      }
    } else {
      await googleSync.sync();
    }
    refreshData();
  };

  const handleDailySetup = () => {
    const templateBlocks = store.generateFromTemplate(selectedDate);
    if (templateBlocks.length === 0) {
      store.generateBlocksFromTasks(selectedDate);
    }
    store.reorganizeBlocks(selectedDate);

    if (notificationService.hasPermission()) {
      store.getBlocks(selectedDate).forEach(b => notificationService.scheduleBlockNotifications(b));
    }

    refreshData();
    setShowDailySetup(false);
  };

  const handleAIGenerate = async () => {
    if (aiGenerating) return;
    setAiGenerating(true);
    setAiInsights(null);
    try {
      const result = await store.generateWithAI(selectedDate);
      if (result.insights.length > 0) {
        setAiInsights(result.insights);
      }
      refreshData();
    } catch (err: unknown) {
      alert((err as Error).message ?? 'Error al generar con IA');
    } finally {
      setAiGenerating(false);
    }
  };

  // ─── Task Handlers ─────────────────────────────────────────────────────────

  const handleSaveTask = (taskData: Omit<Task, 'id' | 'createdAt'> & { id?: string }) => {
    if (taskData.id) {
      // Editar tarea existente
      store.updateTask(taskData.id, taskData);
      notificationService.cancelTaskNotifications(taskData.id);
      if (taskData.isDeliverable && notificationService.hasPermission()) {
        const updated = store.getTask(taskData.id);
        if (updated && updated.status !== 'terminada' && updated.status !== 'aplazada') {
          notificationService.scheduleDeliverableNotifications(updated);
        }
      }
    } else {
      // Crear nueva tarea
      const newTask: Task = {
        id: generateUUID(),
        subject: taskData.subject,
        description: taskData.description,
        notes: taskData.notes,
        category: taskData.category,
        subtasks: taskData.subtasks,
        dueDate: taskData.dueDate,
        difficulty: taskData.difficulty,
        status: 'sin-iniciar',
        isDeliverable: taskData.isDeliverable,
        createdAt: new Date().toISOString(),
      };
      store.addTask(newTask);

      if (newTask.dueDate && notificationService.hasPermission()) {
        const blockDate = newTask.dueDate.split('T')[0];
        store.getBlocks(blockDate).forEach(b => notificationService.scheduleBlockNotifications(b));
        if (newTask.isDeliverable) {
          notificationService.scheduleDeliverableNotifications(newTask);
        }
        if (blockDate === selectedDate) setActiveTab('blocks');
      }
    }
    refreshData();
  };

  const deleteTask = (id: string) => {
    setConfirmAction({
      message: '¿Eliminar esta tarea? Los bloques asociados quedarán sin tarea.',
      onConfirm: () => {
        notificationService.cancelTaskNotifications(id);
        store.deleteTask(id);
        refreshData();
      },
    });
  };

  const postponeTask = (id: string, minutes: number) => {
    const task = store.getTask(id);
    if (!task || !task.dueDate) return;
    const newDueDate = addMinutesToDatetime(task.dueDate, minutes);
    const newStatus: TaskStatus = task.status === 'en-progreso'
      ? 'en-progreso-aplazada'
      : task.status === 'en-progreso-aplazada'
        ? 'en-progreso-aplazada'
        : 'aplazada';
    store.updateTask(id, { dueDate: newDueDate, status: newStatus });
    notificationService.cancelTaskNotifications(id);
    if (task.isDeliverable) {
      const updated = store.getTask(id);
      if (updated) notificationService.scheduleDeliverableNotifications(updated);
    }
    refreshData();
  };

  const changeTaskStatus = (id: string, status: TaskStatus) => {
    const updates: Partial<Task> = { status };
    if (status === 'terminada') {
      updates.completedAt = new Date().toISOString();
      notificationService.cancelTaskNotifications(id);
    }
    store.updateTask(id, updates);
    refreshData();
  };

  // ─── Block Handlers ────────────────────────────────────────────────────────

  const handleSaveBlock = (blockData: {
    id?: string;
    label?: string;
    type: BlockType;
    priority: BlockPriority;
    taskId?: string;
    startTime: string;
    endTime: string;
    status?: BlockStatus;
  }) => {
    const duration = durationBetween(blockData.startTime, blockData.endTime);
    if (store.hasBlockOverlap(selectedDate, blockData.startTime, blockData.endTime, blockData.id)) {
      alert('El horario se solapa con un bloque existente. Ajusta las horas.');
      return;
    }

    const task = blockData.taskId ? tasks.find(t => t.id === blockData.taskId) : undefined;

    if (blockData.id) {
      // Editar bloque
      store.updateBlock(blockData.id, {
        type: blockData.type,
        label: blockData.label,
        priority: blockData.priority,
        taskId: blockData.taskId,
        task,
        startTime: blockData.startTime,
        endTime: blockData.endTime,
        duration,
        ...(blockData.status ? { status: blockData.status } : {}),
      });
    } else {
      // Agregar bloque
      const newBlock: Block = {
        id: generateUUID(),
        type: blockData.type,
        label: blockData.label,
        priority: blockData.priority,
        taskId: blockData.taskId,
        task,
        duration,
        startTime: blockData.startTime,
        endTime: blockData.endTime,
        status: 'pending',
        date: selectedDate,
        interruptions: 0,
      };
      if (notificationService.hasPermission()) {
        notificationService.scheduleBlockNotifications(newBlock);
      }
      store.addBlock(newBlock);
    }
    refreshData();
  };

  const deleteBlock = (id: string) => {
    notificationService.cancelBlockNotifications(id);
    store.deleteBlock(id);
    refreshData();
  };

  const postponeBlock = (id: string, minutes: number) => {
    const block = store.getBlock(id);
    if (!block || block.status === 'completed' || block.status === 'failed') return;
    const newStart = addMinutesToTime(block.startTime, minutes);
    const newEnd = addMinutesToTime(block.endTime, minutes);
    if (newEnd > '23:59') return;

    const dayBlocks = store.getBlocks(block.date).sort((a, b) => a.startTime.localeCompare(b.startTime));
    const blockIdx = dayBlocks.findIndex(b => b.id === id);
    if (blockIdx > 0) {
      const prev = dayBlocks[blockIdx - 1];
      if (prev.status !== 'completed' && prev.status !== 'failed' && prev.endTime <= block.startTime) {
        const newPrevEnd = newStart;
        const newPrevDuration = durationBetween(prev.startTime, newPrevEnd);
        if (newPrevDuration > 0) {
          store.updateBlock(prev.id, { endTime: newPrevEnd, duration: newPrevDuration });
        }
      }
    }

    notificationService.cancelBlockNotifications(id);
    store.updateBlock(id, { startTime: newStart, endTime: newEnd });
    store.reorganizeBlocks(block.date);

    if (notificationService.hasPermission()) {
      store.getBlocks(block.date).forEach(b => {
        notificationService.cancelBlockNotifications(b.id);
        notificationService.scheduleBlockNotifications(b);
      });
    }
    refreshData();
  };

  // ─── Import Handlers ───────────────────────────────────────────────────────

  const handleSmartImport = (items: ParsedItem[]) => {
    items.forEach((item) => {
      const dueDate = item.dueDate ?? selectedDate;
      const task: Task = {
        id: generateUUID(),
        subject: item.subject,
        description: item.description,
        notes: '',
        dueDate,
        difficulty: item.difficulty,
        status: 'sin-iniciar',
        isDeliverable: item.isDeliverable ?? false,
        createdAt: new Date().toISOString(),
      };
      store.addTask(task);

      if (task.isDeliverable && notificationService.hasPermission()) {
        notificationService.scheduleDeliverableNotifications(task);
      }
    });

    refreshData();
    setActiveTab('blocks');
  };

  const handleClassroomImport = (importedTasks: ClassroomTask[]) => {
    importedTasks.forEach((ct) => {
      const task: Task = {
        id: generateUUID(),
        subject: ct.title,
        description: ct.description,
        notes: '',
        category: ct.courseName,
        dueDate: ct.dueDate,
        assignedDate: ct.assignedDate || undefined,
        difficulty: 'medium',
        status: 'sin-iniciar',
        isDeliverable: true,
        source: 'classroom',
        externalId: `classroom:${ct.courseworkId}`,
        createdAt: new Date().toISOString(),
      };
      store.addTask(task);

      if (notificationService.hasPermission()) {
        notificationService.scheduleDeliverableNotifications(task);
      }
    });

    refreshData();
    setActiveTab('tasks');
  };

  const handleCalendarImport = (events: CalendarEventItem[]) => {
    events.forEach((ev) => {
      const dueDate = ev.isAllDay || !ev.startTime ? ev.date : `${ev.date}T${ev.startTime}`;
      const task: Task = {
        id: generateUUID(),
        subject: ev.title,
        description: ev.description,
        notes: ev.location ? `📍 ${ev.location}` : '',
        category: 'Calendario',
        dueDate,
        difficulty: 'medium',
        status: 'sin-iniciar',
        isDeliverable: false,
        externalId: `calendar:${ev.id}`,
        source: 'calendar',
        createdAt: new Date().toISOString(),
      };
      store.addTask(task);
    });

    refreshData();
    setActiveTab('tasks');
  };

  const isToday = selectedDate === todayStr();

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Planificador</h1>
        <p className="text-zinc-400 text-sm">
          {isToday ? 'Hoy — ' : ''}
          {formatDateDisplay(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Sync Status Banner */}
      {syncResult && syncResult.status !== 'idle' && (
        <div className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
          syncResult.status === 'syncing'
            ? 'bg-blue-900/20 border border-blue-800/30 text-blue-400'
            : syncResult.status === 'success'
              ? 'bg-green-900/20 border border-green-800/30 text-green-400'
              : syncResult.status === 'error'
                ? 'bg-red-900/20 border border-red-800/30 text-red-400'
                : 'bg-zinc-800 border border-zinc-700 text-zinc-400'
        }`}>
          {syncResult.status === 'syncing' && (
            <><Loader2 className="size-3 animate-spin" /> Sincronizando con Google...</>
          )}
          {syncResult.status === 'success' && (
            <>
              <GraduationCap className="size-3" />
              <CalendarDays className="size-3" />
              {syncResult.newTasks > 0 || syncResult.updatedTasks > 0 || syncResult.removedTasks > 0
                ? [
                    syncResult.newTasks > 0 && `+${syncResult.newTasks} nuevas`,
                    syncResult.updatedTasks > 0 && `${syncResult.updatedTasks} actualizada${syncResult.updatedTasks !== 1 ? 's' : ''}`,
                    syncResult.removedTasks > 0 && `${syncResult.removedTasks} eliminada${syncResult.removedTasks !== 1 ? 's' : ''}`,
                  ].filter(Boolean).join(', ')
                : 'Todo sincronizado'}
              <span className="ml-auto text-zinc-500">
                {syncResult.lastSync && new Date(syncResult.lastSync).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}
              </span>
            </>
          )}
          {syncResult.status === 'error' && (
            <><span>Error al sincronizar</span> <button onClick={handleManualSync} className="ml-auto underline">Reintentar</button></>
          )}
          {syncResult.status === 'not-connected' && (
            <><span>No conectado a Google</span> <button onClick={handleManualSync} className="ml-auto text-blue-400 underline">Conectar</button></>
          )}
        </div>
      )}

      {/* Date Selector */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4">
        <label className="block text-xs text-zinc-500 mb-2 uppercase tracking-wider">Fecha</label>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-1">
        <button
          onClick={() => setActiveTab('blocks')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'blocks' ? 'bg-red-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Bloques ({blocks.length})
        </button>
        <button
          onClick={() => setActiveTab('tasks')}
          className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
            activeTab === 'tasks' ? 'bg-blue-600 text-white' : 'text-zinc-400 hover:text-white'
          }`}
        >
          Tareas ({tasks.length})
        </button>
      </div>

      {/* ── Blocks Tab ── */}
      {activeTab === 'blocks' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Bloques del Día</h2>
            <div className="flex gap-2">
              {blocks.length > 0 && (
                <button
                  onClick={() => {
                    setConfirmAction({
                      message: `¿Eliminar todos los bloques del ${formatDateDisplay(selectedDate)}?`,
                      onConfirm: () => {
                        notificationService.cancelAllNotifications();
                        store.deleteAllBlocksForDate(selectedDate);
                        refreshData();
                      },
                    });
                  }}
                  className="px-3 py-2 bg-red-900/50 hover:bg-red-800/60 text-red-400 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                >
                  <Trash2 className="size-3.5" /> Borrar todo
                </button>
              )}
              <button
                onClick={() => setShowDailySetup(true)}
                className="px-3 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg text-xs font-semibold transition-colors"
              >
                Auto
              </button>
              <button
                onClick={() => {
                  if (!store.isAIEnabled()) {
                    alert('Configura tu API key de IA en Settings → Inteligencia Artificial');
                    return;
                  }
                  handleAIGenerate();
                }}
                disabled={aiGenerating}
                className="px-3 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1"
                title={!store.isAIEnabled() ? 'Configura API key en Settings' : blocks.length > 0 ? 'Elimina los bloques primero' : 'Generar horario con IA'}
              >
                {aiGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <Brain className="size-3.5" />}
                IA
              </button>
              <button
                onClick={() => setShowAddBlock(true)}
                className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                aria-label="Agregar bloque"
              >
                <Plus className="size-5" />
              </button>
            </div>
          </div>

          {blocks.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 space-y-2">
              <CalendarIcon className="size-8 mx-auto opacity-40" />
              <p className="text-sm">Sin bloques para este día</p>
              <p className="text-xs">
                Toca "Auto" para configuración rápida{store.isAIEnabled() ? ', "IA" para horario inteligente' : ''} o "+" para agregar manualmente
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {aiInsights && aiInsights.length > 0 && (
                <div className="bg-purple-900/20 border border-purple-800/30 rounded-xl p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-purple-300 flex items-center gap-1.5">
                      <Brain className="size-4" /> Observaciones de la IA
                    </h4>
                    <button onClick={() => setAiInsights(null)} className="text-zinc-500 hover:text-zinc-300 text-xs">✕</button>
                  </div>
                  {aiInsights.map((insight, i) => (
                    <p key={i} className="text-xs text-purple-200/70">• {insight}</p>
                  ))}
                </div>
              )}
              {blocks.map((block) => (
                <div key={block.id} className={`border rounded-xl p-4 ${getBlockColor(block.type)}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{block.label || getBlockLabel(block.type)}</span>
                        {block.status !== 'pending' && (
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            block.status === 'completed' ? 'bg-green-600/30 text-green-300' :
                            block.status === 'failed' ? 'bg-red-600/30 text-red-300' :
                            'bg-blue-600/30 text-blue-300'
                          }`}>
                            {getBlockStatusLabel(block.status)}
                          </span>
                        )}
                        {block.interruptions > 0 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-orange-600/30 text-orange-300">
                            {block.interruptions} interrupción{block.interruptions > 1 ? 'es' : ''}
                          </span>
                        )}
                      </div>
                      {block.task && (
                        <div className="text-sm mt-1 truncate opacity-90">
                          {block.task.subject}
                          {block.task.isDeliverable && (
                            <span className="ml-1.5 text-xs px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 inline-flex items-center gap-0.5">
                              <Package className="size-3" /> Entregable
                            </span>
                          )}
                        </div>
                      )}
                      <div className="text-xs opacity-60 mt-1">
                        {formatTo12h(block.startTime)} – {formatTo12h(block.endTime)} · {block.duration} min
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0">
                      <button
                        onClick={() => setEditingBlock(block)}
                        className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                        aria-label="Editar bloque"
                      >
                        <Pencil className="size-4" />
                      </button>
                      {block.status === 'pending' && (
                        <button
                          onClick={() => deleteBlock(block.id)}
                          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors"
                          aria-label="Eliminar bloque"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  {block.status === 'pending' && (
                    <div className="flex items-center gap-2 pt-2 mt-2 border-t border-white/5">
                      <span className="text-xs opacity-40">Aplazar:</span>
                      <button
                        onClick={() => postponeBlock(block.id, 30)}
                        className="text-xs px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
                      >
                        +30 min
                      </button>
                      <button
                        onClick={() => postponeBlock(block.id, 60)}
                        className="text-xs px-2 py-1 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors"
                      >
                        +1 hora
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Tasks Tab ── */}
      {activeTab === 'tasks' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tareas</h2>
            <button
              onClick={() => setShowAddTask(true)}
              className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              aria-label="Agregar tarea"
            >
              <Plus className="size-5" />
            </button>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1">
            <button
              onClick={() => setShowClassroom(true)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                classroomConnected
                  ? 'bg-green-600 hover:bg-green-700'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              }`}
            >
              <span className="relative">
                <GraduationCap className="size-3.5" />
                <span className={`absolute -top-1 -right-1 size-2 rounded-full border border-zinc-900 ${
                  classroomConnected ? 'bg-green-400' : 'bg-red-400'
                }`} />
              </span>
              Classroom
            </button>
            <button
              onClick={() => setShowCalendar(true)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                classroomConnected
                  ? 'bg-blue-600 hover:bg-blue-700'
                  : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
              }`}
            >
              <CalendarDays className="size-3.5" />
              Calendar
            </button>
            <button
              onClick={() => setShowSmartImport(true)}
              className="flex items-center gap-1.5 px-3 py-2 bg-purple-600 hover:bg-purple-700 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
            >
              <Sparkles className="size-3.5" />
              IA
            </button>
            {allTasks.length > 0 && (
              <button
                onClick={() => {
                  setConfirmAction({
                    message: '¿Eliminar TODAS las tareas? Esta acción no se puede deshacer.',
                    onConfirm: () => {
                      notificationService.cancelAllNotifications();
                      store.deleteAllTasks();
                      refreshData();
                    },
                  });
                }}
                className="ml-auto flex items-center gap-1 px-3 py-2 bg-red-900/40 hover:bg-red-800/50 text-red-400 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap"
                aria-label="Eliminar todas las tareas"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>

          {allTasks.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 space-y-2">
              <BookOpen className="size-8 mx-auto opacity-40" />
              <p className="text-sm">Sin tareas registradas</p>
            </div>
          ) : (
            <div className="space-y-2">
              {allTasks.map((task) => {
                const isOverdue = task.dueDate ? task.dueDate.split('T')[0] < todayStr() : false;
                return (
                  <div
                    key={task.id}
                    className={`bg-zinc-900 border rounded-xl p-4 space-y-2 ${
                      isOverdue ? 'border-red-600/40' : 'border-zinc-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold truncate">{task.subject}</span>
                          {task.isDeliverable ? (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 flex items-center gap-0.5 flex-shrink-0">
                              <Package className="size-3" /> Entregable
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-teal-600/20 text-teal-400 flex items-center gap-0.5 flex-shrink-0">
                              <BookOpen className="size-3" /> Personal
                            </span>
                          )}
                          {isOverdue && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-600/20 text-red-400 flex-shrink-0">
                              Vencida
                            </span>
                          )}
                          {task.source === 'classroom' && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-600/10 text-green-500 flex items-center gap-0.5 flex-shrink-0">
                              <GraduationCap className="size-3" />
                            </span>
                          )}
                          {task.source === 'calendar' && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-600/10 text-blue-500 flex items-center gap-0.5 flex-shrink-0">
                              <CalendarDays className="size-3" />
                            </span>
                          )}
                        </div>
                        {task.category && (
                          <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0 mt-1 w-fit ${getCategoryColor(task.category)}`}>
                            <FolderOpen className="size-3" /> {task.category}
                          </span>
                        )}
                        {task.description && (
                          <div className="text-sm text-zinc-400 mt-1 line-clamp-2">{task.description}</div>
                        )}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        <button
                          onClick={() => setEditingTask(task)}
                          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-500 hover:text-blue-400"
                          aria-label="Editar tarea"
                        >
                          <Pencil className="size-4" />
                        </button>
                        <button
                          onClick={() => deleteTask(task.id)}
                          className="p-1.5 hover:bg-white/10 rounded-lg transition-colors text-zinc-500 hover:text-red-400"
                          aria-label="Eliminar tarea"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      {task.assignedDate && task.source === 'classroom' && (
                        <span className="flex items-center gap-1 text-zinc-500">
                          Asignada: {formatDateDisplay(task.assignedDate)}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-zinc-400">
                        <Clock className="size-3" />
                        {task.dueDate
                          ? (task.source === 'classroom' ? 'Entrega: ' : '') + formatDateDisplay(task.dueDate)
                          : 'Sin fecha límite'}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full ${
                        task.difficulty === 'high' ? 'bg-red-600/20 text-red-400' :
                        task.difficulty === 'medium' ? 'bg-yellow-600/20 text-yellow-400' :
                        'bg-green-600/20 text-green-400'
                      }`}>
                        {getDifficultyLabel(task.difficulty)}
                      </span>

                      {/* Status Dropdown */}
                      <div className="relative">
                        <select
                          value={task.status}
                          onChange={(e) => changeTaskStatus(task.id, e.target.value as TaskStatus)}
                          className={`appearance-none pl-2 pr-6 py-0.5 rounded-full text-xs font-medium cursor-pointer border-0 focus:outline-none focus:ring-1 focus:ring-white/20 ${getTaskStatusColor(task.status)}`}
                        >
                          <option value="sin-iniciar">Sin iniciar</option>
                          <option value="en-progreso">En progreso</option>
                          <option value="en-progreso-aplazada">En progreso (aplazada)</option>
                          <option value="aplazada">Aplazada</option>
                          <option value="terminada">Terminada</option>
                        </select>
                        <ChevronDown className="size-3 absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none opacity-60" />
                      </div>
                    </div>

                    {task.status !== 'terminada' && task.dueDate && (
                      <div className="flex items-center gap-2 pt-1">
                        <span className="text-xs text-zinc-600">Aplazar:</span>
                        <button
                          onClick={() => postponeTask(task.id, 30)}
                          className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors text-zinc-300"
                        >
                          +30 min
                        </button>
                        <button
                          onClick={() => postponeTask(task.id, 60)}
                          className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors text-zinc-300"
                        >
                          +1 hora
                        </button>
                        <button
                          onClick={() => postponeTask(task.id, 1440)}
                          className="text-xs px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors text-zinc-300"
                        >
                          +1 día
                        </button>
                      </div>
                    )}

                    {task.completedAt && (
                      <div className="text-xs text-zinc-600">
                        Completada: {formatDateDisplay(task.completedAt)}
                      </div>
                    )}

                    {/* Subtasks */}
                    {task.subtasks && task.subtasks.length > 0 && (() => {
                      const done = task.subtasks.filter(s => s.done).length;
                      const total = task.subtasks.length;
                      const pct = Math.round((done / total) * 100);
                      return (
                        <div className="space-y-1.5 pt-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="flex items-center gap-1 text-zinc-400">
                              <ListChecks className="size-3" /> Pasos
                            </span>
                            <span className="text-zinc-500">{done}/{total} ({pct}%)</span>
                          </div>
                          <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
                          </div>
                          <div className="space-y-1">
                            {task.subtasks.map(sub => (
                              <label key={sub.id} className="flex items-center gap-2 text-xs cursor-pointer group">
                                <button
                                  type="button"
                                  onClick={() => { store.toggleSubtask(task.id, sub.id); refreshData(); }}
                                  className={`size-4 rounded flex items-center justify-center border transition-colors flex-shrink-0 ${
                                    sub.done
                                      ? 'bg-emerald-600 border-emerald-500 text-white'
                                      : 'border-zinc-600 hover:border-zinc-500 text-transparent'
                                  }`}
                                >
                                  <Check className="size-3" />
                                </button>
                                <span className={sub.done ? 'line-through text-zinc-600' : 'text-zinc-300 group-hover:text-white'}>
                                  {sub.title}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modales ── */}

      {showDailySetup && (
        <DailySetupModal
          onGenerate={handleDailySetup}
          onClose={() => setShowDailySetup(false)}
        />
      )}

      {(showAddTask || editingTask) && (
        <TaskModal
          task={editingTask}
          onSave={handleSaveTask}
          onClose={() => {
            setShowAddTask(false);
            setEditingTask(null);
          }}
        />
      )}

      {(showAddBlock || editingBlock) && (
        <BlockModal
          block={editingBlock}
          tasks={allTasks}
          onSave={handleSaveBlock}
          onClose={() => {
            setShowAddBlock(false);
            setEditingBlock(null);
          }}
        />
      )}

      {showSmartImport && (
        <SmartImportModal
          onImport={handleSmartImport}
          onClose={() => setShowSmartImport(false)}
        />
      )}

      {showClassroom && (
        <ClassroomModal
          connected={classroomConnected}
          onConnectedChange={setClassroomConnected}
          onImport={handleClassroomImport}
          onClose={() => setShowClassroom(false)}
        />
      )}

      {showCalendar && (
        <CalendarModal
          onImport={handleCalendarImport}
          onClose={() => setShowCalendar(false)}
        />
      )}

      {confirmAction && (
        <ConfirmModal
          message={confirmAction.message}
          onConfirm={() => {
            confirmAction.onConfirm();
            setConfirmAction(null);
          }}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}
