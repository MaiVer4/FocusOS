import {
  Block,
  BlockType,
  BlockPriority,
  Difficulty,
  Task,
  TaskStatus,
  DailyMetrics,
  UserSettings,
  DailyHealthLog,
  DailyWorkoutLog,
  MealId,
  MealCustomOverride,
  SleepChecklistState,
  WeekendPlanMode,
} from './types';
import { addMinutesToTime, dateToStr, durationBetween, todayStr, isRoutineLabel, cleanBlockLabel, generateUUID } from './helpers';
import { cloudSync } from './cloud-sync';
import { notificationService } from './notifications';
import {
  analyzeHistory,
  LearnedProfile,
  getCategoryBonus,
  getOptimalDuration,
  smartAssignTasksToSlots,
} from './learning-engine';
import { generateAISchedule, generateAIMealAdaptation, resetAIClient } from './ai-engine';
import type { AIScheduleResult, AIProvider } from './ai-engine';
import {
  WORKOUT_SPLITS,
  MEAL_PROTOCOL,
  evaluateBiomechanicalGuard,
  BiomechanicalGuardAssessment,
} from './personal-protocol';

export interface DailyScheduleResult {
  blocks: Block[];
  insights?: string[];
  modeUsed: 'ai' | 'auto';
  notice?: string;
}

const STORAGE_KEYS = {
  tasks: 'focusos_tasks',
  blocks: 'focusos_blocks',
  metrics: 'focusos_metrics',
  settings: 'focusos_settings',
  profile: 'focusos_learned_profile',
  healthLogs: 'focusos_health_logs',
  workoutLogs: 'focusos_workout_logs',
} as const;

const DEFAULT_SETTINGS: UserSettings = {
  appName: 'FocusOS',
  wakeTime: '07:00',
  sleepTime: '22:30',
  scheduleStartTime: '12:00',
  scheduleEndTime: '18:00',
  arrivalTime: '18:45',
  peakEnergyTime: 'night',
  dailyDeepBlocksMin: 1,
  dailyDeepBlocksMax: 2,
  deepBlockDuration: 50,
  exerciseMandatory: true,
  exerciseDuration: 50,
  workoutSlot: 'morning',
  transportToSenaMinutes: 25,
  waterGoalMl: 2500,
  currentWeightKg: 47,
  targetWeightKg: 54,
  postureReminderMinutes: 45,
  mealTimes: {
    breakfast: '07:30',
    postWorkout: '10:30',
    senaLunch: '14:00',
    dinner: '20:00',
  },
  morningExerciseDuration: 50,
  nightExerciseDuration: 50,
  workBlockDuration: 30,
  personalProjectDuration: 25,
  socialMediaMaxMinutes: 15,
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

const _toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
};
const _toTime = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Agrega un bloque a la lista y avanza el cursor. Retorna nuevo cursor. */
function _push(
  blocks: TemplateBlock[],
  cursor: number,
  duration: number,
  type: BlockType,
  label: string,
  priority: BlockPriority,
  assignTask?: boolean
): number {
  if (duration <= 0) return cursor;
  blocks.push({
    type,
    label,
    startTime: _toTime(cursor),
    endTime: _toTime(cursor + duration),
    priority,
    assignTask,
  });
  return cursor + duration;
}

// ─── Generadores dinámicos de plantilla (Adaptados al Protocolo Clínico) ────

/** Lunes a Viernes — construido dinámicamente desde Settings y el protocolo clínico del usuario */
function generateWeekdayTemplate(
  s: UserSettings,
  dayOfWeek: number,
  workoutLogs: DailyWorkoutLog[],
  dateStr: string
): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  const wake = _toMin(s.wakeTime || '07:00');
  const sleep = _toMin(s.sleepTime || '22:30');

  let formalStart = _toMin(s.scheduleStartTime || '12:00');
  let formalEnd = _toMin(s.scheduleEndTime || '18:00');
  let arrival = _toMin(s.arrivalTime || '18:45');

  if (formalStart <= wake + 30 || formalEnd <= formalStart || formalEnd > sleep) {
    formalStart = 12 * 60;
    formalEnd = 18 * 60;
    arrival = 18 * 60 + 45;
  }

  const workoutSlot = s.workoutSlot ?? 'morning';
  const exDur = s.exerciseDuration || 50;
  const deepDur = s.deepBlockDuration || 50;
  const transportDur = s.transportToSenaMinutes ?? 25;

  const guard = evaluateBiomechanicalGuard(dateStr, workoutLogs);
  const splitInfo = WORKOUT_SPLITS[guard.recommendedSplit];
  const exerciseLabel = `Calistenia: ${splitInfo.shortTitle}`;

  const mealTimes = s.mealTimes ?? {
    breakfast: '07:30',
    postWorkout: '10:30',
    senaLunch: '14:00',
    dinner: '20:00',
  };

  let c = wake;

  // ═══ 1. DESPERTAR Y CRONOBIOLOGÍA (07:00 → 07:30) ═══
  const breakfastStart = Math.max(c + 15, _toMin(mealTimes.breakfast));
  if (breakfastStart > c) {
    c = _push(
      blocks,
      c,
      breakfastStart - c,
      'rest',
      'Despertar (1 alarma) · Luz solar + Vaso grande de agua',
      'high'
    );
  }

  // ═══ 2. DESAYUNO OBLIGATORIO (07:30 → 08:00) ═══
  c = _push(blocks, c, 30, 'rest', 'Desayuno obligatorio (Mín. 3 huevos + carbohidrato)', 'high');

  const transportStart = formalStart - transportDur;
  const postWorkoutStart = Math.min(
    Math.max(c + 60, _toMin(mealTimes.postWorkout)),
    transportStart - 35
  );

  // ═══ 3. VENTANA MATUTINA (08:00 → 10:30) ═══
  if (workoutSlot === 'morning') {
    // 08:00 -> 09:00: Estudio ligero mientras se hace digestión pre-entreno
    const targetExStart = Math.max(c, 9 * 60); // 9:00 a.m.
    if (targetExStart - c >= 20) {
      c = _push(blocks, c, targetExStart - c, 'light', 'Estudio ligero matutino', 'medium', true);
    }
    // 09:00 -> 09:50: Única sesión de Calistenia, Hipertrofia y Postura (50 min)
    if (s.exerciseMandatory && c + exDur <= transportStart - 20) {
      c = _push(blocks, c, exDur, 'exercise', exerciseLabel, 'high');
      // 09:50 -> 10:30: Ducha y alistarse
      const showerDur = Math.max(15, Math.min(40, postWorkoutStart - c));
      if (showerDur >= 15) {
        c = _push(blocks, c, showerDur, 'rest', 'Ducha y recuperación', 'low');
      }
    }
  } else {
    // Si entrena en la tarde: usar la mañana para Bloques Profundos de estudio
    if (c + deepDur <= postWorkoutStart) {
      c = _push(blocks, c, deepDur, 'deep', 'Bloque profundo 1 (Postura erguida)', 'high', true);
      if (c + 10 <= postWorkoutStart) {
        c = _push(blocks, c, 10, 'rest', 'Pausa postural (Retracción escapular)', 'low');
      }
    }
    if (c + deepDur <= postWorkoutStart) {
      c = _push(blocks, c, deepDur, 'deep', 'Bloque profundo 2', 'high', true);
    } else if (postWorkoutStart - c >= 20) {
      c = _push(blocks, c, postWorkoutStart - c, 'light', 'Estudio ligero matutino', 'medium', true);
    }
  }

  // ═══ 4. RECARGA POST-ENTRENO PRE-SENA + TERMO DE AGUA (10:30 → 11:00) ═══
  if (c < transportStart - 20) {
    const mealDur = Math.min(30, transportStart - c);
    c = _push(
      blocks,
      c,
      mealDur,
      'rest',
      'Recarga Post-Entreno (Pre-SENA) + Llenar termo de agua',
      'high'
    );
  }

  // Tiempo restante antes de salir al SENA
  if (transportStart - c >= 20) {
    c = _push(
      blocks,
      c,
      transportStart - c,
      'light',
      'Trabajo versátil / Alistarse para el SENA',
      'medium',
      true
    );
  } else if (transportStart > c) {
    c = _push(blocks, c, transportStart - c, 'rest', 'Alistarse para el SENA', 'low');
  }

  // ═══ 5. TRANSPORTE AL SENA (11:35 → 12:00) ═══
  c = _push(blocks, transportStart, transportDur, 'rest', 'Transporte al SENA', 'low');

  // ═══ 6. FORMACIÓN SENA + PAUSA DE ALMUERZO 2:00 P.M. (12:00 → 18:00) ═══
  const senaLunchMin = _toMin(mealTimes.senaLunch || '14:00');
  if (formalEnd > formalStart) {
    if (senaLunchMin > formalStart + 30 && senaLunchMin + 30 < formalEnd) {
      blocks.push({
        type: 'rest',
        label: 'SENA (Bloque 1 · Hidratación con termo)',
        startTime: _toTime(formalStart),
        endTime: _toTime(senaLunchMin),
        priority: 'high',
      });
      blocks.push({
        type: 'rest',
        label: 'Almuerzo en pausa del SENA',
        startTime: _toTime(senaLunchMin),
        endTime: _toTime(senaLunchMin + 30),
        priority: 'high',
      });
      blocks.push({
        type: 'rest',
        label: 'SENA (Bloque 2)',
        startTime: _toTime(senaLunchMin + 30),
        endTime: _toTime(formalEnd),
        priority: 'high',
      });
    } else {
      blocks.push({
        type: 'rest',
        label: 'SENA',
        startTime: _toTime(formalStart),
        endTime: _toTime(formalEnd),
        priority: 'high',
      });
    }
  }

  // ═══ 7. TRANSPORTE DE REGRESO (18:00 → 18:45) ═══
  if (arrival > formalEnd) {
    blocks.push({
      type: 'rest',
      label: 'Transporte de regreso',
      startTime: s.scheduleEndTime,
      endTime: s.arrivalTime,
      priority: 'low',
    });
  }

  // ═══ 8. TARDE / NOCHE (18:45 → 22:30) ═══
  c = Math.max(arrival, formalEnd);
  const dinnerMin = _toMin(mealTimes.dinner || '20:00');
  const disconnectMin = Math.max(c + 60, sleep - 30); // 22:00 (30 min antes de dormir a las 22:30)

  if (workoutSlot === 'morning') {
    // 18:45 -> 19:35: Bloque Profundo 1
    if (c + deepDur <= dinnerMin) {
      c = _push(blocks, c, deepDur, 'deep', 'Bloque profundo 1 (Postura erguida)', 'high', true);
    }
    // 19:35 -> 20:00: Pausa postural + preparar cena
    if (dinnerMin > c) {
      c = _push(
        blocks,
        c,
        dinnerMin - c,
        'rest',
        'Pausa postural (Escoliosis) y preparar cena',
        'low'
      );
    }
  } else {
    // Si entrena en la tarde: 18:45 -> 19:35 Calistenia + 19:35 -> 20:00 Ducha
    if (s.exerciseMandatory && c + exDur <= dinnerMin) {
      c = _push(blocks, c, exDur, 'exercise', exerciseLabel, 'high');
    }
    if (dinnerMin > c) {
      c = _push(blocks, c, dinnerMin - c, 'rest', 'Ducha post-entreno', 'low');
    }
  }

  // ═══ 9. CENA COMPLETA + CORTE DE AGUA (20:00 → 20:30) ═══
  if (c < disconnectMin - 30) {
    c = _push(
      blocks,
      c,
      30,
      'rest',
      'Cena completa + Corte de líquidos',
      'high'
    );
  }

  // ═══ 10. BLOQUE NOCTURNO (20:30 → 21:45, Modo luz cálida) ═══
  if (workoutSlot === 'morning' && c + deepDur <= disconnectMin - 15) {
    c = _push(
      blocks,
      c,
      deepDur,
      'deep',
      'Bloque profundo 2 (Modo luz cálida)',
      'high',
      true
    );
  } else if (c + 45 <= disconnectMin - 15) {
    c = _push(
      blocks,
      c,
      45,
      'light',
      'Proyectos personales / Repaso (Luz cálida)',
      'medium',
      true
    );
  }

  const remainingBeforeDisconnect = disconnectMin - c;
  if (remainingBeforeDisconnect >= 20) {
    const projectTime = Math.min(25, remainingBeforeDisconnect - 15);
    if (projectTime >= 15) {
      c = _push(blocks, c, projectTime, 'light', 'Proyectos personales / Repaso', 'medium', true);
    }
    if (disconnectMin - c >= 10) {
      c = _push(blocks, c, disconnectMin - c, 'rest', 'Redes sociales (Luz cálida)', 'low');
    }
  } else if (remainingBeforeDisconnect > 0) {
    c = _push(blocks, c, remainingBeforeDisconnect, 'rest', 'Pausa y orden nocturno', 'low');
  }

  // ═══ 11. DESCONEXIÓN DE PANTALLAS Y PROTOCOLO DE SUEÑO (22:00 → 22:30) ═══
  const windDown = Math.max(15, sleep - c);
  _push(
    blocks,
    c,
    windDown,
    'rest',
    'Desconexión de pantallas + Protocolo de sueño (Escoliosis)',
    'high'
  );

  return blocks;
}

