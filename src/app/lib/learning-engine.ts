/**
 * ─── Learning Engine ─────────────────────────────────────────────────────────
 *
 * Motor de aprendizaje que analiza el historial de bloques y tareas del usuario
 * para generar un perfil de productividad y mejorar la organización automática.
 *
 * Aprende:
 *  1. Franjas horarias más productivas (por tipo de bloque)
 *  2. Duración real promedio vs estimada (ajustar bloques futuros)
 *  3. Tasa de éxito por franja horaria y tipo de bloque
 *  4. Patrones por día de la semana
 *  5. Categorías de tarea más/menos productivas por hora
 *  6. Tasa de interrupciones por franja
 */

import { Block, BlockType, Task } from './types';

// ─── Tipos del perfil aprendido ──────────────────────────────────────────────

/** Franja horaria de 2 horas */
export type TimeSlot =
  | '06-08' | '08-10' | '10-12' | '12-14'
  | '14-16' | '16-18' | '18-20' | '20-22' | '22-00';

/** Estadísticas por franja horaria */
export interface SlotStats {
  completed: number;
  failed: number;
  total: number;
  totalInterruptions: number;
  /** Duración estimada promedio (min) */
  avgPlannedDuration: number;
  /** Tasa de éxito 0–1 */
  successRate: number;
  /** Interrupciones promedio por bloque */
  avgInterruptions: number;
  /** Puntuación de productividad 0–100 */
  productivityScore: number;
}

/** Estadísticas por tipo de bloque */
export interface TypeStats {
  completed: number;
  failed: number;
  total: number;
  avgDuration: number;
  successRate: number;
}

/** Estadísticas por día de la semana (0=dom … 6=sáb) */
export interface DayStats {
  completed: number;
  failed: number;
  total: number;
  successRate: number;
  avgScore: number;
  /** Mejor franja horaria para deep work este día */
  bestDeepSlot: TimeSlot | null;
}

/** Estadísticas por categoría de tarea */
export interface CategoryStats {
  completed: number;
  failed: number;
  total: number;
  successRate: number;
  /** Mejores franjas para esta categoría */
  bestSlots: TimeSlot[];
}

