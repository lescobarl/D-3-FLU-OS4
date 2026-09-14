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

declare global {
    interface Window {
        /** Callback REAL de resolución de contrato (hook E2E). */
        __fluOnContractResolved?(resolved: any): Promise<void>;

        /** Manejadores deterministas por dominio (E2E + integración). */
        __fluHandleReminderText?(
            input: any,
            opts?: { personId?: string; personName?: string },
        ): Promise<string>;
        __fluHandleTemporalText?(input: any): Promise<string>;
        __fluHandleConocerFluText?(text: string): Promise<string>;
        __fluHandleDeviceActionText?(text: string): Promise<string>;
        __fluHandleNoteText?(
            input: any,
            opts?: { personId?: string; personName?: string },
        ): Promise<string>;
        __fluHandleDiaryText?(
            input: any,
            opts?: { personId?: string; personName?: string },
        ): Promise<string>;
        __fluHandleHorarioText?(input: any): Promise<string>;
    }
}
