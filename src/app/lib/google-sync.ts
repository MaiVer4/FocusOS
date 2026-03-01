/**
 * Google Auto-Sync Service
 * Importa automáticamente tareas de Classroom y eventos de Calendar
 * al abrir la app y periódicamente (cada 2 minutos).
 * Usa externalId para evitar duplicados y sincroniza cambios.
 */

import { googleAuth } from './google-auth';
import { getClassroomPendingTasks } from './google-classroom';
import { getCalendarEvents } from './google-calendar';
import { store } from './store';
import { notificationService } from './notifications';
import { Task } from './types';

const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutos
const LAST_SYNC_KEY = 'focusos_last_sync';

export type SyncStatus = 'idle' | 'syncing' | 'success' | 'error' | 'not-connected';

export interface SyncResult {
  status: SyncStatus;
  newTasks: number;
  updatedTasks: number;
  removedTasks: number;
  error?: string;
  lastSync: string;
}

// ─── Estado del sync ─────────────────────────────────────────────────────────

let syncTimer: ReturnType<typeof setInterval> | null = null;
let listeners: Array<(result: SyncResult) => void> = [];
let lastResult: SyncResult = {
  status: 'idle',
  newTasks: 0,
  updatedTasks: 0,
  removedTasks: 0,
  lastSync: localStorage.getItem(LAST_SYNC_KEY) ?? '',
};

function notify(result: SyncResult) {
  lastResult = result;
  listeners.forEach(fn => fn(result));
}

// ─── Sync de Classroom ──────────────────────────────────────────────────────

async function syncClassroom(): Promise<{ tasks: number; updated: number }> {
  let newCount = 0;
  let updatedCount = 0;

  try {
    const classroomTasks = await getClassroomPendingTasks();

    for (const ct of classroomTasks) {
      const extId = `classroom:${ct.courseworkId}`;

      // ¿Ya existe esta tarea?
      const existing = store.findTaskByExternalId(extId);
      if (existing) {
        // Si fue terminada o aplazada, no re-importar
        if (existing.status === 'terminada' || existing.status === 'aplazada') continue;

        // Detectar cambios y actualizar
        const updates: Partial<Task> = {};
        if (existing.dueDate !== ct.dueDate) updates.dueDate = ct.dueDate;
        if (existing.subject !== ct.title) updates.subject = ct.title;
        if (existing.description !== ct.description) updates.description = ct.description;
        if (existing.category !== ct.courseName) updates.category = ct.courseName;

        if (Object.keys(updates).length > 0) {
          store.updateTask(existing.id, updates);
          updatedCount++;
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
        assignedDate: ct.assignedDate || undefined,
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

  return { tasks: newCount, updated: updatedCount };
}

// ─── Sync de Calendar ───────────────────────────────────────────────────────

async function syncCalendar(): Promise<{ tasks: number; updated: number; removed: number }> {
  let newTasks = 0;
  let updated = 0;
  let removed = 0;

  try {
    const events = await getCalendarEvents();

    // Set con los IDs externos de todos los eventos actuales
    const currentExtIds = new Set(events.map(ev => `calendar:${ev.id}`));

    // Eliminar tareas de Calendar que ya no existen en Google Calendar
    const calendarTasks = store.getTasksBySource('calendar');
    for (const task of calendarTasks) {
      if (task.externalId && !currentExtIds.has(task.externalId)) {
        // Solo eliminar si no fue completada por el usuario
        if (task.status !== 'terminada') {
          store.deleteTask(task.id);
          removed++;
        }
      }
    }

    // Importar eventos nuevos o actualizar existentes
    for (const ev of events) {
      const extId = `calendar:${ev.id}`;
      const dueDate = ev.isAllDay || !ev.startTime
        ? ev.date
        : `${ev.date}T${ev.startTime}`;

      // ¿Ya existe como tarea?
      const existing = store.findTaskByExternalId(extId);
      if (existing) {
        // Si fue terminada o aplazada, no tocar
        if (existing.status === 'terminada' || existing.status === 'aplazada') continue;

        // Detectar cambios y actualizar
        const newNotes = ev.location ? `📍 ${ev.location}` : '';
        const updates: Partial<Task> = {};
        if (existing.subject !== ev.title) updates.subject = ev.title;
        if (existing.description !== ev.description) updates.description = ev.description;
        if (existing.dueDate !== dueDate) updates.dueDate = dueDate;
        if ((existing.notes ?? '') !== newNotes) updates.notes = newNotes;

        if (Object.keys(updates).length > 0) {
          store.updateTask(existing.id, updates);
          updated++;
        }
        continue;
      }

      // Todos los eventos se importan como tareas
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

  return { tasks: newTasks, updated, removed };
}

// ─── Función principal de sync ──────────────────────────────────────────────

async function runSync(): Promise<SyncResult> {
  // Si no hay token, intentar renovar automáticamente
  if (!googleAuth.isAuthenticated()) {
    const renewed = await googleAuth.tryAutoRenew();
    if (!renewed) {
      const result: SyncResult = {
        status: 'not-connected',
        newTasks: 0,
        updatedTasks: 0,
        removedTasks: 0,
        lastSync: lastResult.lastSync,
      };
      notify(result);
      return result;
    }
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
      updatedTasks: classroom.updated + calendar.updated,
      removedTasks: calendar.removed,
      lastSync: now,
    };
    notify(result);
    return result;
  } catch (err) {
    const result: SyncResult = {
      status: 'error',
      newTasks: 0,
      updatedTasks: 0,
      removedTasks: 0,
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
