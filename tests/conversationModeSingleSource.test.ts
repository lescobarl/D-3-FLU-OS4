// ============================================================
// conversationModeSingleSource — el modo conversación es la ÚNICA
// fuente del ruteo Y de lo visible. Bug real: la UI quedaba en
// LISTENING con `conversationActiveRef=false`; el usuario hablaba
// creyendo que se transcribía y el turno se descartaba en silencio.
// ============================================================
import { describe, it, expect, vi } from 'vitest';
import { createConversationModeController } from '../src/voice/lib/conversationMode';

function makeController(withUi = true) {
    const conversationActiveRef = { current: false };
    const startListening = vi.fn(async () => undefined);
    const states: string[] = [];
    const controller = createConversationModeController({
        conversationActiveRef,
        startListening,
        ...(withUi ? { setConversationState: (state: 'LISTENING' | 'IDLE') => states.push(state) } : {}),
    });
    return { controller, conversationActiveRef, startListening, states };
}

describe('conversationMode — modo y estado visible, una sola fuente', () => {
    it('open() enciende el ruteo Y refleja LISTENING antes de arrancar', async () => {
        const { controller, conversationActiveRef, startListening, states } = makeController();
        await controller.open({ resume: true });
        expect(conversationActiveRef.current).toBe(true);
        expect(states).toEqual(['LISTENING']);
        expect(startListening).toHaveBeenCalledWith({ resume: true });
    });

    it('enter() enciende el ruteo y refleja LISTENING', () => {
        const { controller, conversationActiveRef, states } = makeController();
        controller.enter();
        expect(conversationActiveRef.current).toBe(true);
        expect(states).toEqual(['LISTENING']);
    });

    it('exit() apaga el ruteo Y refleja IDLE (fin del LISTENING fantasma)', () => {
        const { controller, conversationActiveRef, states } = makeController();
        controller.enter();
        controller.exit();
        expect(conversationActiveRef.current).toBe(false);
        expect(states).toEqual(['LISTENING', 'IDLE']);
    });

    it('sin UI disponible no lanza (modo y ruteo siguen válidos)', async () => {
        const { controller, conversationActiveRef } = makeController(false);
        controller.enter();
        expect(conversationActiveRef.current).toBe(true);
        controller.exit();
        expect(conversationActiveRef.current).toBe(false);
    });
});