/** Sábado (Día 6: Piernas y Core) — con soporte para Día Libre o Proyectos */
function generateSaturdayTemplate(
  s: UserSettings,
  weekendMode?: WeekendPlanMode,
  isOutOfRoutine?: boolean
): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  const wake = _toMin(s.wakeTime || '07:00');
  const sleep = _toMin(s.sleepTime || '22:30');
  const deepDur = s.deepBlockDuration || 50;
  const exDur = s.exerciseDuration || 50;
  const splitInfo = WORKOUT_SPLITS.legs;
  const isFree = isOutOfRoutine || weekendMode === 'free';

  let c = wake;

  c = _push(blocks, c, 30, 'rest', 'Despertar (1 alarma) · Luz solar + Vaso de agua', 'high');
  c = _push(blocks, c, 30, 'rest', 'Desayuno obligatorio (Mín. 3 huevos + arepa/pan)', 'high');

  if (isFree) {
    // Modo Libre / Fuera de Rutina
    c = _push(blocks, c, 90, 'rest', 'Mañana libre · Planes flexibles / Salida', 'low');
    if (s.exerciseMandatory) {
      c = _push(blocks, c, exDur, 'exercise', `Calistenia (Flexible): ${splitInfo.shortTitle}`, 'medium');
      c = _push(blocks, c, 25, 'rest', 'Ducha y recuperación', 'low');
    }
    c = _push(blocks, c, 25, 'rest', 'Recarga Post-Entreno (Licuado o sándwich)', 'high');

    const lunchTarget = Math.max(c, 13 * 60 + 30);
    if (lunchTarget > c) {
      c = _push(blocks, c, lunchTarget - c, 'rest', 'Tiempo libre / Salida', 'low');
    }
    c = _push(blocks, c, 45, 'rest', 'Almuerzo completo de casa (Granos + Arroz + Proteína)', 'high');

    const dinnerTarget = Math.max(c, 20 * 60);
    if (dinnerTarget > c) {
      c = _push(blocks, c, dinnerTarget - c, 'rest', 'Tarde libre fuera de rutina / Descanso', 'low');
    }
  } else {
    // Modo Proyectos en Casa
    c = _push(blocks, c, 60, 'light', 'Repaso / Lectura matutina', 'medium', true);

    // 09:00 - 09:50: Día 6 Piernas y Core
    if (s.exerciseMandatory) {
      c = _push(blocks, c, exDur, 'exercise', `Calistenia: ${splitInfo.shortTitle}`, 'high');
      c = _push(blocks, c, 25, 'rest', 'Ducha y recuperación', 'low');
    }

    c = _push(blocks, c, 25, 'rest', 'Recarga Post-Entreno (Licuado o sándwich)', 'high');

    // Bloques profundos de fin de semana
    c = _push(blocks, c, deepDur, 'deep', 'Proyecto personal – Bloque 1', 'high', true);
    c = _push(blocks, c, 10, 'rest', 'Pausa postural (Retracción escapular)', 'low');
    c = _push(blocks, c, deepDur, 'deep', 'Proyecto personal – Bloque 2', 'high', true);

    // Almuerzo 2:00 p.m.
    const lunchTarget = Math.max(c, 14 * 60);
    if (lunchTarget > c) {
      c = _push(blocks, c, lunchTarget - c, 'rest', 'Tiempo libre', 'low');
    }
    c = _push(blocks, c, 45, 'rest', 'Almuerzo completo de casa (Granos + Arroz + Proteína)', 'high');

    // Tarde libre hasta la cena de las 20:00
    const dinnerTarget = Math.max(c, 20 * 60);
    if (dinnerTarget > c) {
      c = _push(blocks, c, dinnerTarget - c, 'rest', 'Tiempo libre y descanso activo', 'low');
    }
  }

  c = _push(blocks, c, 30, 'rest', 'Cena completa + Corte de líquidos', 'high');

  const disconnectMin = Math.max(c, sleep - 30);
  if (disconnectMin > c) {
    c = _push(blocks, c, disconnectMin - c, 'rest', 'Tiempo libre moderado (Luz cálida)', 'low');
  }

  _push(blocks, c, Math.max(15, sleep - c), 'rest', 'Desconexión de pantallas + Protocolo de sueño (Escoliosis)', 'high');
  return blocks;
}

