// ============================================================
// stability-guards.test.ts
// Guards de REGRESIÓN (source-invariant) para las tres correcciones
// de estabilidad aplicadas tras la cascada de fallos reportada por
// el usuario en la consola del navegador:
//
//   Bug A — ReferenceError: resolvedSpeakerName is not defined
//           (src/voice/hooks/useFluVoiceAssistant.js)
//           → let/const declarados FUERA del try porque el bloque catch
//             los referencia. En JS let/const tienen ámbito de bloque, así
//             que declararlos dentro del try lanzaba ReferenceError en el
//             path de error de la IA, tumbando la UI de React.
//
//   Bug B — Maximum update depth exceeded en stopAllSystems
//           (src/core/autonomy/useAutonomyIntegration.ts)
//           → guard idempotente systemsStoppedRef (useRef) + try/catch
//             alrededor del setState, porque stopAllSystems se invoca en el
//             cleanup del efecto de App durante unmount.
//
//   Bug C — Unhandled rejection capaz de tumbar Vite
//           (src/server/geminiProxy.ts)
//           → sendJson con try/catch (socket cerrado) + try/catch exterior
//             en TODOS los middleware handlers de IA, para que ningún error
//             no manejado pueda tumbar el proceso de desarrollo.
//
// Estos tests son "source-invariant": inspeccionan el código fuente (no el
// runtime), de modo que si alguien revierte cualquiera de las tres
// correcciones, la suite lo detecta al instante.
// ============================================================
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const VOICE_SRC = readFileSync('./src/voice/hooks/useFluVoiceAssistant.js', 'utf-8');
const AUTONOMY_SRC = readFileSync('./src/core/autonomy/useAutonomyIntegration.ts', 'utf-8');
const PROXY_SRC = readFileSync('./src/server/geminiProxy.ts', 'utf-8');

// ============================================================
// Bug A — ReferenceError: resolvedSpeakerName is not defined
// ============================================================
describe('🧪 Guard de estabilidad — Bug A: ReferenceError resolvedSpeakerName', () => {
    it('resolvedSpeakerName y speakerAlias se declaran ANTES del try (visibles en el catch)', () => {
        const declIndex = VOICE_SRC.indexOf('let resolvedSpeakerName = fallbackSpeaker');
        expect(declIndex, 'Debe existir la declaración hoisted de resolvedSpeakerName').toBeGreaterThan(-1);

        const aliasIndex = VOICE_SRC.indexOf('let speakerAlias = null');
        expect(aliasIndex, 'Debe existir la declaración hoisted de speakerAlias').toBeGreaterThan(-1);

        // El try que usa estas variables debe aparecer DESPUÉS de ambas declaraciones
        const tryIndex = VOICE_SRC.indexOf('try {', Math.max(declIndex, aliasIndex));
        expect(tryIndex, 'El try { que las usa debe ir después de las declaraciones').toBeGreaterThan(
            Math.max(declIndex, aliasIndex)
        );

        // Y el catch debe venir después del try (bloque de error real)
        const catchIndex = VOICE_SRC.indexOf('catch', tryIndex);
        expect(catchIndex, 'Debe existir un catch después del try que usa las variables').toBeGreaterThan(tryIndex);
    });

    it('el orden de las declaraciones es exacto (decl → alias → try)', () => {
        const declIndex = VOICE_SRC.indexOf('let resolvedSpeakerName = fallbackSpeaker');
        const aliasIndex = VOICE_SRC.indexOf('let speakerAlias = null');
        const tryIndex = VOICE_SRC.indexOf('try {', Math.max(declIndex, aliasIndex));

        // FallbackSpeaker es un argumento/parámetro del hook, no una declaración nueva
        expect(declIndex).toBeLessThan(aliasIndex);
        expect(aliasIndex).toBeLessThan(tryIndex);
    });

    it('el bloque catch del path de error referencia resolvedSpeakerName sin re-declararlo', () => {
        // Buscar el uso en el catch: "speakerName: resolvedSpeakerName || 'FLU'"
        expect(VOICE_SRC).toContain("speakerName: resolvedSpeakerName || 'FLU'");
        // Verificar que resolvedSpeakerName no se re-declara DENTRO de un try (con let/const)
        const redeclareInTry = VOICE_SRC.match(/try\s*\{[^}]{0,400}?\b(?:let|const)\s+resolvedSpeakerName\b/);
        expect(redeclareInTry, 'resolvedSpeakerName no debe volver a declararse con let/const dentro de un try').toBeNull();
    });
});

