import { BlockType, BlockStatus, Difficulty, TaskStatus } from './types';

// ─── Block helpers ─────────────────────────────────────────────────────────────

export function getBlockColor(type: BlockType): string {
  switch (type) {
    case 'deep':     return 'bg-red-600/20 border-red-600/30 text-red-400';
    case 'exercise': return 'bg-green-600/20 border-green-600/30 text-green-400';
    case 'light':    return 'bg-blue-600/20 border-blue-600/30 text-blue-400';
    case 'rest':     return 'bg-zinc-600/20 border-zinc-600/30 text-zinc-400';
  }
}

export function getBlockSolidColor(type: BlockType): string {
  switch (type) {
    case 'deep':     return 'bg-red-600';
    case 'exercise': return 'bg-green-600';
    case 'light':    return 'bg-blue-600';
    case 'rest':     return 'bg-zinc-600';
  }
}

export function getBlockGradient(type: BlockType): string {
  switch (type) {
    case 'deep':     return 'from-red-900 to-red-950';
    case 'exercise': return 'from-green-900 to-green-950';
    case 'light':    return 'from-blue-900 to-blue-950';
    case 'rest':     return 'from-zinc-800 to-zinc-900';
  }
}

export function getBlockLabel(type: BlockType): string {
  switch (type) {
    case 'deep':     return 'Bloque Profundo';
    case 'exercise': return 'Ejercicio';
    case 'light':    return 'Bloque Ligero';
    case 'rest':     return 'Descanso';
  }
}

export function getBlockStatusLabel(status: BlockStatus): string {
  switch (status) {
    case 'pending':   return 'Pendiente';
    case 'active':    return 'Activo';
    case 'completed': return 'Completado';
    case 'failed':    return 'Fallado';
  }
}

// ─── Task helpers ──────────────────────────────────────────────────────────────

export function getDifficultyLabel(difficulty: Difficulty): string {
  switch (difficulty) {
    case 'high':   return 'Alta';
    case 'medium': return 'Media';
    case 'low':    return 'Baja';
  }
}

export function getTaskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'sin-iniciar':          return 'Sin iniciar';
    case 'en-progreso':          return 'En progreso';
    case 'en-progreso-aplazada': return 'En progreso (aplazada)';
    case 'aplazada':             return 'Aplazada';
    case 'terminada':            return 'Terminada';
  }
}

export function getTaskStatusColor(status: TaskStatus): string {
  switch (status) {
    case 'sin-iniciar':          return 'bg-zinc-600/20 text-zinc-400';
    case 'en-progreso':          return 'bg-blue-600/20 text-blue-400';
    case 'en-progreso-aplazada': return 'bg-orange-600/20 text-orange-400';
    case 'aplazada':             return 'bg-yellow-600/20 text-yellow-400';
    case 'terminada':            return 'bg-green-600/20 text-green-400';
  }
}

const CATEGORY_COLORS: Record<string, string> = {
  java:            'bg-orange-600/20 text-orange-400',
  javascript:      'bg-yellow-600/20 text-yellow-400',
  js:              'bg-yellow-600/20 text-yellow-400',
  typescript:      'bg-blue-600/20 text-blue-400',
  ts:              'bg-blue-600/20 text-blue-400',
  python:          'bg-emerald-600/20 text-emerald-400',
  'bases de datos': 'bg-cyan-600/20 text-cyan-400',
  sql:             'bg-cyan-600/20 text-cyan-400',
  react:           'bg-sky-600/20 text-sky-400',
  html:            'bg-red-600/20 text-red-400',
  css:             'bg-indigo-600/20 text-indigo-400',
  sena:            'bg-purple-600/20 text-purple-400',
};

export function getCategoryColor(category: string): string {
  return CATEGORY_COLORS[category.toLowerCase()] ?? 'bg-teal-600/20 text-teal-400';
}

// ─── Time helpers ──────────────────────────────────────────────────────────────

/** Returns today's date as YYYY-MM-DD */
export function todayStr(): string {
  return new Date().toISOString().split('T')[0];
}

/** Convierte HH:mm (24h) a formato 12h sin AM/PM, ej: "13:00" → "1:00" */
export function formatTo12h(time: string): string {
  const [h, m] = time.split(':').map(Number);
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')}`;
}

/** Formats a Date object as h:mm:ss (12h sin AM/PM) */
export function formatTimeFull(date: Date): string {
  const h = date.getHours() % 12 || 12;
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

/** Formats seconds as MM:SS or H:MM:SS when ≥ 60 min */
export function formatCountdown(seconds: number): string {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

/**
 * Given a start time as HH:mm and a duration in minutes,
 * returns the end time as HH:mm (same-day, wraps at 23:59).
 */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.min(23, Math.floor(total / 60));
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Returns the duration in minutes between two HH:mm strings.
 */
export function durationBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

/**
 * Añade minutos a un string de fecha-hora YYYY-MM-DDTHH:mm.
 * Devuelve el nuevo string en formato YYYY-MM-DDTHH:mm.
 */
export function addMinutesToDatetime(datetimeStr: string, minutes: number): string {
  const date = datetimeStr.includes('T')
    ? new Date(datetimeStr)
    : new Date(datetimeStr + 'T00:00:00');
  date.setMinutes(date.getMinutes() + minutes);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d}T${h}:${m}`;
}

/** Formatea un string de fecha (YYYY-MM-DD) o fecha-hora (YYYY-MM-DDTHH:mm) para mostrar */
export function formatDateDisplay(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  const hasTime = dateStr.includes('T') && dateStr.length > 10;
  const date = hasTime ? new Date(dateStr) : new Date(dateStr + 'T00:00:00');
  const dateOptions = options ?? { weekday: 'short', day: 'numeric', month: 'short' };
  const formatted = date.toLocaleDateString('es-CO', dateOptions);
  if (hasTime) {
    const timeStr = date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${formatted}, ${timeStr}`;
  }
  return formatted;
}

// ─── Score helpers ─────────────────────────────────────────────────────────────

export function scoreColor(score: number): string {
  if (score >= 85) return 'text-green-500';
  if (score >= 70) return 'text-yellow-500';
  return 'text-red-500';
}

export function scoreBarColor(score: number): string {
  if (score >= 85) return 'bg-green-500';
  if (score >= 70) return 'bg-yellow-500';
  return 'bg-red-500';
}
