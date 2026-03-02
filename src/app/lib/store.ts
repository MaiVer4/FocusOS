import { Block, BlockType, BlockPriority, Task, TaskStatus, DailyMetrics, UserSettings } from './types';
import { addMinutesToTime, dateToStr, durationBetween, todayStr } from './helpers';
import { cloudSync } from './cloud-sync';

const STORAGE_KEYS = {
  tasks: 'focusos_tasks',
  blocks: 'focusos_blocks',
  metrics: 'focusos_metrics',
  settings: 'focusos_settings',
} as const;

const DEFAULT_SETTINGS: UserSettings = {
  appName: 'FocusOS',
  wakeTime: '07:00',
  sleepTime: '23:00',
  scheduleStartTime: '08:00',
  scheduleEndTime: '18:00',
  arrivalTime: '18:30',
  peakEnergyTime: 'morning',
  dailyDeepBlocksMin: 1,
  dailyDeepBlocksMax: 3,
  deepBlockDuration: 60,
  exerciseMandatory: true,
  exerciseDuration: 30,
  socialMediaMaxMinutes: 30,
};

// ─── Plantillas de rutina diaria ─────────────────────────────────────────────

type TemplateBlock = {
  type: BlockType;
  label: string;
  startTime: string;
  endTime: string;
  priority: BlockPriority;
  assignTask?: boolean;
};

/** Lunes a Viernes — Día SENA */
const WEEKDAY_TEMPLATE: TemplateBlock[] = [
  { type: 'rest',     label: 'Despertar y rutina matutina', startTime: '08:30', endTime: '08:50', priority: 'low' },
  { type: 'rest',     label: 'Desayuno',                    startTime: '09:00', endTime: '09:20', priority: 'low' },
  { type: 'rest',     label: 'Preparar escritorio',          startTime: '09:20', endTime: '09:30', priority: 'medium' },
  { type: 'light',    label: 'Estudio ligero',               startTime: '09:30', endTime: '10:30', priority: 'medium', assignTask: true },
  { type: 'rest',     label: 'Tiempo libre (redes)',          startTime: '10:30', endTime: '11:00', priority: 'low' },
  { type: 'rest',     label: 'Vestirse y prepararse',         startTime: '11:00', endTime: '11:15', priority: 'low' },
  { type: 'rest',     label: 'Transporte al SENA',            startTime: '11:15', endTime: '12:00', priority: 'low' },
  { type: 'light',    label: 'SENA – Clases',                startTime: '12:00', endTime: '18:00', priority: 'high' },
  { type: 'rest',     label: 'Llegada y cena',               startTime: '18:30', endTime: '19:30', priority: 'low' },
  { type: 'deep',     label: 'Bloque profundo 1',             startTime: '19:30', endTime: '20:10', priority: 'high', assignTask: true },
  { type: 'rest',     label: 'Descanso',                     startTime: '20:10', endTime: '20:20', priority: 'low' },
  { type: 'deep',     label: 'Bloque profundo 2',             startTime: '20:20', endTime: '21:00', priority: 'high', assignTask: true },
  { type: 'rest',     label: 'Descanso corto',               startTime: '21:00', endTime: '21:10', priority: 'low' },
  { type: 'deep',     label: 'Bloque profundo 3',             startTime: '21:10', endTime: '21:30', priority: 'high', assignTask: true },
  { type: 'exercise', label: 'Ejercicio',                    startTime: '21:30', endTime: '22:10', priority: 'high' },
  { type: 'rest',     label: 'Ducha',                        startTime: '22:10', endTime: '22:30', priority: 'low' },
  { type: 'light',    label: 'Revisión y documentación',      startTime: '22:30', endTime: '23:00', priority: 'medium', assignTask: true },
  { type: 'rest',     label: 'Redes sociales',               startTime: '23:00', endTime: '23:15', priority: 'low' },
  { type: 'rest',     label: 'Prepararse para dormir',        startTime: '23:15', endTime: '23:45', priority: 'low' },
];

