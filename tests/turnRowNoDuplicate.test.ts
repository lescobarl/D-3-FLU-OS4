// ============================================================
// UNA LOCUCION = UNA FILA, por IDENTIDAD de turno
// ------------------------------------------------------------
// Defecto 1 (medido 13:58-13:59 y 2026-09-29 17:16): el turno tiene DOS commits
// de la MISMA frase canonica (temprano + resolucion). El escritor delimitaba "el
// turno" como TODO lo posterior a la ultima fila de FLU; si el motor hablaba en
// medio, la segunda abria fila nueva (DUPLICADA); y si el motor NO hablaba, dos
// ordenes REALES se fusionaban en una (se "borraba" una orden del usuario).
//
// ARREGLO: la fila se reutiliza por IDENTIDAD del turno (`turnId`), no por
// posicion. El commit temprano y la resolucion del mismo turno comparten id =>
// una fila. Dos turnos distintos => dos filas, aunque FLU no haya hablado.
// Sin `turnId` (compatibilidad) se conserva el criterio posicional.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow, escribeFilaDeUsuario, updateTurnRowSpeaker } from '../src/voice/lib/conversationTurnRow';
import { resetVoiceDirectory } from '../src/voice/lib/speakerDirectory.js';

/** Marcas `effectOnly: true` en un fuente (mismo criterio del guard). */
export function effectOnlyMarks(src: string): number {
    return (src.match(/\beffectOnly: true,/g) || []).length;
}

const userRows = () =>
    useIntegrationStore.getState().conversationHistory.filter((r) => r.role === 'user');

const fliHabla = (texto: string) =>
    useIntegrationStore.getState().addConversationEntry({
        id: `flu-${texto}`,
        role: 'flu',
        text: texto,
        timestamp: Date.now(),
    });

const ORDEN = 'Okay Flow siguiente carta';

describe('la fila del turno se reutiliza por IDENTIDAD de turno', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
        resetVoiceDirectory();
    });

    it('commit temprano + FLU + resolucion del MISMO turno = UNA fila', () => {
        commitUserTurnRow({ text: ORDEN, turnId: 101 });
        expect(userRows()).toHaveLength(1);

        fliHabla('Siguiente carta: Subeme paso a pasito.');

        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 101 });

        const rows = userRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe(ORDEN);
        // La etiqueta visible se resuelve al MOSTRAR y por la VOZ (mandato 2026-10-13).
        expect(resolveRowSpeakerLabel(rows[0])).toBe('Hablante 1');
    });

    it('las DOS resoluciones del turno (fast-path + IA) siguen siendo una fila', () => {
        commitUserTurnRow({ text: ORDEN, turnId: 102 });
        fliHabla('Siguiente carta: Subeme paso a pasito.');
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 102 });

        expect(userRows()).toHaveLength(1);
        expect(resolveRowSpeakerLabel(userRows()[0])).toBe('Hablante 1');
    });

    it('DEFECTO 3: dos ordenes REALES (turnos distintos) son DOS filas aunque FLU no hable', () => {
        // El usuario repite la orden porque la primera no obtuvo respuesta: FLU NO
        // hablo entre las dos. Antes el dedup posicional fusionaba las dos y la
        // segunda desaparecia de la conversacion.
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 103 });
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 104 });

        expect(userRows()).toHaveLength(2);
    });

    it('CONTROL: dos turnos distintos con FLU en medio tambien son DOS filas', () => {
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 105 });
        fliHabla('Primera respuesta.');
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 106 });

        expect(userRows()).toHaveLength(2);
    });

    it('los DOS commits del turno comparten identidad: commit temprano + resolucion = una fila', () => {
        commitUserTurnRow({ text: ORDEN, turnId: 108 });
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 108 });

        expect(userRows()).toHaveLength(1);
    });

    it('GUARD: App pasa la identidad de turno al escritor (una sola ruta de fila)', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        expect(app).toMatch(/turnId: resolved\?\.turnId \?\? null/);
    });

    it('GUARD: el hook publica la identidad del turno en TODOS los puntos de escritura', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const hook = fs.readFileSync(
            path.join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'),
            'utf8',
        );
        // Commit temprano + resolucion + LOG CRUDO (el path raw tambien escribe
        // fila: sin identidad caia al criterio posicional, ya retirado). La RESOLUCION puede
        // derivar el turno de la FRASE emitida (idempotencia: una locucion = una fila), que es
        // tan identidad de turno como el vivo.
        const marcas = [
            ...(hook.match(/turnId: activeTurnIdRef\.current/g) || []),
            ...(hook.match(/turnId: turnIdDeLaFrase/g) || []),
        ];
        expect(marcas).toHaveLength(3);
    });

    // ------------------------------------------------------------
    // SEPARACION DE RESPONSABILIDADES: un SERVICIO (juego/ambiente/config)
    // aplica su efecto y NO escribe la conversacion. El unico dueno de la fila
    // es la transcripcion (commitAndResolveTurn).
    // ------------------------------------------------------------
    it('GUARD: los tres fast-path de SERVICIO se declaran `effectOnly`', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const hook = fs.readFileSync(
            path.join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'),
            'utf8',
        );
        const marcas = hook.match(/\beffectOnly: true,/g) || [];
        expect(marcas).toHaveLength(3);
    });

    it('GUARD: App decide la escritura de fila con la puerta pura compartida', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        expect(app).toMatch(/escribeFilaDeUsuario\(resolved,/);
    });

    // La puerta pura, caso por caso (es la regla que App aplica).
    const PUERTA: Array<
        [string, { effectOnly?: boolean; userCommitOnly?: boolean; rawOnly?: boolean }, boolean, boolean, boolean]
    > = [
        ['efecto de servicio', { effectOnly: true }, true, true, false],
        ['efecto gana al commit temprano', { effectOnly: true, userCommitOnly: true }, true, true, false],
        ['commit temprano: NO escribe la conversacion (entra al cerrar)', { userCommitOnly: true }, false, false, false],
        ['resolucion con texto', {}, true, true, true],
        ['emision cruda vacia tras limpiar', { rawOnly: true }, false, false, false],
        ['emision cruda hablable', { rawOnly: true }, true, true, true],
        ['sin texto y sin commit', {}, false, false, false],
    ];
    it.each(PUERTA)('puerta de fila: %s', (_caso, payload, hayTexto, hablable, esperado) => {
        expect(escribeFilaDeUsuario(payload, { hayTexto, hablable })).toBe(esperado);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('fila del turno - el detector no es decorativo', () => {
    it('la puerta distingue el efecto de servicio de la orden real', () => {
        expect(escribeFilaDeUsuario({ effectOnly: true }, { hayTexto: true, hablable: true })).toBe(false);
        expect(escribeFilaDeUsuario({}, { hayTexto: true, hablable: true })).toBe(true);
    });
    it('cuenta las marcas effectOnly del hook', () => {
        expect(effectOnlyMarks('effectOnly: true,\neffectOnly: true,')).toBe(2);
        expect(effectOnlyMarks('const a = 1')).toBe(0);
    });
});
// P8.39 - la reentrega identica no vuelve a colarse: el criterio vive en un modulo
// (captureDedup) con la ventana del despacho, y el hook no puede volver al bypass
// inline que se saltaba el dedup ENTERO mientras habia un turno en curso.
export function dedupPorCapturaInline(src: string): boolean {
    return /const correctionInFlight = isNavSettlePending\(\) \|\| isProcessingRef\.current/.test(src);
}

describe('fila del turno - la reentrega identica no vuelve a colarse (P8.39)', () => {
    it('el hook pregunta al criterio unico y no tiene el bypass inline', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const hook = fs.readFileSync(
            path.join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'),
            'utf8',
        );
        expect(hook).toContain('shouldSkipCapture(');
        expect(hook).toContain('createEmissionDeduper(');
        expect(dedupPorCapturaInline(hook)).toBe(false);
    });

    it('la ventana de "misma peticion" es UN solo valor (despacho y fila)', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const audio = fs.readFileSync(path.join(process.cwd(), 'src', 'voice', 'lib', 'audioMath.js'), 'utf8');
        const dedup = fs.readFileSync(path.join(process.cwd(), 'src', 'voice', 'lib', 'captureDedup.js'), 'utf8');
        expect(audio).toContain('sameRequestWindowMs()');
        expect(dedup).toContain('sameRequestWindowMs');
        expect(audio).not.toContain('dedupMs = 4500');
    });
});

