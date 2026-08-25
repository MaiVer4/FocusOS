import { Block, Task } from './types';
import { getBlockLabel, formatTo12h } from './helpers';

export interface CustomNotificationOptions extends NotificationOptions {
  vibrate?: number[];
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
      vibrate: [150], // Pulso suave y amigable
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
   * - CERO notificaciones para bloques de descanso ('rest') como comidas o transporte.
   * - 5 minutos antes SOLO para bloques profundos ('deep').
   * - Al inicio para bloques de trabajo y ejercicio.
   * - Al finalizar el bloque de enfoque.
   */
  scheduleBlockNotifications(block: Block) {
    this.cancelBlockNotifications(block.id);

    // CERO notificaciones para bloques de descanso, comida, transporte o dormir
    if (block.type === 'rest') return;

    const now = new Date();
    const [startHour, startMinute] = block.startTime.split(':').map(Number);
    const [endHour, endMinute] = block.endTime.split(':').map(Number);

    const startTime = new Date();
    startTime.setHours(startHour, startMinute, 0, 0);

    const endTime = new Date();
    endTime.setHours(endHour, endMinute, 0, 0);

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
    const blockLabel = getBlockLabel(block.type);
    this.sendNotification(
      `⏰ ${blockLabel} en ${minutesBefore} min`,
      {
        body: block.task?.subject ? `Prepárate: ${block.task.subject}` : 'Prepárate para iniciar tu bloque de enfoque',
        tag: `block-warning-${block.id}`,
        vibrate: [150],
      }
    );
  }

  private sendBlockStart(block: Block) {
    const blockLabel = getBlockLabel(block.type);
    const body = block.task?.subject
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
    const blockLabel = getBlockLabel(block.type);
    this.sendNotification(
      `✅ ${blockLabel} completado`,
      {
        body: '¡Buen trabajo! Toma un descanso y prepárate para la siguiente actividad.',
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

  /**
   * Programa notificaciones para un entregable:
   * - Solo 2 alertas de alto valor:
   *   1. 2 horas antes de la entrega (aviso para finalizar)
   *   2. En la hora exacta de la entrega
   */
  scheduleDeliverableNotifications(task: Task) {
    this.cancelTaskNotifications(task.id);

    if (!task.isDeliverable || task.status === 'terminada' || task.status === 'aplazada') return;

    const dueDate = task.dueDate.includes('T')
      ? new Date(task.dueDate)
      : new Date(task.dueDate + 'T23:59:00');
    const now = new Date();

    if (dueDate <= now) return;

    // 1. Alerta 2 horas antes
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

    // 2. Alerta en la hora exacta de entrega
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
