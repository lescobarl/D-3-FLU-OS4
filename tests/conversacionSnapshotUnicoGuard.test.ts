// ============================================================
// conversacionSnapshotUnicoGuard — Paso 0a: UNA instantánea por locución
// ------------------------------------------------------------
// El snapshot de turno (turns.ndjson) se registra en `onLocucionCommiteada`
// (useFluVoiceAssistant.js), UNA llamada por locución commiteada, con los
// campos REALES de la fila: text = fila.texto, speaker = fila.etiqueta,
// sessionTurnId = turnId de la fila y locutionId. La revisión del mismo
// turnId NO añade snapshot (dedupe por `sessionTurnRecordedRef`).
// La otra llamada del hook (commitSessionTurn) es del piso de participante
// y NO es locución del módulo: total de llamadas en el archivo = 2.
// ============================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const fuente = (): string =>
    readFileSync(join(process.cwd(), 'src/voice/hooks/useFluVoiceAssistant.js'), 'utf8');

const REGION_START = 'onLocucionCommiteada: (fila) => {';

/** Cuerpo del callback `onLocucionCommiteada` (hasta su `},` de cierre). */
export function regionDelHandler(src: string): string {
    const ini = src.indexOf(REGION_START);
    if (ini < 0) return '';
    const lineas = src.slice(ini).split('\n');
    for (let i = 1; i < lineas.length; i += 1) {
        if (/^\s*},\s*$/.test(lineas[i])) return lineas.slice(0, i + 1).join('\n');
    }
    return '';
}

/** ¿Cuántas llamadas al dueño del snapshot hay en el callback? Debe ser UNA. */
export function llamadasSnapshot(src: string): number {
    const region = regionDelHandler(src);
    return region ? (region.match(/grabarSnapshotDeTurno\(/g) || []).length : -1;
}

/** ¿El snapshot usa los campos REALES de la fila (no inventa)? */
export function tieneCamposDeFila(src: string): boolean {
    const region = regionDelHandler(src);
    const helper = readFileSync(join(process.cwd(), 'src/voice/conversation/turnSnapshot.js'), 'utf8');
    return (
        region.includes('grabarSnapshotDeTurno(fila') &&
        region.includes('turnId') &&
        region.includes('locutionId') &&
        helper.includes('text: fila?.texto') &&
        helper.includes('speaker: fila?.etiqueta') &&
        helper.includes('sessionTurnId: ctx.turnId') &&
        helper.includes('locutionId: ctx.locutionId')
    );
}

/** ¿La revisión de la MISMA locución NO añade snapshot (dedupe por ref)? */
export function evitaRevisiones(src: string): boolean {
    const region = regionDelHandler(src);
    return region.includes('sessionLocutionsRecordedRef.current.has(locutionId)');
}

/** Total de llamadas en TODO el archivo: 2 dueños, ninguno duplicado. */
export function totalLlamadasHook(src: string): number {
    return (
        (src.match(/recordSessionTurn\(/g) || []).length +
        (src.match(/grabarSnapshotDeTurno\(/g) || []).length
    );
}

describe('Paso 0a — UNA instantánea por locución commiteada', () => {
    it('onLocucionCommiteada registra UNA snapshot por locución', () => {
        expect(llamadasSnapshot(fuente())).toBe(1);
    });

    it('la snapshot usa los campos REALES de la fila (texto, etiqueta, turnId, locutionId)', () => {
        expect(tieneCamposDeFila(fuente())).toBe(true);
    });

    it('la revisión del mismo turnId NO añade snapshot', () => {
        expect(evitaRevisiones(fuente())).toBe(true);
    });

    it('las llamadas del archivo son exactamente 2, cada una con su dueño', () => {
        expect(totalLlamadasHook(fuente())).toBe(2);
    });
});

// Prueba de detector: infractor sintético => marca; código legítimo => no.
describe('Paso 0a — el detector no es decorativo', () => {
    const handlerSano = (cuerpo: string) => `${REGION_START}\n${cuerpo}\n        },`;

    it('sin la llamada => rojo; con dos => rojo; con una => verde', () => {
        expect(llamadasSnapshot(handlerSano('          activeTurnIdRef.current += 1'))).toBe(0);
        expect(llamadasSnapshot(handlerSano('          grabarSnapshotDeTurno({})\n          grabarSnapshotDeTurno({})'))).toBe(2);
        expect(llamadasSnapshot(handlerSano('          grabarSnapshotDeTurno(fila, { turnId, locutionId })'))).toBe(1);
    });

    it('snapshot sin campos reales de la fila => rojo', () => {
        expect(tieneCamposDeFila(handlerSano('          recordSessionTurn({ kind: \'commit\', text: capture, sessionTurnId: activeTurnIdRef.current })'))).toBe(false);
        expect(tieneCamposDeFila(handlerSano('          grabarSnapshotDeTurno(fila, { turnId, locutionId })'))).toBe(true);
    });

    it('revision sin dedupe => rojo; con dedupe => verde', () => {
        expect(evitaRevisiones(handlerSano('          grabarSnapshotDeTurno(fila, { turnId, locutionId })'))).toBe(false);
        expect(evitaRevisiones(handlerSano('          if (!locutionId || !sessionLocutionsRecordedRef.current.has(locutionId)) {\n            grabarSnapshotDeTurno(fila, { turnId, locutionId })\n          }'))).toBe(true);
    });
});