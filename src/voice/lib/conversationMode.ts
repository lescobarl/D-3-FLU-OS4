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
}: ConversationModeBindings): ConversationModeController {
    return {
        enter() {
            conversationActiveRef.current = true;
        },
        exit() {
            conversationActiveRef.current = false;
        },
        async open(options: { resume?: boolean } = {}) {
            // El modo se fija SIEMPRE antes de arrancar: si se arranca en modo
            // comando, el motor exige wake word y publica la frase tarde.
            conversationActiveRef.current = true;
            return startListening(options);
        },
    };
}