// ============================================================
// Bug B — Maximum update depth exceeded (stopAllSystems)
// ============================================================
describe('🧪 Guard de estabilidad — Bug B: Maximum update depth (stopAllSystems)', () => {
    it('existe el guard idempotente systemsStoppedRef (useRef)', () => {
        expect(AUTONOMY_SRC).toContain('const systemsStoppedRef = useRef(false)');
    });

    it('startAllSystems rearma el guard para permitir ciclos start→stop→start', () => {
        expect(AUTONOMY_SRC).toContain('systemsStoppedRef.current = false;');
    });

    it('stopAllSystems es idempotente: early-return si ya se detuvo', () => {
        const stopStart = AUTONOMY_SRC.indexOf('const stopAllSystems');
        expect(stopStart, 'Debe existir la función stopAllSystems').toBeGreaterThan(-1);
        // Cortar hasta el inicio de la siguiente función para abarcar toda la definición
        const stopEnd = AUTONOMY_SRC.indexOf('const createManualBackup', stopStart);
        const stopBlock = AUTONOMY_SRC.slice(stopStart, stopEnd > stopStart ? stopEnd : stopStart + 4000);

        expect(stopBlock, 'stopAllSystems debe tener el early-return idempotente').toContain('if (systemsStoppedRef.current) return;');
        expect(stopBlock, 'stopAllSystems debe marcar el guard como detenido').toContain('systemsStoppedRef.current = true;');
    });

    it('el setState/addNotification de stopAllSystems está protegido con try/catch (unmount-safe)', () => {
        const stopStart = AUTONOMY_SRC.indexOf('const stopAllSystems');
        const stopEnd = AUTONOMY_SRC.indexOf('const createManualBackup', stopStart);
        const stopBlock = AUTONOMY_SRC.slice(stopStart, stopEnd > stopStart ? stopEnd : stopStart + 4000);

        expect(stopBlock, 'El setState debe estar dentro de try/catch').toContain('try {');
        expect(stopBlock, 'Debe existir el catch que evita tumbar la app durante unmount').toContain(
            'actualización de estado omitida durante unmount'
        );
    });
});

// ============================================================
// Bug C — el proxy de IA no puede tumbar Vite
// ============================================================
describe('🧪 Guard de estabilidad — Bug C: el proxy no puede tumbar Vite', () => {
    it('sendJson protege la escritura ante socket cerrado (try/catch + guard writableEnded/destroyed)', () => {
        const sendStart = PROXY_SRC.indexOf('function sendJson(');
        expect(sendStart, 'Debe existir la función sendJson').toBeGreaterThan(-1);
        const sendBlock = PROXY_SRC.slice(sendStart, sendStart + 600);

        expect(sendBlock).toContain('try {');
        expect(sendBlock).toContain('res.writableEnded || res.destroyed');
        expect(sendBlock).toContain('catch (err: unknown)');
    });

    it('todos los middleware handlers de IA están envueltos en try/catch exterior', () => {
        const routes = [
            '/api/gemini/contract',
            '/api/gemini/summary',
            '/api/gemini/participant-eval',
            '/api/gemini/vision',
            '/api/gemini/text',
            '/api/workspace-image',
        ];

        for (const route of routes) {
            const regStart = PROXY_SRC.indexOf(`server.middlewares.use('${route}'`);
            expect(regStart, `El middleware ${route} debe estar registrado`).toBeGreaterThan(-1);

            const segment = PROXY_SRC.slice(regStart, regStart + 1200);
            expect(segment, `El middleware ${route} debe tener try exterior`).toContain('try {');

            // En el catch debe existir una respuesta de error 500 (sendJson o writeHead protegido)
            const hasErrorResponse =
                segment.includes('sendJson(res, 500') || segment.includes('writeHead(500');
            expect(hasErrorResponse, `El middleware ${route} debe responder 500 en el catch`).toBe(true);
        }
    });

    it('el handler de contract nunca responde 200 con body vacío (fail-fast, no cuelga)', () => {
        // La clave del test HTTP: un body vacío no debe entrar al flujo de éxito.
        // Internamente handleContract lanza/atrapa y responde con error.status||500.
        const handleStart = PROXY_SRC.indexOf('async function handleContract(');
        expect(handleStart).toBeGreaterThan(-1);
        const handleEnd = PROXY_SRC.indexOf('async function handleSummary', handleStart);
        const handleBlock = PROXY_SRC.slice(handleStart, handleEnd > handleStart ? handleEnd : handleStart + 5000);
        expect(handleBlock, 'handleContract debe tener try/catch interno').toContain('try {');
        expect(handleBlock).toContain('sendJson(res, error.status || 500');
    });
});

