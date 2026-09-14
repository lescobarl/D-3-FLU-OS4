// ============================================================
// useTemporalItems — Motor temporal genérico (alarmas + temporizadores)
// ------------------------------------------------------------
// Hook que gestiona alarmas y temporizadores sobre Dexie
// (fluDb.temporalItems) vía temporalService y ejecuta el scheduler
// (tickMs desde FLU_CONFIG.temporal): cuando un ítem vence, se
// re-arranca (recurrencia) o se completa, y se dispara
// notify({category: item.kind, ...}) + voz + tono WebAudio.
//
// Modelo genérico (un solo motor para recordatorios, alarmas y
// temporizadores):
//   trigger  = absolute (una vez) | daily (hora del día) | countdown
//   recurrence = once | daily | weekdays | interval
//   delivery = notify (toast) + speak (voz) + audio (tono)
//
// Cumple:
//   - Rule #1: NO HARDCODE — intervalos/límites/etiquetas desde
//     FLU_CONFIG.temporal
//   - Obligación #5: auditoría (la hace temporalService)
//   - Obligación #6/#7: UUIDv4 + SyncTuple (los hace temporalService)
//   - DI: now/notify/speak/audio inyectables para pruebas deterministas
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { fluDb } from '../core/db/fluDatabase';
import {
  createTemporalService,
  type AddTemporalResult,
  type NewTemporalItemInput,
  type TemporalItemRecord,
  type TemporalService,
} from '../core/temporal/temporalService';
import { collectDueOrdered, nextOccurrence } from '../core/temporal/scheduleEngine';
import {
  createWebAudioDriver,
  type AudioDriver,
  type SoundOptions,
} from '../core/temporal/audioAlert';

// ------------------------------------------------------------
// Tipos
// ------------------------------------------------------------

/** Forma mínima que el hook acepta para notificar vencimientos. */
export interface TemporalNotifyInput {
  category: string;
  title: string;
  body: string;
  urgent?: boolean;
}

export interface UseTemporalItemsOptions {
  /** Anuncio por voz del vencimiento (opcional). */
  speak?: (text: string, lang: string) => Promise<void>;
  /** Dispara la notificación (esperado: notificationCenter.service.notify).
   *  Devuelve el canal entregado ('voice'|'both'|'toast') o null/undefined
   *  si no se entregó; si el canal YA incluye voz, el hook no repite speak. */
  notify?: (input: TemporalNotifyInput) => unknown;
  /** Idioma para los anuncios por voz. */
  language?: string;
  /** Referencia de reloj (por defecto: Date.now()). */
  now?: () => number;
  /** Driver de audio para el tono (por defecto: createWebAudioDriver()). */
  audio?: AudioDriver;
  /** Usuario activo: aísla alarmas/temporizadores por usuario. */
  participantId?: string;
}

export interface TemporalItemsState {
  alarms: TemporalItemRecord[];
  timers: TemporalItemRecord[];
  loading: boolean;
  /** Ítem que está sonando ahora (para ofrecer "Detener"). */
  ringing: TemporalRinging | null;
}

/** Estado de un ítem que acaba de vencer y está sonando. */
export interface TemporalRinging {
  id: string;
  kind: string;
  label: string;
  at: number;
}

export interface TemporalItemsActions {
  refresh: () => Promise<void>;
  add: (input: NewTemporalItemInput) => Promise<AddTemporalResult>;
  cancel: (id: string) => Promise<TemporalItemRecord | null>;
  /** Edita etiqueta y/o hora de un ítem. */
  update: (id: string, patch: { label?: string; timeOfDay?: string }) => Promise<TemporalItemRecord | null>;
  remove: (id: string) => Promise<boolean>;
  /** Silencia la alarma/temporizador que está sonando (no cancela el ítem). */
  stopRinging: () => void;
}

export interface UseTemporalItemsResult extends TemporalItemsState, TemporalItemsActions {
  service: TemporalService;
}

// ------------------------------------------------------------
// Hook
// ------------------------------------------------------------

