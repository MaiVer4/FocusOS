import { Block, Task } from './types';
import { getBlockLabel, formatTo12h } from './helpers';

export interface CustomNotificationOptions extends NotificationOptions {
  vibrate?: number[];
}

/** Detecta si un bloque tipo 'rest' es un hito clínico clave (comidas o desconexión de sueño) que SÍ debe notificar */
function getClinicalRestNotification(block: Block): { title: string; body: string } | null {
  const label = (block.label ?? '').toLowerCase();
  if (label.includes('desayuno')) {
    return {
      title: '🍳 Desayuno de Volumen Limpio',
      body: 'Mínimo 3 huevos + carbohidrato (arepa/pan/avena). Cero desayunos en blanco.',
    };
  }
  if (label.includes('post-entreno') || label.includes('pre-sena') || label.includes('merienda')) {
    return {
      title: '🥤 Recarga Post-Entreno + Termo SENA',
      body: 'Toma tu licuado calórico o sándwich proteico y llena tu termo de agua antes de salir al SENA.',
    };
  }
  if (label.includes('almuerzo') && label.includes('sena')) {
    return {
      title: '🍛 Pausa de Almuerzo en SENA',
      body: 'Aprovecha la salida para tu almuerzo completo (granos + arroz + proteína) y recarga tu agua.',
    };
  }
  if (label.includes('cena')) {
    return {
      title: '🍽️ Cena Completa + Corte de Agua',
      body: 'Cena tus aminoácidos nocturnos ahora y corta líquidos abundantes a las 8:30 p.m. para proteger tu fase REM.',
    };
  }
  if (label.includes('desconexión') || label.includes('protocolo de sueño') || label.includes('dormir')) {
    return {
      title: '🌙 Protocolo de Sueño y Escoliosis',
      body: 'Suelta pantallas, pon 1 sola alarma a las 7:00 a.m. lejos de la cama y duerme de lado (almohada entre rodillas) o boca arriba.',
    };
  }
  return null;
}

class NotificationService {
  private permission: NotificationPermission = 'default';
  private scheduledNotifications = new Map<string, number>();
  private swRegistration: ServiceWorkerRegistration | null = null;

