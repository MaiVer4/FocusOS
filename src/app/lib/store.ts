import { Block, BlockType, BlockPriority, Difficulty, Task, TaskStatus, DailyMetrics, UserSettings } from './types';
import { addMinutesToTime, dateToStr, durationBetween, todayStr } from './helpers';
import { cloudSync } from './cloud-sync';
import {
  analyzeHistory, LearnedProfile,
  getProductivityScore, getCategoryBonus, getOptimalDuration,
  smartAssignTasksToSlots,
} from './learning-engine';
import { generateAISchedule, getAIDailySummary, resetAIClient } from './ai-engine';
import type { AIScheduleResult, AIDailySummary, AIProvider } from './ai-engine';

const STORAGE_KEYS = {
  tasks: 'focusos_tasks',
  blocks: 'focusos_blocks',
  metrics: 'focusos_metrics',
  settings: 'focusos_settings',
  profile: 'focusos_learned_profile',
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

// ─── Utilidades de tiempo para plantillas ────────────────────────────────────

const _toMin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const _toTime = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Agrega un bloque a la lista y avanza el cursor. Retorna nuevo cursor. */
function _push(
  blocks: TemplateBlock[],
  cursor: number,
  duration: number,
  type: BlockType,
  label: string,
  priority: BlockPriority,
  assignTask?: boolean,
): number {
  blocks.push({ type, label, startTime: _toTime(cursor), endTime: _toTime(cursor + duration), priority, assignTask });
  return cursor + duration;
}

// ─── Generadores dinámicos de plantilla ──────────────────────────────────────

/** Lunes a Viernes — construido dinámicamente desde Settings */
function generateWeekdayTemplate(s: UserSettings): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  const wake = _toMin(s.wakeTime);
  const sleep = _toMin(s.sleepTime);
  const formalStart = _toMin(s.scheduleStartTime);
  const formalEnd = _toMin(s.scheduleEndTime);
  const arrival = _toMin(s.arrivalTime);
  const deepDur = s.deepBlockDuration || 40;
  const exDur = s.exerciseDuration || 40;
  const deepMax = s.dailyDeepBlocksMax || 3;

  let c = wake; // cursor en minutos

  // ═══ MAÑANA: wakeTime → scheduleStartTime ═══
  const morningWindow = formalStart - wake;

  if (morningWindow >= 20) {
    c = _push(blocks, c, 20, 'rest', 'Despertar y rutina matutina', 'low');
  }
  if (morningWindow >= 50) {
    c = _push(blocks, c, 20, 'rest', 'Desayuno', 'low');
  }
  // Estudio ligero matutino si hay ≥ 60 min de ventana extra
  if (morningWindow >= 110) {
    const studyTime = Math.min(60, formalStart - c - 30); // reservar 30 min prep/transporte
    if (studyTime >= 30) {
      c = _push(blocks, c, studyTime, 'light', 'Estudio ligero', 'medium', true);
    }
  }
  // Prepararse y transporte
  if (morningWindow >= 75) {
    const remaining = formalStart - c;
    if (remaining >= 30) {
      c = _push(blocks, c, 15, 'rest', 'Vestirse y prepararse', 'low');
      c = _push(blocks, c, formalStart - c, 'rest', 'Transporte', 'low');
    } else if (remaining >= 15) {
      c = _push(blocks, c, remaining, 'rest', 'Prepararse', 'low');
    }
  }

  // ═══ FORMAL: scheduleStartTime → scheduleEndTime ═══
  blocks.push({
    type: 'light', label: 'Actividades formales',
    startTime: s.scheduleStartTime, endTime: s.scheduleEndTime,
    priority: 'high',
  });

  // ═══ TRANSICIÓN: scheduleEndTime → arrivalTime ═══
  if (arrival > formalEnd) {
    blocks.push({
      type: 'rest', label: 'Transporte de regreso',
      startTime: s.scheduleEndTime, endTime: s.arrivalTime,
      priority: 'low',
    });
  }

  // ═══ TARDE/NOCHE: arrivalTime → sleepTime ═══
  c = arrival;

  // Cena (45 min o lo que quepa)
  const dinnerDur = Math.min(45, sleep - c - 60);
  if (dinnerDur >= 20) {
    c = _push(blocks, c, dinnerDur, 'rest', 'Llegada y cena', 'low');
  }

  // Bloques profundos con descansos
  const breakDur = 10;
  for (let i = 0; i < deepMax; i++) {
    if (c + deepDur > sleep - 30) break; // reservar 30 min para cierre del día
    c = _push(blocks, c, deepDur, 'deep', `Bloque profundo ${i + 1}`, 'high', true);

    // Descanso entre bloques (no después del último)
    if (i < deepMax - 1 && c + breakDur + deepDur <= sleep - 30) {
      c = _push(blocks, c, breakDur, 'rest', i < deepMax - 2 ? 'Descanso' : 'Descanso corto', 'low');
    }
  }

  // Ejercicio
  if (s.exerciseMandatory && c + exDur <= sleep - 20) {
    c = _push(blocks, c, exDur, 'exercise', 'Ejercicio', 'high');
    if (c + 20 <= sleep - 10) {
      c = _push(blocks, c, 20, 'rest', 'Ducha', 'low');
    }
  }

  // Revisión y documentación
  if (c + 30 <= sleep - 10) {
    c = _push(blocks, c, 30, 'light', 'Revisión y documentación', 'medium', true);
  }

  // Redes sociales
  const socialTime = Math.min(s.socialMediaMaxMinutes || 15, 15);
  if (socialTime >= 5 && c + socialTime <= sleep) {
    c = _push(blocks, c, socialTime, 'rest', 'Redes sociales', 'low');
  }

  // Prepararse para dormir
  const windDown = Math.min(30, sleep - c);
  if (windDown >= 10) {
    _push(blocks, c, windDown, 'rest', 'Prepararse para dormir', 'low');
  }

  return blocks;
}

