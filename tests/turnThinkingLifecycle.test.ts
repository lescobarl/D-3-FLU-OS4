// ============================================================
// Guard - "FLU está pensando" dura HASTA QUE FLU EMPIEZA A HABLAR
// ------------------------------------------------------------
// Contrato (sentido común): el overlay significa "aún espero respuesta". Debe
// apagarse cuando FLU EMPIEZA a hablar, no cuando termina.
//
// Causa raíz del defecto reportado: el overlay se cerraba en el `finally` del
// turno, que corre DESPUÉS de `await speak`: el mensaje seguía encendido mientras
// FLU hablaba, con la respuesta ya delante del usuario.
//
// Prueba de MUTACIÓN del contrato (el detector no es decorativo): si alguien
// volviera a cerrar el overlay en `end()` en lugar de en `markSpeaking()`, el
// caso "SPEAKING apaga el overlay" falla. Y si lo cerrara con IDLE, el caso
// "IDLE transitorio NO lo apaga" lo caza.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { createTurnWorkIndicator } from '../src/voice/lib/turnWorkIndicator';
import { createTurnLifecycle } from '../src/voice/lib/turnLifecycle';

const isThinking = () => useIntegrationStore.getState().uiState.isThinking;

describe('indicador Pensando: vive hasta que FLU empieza a hablar', () => {
    beforeEach(() => {
        useIntegrationStore.getState().setThinking(false);
        useIntegrationStore.getState().setConversationState('IDLE');
    });

    it('se enciende al empezar el trabajo del turno', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('turno');
        expect(isThinking()).toBe(true);
        expect(turn.isActive()).toBe(true);
        expect(turn.isVisible()).toBe(true);
    });

    it('SPEAKING lo apaga: FLU ya está hablando, no hay nada que esperar', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('turno');
        useIntegrationStore.getState().setConversationState('THINKING');
        expect(isThinking()).toBe(true);
        useIntegrationStore.getState().setConversationState('SPEAKING');
        turn.markSpeaking('flu-habla');
        expect(isThinking()).toBe(false);
    });

    it('sigue apagado mientras FLU habla y al cerrar el turno', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('turno');
        turn.markSpeaking('flu-habla');
        expect(isThinking()).toBe(false);
        // El turno termina DESPUÉS de hablar: no debe reencenderlo ni parpadear.
        turn.end('turno-fin');
        expect(isThinking()).toBe(false);
        expect(turn.isActive()).toBe(false);
    });

    it('turno MUDO (sin voz): lo cierra el fin del turno', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('turno');
        expect(isThinking()).toBe(true);
        turn.end('turno-sin-voz');
        expect(isThinking()).toBe(false);
    });

    it('trabajo solapado no se apaga entre turnos, y el siguiente reenciende', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('a');
        turn.begin('b');
        turn.end('a');
        expect(isThinking()).toBe(true);
        turn.end('b');
        expect(isThinking()).toBe(false);
        // Turno nuevo tras un cierre: el overlay debe volver (nada de estado pegado).
        turn.begin('c');
        expect(isThinking()).toBe(true);
    });

    it('un end de más no deja el contador negativo ni reenciende el overlay', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.end('de-mas');
        expect(turn.isActive()).toBe(false);
        expect(isThinking()).toBe(false);
    });

    it('un IDLE transitorio NO apaga el overlay antes de hablar', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('turno');
        useIntegrationStore.getState().setConversationState('THINKING');
        useIntegrationStore.getState().setConversationState('IDLE');
        expect(isThinking()).toBe(true);
    });

    it('ERROR es aborto: la red de seguridad del store apaga el overlay', () => {
        const turn = createTurnWorkIndicator(() => useIntegrationStore.getState());
        turn.begin('turno');
        useIntegrationStore.getState().setConversationState('ERROR');
        expect(isThinking()).toBe(false);
    });

    it('sin store no revienta (test/standalone)', () => {
        const turn = createTurnWorkIndicator(() => null);
        expect(() => {
            turn.begin('test');
            turn.markSpeaking('test');
            turn.end('test');
            turn.reset('test');
        }).not.toThrow();
    });
});

describe('ciclo de vida del turno: habla y cronómetro', () => {
    beforeEach(() => {
        useIntegrationStore.getState().setThinking(false);
        useIntegrationStore.getState().setConversationState('IDLE');
    });

    it('markSpeaking cierra el overlay y marca el corte "hastaVoz"', () => {
        let t = 1000;
        const logs: string[] = [];
        const turn = createTurnLifecycle({
            getStore: () => useIntegrationStore.getState(),
            log: (m) => logs.push(m),
            now: () => t,
        });
        turn.startTurn('voz');
        t = 1400;
        turn.markSpeaking('flu-habla');
        expect(isThinking()).toBe(false);
        // El número que el usuario percibe: de "procesando" a oír la voz.
        expect(logs.some((l) => l.includes('ESPERA_HABLA total=400ms'))).toBe(true);

        t = 3000;
        turn.endTurn('voz');
        const resumen = logs.find((l) => l.includes('cierre=voz'));
        expect(resumen).toContain('hastaVoz=400ms');
        expect(resumen).toContain('total=2000ms');
    });

    it('resetTurn apaga todo el trabajo vivo (cierre de sesión)', () => {
        const turn = createTurnLifecycle({ getStore: () => useIntegrationStore.getState() });
        turn.startTurn('voz');
        turn.startTurn('captura');
        expect(isThinking()).toBe(true);
        turn.resetTurn('cierre');
        expect(isThinking()).toBe(false);
    });
});

describe('cronómetro del turno', () => {
    it('reparte el tiempo por fases y lo resume en una línea', async () => {
        const { createTurnStopwatch } = await import('../src/voice/lib/turnStopwatch');
        let t = 1000;
        const sw = createTurnStopwatch(() => t);
        sw.restart();
        t = 1300;
        sw.lap('ia');
        t = 1500;
        sw.lap('commit');
        expect(sw.elapsedMs()).toBe(500);
        expect(sw.report()).toBe('turnTiming: ia=300ms commit=200ms');
    });
});
