// ============================================================
// useNotificationCenter — Centro de notificaciones (Fase 1, J2)
// ------------------------------------------------------------
// Escucha NOTIFICATION_EVENT ('flu-notification') emitido por
// notificationService y resuelve la entrega: toast (stack) y/o
// voz (speak). Config-driven (FLU_CONFIG.notifications).
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import {
  createNotificationService,
  NOTIFICATION_EVENT,
  type NotificationChannel,
  type NotificationDispatch,
  type NotificationDndState,
  type NotificationService,
} from '../core/notifications/notificationService';

export interface NotificationToast {
  id: string;
  title: string;
  body: string;
  category: string;
  urgent?: boolean;
  timestamp: number;
}

/** Entrada persistida del centro de notificaciones (historial consultable). */
export interface NotificationCenterItem extends NotificationToast {
  read: boolean;
}

export interface UseNotificationCenterOptions {
  speak: (text: string, lang: string) => Promise<void>;
  language?: string;
  dnd?: NotificationDndState;
}

export interface NotificationCenterState {
  toasts: NotificationToast[];
  /** Historial consultable del centro de notificaciones (últimas N, sin expirar). */
  history: NotificationCenterItem[];
  /** Número de notificaciones no leídas en el historial. */
  unread: number;
  channel: NotificationChannel;
  service: NotificationService;
  /** Cambia el canal y sincroniza el estado de React para la UI. */
  setChannel: (channel: NotificationChannel) => void;
  /** Descarta un toast por id (visible al hacer clic). */
  dismiss: (id: string) => void;
  /** Marca todo el historial como leído. */
  markAllRead: () => void;
  /** Limpia el historial del centro. */
  clear: () => void;
}

export function useNotificationCenter({
  speak,
  language = 'es',
  dnd,
}: UseNotificationCenterOptions): NotificationCenterState {
  const config = (FLU_CONFIG as any).notifications || {};
  const maxStack = Number(config.maxStack) || 4;
  const maxHistory = Number(config.maxHistory) || 50;
  const toastDurationMs = Number(config.toastDurationMs) || 6000;
  const lang = language === 'en' ? 'en' : 'es';

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado referencia `service`, y una referencia en la zona muerta
  // temporal (TDZ) rompería el arranque con "Cannot access 'service'
  // before initialization".
  const serviceRef = useRef<NotificationService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createNotificationService({
      config,
      dnd: dnd || { isActive: false, allowUrgent: false },
    });
  }
  const service = serviceRef.current;

  const [toasts, setToasts] = useState<NotificationToast[]>([]);
  const [history, setHistory] = useState<NotificationCenterItem[]>([]);
  const [channel, setChannelState] = useState<NotificationChannel>(() => service.getChannel());

  // Mantener el DND del servicio sincronizado con el estado del hook padre.
  useEffect(() => {
    service.setDnd(dnd || { isActive: false, allowUrgent: false });
  }, [dnd, service]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const markAllRead = useCallback(() => {
    setHistory((prev) => prev.map((item) => ({ ...item, read: true })));
  }, []);

  const clear = useCallback(() => {
    setHistory([]);
  }, []);

  const unread = history.filter((item) => !item.read).length;

  const setChannel = useCallback(
    (next: NotificationChannel) => {
      service.setChannel(next);
      setChannelState(next);
    },
    [service],
  );

  useEffect(() => {
    const timers = new Map<string, number>();
    const onNotification = (event: Event) => {
      const detail = (event as CustomEvent<NotificationDispatch>).detail;
      if (!detail || !detail.notification) return;
      const { notification, delivery } = detail;
      const shouldToast = delivery === 'toast' || delivery === 'both';
      const shouldSpeak = delivery === 'voice' || delivery === 'both';

      if (shouldToast) {
        const toast: NotificationToast = {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          category: notification.category,
          urgent: notification.urgent,
          timestamp: notification.timestamp,
        };
        setToasts((prev) => [toast, ...prev].slice(0, maxStack));
        const timer = window.setTimeout(() => dismissToast(notification.id), toastDurationMs);
        timers.set(notification.id, timer);
      }

      // Historial consultable del centro: toda notificación entregada (toast
      // y/o voz) queda registrada para revisarse después (no solo como toast
      // transitorio que desaparece).
      if (shouldToast || shouldSpeak) {
        const item: NotificationCenterItem = {
          id: notification.id,
          title: notification.title,
          body: notification.body,
          category: notification.category,
          urgent: notification.urgent,
          timestamp: notification.timestamp,
          read: false,
        };
        setHistory((prev) => [item, ...prev].slice(0, maxHistory));
      }

      if (shouldSpeak && typeof speak === 'function') {
        speak(notification.body, lang).catch(() => undefined);
      }
    };

    window.addEventListener(NOTIFICATION_EVENT, onNotification);
    return () => {
      window.removeEventListener(NOTIFICATION_EVENT, onNotification);
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [speak, lang, toastDurationMs, maxStack, dismissToast]);

  return {
    toasts,
    history,
    unread,
    channel,
    service,
    setChannel,
    dismiss: dismissToast,
    markAllRead,
    clear,
  };
}