/** Sábado — construido dinámicamente desde Settings */
function generateSaturdayTemplate(s: UserSettings): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  const wake = _toMin(s.wakeTime);
  const sleep = _toMin(s.sleepTime);
  const deepDur = s.deepBlockDuration || 60;
  const exDur = s.exerciseDuration || 60;

  let c = wake;

  // Mañana tranquila
  c = _push(blocks, c, 30, 'rest', 'Despertar', 'low');
  c = _push(blocks, c, 30, 'rest', 'Desayuno tranquilo', 'low');

  // Bloques de proyecto personal
  if (c + deepDur <= wake + 240) { // dentro de las primeras 4h
    c = _push(blocks, c, deepDur, 'deep', 'Proyecto personal – Bloque 1', 'high', true);
    c = _push(blocks, c, 10, 'rest', 'Descanso', 'low');
    if (c + deepDur <= wake + 300) {
      c = _push(blocks, c, deepDur, 'deep', 'Proyecto personal – Bloque 2', 'high', true);
    }
  }

  // Almuerzo
  c = _push(blocks, c, 60, 'rest', 'Almuerzo y descanso', 'low');

  // Tiempo libre hasta la tarde
  const exerciseStart = Math.max(c, sleep - 300); // ~5h antes de dormir
  if (exerciseStart > c) {
    c = _push(blocks, c, exerciseStart - c, 'rest', 'Tiempo libre', 'low');
  }

  // Ejercicio
  if (s.exerciseMandatory && c + exDur <= sleep - 60) {
    c = _push(blocks, c, exDur, 'exercise', 'Ejercicio', 'high');
  }

  // Ducha y cena
  c = _push(blocks, c, 45, 'rest', 'Ducha y cena', 'low');

  // Tiempo libre nocturno
  const windDownStart = sleep - 30;
  if (c < windDownStart) {
    c = _push(blocks, c, windDownStart - c, 'rest', 'Tiempo libre moderado', 'low');
  }

  // Dormir
  const windDown = sleep - c;
  if (windDown >= 10) {
    _push(blocks, c, windDown, 'rest', 'Prepararse para dormir', 'low');
  }

  return blocks;
}

