// ============================================================
// transcriptionDedupLoss — la transcripción NO debe perder ni
// duplicar contenido (regresión de los parches anti-eco numérico).
//
// Escenario real (newest first):
//   17:10:42 Hablante 1 → «intervención»
//   17:10:47 Hablante 1 → «intervención 2»   ← turno distinto (NO eco)
//   17:10:57 Hablante 1 → «televisión dos aquí está duplicando» (pérdida STT)
//
// Causa raíz de la PÉRDIDA: tres parches OS4-only trataban la extensión
// numérica («intervención» → «intervención 2») como eco ASR redundante y la
// descartaban, reemplazaban o borraban tras pausa → conversación perdida y
// congelamiento de la escucha (el reloj meaningful-ingress se quedaba sin
// avances → el watchdog reiniciaba el reconocimiento en bucle).
//
// Corrección: restaurar la semántica OS2/OS3 (proyecto de referencia validado).
//   • isRedundantFinal: la extensión con cola numérica NO es redundante.
//   • resolveLogRowAction: pausa ⇒ SIEMPRE fila nueva (no borra contenido);
//     el dedup legítimo del mismo turno lo hace replaceLast sin pausa.
//   • mergeTranscriptText: el fragmento numérico se conserva («intervención 2»).
//
// El dedup real (mismo turno) lo cubre el guard `openPreview` (preview === final),
// idéntico a OS2/OS3, de modo que una intervención extendida queda en UNA fila.
// Los validadores del log son DIAGNÓSTICOS, no borran nada.
// ============================================================
import { describe, it, expect } from 'vitest';
import { isRedundantFinal } from '../src/voice/lib/activeListen.js';
import {
    resolveLogRowAction,
    validateLogRowsNoPrefixDup,
    validateLogRowsNoAsrRevisionDup,
} from '../src/voice/lib/conversationStream.js';
import { mergeTranscriptText } from '../src/voice/lib/transcriptDelta.js';

describe('transcriptionDedupLoss — isRedundantFinal (ingress)', () => {
    it('«intervención 2» tras «intervención» NO es redundante (es contenido real, no eco)', () => {
        const r = isRedundantFinal('intervención 2', {
            lastCommitted: 'intervención',
            lastEmitted: 'intervención',
            preview: '',
            openPreview: false,
        });
        expect(r).toBe(false);
    });

    it('mismo turno con preview abierto: final === preview NO es redundante (dedup legítimo)', () => {
        const r = isRedundantFinal('intervención 2', {
            lastCommitted: 'intervención',
            lastEmitted: 'intervención',
            preview: 'intervención 2',
            openPreview: true,
        });
        expect(r).toBe(false);
    });

    it('extensión real de palabras no se descarta («hola como estas hoy»)', () => {
        const r = isRedundantFinal('hola como estas hoy', {
            lastCommitted: 'hola como estas',
            lastEmitted: 'hola como estas',
            preview: '',
            openPreview: false,
        });
        expect(r).toBe(false);
    });

    it('texto nuevo distinto no es redundante', () => {
        const r = isRedundantFinal('ahora habla otra persona', {
            lastCommitted: 'que buen día para caminar por el parque',
            lastEmitted: 'que buen día para caminar por el parque',
            preview: '',
            openPreview: false,
        });
        expect(r).toBe(false);
    });
});

describe('transcriptionDedupLoss — resolveLogRowAction (commit tras pausa)', () => {
    const base = {
        activeLogStream: false,
        newParagraph: false,
        turnBoundary: true,
        turnCommit: true,
        lastEmitted: 'intervención',
        lastCommitted: 'intervención',
        logRowContext: { msSinceLastCommit: 5000 },
    };

    it('«intervención 2» tras pausa larga abre fila NUEVA (no borra contenido)', () => {
        const action = resolveLogRowAction({ ...base, capture: 'intervención 2' });
        expect(action.replaceLast).toBe(false);
        expect(action.effectiveNewParagraph).toBe(true);
    });

    it('duplicado exacto tras pausa también abre fila nueva (pausa ⇒ turno nuevo)', () => {
        const action = resolveLogRowAction({ ...base, capture: 'intervención' });
        expect(action.replaceLast).toBe(false);
        expect(action.effectiveNewParagraph).toBe(true);
    });

    it('«intervención 2» en el MISMO turno (sin pausa) reemplaza la fila del preview (dedup legítimo)', () => {
        const action = resolveLogRowAction({
            ...base,
            capture: 'intervención 2',
            logRowContext: { msSinceLastCommit: 200 },
        });
        expect(action.replaceLast).toBe(true);
        expect(action.effectiveNewParagraph).toBe(false);
    });

    it('texto genuinamente nuevo tras pausa sigue abriendo fila nueva', () => {
        const action = resolveLogRowAction({
            ...base,
            lastEmitted: 'que buen día para caminar por el parque',
            lastCommitted: 'que buen día para caminar por el parque',
            capture: 'ahora habla otra persona',
        });
        expect(action.replaceLast).toBe(false);
        expect(action.effectiveNewParagraph).toBe(true);
    });
});

describe('transcriptionDedupLoss — mergeTranscriptText (fragmento numérico)', () => {
    it('«intervención» + fragmento suelto «2» conserva «intervención 2» (el número no se pierde)', () => {
        expect(mergeTranscriptText('intervención', '2')).toBe('intervención 2');
    });

    it('número legítimo tras frase de varias palabras se conserva («voy al piso» + «5»)', () => {
        expect(mergeTranscriptText('voy al piso', '5')).toBe('voy al piso 5');
    });
});

describe('transcriptionDedupLoss — validadores del log (DIAGNÓSTICOS, no borran)', () => {
    it('los validadores marcan filas adyacentes similares como inválidas, pero NO impiden la fila nueva', () => {
        expect(validateLogRowsNoPrefixDup(['intervención', 'intervención 2'])).toBe(false);
        expect(validateLogRowsNoAsrRevisionDup(['intervención', 'intervención 2'])).toBe(false);
        // La pausa sigue abriendo la fila: el contenido nunca se borra.
        const action = resolveLogRowAction({
            activeLogStream: false,
            newParagraph: false,
            turnBoundary: true,
            turnCommit: true,
            lastEmitted: 'intervención',
            lastCommitted: 'intervención',
            capture: 'intervención 2',
            logRowContext: { msSinceLastCommit: 5000 },
        });
        expect(action.replaceLast).toBe(false);
        expect(action.effectiveNewParagraph).toBe(true);
    });

    it('el dedup legítimo (mismo turno) deja UNA sola fila «intervención 2» y pasa los validadores', () => {
        const action = resolveLogRowAction({
            activeLogStream: false,
            newParagraph: false,
            turnBoundary: true,
            turnCommit: true,
            lastEmitted: 'intervención',
            lastCommitted: 'intervención',
            capture: 'intervención 2',
            logRowContext: { msSinceLastCommit: 200 },
        });
        expect(action.replaceLast).toBe(true);
        const rows = ['intervención 2'];
        expect(validateLogRowsNoPrefixDup(rows)).toBe(true);
        expect(validateLogRowsNoAsrRevisionDup(rows)).toBe(true);
    });
});