/** Domingo (Recuperación y Movilidad Postural) — con soporte para Día Libre o Enfoque */
function generateSundayTemplate(
  s: UserSettings,
  weekendMode?: WeekendPlanMode,
  isOutOfRoutine?: boolean
): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  const wake = _toMin(s.wakeTime || '07:00');
  const sleep = _toMin(s.sleepTime || '22:30');
  const isFree = isOutOfRoutine || weekendMode === 'free';

  let c = wake;

  c = _push(blocks, c, 30, 'rest', 'Despertar · Luz solar + Vaso de agua', 'high');
  c = _push(blocks, c, 35, 'rest', 'Desayuno obligatorio (Mín. 3 huevos)', 'high');

  // Mañana libre + recarga
  const midMorning = Math.max(c + 30, 10 * 60 + 30);
  if (midMorning > c) {
    c = _push(blocks, c, midMorning - c, 'rest', 'Mañana libre / Descanso familiar', 'low');
  }
  c = _push(blocks, c, 25, 'rest', 'Merienda de media mañana (Avena/Fruta/Leche)', 'medium');

  const lunchTarget = Math.max(c, 13 * 60 + 30);
  if (lunchTarget > c) {
    c = _push(blocks, c, lunchTarget - c, 'rest', 'Tiempo libre familiar / Salida', 'low');
  }

  c = _push(blocks, c, 50, 'rest', 'Almuerzo familiar completo', 'high');

  if (!isFree) {
    const planStart = Math.max(c, 16 * 60 + 30);
    if (planStart > c) {
      c = _push(blocks, c, planStart - c, 'rest', 'Tiempo libre', 'low');
    }
    c = _push(blocks, c, 50, 'light', 'Planear semana – entregas SENA y prioridades', 'high', true);
  }

  if (s.exerciseMandatory) {
    c = _push(blocks, c, 25, 'exercise', 'Movilidad torácica y descompresión de escoliosis', 'medium');
  }

  const dinnerTarget = Math.max(c, 20 * 60);
  if (dinnerTarget > c) {
    c = _push(blocks, c, dinnerTarget - c, 'rest', 'Descanso y preparación semanal', 'low');
  }

  c = _push(blocks, c, 30, 'rest', 'Cena completa + Corte de líquidos', 'high');

  const disconnectMin = Math.max(c, sleep - 30);
  if (disconnectMin > c) {
    c = _push(blocks, c, disconnectMin - c, 'rest', 'Relajación (Luz cálida)', 'low');
  }

  _push(blocks, c, Math.max(15, sleep - c), 'rest', 'Desconexión de pantallas + Protocolo de sueño (Escoliosis)', 'high');
  return blocks;
}

/** Retorna la plantilla adecuada según el día de la semana (0=dom … 6=sáb) */
function getTemplateForDay(
  dayOfWeek: number,
  settings: UserSettings,
  workoutLogs: DailyWorkoutLog[],
  dateStr: string,
  weekendMode?: WeekendPlanMode,
  isOutOfRoutine?: boolean
): TemplateBlock[] {
  if (dayOfWeek === 6) return generateSaturdayTemplate(settings, weekendMode, isOutOfRoutine);
  if (dayOfWeek === 0) return generateSundayTemplate(settings, weekendMode, isOutOfRoutine);
  return generateWeekdayTemplate(settings, dayOfWeek, workoutLogs, dateStr);
}

// ─── Smart Task Scheduling ──────────────────────────────────────────────────

const SESSIONS_PER_WEEK: Record<Difficulty, number> = {
  high: 5,
  medium: 3,
  low: 1,
};

function calculateTaskUrgency(task: Task, referenceDate: string, profile?: LearnedProfile | null): number {
  if (task.status === 'terminada') return -1;

  if (!task.dueDate) {
    let base = task.difficulty === 'high' ? 3 : task.difficulty === 'medium' ? 2 : 1;
    if (task.status === 'en-progreso' || task.status === 'en-progreso-aplazada') base += 2;
    if (profile) base *= getCategoryBonus(profile, task);
    return base;
  }

  const dueStr = task.dueDate.split('T')[0];
  const ref = new Date(referenceDate + 'T12:00:00');
  const due = new Date(dueStr + 'T12:00:00');
  const daysLeft = Math.ceil((due.getTime() - ref.getTime()) / 86_400_000);

  if (daysLeft < 0) return 1000 + Math.abs(daysLeft) * 10;
  if (daysLeft === 0) return 500;

  const sessionsPerWeek = SESSIONS_PER_WEEK[task.difficulty];
  let urgency = (sessionsPerWeek * 10) / Math.max(1, daysLeft);

  if (task.isDeliverable) urgency *= 1.5;
  if (task.difficulty === 'high' && daysLeft <= 3) urgency *= 2;
  if (profile) {
    urgency *= getCategoryBonus(profile, task);
  }

  return urgency;
}

function shouldScheduleTaskOnDay(task: Task, date: string): boolean {
  if (!task.dueDate || task.status === 'terminada' || task.status === 'aplazada') return false;
  const dueStr = task.dueDate.split('T')[0];
  if (date > dueStr) return true;
  return date <= dueStr;
}

function loadFromStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
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
  [STORAGE_KEYS.healthLogs]: 'health_logs',
  [STORAGE_KEYS.workoutLogs]: 'workout_logs',
};

let _storeInstance: Store | null = null;

function saveToStorage<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    const collection = CLOUD_COLLECTIONS[key];
    if (collection) cloudSync.uploadDebounced(collection, value);
    _storeInstance?.scheduleNotify();
  } catch (e) {
    console.error(`Error saving ${key} to localStorage:`, e);
  }
}

function createEmptyHealthLog(date: string): DailyHealthLog {
  return {
    date,
    waterMl: 0,
    outOfRoutine: false,
    weekendMode: undefined,
    mealsCompleted: {
      breakfast: false,
      post_workout: false,
      sena_lunch: false,
      dinner: false,
    },
    mealSelectedOption: {},
    mealCustomOverride: {},
    sleepChecklist: {
      waterCut830: false,
      blueLightOff: false,
      nasalWash: false,
      singleAlarmFar: false,
      sideOrBackPosture: false,
    },
    postureBreaksCount: 0,
  };
}

class Store {
  private tasks: Task[] = loadFromStorage<Task[]>(STORAGE_KEYS.tasks, []);
  private blocks: Block[] = loadFromStorage<Block[]>(STORAGE_KEYS.blocks, []);
  private metrics: DailyMetrics[] = loadFromStorage<DailyMetrics[]>(STORAGE_KEYS.metrics, []);
  private settings: UserSettings = {
    ...DEFAULT_SETTINGS,
    ...loadFromStorage<Partial<UserSettings>>(STORAGE_KEYS.settings, {}),
  };
  private profile: LearnedProfile | null = loadFromStorage<LearnedProfile | null>(STORAGE_KEYS.profile, null);
  private healthLogs: DailyHealthLog[] = loadFromStorage<DailyHealthLog[]>(STORAGE_KEYS.healthLogs, []);
  private workoutLogs: DailyWorkoutLog[] = loadFromStorage<DailyWorkoutLog[]>(STORAGE_KEYS.workoutLogs, []);

  constructor() {
    _storeInstance = this;
    this.migrateTaskStatuses();
    this.migrateSettings();
    this.migrateBlockLabels();
    saveToStorage(STORAGE_KEYS.settings, this.settings);
    this.refreshProfile();
  }

  /** Migra campos legacy de settings al nuevo protocolo clínico */
  private migrateSettings(): void {
    if (this.settings.geminiApiKey && !this.settings.aiApiKey) {
      this.settings.aiApiKey = this.settings.geminiApiKey;
      this.settings.aiProvider = this.settings.aiProvider ?? 'gemini';
    }
    if (this.settings.aiApiKey?.startsWith('AIza') && !this.settings.geminiApiKey) {
      this.settings.geminiApiKey = this.settings.aiApiKey;
    }
    if (this.settings.aiApiKey?.startsWith('gsk_') && !this.settings.groqApiKey) {
      this.settings.groqApiKey = this.settings.aiApiKey;
    }

    if (
      !this.settings.scheduleStartTime ||
      this.settings.scheduleStartTime < '09:00' ||
      this.settings.scheduleEndTime === '23:00' ||
      this.settings.scheduleEndTime <= this.settings.scheduleStartTime
    ) {
      this.settings.scheduleStartTime = '12:00';
      this.settings.scheduleEndTime = '18:00';
      this.settings.arrivalTime = '18:45';
    }

    // Migrar wakeTime 08:30 y sleepTime 23:00 legacy al protocolo 07:00 - 22:30 si no se habían configurado los nuevos campos
    if (!this.settings.workoutSlot) {
      this.settings.workoutSlot = 'morning';
      if (this.settings.wakeTime === '08:30') this.settings.wakeTime = '07:00';
      if (this.settings.sleepTime === '23:00') this.settings.sleepTime = '22:30';
      if (this.settings.exerciseDuration === 25) this.settings.exerciseDuration = 50;
    }

    if (!this.settings.wakeTime || this.settings.wakeTime < '05:00') {
      this.settings.wakeTime = '07:00';
    }
    if (!this.settings.sleepTime) {
      this.settings.sleepTime = '22:30';
    }
    if (!this.settings.arrivalTime || this.settings.arrivalTime <= this.settings.scheduleEndTime) {
      this.settings.arrivalTime = '18:45';
    }
    if (!this.settings.mealTimes) {
      this.settings.mealTimes = {
        breakfast: '07:30',
        postWorkout: '10:30',
        senaLunch: '14:00',
        dinner: '20:00',
      };
    }
    if (!this.settings.waterGoalMl) this.settings.waterGoalMl = 2500;
    if (!this.settings.currentWeightKg) this.settings.currentWeightKg = 47;
    if (!this.settings.targetWeightKg) this.settings.targetWeightKg = 54;
    if (!this.settings.transportToSenaMinutes) this.settings.transportToSenaMinutes = 25;
    if (!this.settings.postureReminderMinutes) this.settings.postureReminderMinutes = 45;
  }