// P2.4 - prueba de detector del criterio nuevo.
describe('reentrega identica - el detector no es decorativo', () => {
    it('marca el bypass inline viejo y no la version con modulo', () => {
        expect(
            dedupPorCapturaInline('const correctionInFlight = isNavSettlePending() || isProcessingRef.current'),
        ).toBe(true);
        expect(dedupPorCapturaInline('const skipReason = shouldSkipCapture({ prevText })')).toBe(false);
    });
});

// MEDIDO en la app (debug.log del dueno, 2026-10-06): el embedding del
// hablante resuelve DESPUES del commit (7-19 s de cola), asi que la etiqueta caia en
// el turno SIGUIENTE ("Hablante 1" en el habla de Luis). La fila ya se reutiliza por
// IDENTIDAD de turno: la resolucion tardia COMPLETA la suya, no la del vecino.
// Mandato del dueno (2026-10-13): el nombre NO vive en la conversacion (la fila es texto
// insertado y NO se reescribe). El hablante que llega tarde REGISTRA el nombre para la VOZ
// de SU turno (`updateTurnRowSpeaker`), y sus filas se ven con el nombre al MOSTRAR; la voz
// de otro hablante queda intacta. (Antes esta via MUTABA la fila del turno resuelto.)
describe('el hablante que llega tarde nombra su VOZ (mandato 2026-10-13), no la de otro hablante', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
        resetVoiceDirectory();
    });

    it('nombra la VOZ del turno resuelto aunque el turno actual sea otra voz', () => {
        commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 1', turnId: 201 });
        fliHabla('Entendido.');
        commitUserTurnRow({ text: 'otra locucion distinta', speakerName: 'Hablante 2', turnId: 202 });

        expect(updateTurnRowSpeaker(201, 'Luis', { evidenciaAcustica: true })).toBe(true);

        const rows = userRows();
        expect(rows).toHaveLength(2);
        // La fila NO se reescribe: guarda la VOZ; el nombre se resuelve al MOSTRAR.
        expect(resolveRowSpeakerLabel(rows[0]), 'la resolucion tardia nombra SU voz').toBe('Luis');
        expect(resolveRowSpeakerLabel(rows[1]), 'y NO nombra la de otro hablante').toBe('Hablante 2');
    });

    it('no hace nada si el turno no tiene fila registrada o el hablante esta vacio', () => {
        expect(updateTurnRowSpeaker(999, 'Luis')).toBe(false);
        expect(updateTurnRowSpeaker(201, '')).toBe(false);
    });
});
