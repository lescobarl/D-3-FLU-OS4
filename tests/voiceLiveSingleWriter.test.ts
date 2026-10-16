// ============================================================
// voiceLiveSingleWriter.test.ts — GUARD §9 (un solo escritor)
// ------------------------------------------------------------
// Invariante: en conversación activa la frase viva (liveTranscript) la escribe
// ÚNICAMENTE el INGRESS (vía syncConversationStream desde transcriptIngress).
// `flushLiveTranscript` NO escribe en activo; `onresult` DELEGA en el ingress
// (pushMicRecognitionEvent) y NO publica el preview por su cuenta (ni con
// syncConversationStream ni con publishLiveFromTurn). Si vuelve el doble
// escritor por onresult, este guard FALLA.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (): string =>
    readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');

const FLUSH_ANCHOR = 'const flushLiveTranscript = useCallback(';
const ONRESULT_ANCHOR = 'pushMicRecognitionEvent(event)';

/** Predicados del guard, expuestos para poder FALSIFICARLOS con fuentes sinteticas. */
export function flushWritesLiveTranscript(src: string): boolean {
    const start = src.indexOf(FLUSH_ANCHOR);
    if (start < 0) return false;
    const body = src.slice(start, start + 900);
    const activeIdx = body.indexOf('conversationActiveRef?.current');
    if (activeIdx < 0) return false;
    const returnIdx = body.indexOf('return', activeIdx);
    if (returnIdx < activeIdx) return false;
    return body.slice(activeIdx, returnIdx).includes('setLiveTranscript');
}

/**
 * Lineas (1-based) dentro del bloque `onresult` que publican la frase viva por
 * su cuenta. HOY la invariante exige CERO: el unico escritor es el ingress.
 */
export function onresultLivePublishSites(src: string): number[] {
    const start = src.indexOf(ONRESULT_ANCHOR);
    if (start < 0) return [];
    const ret = src.indexOf('return', start);
    if (ret < start) return [];
    const body = src.slice(start, ret);
    const baseLine = src.slice(0, start).split('\n').length;
    const sites: number[] = [];
    body.split('\n').forEach((line, index) => {
        if (line.includes('syncConversationStream(')) sites.push(baseLine + index);
    });
    return sites;
}

/** El handler DELEGA en el ingress y NO publica el preview por su cuenta. */
export function onresultUsesSingleWriter(src: string): boolean {
    const start = src.indexOf(ONRESULT_ANCHOR);
    if (start < 0) return false;
    const ret = src.indexOf('return', start);
    if (ret < start) return false;
    const body = src.slice(start, ret);
    return !body.includes('syncConversationStream(') && !body.includes('publishLiveFromTurn()');
}

describe('§9 — UN solo escritor de la frase viva', () => {
    it('flushLiveTranscript NO escribe liveTranscript en conversación activa', () => {
        const src = source();
        expect(src).toContain(FLUSH_ANCHOR);
        expect(flushWritesLiveTranscript(src)).toBe(false);
    });

    it('onresult NO publica el preview: delega en el ingress (unico escritor)', () => {
        const src = source();
        expect(src).toContain(ONRESULT_ANCHOR);
        expect(onresultUsesSingleWriter(src)).toBe(true);
    });

    it('no hay NINGUN site de publicacion viva dentro del bloque onresult', () => {
        const src = source();
        const sites = onresultLivePublishSites(src);
        expect(
            sites,
            `duplicados (archivo:simbolo:linea): ${sites
                .map((line) => `useFluVoiceAssistant.js:syncConversationStream:${line}`)
                .join(', ')}`,
        ).toEqual([]);
    });
});

// P2.4 — prueba de detector: alimentado el infractor sintetico, la marca.
describe('§9 — el detector no es decorativo', () => {
    const flushSrc = (body: string) =>
        `${FLUSH_ANCHOR}\n  if (conversationActiveRef?.current) {\n    ${body}\n    return;\n  }\n`;
    const onresultSrc = (body: string) => `${ONRESULT_ANCHOR}\n  ${body}\n  return;\n`;

    it('marca el segundo escritor de la frase viva y no el que delega', () => {
        expect(flushWritesLiveTranscript(flushSrc('setLiveTranscript(phrase);'))).toBe(true);
        expect(flushWritesLiveTranscript(flushSrc('scheduleLiveTranscriptUpdate(phrase);'))).toBe(false);
        // El handler que SOLO delega en el ingress es el correcto (sin publicar).
        expect(onresultUsesSingleWriter(onresultSrc('ingressRuntimeRef.current.pushMicRecognitionEvent(event);'))).toBe(true);
        // El handler que ADEMAS publica el preview (doble escritor) -> FALLA.
        expect(onresultUsesSingleWriter(onresultSrc('pushMicRecognitionEvent(event); syncConversationStream({ capture });'))).toBe(false);
        // El escritor viejo (publishLiveFromTurn) -> FALLA.
        expect(onresultUsesSingleWriter(onresultSrc('pushMicRecognitionEvent(event); publishLiveFromTurn();'))).toBe(false);
    });

    it('onresultLivePublishSites enumera las lineas duplicadas y no las del delegado', () => {
        expect(onresultLivePublishSites(onresultSrc('syncConversationStream({ capture });'))).toHaveLength(1);
        expect(onresultLivePublishSites(onresultSrc('pushMicRecognitionEvent(event);'))).toEqual([]);
    });
});