  constructor() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
    this.registerServiceWorker();
    this.setupVisibilitySync();
  }

  /** Al volver a la app o desbloquear el celular, limpiar notificaciones que hayan expirado */
  private setupVisibilitySync() {
    if (typeof document === 'undefined') return;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        // Al despertar la pestaña, las notificaciones atrasadas se descartan
      }
    });
  }

  private async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      if (!this.swRegistration.active) {
        await new Promise<void>((resolve) => {
          const sw = this.swRegistration!.installing ?? this.swRegistration!.waiting;
          if (!sw) { resolve(); return; }
          sw.addEventListener('statechange', () => {
            if (sw.state === 'activated') resolve();
          });
        });
      }
    } catch (error) {
      console.warn('Error al registrar Service Worker:', error);
    }
  }

  async requestPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      console.warn('Este navegador no soporta notificaciones');
      return false;
    }

    if (this.permission === 'granted') {
      return true;
    }

    const result = await Notification.requestPermission();
    this.permission = result;
    return result === 'granted';
  }

  hasPermission(): boolean {
    return this.permission === 'granted';
  }

  sendNotification(title: string, options?: CustomNotificationOptions) {
    if (!this.hasPermission()) return;

    const notifOptions: CustomNotificationOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [150],
      ...options,
    };

    try {
      if (this.swRegistration?.active) {
        this.swRegistration.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          options: notifOptions,
        });
        return;
      }

      const notification = new Notification(title, notifOptions as NotificationOptions);
      setTimeout(() => notification.close(), 6000);
      return notification;
    } catch (error) {
      console.error('Error al enviar notificación:', error);
    }
  }

  /**
   * Programa notificaciones esenciales para un bloque:
   * - Para bloques 'rest': solo notifica si es una de las 4 comidas clave o el protocolo de sueño (10:00 p.m.).
   * - 5 minutos antes SOLO para bloques profundos ('deep').
   * - Al inicio para bloques de trabajo, ejercicio y comidas/sueño clave.
   * - Al finalizar el bloque de enfoque o ejercicio.
   */
  scheduleBlockNotifications(block: Block) {
    this.cancelBlockNotifications(block.id);

    const clinicalRest = block.type === 'rest' ? getClinicalRestNotification(block) : null;
    if (block.type === 'rest' && !clinicalRest) return;

    const now = new Date();
    const [startHour, startMinute] = block.startTime.split(':').map(Number);
    const [endHour, endMinute] = block.endTime.split(':').map(Number);

    const [year, month, day] = block.date
      ? block.date.split('-').map(Number)
      : [now.getFullYear(), now.getMonth() + 1, now.getDate()];

    const startTime = new Date(year, month - 1, day, startHour, startMinute, 0, 0);
    const endTime = new Date(year, month - 1, day, endHour, endMinute, 0, 0);
    if (endTime <= startTime) {
      endTime.setDate(endTime.getDate() + 1);
    }

    // Si es comida o protocolo de sueño, programar notificación puntual al inicio
    if (clinicalRest) {
      if (startTime > now) {
        const timeout = startTime.getTime() - now.getTime();
        const timerId = window.setTimeout(() => {
          this.sendNotification(clinicalRest.title, {
            body: clinicalRest.body,
            tag: `clinical-${block.id}`,
            vibrate: [200, 100, 200],
          });
        }, timeout);
        this.scheduledNotifications.set(`${block.id}-start`, timerId);
      }
      return;
    }

    // 1. Alerta 5 minutos antes (solo para Trabajo Profundo)
    if (block.type === 'deep') {
      const fiveMinBefore = new Date(startTime.getTime() - 5 * 60 * 1000);
      if (fiveMinBefore > now) {
        const timeout = fiveMinBefore.getTime() - now.getTime();
        const timerId = window.setTimeout(() => {
          this.sendBlockWarning(block, 5);
        }, timeout);
        this.scheduledNotifications.set(`${block.id}-5min`, timerId);
      }
    }

    // 2. Alerta al Inicio del bloque
    if (startTime > now) {
      const timeout = startTime.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        this.sendBlockStart(block);
      }, timeout);
      this.scheduledNotifications.set(`${block.id}-start`, timerId);
    }

    // 3. Alerta al Finalizar el bloque
    if (endTime > now) {
      const timeout = endTime.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        this.sendBlockEnd(block);
      }, timeout);
      this.scheduledNotifications.set(`${block.id}-end`, timerId);
    }
  }

  private sendBlockWarning(block: Block, minutesBefore: number) {
    const blockLabel = block.label || getBlockLabel(block.type);
    this.sendNotification(
      `⏰ ${blockLabel} en ${minutesBefore} min`,
      {
        body: block.task?.subject
          ? `Prepárate: ${block.task.subject} (Postura erguida, hombros atrás)`
          : 'Alinea tu postura y ten agua a la mano para iniciar tu bloque.',
        tag: `block-warning-${block.id}`,
        vibrate: [150],
      }
    );
  }

  private sendBlockStart(block: Block) {
    const blockLabel = block.label || getBlockLabel(block.type);
    const body = block.type === 'exercise'
      ? `${blockLabel} · ${block.duration} min (Calidad técnica, tempo 3-1 y control postural)`
      : block.task?.subject
        ? `${block.task.subject} · ${block.duration} min`
        : `Bloque iniciado · ${block.duration} min`;

    this.sendNotification(
      `🎯 ${blockLabel}`,
      {
        body,
        tag: `block-start-${block.id}`,
        vibrate: [200],
      }
    );
  }

  private sendBlockEnd(block: Block) {
    const blockLabel = block.label || getBlockLabel(block.type);
    const body = block.type === 'deep' || block.type === 'light'
      ? '¡Bloque completado! Ponte de pie 60s, abre el pecho y retrae las escápulas (escoliosis).'
      : '¡Entrenamiento completado! Hidrátate y prepara tu comida post-entreno.';
    this.sendNotification(
      `✅ ${blockLabel} completado`,
      {
        body,
        tag: `block-end-${block.id}`,
        vibrate: [150],
      }
    );
  }

  cancelBlockNotifications(blockId: string) {
    const keys = Array.from(this.scheduledNotifications.keys()).filter(key =>
      key.startsWith(blockId)
    );

    keys.forEach(key => {
      const timerId = this.scheduledNotifications.get(key);
      if (timerId) {
        clearTimeout(timerId);
        this.scheduledNotifications.delete(key);
      }
    });
  }

  scheduleDeliverableNotifications(task: Task) {
    this.cancelTaskNotifications(task.id);

    if (!task.isDeliverable || task.status === 'terminada' || task.status === 'aplazada') return;

    const dueDate = task.dueDate.includes('T')
      ? new Date(task.dueDate)
      : new Date(task.dueDate + 'T23:59:00');
    const now = new Date();

    if (dueDate <= now) return;

    const twoHoursBefore = new Date(dueDate.getTime() - 2 * 60 * 60 * 1000);
    if (twoHoursBefore > now) {
      const timeout = twoHoursBefore.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        const timeStr = formatTo12h(
          `${String(dueDate.getHours()).padStart(2, '0')}:${String(dueDate.getMinutes()).padStart(2, '0')}`
        );
        this.sendNotification(
          `📋 Entregable próximo: ${task.subject}`,
          {
            body: `Faltan 2 horas para la entrega (${timeStr}).`,
            tag: `deliverable-${task.id}-2h`,
            vibrate: [200, 100, 200],
          }
        );
      }, timeout);
      this.scheduledNotifications.set(`task-${task.id}-2h`, timerId);
    }

    const finalTimeout = dueDate.getTime() - now.getTime();
    if (finalTimeout > 0) {
      const timerId = window.setTimeout(() => {
        this.sendNotification(
          `🚨 Entrega ahora: ${task.subject}`,
          {
            body: '¡Es la hora límite de entrega! Asegúrate de subir tu evidencia.',
            tag: `deliverable-${task.id}-final`,
            vibrate: [300, 100, 300],
          }
        );
      }, finalTimeout);
      this.scheduledNotifications.set(`task-${task.id}-final`, timerId);
    }
  }

  cancelTaskNotifications(taskId: string) {
    const keys = Array.from(this.scheduledNotifications.keys()).filter(key =>
      key.startsWith(`task-${taskId}`)
    );
    keys.forEach(key => {
      const timerId = this.scheduledNotifications.get(key);
      if (timerId) {
        clearTimeout(timerId);
        this.scheduledNotifications.delete(key);
      }
    });
  }

  cancelAllNotifications() {
    this.scheduledNotifications.forEach(timerId => clearTimeout(timerId));
    this.scheduledNotifications.clear();
  }
}

export const notificationService = new NotificationService();
