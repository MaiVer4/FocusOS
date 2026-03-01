import { useState, useEffect, useRef } from 'react';
import { store } from '../lib/store';
import { notificationService } from '../lib/notifications';
import { Block, Task, TaskStatus, Subtask } from '../lib/types';
import { classifyTasksWithAI, ParsedItem } from '../lib/ai-classifier';
import {
  getBlockColor,
  getBlockLabel,
  getBlockStatusLabel,
  getDifficultyLabel,
  getTaskStatusLabel,
  getTaskStatusColor,
  getCategoryColor,
  formatTo12h,
  addMinutesToTime,
  addMinutesToDatetime,
  durationBetween,
  todayStr,
  formatDateDisplay,
} from '../lib/helpers';
import { Plus, Trash2, CalendarIcon, BookOpen, Clock, Pencil, Sparkles, Loader2, Package, ChevronDown, FolderOpen, ListChecks, Check, GraduationCap, CalendarDays } from 'lucide-react';
import { googleAuth } from '../lib/google-auth';
import { getClassroomPendingTasks, ClassroomTask } from '../lib/google-classroom';
import { getCalendarEvents, CalendarEventItem } from '../lib/google-calendar';
import { googleSync, SyncResult } from '../lib/google-sync';
import { cloudSync } from '../lib/cloud-sync';

