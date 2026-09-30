// ============================================================
// voiceLiveSingleWriter.test.ts — GUARD §9 (un solo escritor)
// ------------------------------------------------------------
// Invariante: en conversación activa la frase viva (liveTranscript) la escribe
// ÚNICAMENTE `handleConversationStreamSync` (vía syncConversationStream).
// `flushLiveTranscript` NO escribe en activo, y `onresult` no llama
// `publishLiveFromTurn()`. Si vuelve el segundo escritor, este guard FALLA.
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

export function onresultUsesSingleWriter(src: string): boolean {
    const start = src.indexOf(ONRESULT_ANCHOR);
    if (start < 0) return false;
    const ret = src.indexOf('return', start);
    if (ret < start) return false;
    const body = src.slice(start, ret);
    return body.includes('syncConversationStream(') && !body.includes('publishLiveFromTurn()');
}

describe('§9 — UN solo escritor de la frase viva', () => {
    it('flushLiveTranscript NO escribe liveTranscript en conversación activa', () => {
        const src = source();
        expect(src).toContain(FLUSH_ANCHOR);
        expect(flushWritesLiveTranscript(src)).toBe(false);
    });

    it('onresult publica por syncConversationStream, no por publishLiveFromTurn', () => {
        const src = source();
        expect(src).toContain(ONRESULT_ANCHOR);
        expect(onresultUsesSingleWriter(src)).toBe(true);
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
        expect(onresultUsesSingleWriter(onresultSrc('syncConversationStream({ capture });'))).toBe(true);
        expect(onresultUsesSingleWriter(onresultSrc('publishLiveFromTurn(); syncConversationStream({});'))).toBe(false);
    });
});
