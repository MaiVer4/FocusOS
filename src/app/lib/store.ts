import { Block, BlockType, BlockPriority, Task, TaskStatus, DailyMetrics, UserSettings } from './types';
import { addMinutesToTime, durationBetween } from './helpers';

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
  { type: 'rest',     label: 'Llegada y merienda',            startTime: '18:30', endTime: '19:00', priority: 'low' },
  { type: 'deep',     label: 'Bloque profundo 1',             startTime: '19:00', endTime: '19:40', priority: 'high', assignTask: true },
  { type: 'rest',     label: 'Descanso',                     startTime: '19:40', endTime: '19:50', priority: 'low' },
  { type: 'deep',     label: 'Bloque profundo 2',             startTime: '19:50', endTime: '20:30', priority: 'high', assignTask: true },
  { type: 'rest',     label: 'Descanso corto',               startTime: '20:30', endTime: '20:40', priority: 'low' },
  { type: 'deep',     label: 'Bloque profundo 3',             startTime: '20:40', endTime: '21:00', priority: 'high', assignTask: true },
  { type: 'exercise', label: 'Ejercicio',                    startTime: '21:00', endTime: '21:40', priority: 'high' },
  { type: 'rest',     label: 'Ducha',                        startTime: '21:40', endTime: '22:00', priority: 'low' },
  { type: 'light',    label: 'Revisión y documentación',      startTime: '22:00', endTime: '22:45', priority: 'medium', assignTask: true },
  { type: 'rest',     label: 'Redes sociales',               startTime: '22:45', endTime: '23:15', priority: 'low' },
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
  { type: 'rest',     label: 'Ducha y cena',                  startTime: '18:30', endTime: '19:15', priority: 'low' },
  { type: 'rest',     label: 'Tiempo libre (relajarse)',       startTime: '19:15', endTime: '22:00', priority: 'low' },
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

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`Error saving ${key} to localStorage:`, e);
  }
}

class Store {
  private tasks: Task[] = loadFromStorage<Task[]>(STORAGE_KEYS.tasks, []);
  private blocks: Block[] = loadFromStorage<Block[]>(STORAGE_KEYS.blocks, []);
  private metrics: DailyMetrics[] = loadFromStorage<DailyMetrics[]>(STORAGE_KEYS.metrics, []);
  private settings: UserSettings = loadFromStorage<UserSettings>(STORAGE_KEYS.settings, DEFAULT_SETTINGS);

  constructor() {
    this.migrateTaskStatuses();
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

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  getTasks(): Task[] {
    return this.tasks;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find(t => t.id === id);
  }

  addTask(task: Task): void {
    this.tasks = [...this.tasks, task];
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
  }

  updateTask(id: string, updates: Partial<Task>): void {
    this.tasks = this.tasks.map(t => t.id === id ? { ...t, ...updates } : t);
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    // Update embedded task references in blocks
    this.blocks = this.blocks.map(b =>
      b.taskId === id ? { ...b, task: this.tasks.find(t => t.id === id) } : b
    );
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  deleteTask(id: string): void {
    this.tasks = this.tasks.filter(t => t.id !== id);
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    this.blocks = this.blocks.map(b =>
      b.taskId === id ? { ...b, taskId: undefined, task: undefined } : b
    );
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
      const taskDate = t.dueDate.split('T')[0];
      return taskDate === date;
    });
  }

  /** Tareas vencidas (fecha pasada) que no están terminadas ni aplazadas */
  getOverdueTasks(date: string): Task[] {
    return this.tasks.filter(t => {
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

    const sorted = [...existingBlocks].sort((a, b) => a.endTime.localeCompare(b.endTime));
    let lastEnd = sorted.length > 0
      ? addMinutesToTime(sorted[sorted.length - 1].endTime, 10)
      : this.settings.arrivalTime;

    const newBlocks: Block[] = [];

    for (const task of unassigned) {
      const duration = task.difficulty === 'high' ? 90
        : task.difficulty === 'medium' ? 60 : 45;
      const startTime = lastEnd;
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
      lastEnd = addMinutesToTime(endTime, 10);
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
    this.tasks = [];
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    // Remove task references from all blocks
    this.blocks = this.blocks.map(b =>
      b.taskId ? { ...b, taskId: undefined, task: undefined } : b
    );
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
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
    const today = new Date().toISOString().split('T')[0];
    return this.getBlocks(today).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  getCurrentBlock(): Block | null {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];
    return this.getBlocks(today).find(b =>
      b.startTime <= currentTime && b.endTime > currentTime &&
      b.status !== 'completed' && b.status !== 'failed'
    ) ?? null;
  }

  getNextBlock(): Block | null {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const today = now.toISOString().split('T')[0];
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
