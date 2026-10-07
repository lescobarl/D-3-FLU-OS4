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
import { isRedundantFinal, wouldShrinkListenLog } from '../src/voice/lib/activeListen.js';
import { reconcileCommitText } from '../src/voice/lib/turnStream.js';
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

// ============================================================
// Divergencia ultima-frase vs fila (shrink-preview).
//
// El preview BLOQUEA el recorte por ruido ASR (wouldShrinkListenLog), pero el
// commit escribia el texto recortado: la fila quedaba MAS CORTA que lo ultimo
// mostrado y la cola se perdia ('...del centro' -> '...'). Medido antes del
// arreglo: mostrado 'hola como estas' -> fila 'hola como'; mostrado 'necesito
// comprar pan y leche' -> fila 'leche'.
//
// El arreglo decide con el MISMO predicado del preview (reconcileCommitText),
// de modo que la fila y la ultima frase son el mismo texto. NO toca las
// extensiones ('intervencion' -> 'intervencion 2'), que son crecimiento:
// la guarda deja pasar el crecimiento, asi que el P0 de transcriptionDedupLoss
// sigue cubierto por los casos de arriba.
// ============================================================
describe('transcriptionDedupLoss - la fila no puede ser mas corta que la ultima frase', () => {
    const CASOS = [
        ['hola como estas', 'hola como'],
        ['vamos a la tienda del centro', 'vamos a la tienda'],
        ['necesito comprar pan y leche', 'leche'],
    ] as const;

    it('el preview ya bloqueaba el recorte (sintoma observado)', () => {
        for (const [shown, capture] of CASOS) {
            expect(wouldShrinkListenLog(capture, shown)).toBe(true);
        }
    });

    it('el commit escribe la ultima frase, no el recorte (no se pierde la cola)', () => {
        for (const [shown, capture] of CASOS) {
            const texto = reconcileCommitText(capture, shown);
            expect(texto).toBe(shown);
        }
    });

    it('reconciliado, la fila resultante conserva el contenido (replaceLast, mismo turno)', () => {
        const shown = 'vamos a la tienda del centro';
        const capture = reconcileCommitText('vamos a la tienda', shown);
        const action = resolveLogRowAction({
            activeLogStream: false,
            newParagraph: false,
            turnBoundary: true,
            turnCommit: true,
            lastEmitted: shown,
            lastCommitted: shown,
            capture,
            logRowContext: { msSinceLastCommit: 200 },
        });
        expect(action.replaceLast).toBe(true);
        expect(shown.includes('del centro')).toBe(true);
    });

    it('la extension (crecimiento) NO se toca: el P0 sigue cubierto', () => {
        expect(reconcileCommitText('intervencion 2', 'intervencion')).toBe('intervencion 2');
    });

    it('texto sin relacion tampoco se toca', () => {
        expect(reconcileCommitText('ahora habla otra persona', 'que buen dia para caminar')).toBe(
            'ahora habla otra persona',
        );
    });
});

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
    it('el commit de un bloque largo NUEVO no pide replaceLast sobre el bloque anterior', () => {
        const anterior = 'Okay Flow buen dia como estas Platicame de ti';
        const nuevo =
            'okay Este es una prueba de la diarizacion en este caso vamos a revisar como funciona yo soy Luis estoy hablando';
        const action = resolveLogRowAction({
            activeLogStream: false,
            newParagraph: false,
            turnBoundary: false,
            turnCommit: true,
            lastEmitted: anterior,
            lastCommitted: anterior,
            capture: nuevo,
            logRowContext: {},
        });
        expect(action.replaceLast).toBe(false);
    });
});