/** Sábado — Proyecto personal */
const SATURDAY_TEMPLATE: TemplateBlock[] = [
  { type: 'rest',     label: 'Despertar',                     startTime: '09:00', endTime: '09:30', priority: 'low' },
  { type: 'rest',     label: 'Desayuno tranquilo',            startTime: '09:30', endTime: '10:00', priority: 'low' },
  { type: 'deep',     label: 'Proyecto personal – Bloque 1',  startTime: '10:00', endTime: '11:00', priority: 'high', assignTask: true },
  { type: 'rest',     label: 'Descanso',                     startTime: '11:00', endTime: '11:10', priority: 'low' },
  { type: 'deep',     label: 'Proyecto personal – Bloque 2',  startTime: '11:10', endTime: '12:00', priority: 'high', assignTask: true },
  { type: 'rest',     label: 'Almuerzo y descanso',           startTime: '12:00', endTime: '13:00', priority: 'low' },
  { type: 'rest',     label: 'Tiempo libre',                  startTime: '13:00', endTime: '18:00', priority: 'low' },
  { type: 'exercise', label: 'Ejercicio',                    startTime: '18:00', endTime: '19:00', priority: 'high' },
  { type: 'rest',     label: 'Ducha y cena',                  startTime: '19:00', endTime: '19:45', priority: 'low' },
  { type: 'rest',     label: 'Tiempo libre moderado',         startTime: '19:45', endTime: '23:00', priority: 'low' },
  { type: 'rest',     label: 'Prepararse para dormir',        startTime: '23:00', endTime: '23:30', priority: 'low' },
];

/** Domingo — Organización */
const SUNDAY_TEMPLATE: TemplateBlock[] = [
  { type: 'rest',     label: 'Despertar y mañana libre',      startTime: '09:00', endTime: '12:00', priority: 'low' },
  { type: 'rest',     label: 'Almuerzo',                      startTime: '12:00', endTime: '13:00', priority: 'low' },
  { type: 'rest',     label: 'Tiempo libre',                  startTime: '13:00', endTime: '17:00', priority: 'low' },
  { type: 'light',    label: 'Planear semana – entregas y prioridades', startTime: '17:00', endTime: '18:00', priority: 'high', assignTask: true },
  { type: 'exercise', label: 'Ejercicio ligero',              startTime: '18:00', endTime: '18:30', priority: 'medium' },
  { type: 'rest',     label: 'Descanso',                      startTime: '18:30', endTime: '19:00', priority: 'low' },
  { type: 'rest',     label: 'Ducha y cena',                  startTime: '19:00', endTime: '19:45', priority: 'low' },
  { type: 'rest',     label: 'Tiempo libre (relajarse)',       startTime: '19:45', endTime: '22:00', priority: 'low' },
  { type: 'rest',     label: 'Prepararse para dormir temprano', startTime: '22:00', endTime: '22:30', priority: 'low' },
];

/** Retorna la plantilla adecuada según el día de la semana (0=dom … 6=sáb) */
function getTemplateForDay(dayOfWeek: number): TemplateBlock[] {
  if (dayOfWeek === 6) return SATURDAY_TEMPLATE;
  if (dayOfWeek === 0) return SUNDAY_TEMPLATE;
  return WEEKDAY_TEMPLATE;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

const CLOUD_COLLECTIONS: Record<string, string> = {
  [STORAGE_KEYS.tasks]: 'tasks',
  [STORAGE_KEYS.blocks]: 'blocks',
  [STORAGE_KEYS.metrics]: 'metrics',
  [STORAGE_KEYS.settings]: 'settings',
};

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Subir a Firebase Cloud
    const collection = CLOUD_COLLECTIONS[key];
    if (collection) cloudSync.uploadDebounced(collection, value);
  } catch (e) {
    console.error(`Error saving ${key} to localStorage:`, e);
  }
}

class Store {
  private tasks: Task[] = loadFromStorage<Task[]>(STORAGE_KEYS.tasks, []);
  private blocks: Block[] = loadFromStorage<Block[]>(STORAGE_KEYS.blocks, []);
  private metrics: DailyMetrics[] = loadFromStorage<DailyMetrics[]>(STORAGE_KEYS.metrics, []);
  private settings: UserSettings = { ...DEFAULT_SETTINGS, ...loadFromStorage<Partial<UserSettings>>(STORAGE_KEYS.settings, {}) };

