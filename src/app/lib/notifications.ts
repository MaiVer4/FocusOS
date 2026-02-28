import { Block, Task } from './types';
import { getBlockLabel, formatTo12h } from './helpers';

class NotificationService {
  private permission: NotificationPermission = 'default';
  private scheduledNotifications = new Map<string, number>();
  private swRegistration: ServiceWorkerRegistration | null = null;

  constructor() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
    }
    this.registerServiceWorker();
  }

  private async registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    try {
      this.swRegistration = await navigator.serviceWorker.register('/sw.js');
      // Esperar a que el SW esté activo
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

  sendNotification(title: string, options?: NotificationOptions) {
    if (!this.hasPermission()) {
      console.warn('No hay permisos para enviar notificaciones');
      return;
    }

    const notifOptions: NotificationOptions = {
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      vibrate: [200, 100, 200],
      ...options,
    };

    try {
      // Intentar vía Service Worker (funciona en móvil)
      if (this.swRegistration?.active) {
        this.swRegistration.active.postMessage({
          type: 'SHOW_NOTIFICATION',
          title,
          options: notifOptions,
        });
        return;
      }

      // Fallback: Notification API directa (solo escritorio)
      const notification = new Notification(title, notifOptions);
      setTimeout(() => notification.close(), 10000);
      return notification;
    } catch (error) {
      console.error('Error al enviar notificación:', error);
    }
  }

  scheduleBlockNotifications(block: Block) {
    // Limpiar notificaciones previas para este bloque
    this.cancelBlockNotifications(block.id);

    const now = new Date();
    const [startHour, startMinute] = block.startTime.split(':').map(Number);
    const [endHour, endMinute] = block.endTime.split(':').map(Number);
    
    const startTime = new Date();
    startTime.setHours(startHour, startMinute, 0, 0);
    
    const endTime = new Date();
    endTime.setHours(endHour, endMinute, 0, 0);

    // Notificación 5 minutos antes
    const fiveMinBefore = new Date(startTime.getTime() - 5 * 60 * 1000);
    if (fiveMinBefore > now) {
      const timeout = fiveMinBefore.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        this.sendBlockWarning(block, 5);
      }, timeout);
      this.scheduledNotifications.set(`${block.id}-5min`, timerId);
    }

    // Notificación al inicio
    if (startTime > now) {
      const timeout = startTime.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        this.sendBlockStart(block);
        
        // Programar advertencia si no se inicia en 3 minutos
        const warningTimeout = window.setTimeout(() => {
          if (block.status === 'pending') {
            this.sendLateWarning(block);
          }
        }, 3 * 60 * 1000);
        this.scheduledNotifications.set(`${block.id}-late`, warningTimeout);
      }, timeout);
      this.scheduledNotifications.set(`${block.id}-start`, timerId);
    }

    // Notificación a la mitad del bloque
    const halfTime = new Date((startTime.getTime() + endTime.getTime()) / 2);
    if (halfTime > now) {
      const timeout = halfTime.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        this.sendBlockMidpoint(block);
      }, timeout);
      this.scheduledNotifications.set(`${block.id}-half`, timerId);
    }

    // Notificación al final
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
      `⏰ ${blockLabel} en ${minutesBefore} minutos`,
      {
        body: block.task?.subject || 'Prepárate para tu próximo bloque',
        tag: `block-warning-${block.id}`,
        requireInteraction: false,
      }
    );
  }

  private sendBlockStart(block: Block) {
    const blockLabel = getBlockLabel(block.type);
    let body = block.task?.subject || 'Es hora de comenzar';
    
    if (block.type === 'deep') {
      body += '\n\n🔥 Celular fuera. Modo disciplina.';
    }

    this.sendNotification(
      `🎯 ${blockLabel} - INICIO`,
      {
        body,
        tag: `block-start-${block.id}`,
        requireInteraction: true,
        vibrate: [300, 100, 300, 100, 300],
      }
    );
  }

  private sendBlockMidpoint(block: Block) {
    const blockLabel = getBlockLabel(block.type);
    this.sendNotification(
      `⏱️ ${blockLabel} - Mitad del tiempo`,
      {
        body: '¡Vas a la mitad! Mantén el enfoque.',
        tag: `block-mid-${block.id}`,
        requireInteraction: false,
      }
    );
  }

  private sendBlockEnd(block: Block) {
    const blockLabel = getBlockLabel(block.type);
    this.sendNotification(
      `✅ ${blockLabel} - FINALIZADO`,
      {
        body: '¡Bloque completado! Toma un descanso.',
        tag: `block-end-${block.id}`,
        requireInteraction: false,
        vibrate: [200, 100, 200],
      }
    );
  }

  private sendLateWarning(block: Block) {
    const blockLabel = getBlockLabel(block.type);
    this.sendNotification(
      `⚠️ BLOQUE RETRASADO`,
      {
        body: `${blockLabel} debió iniciar hace 3 minutos.\n\nSe registrará como fallado si no inicias ahora.`,
        tag: `block-late-${block.id}`,
        requireInteraction: true,
        vibrate: [500, 200, 500, 200, 500],
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
   * - Primera alerta 8 horas antes de la entrega
   * - Luego cada 2 horas hasta la hora de entrega
   */
  scheduleDeliverableNotifications(task: Task) {
    this.cancelTaskNotifications(task.id);

    if (!task.isDeliverable || task.status === 'terminada' || task.status === 'aplazada') return;

    const dueDate = task.dueDate.includes('T')
      ? new Date(task.dueDate)
      : new Date(task.dueDate + 'T23:59:00');
    const now = new Date();

    if (dueDate <= now) return;

    const intervals = [8, 6, 4, 2];

    intervals.forEach((hoursBefore, idx) => {
      const alertTime = new Date(dueDate.getTime() - hoursBefore * 60 * 60 * 1000);
      if (alertTime <= now) return;

      const timeout = alertTime.getTime() - now.getTime();
      const timerId = window.setTimeout(() => {
        const timeStr = formatTo12h(
          `${String(dueDate.getHours()).padStart(2, '0')}:${String(dueDate.getMinutes()).padStart(2, '0')}`
        );
        this.sendNotification(
          `📋 ENTREGABLE: ${task.subject}`,
          {
            body: `⏰ Faltan ${hoursBefore} horas para la entrega (${timeStr}).\n\n${task.description || 'Revisa tu tarea.'}`,
            tag: `deliverable-${task.id}-${hoursBefore}h`,
            requireInteraction: true,
            vibrate: [300, 100, 300, 100, 300],
          }
        );
      }, timeout);
      this.scheduledNotifications.set(`task-${task.id}-${idx}`, timerId);
    });

    // Alerta final: en la hora exacta de entrega
    const finalTimeout = dueDate.getTime() - now.getTime();
    if (finalTimeout > 0) {
      const timerId = window.setTimeout(() => {
        this.sendNotification(
          `🚨 ENTREGA AHORA: ${task.subject}`,
          {
            body: '¡Es la hora de entrega! Asegúrate de entregar a tiempo.',
            tag: `deliverable-${task.id}-now`,
            requireInteraction: true,
            vibrate: [500, 200, 500, 200, 500],
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
