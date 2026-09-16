// ============================================================
// useReminders — Recordatorios (Fase 2, B1/B3/B4)
// ------------------------------------------------------------
// Hook que gestiona recordatorios sobre Dexie (fluDb.reminders)
// vía reminderService y ejecuta el scheduler (tickMs desde
// FLU_CONFIG.reminders): cuando un recordatorio vence, se marca
// como completado y se dispara notify({category:'reminder', ...}),
// que la capa de notificaciones convierte en toast + voz.
//
// Cumple:
//   - Rule #1: NO HARDCODE — intervalos/límites desde FLU_CONFIG
//   - Obligación #5: auditoría (la hace reminderService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace reminderService)
//   - DI: now/notify/speak inyectables para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb, type ReminderRecord } from '../core/db/fluDatabase';
import {
  createReminderAgenda,
  type AddReminderResult,
  type ReminderAgenda,
} from '../core/agenda/agendaService';
import type { NewReminderInput } from '../core/agenda/agendaShared';
import { collectDueOrdered } from '../core/reminders/reminderScheduler';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Forma mínima que el hook acepta para notificar vencimientos. */
export interface ReminderNotifyInput {
  category: string;
  title: string;
  body: string;
  urgent?: boolean;
}

export interface UseRemindersOptions {
  /** Anuncio por voz del vencimiento (opcional). */
  speak?: (text: string, lang: string) => Promise<void>;
  /** Dispara la notificación (esperado: notificationCenter.service.notify).
   *  Devuelve el canal entregado ('voice'|'both'|'toast') o null/undefined
   *  si no se entregó; si el canal YA incluye voz, el hook no repite speak. */
  notify?: (input: ReminderNotifyInput) => unknown;
  /** Idioma para los anuncios por voz. */
  language?: string;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Usuario activo: aísla los recordatorios (cada usuario ve solo los suyos). */
  participantId?: string;
}

export interface RemindersState {
  reminders: ReminderRecord[];
  loading: boolean;
  pendingCount: number;
}

export interface RemindersActions {
  refresh: () => Promise<void>;
  add: (input: NewReminderInput) => Promise<AddReminderResult>;
  complete: (id: string) => Promise<ReminderRecord | null>;
  dismiss: (id: string) => Promise<ReminderRecord | null>;
  update: (id: string, patch: { text?: string; dueAt?: number }) => Promise<ReminderRecord | null>;
  remove: (id: string) => Promise<boolean>;
}

export interface UseRemindersResult extends RemindersState, RemindersActions {
  service: ReminderAgenda;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useReminders({
  speak,
  notify,
  language = 'es',
  now,
  participantId,
}: UseRemindersOptions = {}): UseRemindersResult {
  const scope = participantId || 'global';
  const config = FLU_CONFIG.reminders || {};
  const maxPerDay = Number(config.maxPerDay) || 20;
  const defaultCategory = config.defaultCategory || 'reminder';
  const tickMs = Number(config.tickMs) || 30000;
  const graceMs = Number(config.graceMs) || 15000;
  const voiceDue = (config.voice && config.voice.due) || 'Tienes un recordatorio pendiente:';
  const lang = language === 'en' ? 'en' : 'es';

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<ReminderAgenda | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createReminderAgenda({
      db: fluDb.reminders,
      config: { maxPerDay, defaultCategory },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  // Reloj "latest": permite que `now` cambie sin closures obsoletas.
  const nowRef = useRef(now || (() => Date.now()));
  nowRef.current = now || (() => Date.now());

  // speak/notify "latest": App los pasa inline (identidad nueva en cada
  // render). Guardarlos en refs evita que runTick (y el efecto del
  // scheduler) se re-cree en cada render y dispare el vencimiento varias
  // veces (recordatorio/alarma duplicados).
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const [reminders, setReminders] = useState<ReminderRecord[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);

  // Ref de guardia para no solapar ticks asíncronos del scheduler.
  const runningRef = useRef(false);

  /** Recarga la lista desde IndexedDB (ordenada por vencimiento). */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      // Aislamiento por usuario: solo los recordatorios de ESTE usuario.
      const scoped = all.filter((r) => (r.personId || 'global') === scope);
      const sorted = scoped.slice().sort((a, b) => a.dueAt - b.dueAt);
      setReminders(sorted);
      setPendingCount(sorted.filter((r) => r.status === 'pending').length);
    } catch (err) {
      console.error('[useReminders] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service, scope]);

  /** Un tick del scheduler: marca los vencidos y notifica. */
  const runTick = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const pending = await service.listPending();
      const current = nowRef.current();
      const due = collectDueOrdered(pending, current, ['pending'], 20, graceMs);
      for (const record of due) {
        await service.complete(record.id);
        // Entrega única: si notify devuelve un canal con voz ('voice'/'both'),
        // el centro ya hablará → no repetir speak directo.
        let deliveredByVoice = false;
        if (typeof notifyRef.current === 'function') {
          const delivery = notifyRef.current({
            category: 'reminder',
            title: lang === 'en' ? 'Reminder' : 'Recordatorio',
            body: `${voiceDue} ${record.text}`,
            urgent: true,
          });
          deliveredByVoice = delivery === 'voice' || delivery === 'both';
        }
        if (!deliveredByVoice && typeof speakRef.current === 'function') {
          speakRef.current(`${voiceDue} ${record.text}`, lang).catch(() => undefined);
        }
      }
      if (due.length > 0) {
        await refresh();
      }
    } catch (err) {
      console.error('[useReminders] scheduler tick error:', err);
    } finally {
      runningRef.current = false;
    }
  }, [service, graceMs, voiceDue, lang, refresh]);

  // Carga inicial.
  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  // Scheduler: tick inicial + intervalo configurable.
  useEffect(() => {
    runTick().catch(() => undefined);
    const id = window.setInterval(() => {
      runTick().catch(() => undefined);
    }, tickMs);
    return () => window.clearInterval(id);
  }, [runTick, tickMs]);

  /** Agrega un recordatorio y refresca la lista. */
  const add = useCallback(
    async (input: NewReminderInput): Promise<AddReminderResult> => {
      const result = await service.add({
        ...input,
        personId: input.personId || (scope !== 'global' ? scope : undefined),
      });
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh, scope],
  );

  /** Marca como completado y refresca. */
  const complete = useCallback(
    async (id: string): Promise<ReminderRecord | null> => {
      const updated = await service.complete(id);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Descarta el recordatorio (no molestar) y refresca. */
  const dismiss = useCallback(
    async (id: string): Promise<ReminderRecord | null> => {
      const updated = await service.dismiss(id);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Edita texto y/o vencimiento del recordatorio y refresca. */
  const update = useCallback(
    async (id: string, patch: { text?: string; dueAt?: number }): Promise<ReminderRecord | null> => {
      const updated = await service.update(id, patch);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Elimina el recordatorio y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await service.remove(id);
      if (removed) await refresh();
      return removed;
    },
    [service, refresh],
  );

  return {
    service,
    reminders,
    loading,
    pendingCount,
    refresh,
    add,
    complete,
    dismiss,
    update,
    remove,
  };
}
