// @vitest-environment jsdom
// ============================================================
// Notification Service — Centro de notificaciones (Fase 1, J2)
// Pruebas con driver inyectable (fake) y captura del CustomEvent
// NOTIFICATION_EVENT sobre window (jsdom).
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNotificationService,
  NOTIFICATION_EVENT,
  type NotificationChannel,
  type NotificationDriver,
  type NotificationConfig,
  type NotificationDispatch,
} from '../src/core/notifications/notificationService';
import { STORAGE_KEYS } from '../src/core/config/appConfig';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const baseConfig = (FLU_CONFIG as any).notifications as NotificationConfig;

function createFakeDriver(overrides?: Partial<NotificationDriver>): NotificationDriver {
  return {
    isSupported: vi.fn(() => true),
    getPermission: vi.fn(() => 'granted' as NotificationPermission),
    requestPermission: vi.fn(async () => 'granted' as NotificationPermission),
    showSystemNotification: vi.fn(async () => true),
    ...overrides,
  };
}

/** Registra un listener y devuelve el detalle del primer CustomEvent emitido. */
function captureEvent(): { listener: (event: Event) => void; events: NotificationDispatch[] } {
  const events: NotificationDispatch[] = [];
  const listener = (event: Event) => {
    events.push((event as CustomEvent<NotificationDispatch>).detail);
  };
  window.addEventListener(NOTIFICATION_EVENT, listener);
  return { listener, events };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('notificationService — resolución de canal de entrega', () => {
  it('channel toast → delivery toast y emite CustomEvent con detail', () => {
    const driver = createFakeDriver();
    const service = createNotificationService({ config: baseConfig, driver });
    const { listener, events } = captureEvent();

    const delivery = service.notify({ category: 'reminder', body: 'Hora del agua' });

    expect(delivery).toBe('toast');
    expect(events).toHaveLength(1);
    expect(events[0].delivery).toBe('toast');
    expect(events[0].notification.body).toBe('Hora del agua');
    expect(events[0].notification.category).toBe('reminder');
    expect(events[0].notification.title).toBe(baseConfig.defaultTitle); // fallback de título
    expect(events[0].notification.id.startsWith('reminder-')).toBe(true);

    window.removeEventListener(NOTIFICATION_EVENT, listener);
  });

  it('channel voice → delivery voice (sin notificación de sistema)', () => {
    const driver = createFakeDriver();
    const service = createNotificationService({
      config: { ...baseConfig, channel: 'voice' },
      driver,
    });
    const { listener, events } = captureEvent();

    expect(service.notify({ category: 'reminder', body: 'x' })).toBe('voice');
    expect(events[0].delivery).toBe('voice');
    expect(driver.showSystemNotification).not.toHaveBeenCalled();

    window.removeEventListener(NOTIFICATION_EVENT, listener);
  });

  it('channel both → delivery both y sí usa la API del sistema', () => {
    const driver = createFakeDriver();
    const service = createNotificationService({
      config: { ...baseConfig, channel: 'both' },
      driver,
    });
    const { listener, events } = captureEvent();

    expect(service.notify({ category: 'reminder', body: 'x' })).toBe('both');
    expect(events[0].delivery).toBe('both');
    expect(driver.showSystemNotification).toHaveBeenCalledTimes(1);

    window.removeEventListener(NOTIFICATION_EVENT, listener);
  });

  it('channel none → null sin emitir evento', () => {
    const driver = createFakeDriver();
    const service = createNotificationService({
      config: { ...baseConfig, channel: 'none' },
      driver,
    });
    const { listener, events } = captureEvent();

    expect(service.notify({ category: 'reminder', body: 'x' })).toBeNull();
    expect(events).toHaveLength(0);

    window.removeEventListener(NOTIFICATION_EVENT, listener);
  });

  it('config deshabilitado → null sin importar el canal', () => {
    const service = createNotificationService({
      config: { ...baseConfig, enabled: false },
      driver: createFakeDriver(),
    });
    expect(service.notify({ category: 'reminder', body: 'x' })).toBeNull();
  });
});

describe('notificationService — no molestar (DND)', () => {
  it('DND activo bloquea lo no urgente y deja pasar lo urgente si allowUrgent', () => {
    const service = createNotificationService({
      config: baseConfig,
      driver: createFakeDriver(),
      dnd: { isActive: true, allowUrgent: true },
    });
    expect(service.isDndBlocked(false)).toBe(true);
    expect(service.isDndBlocked(true)).toBe(false);
    expect(service.notify({ category: 'reminder', body: 'x' })).toBeNull();
    expect(service.notify({ category: 'alarm', body: 'x', urgent: true })).toBe('toast');
  });

  it('DND activo con allowUrgent false bloquea también lo urgente', () => {
    const service = createNotificationService({
      config: baseConfig,
      driver: createFakeDriver(),
      dnd: { isActive: true, allowUrgent: false },
    });
    expect(service.isDndBlocked(true)).toBe(true);
    expect(service.notify({ category: 'alarm', body: 'x', urgent: true })).toBeNull();
  });

  it('setDnd actualiza el estado DND en caliente', () => {
    const service = createNotificationService({
      config: baseConfig,
      driver: createFakeDriver(),
    });
    expect(service.notify({ category: 'reminder', body: 'x' })).toBe('toast');
    service.setDnd({ isActive: true, allowUrgent: false });
    expect(service.notify({ category: 'reminder', body: 'x' })).toBeNull();
  });
});

describe('notificationService — categorías silenciadas y sistema', () => {
  it('categoría en mutedCategories → null', () => {
    const service = createNotificationService({
      config: { ...baseConfig, mutedCategories: ['spam'] },
      driver: createFakeDriver(),
    });
    expect(service.notify({ category: 'spam', body: 'x' })).toBeNull();
    expect(service.notify({ category: 'news', body: 'x' })).toBe('toast');
  });

  it('no llama a showSystemNotification si el permiso no es granted', () => {
    const driver = createFakeDriver({ getPermission: vi.fn(() => 'denied' as NotificationPermission) });
    const service = createNotificationService({ config: baseConfig, driver });
    expect(service.notify({ category: 'reminder', body: 'x' })).toBe('toast');
    expect(driver.showSystemNotification).not.toHaveBeenCalled();
  });

  it('no llama a showSystemNotification si webApiEnabled es false', () => {
    const driver = createFakeDriver();
    const service = createNotificationService({
      config: { ...baseConfig, webApiEnabled: false },
      driver,
    });
    expect(service.notify({ category: 'reminder', body: 'x' })).toBe('toast');
    expect(driver.showSystemNotification).not.toHaveBeenCalled();
  });
});

describe('notificationService — canal persistido y permisos', () => {
  it('setChannel persiste en localStorage y getChannel lo refleja', () => {
    const service = createNotificationService({ config: baseConfig, driver: createFakeDriver() });
    expect(service.getChannel()).toBe('toast'); // fallback del config
    service.setChannel('both');
    expect(service.getChannel()).toBe('both');
    expect(window.localStorage.getItem(STORAGE_KEYS.NOTIFICATION_CHANNEL)).toBe('both');
  });

  it('un servicio nuevo lee el canal persistido en localStorage', () => {
    window.localStorage.setItem(STORAGE_KEYS.NOTIFICATION_CHANNEL, 'voice');
    const service = createNotificationService({ config: baseConfig, driver: createFakeDriver() });
    expect(service.getChannel()).toBe('voice');
  });

  it('un valor inválido en storage cae al fallback del config', () => {
    window.localStorage.setItem(STORAGE_KEYS.NOTIFICATION_CHANNEL, 'carrier-pigeon');
    const service = createNotificationService({ config: baseConfig, driver: createFakeDriver() });
    expect(service.getChannel()).toBe('toast');
  });

  it('requestPermission delega en el driver y persiste el permiso', async () => {
    const driver = createFakeDriver({ requestPermission: vi.fn(async () => 'denied' as NotificationPermission) });
    const service = createNotificationService({ config: baseConfig, driver });
    const permission = await service.requestPermission();
    expect(permission).toBe('denied');
    expect(driver.requestPermission).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(STORAGE_KEYS.NOTIFICATION_PERMISSION)).toBe('denied');
  });

  it('notify acepta título personalizado', () => {
    const service = createNotificationService({ config: baseConfig, driver: createFakeDriver() });
    const { listener, events } = captureEvent();
    service.notify({ category: 'reminder', title: 'Mi aviso', body: 'x' });
    expect(events[0].notification.title).toBe('Mi aviso');
    window.removeEventListener(NOTIFICATION_EVENT, listener);
  });
});

describe('notificationService — coherencia con FLU_CONFIG', () => {
  it('el config real está habilitado con canal toast y stack limitado', () => {
    expect(baseConfig.enabled).toBe(true);
    expect(baseConfig.channel).toBe('toast');
    expect(baseConfig.defaultTitle).toBe('FLU OS4');
    expect(typeof baseConfig.toastDurationMs).toBe('number');
    expect(baseConfig.maxStack).toBeGreaterThan(0);
    expect(Array.isArray(baseConfig.mutedCategories)).toBe(true);
  });

  it('los nombres de evento y storage no contienen strings mágicos', () => {
    expect(NOTIFICATION_EVENT).toBe('flu-notification');
    expect(STORAGE_KEYS.NOTIFICATION_CHANNEL).toBe('flu-notification-channel');
    expect(STORAGE_KEYS.NOTIFICATION_PERMISSION).toBe('flu-notification-permission');
  });

  it('tipos de canal validados son exactamente el contrato', () => {
    const channels: NotificationChannel[] = ['none', 'toast', 'voice', 'both'];
    expect(channels).toContain(baseConfig.channel);
  });
});
