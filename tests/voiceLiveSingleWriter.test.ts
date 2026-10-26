// ============================================================
// voiceLiveSingleWriter.test.ts — GUARD §9 (un solo escritor)
// ------------------------------------------------------------
// Invariante: la frase viva (liveTranscript) tiene UN escritor por modo.
//   CONVERSACIÓN ACTIVA — solo el motor de conversación: el hook le pasa
//   `onLiveTranscript: setLiveTranscript` al crearlo, y `onresult` le ENTREGA el
//   evento crudo (`motorConversacionRef.current.evento(event)`) y RETORNA: no
//   publica por su cuenta.
//   MODO PASIVO — solo la caja (`crearCajaDeLaFrase`), y todos sus caminos pasan
//   por `flushLiveTranscript`, que se retira en activo.
// El escritor viejo (ingress/`pushMicRecognitionEvent`) se retiró con la tubería
// vieja de conversación (corte 2026-10-25); este guard se reancla al motor del
// producto. Si vuelve un segundo escritor por `onresult`, FALLA.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (): string =>
    readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');

const FLUSH_ANCHOR = 'const flushLiveTranscript = useCallback(';
const ACTIVE_GUARD = 'if (conversationActiveRef?.current) {';
const MODULE_ANCHOR = 'onLiveTranscript: setLiveTranscript';
const MODULE_DISPATCH = 'motorConversacionRef.current.evento(event)';
const ONRESULT_START = 'Recognition.onresult = (event) => {';
const ONRESULT_END = 'Recognition.onerror = (event) => {';

/** Llamadas que ESCRIBEN la frase viva por fuera de la API del dueño. */
const LIVE_WRITERS = [
    'setLiveTranscript(',
    'scheduleLiveTranscriptUpdate(',
    'publicarEnLaCaja(',
    'publishLiveFromTurn(',
];

/** Líneas (1-based) del tramo que contienen alguna escritura viva. */
function liveWriterLines(tramo: string, base: number): number[] {
    const lines: number[] = [];
    tramo.split('\n').forEach((line, index) => {
        if (LIVE_WRITERS.some((call) => line.includes(call))) lines.push(base + index);
    });
    return lines;
}

/**
 * ¿`flushLiveTranscript` escribe la frase viva ANTES de retirarse en conversación
 * activa? HOY la invariante exige CERO: el módulo es el único escritor.
 */
export function flushWritesLiveWhenActive(src: string): number[] {
    const start = src.indexOf(FLUSH_ANCHOR);
    if (start < 0) return [0];
    const guard = src.indexOf(ACTIVE_GUARD, start);
    if (guard < 0) return [0];
    const ret = src.indexOf('return', guard);
    if (ret < guard) return [0];
    return liveWriterLines(src.slice(guard, ret), src.slice(0, guard).split('\n').length);
}

/**
 * Rama de `onresult` que dispatcha al motor (desde la guarda de conversación
 * activa hasta el `return` posterior al dispatch): ¿publica la frase viva?
 */
export function activeBranchPublishSites(src: string): number[] {
    const dispatch = src.indexOf(MODULE_DISPATCH);
    if (dispatch < 0) return [0];
    const onresult = src.indexOf(ONRESULT_START);
    const onresultEnd = src.indexOf(ONRESULT_END, Math.max(0, onresult));
    if (onresult < 0 || onresultEnd < dispatch) return [0];
    const guard = src.lastIndexOf(ACTIVE_GUARD, dispatch);
    if (guard < onresult) return [0];
    const ret = src.indexOf('return', dispatch);
    if (ret < dispatch || ret > onresultEnd) return [0];
    return liveWriterLines(src.slice(guard, ret), src.slice(0, guard).split('\n').length);
}

/** La rama de conversación TERMINA tras entregar el evento al motor. */
export function activeBranchReturnsAfterDispatch(src: string): boolean {
    const dispatch = src.indexOf(MODULE_DISPATCH);
    if (dispatch < 0) return false;
    return /motorConversacionRef\.current\.evento\(event\)\s*;?\s*return/.test(src.slice(dispatch));
}

describe('§9 — UN solo escritor de la frase viva', () => {
    it('el MOTOR es el escritor en conversación activa (onLiveTranscript)', () => {
        const src = source();
        expect(src).toContain(MODULE_ANCHOR);
        expect(src, 'onresult no entrega el evento al motor').toContain(MODULE_DISPATCH);
    });

    it('flushLiveTranscript NO escribe liveTranscript en conversación activa', () => {
        const src = source();
        expect(src).toContain(FLUSH_ANCHOR);
        expect(flushWritesLiveWhenActive(src)).toEqual([]);
    });

    it('onresult NO publica el preview: delega en el motor y RETORNA', () => {
        const src = source();
        expect(activeBranchReturnsAfterDispatch(src), 'la rama activa no termina tras delegar').toBe(true);
        expect(activeBranchPublishSites(src)).toEqual([]);
    });
});

// P2.4 — prueba de detector: alimentado el infractor sintetico, la marca.
describe('§9 — el detector no es decorativo', () => {
    const flushSrc = (body: string) =>
        `${FLUSH_ANCHOR}\n  ${ACTIVE_GUARD}\n    ${body}\n    return;\n  }\n`;
    const onresultSrc = (body: string) =>
        `${ONRESULT_START}\n  if (conversationActiveRef?.current) {\n    ${body}\n    return;\n  }\n${ONRESULT_END}\n`;

    it('marca el segundo escritor de la frase viva y no la escritura del dueño', () => {
        expect(flushWritesLiveWhenActive(flushSrc('setLiveTranscript(frase);'))).toHaveLength(1);
        expect(flushWritesLiveWhenActive(flushSrc('cajaVivaRef.current.publicarEnLaCaja(frase);'))).toHaveLength(1);
        // El módulo publicando por su API NO es un segundo escritor.
        expect(flushWritesLiveWhenActive(flushSrc('motorConversacionRef.current.evento(event);'))).toEqual([]);
        expect(flushWritesLiveWhenActive(flushSrc('publicarEnLaCaja(frase);')).length, 'sin caja la llamada suelta tambien cuenta').toBe(1);
    });

    it('marca la rama de conversación que publica por su cuenta y no la que solo delega', () => {
        expect(activeBranchPublishSites(onresultSrc(MODULE_DISPATCH))).toEqual([]);
        expect(activeBranchPublishSites(onresultSrc(`${MODULE_DISPATCH}\n    setLiveTranscript(frase);`))).toHaveLength(1);
        expect(activeBranchPublishSites(onresultSrc(`${MODULE_DISPATCH}\n    publishLiveFromTurn();`))).toHaveLength(1);
        expect(activeBranchPublishSites(onresultSrc(`${MODULE_DISPATCH}\n    cajaVivaRef.current.publicarEnLaCaja(frase);`))).toHaveLength(1);
    });

    it('marca la rama que NO retorna tras delegar', () => {
        expect(activeBranchReturnsAfterDispatch(onresultSrc(MODULE_DISPATCH))).toBe(true);
        expect(
            activeBranchReturnsAfterDispatch(
                `${ONRESULT_START}\n  if (conversationActiveRef?.current) {\n    ${MODULE_DISPATCH};\n  }\n  publishLiveFromTurn();\n${ONRESULT_END}\n`,
            ),
        ).toBe(false);
    });
});
