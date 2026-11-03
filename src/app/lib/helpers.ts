import { BlockType, BlockStatus, Difficulty, TaskStatus, CircadianPhase } from './types';

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

/**
 * Remueve horas estáticas redundantes incrustadas en los títulos de los bloques
 * (ej: "Almuerzo en pausa del SENA (2:00 p.m.)" -> "Almuerzo en pausa del SENA")
 */
export function cleanBlockLabel(label: string | undefined): string {
  if (!label) return '';
  return label
    .replace(/\s*\(Activar luz cálida\s*\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\)/gi, ' (Luz cálida)')
    .replace(/\s*\(Luz cálida\s*\d{1,2}:\d{2}\s*(?:a\.?m\.?|p\.?m\.?)?\)/gi, ' (Luz cálida)')
    .replace(/\s*\+\s*Fin de líquidos(?: abundantes)?\s*\([^)]*\)/gi, ' + Corte de líquidos')
    .replace(/\s*\(\s*\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?\s*\)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
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

/** Converts any Date to YYYY-MM-DD using local timezone */
export function dateToStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Returns today's date as YYYY-MM-DD (local timezone) */
export function todayStr(): string {
  return dateToStr(new Date());
}

/** Convierte HH:mm (24h) a formato 12h con AM/PM, ej: "13:00" → "1:00 p. m.", "08:00" → "8:00 a. m." */
export function formatTo12h(time: string): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const period = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
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
 * returns the end time as HH:mm (wraps at 24:00 → 00:00).
 */
export function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`;
}

/**
 * Returns the duration in minutes between two HH:mm strings.
 * Handles blocks spanning midnight (e.g. 23:30 to 00:15 returns 45 min).
 */
export function durationBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let diff = (eh * 60 + em) - (sh * 60 + sm);
  if (diff < 0) {
    diff += 1440; // Cruce de medianoche: 24h = 1440 minutos
  }
  return diff;
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

/**
 * Parsea estrictamente la fecha en formato YYYY-MM-DD o ISO a los componentes [año, mes, día] locales,
 * evitando desfases de zona horaria o interpretaciones UTC medianoche.
 */
export function parseLocalDate(dateStr: string): { year: number; month: number; day: number } {
  if (!dateStr) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }
  const clean = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr.trim();
  const parts = clean.split('-').map(Number);
  if (parts.length >= 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
    return { year: parts[0], month: parts[1], day: parts[2] };
  }
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * Retorna el día de la semana estrictamente local (0=domingo, 1=lunes, ..., 6=sábado)
 * sin riesgo de conversión UTC que desplace el día.
 */
export function getDayOfWeek(dateStr: string): number {
  const { year, month, day } = parseLocalDate(dateStr);
  return new Date(year, month - 1, day, 12, 0, 0).getDay();
}

/**
 * Retorna el nombre en español del día de la semana para un string YYYY-MM-DD
 */
export function getDayNameSpanish(dateStr: string): string {
  const dow = getDayOfWeek(dateStr);
  const names = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
  return names[dow] ?? 'día';
}

/**
 * Retorna verdadero si es fin de semana (sábado=6 o domingo=0)
 */
export function isWeekendDay(dateStr: string): boolean {
  const dow = getDayOfWeek(dateStr);
  return dow === 0 || dow === 6;
}

/**
 * Retorna verdadero si es día entre semana (lunes a viernes, 1 a 5)
 */
export function isWeekdayDay(dateStr: string): boolean {
  const dow = getDayOfWeek(dateStr);
  return dow >= 1 && dow <= 5;
}

/** Formatea un string de fecha (YYYY-MM-DD) o fecha-hora (YYYY-MM-DDTHH:mm) para mostrar */
export function formatDateDisplay(dateStr: string, options?: Intl.DateTimeFormatOptions): string {
  if (!dateStr) return '';
  const hasTime = dateStr.includes('T') && dateStr.length > 10;
  let date: Date;
  if (hasTime) {
    date = new Date(dateStr);
  } else {
    const { year, month, day } = parseLocalDate(dateStr);
    date = new Date(year, month - 1, day, 12, 0, 0);
  }
  const dateOptions = options ?? { weekday: 'short', day: 'numeric', month: 'short' };
  const formatted = date.toLocaleDateString('es-CO', dateOptions);
  if (hasTime) {
    const timeStr = date.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true });
    return `${formatted}, ${timeStr}`;
  }
  return formatted;
}

// ─── Score helpers ─────────────────────────────────────────────────────────────

/** Labels de bloques de rutina que NO deben recibir tareas de estudio */
export const ROUTINE_LABELS = [
  'cena', 'desayuno', 'almuerzo', 'comida', 'transporte',
  'redes sociales', 'relajación', 'preparación', 'dormir',
  'actividades formales', 'sena', 'rutina', 'despertar',
  'luz solar', 'post-entreno', 'merienda', 'pausa postural',
  'desconexión', 'ducha', 'protocolo de sueño', 'corte de agua',
];

/** Comprueba si un label de bloque corresponde a una rutina */
export function isRoutineLabel(label: string): boolean {
  const lower = label.toLowerCase();
  return ROUTINE_LABELS.some(r => lower.includes(r));
}

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

/** Generador de UUID seguro con fallback para entornos no-HTTPS o navegadores antiguos */
export function generateUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Retorna la fase cronobiológica activa según la hora del día */
export function getCircadianPhase(date: Date = new Date()): CircadianPhase {
  const m = date.getHours() * 60 + date.getMinutes();

  // 07:00 (420) a 08:30 (510)
  if (m >= 420 && m < 510) {
    return {
      id: 'morning',
      label: 'Fase 1 · Despertar & Nutrición',
      sublabel: 'Luz solar + Vaso de agua + Mín. 3 huevos',
      color: 'text-amber-400',
      borderColor: 'border-amber-500/40',
      badgeBg: 'bg-amber-500/10 text-amber-300 border-amber-500/30',
      bgGradient: 'from-amber-950/40 via-zinc-950 to-zinc-950',
      dotColor: 'bg-amber-400',
    };
  }
  // 08:30 (510) a 10:30 (630)
  if (m >= 510 && m < 630) {
    return {
      id: 'workout',
      label: 'Fase 2 · Calistenia & Hipertrofia 2:1',
      sublabel: 'Morral con libros · Tempo estricto · Espalda alineada',
      color: 'text-emerald-400',
      borderColor: 'border-emerald-500/40',
      badgeBg: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
      bgGradient: 'from-emerald-950/40 via-zinc-950 to-zinc-950',
      dotColor: 'bg-emerald-400',
    };
  }
  // 10:30 (630) a 11:35 (695)
  if (m >= 630 && m < 695) {
    return {
      id: 'pre_sena',
      label: 'Fase 3 · Recarga Post-Entreno & Termo SENA',
      sublabel: 'Licuado calórico o sándwich + llenar termo de agua',
      color: 'text-cyan-400',
      borderColor: 'border-cyan-500/40',
      badgeBg: 'bg-cyan-500/10 text-cyan-300 border-cyan-500/30',
      bgGradient: 'from-cyan-950/40 via-zinc-950 to-zinc-950',
      dotColor: 'bg-cyan-400',
    };
  }
  // 11:35 (695) a 18:45 (1125)
  if (m >= 695 && m < 1125) {
    return {
      id: 'sena',
      label: 'Fase 4 · Formación SENA & Hidratación',
      sublabel: 'Almuerzo 2:00 p.m. · Hidratación constante de termo',
      color: 'text-blue-400',
      borderColor: 'border-blue-500/40',
      badgeBg: 'bg-blue-500/10 text-blue-300 border-blue-500/30',
      bgGradient: 'from-blue-950/40 via-zinc-950 to-zinc-950',
      dotColor: 'bg-blue-400',
    };
  }
  // 18:45 (1125) a 21:00 (1260)
  if (m >= 1125 && m < 1260) {
    return {
      id: 'evening_code',
      label: 'Fase 5 · Desarrollo, Código & Cena 8:00 p.m.',
      sublabel: 'Postura erguida · Cena completa · Corte agua 8:30 p.m.',
      color: 'text-indigo-400',
      borderColor: 'border-indigo-500/40',
      badgeBg: 'bg-indigo-500/10 text-indigo-300 border-indigo-500/30',
      bgGradient: 'from-indigo-950/40 via-zinc-950 to-zinc-950',
      dotColor: 'bg-indigo-400',
    };
  }
  // 21:00 (1260) a 22:00 (1320)
  if (m >= 1260 && m < 1320) {
    return {
      id: 'warm_night',
      label: 'Fase 6 · Luz Cálida & Desconexión',
      sublabel: 'Modo nocturno cálido · Proteger melatonina y descanso',
      color: 'text-orange-400',
      borderColor: 'border-orange-500/50',
      badgeBg: 'bg-orange-500/15 text-orange-300 border-orange-500/40',
      bgGradient: 'from-orange-950/50 via-zinc-950 to-zinc-950',
      dotColor: 'bg-orange-400',
    };
  }
  // 22:00 en adelante o antes de 07:00
  return {
    id: 'wind_down',
    label: 'Fase 7 · Protocolo de Sueño y Escoliosis',
    sublabel: 'Pantallas apagadas · 1 alarma 7:00 a.m. · Almohada entre piernas',
    color: 'text-purple-400',
    borderColor: 'border-purple-500/40',
    badgeBg: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
    bgGradient: 'from-purple-950/40 via-zinc-950 to-zinc-950',
    dotColor: 'bg-purple-400',
  };
}