/** Perfil aprendido completo */
export interface LearnedProfile {
  /** Última vez que se recalculó (ISO string) */
  lastUpdated: string;
  /** Cantidad de bloques analizados */
  totalBlocksAnalyzed: number;
  /** Estadísticas por franja horaria */
  slotStats: Record<TimeSlot, SlotStats>;
  /** Estadísticas por tipo de bloque y franja */
  typeBySlot: Record<BlockType, Partial<Record<TimeSlot, SlotStats>>>;
  /** Estadísticas por tipo de bloque global */
  typeStats: Record<BlockType, TypeStats>;
  /** Estadísticas por día de la semana */
  dayStats: Record<number, DayStats>;
  /** Estadísticas por categoría de tarea */
  categoryStats: Record<string, CategoryStats>;
  /** Ranking de franjas horarias para deep work (mejor a peor) */
  bestDeepSlots: TimeSlot[];
  /** Ranking de franjas horarias para light work */
  bestLightSlots: TimeSlot[];
  /** Duración óptima promedio de bloques deep (aprendida) */
  optimalDeepDuration: number;
  /** Duración óptima promedio de bloques light (aprendida) */
  optimalLightDuration: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const ALL_SLOTS: TimeSlot[] = [
  '06-08', '08-10', '10-12', '12-14',
  '14-16', '16-18', '18-20', '20-22', '22-00',
];

function timeToSlot(time: string): TimeSlot {
  const hour = parseInt(time.split(':')[0], 10);
  if (hour < 6) return '06-08';
  if (hour < 8) return '06-08';
  if (hour < 10) return '08-10';
  if (hour < 12) return '10-12';
  if (hour < 14) return '12-14';
  if (hour < 16) return '14-16';
  if (hour < 18) return '16-18';
  if (hour < 20) return '18-20';
  if (hour < 22) return '20-22';
  return '22-00';
}

function emptySlotStats(): SlotStats {
  return {
    completed: 0, failed: 0, total: 0,
    totalInterruptions: 0,
    avgPlannedDuration: 0,
    successRate: 0,
    avgInterruptions: 0,
    productivityScore: 50,
  };
}

function emptyTypeStats(): TypeStats {
  return { completed: 0, failed: 0, total: 0, avgDuration: 0, successRate: 0 };
}

function emptyDayStats(): DayStats {
  return { completed: 0, failed: 0, total: 0, successRate: 0, avgScore: 50, bestDeepSlot: null };
}

function emptyProfile(): LearnedProfile {
  const slotStats: Record<TimeSlot, SlotStats> = {} as any;
  for (const s of ALL_SLOTS) slotStats[s] = emptySlotStats();

  const typeBySlot: Record<BlockType, Partial<Record<TimeSlot, SlotStats>>> = {
    deep: {}, light: {}, exercise: {}, rest: {},
  };

  const typeStats: Record<BlockType, TypeStats> = {
    deep: emptyTypeStats(),
    light: emptyTypeStats(),
    exercise: emptyTypeStats(),
    rest: emptyTypeStats(),
  };

  const dayStats: Record<number, DayStats> = {};
  for (let d = 0; d <= 6; d++) dayStats[d] = emptyDayStats();

  return {
    lastUpdated: new Date().toISOString(),
    totalBlocksAnalyzed: 0,
    slotStats,
    typeBySlot,
    typeStats,
    dayStats,
    categoryStats: {},
    bestDeepSlots: ['20-22', '18-20', '22-00'],
    bestLightSlots: ['08-10', '10-12', '22-00'],
    optimalDeepDuration: 45,
    optimalLightDuration: 50,
  };
}

// ─── Motor principal ─────────────────────────────────────────────────────────

/**
 * Analiza el historial completo de bloques y genera un perfil de productividad.
 * Solo procesa bloques en estado terminal (completed/failed) para aprender
 * de resultados reales, no de intenciones.
 */
export function analyzeHistory(blocks: Block[], tasks: Task[]): LearnedProfile {
  const profile = emptyProfile();

  // Filtrar solo bloques terminados (tienen resultado real)
  const terminal = blocks.filter(b =>
    b.status === 'completed' || b.status === 'failed'
  );

  if (terminal.length === 0) return profile;

  profile.totalBlocksAnalyzed = terminal.length;

  // Índice de tareas por ID para lookup rápido
  const taskMap = new Map<string, Task>();
  for (const t of tasks) taskMap.set(t.id, t);

  // Acumuladores para duración
  const durationAccum: Record<BlockType, number[]> = {
    deep: [], light: [], exercise: [], rest: [],
  };

  // ─── Procesar cada bloque terminado ─────────────────────────────────────
  for (const block of terminal) {
    const slot = timeToSlot(block.startTime);
    const dayOfWeek = new Date(block.date + 'T12:00:00').getDay();
    const isCompleted = block.status === 'completed';

    // — Slot stats —
    const ss = profile.slotStats[slot];
    ss.total++;
    if (isCompleted) ss.completed++;
    else ss.failed++;
    ss.totalInterruptions += block.interruptions ?? 0;

    // — Type global stats —
    const ts = profile.typeStats[block.type];
    ts.total++;
    if (isCompleted) ts.completed++;
    else ts.failed++;
    durationAccum[block.type].push(block.duration);

    // — Type by slot —
    if (!profile.typeBySlot[block.type][slot]) {
      profile.typeBySlot[block.type][slot] = emptySlotStats();
    }
    const tbs = profile.typeBySlot[block.type][slot]!;
    tbs.total++;
    if (isCompleted) tbs.completed++;
    else tbs.failed++;
    tbs.totalInterruptions += block.interruptions ?? 0;

    // — Day stats —
    const ds = profile.dayStats[dayOfWeek];
    ds.total++;
    if (isCompleted) ds.completed++;
    else ds.failed++;

    // — Category stats —
    if (block.taskId) {
      const task = block.task ?? taskMap.get(block.taskId);
      if (task?.category) {
        const cat = task.category.toLowerCase();
        if (!profile.categoryStats[cat]) {
          profile.categoryStats[cat] = {
            completed: 0, failed: 0, total: 0,
            successRate: 0, bestSlots: [],
          };
        }
        const cs = profile.categoryStats[cat];
        cs.total++;
        if (isCompleted) cs.completed++;
        else cs.failed++;
      }
    }
  }

  // ─── Calcular promedios y rankings ──────────────────────────────────────

  // Slot stats finales
  for (const slot of ALL_SLOTS) {
    const ss = profile.slotStats[slot];
    if (ss.total > 0) {
      ss.successRate = ss.completed / ss.total;
      ss.avgInterruptions = ss.totalInterruptions / ss.total;
      // Score: éxito ponderado + penalización por interrupciones
      ss.productivityScore = Math.round(
        ss.successRate * 100 - ss.avgInterruptions * 10
      );
      ss.productivityScore = Math.max(0, Math.min(100, ss.productivityScore));
    }
  }

  // Type stats finales
  for (const type of ['deep', 'light', 'exercise', 'rest'] as BlockType[]) {
    const ts = profile.typeStats[type];
    if (ts.total > 0) {
      ts.successRate = ts.completed / ts.total;
      const durations = durationAccum[type];
      ts.avgDuration = durations.length > 0
        ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length)
        : 0;
    }

    // Type by slot finales
    for (const slot of ALL_SLOTS) {
      const tbs = profile.typeBySlot[type][slot];
      if (tbs && tbs.total > 0) {
        tbs.successRate = tbs.completed / tbs.total;
        tbs.avgInterruptions = tbs.totalInterruptions / tbs.total;
        tbs.productivityScore = Math.round(
          tbs.successRate * 100 - tbs.avgInterruptions * 10
        );
        tbs.productivityScore = Math.max(0, Math.min(100, tbs.productivityScore));
      }
    }
  }