/** Domingo — construido dinámicamente desde Settings */
function generateSundayTemplate(s: UserSettings): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  const wake = _toMin(s.wakeTime);
  const sleep = _toMin(s.sleepTime);

  let c = wake;

  // Mañana libre
  const noon = Math.max(c + 60, 12 * 60);
  c = _push(blocks, c, noon - c, 'rest', 'Despertar y mañana libre', 'low');

  // Almuerzo
  c = _push(blocks, c, 60, 'rest', 'Almuerzo', 'low');

  // Tiempo libre
  const planStart = Math.max(c, sleep - 360); // ~6h antes de dormir
  if (planStart > c) {
    c = _push(blocks, c, planStart - c, 'rest', 'Tiempo libre', 'low');
  }

  // Planear semana
  c = _push(blocks, c, 60, 'light', 'Planear semana – entregas y prioridades', 'high', true);

  // Ejercicio ligero
  if (s.exerciseMandatory && c + 30 <= sleep - 90) {
    c = _push(blocks, c, 30, 'exercise', 'Ejercicio ligero', 'medium');
  }

  // Descanso
  c = _push(blocks, c, 30, 'rest', 'Descanso', 'low');

  // Ducha y cena
  c = _push(blocks, c, 45, 'rest', 'Ducha y cena', 'low');

  // Tiempo libre nocturno
  const windDownStart = sleep - 30;
  if (c < windDownStart) {
    c = _push(blocks, c, windDownStart - c, 'rest', 'Tiempo libre (relajarse)', 'low');
  }

  // Dormir temprano
  const windDown = sleep - c;
  if (windDown >= 10) {
    _push(blocks, c, windDown, 'rest', 'Prepararse para dormir temprano', 'low');
  }

  return blocks;
}

/** Retorna la plantilla adecuada según el día de la semana (0=dom … 6=sáb) */
function getTemplateForDay(dayOfWeek: number, settings: UserSettings): TemplateBlock[] {
  if (dayOfWeek === 6) return generateSaturdayTemplate(settings);
  if (dayOfWeek === 0) return generateSundayTemplate(settings);
  return generateWeekdayTemplate(settings);
}

// ─── Smart Task Scheduling ──────────────────────────────────────────────────

/** Sesiones de trabajo por semana según dificultad de la tarea */
const SESSIONS_PER_WEEK: Record<Difficulty, number> = {
  high: 5,    // casi diario (lun–vie)
  medium: 3,  // cada ~2 días
  low: 1,     // una vez por semana
};

/**
 * Calcula un puntaje de urgencia para una tarea.
 * Mayor puntaje = más urgente = debe priorizarse.
 *
 * Factores:
 * - Días restantes hasta la fecha de entrega
 * - Dificultad (sesiones necesarias por semana)
 * - Si es entregable (isDeliverable)
 * - Si está vencida (overdue)
 * - Perfil aprendido: categorías con bajo rendimiento se priorizan más
 */
function calculateTaskUrgency(task: Task, referenceDate: string, profile?: LearnedProfile | null): number {
  if (!task.dueDate || task.status === 'terminada') return -1;

  const dueStr = task.dueDate.split('T')[0];
  const ref = new Date(referenceDate + 'T12:00:00');
  const due = new Date(dueStr + 'T12:00:00');
  const daysLeft = Math.ceil((due.getTime() - ref.getTime()) / 86_400_000);

  // Vencida → máxima urgencia (más días vencida = más urgente)
  if (daysLeft < 0) return 1000 + Math.abs(daysLeft) * 10;

  // Vence hoy
  if (daysLeft === 0) return 500;

  const sessionsPerWeek = SESSIONS_PER_WEEK[task.difficulty];

  // urgency = sesiones necesarias / días restantes
  let urgency = (sessionsPerWeek * 10) / Math.max(1, daysLeft);

  // Bonus para entregables
  if (task.isDeliverable) urgency *= 1.5;

  // Bonus extra por dificultad alta cuando quedan pocos días
  if (task.difficulty === 'high' && daysLeft <= 3) urgency *= 2;

  // Bonus del perfil aprendido: categorías con bajo rendimiento → más urgencia
  if (profile) {
    urgency *= getCategoryBonus(profile, task);
  }

  return urgency;
}

/**
 * Determina si una tarea debe programarse para trabajo en un día dado.
 * La tarea se programa TODOS los días desde hoy hasta su fecha de entrega.
 * Solo se excluye si el día ya tiene un bloque con esa tarea asignada.
 */
function shouldScheduleTaskOnDay(task: Task, date: string, _allBlocks: Block[]): boolean {
  if (!task.dueDate || task.status === 'terminada' || task.status === 'aplazada') return false;

  const dueStr = task.dueDate.split('T')[0];

  // Tarea vencida → programar siempre (arrastrar)
  if (date > dueStr) return true;

  // Programar en cualquier día hasta la fecha de entrega (inclusive)
  return date <= dueStr;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // Proteger contra valores null/undefined parseados
    if (parsed === null || parsed === undefined) return fallback;
    return parsed as T;
  } catch {
    return fallback;
  }
}

