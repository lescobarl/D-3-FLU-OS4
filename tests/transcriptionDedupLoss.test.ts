// @vitest-environment node
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
// CORTE 2026-10-26: los dueños viejos (`isRedundantFinal` de activeListen.js,
// `resolveLogRowAction`/`validateLogRows*` de conversationStream.js — islas
// retiradas con la tubería vieja) se sustituyen por los dueños VIVOS del
// módulo conversación:
//   • `unirRevision`/`decidirRevision` (revision.ts): la extensión numérica ES
//     crecimiento; el MISMO tramo nunca pierde palabras; un tramo distinto es
//     locución NUEVA.
//   • `decidirFrontera` (frontera.ts): pausa ≥ silenceCloseMs ⇒ cierre; sin
//     pausa el tramo sigue abierto.
//   • `construirFila`/`promoverFila` (fila.ts): una locución = UNA fila; el
//     final del mismo tramo la promueve en su fila (no duplica, no borra).
//   • `mergeTranscriptText` (transcriptDelta.js, VIVO) se conserva tal cual.
// ============================================================
import { describe, it, expect } from 'vitest';
import { unirRevision, decidirRevision } from '../src/voice/conversation/revision.ts';
import { decidirFrontera } from '../src/voice/conversation/frontera.ts';
import { construirFila, promoverFila } from '../src/voice/conversation/fila.ts';
import type { CierreLocucion } from '../src/voice/conversation/fila.ts';
import type { Fila } from '../src/voice/conversation/ports';
import { mergeTranscriptText } from '../src/voice/lib/transcriptDelta.js';
import { wouldShrinkLog } from '../src/voice/lib/speechMerge.js';

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

/** Locución cerrada de prueba (datos del test; los dueños son los reales). */
const cierre = (locutionId: string, texto: string, sobre: Partial<CierreLocucion> = {}): CierreLocucion => ({
    locutionId,
    sessionId: 's-1',
    turnId: locutionId,
    inicio: 0,
    fin: 1000,
    sampleRate: 16000,
    texto,
    idioma: 'es',
    overlap: false,
    final: true,
    reason: 'user',
    voz: { nombre: '', nombreConfirmado: false, hablante: 'Hablante 1', continuidad: false },
    etiquetaAnterior: null,
    semillaEtiqueta: 'Hablante 1',
    esEtiquetaAnonima: (etiqueta: string) => etiqueta.startsWith('Hablante'),
    ...sobre,
});

/** Frontera de silencio sobre una locución abierta, sin texto ajeno. */
const frontera = (silencioMs: number) =>
    decidirFrontera({ medida: { hayVoz: false, silencioMs }, textoAjeno: false, abierta: true });

/** Revisión de un resultado del ASR sobre la locución abierta. */
const revision = (tramoAbiertoTexto: string, tramoId: string, texto: string, final: boolean) =>
    decidirRevision({
        tramoAbierto: tramoAbiertoTexto ? { id: UUID_A, texto: tramoAbiertoTexto } : null,
        tramoId,
        texto,
        final,
    });

describe('transcriptionDedupLoss — unirRevision/decidirRevision (revisión del tramo)', () => {
    it('«intervención 2» tras «intervención» ES crecimiento (contenido real, no eco)', () => {
        const r = unirRevision('intervención', 'intervención 2');
        expect(r).toEqual({ texto: 'intervención 2', pintar: true, tipo: 'extiende' });
    });

    it('mismo tramo con final igual a lo mostrado: revisa y conserva (dedup legítimo)', () => {
        const r = unirRevision('intervención 2', 'intervención 2');
        expect(r.tipo).toBe('revisa');
        expect(r.texto).toBe('intervención 2');
    });

    it('extensión real de palabras no se pierde («hola como estas hoy»)', () => {
        expect(unirRevision('hola como estas', 'hola como estas hoy').tipo).toBe('extiende');
    });

    it('texto nuevo distinto es un TRAMO nuevo (locución nueva)', () => {
        const d = revision('que buen día para caminar por el parque', UUID_B, 'ahora habla otra persona', false);
        expect(d.tipo).toBe('nueva');
        expect(d.texto).toBe('ahora habla otra persona');
    });

    // Defecto medido 2026-10-18 (tests/e2e/tutoria-avance.spec.ts): la segunda
    // locución de ese flujo («ok flu como voy») es PREFIJO de la primera («ok flu
    // como voy en inglés») y se descartaba como redundante aunque llegara segundos
    // después: fila perdida y sin despacho. La pausa real ya declaraba «turno
    // nuevo»; el mismo criterio vale para el prefijo: tramo distinto = nueva.
    it('un PREFIJO tras pausa real es un turno NUEVO (no eco)', () => {
        const d = revision('ok flu como voy en ingles', UUID_B, 'ok flu como voy', false);
        expect(d.tipo).toBe('nueva');
    });

    it('el MISMO prefijo dentro del MISMO tramo no pierde palabras (colapso sin pérdida)', () => {
        const d = revision('ok flu como voy en ingles', UUID_A, 'ok flu como voy', false);
        expect(d.tipo).toBe('revisa');
        expect(d.pintar).toBe(false);
        expect(d.texto).toBe('ok flu como voy en ingles');
    });
});

