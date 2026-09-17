// ============================================================
// src/hooks/useAgenda.ts
// Motor ÚNICO en runtime del calendario unificado.
// ------------------------------------------------------------
// Lee los pendientes de la tabla `agenda`, corre `runAgendaCycle` (puro) y
// despacha por cada vencido la acción de su tipo vía `onFire`. Los NO
// recurrentes se marcan `done`; los recurrentes se re-agendan (su próxima
// ocurrencia ya es futura). Reemplaza a `reminderScheduler`+`audioAlert`.
//
// Disparo SEGURO (portado de useTemporalItems, sin reintroducir los bugs de
// alarma):
//   - stopEpoch: `stopRinging()` invalida el tick en vuelo para que no
//     vuelva a sonar (anti re-sonar).
//   - auto-stop: si nadie pulsa "Detener", el tono se silencia solo
//     (autoStopMs desde FLU_CONFIG.agenda).
//   - stopRinging: silencia lo que suena SIN cancelar el item pendiente.
//   - ringing: item que está sonando ahora (para ofrecer "Detener").
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { runAgendaCycle } from '../core/agenda/agendaMotor';
import type { AgendaService } from '../core/agenda/agendaService';
import type { AgendaItem, AgendaKind } from '../core/agenda/agendaModel';
import { createWebAudioDriver, type AudioDriver } from '../core/temporal/audioAlert';
import { FLU_CONFIG } from '../voice/lib/fluConfig';

export type AgendaFireAction = 'sonar' | 'avisar' | 'marcar';

/** Item que acaba de vencer y está sonando (para ofrecer "Detener"). */
export interface AgendaRinging {
    id: string;
    kind: AgendaKind;
    label: string;
    at: number;
}

export interface UseAgendaOptions {
    service: AgendaService;
    personId?: string;
    /** Ejecuta la acción real (sonar/avisar/marcar) por cada vencido.
     *  Inyectada por la app (audioDriver + notificationCenter.notify + speak). */
    onFire: (action: AgendaFireAction, item: AgendaItem) => void | Promise<void>;
    /** Driver de audio para el tono (por defecto: createWebAudioDriver()).
     *  Se inyecta para que `stopRinging`/auto-stop detengan EL MISMO driver
     *  que usa `onFire` al sonar. */
    audio?: AudioDriver;
    /** Referencia de reloj (por defecto: Date.now()). */
    now?: () => number;
    /** Tope de espera entre ticks (ms). */
    tickMs?: number;
}

export interface UseAgendaResult {
    /** Pendientes visibles (ya filtrados por participante). */
    items: AgendaItem[];
    /** Item que está sonando ahora (para ofrecer "Detener"). */
    ringing: AgendaRinging | null;
    /** Silencia lo que suena (no cancela el item pendiente). */
    stopRinging: () => void;
    /** Vacía la agenda del usuario activo y refresca el panel de inmediato. */
    clearAll: () => Promise<number>;
}

export function useAgenda({
    service,
    personId,
    onFire,
    audio,
    now,
    tickMs = 15000,
}: UseAgendaOptions): UseAgendaResult {
    const [items, setItems] = useState<AgendaItem[]>([]);
    const [ringing, setRinging] = useState<AgendaRinging | null>(null);
    // Al incrementarlo se re-ejecuta el tick del scheduler de inmediato
    // (refresco bajo demanda, sin esperar los 15 s del polling).
    const [reloadToken, setReloadToken] = useState(0);

    const onFireRef = useRef(onFire);
    onFireRef.current = onFire;

    // Reloj "latest": permite que `now` cambie sin closures obsoletas.
    const nowRef = useRef(now || (() => Date.now()));
    nowRef.current = now || (() => Date.now());

    // Driver de audio "latest" (mismo patrón TDZ-safe que useTemporalItems).
    // `stopRinging` y el auto-stop llaman `.stop()` sobre ESTE driver.
    const audioRef = useRef<AudioDriver | null>(null);
    if (!audioRef.current) {
        audioRef.current = audio || createWebAudioDriver();
    }
    const audioDriver = audioRef.current;

    // Ref de guardia para no solapar ticks asíncronos del scheduler.
    const runningRef = useRef(false);
    // Época de timbre: `stopRinging()` la incrementa para que un tick en vuelo
    // deje de sonar (no vuelva a llamar a onFire para vencidos pendientes).
    const stopEpochRef = useRef(0);
    // Timer del auto-stop (silenciado automático si nadie pulsa "Detener").
    const ringingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const agendaConfig = (FLU_CONFIG.agenda || {}) as Record<string, unknown>;
    const autoStopMs = Number(agendaConfig.autoStopMs) || 30000;

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        // Sin usuario real NO hay agenda: ni lectura ni disparo. Evita mostrar
        // (y sonar) ítems de otro alcance durante el onboarding.
        if (!personId) {
            setItems([]);
            setRinging(null);
            return;
        }

        const tick = async () => {
            if (runningRef.current) return;
            runningRef.current = true;
            const epoch = stopEpochRef.current;
            let nextTick: number | null = null;
            try {
                const all = await service.list({ personId, status: 'pending' });
                if (cancelled) return;
                setItems(all);

                const cycle = runAgendaCycle(all, nowRef.current());
                const { fires } = cycle;
                nextTick = cycle.nextTick;
                for (const fire of fires) {
                    // "Detener" durante el tick: no seguir sonando otros vencidos.
                    if (stopEpochRef.current !== epoch) break;
                    await onFireRef.current(fire.action, fire.item);
                    if (!fire.recurring) {
                        await service.complete(fire.item.id);
                    }
                    // "Detener" pudo ocurrir durante onFire/complete: no sonar después.
                    if (stopEpochRef.current !== epoch) break;
                    setRinging({
                        id: fire.item.id,
                        kind: fire.item.kind,
                        label: fire.item.label,
                        at: nowRef.current(),
                    });
                }
                if (fires.length > 0 && stopEpochRef.current === epoch) {
                    // Auto-stop configurable: si nadie pulsa "Detener", se silencia solo.
                    if (ringingTimerRef.current) clearTimeout(ringingTimerRef.current);
                    ringingTimerRef.current = setTimeout(() => {
                        audioDriver.stop();
                        setRinging(null);
                        ringingTimerRef.current = null;
                    }, autoStopMs);
                }
            } catch (err) {
                console.error('[useAgenda] scheduler tick error:', err);
            } finally {
                runningRef.current = false;
            }
            if (!cancelled) {
                const delay = nextTick
                    ? Math.max(1000, Math.min(nextTick - nowRef.current(), tickMs))
                    : tickMs;
                timer = setTimeout(() => void tick(), delay);
            }
        };
        void tick();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [service, personId, tickMs, autoStopMs, audioDriver, reloadToken]);

    /**
     * Vacía la agenda del usuario y REFRESCA el panel de inmediato (no espera
     * al próximo tick del scheduler, que por defecto es de 15 s).
     */
    const clearAll = useCallback(async (): Promise<number> => {
        if (!personId) return 0;
        const count = await service.clearAll({ personId });
        setItems([]);
        setReloadToken((n) => n + 1);
        return count;
    }, [service, personId]);

    /** Silencia lo que está sonando (no cancela el item pendiente). */
    const stopRinging = useCallback((): void => {
        // Invalida el tick en vuelo: no debe sonar ningún otro vencido.
        stopEpochRef.current += 1;
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

    return { items, ringing, stopRinging, clearAll };
}