  // Day stats finales
  for (let d = 0; d <= 6; d++) {
    const ds = profile.dayStats[d];
    if (ds.total > 0) {
      ds.successRate = ds.completed / ds.total;
      ds.avgScore = Math.round(ds.successRate * 100);

      // Mejor slot para deep work en este día
      let bestScore = -1;
      let bestSlot: TimeSlot | null = null;
      for (const slot of ALL_SLOTS) {
        const tbs = profile.typeBySlot['deep'][slot];
        if (tbs && tbs.total >= 2 && tbs.productivityScore > bestScore) {
          bestScore = tbs.productivityScore;
          bestSlot = slot;
        }
      }
      ds.bestDeepSlot = bestSlot;
    }
  }

  // Category stats finales
  for (const cat of Object.keys(profile.categoryStats)) {
    const cs = profile.categoryStats[cat];
    if (cs.total > 0) {
      cs.successRate = cs.completed / cs.total;
    }
  }

  // ─── Rankings globales de franjas ───────────────────────────────────────

  // Mejor franja para deep work
  profile.bestDeepSlots = ALL_SLOTS
    .filter(s => {
      const tbs = profile.typeBySlot['deep'][s];
      return tbs && tbs.total >= 2;
    })
    .sort((a, b) => {
      const sa = profile.typeBySlot['deep'][a]!.productivityScore;
      const sb = profile.typeBySlot['deep'][b]!.productivityScore;
      return sb - sa;
    });

  // Si no hay suficientes datos, usar defaults basados en slot stats general
  if (profile.bestDeepSlots.length === 0) {
    profile.bestDeepSlots = ALL_SLOTS
      .filter(s => profile.slotStats[s].total >= 2)
      .sort((a, b) => profile.slotStats[b].productivityScore - profile.slotStats[a].productivityScore)
      .slice(0, 3);
  }

  // Mejor franja para light work
  profile.bestLightSlots = ALL_SLOTS
    .filter(s => {
      const tbs = profile.typeBySlot['light'][s];
      return tbs && tbs.total >= 2;
    })
    .sort((a, b) => {
      const sa = profile.typeBySlot['light'][a]!.productivityScore;
      const sb = profile.typeBySlot['light'][b]!.productivityScore;
      return sb - sa;
    });

  // Duraciones óptimas aprendidas
  if (durationAccum['deep'].length >= 3) {
    // Usar mediana de duraciones completadas exitosamente
    const completedDeep = terminal
      .filter(b => b.type === 'deep' && b.status === 'completed')
      .map(b => b.duration)
      .sort((a, b) => a - b);
    if (completedDeep.length >= 3) {
      profile.optimalDeepDuration = completedDeep[Math.floor(completedDeep.length / 2)];
    }
  }

  if (durationAccum['light'].length >= 3) {
    const completedLight = terminal
      .filter(b => b.type === 'light' && b.status === 'completed')
      .map(b => b.duration)
      .sort((a, b) => a - b);
    if (completedLight.length >= 3) {
      profile.optimalLightDuration = completedLight[Math.floor(completedLight.length / 2)];
    }
  }