export function Planner() {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [allTasks, setAllTasks] = useState<Task[]>([]);
  const [showAddBlock, setShowAddBlock] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [showDailySetup, setShowDailySetup] = useState(false);
  const [activeTab, setActiveTab] = useState<'blocks' | 'tasks'>('blocks');
  const [editingBlock, setEditingBlock] = useState<Block | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [showSmartImport, setShowSmartImport] = useState(false);
  const [smartText, setSmartText] = useState('');
  const [smartItems, setSmartItems] = useState<ParsedItem[] | null>(null);
  const [smartLoading, setSmartLoading] = useState(false);
  const [smartSelected, setSmartSelected] = useState<boolean[]>([]);
  const [showClassroom, setShowClassroom] = useState(false);
  const [classroomTasks, setClassroomTasks] = useState<ClassroomTask[]>([]);
  const [classroomLoading, setClassroomLoading] = useState(false);
  const [classroomError, setClassroomError] = useState<string | null>(null);
  const [classroomConnected, setClassroomConnected] = useState(false);
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEventItem[]>([]);
  const [calendarLoading, setCalendarLoading] = useState(false);
  const [calendarError, setCalendarError] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ message: string; onConfirm: () => void } | null>(null);

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

  // Ref para acceder a refreshData actualizado desde callbacks de cloud sync
  const refreshRef = useRef(refreshData);
  refreshRef.current = refreshData;

  useEffect(() => {
    refreshData();
    setClassroomConnected(googleAuth.isAuthenticated());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate]);

  // ─── Auto-limpieza: eliminar bloques 30 min después de terminar ──────────
  useEffect(() => {
    // Limpiar inmediatamente al montar
    const cleaned = store.cleanExpiredBlocks();
    if (cleaned > 0) refreshData();

    const interval = setInterval(() => {
      const removed = store.cleanExpiredBlocks();
      if (removed > 0) refreshData();
    }, 60_000); // cada 60 segundos

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Auto-Sync con Google ────────────────────────────────────────────────

  useEffect(() => {
    const unsub = googleSync.subscribe((result) => {
      setSyncResult(result);
      if (result.status === 'success' && (result.newTasks > 0 || result.updatedTasks > 0 || result.removedTasks > 0)) {
        refreshData();
      }
      // Actualizar estado de conexión
      setClassroomConnected(googleAuth.isAuthenticated() || googleAuth.wasConnected());
    });

    // Iniciar auto-sync: si el usuario se conectó antes, intentar renovar y sincronizar
    if (googleAuth.isAuthenticated() || googleAuth.wasConnected()) {
      setClassroomConnected(true);
      googleSync.startAutoSync();
    }

    return () => { unsub(); googleSync.stopAutoSync(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Cloud Sync (Firebase) ───────────────────────────────────────────────

  useEffect(() => {
    // Conectar cloud sync si el usuario ya se autenticó con Google
    if (googleAuth.isAuthenticated() || googleAuth.wasConnected()) {
      cloudSync.connect().then(ok => {
        if (ok) console.log('[CloudSync] Sincronización en la nube activa');
      });
    }

    // Escuchar cambios remotos (otro dispositivo escribió en Firestore)
    const unsub = cloudSync.onRemoteChange(() => {
      store.reloadFromStorage();
      refreshRef.current();
    });

    return () => { unsub(); cloudSync.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleManualSync = async () => {
    if (!googleAuth.isAuthenticated()) {
      try {
        // Primera vez: pide consentimiento. Si ya se conectó antes, intenta silencioso.
        const forceConsent = !googleAuth.wasConnected();
        await googleAuth.authenticate(forceConsent);
        setClassroomConnected(true);
        googleSync.startAutoSync();
        cloudSync.connect(); // Activar sync en la nube
      } catch {
        return;
      }
    } else {
      await googleSync.sync();
    }
    refreshData();
  };

  // ─── Daily Setup ──────────────────────────────────────────────────────────────

  const handleDailySetup = () => {
    // Generar rutina diaria desde plantilla
    const templateBlocks = store.generateFromTemplate(selectedDate);

    // Si la plantilla no generó bloques (ya existen), generar para tareas sin asignar
    if (templateBlocks.length === 0) {
      store.generateBlocksFromTasks(selectedDate);
    }

    // Reorganizar para eliminar solapamientos
    store.reorganizeBlocks(selectedDate);

    // Reprogramar notificaciones con horarios finales
    if (notificationService.hasPermission()) {
      store.getBlocks(selectedDate).forEach(b => notificationService.scheduleBlockNotifications(b));
    }

    refreshData();
    setShowDailySetup(false);
  };

  // ─── Add Task ────────────────────────────────────────────────────────────────

  const [newTaskDeliverable, setNewTaskDeliverable] = useState(false);

  const addTask = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const isDeliverable = newTaskDeliverable;
    const dueDateRaw = (fd.get('dueDate') as string ?? '').trim();
    // Para entregables la fecha es obligatoria
    if (isDeliverable && !dueDateRaw) return;
    // Parse subtasks from comma-separated input
    const subtasksRaw = (fd.get('subtasks') as string ?? '').trim();
    const subtasks: Subtask[] = subtasksRaw
      ? subtasksRaw.split('\n').map(s => s.trim()).filter(Boolean).map(title => ({
          id: crypto.randomUUID(),
          title,
          done: false,
        }))
      : [];
    const task: Task = {
      id: crypto.randomUUID(),
      subject: fd.get('subject') as string,
      description: fd.get('description') as string,
      notes: fd.get('notes') as string,
      category: (fd.get('category') as string || '').trim() || undefined,
      subtasks: subtasks.length > 0 ? subtasks : undefined,
      dueDate: dueDateRaw,
      difficulty: fd.get('difficulty') as Task['difficulty'],
      status: 'sin-iniciar',
      isDeliverable,
      createdAt: new Date().toISOString(),
    };
    store.addTask(task);

    // Notificaciones para entregables
    if (task.dueDate && notificationService.hasPermission()) {
      const blockDate = task.dueDate.split('T')[0];
      store.getBlocks(blockDate).forEach(b => {
        notificationService.scheduleBlockNotifications(b);
      });
      if (isDeliverable) {
        notificationService.scheduleDeliverableNotifications(task);
      }
      if (blockDate === selectedDate) setActiveTab('blocks');
    }

    refreshData();
    setShowAddTask(false);
    setNewTaskDeliverable(false);
    form.reset();
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
    // Re-programar notificaciones si es entregable
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

  const saveEditTask = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingTask) return;
    const fd = new FormData(e.currentTarget);
    const isDeliverable = fd.get('isDeliverable') === 'on';
    const newDueDate = (fd.get('dueDate') as string ?? '').trim();
    if (isDeliverable && !newDueDate) return;
    const subtasksRaw = (fd.get('subtasks') as string ?? '').trim();
    // Preserve existing subtask done state when editing
    const existingSubtasks = editingTask.subtasks ?? [];
    let subtasks: Subtask[] | undefined;
    if (subtasksRaw) {
      const newTitles = subtasksRaw.split('\n').map(s => s.trim()).filter(Boolean);
      subtasks = newTitles.map(title => {
        const existing = existingSubtasks.find(s => s.title === title);
        return existing ?? { id: crypto.randomUUID(), title, done: false };
      });
    } else {
      subtasks = undefined;
    }
    const updates: Partial<Task> = {
      subject: fd.get('subject') as string,
      description: fd.get('description') as string,
      notes: fd.get('notes') as string,
      category: (fd.get('category') as string || '').trim() || undefined,
      subtasks,
      dueDate: newDueDate,
      difficulty: fd.get('difficulty') as Task['difficulty'],
      isDeliverable,
    };
    store.updateTask(editingTask.id, updates);

    // Re-programar notificaciones si es entregable
    notificationService.cancelTaskNotifications(editingTask.id);
    if (isDeliverable && notificationService.hasPermission()) {
      const updated = store.getTask(editingTask.id);
      if (updated && updated.status !== 'terminada' && updated.status !== 'aplazada') {
        notificationService.scheduleDeliverableNotifications(updated);
      }
    }

    refreshData();
    setEditingTask(null);
  };

  // ─── Add Block ───────────────────────────────────────────────────────────────

  const addBlock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    const startTime = fd.get('startTime') as string;
    const endTime = fd.get('endTime') as string;
    const duration = durationBetween(startTime, endTime);

    if (duration <= 0) {
      alert('La hora de fin debe ser posterior a la de inicio.');
      return;
    }

    if (store.hasBlockOverlap(selectedDate, startTime, endTime)) {
      alert('El horario se solapa con un bloque existente. Ajusta las horas.');
      return;
    }

    const taskId = fd.get('taskId') as string || undefined;
    const task = taskId ? tasks.find(t => t.id === taskId) : undefined;

    const block: Block = {
      id: crypto.randomUUID(),
      type: fd.get('type') as Block['type'],
      label: (fd.get('label') as string) || undefined,
      priority: fd.get('priority') as Block['priority'],
      taskId,
      task,
      duration,
      startTime,
      endTime,
      status: 'pending',
      date: selectedDate,
      interruptions: 0,
    };

    if (notificationService.hasPermission()) {
      notificationService.scheduleBlockNotifications(block);
    }

    store.addBlock(block);
    refreshData();
    setShowAddBlock(false);
    form.reset();
  };

  const deleteBlock = (id: string) => {
    store.deleteBlock(id);
    refreshData();
  };

  const postponeBlock = (id: string, minutes: number) => {
    const block = store.getBlock(id);
    if (!block || block.status === 'completed' || block.status === 'failed') return;
    const newStart = addMinutesToTime(block.startTime, minutes);
    const newEnd = addMinutesToTime(block.endTime, minutes);
    // No pasar de las 23:59
    if (newEnd > '23:59') return;

    // Extender el bloque anterior para llenar el hueco
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
    // Reorganizar bloques posteriores para eliminar solapamientos
    store.reorganizeBlocks(block.date);
    // Re-programar notificaciones de todos los bloques con horarios actualizados
    if (notificationService.hasPermission()) {
      store.getBlocks(block.date).forEach(b => {
        notificationService.cancelBlockNotifications(b.id);
        notificationService.scheduleBlockNotifications(b);
      });
    }
    refreshData();
  };

  const saveEditBlock = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editingBlock) return;
    const fd = new FormData(e.currentTarget);
    const startTime = fd.get('startTime') as string;
    const endTime = fd.get('endTime') as string;
    const duration = durationBetween(startTime, endTime);

    if (duration <= 0) {
      alert('La hora de fin debe ser posterior a la de inicio.');
      return;
    }

    if (store.hasBlockOverlap(editingBlock.date, startTime, endTime, editingBlock.id)) {
      alert('El horario se solapa con otro bloque existente. Ajusta las horas.');
      return;
    }

    const taskId = fd.get('taskId') as string || undefined;
    const task = taskId ? tasks.find(t => t.id === taskId) : undefined;
    const status = (fd.get('status') as Block['status']) ?? editingBlock.status;

    store.updateBlock(editingBlock.id, {
      type: fd.get('type') as Block['type'],
      label: (fd.get('label') as string) || undefined,
      priority: fd.get('priority') as Block['priority'],
      taskId,
      task,
      startTime,
      endTime,
      duration,
      status,
    });
    refreshData();
    setEditingBlock(null);
  };

  // ─── Render

  // ─── Smart Import ─────────────────────────────────────────────────────

  const handleSmartClassify = async () => {
    if (!smartText.trim()) return;
    setSmartLoading(true);
    try {
      const items = await classifyTasksWithAI(smartText);
      setSmartItems(items);
      setSmartSelected(items.map(() => true));
    } finally {
      setSmartLoading(false);
    }
  };

  // ─── Classroom Import ───────────────────────────────────────────────────────────────

  const handleClassroomImport = async () => {
    setClassroomLoading(true);
    setClassroomError(null);
    setClassroomTasks([]);
    try {
      if (!googleAuth.isAuthenticated()) {
        await googleAuth.authenticate(true);
      }
      setClassroomConnected(true);
      const tasks = await getClassroomPendingTasks();
      if (tasks.length === 0) {
        setClassroomError('No se encontraron tareas pendientes en tus cursos.');
      }
      setClassroomTasks(tasks);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      if (msg.includes('403')) {
        setClassroomError(
          'Permiso denegado. Verifica en Google Cloud Console:\n' +
          '1. Que la API "Google Classroom API" esté habilitada\n' +
          '2. Que los scopes de Classroom estén en la pantalla de consentimiento OAuth\n' +
          '3. Que aceptaste TODOS los permisos en el popup de Google'
        );
      } else {
        setClassroomError(msg);
      }
    } finally {
      setClassroomLoading(false);
    }
  };

  const createClassroomTasks = () => {
    const selected = classroomTasks.filter(t => t.selected);
    if (selected.length === 0) return;

    for (const ct of selected) {
      const task: Task = {
        id: crypto.randomUUID(),
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
    }

    refreshData();
    setShowClassroom(false);
    setClassroomTasks([]);
    setActiveTab('tasks');
  };

  // ─── Google Calendar ──────────────────────────────────────────────────────

  const handleCalendarImport = async () => {
    setCalendarLoading(true);
    setCalendarError(null);
    setCalendarEvents([]);
    try {
      if (!googleAuth.isAuthenticated()) {
        await googleAuth.authenticate(true);
        setClassroomConnected(true);
      }
      const events = await getCalendarEvents();
      if (events.length === 0) {
        setCalendarError('No se encontraron eventos próximos en tu calendario.');
      }
      setCalendarEvents(events);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Error desconocido';
      if (msg.includes('403')) {
        setCalendarError(
          'Permiso denegado. Verifica en Google Cloud Console:\n' +
          '1. Que la API "Google Calendar API" esté habilitada\n' +
          '2. Que el scope calendar.events.readonly esté en la pantalla de consentimiento\n' +
          '3. Que aceptaste TODOS los permisos en el popup de Google'
        );
      } else {
        setCalendarError(msg);
      }
    } finally {
      setCalendarLoading(false);
    }
  };

  const createCalendarItems = () => {
    const selected = calendarEvents.filter(e => e.selected);
    if (selected.length === 0) return;

    for (const ev of selected) {
      const dueDate = ev.isAllDay || !ev.startTime ? ev.date : `${ev.date}T${ev.startTime}`;
      const task: Task = {
        id: crypto.randomUUID(),
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
    }

    refreshData();
    setShowCalendar(false);
    setCalendarEvents([]);
    setActiveTab('tasks');
  };

  const createSmartItems = () => {
    if (!smartItems) return;

    smartItems.forEach((item, idx) => {
      if (!smartSelected[idx]) return;
      const dueDate = item.dueDate ?? selectedDate;
      const task: Task = {
        id: crypto.randomUUID(),
        subject: item.subject,
        description: item.description,
        notes: '',
        dueDate,
        difficulty: item.difficulty,
        status: 'sin-iniciar',
        isDeliverable: item.isDeliverable ?? false,
        createdAt: new Date().toISOString(),
      };
      // store.addTask auto-crea bloque y reorganiza
      store.addTask(task);

      if (task.isDeliverable && notificationService.hasPermission()) {
        notificationService.scheduleDeliverableNotifications(task);
      }
    });

    refreshData();
    setShowSmartImport(false);
    setSmartText('');
    setSmartItems(null);
    setSmartSelected([]);
    setActiveTab('blocks');
  };

  const isToday = selectedDate === todayStr();

  return (
    <div className="p-6 space-y-5 pb-24">
      {/* Header */}
      <div className="space-y-1">
        <h1 className="text-3xl font-bold">Planificador</h1>
        <p className="text-zinc-400 text-sm">
          {isToday ? 'Hoy — ' : ''}{formatDateDisplay(selectedDate, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Sync Status */}
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
          className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
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

      {/* Daily Setup Modal */}
      {showDailySetup && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 max-w-sm w-full space-y-5">
            <div>
              <h3 className="text-xl font-bold">Generar Rutina Diaria</h3>
              <p className="text-zinc-400 text-sm mt-1">
                Se creará tu rutina completa: despertar, estudio, SENA, bloques profundos,
                ejercicio, revisión y descansos. Las tareas se asignarán automáticamente a los bloques de trabajo.
              </p>
            </div>
            <button
              onClick={() => { handleDailySetup(); setShowDailySetup(false); }}
              className="w-full py-4 bg-red-600 hover:bg-red-700 rounded-xl font-bold text-lg transition-all active:scale-95"
            >
              Generar Automáticamente
            </button>
            <button
              onClick={() => setShowDailySetup(false)}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

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
                onClick={() => setShowAddBlock(true)}
                className="p-2 bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
              >
                <Plus className="size-5" />
              </button>
            </div>
          </div>

          {blocks.length === 0 ? (
            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-8 text-center text-zinc-500 space-y-2">
              <CalendarIcon className="size-8 mx-auto opacity-40" />
              <p className="text-sm">Sin bloques para este día</p>
              <p className="text-xs">Toca "Auto" para configuración rápida o "+" para agregar manualmente</p>
            </div>
          ) : (
            <div className="space-y-2">
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
          {/* Header: título + botón agregar */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Tareas</h2>
            <button
              onClick={() => setShowAddTask(true)}
              className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              <Plus className="size-5" />
            </button>
          </div>

          {/* Barra de acciones */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 -mb-1 scrollbar-none">
            <button
              onClick={() => { setClassroomTasks([]); setClassroomError(null); setShowClassroom(true); }}
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
              onClick={() => { setCalendarEvents([]); setCalendarError(null); setShowCalendar(true); }}
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
              onClick={() => { setSmartItems(null); setSmartText(''); setShowSmartImport(true); }}
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
                <div key={task.id} className={`bg-zinc-900 border rounded-xl p-4 space-y-2 ${
                  isOverdue ? 'border-red-600/40' : 'border-zinc-800'
                }`}>
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
                        <span className={`text-xs px-1.5 py-0.5 rounded-full flex items-center gap-0.5 flex-shrink-0 ${getCategoryColor(task.category)}`}>
                          <FolderOpen className="size-3" /> {task.category}
                        </span>
                      )}
                      {task.description && (
                        <div className="text-sm text-zinc-400 mt-0.5 line-clamp-2">{task.description}</div>
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
                    {/* Status dropdown */}
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
                  {/* Subtask progress */}
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

      {/* ── Add Task Modal ── */}
      {showAddTask && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-5">Nueva Tarea</h3>
            <form onSubmit={addTask} className="space-y-4">
              {/* Tipo de tarea */}
              <div>
                <label className="block text-sm text-zinc-400 mb-2">¿Qué tipo de tarea es?</label>
                <div className="flex rounded-xl overflow-hidden border border-zinc-700">
                  <button type="button"
                    onClick={() => setNewTaskDeliverable(true)}
                    className={`flex-1 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                      newTaskDeliverable
                        ? 'bg-purple-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    <Package className="size-4" /> Entregable
                  </button>
                  <button type="button"
                    onClick={() => setNewTaskDeliverable(false)}
                    className={`flex-1 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 ${
                      !newTaskDeliverable
                        ? 'bg-teal-600 text-white'
                        : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    <BookOpen className="size-4" /> Personal / Repaso
                  </button>
                </div>
                <p className="text-xs text-zinc-500 mt-1.5">
                  {newTaskDeliverable
                    ? '📦 Debes entregar una evidencia. Tendrá prioridad máxima con alertas automáticas.'
                    : '📖 Para repasar conceptos o tareas personales. Sin fecha límite obligatoria.'}
                </p>
              </div>

              <div>
                <label className="block text-sm text-zinc-400 mb-2">Materia / Título *</label>
                <input type="text" name="subject" required
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Matemáticas, Proyecto Final..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Descripción</label>
                <textarea name="description" rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Qué hay que hacer..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Notas adicionales</label>
                <textarea name="notes" rows={2}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Recursos, URLs, contexto extra..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Categoría</label>
                <input type="text" name="category"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Java, JavaScript, SQL, React..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Sub-pasos (uno por línea)</label>
                <textarea name="subtasks" rows={3}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder={"Investigar el tema\nHacer la estructura\nCodificar la solución\nProbar y depurar"} />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">
                  {newTaskDeliverable ? 'Fecha y hora de entrega *' : 'Fecha límite (opcional)'}
                </label>
                <input type="datetime-local" name="dueDate"
                  required={newTaskDeliverable}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Dificultad</label>
                <select name="difficulty"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => { setShowAddTask(false); setNewTaskDeliverable(false); }}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition-colors">Agregar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Add Block Modal ── */}
      {showAddBlock && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-5">Nuevo Bloque</h3>
            <form onSubmit={addBlock} className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Nombre (opcional)</label>
                <input type="text" name="label"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Ej: Bloque profundo 1, Descanso..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tipo</label>
                <select name="type"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="deep">Profundo</option>
                  <option value="light">Ligero</option>
                  <option value="exercise">Ejercicio</option>
                  <option value="rest">Descanso</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Prioridad</label>
                <select name="priority"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tarea asociada (opcional)</label>
                <select name="taskId"
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="">Sin tarea</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.subject}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Inicio *</label>
                  <input type="time" name="startTime" required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Fin *</label>
                  <input type="time" name="endTime" required
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500" />
                </div>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowAddBlock(false)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">Cancelar</button>
                <button type="submit"
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-colors">Agregar</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* ── Smart Import Modal ── */}
      {showSmartImport && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">

            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="size-5 text-purple-400" />
              <h3 className="text-xl font-bold">Importar con IA</h3>
            </div>
            <p className="text-zinc-500 text-sm mb-4">
              <span className="text-green-500">DeepSeek · deepseek-chat (V3)</span>
            </p>

            {/* Step 1 — Input */}
            {!smartItems && (
              <div className="space-y-4">
                <textarea
                  rows={7}
                  value={smartText}
                  onChange={e => setSmartText(e.target.value)}
                  placeholder={"Escribe o pega tus tareas, una por línea:\n\nEstudiar capítulo 4 de cálculo\nRevisar emails\nSalir a correr 30 min\nTerminar informe de proyecto\nLlamar al banco"}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                />
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowSmartImport(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleSmartClassify}
                    disabled={smartLoading || !smartText.trim()}
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                  >
                    {smartLoading
                      ? <><Loader2 className="size-4 animate-spin" /> Clasificando...</>
                      : <><Sparkles className="size-4" /> Clasificar</>
                    }
                  </button>
                </div>
              </div>
            )}

            {/* Step 2 — Preview */}
            {smartItems && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-400">
                  {smartSelected.filter(Boolean).length} de {smartItems.length} seleccionadas · desactiva las que no quieras
                </p>

                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {smartItems.map((item, idx) => (
                    <label key={idx}
                      className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        smartSelected[idx]
                          ? item.blockType === 'deep' ? 'bg-red-600/10 border-red-600/30'
                          : item.blockType === 'exercise' ? 'bg-green-600/10 border-green-600/30'
                          : item.blockType === 'light' ? 'bg-blue-600/10 border-blue-600/30'
                          : 'bg-zinc-700/30 border-zinc-600/30'
                          : 'bg-zinc-900 border-zinc-800 opacity-40'
                      }`}
                    >
                      <input type="checkbox" className="mt-0.5 accent-purple-500"
                        checked={smartSelected[idx]}
                        onChange={e => {
                          const next = [...smartSelected];
                          next[idx] = e.target.checked;
                          setSmartSelected(next);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{item.subject}</div>
                        {item.description && (
                          <div className="text-xs text-zinc-400 mt-0.5 line-clamp-1">{item.description}</div>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                            item.blockType === 'deep' ? 'bg-red-600/20 text-red-400'
                            : item.blockType === 'exercise' ? 'bg-green-600/20 text-green-400'
                            : item.blockType === 'light' ? 'bg-blue-600/20 text-blue-400'
                            : 'bg-zinc-600/20 text-zinc-400'
                          }`}>
                            {item.blockType === 'deep' ? 'Profundo'
                            : item.blockType === 'exercise' ? 'Ejercicio'
                            : item.blockType === 'light' ? 'Ligero' : 'Descanso'}
                          </span>
                          <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                            item.difficulty === 'high' ? 'bg-red-600/20 text-red-400'
                            : item.difficulty === 'medium' ? 'bg-yellow-600/20 text-yellow-400'
                            : 'bg-green-600/20 text-green-400'
                          }`}>
                            {item.difficulty === 'high' ? 'Alta' : item.difficulty === 'medium' ? 'Media' : 'Baja'}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700/50 text-zinc-400">
                            {item.estimatedMinutes} min
                          </span>
                          {item.isDeliverable && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 flex items-center gap-0.5">
                              <Package className="size-3" /> Entregable
                            </span>
                          )}
                          {item.dueDate && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400">
                              {item.dueDate.includes('T')
                                ? formatDateDisplay(item.dueDate)
                                : formatDateDisplay(item.dueDate + 'T00:00')}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setSmartItems(null)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    ← Editar
                  </button>
                  <button
                    type="button"
                    onClick={createSmartItems}
                    disabled={smartSelected.every(s => !s)}
                    className="flex-1 py-3 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors"
                  >
                    Crear {smartSelected.filter(Boolean).length} tarea{smartSelected.filter(Boolean).length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Task Modal ── */}
      {editingTask && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-1">Editar Tarea</h3>
            <p className="text-zinc-500 text-sm mb-5">
              {editingTask.subject} · {editingTask.isDeliverable ? 'Entregable' : 'Personal'}
            </p>
            <form onSubmit={saveEditTask} className="space-y-4">
              {/* Tipo de tarea */}
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tipo de tarea</label>
                <div className="flex rounded-xl overflow-hidden border border-zinc-700">
                  <label className={`flex-1 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer ${
                    'peer-checked:bg-purple-600'
                  }`}>
                    <input type="radio" name="isDeliverable" value="on" defaultChecked={editingTask.isDeliverable ?? false}
                      className="sr-only peer" />
                    <span className="flex items-center gap-1.5 peer-checked:text-white">
                      <Package className="size-4" /> Entregable
                    </span>
                  </label>
                  <label className="flex-1 py-3 text-sm font-semibold transition-colors flex items-center justify-center gap-1.5 cursor-pointer">
                    <input type="radio" name="isDeliverable" value="off" defaultChecked={!(editingTask.isDeliverable ?? false)}
                      className="sr-only peer" />
                    <span className="flex items-center gap-1.5 peer-checked:text-white">
                      <BookOpen className="size-4" /> Personal
                    </span>
                  </label>
                </div>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Materia / Título *</label>
                <input type="text" name="subject" required defaultValue={editingTask.subject}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Descripción</label>
                <textarea name="description" rows={2} defaultValue={editingTask.description}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Notas adicionales</label>
                <textarea name="notes" rows={2} defaultValue={editingTask.notes ?? ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Categoría</label>
                <input type="text" name="category" defaultValue={editingTask.category ?? ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Ej: Java, JavaScript, SQL, React..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Sub-pasos (uno por línea)</label>
                <textarea name="subtasks" rows={3}
                  defaultValue={editingTask.subtasks?.map(s => s.title).join('\n') ?? ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                  placeholder={"Investigar el tema\nHacer la estructura\nCodificar la solución\nProbar y depurar"} />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Fecha límite</label>
                <input type="datetime-local" name="dueDate" defaultValue={editingTask.dueDate}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 [color-scheme:dark]" />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Dificultad</label>
                <select name="difficulty" defaultValue={editingTask.difficulty}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="low">Baja</option>
                  <option value="medium">Media</option>
                  <option value="high">Alta</option>
                </select>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingTask(null)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">
                  Cancelar
                </button>
                <button type="submit"
                  className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold transition-colors">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Edit Block Modal ── */}
      {editingBlock && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-1">Editar Bloque</h3>
            <p className="text-zinc-500 text-sm mb-5">
              {editingBlock.label || getBlockLabel(editingBlock.type)} · {formatTo12h(editingBlock.startTime)}–{formatTo12h(editingBlock.endTime)}
            </p>
            <form onSubmit={saveEditBlock} className="space-y-4">
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Nombre</label>
                <input type="text" name="label" defaultValue={editingBlock.label ?? ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  placeholder="Ej: Bloque profundo 1..." />
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tipo</label>
                <select name="type" defaultValue={editingBlock.type}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="deep">Profundo</option>
                  <option value="light">Ligero</option>
                  <option value="exercise">Ejercicio</option>
                  <option value="rest">Descanso</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Prioridad</label>
                <select name="priority" defaultValue={editingBlock.priority}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="high">Alta</option>
                  <option value="medium">Media</option>
                  <option value="low">Baja</option>
                </select>
              </div>
              <div>
                <label className="block text-sm text-zinc-400 mb-2">Tarea asociada</label>
                <select name="taskId" defaultValue={editingBlock.taskId ?? ''}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500">
                  <option value="">Sin tarea</option>
                  {tasks.map((task) => (
                    <option key={task.id} value={task.id}>{task.subject}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Inicio *</label>
                  <input type="time" name="startTime" required defaultValue={editingBlock.startTime}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]" />
                </div>
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Hora Fin *</label>
                  <input type="time" name="endTime" required defaultValue={editingBlock.endTime}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500 [color-scheme:dark]" />
                </div>
              </div>
              {editingBlock.status !== 'pending' && (
                <div>
                  <label className="block text-sm text-zinc-400 mb-2">Estado</label>
                  <select name="status" defaultValue={editingBlock.status}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="pending">Pendiente</option>
                    <option value="active">Activo</option>
                    <option value="completed">Completado</option>
                    <option value="failed">Fallado</option>
                  </select>
                </div>
              )}
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setEditingBlock(null)}
                  className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold transition-colors">
                  Cancelar
                </button>
                <button type="submit"
                  className="flex-1 py-3 bg-red-600 hover:bg-red-700 rounded-xl font-semibold transition-colors">
                  Guardar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Classroom Import Modal ── */}
      {showClassroom && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">

            <div className="flex items-center gap-2 mb-1">
              <GraduationCap className="size-5 text-green-400" />
              <h3 className="text-xl font-bold">Google Classroom</h3>
            </div>

            {/* Estado de conexión */}
            <div className={`flex items-center justify-between rounded-xl px-3 py-2 mb-4 ${
              classroomConnected
                ? 'bg-green-900/20 border border-green-800/30'
                : 'bg-zinc-800 border border-zinc-700'
            }`}>
              <div className="flex items-center gap-2">
                <span className={`size-2.5 rounded-full ${classroomConnected ? 'bg-green-400 animate-pulse' : 'bg-red-400'}`} />
                <span className={`text-sm font-medium ${classroomConnected ? 'text-green-400' : 'text-zinc-400'}`}>
                  {classroomConnected ? 'Conectado' : 'Desconectado'}
                </span>
              </div>
              {classroomConnected && (
                <button
                  type="button"
                  onClick={() => { googleAuth.signOut(); setClassroomConnected(false); }}
                  className="text-xs text-zinc-500 hover:text-red-400 transition-colors"
                >
                  Desconectar
                </button>
              )}
            </div>

            {/* Sin datos cargados todavía */}
            {classroomTasks.length === 0 && !classroomLoading && !classroomError && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-400">
                  {classroomConnected
                    ? 'Obtén tus tareas pendientes de Classroom.'
                    : 'Conectá tu cuenta de Google para traer las tareas de Classroom automáticamente.'}
                </p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowClassroom(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleClassroomImport}
                    className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                    <GraduationCap className="size-4" /> {classroomConnected ? 'Obtener tareas' : 'Conectar'}
                  </button>
                </div>
              </div>
            )}

            {/* Cargando */}
            {classroomLoading && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="size-8 animate-spin text-green-400" />
                <p className="text-sm text-zinc-400">Obteniendo tareas de Classroom...</p>
              </div>
            )}

            {/* Error */}
            {classroomError && (
              <div className="space-y-4">
                <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-4">
                  <p className="text-sm text-red-400 whitespace-pre-line">{classroomError}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    googleAuth.signOut();
                    setClassroomConnected(false);
                    setClassroomError(null);
                    setClassroomTasks([]);
                  }}
                  className="w-full py-2.5 bg-orange-900/30 hover:bg-orange-800/40 text-orange-400 rounded-xl text-sm font-semibold transition-colors"
                >
                  Desconectar cuenta de Google
                </button>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowClassroom(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cerrar
                  </button>
                  <button type="button" onClick={handleClassroomImport}
                    className="flex-1 py-3 bg-green-600 hover:bg-green-700 rounded-xl font-semibold text-sm transition-colors">
                    Reintentar
                  </button>
                </div>
              </div>
            )}

            {/* Lista de tareas */}
            {classroomTasks.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-400">
                  {classroomTasks.filter(t => t.selected).length} de {classroomTasks.length} seleccionadas
                </p>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {classroomTasks.map((ct, idx) => (
                    <label key={ct.courseworkId}
                      className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        ct.selected
                          ? 'bg-green-600/10 border-green-600/30'
                          : 'bg-zinc-900 border-zinc-800 opacity-40'
                      }`}
                    >
                      <input type="checkbox" className="mt-0.5 accent-green-500"
                        checked={ct.selected}
                        onChange={e => {
                          const next = [...classroomTasks];
                          next[idx] = { ...next[idx], selected: e.target.checked };
                          setClassroomTasks(next);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{ct.title}</div>
                        {ct.description && (
                          <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{ct.description}</div>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-600/20 text-green-400">
                            {ct.courseName}
                          </span>
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-purple-600/20 text-purple-400 flex items-center gap-0.5">
                            <Package className="size-3" /> Entregable
                          </span>
                          {ct.assignedDate && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300">
                              Asignada: {formatDateDisplay(ct.assignedDate)}
                            </span>
                          )}
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400 flex items-center gap-0.5">
                            <Clock className="size-3" /> Entrega: {ct.dueDate.includes('T')
                              ? formatDateDisplay(ct.dueDate)
                              : formatDateDisplay(ct.dueDate + 'T00:00')}
                          </span>
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowClassroom(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={createClassroomTasks}
                    disabled={classroomTasks.every(t => !t.selected)}
                    className="flex-1 py-3 bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors">
                    Importar {classroomTasks.filter(t => t.selected).length} tarea{classroomTasks.filter(t => t.selected).length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Google Calendar Modal ── */}
      {showCalendar && (
        <div className="fixed inset-0 bg-black/80 flex items-end sm:items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 w-full max-w-sm max-h-[92vh] overflow-y-auto">

            <div className="flex items-center gap-2 mb-4">
              <CalendarDays className="size-5 text-blue-400" />
              <h3 className="text-xl font-bold">Google Calendar</h3>
            </div>

            {/* Sin datos cargados */}
            {calendarEvents.length === 0 && !calendarLoading && !calendarError && (
              <div className="space-y-4">
                <p className="text-sm text-zinc-400">
                  Importa tus próximos eventos de Google Calendar como tareas.
                </p>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowCalendar(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={handleCalendarImport}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm transition-colors flex items-center justify-center gap-2">
                    <CalendarDays className="size-4" /> Obtener eventos
                  </button>
                </div>
              </div>
            )}

            {/* Cargando */}
            {calendarLoading && (
              <div className="flex flex-col items-center gap-3 py-8">
                <Loader2 className="size-8 animate-spin text-blue-400" />
                <p className="text-sm text-zinc-400">Obteniendo eventos del calendario...</p>
              </div>
            )}

            {/* Error */}
            {calendarError && (
              <div className="space-y-4">
                <div className="bg-red-900/20 border border-red-800/30 rounded-xl p-4">
                  <p className="text-sm text-red-400 whitespace-pre-line">{calendarError}</p>
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setShowCalendar(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cerrar
                  </button>
                  <button type="button" onClick={handleCalendarImport}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 rounded-xl font-semibold text-sm transition-colors">
                    Reintentar
                  </button>
                </div>
              </div>
            )}

            {/* Lista de eventos */}
            {calendarEvents.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm text-zinc-400">
                  {calendarEvents.filter(e => e.selected).length} de {calendarEvents.length} seleccionados
                </p>

                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {calendarEvents.map((ev, idx) => (
                    <label key={ev.id}
                      className={`flex gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                        ev.selected
                          ? 'bg-blue-600/10 border-blue-600/30'
                          : 'bg-zinc-900 border-zinc-800 opacity-40'
                      }`}
                    >
                      <input type="checkbox" className="mt-0.5 accent-blue-500"
                        checked={ev.selected}
                        onChange={e => {
                          const next = [...calendarEvents];
                          next[idx] = { ...next[idx], selected: e.target.checked };
                          setCalendarEvents(next);
                        }}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm truncate">{ev.title}</div>
                        {ev.description && (
                          <div className="text-xs text-zinc-400 mt-0.5 line-clamp-2">{ev.description}</div>
                        )}
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-600/20 text-blue-400">
                            {ev.date}
                          </span>
                          {ev.isAllDay ? (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-600/20 text-amber-400">
                              Todo el día
                            </span>
                          ) : (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-cyan-600/20 text-cyan-400 flex items-center gap-0.5">
                              <Clock className="size-3" /> {formatTo12h(ev.startTime)} – {formatTo12h(ev.endTime)}
                            </span>
                          )}
                          {ev.location && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-300 truncate max-w-32">
                              📍 {ev.location}
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  ))}
                </div>

                <div className="flex gap-3 pt-1">
                  <button type="button" onClick={() => setShowCalendar(false)}
                    className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors">
                    Cancelar
                  </button>
                  <button type="button" onClick={createCalendarItems}
                    disabled={calendarEvents.every(e => !e.selected)}
                    className="flex-1 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-xl font-semibold text-sm transition-colors">
                    Importar {calendarEvents.filter(e => e.selected).length} tarea{calendarEvents.filter(e => e.selected).length !== 1 ? 's' : ''}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      {/* ── Confirm Dialog ── */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl p-6 max-w-sm w-full space-y-4">
            <p className="text-sm text-zinc-200 text-center">{confirmAction.message}</p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={() => { confirmAction.onConfirm(); setConfirmAction(null); }}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 rounded-xl font-semibold text-sm transition-colors"
              >
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
