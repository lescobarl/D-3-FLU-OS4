// ============================================================
// #5 — EL PISO SE DESPACHA EN LA CONVERSACION (guard de CONDUCTA)
// ------------------------------------------------------------
// Medido (log del dueno, 2026-10-05 16:50:40): "Okay Flow adelante" llego al
// modelo ("cae a IA/flu") en vez de resolverse como concesion de palabra.
// Este guard fija la conducta MINIMA esperada del planificador: con wake, la
// concesion (grantFloor) y el rechazo (dismissFloor) son COMANDOS, no consultas.
// Si esto pasa y aun asi el turno llega a la IA, el fallo esta MAS ABAJO (el
// despacho/el manejador), no en la resolucion.
// ============================================================
import { describe, it, expect } from 'vitest';
import { planConversationDispatch } from '../src/voice/lib/audioMath.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const VC = FLU_CONFIG.voiceCommands;

/** Marca de infraccion: una concesion/rechazo de piso no se resuelve como comando. */
export function floorDispatchOffenders(
    plan: { plan: string; action?: { kind?: string; command?: string } | null },
    esperado: string,
): string[] {
    if (plan.plan !== 'dispatch') return [`el piso no se despacha (plan=${plan.plan})`];
    if (plan.action?.kind !== 'command') return [`el piso no es comando (kind=${plan.action?.kind})`];
    if (plan.action?.command !== esperado) return [`comando inesperado: ${plan.action?.command}`];
    return [];
}

describe('#5 — el piso (conceder/rechazar palabra) se resuelve como comando', () => {
    it('"okay flow <grantFloor[0]>" despacha el comando de concesion', () => {
        const grant = String(VC.grantFloor?.[0] || 'adelante');
        const plan = planConversationDispatch(`okay flow ${grant}`, VC, { wakeRequired: false });
        expect(floorDispatchOffenders(plan, 'FLU_ADELANTE'), JSON.stringify(plan)).toEqual([]);
    });

    it('"okay flow <dismissFloor[0]>" despacha el comando de rechazo', () => {
        const dismiss = String(VC.dismissFloor?.[0] || 'no ahora');
        const plan = planConversationDispatch(`okay flow ${dismiss}`, VC, { wakeRequired: false });
        expect(floorDispatchOffenders(plan, 'FLU_ESPERA'), JSON.stringify(plan)).toEqual([]);
    });

    it('una afirmacion suelta tras la wake tambien concede el piso', () => {
        const plan = planConversationDispatch('okay flow si', VC, { wakeRequired: false });
        expect(floorDispatchOffenders(plan, 'FLU_ADELANTE'), JSON.stringify(plan)).toEqual([]);
    });
});

// Prueba de detector (P2.4): el MISMO criterio marca la consulta y no marca el comando.
describe('#5 — el detector no es decorativo', () => {
    it('marca el piso que cae a consulta y no marca el comando correcto', () => {
        expect(
            floorDispatchOffenders({ plan: 'skip', action: { kind: 'log' } }, 'FLU_ADELANTE'),
        ).toHaveLength(1);
        expect(
            floorDispatchOffenders({ plan: 'dispatch', action: { kind: 'flu' } }, 'FLU_ADELANTE'),
        ).toHaveLength(1);
        expect(
            floorDispatchOffenders({ plan: 'dispatch', action: { kind: 'command', command: 'FLU_ADELANTE' } }, 'FLU_ADELANTE'),
        ).toEqual([]);
    });
});
