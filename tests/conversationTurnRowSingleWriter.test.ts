// @vitest-environment jsdom
// ============================================================
// conversationTurnRowSingleWriter — UN solo escritor de la fila del usuario
// ------------------------------------------------------------
// Invariante §9: una frase hablada ⇒ UNA fila visible.
// El guard EJECUTA la secuencia real (commit temprano → emisión cruda → commit
// final) sobre el ÚNICO escritor `commitUserTurnRow` y exige 1 fila; y que una
// emisión que crece reemplace en lugar de duplicar.
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';
import { useIntegrationStore } from '../src/store/integrationStore';

const FRASE = 'okay flow crea una cita';

/** Llamadas a commitUserTurnRow en un fuente (mismo criterio del guard). */
export function commitUserTurnRowCalls(src: string): number {
    return (src.match(/commitUserTurnRow\(/g) || []).length;
}

function history() {
    return useIntegrationStore.getState().conversationHistory;
}

beforeEach(() => {
    useIntegrationStore.setState({ conversationHistory: [], activePersonId: undefined });
});

describe('commitUserTurnRow — un solo escritor de la fila del usuario', () => {
    it('temprano → cruda → final deja UNA sola fila', () => {
        commitUserTurnRow({ text: FRASE, turnId: 1 });                       // commit temprano
        commitUserTurnRow({ text: FRASE, speakerName: 'Hablante 1', turnId: 1 }); // emisión cruda
        commitUserTurnRow({ text: FRASE, speakerName: 'Hablante 1', turnId: 1 }); // commit final
        const rows = history().filter((e) => e.role === 'user');
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe(FRASE);
    });

    it('emisión que crece REUTILIZA la fila SIN reescribir su texto (append-only)', () => {
        // Regla del dueño (2026-10-12): la conversación solo se INSERTA; el texto
        // consolidado entra en la inserción (el cierre del turno), no por mutación.
        // Antes esta emisión REEMPLAZABA el texto de la fila ya escrita.
        commitUserTurnRow({ text: 'okay flow', speakerName: 'Hablante 1', replaceLast: true, turnId: 1 });
        const r = commitUserTurnRow({ text: FRASE, speakerName: 'Hablante 1', replaceLast: true, turnId: 1 });
        const rows = history().filter((e) => e.role === 'user');
        expect(rows).toHaveLength(1);
        expect(rows[0].text, 'la fila insertada NO se reescribe').toBe('okay flow');
        expect(r.action).toBe('reused');
    });

    it('el commit final completa el hablante sin agregar fila', () => {
        commitUserTurnRow({ text: FRASE, turnId: 1 });                              // sin hablante
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis', turnId: 1 });         // completa
        const rows = history().filter((e) => e.role === 'user');
        expect(rows).toHaveLength(1);
        expect(resolveRowSpeakerLabel(rows[0])).toBe('Luis');
    });

    it('tras la respuesta de FLU, la misma frase es fila NUEVA (turno distinto)', () => {
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis', turnId: 1 });
        useIntegrationStore.getState().addConversationEntry({
            id: 'flu-1', role: 'flu', text: 'Listo', timestamp: Date.now(), sentiment: 'neutral',
        });
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis', turnId: 2 });
        expect(history().filter((e) => e.role === 'user')).toHaveLength(2);
    });

    it('dos locuciones distintas (turnos distintos) son filas distintas', () => {
        commitUserTurnRow({ text: FRASE, speakerName: 'Luis', turnId: 1 });
        commitUserTurnRow({ text: 'okay flow pon una alarma', speakerName: 'Luis', turnId: 2 });
        expect(history().filter((e) => e.role === 'user')).toHaveLength(2);
    });

    it('texto vacío no escribe nada', () => {
        commitUserTurnRow({ text: '   ', turnId: 1 });
        expect(history()).toHaveLength(0);
    });
});

describe('unificación — un solo escritor de la fila del usuario', () => {
    const appSource = () => readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

    it('App YA NO tiene su propio plan/dedup de fila cruda (rawCommitPlan eliminado)', () => {
        expect(appSource().includes('planRawCommit')).toBe(false);
        expect(existsSync(join(process.cwd(), 'src', 'voice', 'lib', 'rawCommitPlan.js'))).toBe(false);
    });

    it('App delega la fila del usuario en commitUserTurnRow (un solo sitio)', () => {
        expect(commitUserTurnRowCalls(appSource())).toBe(1);
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('un solo escritor - el detector no es decorativo', () => {
    it('cuenta los escritores sinteticos y no el que delega', () => {
        expect(commitUserTurnRowCalls('commitUserTurnRow({ text })')).toBe(1)
        expect(commitUserTurnRowCalls('commitUserTurnRow(a)\ncommitUserTurnRow(b)')).toBe(2)
        expect(commitUserTurnRowCalls('row.commit({ text })')).toBe(0)
    })
})

// P9.17 - la fila del usuario la escribe UN dueno. El store (addUserMessage) solo
// aporta su parte: sentimiento y estadisticas. Antes TAMBIEN concatenaba la entrada
// en conversationHistory (ruta doble de la MISMA fila). Esta barrera lo fija: si
// alguien vuelve a escribir la fila desde el store, cae.
describe('P9.17 el store no es un segundo escritor de la fila', () => {
    beforeEach(() => {
        useIntegrationStore.getState().reset();
    });

    it('addUserMessage NO escribe la fila (y SI actualiza sus estadisticas)', () => {
        useIntegrationStore.getState().addUserMessage('hola que tal', 'Hablante 1');

        expect(history().filter((e) => e.role === 'user')).toHaveLength(0);
        expect(useIntegrationStore.getState().sessionStats.totalUserMessages).toBe(1);
    });

    it('la fila aparece cuando la escribe el dueno', () => {
        useIntegrationStore.getState().addUserMessage('hola que tal', 'Hablante 1');
        commitUserTurnRow({ text: 'hola que tal', speakerName: 'Hablante 1', turnId: 'p917' });

        const filas = history();
        expect(filas.filter((e) => e.role === 'user')).toHaveLength(1);
        expect(filas[filas.length - 1].text).toBe('hola que tal');
    });
});

// P9.47 - UN SOLO escritor del nombre de una fila en el store.
// AMEND (freeze 2026-10-17, mandato del dueno): el nombre se CONGELA EN LA FILA al identificar su
// VOZ, asi que el store SI necesita un mutador del nombre. Sigue habiendo UNO SOLO — el del freeze
// (`setEntrySpeakerName`) — y ningun SEGUNDO escritor (spread de la entrada): `setConversationEntrySpeaker`
// lo era (0 llamadores) y se retiro. La barrera lo fija por FORMA (spread de la entrada) y por
// DUENO (la clave del mutador que lo contiene), no por nombre literario.
export function rowSpeakerWriters(src: string): string[] {
    return src.match(/\{\s*\.\.\.\s*\w+\s*,\s*speakerName/g) || [];
}

/** Clave del mutador del store que CONTIENE cada escritor del nombre ('' si no se puede leer). */
export function rowSpeakerWriterOwners(src: string): string[] {
    const re = /\{\s*\.\.\.\s*\w+\s*,\s*speakerName/g;
    const owners: string[] = [];
    for (const m of src.matchAll(re)) {
        const antes = src.slice(0, m.index);
        const claves = [...antes.matchAll(/(\w+)\s*:\s*\(/g)];
        owners.push(claves.length ? claves[claves.length - 1][1] : '');
    }
    return owners;
}

describe('P9.47 un solo escritor del nombre de fila en el store', () => {
    const storeSrc = () =>
        readFileSync(join(process.cwd(), 'src', 'store', 'integrationStore.ts'), 'utf8');

    it('el UNICO escritor del nombre de una fila es el del freeze', () => {
        const hits = rowSpeakerWriters(storeSrc());
        expect(hits, `escritores del hablante en el store: ${JSON.stringify(hits)}`).toHaveLength(1);
        expect(rowSpeakerWriterOwners(storeSrc()), 'el escritor unico es el del freeze').toEqual([
            'setEntrySpeakerName',
        ]);
    });

    it('el segundo escritor retirado NO vuelve', () => {
        expect(storeSrc().includes('setConversationEntrySpeaker')).toBe(false);
    });
});

// P2.4 - prueba de DETECTOR (mutacion): sintetico infractor, la marca. Si el guard
// siguiera verde con el escritor inyectado, seria teatro.
describe('P9.47 - el detector no es decorativo (prueba de mutacion)', () => {
    it('marca el escritor sintetico y NO la fila nueva', () => {
        expect(rowSpeakerWriters('{ ...entry, speakerName }')).toHaveLength(1);
        expect(rowSpeakerWriters('{ ...e, speakerName }')).toHaveLength(1);
        expect(rowSpeakerWriters("speakerName: 'FLU'")).toHaveLength(0);
        expect(rowSpeakerWriters('{ ...entry, text }')).toHaveLength(0);
    });

    it('un SEGUNDO escritor cambia el conteo y los duenos', () => {
        const src =
            'setEntrySpeakerName: (id: string, speakerName: string) => { (...{ ...e, speakerName }) } ' +
            'otroMutador: (id) => { (...{ ...x, speakerName }) }';
        expect(rowSpeakerWriters(src)).toHaveLength(2);
        expect(rowSpeakerWriterOwners(src)).toEqual(['setEntrySpeakerName', 'otroMutador']);
    });
});
