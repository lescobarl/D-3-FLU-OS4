import { logCaughtError } from '../../lib/caughtError';

// ============================================================
// conversationMode — dueño ÚNICO del modo conversación de la escucha
// ------------------------------------------------------------
// El motor de voz decide TODO según `conversationActiveRef`:
//   - `requireWake = !conversationActiveRef.current` (modo comando vs conversación)
//   - rama de publicación de la frase viva y temporizadores asociados
// Antes había varias entradas que abrían la escucha y solo algunas ponían el
// flag: el botón sí, el arranque automático tras el onboarding no → quedaba en
// modo comando (tardío y sin transcripción palabra a palabra).
//
// Este módulo es la ÚNICA ruta que enciende/apaga el modo y la única que abre
// la escucha en conversación, para que no existan dos caminos divergentes.
// ============================================================

export interface ConversationModeBindings {
    /** Ref que lee el motor de voz (`conversationActiveRef`). */
    conversationActiveRef: { current: boolean };
    /** Abre la escucha principal del motor (`os2StartListening`). */
    startListening: (options?: { resume?: boolean }) => Promise<void>;
    /**
     * Estado VISIBLE de la conversación (avatar/UI). El modo es la única fuente:
     * al entrar/abrir se refleja 'LISTENING' y al salir 'IDLE'. Sin esto la UI
     * podía quedar mostrando LISTENING con el ruteo apagado: el usuario hablaba
     * creyendo que se transcribía y el turno se descartaba en silencio.
     */
    setConversationState?: (state: 'LISTENING' | 'IDLE') => void;
    /** Traza de transiciones del modo (una sola fuente). Opcional. */
    onTransition?: (info: { event: string; active: boolean }) => void;
}

export interface ConversationModeController {
    /** Entra en modo conversación sin abrir la escucha (reinicios propios). */
    enter: () => void;
    /** Sale del modo conversación (modo comando). */
    exit: () => void;
    /**
     * Abre la escucha EN MODO CONVERSACIÓN. Pone el flag ANTES de arrancar el
     * reconocimiento y propaga el error del arranque (el llamador decide el
     * reintento, p. ej. autoplay bloqueado).
     */
    open: (options?: { resume?: boolean }) => Promise<void>;
}

export function createConversationModeController({
    conversationActiveRef,
    startListening,
    setConversationState,
    onTransition,
}: ConversationModeBindings): ConversationModeController {
    const reflect = (state: 'LISTENING' | 'IDLE') => {
        try {
            setConversationState?.(state);
        } catch {
        logCaughtError('[catch] src/voice/lib/conversationMode.ts');
            // UI no disponible (tests/SSR): el modo y el ruteo siguen válidos.
        }
    };
    const trace = (event: string) => {
        try {
            onTransition?.({ event, active: Boolean(conversationActiveRef.current) });
        } catch {
        logCaughtError('[catch] src/voice/lib/conversationMode.ts');
            // Traza no disponible: no afecta al modo.
        }
    };
    return {
        enter() {
            conversationActiveRef.current = true;
            reflect('LISTENING');
            trace('enter');
        },
        exit() {
            conversationActiveRef.current = false;
            reflect('IDLE');
            trace('exit');
        },
        async open(options: { resume?: boolean } = {}) {
            // El modo se fija SIEMPRE antes de arrancar: si se arranca en modo
            // comando, el motor exige wake word y publica la frase tarde.
            conversationActiveRef.current = true;
            reflect('LISTENING');
            trace('open');
            return startListening(options);
        },
    };
}