const CLOUD_COLLECTIONS: Record<string, string> = {
  [STORAGE_KEYS.tasks]: 'tasks',
  [STORAGE_KEYS.blocks]: 'blocks',
  [STORAGE_KEYS.metrics]: 'metrics',
  [STORAGE_KEYS.settings]: 'settings',
  [STORAGE_KEYS.profile]: 'profile',
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
  private profile: LearnedProfile = loadFromStorage<LearnedProfile>(STORAGE_KEYS.profile, null as any);

  constructor() {
    this.migrateTaskStatuses();
    // Persist merged settings so new default fields get saved
    saveToStorage(STORAGE_KEYS.settings, this.settings);
    // Recalcular perfil de aprendizaje al iniciar
    this.refreshProfile();
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
    this.refreshProfile();
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
   * Crea automáticamente un bloque para la tarea HOY si:
   * - La tarea tiene fecha de entrega (dueDate)
   * - La urgencia requiere trabajar hoy (según dificultad y días restantes)
   * - Ya existen bloques para hoy (la rutina fue generada)
   * - La tarea no tiene ya un bloque asignado hoy
   * Luego reorganiza todos los bloques del día.
   */
  private autoAssignBlock(task: Task): void {
    if (!task.dueDate || task.status === 'terminada') return;

    const today = todayStr();

    // Solo programar si la tarea debe trabajarse hoy según su urgencia
    if (!shouldScheduleTaskOnDay(task, today, this.blocks)) return;

    const existingBlocks = this.getBlocks(today);

    // Solo auto-crear si ya hay bloques hoy (la rutina fue generada)
    if (existingBlocks.length === 0) return;

    // Verificar que no tenga ya un bloque hoy
    if (existingBlocks.some(b => b.taskId === task.id)) return;

    const duration = task.difficulty === 'high' ? 90
      : task.difficulty === 'medium' ? 60 : 45;
    const priority = task.isDeliverable || task.difficulty === 'high' ? 'high'
      : task.difficulty === 'medium' ? 'medium' : 'low';

    const freeSlot = this.findNextFreeSlot(today, duration, this.settings.arrivalTime);
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
      date: today,
      interruptions: 0,
    };
    this.addBlock(block);
    this.reorganizeBlocks(today);
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

    // Si cambió la fecha de entrega, re-evaluar programación con nueva urgencia
    if (oldDate && newDate && oldDate !== newDate && updatedTask) {
      // Intentar asignar bloque hoy con la nueva urgencia
      this.autoAssignBlock(updatedTask);
    } else if (newDate) {
      // Si cambió dificultad, ajustar duración de bloques pendientes
      if (updates.difficulty && oldTask && updates.difficulty !== oldTask.difficulty) {
        const newDuration = updates.difficulty === 'high' ? 90
          : updates.difficulty === 'medium' ? 60 : 45;
        const newPriority = (updatedTask?.isDeliverable || updates.difficulty === 'high') ? 'high'
          : updates.difficulty === 'medium' ? 'medium' : 'low';
        // Buscar cualquier bloque pendiente de esta tarea (ya no atado al dueDate)
        const taskBlock = this.blocks.find(b => b.taskId === id && b.status === 'pending');
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
          this.reorganizeBlocks(taskBlock.date);
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
   * Usa el perfil aprendido para asignar tareas difíciles a bloques más productivos.
   */
  private assignUnblockedTasks(date: string): void {
    const dayBlocks = this.getBlocks(date);
    const tasksWithBlocks = new Set(
      dayBlocks.filter(b => b.taskId).map(b => b.taskId!)
    );
    const dayTasks = this.getTasksForDayWithCarryOver(date)
      .filter(t => !tasksWithBlocks.has(t.id) && t.status !== 'terminada');

    // Bloques libres (sin tarea, pendientes, de tipo deep/light/exercise — no rest)
    const freeBlocks = dayBlocks.filter(
      b => !b.taskId && b.status === 'pending' && b.type !== 'rest'
    );

    if (dayTasks.length === 0 || freeBlocks.length === 0) return;

    if (this.profile && this.profile.totalBlocksAnalyzed >= 10) {
      // Asignación inteligente con perfil
      const blockSlots = freeBlocks.map((b, i) => ({
        index: i, type: b.type, startTime: b.startTime,
      }));
      const assignment = smartAssignTasksToSlots(dayTasks, blockSlots, this.profile);
      for (const [idx, task] of assignment) {
        const block = freeBlocks[idx];
        this.blocks = this.blocks.map(b =>
          b.id === block.id ? { ...b, taskId: task.id, task } : b
        );
      }
    } else {
      // Sin perfil: asignar en orden
      const toAssign = Math.min(dayTasks.length, freeBlocks.length);
      for (let i = 0; i < toAssign; i++) {
        const block = freeBlocks[i];
        const task = dayTasks[i];
        this.blocks = this.blocks.map(b =>
          b.id === block.id ? { ...b, taskId: task.id, task } : b
        );
      }
    }
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
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
   * Devuelve las tareas que deben trabajarse en un día dado,
   * ordenadas por urgencia dinámica (más urgente primero).
   *
   * Ya no depende solo de la fecha de entrega:
   * - Dificultad determina frecuencia: HIGH=5/sem, MEDIUM=3/sem, LOW=1/sem
   * - Deadline cercano + alta dificultad → prioridad máxima
   * - Tareas vencidas siempre se incluyen
   * - Tareas sin fecha en progreso también se incluyen
   *
   * Ejemplo: Hoy lunes, Tarea X (HIGH, entrega miércoles) tiene más urgencia
   *          que Tarea Y (MEDIUM, entrega viernes) porque tiene menos días y más sesiones.
   */
  getTasksForDayWithCarryOver(date: string): Task[] {
    const activeTasks = this.tasks.filter(t =>
      t.status !== 'terminada' && t.status !== 'aplazada'
    );

    // Tareas con fecha que deben trabajarse hoy según urgencia y dificultad
    const schedulable = activeTasks.filter(t =>
      t.dueDate && shouldScheduleTaskOnDay(t, date, this.blocks)
    );

    // Tareas sin fecha pero en progreso (repaso/personales activas)
    const inProgressNoDate = activeTasks.filter(t =>
      !t.dueDate && (t.status === 'en-progreso' || t.status === 'en-progreso-aplazada')
    );

    // Deduplicar
    const seen = new Set<string>();
    const all: Task[] = [];
    for (const t of [...schedulable, ...inProgressNoDate]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        all.push(t);
      }
    }

    // Ordenar por urgencia (mayor primero) — usa perfil aprendido
    return all.sort((a, b) => {
      const ua = calculateTaskUrgency(a, date, this.profile);
      const ub = calculateTaskUrgency(b, date, this.profile);
      return ub - ua;
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
   * Usa el perfil aprendido para:
   *  - Asignar tareas difíciles a los bloques de mayor productividad
   *  - Ajustar duraciones según historial
   */
  generateFromTemplate(date: string): Block[] {
    const existing = this.getBlocks(date);
    if (existing.length > 0) return [];

    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const template = getTemplateForDay(dayOfWeek, this.settings);

    const tasks = this.getTasksForDayWithCarryOver(date);
    const newBlocks: Block[] = [];

    // Primero crear todos los bloques sin tareas
    const blockSlots: Array<{ index: number; type: BlockType; startTime: string }> = [];

    for (let i = 0; i < template.length; i++) {
      const tmpl = template[i];
      let duration = durationBetween(tmpl.startTime, tmpl.endTime);

      // Si hay perfil y datos suficientes, ajustar duración de bloques deep/light
      if (this.profile && this.profile.totalBlocksAnalyzed >= 10) {
        if (tmpl.type === 'deep') {
          const optimal = getOptimalDuration(this.profile, 'deep');
          // Solo ajustar si la diferencia es significativa (±15 min)
          if (Math.abs(optimal - duration) > 15) {
            duration = Math.max(20, Math.min(optimal, 120)); // entre 20 y 120 min
          }
        } else if (tmpl.type === 'light') {
          const optimal = getOptimalDuration(this.profile, 'light');
          if (Math.abs(optimal - duration) > 15) {
            duration = Math.max(15, Math.min(optimal, 90));
          }
        }
      }

      const endTime = addMinutesToTime(tmpl.startTime, duration);

      const block: Block = {
        id: crypto.randomUUID(),
        type: tmpl.type,
        label: tmpl.label,
        priority: tmpl.priority,
        duration,
        startTime: tmpl.startTime,
        endTime,
        status: 'pending',
        date,
        interruptions: 0,
      };
      newBlocks.push(block);

      // Registrar slots donde se puede asignar tarea (no rest)
      if (tmpl.type !== 'rest') {
        blockSlots.push({ index: i, type: tmpl.type, startTime: tmpl.startTime });
      }
    }

    // Asignar tareas a bloques usando el perfil aprendido
    if (tasks.length > 0 && blockSlots.length > 0) {
      if (this.profile && this.profile.totalBlocksAnalyzed >= 10) {
        // Asignación inteligente: tareas difíciles → franjas más productivas
        const assignment = smartAssignTasksToSlots(tasks, blockSlots, this.profile);
        for (const [blockIdx, task] of assignment) {
          newBlocks[blockIdx].taskId = task.id;
          newBlocks[blockIdx].task = task;
        }
      } else {
        // Sin suficiente historial: asignar en orden de urgencia
        const taskQueue = [...tasks];
        for (const slot of blockSlots) {
          if (taskQueue.length === 0) break;
          const task = taskQueue.shift()!;
          newBlocks[slot.index].taskId = task.id;
          newBlocks[slot.index].task = task;
        }
      }
    }

    // Guardar todos los bloques
    for (const block of newBlocks) {
      this.addBlock(block);
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

    // Auto-asignar tarea si el bloque no es rest y no tiene tarea
    if (block.type !== 'rest' && !block.taskId) {
      const dayBlocks = this.blocks.filter(b => b.date === block.date);
      const tasksWithBlocks = new Set(
        dayBlocks.filter(b => b.taskId).map(b => b.taskId!)
      );
      const available = this.getTasksForDayWithCarryOver(block.date)
        .filter(t => !tasksWithBlocks.has(t.id) && t.status !== 'terminada');

      if (available.length > 0) {
        const task = available[0]; // ya ordenadas por urgencia
        this.blocks = this.blocks.map(b =>
          b.id === block.id ? { ...b, taskId: task.id, task } : b
        );
      }
    }

    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  updateBlock(id: string, updates: Partial<Block>): void {
    this.blocks = this.blocks.map(b => b.id === id ? { ...b, ...updates } : b);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    this.recalcDailyMetrics(this.blocks.find(b => b.id === id)?.date ?? '');

    // Refrescar perfil cuando un bloque se completa o falla
    if (updates.status === 'completed' || updates.status === 'failed') {
      this.refreshProfile();
    }
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
    if (!this.settings) {
      this.settings = { ...DEFAULT_SETTINGS };
    }
    return this.settings;
  }

  updateSettings(updates: Partial<UserSettings>): void {
    // Migrar geminiApiKey legacy a aiApiKey
    if (updates.geminiApiKey && !updates.aiApiKey) {
      updates.aiApiKey = updates.geminiApiKey;
      updates.aiProvider = updates.aiProvider ?? 'gemini';
    }
    this.settings = { ...this.settings, ...updates };
    // Guardar en localStorage
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings));
    // Subir inmediatamente a la nube (sin debounce) para evitar pérdida al refrescar
    cloudSync.uploadImmediate('settings', this.settings);
    if (updates.aiApiKey !== undefined || updates.aiProvider !== undefined || updates.geminiApiKey !== undefined) {
      resetAIClient();
    }
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
   * Elimina bloques del día actual cuya hora de finalización ya pasó hace más de 10 minutos.
   * También limpia bloques de más de 2 días de antigüedad en estado terminal.
   *
   * Importante: NO elimina bloques `pending` futuros — solo los que su endTime ya
   * quedó en el pasado (bloque que no se inició / ya terminó su ventana horaria).
   *
   * Devuelve la cantidad de bloques eliminados.
   */
  cleanExpiredBlocks(): number {
    const now = new Date();
    const today = dateToStr(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const grace = 10; // minutos de gracia después de endTime

    const twoDaysAgo = new Date(now);
    twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
    const twoDaysAgoStr = dateToStr(twoDaysAgo);

    const before = this.blocks.length;
    this.blocks = this.blocks.filter(b => {
      // Bloques futuros (otro día posterior a hoy): conservar siempre
      if (b.date > today) return true;

      // Bloques del día de hoy: eliminar si su hora de fin ya pasó hace más de 10 min
      if (b.date === today) {
        const [eh, em] = b.endTime.split(':').map(Number);
        const endMinutes = eh * 60 + em;
        return currentMinutes < endMinutes + grace;
      }

      // Bloques de días anteriores: conservar si son recientes (ayer)
      if (b.date > twoDaysAgoStr) return true;

      // Más de 2 días: solo eliminar los ya terminados
      return b.status === 'pending' || b.status === 'active';
    });
    const removed = before - this.blocks.length;
    if (removed > 0) {
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    }
    return removed;
  }

  // ─── AI Integration ───────────────────────────────────────────────────────

  /** Verifica si la IA está configurada */
  isAIEnabled(): boolean {
    const key = this.settings.aiApiKey ?? this.settings.geminiApiKey;
    return !!key && key.trim().length > 10;
  }

  /** Obtiene el proveedor y key activos */
  private getAIConfig(): { provider: AIProvider; apiKey: string } {
    const key = this.settings.aiApiKey ?? this.settings.geminiApiKey ?? '';
    const provider = this.settings.aiProvider ?? (this.settings.geminiApiKey ? 'gemini' : 'groq');
    return { provider, apiKey: key };
  }

  /**
   * Genera un horario usando Gemini AI.
   * Envía todo el contexto (settings, perfil, tareas, métricas) a la IA
   * para que genere un horario personalizado.
   */
  async generateWithAI(date: string): Promise<{ blocks: Block[]; insights: string[] }> {
    if (!this.isAIEnabled()) {
      throw new Error('API key de IA no configurada. Ve a Configuración > IA.');
    }

    const existing = this.getBlocks(date);
    if (existing.length > 0) {
      throw new Error('Ya existen bloques para este día. Elimina los bloques primero.');
    }

    const { provider, apiKey } = this.getAIConfig();
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const tasks = this.getTasksForDayWithCarryOver(date);
    const recentMetrics = this.metrics.slice(-14);

    const result: AIScheduleResult = await generateAISchedule(
      provider,
      apiKey,
      date,
      dayOfWeek,
      tasks,
      this.getSettings(),
      this.profile,
      recentMetrics,
      existing,
    );

    // Crear bloques reales a partir de la respuesta de la IA
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const newBlocks: Block[] = [];

    for (const aiBlock of result.blocks) {
      const [sh, sm] = aiBlock.startTime.split(':').map(Number);
      const [eh, em] = aiBlock.endTime.split(':').map(Number);
      const duration = (eh * 60 + em) - (sh * 60 + sm);

      if (duration <= 0) continue;

      const task = aiBlock.taskId ? taskMap.get(aiBlock.taskId) : undefined;

      const block: Block = {
        id: crypto.randomUUID(),
        type: aiBlock.type,
        label: aiBlock.label,
        priority: aiBlock.priority,
        taskId: aiBlock.taskId,
        task,
        duration,
        startTime: aiBlock.startTime,
        endTime: aiBlock.endTime,
        status: 'pending',
        date,
        interruptions: 0,
      };
      this.addBlock(block);
      newBlocks.push(block);
    }

    return { blocks: newBlocks, insights: result.insights };
  }

  /**
   * Obtiene un resumen/análisis del día generado por IA.
   */
  async getAISummary(date: string): Promise<AIDailySummary> {
    if (!this.isAIEnabled()) {
      throw new Error('API key de IA no configurada.');
    }

    const { provider, apiKey } = this.getAIConfig();
    const blocks = this.getBlocks(date);
    const tasks = this.tasks.filter(t => t.status !== 'terminada');
    const recentMetrics = this.metrics.slice(-14);

    return getAIDailySummary(
      provider,
      apiKey,
      date,
      blocks,
      tasks,
      this.getSettings(),
      this.profile,
      recentMetrics,
    );
  }

  // ─── Learning Profile ──────────────────────────────────────────────────────

  /** Devuelve el perfil de aprendizaje actual */
  getProfile(): LearnedProfile | null {
    return this.profile;
  }

  /**
   * Recalcula el perfil de aprendizaje desde el historial de bloques y tareas.
   * Se ejecuta automáticamente al iniciar la app, al recargar datos remotos,
   * y cuando se completa/falla un bloque.
   */
  refreshProfile(): void {
    // Solo recalcular si hay datos suficientes
    const terminal = this.blocks.filter(b => b.status === 'completed' || b.status === 'failed');
    if (terminal.length < 5) {
      this.profile = null as any;
      return;
    }
    this.profile = analyzeHistory(this.blocks, this.tasks);
    saveToStorage(STORAGE_KEYS.profile, this.profile);
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