  private migrateTaskStatuses(): void {
    const statusMap: Record<string, TaskStatus> = {
      pending: 'sin-iniciar',
      'in-progress': 'en-progreso',
      completed: 'terminada',
    };
    let changed = false;
    this.tasks = this.tasks.map((t) => {
      const mapped = statusMap[t.status as string];
      if (mapped) {
        changed = true;
        return { ...t, status: mapped };
      }
      return t;
    });
    if (changed) saveToStorage(STORAGE_KEYS.tasks, this.tasks);
  }

  private migrateBlockLabels(): void {
    let changed = false;
    this.blocks = this.blocks.map((b) => {
      if (b.label) {
        const cleaned = cleanBlockLabel(b.label);
        if (cleaned !== b.label) {
          changed = true;
          return { ...b, label: cleaned };
        }
      }
      return b;
    });
    if (changed) saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  // ─── Cloud Sync & Listeners ────────────────────────────────────────────────

  private listeners: Array<() => void> = [];
  private notifyPending = false;
  private batchDepth = 0;

  subscribe(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach((fn) => fn());
  }

  batch(fn: () => void): void {
    this.batchDepth++;
    try {
      fn();
    } finally {
      this.batchDepth--;
      if (this.batchDepth === 0 && this.notifyPending) {
        this.notifyPending = false;
        this.notifyListeners();
      }
    }
  }

  scheduleNotify(): void {
    if (this.batchDepth > 0) {
      this.notifyPending = true;
      return;
    }
    if (this.notifyPending) return;
    this.notifyPending = true;
    queueMicrotask(() => {
      if (this.notifyPending) {
        this.notifyPending = false;
        this.notifyListeners();
      }
    });
  }

  reloadFromStorage(): void {
    this.tasks = loadFromStorage<Task[]>(STORAGE_KEYS.tasks, []);
    this.blocks = loadFromStorage<Block[]>(STORAGE_KEYS.blocks, []);
    this.metrics = loadFromStorage<DailyMetrics[]>(STORAGE_KEYS.metrics, []);
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...loadFromStorage<Partial<UserSettings>>(STORAGE_KEYS.settings, {}),
    };
    this.healthLogs = loadFromStorage<DailyHealthLog[]>(STORAGE_KEYS.healthLogs, []);
    this.workoutLogs = loadFromStorage<DailyWorkoutLog[]>(STORAGE_KEYS.workoutLogs, []);
    this.refreshProfile();
    this.notifyListeners();
  }

  // ─── Health, Nutrition & Workout Logs ──────────────────────────────────────

  getHealthLog(date: string): DailyHealthLog {
    const existing = this.healthLogs.find((h) => h.date === date);
    if (existing) {
      return {
        ...createEmptyHealthLog(date),
        ...existing,
        mealsCompleted: {
          ...createEmptyHealthLog(date).mealsCompleted,
          ...(existing.mealsCompleted ?? {}),
        },
        sleepChecklist: {
          ...createEmptyHealthLog(date).sleepChecklist!,
          ...(existing.sleepChecklist ?? {}),
        },
      };
    }
    return createEmptyHealthLog(date);
  }

  getAllHealthLogs(): DailyHealthLog[] {
    return this.healthLogs;
  }

  updateHealthLog(date: string, updates: Partial<DailyHealthLog>): void {
    this.batch(() => {
      const current = this.getHealthLog(date);
      const updated: DailyHealthLog = {
        ...current,
        ...updates,
        date,
      };
      const idx = this.healthLogs.findIndex((h) => h.date === date);
      if (idx !== -1) {
        this.healthLogs = this.healthLogs.map((h) => (h.date === date ? updated : h));
      } else {
        this.healthLogs = [...this.healthLogs, updated];
      }
      saveToStorage(STORAGE_KEYS.healthLogs, this.healthLogs);

      if (updates.weightKg && updates.weightKg > 30) {
        this.settings = { ...this.settings, currentWeightKg: updates.weightKg };
        saveToStorage(STORAGE_KEYS.settings, this.settings);
      }

      this.recalcDailyMetrics(date);
    });
  }

  addWater(date: string, deltaMl: number): void {
    const log = this.getHealthLog(date);
    const nextWater = Math.max(0, Math.min(5000, (log.waterMl || 0) + deltaMl));
    this.updateHealthLog(date, { waterMl: nextWater });
  }

  toggleMeal(date: string, mealId: MealId, selectedOptionId?: string): void {
    const log = this.getHealthLog(date);
    const nextCompleted = !log.mealsCompleted[mealId];
    const mealsCompleted = { ...log.mealsCompleted, [mealId]: nextCompleted };
    const mealSelectedOption = { ...log.mealSelectedOption };
    if (selectedOptionId) {
      mealSelectedOption[mealId] = selectedOptionId;
    } else if (!mealSelectedOption[mealId]) {
      mealSelectedOption[mealId] = MEAL_PROTOCOL[mealId].options[0]?.id;
    }
    this.updateHealthLog(date, { mealsCompleted, mealSelectedOption });
  }

  selectMealOption(date: string, mealId: MealId, optionId: string): void {
    const log = this.getHealthLog(date);
    this.updateHealthLog(date, {
      mealSelectedOption: { ...log.mealSelectedOption, [mealId]: optionId },
    });
  }

  setMealCustomOverride(date: string, mealId: MealId, override: MealCustomOverride | null): void {
    const log = this.getHealthLog(date);
    const mealCustomOverride = { ...log.mealCustomOverride };
    if (override) {
      mealCustomOverride[mealId] = override;
    } else {
      delete mealCustomOverride[mealId];
    }
    this.updateHealthLog(date, { mealCustomOverride });
  }

  async adaptMealWithAI(
    date: string,
    mealId: MealId,
    availableIngredients: string[],
    customText: string
  ): Promise<MealCustomOverride> {
    const { provider, apiKey } = this.getAIConfig();
    const override = await generateAIMealAdaptation(
      provider,
      apiKey,
      mealId,
      availableIngredients,
      customText
    );
    this.setMealCustomOverride(date, mealId, override);
    return override;
  }

  toggleSleepCheckItem(date: string, key: keyof SleepChecklistState): void {
    const log = this.getHealthLog(date);
    const currentSleep = log.sleepChecklist ?? createEmptyHealthLog(date).sleepChecklist!;
    this.updateHealthLog(date, {
      sleepChecklist: {
        ...currentSleep,
        [key]: !currentSleep[key],
      },
    });
  }

  incrementPostureBreak(date: string): void {
    const log = this.getHealthLog(date);
    this.updateHealthLog(date, {
      postureBreaksCount: (log.postureBreaksCount ?? 0) + 1,
    });
  }

  getBiomechanicalGuard(date: string): BiomechanicalGuardAssessment {
    return evaluateBiomechanicalGuard(date, this.workoutLogs);
  }

  getWorkoutLog(date: string): DailyWorkoutLog {
    const existing = this.workoutLogs.find((w) => w.date === date);
    if (existing) return existing;

    const guard = this.getBiomechanicalGuard(date);
    const splitDef = WORKOUT_SPLITS[guard.recommendedSplit];
    const exercises: DailyWorkoutLog['exercises'] = {};
    for (const ex of splitDef.exercises) {
      exercises[ex.id] = {
        setsDone: 0,
        repsAchieved: ex.reps,
        backpackWeightNote: ex.usesBackpack ? 'Morral con libros' : '',
      };
    }

    return {
      date,
      splitType: guard.recommendedSplit,
      completed: false,
      backpackWeightKg: 4,
      exercises,
    };
  }

  getAllWorkoutLogs(): DailyWorkoutLog[] {
    return this.workoutLogs;
  }

  saveWorkoutLog(date: string, log: DailyWorkoutLog): void {
    this.batch(() => {
      const idx = this.workoutLogs.findIndex((w) => w.date === date);
      if (idx !== -1) {
        this.workoutLogs = this.workoutLogs.map((w) => (w.date === date ? log : w));
      } else {
        this.workoutLogs = [...this.workoutLogs, log];
      }
      saveToStorage(STORAGE_KEYS.workoutLogs, this.workoutLogs);
      this.recalcDailyMetrics(date);
    });
  }

  // ─── Out of Routine & Weekend Mode ──────────────────────────────────────────

  isOutOfRoutine(date: string): boolean {
    return !!this.getHealthLog(date).outOfRoutine;
  }

  toggleOutOfRoutine(date: string, forceState?: boolean): boolean {
    const current = this.getHealthLog(date);
    const nextState = forceState !== undefined ? forceState : !current.outOfRoutine;
    this.updateHealthLog(date, { outOfRoutine: nextState });

    if (nextState) {
      const dayBlocks = this.getBlocks(date);
      dayBlocks.forEach((b) => {
        if (b.status === 'pending' && (b.type === 'deep' || b.type === 'light')) {
          b.label = `[Fuera de rutina] ${cleanBlockLabel(b.label)}`;
        }
      });
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    }
    this.recalcDailyMetrics(date);
    return nextState;
  }

  getWeekendPlanMode(date: string): WeekendPlanMode | undefined {
    return this.getHealthLog(date).weekendMode;
  }