describe('transcriptionDedupLoss — decidirFrontera + tramo nuevo (commit tras pausa)', () => {
    it('«intervención 2» tras pausa larga: el silencio CIERRA y el tramo nuevo abre fila NUEVA (no borra contenido)', () => {
        expect(frontera(5000)).toEqual({ cerrar: true, causa: 'silencio' });
        const d = revision('intervención', UUID_B, 'intervención 2', true);
        expect(d.tipo).toBe('nueva');
        expect(d.texto).toBe('intervención 2');
    });

    it('duplicado exacto tras pausa también es turno nuevo (pausa ⇒ locución nueva)', () => {
        expect(frontera(5000).cerrar).toBe(true);
        const d = revision('intervención', UUID_B, 'intervención', true);
        expect(d.tipo).toBe('nueva');
    });

    it('«intervención 2» en el MISMO tramo (sin pausa) extiende la MISMA locución (dedup legítimo)', () => {
        expect(frontera(200).cerrar).toBe(false); // 200ms < silenceCloseMs (5000)
        const d = revision('intervención', UUID_A, 'intervención 2', true);
        expect(d.tipo).toBe('extiende');
        expect(d.texto).toBe('intervención 2');
    });

    it('texto genuinamente nuevo tras pausa sigue abriendo locución nueva', () => {
        expect(frontera(5000).cerrar).toBe(true);
        const d = revision('que buen día para caminar por el parque', UUID_B, 'ahora habla otra persona', true);
        expect(d.tipo).toBe('nueva');
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

describe('transcriptionDedupLoss — fila por locución (no se borra ni se duplica)', () => {
    it('cada locución cerrada construye SU fila: el contenido nunca se borra', () => {
        const primera = construirFila(cierre(UUID_A, 'intervención'));
        const segunda = construirFila(cierre(UUID_B, 'intervención 2'));
        if (!primera.fila || !segunda.fila) throw new Error('las locuciones válidas no se descartan');
        expect(primera.fila.texto).toBe('intervención');
        expect(segunda.fila.texto).toBe('intervención 2');
    });

    it('el dedup legítimo (mismo tramo) deja UNA sola fila «intervención 2»', () => {
        const creada = construirFila(cierre(UUID_A, 'intervención', { final: false }));
        if (!creada.fila) throw new Error('la locución válida no se descarta');
        const fila: Fila = { ...creada.fila, revision: 0, updated_at: 0, deleted: false };
        const cambios = promoverFila(fila, 'intervención 2');
        expect(cambios).toEqual({ texto: 'intervención 2', provisional: false });
    });
});

// ============================================================
// Divergencia ultima-frase vs fila (shrink-preview).
//
// El preview BLOQUEABA el recorte por ruido ASR (wouldShrinkListenLog), pero el
// commit escribia el texto recortado: la fila quedaba MAS CORTA que lo ultimo
// mostrado y la cola se perdia ('...del centro' -> '...'). Medido antes del
// arreglo: mostrado 'hola como estas' -> fila 'hola como'; mostrado 'necesito
// comprar pan y leche' -> fila 'leche'.
//
// El dueño vivo decide con `unirRevision`: el MISMO tramo nunca pierde
// palabras, de modo que la fila y la última frase son el mismo texto. NO toca
// las extensiones ('intervencion' -> 'intervencion 2'), que son crecimiento:
// la guarda deja pasar el crecimiento, asi que el P0 de transcriptionDedupLoss
// sigue cubierto por los casos de arriba.
// ============================================================
describe('transcriptionDedupLoss - la fila no puede ser mas corta que la ultima frase', () => {
    const CASOS = [
        ['hola como estas', 'hola como'],
        ['vamos a la tienda del centro', 'vamos a la tienda'],
        ['necesito comprar pan y leche', 'leche'],
    ] as const;

    it('el recorte por ruido ASR se detecta (sintoma observado)', () => {
        for (const [shown, capture] of CASOS) {
            expect(wouldShrinkLog(capture, shown)).toBe(true);
        }
    });

    it('el MISMO tramo no pierde palabras: la locución conserva la frase larga', () => {
        for (const [shown, capture] of CASOS) {
            const union = unirRevision(shown, capture);
            expect(union.pintar).toBe(false);
            expect(union.texto).toBe(shown);
        }
    });

    it('promovida, la fila conserva la frase larga (mismo tramo, una sola fila)', () => {
        const shown = 'vamos a la tienda del centro';
        const creada = construirFila(cierre(UUID_A, shown, { final: false }));
        if (!creada.fila) throw new Error('la locución válida no se descarta');
        const cambios = promoverFila(
            { ...creada.fila, revision: 0, updated_at: 0, deleted: false },
            'vamos a la tienda',
        );
        expect(cambios).toEqual({ texto: shown, provisional: false });
        expect(shown.includes('del centro')).toBe(true);
    });

    it('la extension (crecimiento) NO se toca: el P0 sigue cubierto', () => {
        expect(unirRevision('intervencion', 'intervencion 2').tipo).toBe('extiende');
    });

    it('texto sin relacion tampoco se toca (tramo nuevo)', () => {
        const d = revision('que buen dia para caminar', UUID_B, 'ahora habla otra persona', false);
        expect(d.tipo).toBe('nueva');
        expect(d.texto).toBe('ahora habla otra persona');
    });
});

describe('PRUEBA DE DETECTOR (el detector no es decorativo)', () => {
    it('el bloque largo NUEVO es un tramo nuevo: no extiende ni revisa el bloque anterior', () => {
        const anterior = 'Okay Flow buen dia como estas Platicame de ti';
        const nuevo =
            'okay Este es una prueba de la diarizacion en este caso vamos a revisar como funciona yo soy Luis estoy hablando';
        const d = revision(anterior, UUID_B, nuevo, true);
        expect(d.tipo).toBe('nueva');
        expect(d.texto).toBe(nuevo);
    });
});