  constructor() {
    this.migrateTaskStatuses();
    // Persist merged settings so new default fields get saved
    saveToStorage(STORAGE_KEYS.settings, this.settings);
  }

  /** Migra status antiguos (pending/in-progress/completed) a los nuevos */
  private migrateTaskStatuses(): void {
    const statusMap: Record<string, TaskStatus> = {
      'pending': 'sin-iniciar',
      'in-progress': 'en-progreso',
      'completed': 'terminada',
    };
    let changed = false;
    this.tasks = this.tasks.map(t => {
      const mapped = statusMap[t.status as string];
      if (mapped) {
        changed = true;
        return { ...t, status: mapped };
      }
      return t;
    });
    if (changed) saveToStorage(STORAGE_KEYS.tasks, this.tasks);
  }

  // ─── Cloud Sync ────────────────────────────────────────────────────────────

  private listeners: Array<() => void> = [];

  /** Suscribe a cambios en el store (para refresco desde sync remoto) */
  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notifyListeners(): void {
    this.listeners.forEach(fn => fn());
  }

  /** Recarga datos desde localStorage (usado cuando cloud sync actualiza localStorage) */
  reloadFromStorage(): void {
    this.tasks = loadFromStorage<Task[]>(STORAGE_KEYS.tasks, []);
    this.blocks = loadFromStorage<Block[]>(STORAGE_KEYS.blocks, []);
    this.metrics = loadFromStorage<DailyMetrics[]>(STORAGE_KEYS.metrics, []);
    this.settings = { ...DEFAULT_SETTINGS, ...loadFromStorage<Partial<UserSettings>>(STORAGE_KEYS.settings, {}) };
    this.notifyListeners();
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  getTasks(): Task[] {
    return this.tasks;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find(t => t.id === id);
  }

  /** Busca una tarea por su ID externo (Classroom/Calendar) */
  findTaskByExternalId(externalId: string): Task | undefined {
    return this.tasks.find(t => t.externalId === externalId);
  }

  /** Obtiene todas las tareas importadas de una fuente específica */
  getTasksBySource(source: 'classroom' | 'calendar' | 'manual'): Task[] {
    return this.tasks.filter(t => t.source === source);
  }

  addTask(task: Task): void {
    this.tasks = [...this.tasks, task];
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    this.autoAssignBlock(task);
  }

  /**
   * Crea automáticamente un bloque para la tarea si:
   * - La tarea tiene fecha (dueDate)
   * - Ya existen bloques para ese día (la rutina fue generada)
   * - La tarea no tiene ya un bloque asignado
   * Luego reorganiza todos los bloques del día.
   */
  private autoAssignBlock(task: Task): void {
    if (!task.dueDate || task.status === 'terminada') return;

    const blockDate = task.dueDate.split('T')[0];
    const existingBlocks = this.getBlocks(blockDate);

    // Solo auto-crear si ya hay bloques ese día (la rutina fue generada)
    if (existingBlocks.length === 0) return;

    // Verificar que no tenga ya un bloque
    if (existingBlocks.some(b => b.taskId === task.id)) return;

    const duration = task.difficulty === 'high' ? 90
      : task.difficulty === 'medium' ? 60 : 45;
    const priority = task.isDeliverable || task.difficulty === 'high' ? 'high'
      : task.difficulty === 'medium' ? 'medium' : 'low';

    const freeSlot = this.findNextFreeSlot(blockDate, duration, this.settings.arrivalTime);
    const startTime = freeSlot ?? this.settings.arrivalTime;
    const endTime = addMinutesToTime(startTime, duration);

    const block: Block = {
      id: crypto.randomUUID(),
      type: 'deep',
      priority,
      taskId: task.id,
      task,
      duration,
      startTime,
      endTime,
      status: 'pending',
      date: blockDate,
      interruptions: 0,
    };
    this.addBlock(block);
    this.reorganizeBlocks(blockDate);
  }

  updateTask(id: string, updates: Partial<Task>): void {
    const oldTask = this.tasks.find(t => t.id === id);
    const oldDate = oldTask?.dueDate?.split('T')[0];

    this.tasks = this.tasks.map(t => t.id === id ? { ...t, ...updates } : t);
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);

    const updatedTask = this.tasks.find(t => t.id === id);
    const newDate = updatedTask?.dueDate?.split('T')[0];

    // Update embedded task references in blocks
    this.blocks = this.blocks.map(b =>
      b.taskId === id ? { ...b, task: updatedTask } : b
    );
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);

