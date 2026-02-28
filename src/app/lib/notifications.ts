import { Block } from './types';

class NotificationService {
  private permission: NotificationPermission = 'default';
  private scheduledNotifications = new Map<string, number>();

  constructor() {
    if ('Notification' in window) {
      this.permission = Notification.permission;
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

    try {
      const notification = new Notification(title, {
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        vibrate: [200, 100, 200],
        ...options,
      });

      // Auto cerrar después de 10 segundos
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
    const blockLabel = this.getBlockLabel(block.type);
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
    const blockLabel = this.getBlockLabel(block.type);
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
    const blockLabel = this.getBlockLabel(block.type);
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
    const blockLabel = this.getBlockLabel(block.type);
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
    const blockLabel = this.getBlockLabel(block.type);
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

  sendInterruptionWarning() {
    this.sendNotification(
      '🚨 INTERRUPCIÓN DETECTADA',
      {
        body: 'Estás en un bloque profundo.\n\nSalir ahora afectará tu puntuación de disciplina.',
        requireInteraction: true,
        vibrate: [300, 100, 300],
      }
    );
  }

  sendDailySetupReminder() {
    this.sendNotification(
      '📅 Configura tu día',
      {
        body: '¿Cuántos bloques profundos quieres hoy?\n\nAbre FocusOS para planificar.',
        requireInteraction: true,
      }
    );
  }

  sendExerciseReminder() {
    this.sendNotification(
      '💪 EJERCICIO OBLIGATORIO',
      {
        body: 'Es hora de tu bloque de ejercicio.\n\n30 minutos de actividad física.',
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200],
      }
    );
  }

  sendLowDisciplineWarning(score: number) {
    this.sendNotification(
      '⚠️ DISCIPLINA BAJA',
      {
        body: `Tu puntuación es ${score}%.\n\nCumple los bloques restantes para mejorar.`,
        requireInteraction: true,
      }
    );
  }

  sendStreakAchievement(days: number) {
    this.sendNotification(
      `🔥 RACHA DE ${days} DÍAS`,
      {
        body: '¡Excelente disciplina!\n\nSigue manteniendo el enfoque.',
        requireInteraction: false,
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

  cancelAllNotifications() {
    this.scheduledNotifications.forEach(timerId => clearTimeout(timerId));
    this.scheduledNotifications.clear();
  }

  private getBlockLabel(type: string): string {
    switch (type) {
      case 'deep':
        return 'Bloque Profundo';
      case 'exercise':
        return 'Ejercicio';
      case 'light':
        return 'Bloque Ligero';
      case 'rest':
        return 'Descanso';
      default:
        return 'Bloque';
    }
  }

  // Programar notificación diaria para setup
  scheduleDailySetup(hour: number = 8, minute: number = 30) {
    const now = new Date();
    const scheduleTime = new Date();
    scheduleTime.setHours(hour, minute, 0, 0);
    
    if (scheduleTime <= now) {
      scheduleTime.setDate(scheduleTime.getDate() + 1);
    }
    
    const timeout = scheduleTime.getTime() - now.getTime();
    
    setTimeout(() => {
      this.sendDailySetupReminder();
      // Reprogramar para el día siguiente
      this.scheduleDailySetup(hour, minute);
    }, timeout);
  }
}

export const notificationService = new NotificationService();
