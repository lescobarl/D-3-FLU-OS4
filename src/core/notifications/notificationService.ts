// ============================================================
// Notification Service — Centro de notificaciones (Fase 1, J2)
// ------------------------------------------------------------
// Regla #1: configuración en FLU_CONFIG.notifications + STORAGE_KEYS.
// Obligación #1: dependencia inyectable (NotificationDriver) con
// implementación DEFAULT, mismo patrón que src/services/musicSearch.ts.
// ============================================================
import { STORAGE_KEYS } from '../config/appConfig';
import { logCaughtError } from '../../lib/caughtError';
import { localGet, localSet } from '../storage/localStore';

/** Canal de notificación elegido por el usuario. */
export type NotificationChannel = 'none' | 'toast' | 'voice' | 'both';

/** Canal de entrega resuelto para una notificación concreta. */
export type NotificationDelivery = 'toast' | 'voice' | 'both';

export interface AppNotification {
  id: string;
  category: string;
  title: string;
  body: string;
  timestamp: number;
  urgent?: boolean;
  icon?: string;
  action?: string;
}

/** Driver inyectable que aísla la API del navegador (testeable con fakes). */
export interface NotificationDriver {
  isSupported(): boolean;
  getPermission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  showSystemNotification(notification: AppNotification): Promise<boolean>;
}

export interface NotificationConfig {
  enabled: boolean;
  channel: NotificationChannel;
  toastDurationMs?: number;
  defaultTitle?: string;
  maxStack?: number;
  webApiEnabled?: boolean;
  mutedCategories?: string[];
}

export interface NotificationDndState {
  isActive: boolean;
  allowUrgent: boolean;
}

export interface NotificationServiceOptions {
  config: NotificationConfig;
  driver?: NotificationDriver;
  dnd?: NotificationDndState;
  now?: () => Date;
}

export interface NotificationDispatch {
  notification: AppNotification;
  delivery: NotificationDelivery | null;
}

/** Nombre del CustomEvent emitido a window para el centro de notificaciones. */
export const NOTIFICATION_EVENT = 'flu-notification';

/** Driver por defecto: usa la API del navegador (service worker + Notification). */
export function createDefaultDriver(): NotificationDriver {
  return {
    isSupported() {
      return (
        typeof window !== 'undefined' &&
        'Notification' in window &&
        typeof window.Notification.requestPermission === 'function'
      );
    },
    getPermission() {
      if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
      return window.Notification.permission;
    },
    async requestPermission() {
      if (typeof window === 'undefined' || !('Notification' in window)) return 'denied';
      return window.Notification.requestPermission();
    },
    async showSystemNotification(notification) {
      if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return false;
      try {
        const registration = await navigator.serviceWorker.ready;
        await registration.showNotification(notification.title, {
          body: notification.body,
          icon: notification.icon || '/icons/flu-icon.svg',
          badge: notification.icon || '/icons/flu-icon.svg',
          tag: notification.id,
          data: { url: '/' },
        });
        return true;
      } catch (e) {
        logCaughtError('[catch] src/core/notifications/notificationService.ts', e);
        return false;
      }
    },
  };
}

export interface NotificationService {
  /**
   * Emite una notificación. Devuelve el canal de entrega resuelto,
   * o null si está bloqueada (canal 'none', DND, categoría silenciada).
   */
  notify(input: {
    category: string;
    title?: string;
    body: string;
    urgent?: boolean;
    icon?: string;
    action?: string;
  }): NotificationDelivery | null;
  requestPermission(): Promise<NotificationPermission>;
  getChannel(): NotificationChannel;
  setChannel(channel: NotificationChannel): void;
  /** Actualiza el estado DND dinámico (compartido con useDoNotDisturb). */
  setDnd(dnd: NotificationDndState): void;
  isDndBlocked(urgent: boolean): boolean;
}

function readStoredChannel(fallback: NotificationChannel): NotificationChannel {
  if (typeof window === 'undefined') return fallback;
  const stored = localGet(STORAGE_KEYS.NOTIFICATION_CHANNEL);
  if (stored === 'none' || stored === 'toast' || stored === 'voice' || stored === 'both') {
    return stored;
  }
  return fallback;
}

export function createNotificationService(
  options: NotificationServiceOptions,
): NotificationService {
  const { config } = options;
  const driver = options.driver || createDefaultDriver();
  const now = options.now || (() => new Date());
  let dndState: NotificationDndState = options.dnd || {
    isActive: false,
    allowUrgent: false,
  };

  let channel = readStoredChannel(config.channel);

  const resolveDelivery = (ch: NotificationChannel): NotificationDelivery | null => {
    switch (ch) {
      case 'toast':
        return 'toast';
      case 'voice':
        return 'voice';
      case 'both':
        return 'both';
      default:
        return null;
    }
  };

  const isDndBlocked = (urgent: boolean): boolean =>
    dndState.isActive && !(urgent && dndState.allowUrgent);

  const setDnd = (next: NotificationDndState): void => {
    dndState = next;
  };

  const muted = (category: string): boolean =>
    Array.isArray(config.mutedCategories) && config.mutedCategories.includes(category);

  const notify = (input: {
    category: string;
    title?: string;
    body: string;
    urgent?: boolean;
    icon?: string;
    action?: string;
  }): NotificationDelivery | null => {
    if (!config.enabled) return null;
    const delivery = resolveDelivery(channel);
    if (!delivery) return null;
    if (isDndBlocked(input.urgent === true)) return null;
    if (muted(input.category)) return null;

    const notification: AppNotification = {
      id: `${input.category}-${Date.now()}`,
      category: input.category,
      title: input.title || config.defaultTitle || 'FLU OS4',
      body: input.body,
      timestamp: now().getTime(),
      urgent: input.urgent,
      icon: input.icon,
      action: input.action,
    };

    // Evento interno para toasts del centro de notificaciones.
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent<NotificationDispatch>(NOTIFICATION_EVENT, {
          detail: { notification, delivery },
        }),
      );
    }

    // Notificación del sistema vía service worker (solo si incluye toast).
    if (
      config.webApiEnabled !== false &&
      (delivery === 'toast' || delivery === 'both') &&
      driver.isSupported() &&
      driver.getPermission() === 'granted'
    ) {
      driver.showSystemNotification(notification).catch((e) => { logCaughtError('[catch] src/core/notifications/notificationService.ts', e); });
    }

    return delivery;
  };

  const requestPermission = async (): Promise<NotificationPermission> => {
    const permission = await driver.requestPermission();
    if (typeof window !== 'undefined') {
      localSet(STORAGE_KEYS.NOTIFICATION_PERMISSION, permission);
    }
    return permission;
  };

  const setChannel = (next: NotificationChannel): void => {
    channel = next;
    if (typeof window !== 'undefined') {
      localSet(STORAGE_KEYS.NOTIFICATION_CHANNEL, next);
    }
  };

  return {
    notify,
    requestPermission,
    getChannel: () => channel,
    setChannel,
    setDnd,
    isDndBlocked,
  };
}
