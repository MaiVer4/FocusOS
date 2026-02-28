export type BlockType = 'deep' | 'light' | 'exercise' | 'rest';
export type BlockPriority = 'high' | 'medium' | 'low';
export type BlockStatus = 'pending' | 'active' | 'completed' | 'failed';
export type Difficulty = 'high' | 'medium' | 'low';
export type TaskStatus = 'pending' | 'in-progress' | 'completed';
export type PeakEnergyTime = 'morning' | 'afternoon' | 'night';

export interface Task {
  id: string;
  subject: string;
  description: string;
  notes?: string;
  dueDate: string; // ISO datetime string YYYY-MM-DDTHH:mm (hora opcional)
  difficulty: Difficulty;
  status: TaskStatus;
  createdAt: string; // ISO date string
}

export interface Block {
  id: string;
  type: BlockType;
  priority: BlockPriority;
  taskId?: string;
  duration: number; // in minutes
  startTime: string; // HH:mm format
  endTime: string;   // HH:mm format
  status: BlockStatus;
  date: string; // YYYY-MM-DD
  interruptions: number;
  task?: Task;
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