  // Mejores slots por categoría
  for (const cat of Object.keys(profile.categoryStats)) {
    const catBlocks = terminal.filter(b => {
      const task = b.task ?? (b.taskId ? taskMap.get(b.taskId) : undefined);
      return task?.category?.toLowerCase() === cat && b.status === 'completed';
    });

    const slotCount: Partial<Record<TimeSlot, number>> = {};
    for (const b of catBlocks) {
      const slot = timeToSlot(b.startTime);
      slotCount[slot] = (slotCount[slot] ?? 0) + 1;
    }

    profile.categoryStats[cat].bestSlots = (Object.entries(slotCount) as [TimeSlot, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([slot]) => slot);
  }

  profile.lastUpdated = new Date().toISOString();
  return profile;
}

// ─── Funciones de consulta del perfil ────────────────────────────────────────

/**
 * Devuelve un score de productividad (0–100) para una combinación de
 * tipo de bloque + franja horaria. Útil para decidir dónde colocar bloques.
 */
export function getProductivityScore(
  profile: LearnedProfile,
  type: BlockType,
  time: string
): number {
  const slot = timeToSlot(time);

  // Si hay datos específicos para este tipo + slot, usarlos
  const typeSlot = profile.typeBySlot[type]?.[slot];
  if (typeSlot && typeSlot.total >= 2) {
    return typeSlot.productivityScore;
  }

  // Fallback: usar stats generales de la franja
  const slotStat = profile.slotStats[slot];
  if (slotStat.total >= 2) {
    return slotStat.productivityScore;
  }

  // Sin datos: score neutral
  return 50;
}

/**
 * Sugiere la mejor franja horaria para un tipo de bloque dado.
 * Retorna la hora de inicio ideal (HH:mm).
 */
export function suggestBestTime(
  profile: LearnedProfile,
  type: BlockType
): string {
  const slots = type === 'deep' ? profile.bestDeepSlots
    : type === 'light' ? profile.bestLightSlots
    : [];

  if (slots.length === 0) return '19:30'; // default

  // Convertir slot a hora de inicio
  const slotToTime: Record<TimeSlot, string> = {
    '06-08': '06:00', '08-10': '08:00', '10-12': '10:00',
    '12-14': '12:00', '14-16': '14:00', '16-18': '16:00',
    '18-20': '18:00', '20-22': '20:00', '22-00': '22:00',
  };

  return slotToTime[slots[0]] ?? '19:30';
}

/**
 * Calcula un bonus de urgencia basado en el perfil aprendido.
 * Si la categoría de la tarea tiene alta tasa de éxito, se prioriza menos
 * (el usuario es bueno en eso). Si tiene baja tasa de éxito, se prioriza más
 * (necesita más tiempo de trabajo).
 */
export function getCategoryBonus(profile: LearnedProfile, task: Task): number {
  if (!task.category) return 1;

  const cat = task.category.toLowerCase();
  const cs = profile.categoryStats[cat];
  if (!cs || cs.total < 3) return 1; // sin datos suficientes

  // Baja tasa de éxito → bonus > 1 (priorizar más, necesita más trabajo)
  // Alta tasa de éxito → bonus < 1 (priorizar menos, el usuario es eficiente)
  return 1 + (1 - cs.successRate) * 0.5;
}

/**
 * Devuelve la duración óptima aprendida para un tipo de bloque.
 */
export function getOptimalDuration(
  profile: LearnedProfile,
  type: BlockType
): number {
  if (type === 'deep') return profile.optimalDeepDuration;
  if (type === 'light') return profile.optimalLightDuration;
  return 30; // exercise/rest default
}

/**
 * Ordena una lista de tareas considerando el perfil aprendido.
 * Prioriza tareas cuya categoría tiene bajo rendimiento histórico
 * (necesitan más trabajo) y las coloca en franjas de alto rendimiento.
 */
export function rankTasksWithProfile(
  tasks: Task[],
  profile: LearnedProfile,
  date: string,
  baseUrgencyFn: (task: Task, date: string) => number
): Task[] {
  return [...tasks].sort((a, b) => {
    const urgA = baseUrgencyFn(a, date) * getCategoryBonus(profile, a);
    const urgB = baseUrgencyFn(b, date) * getCategoryBonus(profile, b);
    return urgB - urgA;
  });
}

/**
 * Asigna inteligentemente tareas a slots de bloques basándose en el perfil.
 * Las tareas más difíciles / con peor rendimiento histórico van a las franjas
 * donde el usuario es más productivo.
 */
export function smartAssignTasksToSlots(
  tasks: Task[],
  blockSlots: Array<{ index: number; type: BlockType; startTime: string }>,
  profile: LearnedProfile
): Map<number, Task> {
  const assignment = new Map<number, Task>();
  const remaining = [...tasks];

  // Clasificar tareas en "difíciles" (high + categorías débiles) y "fáciles"
  const taskDifficulty = remaining.map(t => ({
    task: t,
    score: (t.difficulty === 'high' ? 3 : t.difficulty === 'medium' ? 2 : 1)
      * getCategoryBonus(profile, t),
  }));
  taskDifficulty.sort((a, b) => b.score - a.score);

  // Clasificar slots por productividad (mejores primero)
  const slotsWithScore = blockSlots.map(s => ({
    ...s,
    prodScore: getProductivityScore(profile, s.type, s.startTime),
  }));
  slotsWithScore.sort((a, b) => b.prodScore - a.prodScore);

  // Asignar tareas más difíciles a los slots más productivos
  const usedSlots = new Set<number>();
  for (const td of taskDifficulty) {
    const availableSlot = slotsWithScore.find(s => !usedSlots.has(s.index));
    if (!availableSlot) break;
    assignment.set(availableSlot.index, td.task);
    usedSlots.add(availableSlot.index);
  }

  return assignment;
}