// ============================================================
// Bug D — "hoa" + escucha pasmada: flushListenStateBeforeRebuild
//         NO debe commitear interinos parciales como turnos finales
// ============================================================
// Síntoma reportado: la transcripción solo escribía "hoa" y luego se
// detenía ("escucha pasmada"). Causa raíz: el watchdog de stall en modo
// conversación reconstruye el reconocimiento cada ~4.2s sin ingress, y
// flushListenStateBeforeRebuild() commitaba el interino parcial en vuelo
// (p.ej. "hoa" de "hola") como turno final vía syncConversationStream
// ({ turnCommit: true }). Eso creaba filas basura y reiniciaba la línea
// abierta, de modo que cada ciclo volvía a commitear otro fragmento.
//
// La corrección: en un rebuild el interino parcial se DESCARTA (no se
// commitea) y la línea abierta se resetea limpia, sin emitir fila al log.
describe('🧪 Guard de estabilidad — Bug D: flushListenStateBeforeRebuild no commitea interinos parciales', () => {
    // Extrae el bloque completo de flushListenStateBeforeRebuild (desde su
    // declaración hasta el cierre del useCallback).
    function flushBlock(): string {
        const start = VOICE_SRC.indexOf('const flushListenStateBeforeRebuild = useCallback');
        expect(start, 'Debe existir flushListenStateBeforeRebuild').toBeGreaterThan(-1);
        // El bloque termina en el "}, [" que cierra el useCallback + su array de deps.
        const end = VOICE_SRC.indexOf('}, [', start);
        expect(end, 'El useCallback debe cerrarse con }, [').toBeGreaterThan(start);
        return VOICE_SRC.slice(start, end);
    }

    it('existe la función flushListenStateBeforeRebuild', () => {
        expect(VOICE_SRC).toContain('const flushListenStateBeforeRebuild = useCallback');
    });

    it('NO commitea el interino parcial como turno final (sin syncConversationStream con turnCommit)', () => {
        const block = flushBlock();
        // El commit de un turno final se hace vía syncConversationStream({ turnCommit: true }).
        // En un rebuild NO debe existir esa llamada dentro del bloque.
        expect(block, 'flushListenStateBeforeRebuild no debe llamar syncConversationStream').not.toContain(
            'syncConversationStream'
        );
        expect(block, 'no debe haber turnCommit dentro del bloque').not.toContain('turnCommit');
    });

    it('resetea la línea abierta y el estado de preview (sin tocar transcript ni hablante)', () => {
        const block = flushBlock();
        // Reset de la línea abierta (espejo de finalizeTurnCommit pero sin commitear fila).
        expect(block, 'debe limpiar openLine').toContain("listenStateRef.current.openLine = ''");
        expect(block, 'debe limpiar pendingInterim').toContain("listenStateRef.current.pendingInterim = ''");
        expect(block, 'debe limpiar publishedLiveRef').toContain("publishedLiveRef.current = ''");
        expect(block, 'debe cerrar openPreviewTurnRef').toContain('openPreviewTurnRef.current = false');
        expect(block, 'debe limpiar lastStreamPreviewRef').toContain("lastStreamPreviewRef.current = ''");
        expect(block, 'debe limpiar preflightScheduledForTurnRef').toContain(
            'preflightScheduledForTurnRef.current = false'
        );
        expect(block, 'debe limpiar srGapFiredForOpenLineRef').toContain(
            'srGapFiredForOpenLineRef.current = false'
        );
        expect(block, 'debe limpiar el live transcript').toContain("setLiveTranscript('')");
    });

    it('lee el parcial solo para diagnóstico (no para commitearlo)', () => {
        const block = flushBlock();
        // El parcial se lee únicamente para el log de depuración DEV, no para commitear.
        expect(block, 'debe leer el parcial con cleanForSpeech').toContain('cleanForSpeech(');
        expect(block, 'debe leer el display del stream').toContain('readStreamDisplay(');
    });
});
