import { Block, Task, DailyMetrics, UserSettings } from './types';

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
    // Detach task from blocks
    this.blocks = this.blocks.map(b =>
      b.taskId === id ? { ...b, taskId: undefined, task: undefined } : b
    );
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

  /** Recalculate and persist metrics for a given date based on current blocks */
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
      date,
      blocksPlanned,
      blocksCompleted,
      blocksFailed,
      interruptions,
      deepWorkHours,
      disciplineScore,
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
