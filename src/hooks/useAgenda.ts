// ============================================================
// src/hooks/useAgenda.ts
// Motor ÚNICO en runtime del calendario unificado.
// ------------------------------------------------------------
// Lee los pendientes de la tabla `agenda`, corre `runAgendaCycle` (puro) y
// despacha por cada vencido la acción de su tipo vía `onFire`. Los NO
// recurrentes se marcan `done`; los recurrentes se re-agendan (su próxima
// ocurrencia ya es futura). Reemplaza a `reminderScheduler`+`audioAlert`.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { runAgendaCycle } from '../core/agenda/agendaMotor';
import type { AgendaService } from '../core/agenda/agendaService';
import type { AgendaItem } from '../core/agenda/agendaModel';

export type AgendaFireAction = 'sonar' | 'avisar' | 'marcar';

export interface UseAgendaOptions {
    service: AgendaService;
    personId?: string;
    /** Ejecuta la acción real (sonar/avisar/marcar). Inyectada por la app. */
    onFire: (action: AgendaFireAction, item: AgendaItem) => void | Promise<void>;
    /** Tope de espera entre ticks (ms). */
    tickMs?: number;
}

export function useAgenda({ service, personId, onFire, tickMs = 15000 }: UseAgendaOptions) {
    const [items, setItems] = useState<AgendaItem[]>([]);
    const onFireRef = useRef(onFire);
    onFireRef.current = onFire;

    useEffect(() => {
        let cancelled = false;
        let timer: ReturnType<typeof setTimeout> | null = null;

        const tick = async () => {
            const all = await service.list({ personId, status: 'pending' });
            if (cancelled) return;
            setItems(all);

            const { fires, nextTick } = runAgendaCycle(all, Date.now());
            for (const fire of fires) {
                await onFireRef.current(fire.action, fire.item);
                if (!fire.recurring) {
                    await service.complete(fire.item.id);
                }
            }
            if (!cancelled) {
                const delay = nextTick
                    ? Math.max(1000, Math.min(nextTick - Date.now(), tickMs))
                    : tickMs;
                timer = setTimeout(tick, delay);
            }
        };
        void tick();

        return () => {
            cancelled = true;
            if (timer) clearTimeout(timer);
        };
    }, [service, personId, tickMs]);

    return { items };
}