export function useTemporalItems({
  speak,
  notify,
  language = 'es',
  now,
  audio,
  participantId,
}: UseTemporalItemsOptions = {}): UseTemporalItemsResult {
  const scope = participantId || 'global';
  const config = FLU_CONFIG.temporal || {};
  const configExtra = config as Record<string, unknown>;
  const maxActive = Number(config.maxActive) || 12;
  const tickMs = Number(config.tickMs) || 30000;
  const graceMs = Number(config.graceMs) || 15000;
  const limit = Number(configExtra.limit) || 20;
  const sound = (config.sound || {}) as SoundOptions;
  const voice = config.voice || {};
  const voiceAlarmDue = voice.alarmDue || 'Es la hora de tu alarma:';
  const voiceTimerDue = voice.timerDue || '¡Tiempo cumplido!';
  const ui = config.ui || {};
  const alarmsLabel = ui.alarmsLabel || 'Alarmas';
  const timersLabel = ui.timersLabel || 'Temporizadores';
  const lang = language === 'en' ? 'en' : 'es';

  // Crear el servicio ANTES de cualquier useState: el inicializador de
  // estado o los callbacks referencian `service`, y una referencia en
  // la zona muerta temporal (TDZ) rompería el arranque con
  // "Cannot access 'service' before initialization".
  const serviceRef = useRef<TemporalService | null>(null);
  if (!serviceRef.current) {
    serviceRef.current = createTemporalService({
      db: fluDb.temporalItems,
      config: { maxActive },
      now: now || (() => Date.now()),
    });
  }
  const service = serviceRef.current;

  // Driver de audio "latest" (mismo patrón TDZ-safe que el servicio).
  const audioRef = useRef<AudioDriver | null>(null);
  if (!audioRef.current) {
    audioRef.current = audio || createWebAudioDriver();
  }
  const audioDriver = audioRef.current;

  // Reloj "latest": permite que `now` cambie sin closures obsoletas.
  const nowRef = useRef(now || (() => Date.now()));
  nowRef.current = now || (() => Date.now());

  // speak/notify "latest": App los pasa inline (identidad nueva en cada
  // render). Guardarlos en refs evita que runTick (y por tanto el efecto
  // del scheduler) se re-cree en cada render y re-registre el intervalo,
  // lo que podía disparar el vencimiento más de una vez (alarma triplicada).
  const speakRef = useRef(speak);
  speakRef.current = speak;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const [alarms, setAlarms] = useState<TemporalItemRecord[]>([]);
  const [timers, setTimers] = useState<TemporalItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [ringing, setRinging] = useState<TemporalRinging | null>(null);
  const ringingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoStopMs = Number(configExtra.autoStopMs) || 30000;

  // Ref de guardia para no solapar ticks asíncronos del scheduler.
  const runningRef = useRef(false);

  /** Recarga las listas desde IndexedDB (ordenadas por próximo disparo).
   *  Solo expone ítems activos (status 'pending'): un ítem cancelado o
   *  completado debe salir de la UI (Hoy y Ajustes) al pulsar su botón ×,
   *  mismo criterio que listActive/listDue del servicio. */
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const all = await service.list();
      // Aislamiento por usuario: solo alarmas/temporizadores de ESTE usuario.
      const scoped = all.filter((r) => (r.personId || 'global') === scope);
      const sorted = scoped.slice().sort((a, b) => a.nextAt - b.nextAt);
      setAlarms(sorted.filter((r) => r.kind === 'alarm' && r.status === 'pending'));
      setTimers(sorted.filter((r) => r.kind === 'timer' && r.status === 'pending'));
    } catch (err) {
      console.error('[useTemporalItems] refresh error:', err);
    } finally {
      setLoading(false);
    }
  }, [service, scope]);

  /** Un tick del scheduler: re-arranca/completa los vencidos y notifica. */
  const runTick = useCallback(async (): Promise<void> => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      const activeAll = await service.listActive();
      // Aislamiento por usuario: no disparar alarmas de otros usuarios.
      const active = activeAll.filter((r) => (r.personId || 'global') === scope);
      const current = nowRef.current();
      const due = collectDueOrdered(active, current, ['pending'], limit, graceMs);
      for (const item of due) {
        const next = nextOccurrence(item.trigger, item.recurrence, current);
        if (next !== null) {
          await service.rearm(item.id, current);
        } else {
          await service.complete(item.id);
        }
        const isAlarm = item.kind === 'alarm';
        const dueText = isAlarm ? voiceAlarmDue : voiceTimerDue;
        const dueTitle = isAlarm ? alarmsLabel : timersLabel;
        const dueBody = isAlarm ? `${dueText} ${item.label}` : `${dueText} (${item.label})`;
        // Entrega única: si notify devuelve un canal con voz ('voice'/'both'),
        // el centro de notificaciones YA hablará → no repetir speak directo.
        // (Antes se llamaba speak SIEMPRE además de notify → voz duplicada.)
        let deliveredByVoice = false;
        if (typeof notifyRef.current === 'function') {
          const delivery = notifyRef.current({
            category: item.kind,
            title: dueTitle,
            body: dueBody,
            urgent: true,
          });
          deliveredByVoice = delivery === 'voice' || delivery === 'both';
        }
        if (!deliveredByVoice && typeof speakRef.current === 'function') {
          speakRef.current(dueBody, lang).catch(() => undefined);
        }
        audioDriver.play(sound).catch(() => undefined);
        setRinging({ id: item.id, kind: item.kind, label: item.label, at: current });
      }
      if (due.length > 0) {
        // Auto-stop configurable: si nadie pulsa "Detener", se silencia solo.
        if (ringingTimerRef.current) clearTimeout(ringingTimerRef.current);
        ringingTimerRef.current = setTimeout(() => {
          audioDriver.stop();
          setRinging(null);
          ringingTimerRef.current = null;
        }, autoStopMs);
        await refresh();
      }
    } catch (err) {
      console.error('[useTemporalItems] scheduler tick error:', err);
    } finally {
      runningRef.current = false;
    }
  }, [
    service,
    graceMs,
    voiceAlarmDue,
    voiceTimerDue,
    alarmsLabel,
    timersLabel,
    lang,
    refresh,
    audioDriver,
    sound,
    limit,
    autoStopMs,
  ]);

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

  /** Agrega una alarma o temporizador y refresca las listas. */
  const add = useCallback(
    async (input: NewTemporalItemInput): Promise<AddTemporalResult> => {
      const inputPersonId = (input as { personId?: string }).personId;
      const result = await service.add({
        ...input,
        personId: inputPersonId || (scope !== 'global' ? scope : undefined),
      } as NewTemporalItemInput);
      if (result.ok) await refresh();
      return result;
    },
    [service, refresh],
  );

  /** Cancela un ítem (lo saca de pendientes) y refresca. */
  const cancel = useCallback(
    async (id: string): Promise<TemporalItemRecord | null> => {
      const updated = await service.cancel(id);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Edita etiqueta/hora de un ítem y refresca. */
  const update = useCallback(
    async (
      id: string,
      patch: { label?: string; timeOfDay?: string },
    ): Promise<TemporalItemRecord | null> => {
      const updated = await service.update(id, patch);
      if (updated) await refresh();
      return updated;
    },
    [service, refresh],
  );

  /** Elimina el ítem y refresca. */
  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const removed = await service.remove(id);
      if (removed) await refresh();
      return removed;
    },
    [service, refresh],
  );

  /** Silencia lo que está sonando (no cancela el ítem pendiente). */
  const stopRinging = useCallback((): void => {
    if (ringingTimerRef.current) {
      clearTimeout(ringingTimerRef.current);
      ringingTimerRef.current = null;
    }
    audioDriver.stop();
    setRinging(null);
  }, [audioDriver]);

  // Limpieza del auto-stop al desmontar.
  useEffect(
    () => () => {
      if (ringingTimerRef.current) clearTimeout(ringingTimerRef.current);
    },
    [],
  );

  return {
    service,
    alarms,
    timers,
    loading,
    ringing,
    refresh,
    add,
    cancel,
    update,
    remove,
    stopRinging,
  };
}
