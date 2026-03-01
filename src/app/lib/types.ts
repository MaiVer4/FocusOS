export type BlockType = 'deep' | 'light' | 'exercise' | 'rest';
export type BlockPriority = 'high' | 'medium' | 'low';
export type BlockStatus = 'pending' | 'active' | 'completed' | 'failed';
export type Difficulty = 'high' | 'medium' | 'low';
export type TaskStatus = 'sin-iniciar' | 'en-progreso' | 'en-progreso-aplazada' | 'aplazada' | 'terminada';
export type PeakEnergyTime = 'morning' | 'afternoon' | 'night';

export interface Subtask {
  id: string;
  title: string;
  done: boolean;
}

export interface Task {
  id: string;
  subject: string;
  description: string;
  notes?: string;
  category?: string;       // ej: "Java", "JavaScript", "Bases de datos"
  subtasks?: Subtask[];    // pasos del proyecto, se completan bloque a bloque
  dueDate: string;          // vacío '' si no tiene fecha de entrega
  difficulty: Difficulty;
  status: TaskStatus;
  isDeliverable?: boolean;  // true = entrega de evidencia, false = repaso/personal
  externalId?: string;      // ID externo (Classroom courseworkId o Calendar eventId)
  source?: 'classroom' | 'calendar' | 'manual';  // origen de la tarea
  createdAt: string;
  completedAt?: string;
}

export interface Block {
  id: string;
  type: BlockType;
  label?: string;
  priority: BlockPriority;
  taskId?: string;
  duration: number; // in minutes
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  status: BlockStatus;
  date: string; // YYYY-MM-DD
  interruptions: number;
  task?: Task;
  externalId?: string;      // ID externo (Calendar eventId)
  source?: 'calendar' | 'manual';  // origen del bloque
}

export interface DailyMetrics {
  date: string;
  blocksPlanned: number;
  blocksCompleted: number;
  blocksFailed: number;
  interruptions: number;
  deepWorkHours: number;
  disciplineScore: number;
}

export interface UserSettings {
  appName: string;
  wakeTime: string;
  sleepTime: string;
  scheduleStartTime: string;
  scheduleEndTime: string;
  arrivalTime: string;
  peakEnergyTime: PeakEnergyTime;
  dailyDeepBlocksMin: number;
  dailyDeepBlocksMax: number;
  deepBlockDuration: number; // in minutes
  exerciseMandatory: boolean;
  exerciseDuration: number;
  socialMediaMaxMinutes: number;
}