  setWeekendPlanMode(date: string, mode: WeekendPlanMode): Block[] {
    this.updateHealthLog(date, { weekendMode: mode, outOfRoutine: mode === 'free' });
    const dayBlocks = this.getBlocks(date);
    const hasCompleted = dayBlocks.some((b) => b.status === 'completed');

    if (!hasCompleted) {
      this.blocks = this.blocks.filter((b) => b.date !== date);
      const dayOfWeek = new Date(date + 'T12:00:00').getDay();
      const template = getTemplateForDay(
        dayOfWeek,
        this.settings,
        this.workoutLogs,
        date,
        mode,
        mode === 'free'
      );
      const newBlocks: Block[] = template.map((t) => ({
        id: generateUUID(),
        date,
        type: t.type,
        label: t.label,
        priority: t.priority,
        duration: durationBetween(t.startTime, t.endTime),
        startTime: t.startTime,
        endTime: t.endTime,
        status: 'pending',
        interruptions: 0,
      }));
      this.blocks = [...this.blocks, ...newBlocks];
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
      this.recalcDailyMetrics(date);
      return newBlocks;
    }
    this.recalcDailyMetrics(date);
    return dayBlocks;
  }

  postponeBlock(blockId: string, minutes = 15): boolean {
    const block = this.blocks.find((b) => b.id === blockId);
    if (!block) return false;

    const [eh, em] = block.endTime.split(':').map(Number);
    const newEndMin = eh * 60 + em + minutes;
    if (newEndMin >= 24 * 60) return false;

    block.endTime = _toTime(newEndMin);
    block.duration = Math.max(10, durationBetween(block.startTime, block.endTime));

    this.reorganizeFromNow(block.date);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    this.scheduleNotify();
    return true;
  }

  // ─── Tasks ─────────────────────────────────────────────────────────────────

  getTasks(): Task[] {
    return this.tasks;
  }

  getTask(id: string): Task | undefined {
    return this.tasks.find((t) => t.id === id);
  }

  findTaskByExternalId(externalId: string): Task | undefined {
    return this.tasks.find((t) => t.externalId === externalId);
  }

  getTasksBySource(source: 'classroom' | 'calendar' | 'manual'): Task[] {
    return this.tasks.filter((t) => t.source === source);
  }

  addTask(task: Task): void {
    this.tasks = [...this.tasks, { ...task, _v: Date.now() } as Task];
    saveToStorage(STORAGE_KEYS.tasks, this.tasks);
    if (task.dueDate) {
      this.autoAssignBlock(task);
    } else {
      const today = todayStr();
      if (this.getBlocks(today).length > 0) {
        this.assignUnblockedTasks(today);
      }
    }
  }

  private autoAssignBlock(task: Task): void {
    if (!task.dueDate || task.status === 'terminada') return;

    const today = todayStr();
    if (!shouldScheduleTaskOnDay(task, today)) return;

    const existingBlocks = this.getBlocks(today);
    if (existingBlocks.length === 0) return;
    if (existingBlocks.some((b) => b.taskId === task.id)) return;

    const duration =
      task.difficulty === 'high' ? 90 : task.difficulty === 'medium' ? 60 : 45;
    const priority =
      task.isDeliverable || task.difficulty === 'high'
        ? 'high'
        : task.difficulty === 'medium'
          ? 'medium'
          : 'low';

    const freeSlot = this.findNextFreeSlot(today, duration, this.settings.arrivalTime);
    const startTime = freeSlot ?? this.settings.arrivalTime;
    const endTime = addMinutesToTime(startTime, duration);

    const block: Block = {
      id: generateUUID(),
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
    this.batch(() => {
      const oldTask = this.tasks.find((t) => t.id === id);
      const oldDate = oldTask?.dueDate?.split('T')[0];

      this.tasks = this.tasks.map((t) =>
        t.id === id ? { ...t, ...updates, _v: Date.now() } : t
      );
      saveToStorage(STORAGE_KEYS.tasks, this.tasks);

      const updatedTask = this.tasks.find((t) => t.id === id);
      const newDate = updatedTask?.dueDate?.split('T')[0];

      this.blocks = this.blocks.map((b) =>
        b.taskId === id ? { ...b, task: updatedTask, _v: Date.now() } : b
      );
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);

      if (oldDate && newDate && oldDate !== newDate && updatedTask) {
        this.autoAssignBlock(updatedTask);
      } else if (newDate) {
        if (updates.difficulty && oldTask && updates.difficulty !== oldTask.difficulty) {
          const newDuration =
            updates.difficulty === 'high' ? 90 : updates.difficulty === 'medium' ? 60 : 45;
          const newPriority =
            updatedTask?.isDeliverable || updates.difficulty === 'high'
              ? 'high'
              : updates.difficulty === 'medium'
                ? 'medium'
                : 'low';
          const taskBlock = this.blocks.find(
            (b) => b.taskId === id && b.status === 'pending'
          );
          if (taskBlock) {
            this.blocks = this.blocks.map((b) =>
              b.id === taskBlock.id
                ? {
                    ...b,
                    duration: newDuration,
                    endTime: addMinutesToTime(b.startTime, newDuration),
                    priority: newPriority,
                    _v: Date.now(),
                  }
                : b
            );
            saveToStorage(STORAGE_KEYS.blocks, this.blocks);
            this.reorganizeBlocks(taskBlock.date);
          }
        }

        if (updatedTask && !this.blocks.some((b) => b.taskId === id)) {
          this.autoAssignBlock(updatedTask);
        }
      }

      if (updates.status === 'terminada' && newDate) {
        this.reorganizeBlocks(newDate);
      }
    });
  }

