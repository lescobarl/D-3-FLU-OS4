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

export interface UseNotificationCenterOptions {
  speak: (text: string, lang: string) => Promise<void>;
  language?: string;
  dnd?: NotificationDndState;
}

export interface NotificationCenterState {
  toasts: NotificationToast[];
  channel: NotificationChannel;
  service: NotificationService;
  /** Cambia el canal y sincroniza el estado de React para la UI. */
  setChannel: (channel: NotificationChannel) => void;
  /** Descarta un toast por id (visible al hacer clic). */
  dismiss: (id: string) => void;
}

export function useNotificationCenter({
  speak,
  language = 'es',
  dnd,
}: UseNotificationCenterOptions): NotificationCenterState {
  const config = (FLU_CONFIG as any).notifications || {};
  const maxStack = Number(config.maxStack) || 4;
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
  const [channel, setChannelState] = useState<NotificationChannel>(() => service.getChannel());

  // Mantener el DND del servicio sincronizado con el estado del hook padre.
  useEffect(() => {
    service.setDnd(dnd || { isActive: false, allowUrgent: false });
  }, [dnd, service]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

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

  return { toasts, channel, service, setChannel, dismiss: dismissToast };
}
