// ============================================================
// #8 — COHERENCIA FILA <-> DESPACHO (guard de COMPORTAMIENTO)
// ------------------------------------------------------------
// Defecto medido (sesion real del dueno, 2026-10-05): con la wake NO obligatoria
// (piso abierto) el stream SI abria fila para una captura sin wake (P8.49, "la
// voz del usuario nunca se descarta"), pero `resolveFinalConversationAction`
// devolvia `{kind:'log'}` SIEMPRE para una captura sin wake, asi que esa fila
// nunca se despachaba: quedaba como peticion PENDIENTE en el historial y la
// respondia el turno siguiente, tarde y fuera de turno.
//
// Medido: "Platicame de los barcos" (16:54:19) no genero ENTER; el siguiente
// turno con wake ("Okay flu Hola hola", 16:54:37) recibio
// respuesta_voz="Hola. Los barcos son embarcaciones..." -> 19 s tarde.
//
// Invariante: la fila y el despacho coinciden en los DOS modos.
//   - piso ABIERTO (wakeRequired=false): la captura SIN wake ES un turno.
//   - piso CERRADO (wakeRequired=true):  la captura SIN wake NO es un turno.
//   - con wake: es un turno en los dos modos.
// ============================================================
import { describe, it, expect } from 'vitest';
import { planConversationDispatch } from '../src/voice/lib/audioMath.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const VC = FLU_CONFIG.voiceCommands;
const SIN_WAKE = 'platícame de los barcos';
const CON_WAKE = 'okay flow platícame de los barcos';

/** Marca de infraccion: la captura sin wake no es turno cuando el piso esta abierto. */
export function floorIncoherenceOffenders(
    plan: { plan: string; action?: { kind?: string; question?: string } | null },
    { wakeRequired }: { wakeRequired: boolean },
): string[] {
    const offenders: string[] = [];
    if (!wakeRequired && plan.plan !== 'dispatch') {
        offenders.push('piso abierto: la captura sin wake deberia despacharse');
    }
    if (!wakeRequired && plan.action?.kind === 'flu' && !plan.action?.question) {
        offenders.push('piso abierto: el turno sin wake llega sin pregunta');
    }
    if (wakeRequired && plan.plan !== 'skip') {
        offenders.push('piso cerrado: la captura sin wake NO deberia despacharse');
    }
    return offenders;
}

describe('#8 — la fila y el despacho coinciden', () => {
    it('piso ABIERTO: la captura sin wake se despacha como consulta con su texto', () => {
        const plan = planConversationDispatch(SIN_WAKE, VC, { wakeRequired: false });
        expect(floorIncoherenceOffenders(plan, { wakeRequired: false })).toEqual([]);
        expect(plan.plan).toBe('dispatch');
        expect(plan.action?.kind).toBe('flu');
        expect(plan.action?.question).toBe(SIN_WAKE);
    });

    it('piso CERRADO: la captura sin wake no es turno', () => {
        const plan = planConversationDispatch(SIN_WAKE, VC, { wakeRequired: true });
        expect(floorIncoherenceOffenders(plan, { wakeRequired: true })).toEqual([]);
        expect(plan.plan).toBe('skip');
    });

    it('con wake: es turno en los dos modos', () => {
        for (const wakeRequired of [true, false]) {
            const plan = planConversationDispatch(CON_WAKE, VC, { wakeRequired });
            expect(plan.plan, `wakeRequired=${wakeRequired}`).toBe('dispatch');
            expect(plan.action?.question).toBe(SIN_WAKE);
        }
    });
});

// Prueba de detector (P2.4): el MISMO criterio marca la incoherencia y no marca
// la coherente; sin esto el guard seria teatro (verde para siempre).
describe('#8 — el detector no es decorativo', () => {
    it('marca la incoherencia del piso abierto y no marca la coherente', () => {
        expect(
            floorIncoherenceOffenders({ plan: 'skip', action: { kind: 'log' } }, { wakeRequired: false }),
        ).toHaveLength(1);
        expect(
            floorIncoherenceOffenders({ plan: 'dispatch', action: { kind: 'flu', question: 'x' } }, { wakeRequired: false }),
        ).toEqual([]);
        expect(
            floorIncoherenceOffenders({ plan: 'dispatch' }, { wakeRequired: true }),
        ).toHaveLength(1);
    });
});
