// ============================================================
// fluWindow — Puente runtime expuesto en window por App.tsx
// ============================================================
// Los manejadores __fluHandle* y el callback __fluOnContractResolved se
// exponen en window para que el motor de voz y las pruebas E2E puedan
// invocarlos. Se declaran con SINTAXIS DE MÉTODO (bivariante) para que la
// asignación de callbacks con parámetros `any`/`unknown` no falle por
// contravarianza de strictFunctionTypes.
// ============================================================

export {};

/** Reconocedor de voz webkit/SpeechRecognition (no está en lib.dom). */
export interface SpeechRecognitionLike {
    lang: string;
    continuous: boolean;
    interimResults: boolean;
    onresult: ((event: SpeechRecognitionEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    start(): void;
    stop(): void;
}

declare global {
    interface Window {
        /** Variantes webkit de APIs de audio/reconocimiento (Safari/Chrome). */
        webkitAudioContext?: typeof AudioContext;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
        SpeechRecognition?: new () => SpeechRecognitionLike;
        /** Callback REAL de resolución de contrato (hook E2E). */
        __fluOnContractResolved?(resolved: unknown): Promise<unknown>;

        /** Manejadores deterministas por dominio (E2E + integración). */
        __fluHandleReminderText?(
            input: unknown,
            opts?: { personId?: string; personName?: string },
        ): Promise<string>;
        __fluHandleTemporalText?(input: unknown): Promise<string>;
        __fluHandleConocerFluText?(text: string): Promise<string>;
        __fluHandleDeviceActionText?(text: string): Promise<string>;
        __fluHandleNoteText?(
            input: unknown,
            opts?: { personId?: string; personName?: string },
        ): Promise<string>;
        __fluHandleDiaryText?(
            input: unknown,
            opts?: { personId?: string; personName?: string },
        ): Promise<string>;
        __fluHandleHorarioText?(input: unknown): Promise<string>;

        /** Stores y flags expuestos en window (debug/E2E). */
        __fluStore?: unknown;
        __fluEnvironmentStore?: unknown;
        __bunnyStore?: unknown;
        __bunnyPreloadDone?: boolean;
        __fluClientLog?: unknown;
        __FLU_CONSOLE_ERRORS?: string[];
    }

    interface ImportMetaEnv {
        /** Modelo de audio de OpenRouter usado por el laboratorio ASR (dev). */
        readonly VITE_OPENROUTER_AUDIO_MODEL?: string;
    }
}
