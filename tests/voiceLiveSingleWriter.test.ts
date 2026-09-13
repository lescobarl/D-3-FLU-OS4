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

describe('§9 — UN solo escritor de la frase viva', () => {
    it('flushLiveTranscript NO escribe liveTranscript en conversación activa', () => {
        const src = source();
        const start = src.indexOf('const flushLiveTranscript = useCallback(');
        expect(start).toBeGreaterThanOrEqual(0);
        const body = src.slice(start, start + 900);
        const activeIdx = body.indexOf('conversationActiveRef?.current');
        expect(activeIdx).toBeGreaterThanOrEqual(0);
        const returnIdx = body.indexOf('return', activeIdx);
        expect(returnIdx).toBeGreaterThan(activeIdx);
        expect(body.slice(activeIdx, returnIdx)).not.toContain('setLiveTranscript');
    });

    it('onresult publica por syncConversationStream, no por publishLiveFromTurn', () => {
        const src = source();
        const start = src.indexOf('pushMicRecognitionEvent(event)');
        expect(start).toBeGreaterThanOrEqual(0);
        const ret = src.indexOf('return', start);
        expect(ret).toBeGreaterThan(start);
        const body = src.slice(start, ret);
        expect(body).toContain('syncConversationStream(');
        expect(body).not.toContain('publishLiveFromTurn()');
    });
});