    // Si cambió la fecha, mover el bloque al nuevo día
    if (oldDate && newDate && oldDate !== newDate) {
      const taskBlock = this.blocks.find(b => b.taskId === id && b.date === oldDate);
      if (taskBlock) {
        // Mover bloque al nuevo día
        this.blocks = this.blocks.map(b =>
          b.id === taskBlock.id ? { ...b, date: newDate } : b
        );
        saveToStorage(STORAGE_KEYS.blocks, this.blocks);
        this.reorganizeBlocks(oldDate);
        this.reorganizeBlocks(newDate);
      } else if (updatedTask) {
        // No tenía bloque, intentar asignar en el nuevo día
        this.autoAssignBlock(updatedTask);
      }
    } else if (newDate) {
      // Misma fecha: si cambió dificultad, ajustar duración del bloque
      if (updates.difficulty && oldTask && updates.difficulty !== oldTask.difficulty) {
        const newDuration = updates.difficulty === 'high' ? 90
          : updates.difficulty === 'medium' ? 60 : 45;
        const newPriority = (updatedTask?.isDeliverable || updates.difficulty === 'high') ? 'high'
          : updates.difficulty === 'medium' ? 'medium' : 'low';
        const taskBlock = this.blocks.find(b => b.taskId === id && b.date === newDate);
        if (taskBlock) {
          this.blocks = this.blocks.map(b =>
            b.id === taskBlock.id ? {
              ...b,
              duration: newDuration,
              endTime: addMinutesToTime(b.startTime, newDuration),
              priority: newPriority,
            } : b
          );
          saveToStorage(STORAGE_KEYS.blocks, this.blocks);
          this.reorganizeBlocks(newDate);
        }
      }

      // Si no tenía bloque, intentar asignar
      if (updatedTask && !this.blocks.some(b => b.taskId === id)) {
        this.autoAssignBlock(updatedTask);
      }
    }

