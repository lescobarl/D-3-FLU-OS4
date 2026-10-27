// ============================================================
// voiceLiveSingleWriter.test.ts — GUARD §9 (un solo escritor)
// ------------------------------------------------------------
// Invariante: la frase viva (liveTranscript) tiene UN escritor: el MÓDULO de
// conversación. El hook le pasa `onLiveTranscript: setLiveTranscript` al crearlo,
// y `onresult` le ENTREGA el evento crudo
// (`motorConversacionRef.current.evento(event)`) y RETORNA: no publica por su
// cuenta.
//
// REANCLA (corte 2026-10-26): `flushLiveTranscript` se RETIRÓ con la caja pasiva
// (`crearCajaDeLaFrase`) que el punto 1 del corte mandó quitar ("solo escribe el
// módulo"). No tenía llamador y reintroducirlo sería código muerto o un segundo
// escritor. El guard ahora exige, sobre TODO el archivo: (a) 0 ocurrencias de
// `flushLiveTranscript`, y (b) 0 llamadas a cualquier escritor de la frase viva
// fuera de la delegación al módulo. La delegación NO es una llamada del hook:
// es entregar el setter al dueño.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (): string =>
    readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');

const MODULE_ANCHOR = 'onLiveTranscript: setLiveTranscript';
const MODULE_DISPATCH = 'motorConversacionRef.current.evento(event)';
const ACTIVE_GUARD = 'if (conversationActiveRef?.current) {';
const ONRESULT_START = 'Recognition.onresult = (event) => {';
const ONRESULT_END = 'Recognition.onerror = (event) => {';

/** Llamadas que ESCRIBEN la frase viva por fuera de la API del dueño. */
const LIVE_WRITERS = [
    'setLiveTranscript(',
    'scheduleLiveTranscriptUpdate(',
    'publicarEnLaCaja(',
    'publishLiveFromTurn(',
];

/** Líneas (1-based) del fuente que contienen alguna escritura viva. */
export function liveWriterSites(src: string): number[] {
    const lines: number[] = [];
    src.split('\n').forEach((line, index) => {
        if (LIVE_WRITERS.some((call) => line.includes(call))) lines.push(index + 1);
    });
    return lines;
}

/** ¿Volvió el flusher retirado con la caja pasiva? */
export function tieneFlusherRetirado(src: string): boolean {
    return src.includes('flushLiveTranscript');
}

/** Líneas (1-based) del tramo que contienen alguna escritura viva. */
function liveWriterLines(tramo: string, base: number): number[] {
    const lines: number[] = [];
    tramo.split('\n').forEach((line, index) => {
        if (LIVE_WRITERS.some((call) => line.includes(call))) lines.push(base + index);
    });
    return lines;
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

    it('el hook NO escribe la frase viva: sin flushLiveTranscript y sin escrituras fuera de la delegación', () => {
        const src = source();
        expect(tieneFlusherRetirado(src), 'flushLiveTranscript se retiró con la caja pasiva').toBe(false);
        expect(
            liveWriterSites(src),
            'el hook no llama a ningún escritor de la frase viva en TODO el archivo',
        ).toEqual([]);
    });

    it('onresult NO publica el preview: delega en el motor y RETORNA', () => {
        const src = source();
        expect(activeBranchReturnsAfterDispatch(src), 'la rama activa no termina tras delegar').toBe(true);
        expect(activeBranchPublishSites(src)).toEqual([]);
    });
});

// P2.4 — prueba de detector: alimentado el infractor sintetico, la marca.
describe('§9 — el detector no es decorativo', () => {
    const onresultSrc = (body: string) =>
        `${ONRESULT_START}\n  if (conversationActiveRef?.current) {\n    ${body}\n    return;\n  }\n${ONRESULT_END}\n`;

    it('marca el segundo escritor de la frase viva y no la delegación del dueño', () => {
        expect(liveWriterSites('setLiveTranscript(frase);')).toEqual([1]);
        expect(liveWriterSites('cajaVivaRef.current.publicarEnLaCaja(frase);')).toEqual([1]);
        expect(liveWriterSites('publishLiveFromTurn();')).toEqual([1]);
        expect(liveWriterSites('scheduleLiveTranscriptUpdate(frase);')).toEqual([1]);
        // La delegación al módulo NO es una llamada del hook; el dispatch tampoco.
        expect(liveWriterSites('onLiveTranscript: setLiveTranscript,')).toEqual([]);
        expect(liveWriterSites('motorConversacionRef.current.evento(event)')).toEqual([]);
    });

    it('marca el flusher retirado si vuelve y perdona al hook limpio', () => {
        expect(tieneFlusherRetirado('const flushLiveTranscript = useCallback(')).toBe(true);
        expect(tieneFlusherRetirado('onLiveTranscript: setLiveTranscript,')).toBe(false);
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