  deleteTask(id: string): void {
    this.batch(() => {
      cloudSync.trackDeletion('tasks', id);
      const affectedDates = new Set(
        this.blocks.filter((b) => b.taskId === id).map((b) => b.date)
      );

      this.tasks = this.tasks.filter((t) => t.id !== id);
      saveToStorage(STORAGE_KEYS.tasks, this.tasks);

      this.blocks = this.blocks.map((b) =>
        b.taskId === id ? { ...b, taskId: undefined, task: undefined, _v: Date.now() } : b
      );
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);

      for (const date of affectedDates) {
        this.assignUnblockedTasks(date);
        this.reorganizeBlocks(date);
      }
    });
  }

  private assignUnblockedTasks(date: string): void {
    const dayBlocks = this.getBlocks(date);
    const tasksWithBlocks = new Set(
      dayBlocks.filter((b) => b.taskId).map((b) => b.taskId!)
    );
    const dayTasks = this.getTasksForDayWithCarryOver(date).filter(
      (t) => !tasksWithBlocks.has(t.id) && t.status !== 'terminada'
    );

    const freeBlocks = dayBlocks.filter(
      (b) =>
        !b.taskId &&
        b.status === 'pending' &&
        b.type !== 'rest' &&
        b.type !== 'exercise' &&
        !isRoutineLabel(b.label ?? '')
    );

    if (dayTasks.length === 0 || freeBlocks.length === 0) return;

    if (this.profile && this.profile.totalBlocksAnalyzed >= 10) {
      const blockSlots = freeBlocks.map((b, i) => ({
        index: i,
        type: b.type,
        startTime: b.startTime,
      }));
      const assignment = smartAssignTasksToSlots(dayTasks, blockSlots, this.profile);
      for (const [idx, task] of assignment) {
        const block = freeBlocks[idx];
        this.blocks = this.blocks.map((b) =>
          b.id === block.id
            ? { ...b, taskId: task.id, task, label: task.subject, _v: Date.now() }
            : b
        );
      }
    } else {
      const toAssign = Math.min(dayTasks.length, freeBlocks.length);
      for (let i = 0; i < toAssign; i++) {
        const block = freeBlocks[i];
        const task = dayTasks[i];
        this.blocks = this.blocks.map((b) =>
          b.id === block.id
            ? { ...b, taskId: task.id, task, label: task.subject, _v: Date.now() }
            : b
        );
      }
    }
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  toggleSubtask(taskId: string, subtaskId: string): void {
    const task = this.tasks.find((t) => t.id === taskId);
    if (!task || !task.subtasks) return;
    const subtasks = task.subtasks.map((s) =>
      s.id === subtaskId ? { ...s, done: !s.done } : s
    );
    this.updateTask(taskId, { subtasks });
  }

  getTasksForDayWithCarryOver(date: string): Task[] {
    const activeTasks = this.tasks.filter(
      (t) => t.status !== 'terminada' && t.status !== 'aplazada'
    );

    const schedulable = activeTasks.filter(
      (t) => t.dueDate && shouldScheduleTaskOnDay(t, date)
    );

    const noDateTasks = activeTasks.filter((t) => !t.dueDate);

    const seen = new Set<string>();
    const all: Task[] = [];
    for (const t of [...schedulable, ...noDateTasks]) {
      if (!seen.has(t.id)) {
        seen.add(t.id);
        all.push(t);
      }
    }

    return all.sort((a, b) => {
      const ua = calculateTaskUrgency(a, date, this.profile);
      const ub = calculateTaskUrgency(b, date, this.profile);
      return ub - ua;
    });
  }

  hasBlockOverlap(
    date: string,
    startTime: string,
    endTime: string,
    excludeId?: string
  ): boolean {
    const blocks = this.getBlocks(date).filter((b) => !excludeId || b.id !== excludeId);
    return blocks.some((b) => startTime < b.endTime && endTime > b.startTime);
  }

  findNextFreeSlot(date: string, duration: number, fromTime: string): string | null {
    const blocks = this.getBlocks(date).sort((a, b) => a.startTime.localeCompare(b.startTime));
    let candidate = fromTime;

    for (const b of blocks) {
      const endMin = _toMin(candidate) + duration;
      const bStartMin = _toMin(b.startTime);
      if (endMin <= bStartMin) return candidate;
      const bEndMin = _toMin(b.endTime);
      if (bEndMin > _toMin(candidate)) candidate = addMinutesToTime(b.endTime, 5);
    }

    if (_toMin(candidate) + duration <= 24 * 60) return candidate;
    return null;
  }

  generateBlocksFromTasks(date: string): Block[] {
    const tasks = this.getTasksForDayWithCarryOver(date);
    const existingBlocks = this.getBlocks(date);
    const tasksWithBlocks = new Set(
      existingBlocks.filter((b) => b.taskId).map((b) => b.taskId!)
    );
    const unassigned = tasks.filter(
      (t) => !tasksWithBlocks.has(t.id) && t.status !== 'terminada'
    );

    if (unassigned.length === 0) return [];

    const newBlocks: Block[] = [];

    for (const task of unassigned) {
      const duration =
        task.difficulty === 'high' ? 90 : task.difficulty === 'medium' ? 60 : 45;

      const startTime = this.findNextFreeSlot(date, duration, this.settings.arrivalTime);
      if (!startTime) continue;

      const endTime = addMinutesToTime(startTime, duration);
      const priority =
        task.isDeliverable || task.difficulty === 'high'
          ? 'high'
          : task.difficulty === 'medium'
            ? 'medium'
            : 'low';

      const block: Block = {
        id: generateUUID(),
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

  generateFromTemplate(date: string): Block[] {
    const existing = this.getBlocks(date);
    if (existing.length > 0) return [];

    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const hLog = this.getHealthLog(date);
    const template = getTemplateForDay(
      dayOfWeek,
      this.settings,
      this.workoutLogs,
      date,
      hLog.weekendMode,
      hLog.outOfRoutine
    );

    const tasks = this.getTasksForDayWithCarryOver(date);
    const newBlocks: Block[] = [];

    const blockSlots: Array<{ index: number; type: BlockType; startTime: string }> = [];

    for (let i = 0; i < template.length; i++) {
      const tmpl = template[i];
      let duration = durationBetween(tmpl.startTime, tmpl.endTime);

      if (this.profile && this.profile.totalBlocksAnalyzed >= 10) {
        if (tmpl.type === 'deep') {
          const optimal = getOptimalDuration(this.profile, 'deep');
          if (Math.abs(optimal - duration) > 15) {
            duration = Math.max(20, Math.min(optimal, 120));
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
        id: generateUUID(),
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

      if (tmpl.type !== 'rest' && tmpl.type !== 'exercise') {
        blockSlots.push({ index: i, type: tmpl.type, startTime: tmpl.startTime });
      }
    }

    if (tasks.length > 0 && blockSlots.length > 0) {
      if (this.profile && this.profile.totalBlocksAnalyzed >= 10) {
        const assignment = smartAssignTasksToSlots(tasks, blockSlots, this.profile);
        for (const [blockIdx, task] of assignment) {
          newBlocks[blockIdx].taskId = task.id;
          newBlocks[blockIdx].task = task;
        }
      } else {
        const taskQueue = [...tasks];
        for (const slot of blockSlots) {
          if (taskQueue.length === 0) break;
          const task = taskQueue.shift()!;
          newBlocks[slot.index].taskId = task.id;
          newBlocks[slot.index].task = task;
        }
      }
    }

    for (const block of newBlocks) {
      this.addBlock(block);
    }

    return newBlocks;
  }

  reorganizeBlocks(date: string, anchorId?: string): void {
    const dayBlocks = this.getBlocks(date);
    if (dayBlocks.length <= 1) return;

    const fixedLabels = [
      'sena',
      'actividades formales',
      'transporte de regreso',
      'transporte al sena',
      'transporte hacia el sena',
      'vestirse y prepararse',
      'prepararse para el sena',
      'preparación para el sena',
      'preparación y transporte',
      'almuerzo en pausa del sena',
    ];
    const isFixed = (b: Block) =>
      b.status === 'completed' ||
      b.status === 'active' ||
      fixedLabels.some((l) => (b.label ?? '').toLowerCase().includes(l)) ||
      b.id === anchorId;

    const fixed = dayBlocks.filter(isFixed);
    const movable = dayBlocks.filter((b) => !isFixed(b));

    movable.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const occupied: Array<{ start: string; end: string }> = fixed.map((b) => ({
      start: b.startTime,
      end: b.endTime,
    }));
    occupied.sort((a, b) => a.start.localeCompare(b.start));

    const placed: Block[] = [...fixed];
    const idsToRemove = new Set<string>();

    for (const block of movable) {
      let candidate = block.startTime;

      let changed = true;
      while (changed) {
        changed = false;
        for (const occ of occupied) {
          const candidateEnd = addMinutesToTime(candidate, block.duration);
          if (candidate < occ.end && candidateEnd > occ.start) {
            candidate = occ.end;
            changed = true;
          }
        }
      }

      const candidateEndMin = _toMin(candidate) + block.duration;
      if (candidateEndMin > 24 * 60) {
        if (block.type === 'rest' && block.priority === 'low') {
          idsToRemove.add(block.id);
          continue;
        }
        occupied.push({ start: block.startTime, end: block.endTime });
        occupied.sort((a, b) => a.start.localeCompare(b.start));
        placed.push(block);
        continue;
      }

      const newEnd =
        candidateEndMin === 24 * 60 ? '23:59' : addMinutesToTime(candidate, block.duration);

      block.startTime = candidate;
      block.endTime = newEnd;
      occupied.push({ start: candidate, end: newEnd });
      occupied.sort((a, b) => a.start.localeCompare(b.start));
      placed.push(block);
    }

    const placedIds = new Set(placed.map((b) => b.id));
    this.blocks = this.blocks.filter((b) => b.date !== date || placedIds.has(b.id));
    for (const p of placed) {
      this.blocks = this.blocks.map((b) =>
        b.id === p.id
          ? {
              ...b,
              startTime: p.startTime,
              endTime: p.endTime,
              duration: p.duration,
              _v: Date.now(),
            }
          : b
      );
    }
    this.blocks = this.blocks.filter((b) => !idsToRemove.has(b.id));
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  reorganizeFromNow(date: string): number {
    const s = this.settings;
    const dayOfWeek = new Date(date + 'T12:00:00').getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const isToday = date === todayStr();

    const dayBlocks = this.getBlocks(date);
    if (dayBlocks.length === 0) return 0;

    let modifiedCount = 0;

    if (!isWeekend) {
      const formalStart = _toMin(s.scheduleStartTime);
      const formalEnd = _toMin(s.scheduleEndTime);
      const arrival = _toMin(s.arrivalTime);
      const transportDur = s.transportToSenaMinutes ?? 25;
      const transportStart = formalStart - transportDur;

      for (const b of dayBlocks) {
        if (b.status === 'completed' || b.status === 'failed') continue;
        const label = (b.label ?? '').toLowerCase();

        if (label === 'sena' || label.includes('actividades formales')) {
          if (b.startTime !== s.scheduleStartTime || b.endTime !== s.scheduleEndTime) {
            b.startTime = s.scheduleStartTime;
            b.endTime = s.scheduleEndTime;
            b.duration = Math.max(15, formalEnd - formalStart);
            modifiedCount++;
          }
        } else if (
          label.includes('transporte al sena') ||
          label.includes('transporte hacia el sena')
        ) {
          const targetStart = _toTime(transportStart);
          const targetEnd = s.scheduleStartTime;
          if (b.startTime !== targetStart || b.endTime !== targetEnd) {
            b.startTime = targetStart;
            b.endTime = targetEnd;
            b.duration = transportDur;
            modifiedCount++;
          }
        } else if (label.includes('transporte de regreso')) {
          if (b.startTime !== s.scheduleEndTime || b.endTime !== s.arrivalTime) {
            b.startTime = s.scheduleEndTime;
            b.endTime = s.arrivalTime;
            b.duration = Math.max(15, arrival - formalEnd);
            modifiedCount++;
          }
        }
      }
    }

    const now = new Date();
    const currentMinutes = isToday
      ? now.getHours() * 60 + now.getMinutes()
      : _toMin(s.wakeTime);
    let cursor = Math.ceil((currentMinutes + 2) / 5) * 5;

    dayBlocks.sort((a, b) => a.startTime.localeCompare(b.startTime));

    for (const b of dayBlocks) {
      const label = (b.label ?? '').toLowerCase();
      if (
        b.status === 'completed' ||
        b.status === 'failed' ||
        label.includes('sena') ||
        label.includes('transporte')
      ) {
        const endMin = _toMin(b.endTime);
        if (endMin > cursor) cursor = endMin;
        continue;
      }

      if (isToday) {
        const bEndMin = _toMin(b.endTime);
        if (bEndMin <= currentMinutes) continue;

        const bStartMin = _toMin(b.startTime);
        if (bStartMin < cursor) {
          const duration = b.duration;
          const newStart = _toTime(cursor);
          const newEnd = _toTime(cursor + duration);

          if (_toMin(newEnd) <= 23 * 60 + 59) {
            b.startTime = newStart;
            b.endTime = newEnd;
            cursor += duration;
            modifiedCount++;
          }
        } else {
          cursor = Math.max(cursor, _toMin(b.endTime));
        }
      }
    }

    this.reorganizeBlocks(date);
    this.assignUnblockedTasks(date);

    if (notificationService.hasPermission()) {
      this.getBlocks(date).forEach((b) => notificationService.scheduleBlockNotifications(b));
    }

    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    this.notifyListeners();

    return Math.max(modifiedCount, 1);
  }

  // ─── Blocks ────────────────────────────────────────────────────────────────

  getBlocks(date?: string): Block[] {
    if (date) return this.blocks.filter((b) => b.date === date);
    return this.blocks;
  }

  getBlock(id: string): Block | undefined {
    return this.blocks.find((b) => b.id === id);
  }

  addBlock(block: Block): void {
    this.blocks = [...this.blocks, { ...block, _v: Date.now() } as Block];

    if (
      block.type !== 'rest' &&
      block.type !== 'exercise' &&
      !block.taskId &&
      !isRoutineLabel(block.label ?? '')
    ) {
      const dayBlocks = this.blocks.filter((b) => b.date === block.date);
      const tasksWithBlocks = new Set(
        dayBlocks.filter((b) => b.taskId).map((b) => b.taskId!)
      );
      const available = this.getTasksForDayWithCarryOver(block.date).filter(
        (t) => !tasksWithBlocks.has(t.id) && t.status !== 'terminada'
      );

      if (available.length > 0) {
        const task = available[0];
        this.blocks = this.blocks.map((b) =>
          b.id === block.id ? { ...b, taskId: task.id, task, _v: Date.now() } : b
        );
      }
    }

    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
  }

  updateBlock(id: string, updates: Partial<Block>): void {
    this.batch(() => {
      this.blocks = this.blocks.map((b) =>
        b.id === id ? { ...b, ...updates, _v: Date.now() } : b
      );
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);

      const block = this.blocks.find((b) => b.id === id);
      if (block) {
        // Si se completó el bloque de ejercicio, marcar workoutLog del día como completado
        if (block.type === 'exercise' && updates.status === 'completed') {
          const wLog = this.getWorkoutLog(block.date);
          if (!wLog.completed) {
            this.saveWorkoutLog(block.date, { ...wLog, completed: true });
          }
        }
        this.recalcDailyMetrics(block.date);
        if (
          updates.startTime !== undefined ||
          updates.endTime !== undefined ||
          updates.duration !== undefined
        ) {
          this.reorganizeBlocks(block.date, id);
        }
      }

      if (updates.status === 'completed' || updates.status === 'failed') {
        this.refreshProfile();
      }
    });
  }

  deleteBlock(id: string): void {
    this.batch(() => {
      cloudSync.trackDeletion('blocks', id);
      const block = this.blocks.find((b) => b.id === id);
      this.blocks = this.blocks.filter((b) => b.id !== id);
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
      if (block?.date) {
        this.recalcDailyMetrics(block.date);
        this.reorganizeBlocks(block.date);
      }
    });
  }

  deleteAllBlocksForDate(date: string): void {
    const blocksToDelete = this.blocks.filter((b) => b.date === date);
    cloudSync.trackDeletions(
      'blocks',
      blocksToDelete.map((b) => b.id)
    );
    this.blocks = this.blocks.filter((b) => b.date !== date);
    saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    this.recalcDailyMetrics(date);
  }

  deleteAllTasks(): void {
    this.batch(() => {
      cloudSync.trackDeletions(
        'tasks',
        this.tasks.map((t) => t.id)
      );
      const affectedDates = new Set(
        this.blocks.filter((b) => b.taskId).map((b) => b.date)
      );

      this.tasks = [];
      saveToStorage(STORAGE_KEYS.tasks, this.tasks);
      this.blocks = this.blocks.map((b) =>
        b.taskId ? { ...b, taskId: undefined, task: undefined, _v: Date.now() } : b
      );
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);

      for (const date of affectedDates) {
        this.reorganizeBlocks(date);
      }
    });
  }

  // ─── Metrics ───────────────────────────────────────────────────────────────

  getMetrics(startDate?: string, endDate?: string): DailyMetrics[] {
    if (startDate && endDate) {
      return this.metrics.filter((m) => m.date >= startDate && m.date <= endDate);
    }
    return this.metrics;
  }

  getMetricsForDate(date: string): DailyMetrics | null {
    return this.metrics.find((m) => m.date === date) ?? null;
  }

  recalcDailyMetrics(date: string): void {
    if (!date) return;
    const blocks = this.getBlocks(date);
    const blocksPlanned = blocks.length;
    const blocksCompleted = blocks.filter((b) => b.status === 'completed').length;
    const blocksFailed = blocks.filter((b) => b.status === 'failed').length;
    const interruptions = blocks.reduce((sum, b) => sum + (b.interruptions ?? 0), 0);
    const deepWorkHours = blocks
      .filter((b) => b.type === 'deep' && b.status === 'completed')
      .reduce((sum, b) => sum + b.duration / 60, 0);
    const biologicalScore = this.calculateBiologicalScore(date);
    const focusScore = this.calculateFocusScore(date);
    const disciplineScore = this.calculateDailyScore(date);

    const hLog = this.healthLogs.find((h) => h.date === date);
    const wLog = this.workoutLogs.find((w) => w.date === date);
    const mealsCompletedCount = hLog
      ? Object.values(hLog.mealsCompleted ?? {}).filter(Boolean).length
      : undefined;

    const metric: DailyMetrics = {
      date,
      blocksPlanned,
      blocksCompleted,
      blocksFailed,
      interruptions,
      deepWorkHours,
      disciplineScore,
      biologicalScore,
      focusScore,
      energyLevel: hLog?.energyLevel,
      weightKg: hLog?.weightKg,
      waterMl: hLog?.waterMl,
      mealsCompletedCount,
      workoutSplit: wLog?.splitType,
      workoutCompleted: wLog?.completed,
    };

    const index = this.metrics.findIndex((m) => m.date === date);
    if (index !== -1) {
      this.metrics = this.metrics.map((m) => (m.date === date ? metric : m));
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
    const currentProvider = updates.aiProvider ?? this.settings.aiProvider ?? 'groq';
    if (updates.groqApiKey !== undefined && currentProvider === 'groq') {
      updates.aiApiKey = updates.groqApiKey;
    } else if (updates.geminiApiKey !== undefined && currentProvider === 'gemini') {
      updates.aiApiKey = updates.geminiApiKey;
    }

    this.settings = { ...this.settings, ...updates };
    localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings));
    cloudSync.uploadImmediate('settings', this.settings);
    this.scheduleNotify();
    if (
      updates.aiApiKey !== undefined ||
      updates.geminiApiKey !== undefined ||
      updates.groqApiKey !== undefined ||
      updates.aiProvider !== undefined
    ) {
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
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    const today = dateToStr(now);
    return (
      this.getBlocks(today).find(
        (b) =>
          b.startTime <= currentTime &&
          b.endTime > currentTime &&
          b.status !== 'completed' &&
          b.status !== 'failed'
      ) ?? null
    );
  }

  getNextBlock(): Block | null {
    const now = new Date();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(
      now.getMinutes()
    ).padStart(2, '0')}`;
    const today = dateToStr(now);
    const sorted = this.getBlocks(today).sort((a, b) => a.startTime.localeCompare(b.startTime));
    return sorted.find((b) => b.startTime > currentTime && b.status === 'pending') ?? null;
  }

  calculateBiologicalScore(date: string): number {
    const hLog = this.getHealthLog(date);
    const wLog = this.getWorkoutLog(date);

    // 1. Nutrición (40%): 4 comidas caseras completas (~10% c/u)
    const mealsDone = Object.values(hLog.mealsCompleted ?? {}).filter(Boolean).length;
    const nutritionScore = Math.min(40, mealsDone * 10);

    // 2. Calistenia / Escoliosis 2:1 (30%):
    const guard = this.getBiomechanicalGuard(date);
    const isRestDay = guard.recommendedSplit === 'rest';
    let workoutScore = 0;
    if (isRestDay) {
      workoutScore = 30; // Día de descanso biomecánico respetado
    } else if (wLog.completed) {
      workoutScore = 30;
    } else {
      const setsDone = Object.values(wLog.exercises ?? {}).filter((e) => e.setsDone > 0).length;
      workoutScore = setsDone > 0 ? 15 : 0;
    }

    // 3. Hidratación (20%): Meta 2500 ml
    const waterScore = Math.min(20, Math.round(((hLog.waterMl || 0) / 2500) * 20));

    // 4. Sueño y Desconexión (10%):
    const sleepChecks = hLog.sleepChecklist ?? {
      waterCut830: false,
      blueLightOff: false,
      nasalWash: false,
      singleAlarmFar: false,
      sideOrBackPosture: false,
    };
    const sleepCount = Object.values(sleepChecks).filter(Boolean).length;
    const sleepScore = Math.min(10, Math.round((sleepCount / 5) * 10));

    return Math.min(100, nutritionScore + workoutScore + waterScore + sleepScore);
  }

  calculateFocusScore(date: string): number {
    const hLog = this.getHealthLog(date);
    if (hLog.outOfRoutine) return 100;

    const blocks = this.getBlocks(date);
    const studyBlocks = blocks.filter((b) => b.type === 'deep' || b.type === 'light');
    if (studyBlocks.length === 0) return 100;

    const completed = studyBlocks.filter((b) => b.status === 'completed').length;
    const failed = studyBlocks.filter((b) => b.status === 'failed').length;
    const interruptions = studyBlocks.reduce((sum, b) => sum + (b.interruptions ?? 0), 0);

    let base = Math.round((completed / studyBlocks.length) * 100);
    base -= failed * 10;
    base -= interruptions * 3;
    return Math.max(0, Math.min(100, base));
  }

  calculateDailyScore(date: string): number {
    const hLog = this.getHealthLog(date);
    const bioScore = this.calculateBiologicalScore(date);
    if (hLog.outOfRoutine) {
      return bioScore;
    }
    const focusScore = this.calculateFocusScore(date);
    // Modo Híbrido acordado: 70% Biológico (no negociables) + 30% Enfoque/Estudio
    return Math.round(bioScore * 0.7 + focusScore * 0.3);
  }

  cleanExpiredBlocks(): number {
    const now = new Date();
    const today = dateToStr(now);
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const grace = 10;

    const before = this.blocks.length;
    this.blocks = this.blocks.filter((b) => {
      if (b.status === 'completed' || b.status === 'failed') return true;
      if (b.date > today) return true;
      if (b.date === today) {
        const [eh, em] = b.endTime.split(':').map(Number);
        const endMinutes = eh * 60 + em;
        return currentMinutes < endMinutes + grace;
      }
      return false;
    });

    const removed = before - this.blocks.length;
    if (removed > 0) {
      saveToStorage(STORAGE_KEYS.blocks, this.blocks);
    }
    return removed;
  }

  // ─── AI Integration ───────────────────────────────────────────────────────

  isAIEnabled(): boolean {
    const { apiKey } = this.getAIConfig();
    return !!apiKey && apiKey.trim().length > 10;
  }

  private getAIConfig(): { provider: AIProvider; apiKey: string } {
    const provider = this.settings.aiProvider ?? 'groq';
    let apiKey = '';
    if (provider === 'groq') {
      apiKey =
        this.settings.groqApiKey ||
        (this.settings.aiProvider === 'groq' ? this.settings.aiApiKey : '') ||
        (!this.settings.aiApiKey?.startsWith('AIza') ? this.settings.aiApiKey : '') ||
        '';
    } else {
      apiKey =
        this.settings.geminiApiKey ||
        (this.settings.aiProvider === 'gemini' ? this.settings.aiApiKey : '') ||
        (!this.settings.aiApiKey?.startsWith('gsk_') ? this.settings.aiApiKey : '') ||
        '';
    }
    return { provider, apiKey: apiKey.trim() };
  }

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
      existing
    );

    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    const newBlocks: Block[] = [];
    const isWeekday = dayOfWeek >= 1 && dayOfWeek <= 5;
    const toMin = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const formalStartMin = toMin(this.settings.scheduleStartTime);
    const formalEndMin = toMin(this.settings.scheduleEndTime);
    const arrivalMin = toMin(this.settings.arrivalTime);
    const senaLunchMin = toMin(this.settings.mealTimes?.senaLunch || '14:00');

    for (const aiBlock of result.blocks) {
      const [sh, sm] = aiBlock.startTime.split(':').map(Number);
      const [eh, em] = aiBlock.endTime.split(':').map(Number);
      const duration = eh * 60 + em - (sh * 60 + sm);

      if (duration <= 0) continue;

      if (isWeekday) {
        const bStart = sh * 60 + sm;
        const bEnd = eh * 60 + em;
        const labelLower = (aiBlock.label ?? '').toLowerCase();
        const isFormalOrTransport =
          labelLower.includes('sena') ||
          labelLower.includes('formal') ||
          labelLower.includes('transporte');
        if (isFormalOrTransport || (bStart < arrivalMin && bEnd > formalStartMin)) {
          continue;
        }
      }

      const validTaskId =
        aiBlock.taskId && taskMap.has(aiBlock.taskId) ? aiBlock.taskId : undefined;
      const task = validTaskId ? taskMap.get(validTaskId) : undefined;

      const block: Block = {
        id: generateUUID(),
        type: aiBlock.type,
        label: task ? task.subject : aiBlock.label,
        priority: task?.isDeliverable ? 'high' : aiBlock.priority,
        taskId: validTaskId,
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

    // Entre semana: inyectar bloque SENA fijo con pausa de almuerzo a las 2:00 p.m. + transporte de regreso
    if (isWeekday) {
      if (senaLunchMin > formalStartMin + 30 && senaLunchMin + 30 < formalEndMin) {
        const sena1: Block = {
          id: generateUUID(),
          type: 'rest',
          label: 'SENA (Bloque 1 · Hidratación con termo)',
          priority: 'high',
          duration: senaLunchMin - formalStartMin,
          startTime: this.settings.scheduleStartTime,
          endTime: _toTime(senaLunchMin),
          status: 'pending',
          date,
          interruptions: 0,
        };
        const senaLunch: Block = {
          id: generateUUID(),
          type: 'rest',
          label: 'Almuerzo en pausa del SENA',
          priority: 'high',
          duration: 30,
          startTime: _toTime(senaLunchMin),
          endTime: _toTime(senaLunchMin + 30),
          status: 'pending',
          date,
          interruptions: 0,
        };
        const sena2: Block = {
          id: generateUUID(),
          type: 'rest',
          label: 'SENA (Bloque 2)',
          priority: 'high',
          duration: formalEndMin - (senaLunchMin + 30),
          startTime: _toTime(senaLunchMin + 30),
          endTime: this.settings.scheduleEndTime,
          status: 'pending',
          date,
          interruptions: 0,
        };
        this.addBlock(sena1);
        this.addBlock(senaLunch);
        this.addBlock(sena2);
        newBlocks.push(sena1, senaLunch, sena2);
      } else {
        const senaBlock: Block = {
          id: generateUUID(),
          type: 'rest',
          label: 'SENA',
          priority: 'high',
          duration: formalEndMin - formalStartMin,
          startTime: this.settings.scheduleStartTime,
          endTime: this.settings.scheduleEndTime,
          status: 'pending',
          date,
          interruptions: 0,
        };
        this.addBlock(senaBlock);
        newBlocks.push(senaBlock);
      }

      if (arrivalMin > formalEndMin) {
        const transportBlock: Block = {
          id: generateUUID(),
          type: 'rest',
          label: 'Transporte de regreso',
          priority: 'low',
          duration: arrivalMin - formalEndMin,
          startTime: this.settings.scheduleEndTime,
          endTime: this.settings.arrivalTime,
          status: 'pending',
          date,
          interruptions: 0,
        };
        this.addBlock(transportBlock);
        newBlocks.push(transportBlock);
      }
    }

    this.assignUnblockedTasks(date);
    this.reorganizeBlocks(date);

    const finalBlocks = this.getBlocks(date).sort((a, b) =>
      a.startTime.localeCompare(b.startTime)
    );
    return { blocks: finalBlocks, insights: result.insights };
  }

  async generateDailySchedule(
    date: string,
    options?: { replaceExisting?: boolean }
  ): Promise<DailyScheduleResult> {
    if (options?.replaceExisting) {
      notificationService.cancelAllNotifications();
      this.deleteAllBlocksForDate(date);
    } else if (this.getBlocks(date).length > 0) {
      throw new Error('Ya existen bloques para este día.');
    }

    // 1. Si la IA está disponible, intentar con IA
    if (this.isAIEnabled()) {
      try {
        const aiResult = await this.generateWithAI(date);
        if (notificationService.hasPermission()) {
          aiResult.blocks.forEach((b) => notificationService.scheduleBlockNotifications(b));
        }
        return {
          blocks: aiResult.blocks,
          insights: aiResult.insights,
          modeUsed: 'ai',
        };
      } catch (err: unknown) {
        console.warn('[SmartPlanner] Fallback a plantilla clínica tras error de IA:', err);
        // Fallback resiliente al motor local
        const localBlocks = this.generateFromTemplate(date);
        this.reorganizeBlocks(date);
        if (notificationService.hasPermission()) {
          localBlocks.forEach((b) => notificationService.scheduleBlockNotifications(b));
        }
        return {
          blocks: localBlocks,
          modeUsed: 'auto',
          notice: 'La IA no estuvo disponible. Se generó tu horario con el protocolo clínico base.',
        };
      }
    }

    // 2. Motor local determinista directo (sin IA o sin clave)
    const localBlocks = this.generateFromTemplate(date);
    this.reorganizeBlocks(date);
    if (notificationService.hasPermission()) {
      localBlocks.forEach((b) => notificationService.scheduleBlockNotifications(b));
    }

    return {
      blocks: localBlocks,
      modeUsed: 'auto',
    };
  }

  // ─── Learning Profile ──────────────────────────────────────────────────────

  getProfile(): LearnedProfile | null {
    return this.profile;
  }

  refreshProfile(): void {
    const terminal = this.blocks.filter(
      (b) => b.status === 'completed' || b.status === 'failed'
    );
    if (terminal.length < 5) {
      this.profile = null;
      return;
    }
    this.profile = analyzeHistory(this.blocks, this.tasks);
    saveToStorage(STORAGE_KEYS.profile, this.profile);
  }
}

export const store = new Store();
export { DEFAULT_SETTINGS };
