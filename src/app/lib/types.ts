export type BlockType = 'deep' | 'light' | 'exercise' | 'rest';
export type BlockPriority = 'high' | 'medium' | 'low';
export type BlockStatus = 'pending' | 'active' | 'completed' | 'failed';
export type Difficulty = 'high' | 'medium' | 'low';
export type TaskStatus = 'sin-iniciar' | 'en-progreso' | 'en-progreso-aplazada' | 'aplazada' | 'terminada';
export type PeakEnergyTime = 'morning' | 'afternoon' | 'night';
export type WorkoutSlot = 'morning' | 'evening';
export type WorkoutSplitType = 'push' | 'pull' | 'legs' | 'rest';
export type MealId = 'breakfast' | 'post_workout' | 'sena_lunch' | 'dinner';

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
  assignedDate?: string;    // fecha de asignación en Classroom (cuándo se publicó)
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
}

export interface MealCustomOverride {
  title: string;
  description: string;
  macros: string;
  ingredientsUsed: string[];
  generatedByAI?: boolean;
}

export interface SleepChecklistState {
  waterCut830: boolean;
  blueLightOff: boolean;
  nasalWash: boolean;
  singleAlarmFar: boolean;
  sideOrBackPosture: boolean;
}

export interface DailyHealthLog {
  date: string; // YYYY-MM-DD
  waterMl: number; // Meta: 2200 - 2500 ml
  mealsCompleted: Record<MealId, boolean>;
  mealSelectedOption: Partial<Record<MealId, string>>;
  mealCustomOverride: Partial<Record<MealId, MealCustomOverride>>;
  energyLevel?: number; // 1 - 10 (base: 4-5, meta: 8-9)
  weightKg?: number;    // base: 47 kg, meta: 53-55 kg
  sleepChecklist?: SleepChecklistState;
  postureBreaksCount?: number;
}

export interface ExerciseSetProgress {
  setsDone: number;
  repsAchieved: string;
  backpackWeightNote: string;
}

export interface DailyWorkoutLog {
  date: string; // YYYY-MM-DD
  splitType: WorkoutSplitType;
  completed: boolean;
  backpackWeightKg: number;
  exercises: Record<string, ExerciseSetProgress>;
  notes?: string;
}

export interface DailyMetrics {
  date: string;
  blocksPlanned: number;
  blocksCompleted: number;
  blocksFailed: number;
  interruptions: number;
  deepWorkHours: number;
  disciplineScore: number;
  energyLevel?: number;
  weightKg?: number;
  waterMl?: number;
  mealsCompletedCount?: number;
  workoutSplit?: WorkoutSplitType;
  workoutCompleted?: boolean;
}

export interface MealScheduleTimes {
  breakfast: string;   // default '07:30'
  postWorkout: string; // default '10:30'
  senaLunch: string;   // default '14:00'
  dinner: string;      // default '20:00'
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
  deepBlockDuration: number; // in minutes (45-60 min)
  exerciseMandatory: boolean;
  exerciseDuration: number; // 45-60 min single effective session
  workoutSlot?: WorkoutSlot; // 'morning' (09:00-09:50) | 'evening' (18:45-19:35)
  transportToSenaMinutes?: number; // default 25 min
  waterGoalMl?: number; // default 2500 ml
  currentWeightKg?: number; // default 47 kg
  targetWeightKg?: number; // default 54 kg
  postureReminderMinutes?: number; // default 45 min
  mealTimes?: MealScheduleTimes;
  morningExerciseDuration?: number; // legacy
  nightExerciseDuration?: number;   // legacy
  workBlockDuration?: number;        // trabajo versátil 30 min
  personalProjectDuration?: number;  // proyectos personales 20 min
  socialMediaMaxMinutes: number;    // 15-20 min
  aiProvider?: 'groq' | 'gemini';   // Proveedor de IA (default: groq)
  aiApiKey?: string;                // API key activa (Groq o Gemini)
  groqApiKey?: string;              // API key específica para Groq
  geminiApiKey?: string;            // API key específica para Gemini
}
