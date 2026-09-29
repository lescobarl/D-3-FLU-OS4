// ============================================================
// UNA LOCUCION = UNA FILA, aunque FLU hable en medio del turno
// ------------------------------------------------------------
// Defecto MEDIDO en la conversacion del dueno (13:58-13:59): la MISMA orden
// aparecia dos veces con el mismo hablante.
//
//   Okay Flow siguiente carta          (Hablante 1)
//   FLU: Siguiente carta: Subeme paso a pasito...
//   Okay Flow siguiente carta          (Hablante 1)   <- DUPLICADA
//
// Causa raiz: el turno tiene DOS resoluciones que commitean la MISMA frase
// canonica (el fast-path determinista y la resolucion con IA, en paralelo).
// El escritor de la fila delimita "el turno" como TODO lo posterior a la ultima
// fila de FLU; como el motor de juego HABLA entre las dos resoluciones, la
// frontera se movia y la segunda resolucion abria fila nueva.
//
// Invariante: una resolucion del MISMO turno reutiliza su fila (`sameTurn`),
// sin importar que FLU haya hablado en medio. Repetir la orden a PROPOSITO en
// un turno nuevo sigue abriendo fila propia (eso no se toca).
// ============================================================
import { describe, it, expect, beforeEach } from 'vitest';
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow } from '../src/voice/lib/conversationTurnRow';

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

describe('la resolucion del mismo turno no duplica la fila', () => {
    beforeEach(() => {
        useIntegrationStore.getState().resetConversationHistory();
    });

    it('commit temprano + FLU + resolucion = UNA fila (el defecto medido)', () => {
        // 1) commit temprano del turno (visible al instante, sin hablante).
        commitUserTurnRow({ text: ORDEN });
        expect(userRows()).toHaveLength(1);

        // 2) FLU responde (el motor de juego canta la carta).
        fliHabla('Siguiente carta: Subeme paso a pasito.');

        // 3) resolucion del MISMO turno, ahora con el hablante resuelto.
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', sameTurn: true });

        const rows = userRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe(ORDEN);
        // La fila del turno queda completada con su hablante.
        expect(rows[0].speakerName).toBe('Hablante 1');
    });

    it('las DOS resoluciones del turno (fast-path + IA) siguen siendo una fila', () => {
        commitUserTurnRow({ text: ORDEN });
        // El fast-path despacha y el motor habla.
        fliHabla('Siguiente carta: Subeme paso a pasito.');
        // Resolucion con IA del mismo turno.
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', sameTurn: true });

        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].speakerName).toBe('Hablante 1');
    });

    it('CONTROL: repetir la orden a proposito en un turno nuevo SI abre fila', () => {
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1' });
        fliHabla('Primera respuesta.');
        // Turno NUEVO (sin `sameTurn`): el usuario lo dijo otra vez.
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1' });

        expect(userRows()).toHaveLength(2);
    });

    it('CONTROL: un turno nuevo NO reutiliza la fila de un turno anterior', () => {
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1' });
        fliHabla('Respuesta.');
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', sameTurn: true });
        // Aunque la resolucion del turno 1 reutilice, el turno 2 empieza limpio.
        fliHabla('Otra respuesta.');
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1' });

        expect(userRows()).toHaveLength(2);
    });

    it('GUARD: App pasa la marca al escritor (una sola ruta de fila)', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        expect(app).toMatch(/sameTurn: resolved\?\.sameTurn === true/);
    });
});
