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
import { useIntegrationStore } from '../src/store/integrationStore';
import { commitUserTurnRow, escribeFilaDeUsuario } from '../src/voice/lib/conversationTurnRow';

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
    });

    it('commit temprano + FLU + resolucion del MISMO turno = UNA fila', () => {
        commitUserTurnRow({ text: ORDEN, turnId: 101 });
        expect(userRows()).toHaveLength(1);

        fliHabla('Siguiente carta: Subeme paso a pasito.');

        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 101 });

        const rows = userRows();
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe(ORDEN);
        expect(rows[0].speakerName).toBe('Hablante 1');
    });

    it('las DOS resoluciones del turno (fast-path + IA) siguen siendo una fila', () => {
        commitUserTurnRow({ text: ORDEN, turnId: 102 });
        fliHabla('Siguiente carta: Subeme paso a pasito.');
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1', turnId: 102 });

        expect(userRows()).toHaveLength(1);
        expect(userRows()[0].speakerName).toBe('Hablante 1');
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

    it('COMPATIBILIDAD: sin turnId, el commit temprano y la resolucion siguen siendo una fila', () => {
        commitUserTurnRow({ text: ORDEN });
        commitUserTurnRow({ text: ORDEN, speakerName: 'Hablante 1' });

        expect(userRows()).toHaveLength(1);
    });

    it('GUARD: App pasa la identidad de turno al escritor (una sola ruta de fila)', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const app = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf8');
        expect(app).toMatch(/turnId: resolved\?\.turnId \?\? null/);
    });

    it('GUARD: el hook publica la identidad del turno en los DOS commits', async () => {
        const fs = await import('node:fs');
        const path = await import('node:path');
        const hook = fs.readFileSync(
            path.join(process.cwd(), 'src', 'voice', 'hooks', 'useFluVoiceAssistant.js'),
            'utf8',
        );
        const marcas = hook.match(/turnId: activeTurnIdRef\.current/g) || [];
        expect(marcas).toHaveLength(2);
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
        ['commit temprano sin texto aun', { userCommitOnly: true }, false, false, true],
        ['resolucion con texto', {}, true, true, true],
        ['emision cruda vacia tras limpiar', { rawOnly: true }, false, false, false],
        ['emision cruda hablable', { rawOnly: true }, true, true, true],
        ['sin texto y sin commit', {}, false, false, false],
    ];
    it.each(PUERTA)('puerta de fila: %s', (_caso, payload, hayTexto, hablable, esperado) => {
        expect(escribeFilaDeUsuario(payload, { hayTexto, hablable })).toBe(esperado);
    });
});