    // Si se marcó como terminada, reorganizar
    if (updates.status === 'terminada' && newDate) {
      this.reorganizeBlocks(newDate);
    }
  }

  deleteTask(id: string): void {
    // Encontrar las fechas afectadas antes de eliminar
    const affectedDates = new Set(
      this.blocks.filter(b => b.taskId === id).map(b => b.date)
    );

    this.tasks = this.tasks.filter(t => t.id !== id);
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);

    // Desvincular la tarea de sus bloques
    this.blocks = this.blocks.map(b =>
      b.taskId === id ? { ...b, taskId: undefined, task: undefined } : b
    );
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);

    // Reasignar tareas sin bloque y reorganizar para cada día afectado
    for (const date of affectedDates) {
      this.assignUnblockedTasks(date);
      this.reorganizeBlocks(date);
    }
  }

  /**
   * Busca tareas del día que no tienen bloque asignado y las asigna
   * a bloques libres (sin tarea) del mismo día.
   */
  private assignUnblockedTasks(date: string): void {
    const dayBlocks = this.getBlocks(date);
    const tasksWithBlocks = new Set(
      dayBlocks.filter(b => b.taskId).map(b => b.taskId!)
    );
    const dayTasks = this.getTasksForDayWithCarryOver(date)
      .filter(t => !tasksWithBlocks.has(t.id) && t.status !== 'terminada');

    // Bloques libres (sin tarea, pendientes, de tipo deep/light)
    const freeBlocks = dayBlocks.filter(
      b => !b.taskId && b.status === 'pending' && (b.type === 'deep' || b.type === 'light')
    );

    const toAssign = Math.min(dayTasks.length, freeBlocks.length);
    for (let i = 0; i < toAssign; i++) {
      const block = freeBlocks[i];
      const task = dayTasks[i];
      this.blocks = this.blocks.map(b =>
        b.id === block.id ? { ...b, taskId: task.id, task } : b
      );
    }
    if (toAssign > 0) {
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    }
  }

  toggleSubtask(taskId: string, subtaskId: string): void {
    const task = this.tasks.find(t => t.id === taskId);
    if (!task || !task.subtasks) return;
    const subtasks = task.subtasks.map(s =>
      s.id === subtaskId ? { ...s, done: !s.done } : s
    );
    this.updateTask(taskId, { subtasks });
  }

  /** Tareas que vencen en una fecha específica */
  getTasksForDate(date: string): Task[] {
    return this.tasks.filter(t => {
      if (!t.dueDate) return false; // tareas sin fecha no se asignan a un día
      const taskDate = t.dueDate.split('T')[0];
      return taskDate === date;
    });
  }

  /** Tareas sin fecha de entrega (personales/repaso) */
  getTasksWithoutDate(): Task[] {
    return this.tasks.filter(t => !t.dueDate && t.status !== 'terminada');
  }

  /** Tareas vencidas (fecha pasada) que no están terminadas ni aplazadas */
  getOverdueTasks(date: string): Task[] {
    return this.tasks.filter(t => {
      if (!t.dueDate) return false;
      const taskDate = t.dueDate.split('T')[0];
      return taskDate < date && t.status !== 'terminada' && t.status !== 'aplazada';
    });
  }

  /**
   * Devuelve las tareas del día + tareas vencidas arrastradas,
   * ordenadas: entregables primero, luego por dificultad desc.
   */
  getTasksForDayWithCarryOver(date: string): Task[] {
    const dateTasks = this.getTasksForDate(date);
    const overdue = this.getOverdueTasks(date);
    // Deduplicar por ID
    const seen = new Set<string>();
    const all: Task[] = [];
    for (const t of [...overdue, ...dateTasks]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        all.push(t);
      }
    }
    // Orden: entregables > dificultad alta > media > baja
    const diffOrder = { high: 0, medium: 1, low: 2 };
    return all.sort((a, b) => {
      if (a.isDeliverable && !b.isDeliverable) return -1;
      if (!a.isDeliverable && b.isDeliverable) return 1;
      return diffOrder[a.difficulty] - diffOrder[b.difficulty];
    });
  }

  /**
   * Comprueba si un rango horario solapa con algún bloque existente.
   * Excluye el bloque con `excludeId` (útil al editar).
   */
  hasBlockOverlap(date: string, startTime: string, endTime: string, excludeId?: string): boolean {
    const blocks = this.getBlocks(date).filter(b => !excludeId || b.id !== excludeId);
    return blocks.some(b => startTime < b.endTime && endTime > b.startTime);
  }

  /**
   * Busca el siguiente hueco libre de al menos `duration` minutos a partir de `fromTime`.
   * Devuelve el startTime del hueco o null si no cabe antes de las 23:59.
   */
  findNextFreeSlot(date: string, duration: number, fromTime: string): string | null {
    const blocks = this.getBlocks(date).sort((a, b) => a.startTime.localeCompare(b.startTime));
    let candidate = fromTime;

    for (const b of blocks) {
      // Si el candidato + duración cabe antes del inicio de este bloque, encontramos hueco
      const candidateEnd = addMinutesToTime(candidate, duration);
      if (candidateEnd <= b.startTime) return candidate;
      // Si el bloque termina después del candidato, saltar al final del bloque + 5 min gap
      if (b.endTime > candidate) candidate = addMinutesToTime(b.endTime, 5);
    }

    // Verificar si cabe después de todos los bloques
    const finalEnd = addMinutesToTime(candidate, duration);
    if (finalEnd <= '23:59') return candidate;
    return null;
  }

  /**
   * Auto-genera bloques para tareas sin bloque asignado en la fecha dada.
   * Devuelve los bloques creados.
   */
  generateBlocksFromTasks(date: string): Block[] {
    const tasks = this.getTasksForDayWithCarryOver(date);
    const existingBlocks = this.getBlocks(date);
    const tasksWithBlocks = new Set(
      existingBlocks.filter(b => b.taskId).map(b => b.taskId!)
    );
    const unassigned = tasks.filter(
      t => !tasksWithBlocks.has(t.id) && t.status !== 'terminada'
    );

    if (unassigned.length === 0) return [];

    const newBlocks: Block[] = [];

    for (const task of unassigned) {
      const duration = task.difficulty === 'high' ? 90
        : task.difficulty === 'medium' ? 60 : 45;

      const startTime = this.findNextFreeSlot(date, duration, this.settings.arrivalTime);
      if (!startTime) continue; // no hay hueco disponible

      const endTime = addMinutesToTime(startTime, duration);
      const priority = task.isDeliverable || task.difficulty === 'high'
        ? 'high'
        : task.difficulty === 'medium' ? 'medium' : 'low';

      const block: Block = {
        id: crypto.randomUUID(),
        type: 'deep',
        priority,
        taskId: task.id,
        task,
        duration,
        startTime,
        endTime,
        status: 'pending',
        date,
        interruptions: 0,
      };
      this.addBlock(block);
      newBlocks.push(block);
    }

    return newBlocks;
  }

  /**
   * Genera la rutina diaria desde la plantilla adecuada según el día de la semana.
   * Sáb → proyecto personal · Dom → organización · Lun–Vie → SENA.
   * Asigna tareas pendientes a los bloques marcados.
   * No duplica si ya existen bloques para esa fecha.
   */
  generateFromTemplate(date: string): Block[] {
    const existing = this.getBlocks(date);
    if (existing.length > 0) return [];

    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const template = getTemplateForDay(dayOfWeek);

    const tasks = this.getTasksForDayWithCarryOver(date);
    const taskQueue = [...tasks];
    const newBlocks: Block[] = [];

    for (const tmpl of template) {
      const duration = durationBetween(tmpl.startTime, tmpl.endTime);
      let taskId: string | undefined;
      let task: Task | undefined;

      if (tmpl.assignTask && taskQueue.length > 0) {
        task = taskQueue.shift()!;
        taskId = task.id;
      }

      const block: Block = {
        id: crypto.randomUUID(),
        type: tmpl.type,
        label: tmpl.label,
        priority: tmpl.priority,
        taskId,
        task,
        duration,
        startTime: tmpl.startTime,
        endTime: tmpl.endTime,
        status: 'pending',
        date,
        interruptions: 0,
      };
      this.addBlock(block);
      newBlocks.push(block);
    }

    return newBlocks;
  }

  /**
   * Reorganiza los bloques de un día para eliminar solapamientos.
   * Lógica:
   *  1. Los bloques completados/activos se fijan en su posición.
   *  2. Los bloques pendientes mantienen su orden cronológico.
   *  3. Si un bloque se solapa con uno anterior o fijo, se desplaza hacia adelante (cascada).
   *  4. Los rest/low que no caben se eliminan.
   */
  reorganizeBlocks(date: string): void {
    const dayBlocks = this.getBlocks(date);
    if (dayBlocks.length <= 1) return;

    // Separar bloques fijos (ya activos/completados) de los pendientes
    const fixed = dayBlocks.filter(b => b.status === 'completed' || b.status === 'active');
    const pending = dayBlocks.filter(b => b.status !== 'completed' && b.status !== 'active');

    // Ordenar pendientes cronológicamente (mantener el orden del usuario)
    pending.sort((a, b) => a.startTime.localeCompare(b.startTime));

    // Crear "ocupación" con bloques fijos
    const occupied: Array<{ start: string; end: string }> = fixed.map(b => ({ start: b.startTime, end: b.endTime }));
    occupied.sort((a, b) => a.start.localeCompare(b.start));

    // Colocar cada bloque pendiente en orden cronológico
    // Solo se desplaza si se solapa con un bloque ya colocado (cascada hacia adelante)
    const placed: Block[] = [...fixed];
    const idsToRemove = new Set<string>();

    for (const block of pending) {
      let candidate = block.startTime;

      // Buscar la primera posición libre a partir de la posición actual del bloque
      for (const occ of occupied) {
        const candidateEnd = addMinutesToTime(candidate, block.duration);
        // Si hay solapamiento, mover después del slot ocupado + 5 min de gap
        if (candidate < occ.end && candidateEnd > occ.start) {
          candidate = addMinutesToTime(occ.end, 5);
        }
      }

      const newEnd = addMinutesToTime(candidate, block.duration);
      if (newEnd > '23:59') {
        // No cabe → eliminarlo si es rest de baja prioridad
        if (block.type === 'rest' && block.priority === 'low') {
          idsToRemove.add(block.id);
          continue;
        }
        // Si no es rest, dejarlo donde estaba (no se puede mover más)
        occupied.push({ start: block.startTime, end: block.endTime });
        occupied.sort((a, b) => a.start.localeCompare(b.start));
        placed.push(block);
        continue;
      }

      block.startTime = candidate;
      block.endTime = newEnd;
      occupied.push({ start: candidate, end: newEnd });
      occupied.sort((a, b) => a.start.localeCompare(b.start));
      placed.push(block);
    }

    // Aplicar cambios al store
    const placedIds = new Set(placed.map(b => b.id));
    this.blocks = this.blocks.filter(b => b.date !== date || placedIds.has(b.id));
    // Actualizar horarios de los bloques reposicionados
    for (const p of placed) {
      this.blocks = this.blocks.map(b =>
        b.id === p.id ? { ...b, startTime: p.startTime, endTime: p.endTime, duration: p.duration } : b
      );
    }
    // Eliminar rest blocks que no caben
    this.blocks = this.blocks.filter(b => !idsToRemove.has(b.id));
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  // ─── Blocks ────────────────────────────────────────────────────────────────

  getBlocks(date?: string): Block[] {
    if (date) return this.blocks.filter(b => b.date === date);
    return this.blocks;
  }

  getBlock(id: string): Block | undefined {
    return this.blocks.find(b => b.id === id);
  }

  addBlock(block: Block): void {
    this.blocks = [...this.blocks, block];
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  updateBlock(id: string, updates: Partial<Block>): void {
    this.blocks = this.blocks.map(b => b.id === id ? { ...b, ...updates } : b);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    this.recalcDailyMetrics(this.blocks.find(b => b.id === id)?.date ?? '');
  }

  deleteBlock(id: string): void {
    const block = this.blocks.find(b => b.id === id);
    this.blocks = this.blocks.filter(b => b.id !== id);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    if (block?.date) this.recalcDailyMetrics(block.date);
  }

  deleteAllBlocksForDate(date: string): void {
    this.blocks = this.blocks.filter(b => b.date !== date);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    this.recalcDailyMetrics(date);
  }

  deleteAllTasks(): void {
    // Obtener fechas afectadas
    const affectedDates = new Set(
      this.blocks.filter(b => b.taskId).map(b => b.date)
    );

    this.tasks = [];
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    // Remove task references from all blocks
    this.blocks = this.blocks.map(b =>
      b.taskId ? { ...b, taskId: undefined, task: undefined } : b
    );
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);

    // Reorganizar cada día afectado
    for (const date of affectedDates) {
      this.reorganizeBlocks(date);
    }
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(startDate?: string, endDate?: string): DailyMetrics[] {
    if (startDate && endDate) {
      return this.metrics.filter(m => m.date >= startDate && m.date <= endDate);
    }
    return this.metrics;
  }

  getMetricsForDate(date: string): DailyMetrics | null {
    return this.metrics.find(m => m.date === date) ?? null;
  }

  recalcDailyMetrics(date: string): void {
    if (!date) return;
    const blocks = this.getBlocks(date);
    const blocksPlanned = blocks.length;
    const blocksCompleted = blocks.filter(b => b.status === 'completed').length;
    const blocksFailed = blocks.filter(b => b.status === 'failed').length;
    const interruptions = blocks.reduce((sum, b) => sum + (b.interruptions ?? 0), 0);
    const deepWorkHours = blocks
      .filter(b => b.type === 'deep' && b.status === 'completed')
      .reduce((sum, b) => sum + b.duration / 60, 0);
    const disciplineScore = this.calculateDailyScore(date);

    const metric: DailyMetrics = {
      date, blocksPlanned, blocksCompleted, blocksFailed,
      interruptions, deepWorkHours, disciplineScore,
    };

    const index = this.metrics.findIndex(m => m.date === date);
    if (index !== -1) {
      this.metrics = this.metrics.map(m => m.date === date ? metric : m);
    } else {
      this.metrics = [...this.metrics, metric];
    }
    saveToStorage(STORAGE_KEYS.metrics, this.metrics);
  }

  // ─── Settings ──────────────────────────────────────────────────────────────

  getSettings(): UserSettings {
    return this.settings;
  }

  updateSettings(updates: Partial<UserSettings>): void {
    this.settings = { ...this.settings, ...updates };
    saveToStorage(STORAGE_KEYS.settings, this.settings);
  }

  resetSettings(): void {
    this.settings = { ...DEFAULT_SETTINGS };
    saveToStorage(STORAGE_KEYS.settings, this.settings);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  getTodayBlocks(): Block[] {
    const today = todayStr();
    return this.getBlocks(today).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  getCurrentBlock(): Block | null {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = dateToStr(now);
    return this.getBlocks(today).find(b =>
      b.startTime <= currentTime && b.endTime > currentTime &&
      b.status !== 'completed' && b.status !== 'failed'
    ) ?? null;
  }

  getNextBlock(): Block | null {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = dateToStr(now);
    const sorted = this.getBlocks(today).sort((a, b) => a.startTime.localeCompare(b.startTime));
    return sorted.find(b => b.startTime > currentTime && b.status === 'pending') ?? null;
  }

  calculateDailyScore(date: string): number {
    const blocks = this.getBlocks(date);
    if (blocks.length === 0) return 100;
    let score = 100;
    blocks.forEach(block => {
      // Los bloques de descanso no afectan la puntuación
      if (block.type === 'rest') return;
      if (block.status === 'failed') {
        score -= block.type === 'deep' ? 20 : block.type === 'exercise' ? 15 : 10;
      }
      if (block.interruptions > 0) {
        score -= block.interruptions * 5;
      }
    });
    return Math.max(0, score);
  }

  /**
   * Limpia bloques de días ANTERIORES al día actual que ya están en estado terminal
   * (completados o fallados) con más de 2 días de antigüedad, para evitar acumulación.
   *
   * Los bloques del DÍA ACTUAL nunca se eliminan automáticamente —
   * el usuario debe verlos todo el día sin importar su estado o si su hora ya pasó.
   *
   * Devuelve la cantidad de bloques eliminados.
   */
  cleanExpiredBlocks(): number {
    const now = new Date();
    const today = dateToStr(now);

    // Calcular el límite: días anteriores a antes de ayer
    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = dateToStr(twoDaysAgo);

    const before = this.blocks.length;
    this.blocks = this.blocks.filter(b => {
      // Nunca tocar los bloques de hoy
      if (b.date >= today) return true;

      // Conservar bloques recientes (ayer) sin importar su estado
      if (b.date > twoDaysAgoStr) return true;

      // Bloques de más de 2 días: solo eliminar los ya terminados
      return b.status === 'pending' || b.status === 'active';
    });
    const removed = before - this.blocks.length;
    if (removed > 0) {
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    }
    return removed;
  }

  clearAll(): void {
    this.tasks = [];
    this.blocks = [];
    this.metrics = [];
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    saveToStorage(STORAGE_KEYS.metrics, this.metrics);
  }
}

export const store = new Store();
export { DEFAULT_SETTINGS };
