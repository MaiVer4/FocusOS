/**
 * Google Auto-Sync Service
 * Importa automáticamente tareas de Classroom y eventos de Calendar
 * al abrir la app y periódicamente (cada 5 minutos).
 * Usa externalId para evitar duplicados.
 */

import { googleAuth } from './google-auth';
import { getClassroomPendingTasks } from './google-classroom';
import { getCalendarEvents } from './google-calendar';
import { store } from './store';
import { notificationService } from './notifications';
import { Task } from './types';

const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutos
const LAST_SYNC_KEY = 'focusos_last_sync';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'not-connected';

export interface SyncResult {
  status: SyncStatus;
  newTasks: number;
  newBlocks: number;
  error?: string;
  lastSync: string;
}

// ─── Estado del sync ─────────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null;
let listeners: Array<(result: SyncResult) => void> = [];
let lastResult: SyncResult = {
  status: 'idle',
  newTasks: 0,
  newBlocks: 0,
  lastSync: localStorage.getItem(LAST_SYNC_KEY) ?? '',
};

function notify(result: SyncResult) {
  lastResult = result;
  listeners.forEach(fn => fn(result));
}

// ─── Sync de Classroom ──────────────────────────────────────────────────────

async function syncClassroom(): Promise<{ tasks: number }> {
  let newCount = 0;

  try {
    const classroomTasks = await getClassroomPendingTasks();

    for (const ct of classroomTasks) {
      const extId = `classroom:${ct.courseworkId}`;

      // ¿Ya existe esta tarea?
      const existing = store.findTaskByExternalId(extId);
      if (existing) {
        // Si fue terminada o aplazada, no re-importar
        if (existing.status === 'terminada' || existing.status === 'aplazada') continue;
        // Actualizar fecha si cambió
        if (existing.dueDate !== ct.dueDate) {
          store.updateTask(existing.id, { dueDate: ct.dueDate });
        }
        continue;
      }

      // Crear nueva tarea
      const task: Task = {
        id: crypto.randomUUID(),
        subject: ct.title,
        description: ct.description,
        notes: '',
        category: ct.courseName,
        dueDate: ct.dueDate,
        difficulty: 'medium',
        status: 'sin-iniciar',
        isDeliverable: true,
        externalId: extId,
        source: 'classroom',
        createdAt: new Date().toISOString(),
      };
      store.addTask(task);
      newCount++;

      // Programar notificaciones para entregables
      if (notificationService.hasPermission()) {
        notificationService.scheduleDeliverableNotifications(task);
      }
    }
  } catch (err) {
    // Classroom puede fallar por scopes, no bloquear el sync
    console.warn('[Sync] Classroom error:', err);
  }

  return { tasks: newCount };
}

// ─── Sync de Calendar ───────────────────────────────────────────────────────

async function syncCalendar(): Promise<{ tasks: number }> {
  let newTasks = 0;

  try {
    const events = await getCalendarEvents();

    for (const ev of events) {
      const extId = `calendar:${ev.id}`;

      // ¿Ya existe como tarea?
      if (store.findTaskByExternalId(extId)) continue;

      // Todos los eventos se importan como tareas
      const dueDate = ev.isAllDay || !ev.startTime
        ? ev.date
        : `${ev.date}T${ev.startTime}`;

      const task: Task = {
        id: crypto.randomUUID(),
        subject: ev.title,
        description: ev.description,
        notes: ev.location ? `📍 ${ev.location}` : '',
        category: 'Calendario',
        dueDate,
        difficulty: 'medium',
        status: 'sin-iniciar',
        isDeliverable: false,
        externalId: extId,
        source: 'calendar',
        createdAt: new Date().toISOString(),
      };
      store.addTask(task);
      newTasks++;
    }
  } catch (err) {
    console.warn('[Sync] Calendar error:', err);
  }

  return { tasks: newTasks };
}

// ─── Función principal de sync ──────────────────────────────────────────────

async function runSync(): Promise<SyncResult> {
  // Si no hay token, no sincronizar (el usuario no se ha conectado)
  if (!googleAuth.isAuthenticated()) {
    const result: SyncResult = {
      status: 'not-connected',
      newTasks: 0,
      newBlocks: 0,
      lastSync: lastResult.lastSync,
    };
    notify(result);
    return result;
  }

  notify({ ...lastResult, status: 'syncing' });

  try {
    const [classroom, calendar] = await Promise.all([
      syncClassroom(),
      syncCalendar(),
    ]);

    const now = new Date().toISOString();
    localStorage.setItem(LAST_SYNC_KEY, now);

    const result: SyncResult = {
      status: 'success',
      newTasks: classroom.tasks + calendar.tasks,
      newBlocks: 0,
      lastSync: now,
    };
    notify(result);
    return result;
  } catch (err) {
    const result: SyncResult = {
      status: 'error',
      newTasks: 0,
      newBlocks: 0,
      error: err instanceof Error ? err.message : 'Error desconocido',
      lastSync: lastResult.lastSync,
    };
    notify(result);
    return result;
  }
}

// ─── API pública ────────────────────────────────────────────────────────────

export const googleSync = {
  /** Ejecuta una sincronización inmediata */
  sync: runSync,

  /** Inicia el sync automático periódico */
  startAutoSync(): void {
    if (syncTimer) return;
    // Sync inmediato al iniciar
    runSync();
    // Luego cada SYNC_INTERVAL
    syncTimer = setInterval(runSync, SYNC_INTERVAL);
  },

  /** Detiene el sync automático */
  stopAutoSync(): void {
    if (syncTimer) {
      clearInterval(syncTimer);
      syncTimer = null;
    }
  },

  /** Suscribirse a cambios de estado del sync */
  subscribe(fn: (result: SyncResult) => void): () => void {
    listeners.push(fn);
    // Enviar estado actual inmediatamente
    fn(lastResult);
    return () => {
      listeners = listeners.filter(l => l !== fn);
    };
  },

  /** Obtener el último resultado */
  getLastResult(): SyncResult {
    return lastResult;
  },
};
