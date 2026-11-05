// ============================================================
// rulesSimulator - SIMULADOR DE LAS REGLAS DE DOMINIO (AGENTS.md Anexo B +
// contrato de desenlace de partida).
//
// Una regla = un escenario. La ENTRADA es REAL (la transcripcion de la sesion),
// NUNCA generada a partir de la salida de FLU: generar la jugada desde el prompt
// del motor hacia que el arnes no pudiera fallar aunque el producto estuviera roto.
//
// Cada regla esta en UNO de estos tres modos, y ninguno puede quedar sin declarar:
//   EJERCITA - el escenario se corre aqui con las funciones reales.
//   DELEGA   - la regla tiene guard propio; aqui se exige que ESE fichero exista.
//   SIN_GUARD- hueco declarado (congelado): no crece en silencio.
//
// ANTI-DERIVA: si AGENTS.md declara una regla que este simulador no situa, es ROJO.
// ============================================================
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
    parseNoteIntentText,
} from '../src/voice/lib/noteIntentParser.js';
import {
    splitTranscriptAtWakeWord,
} from '../src/voice/lib/audioMath.js';
import { spokenUtteranceRevision } from '../src/voice/lib/audioMath.js';
import { unirRevision, decidirRevision } from '../src/voice/conversation/revision.ts';
import { resolveInlineWakeAtCommit } from '../src/voice/lib/wakeTurnCommit.js';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig.js';

const ROOT = process.cwd();
const WAKE_WORDS = FLU_CONFIG.voiceCommands.wakeWords as string[];

type Resultado = string | null; // null = la regla se cumple; string = fallo medido

// ------------------------------------------------------------
// ESCENARIOS QUE EJERCITAN (entrada real de la sesion)
// ------------------------------------------------------------

/** Regla 11: el mandato empieza en la wake; lo anterior es ruido y se descarta. */
function regla11WakeYRuido(): Resultado {
    const cruda = 'expresiva okay flu Okay Flow incluye en la nota del súper insecticida';
    const split = splitTranscriptAtWakeWord(cruda, WAKE_WORDS) as {
        wakeWordMatched: boolean;
        beforeWakeText: string;
        afterWakeText: string;
        commandText: string;
    };
    if (!split.wakeWordMatched) return `la wake no se reconocio en "${cruda}"`;
    const ruido = ['expresiva', 'okay flu', 'okay flow'];
    const enElMandato = ruido.filter((r) => split.commandText.toLowerCase().includes(r));
    if (enElMandato.length) return `ruido de eco dentro del mandato: ${enElMandato.join(', ')} -> "${split.commandText}"`;
    const intent = parseNoteIntentText(split.commandText) as { body?: string } | null;
    if (!intent) return `el mandato "${split.commandText}" no se entiende como nota`;
    if (!(intent.body ?? '').toLowerCase().includes('insecticida')) {
        return `el item se perdio: body="${intent.body}"`;
    }
    // La wake repetida (eco del hablante o de FLU) no puede quedar DENTRO del mandato.
    const wakeDoble = splitTranscriptAtWakeWord('Okay Flow Okay Flow siguiente carta', WAKE_WORDS) as {
        commandText: string;
    };
    const arrastra = WAKE_WORDS.some((w) => wakeDoble.commandText.toLowerCase().startsWith(w));
    if (arrastra) return `la wake repetida sigue dentro del mandato: "${wakeDoble.commandText}"`;
    return null;
}

/** Regla 10: una lista es UN destino (Super) y sus items van al CONTENIDO. */
function regla10AcumulaItems(): Resultado {
    // Tres ordenes seguidas de la sesion real.
    const ordenes = [
        'incluye en la nota del súper un poco de pan',
        'adiciona en la nota del súper focos',
        'incluye en la nota del súper insecticida',
    ];
    const destinos = new Set<string>();
    const items: string[] = [];
    for (const orden of ordenes) {
        const intent = parseNoteIntentText(orden) as { label?: string; body?: string } | null;
        if (!intent) return `"${orden}" no se entiende como nota`;
        if (!intent.body || intent.body.trim() === '') return `"${orden}" no deja item (body vacio)`;
        destinos.add(intent.label ?? '(sin destino)');
        items.push(intent.body.trim().toLowerCase());
    }
    if (destinos.size !== 1) {
        return `la lista se partio en ${destinos.size} destinos: ${[...destinos].join(' | ')}`;
    }
    if (new Set(items).size !== items.length) {
        return `items repetidos o pisados: ${items.join(' | ')}`;
    }
    const esperados = ['pan', 'focos', 'insecticida'];
    const faltan = esperados.filter((e) => !items.some((i) => i.includes(e)));
    if (faltan.length) return `items perdidos: ${faltan.join(', ')}`;
    return null;
}

/** Regla 10: el item repetido no se duplica ni parte la lista en dos. */
function regla10SinDuplicado(): Resultado {
    const orden = 'incluye en la nota del súper insecticida';
    const a = parseNoteIntentText(orden) as { label?: string; body?: string } | null;
    const b = parseNoteIntentText(orden) as { label?: string; body?: string } | null;
    if (!a || !b) return 'el item repetido deja de entenderse';
    if ((a.label ?? '') !== (b.label ?? '')) return 'la misma orden resuelve a destinos distintos';
    if ((a.body ?? '').trim().toLowerCase() !== (b.body ?? '').trim().toLowerCase()) {
        return `la misma orden deja items distintos: "${a.body}" vs "${b.body}"`;
    }
    return null;
}

/**
 * El doble turno: la MISMA orden reemitida con un resultado de reconocimiento
 * nuevo (eco de FLU / ruido de sala) no puede producir un segundo despacho. El
 * DUENO de esa decision NO es el discriminante por timestamps de la tuberia
 * vieja (retirado con ella); el dueno real es la capa de commit, que recorta
 * el eco de wake+orden que la captura arrastra. Si ese recorte no ocurre, la
 * orden se despacha otra vez: una orden, dos cartas.
 */
function reglaEcoNeutralizado(): Resultado {
    const r = resolveInlineWakeAtCommit(
        'ella me tocó y su boca estaba abierta Okay Flow siguiente carta',
        'Okay Flow vamos a jugar lotería',
    ) as { capture?: string; fluTail?: unknown } | null;
    if (!r || !r.fluTail) {
        return 'el eco de wake+orden NO se detecta: la orden se re-despacharia (una orden -> dos cartas)';
    }
    if ((r.capture ?? '').toLowerCase().includes('siguiente carta')) {
        return `el mandato arrastra el eco del comando: capture="${r.capture}"`;
    }
    return null;
}

/** Regla 14: los dos comparadores de revision ASR son DISTINTOS a proposito. */
function regla14Comparadores(): Resultado {
    if (typeof spokenUtteranceRevision !== 'function') return 'falta spokenUtteranceRevision';
    if (typeof unirRevision !== 'function') return 'falta unirRevision';
    // Mismo par de frases: NO son el mismo criterio. El comparador del ASR pela la
    // wake y declara 'equal'; la union del modulo ve una reemision MAS CORTA y
    // declara 'revisa' sin pintar (la locucion nunca pierde palabras).
    const ultimo = 'okay flow siguiente carta';
    const siguiente = 'siguiente carta';
    const revision = spokenUtteranceRevision(ultimo, siguiente, WAKE_WORDS);
    const union = unirRevision(ultimo, siguiente);
    if (revision !== 'equal') return `spokenUtteranceRevision debe declarar 'equal', dio ${String(revision)}`;
    if (union.tipo !== 'revisa' || union.pintar !== false || union.texto !== ultimo) {
        return `unirRevision debe declarar revisa sin pintar conservando el texto: ${JSON.stringify(union)}`;
    }
    return null;
}

// ------------------------------------------------------------
// CATALOGO DE REGLAS: cada regla de Anexo B en un modo declarado
// ------------------------------------------------------------
type Modo = 'EJERCITA' | 'DELEGA' | 'SIN_GUARD';
interface Sitio {
    id: number;
    modo: Modo;
    /** EJERCITA: el escenario. DELEGA: el fichero del guard. SIN_GUARD: el motivo. */
    detalle: string;
    corre?: () => Resultado;
    guard?: string;
}

const REGLAS: Sitio[] = [
    { id: 1, modo: 'DELEGA', detalle: 'escucha centralizada (una instancia)', guard: 'tests/voiceMicSingleton.test.ts' },
    { id: 2, modo: 'DELEGA', detalle: 'tratamiento unico de escucha/transcripcion', guard: 'tests/commitSingleSiteGuard.test.ts' },
    { id: 3, modo: 'DELEGA', detalle: 'frase canonica unica (burbuja/bitacora/display)', guard: 'tests/voiceDisplaySingleSource.test.ts' },
    { id: 4, modo: 'DELEGA', detalle: 'wake word unica desde la config', guard: 'tests/wakeStripSingleGuard.test.ts' },
    { id: 5, modo: 'DELEGA', detalle: 'barra de busqueda = transcripcion sin wake', guard: 'tests/voiceSingleSourceGuard.test.ts' },
    { id: 6, modo: 'DELEGA', detalle: 'la question de la IA sale de la misma frase', guard: 'tests/voiceTurnCommitDerivation.test.ts' },
    { id: 7, modo: 'SIN_GUARD', detalle: 'TTS: un solo modulo encapsula speechSynthesis' },
    { id: 8, modo: 'SIN_GUARD', detalle: 'idioma: una fuente y un selector' },
    { id: 9, modo: 'DELEGA', detalle: 'ajustes de IA con un dueno (sin clave paralela)', guard: 'tests/storageKeysAliveGuard.test.ts' },
    { id: 10, modo: 'EJERCITA', detalle: 'nota con lista = UN destino; items acumulados sin pisarse', corre: regla10AcumulaItems },
    { id: 11, modo: 'EJERCITA', detalle: 'el mandato empieza en la wake; el eco previo se descarta', corre: regla11WakeYRuido },
    { id: 12, modo: 'DELEGA', detalle: 'conjunto vs item concreto en agenda', guard: 'tests/systemMatrix.test.ts' },
    { id: 13, modo: 'DELEGA', detalle: 'una orden de arranque nunca es accion de partida', guard: 'tests/gameStartRequestNotInGameAction.test.ts' },
    { id: 14, modo: 'EJERCITA', detalle: 'comparadores de revision ASR distintos', corre: regla14Comparadores },
    { id: 15, modo: 'DELEGA', detalle: 'matriz de sistema derivada de los registros', guard: 'tests/systemMatrix.test.ts' },
    { id: 16, modo: 'SIN_GUARD', detalle: 'alcance afectado = consumidores transitivos' },
    { id: 17, modo: 'DELEGA', detalle: 'cobertura derivada y pendiente (G1..G7)', guard: 'tests/surfaceMatrix.test.ts' },
    { id: 18, modo: 'DELEGA', detalle: 'el ultimo objeto de CADA tipo del Pizarron no se borra (video/imagen/todo)', guard: 'tests/turnArtifactKindPerTurn.test.ts' },
    { id: 19, modo: 'DELEGA', detalle: 'con partida activa, un turno AJENO no lo consume el motor: la partida queda EN PAUSA (todos los juegos)', guard: 'tests/gameDoesNotHijackCommands.test.ts' },
];

/** Huecos congelados: crecer en silencio es lo prohibido. */
const SIN_GUARD_CONGELADOS = [7, 8, 16];

// ------------------------------------------------------------
// ANTI-DERIVA: las reglas que AGENTS.md declara
// ------------------------------------------------------------
/** Reglas declaradas en el Anexo B de un texto (mismo criterio del simulador). */
export function rulesDeclaredIn(mdText: string): number[] {
    const md = mdText.split(/\r?\n/);
    const inicio = md.findIndex((l) => /^##\s*Anexo B/.test(l));
    if (inicio < 0) return [];
    const ids: number[] = [];
    for (let i = inicio + 1; i < md.length; i += 1) {
        if (/^##\s/.test(md[i])) break;
        const m = /^(\d+)\.\s+\*\*/.exec(md[i]);
        if (m) ids.push(Number(m[1]));
    }
    return [...new Set(ids)].sort((a, b) => a - b);
}

function reglasDeclaradasEnAgents(): number[] {
    return rulesDeclaredIn(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8'));
}

describe('simulador de reglas - AGENTS.md Anexo B', () => {
    it('no hay regla declarada sin situar en el simulador (anti-deriva)', () => {
        const declaradas = reglasDeclaradasEnAgents();
        const situadas = REGLAS.map((r) => r.id).sort((a, b) => a - b);
        const sinSituar = declaradas.filter((id) => !situadas.includes(id));
        const sobran = situadas.filter((id) => !declaradas.includes(id));
        expect({ declaradas: declaradas.length, sinSituar, sobran }).toEqual({
            declaradas: declaradas.length,
            sinSituar: [],
            sobran: [],
        });
    });

    it('cada regla delegada apunta a un guard que EXISTE', () => {
        const rotos = REGLAS.filter((r) => r.modo === 'DELEGA' && !existsSync(join(ROOT, r.guard!)));
        expect(rotos.map((r) => `R${r.id} -> ${r.guard}`)).toEqual([]);
    });

    it('los huecos sin guard son EXACTAMENTE los congelados (no crecen)', () => {
        const sinGuard = REGLAS.filter((r) => r.modo === 'SIN_GUARD').map((r) => r.id);
        expect(sinGuard).toEqual(SIN_GUARD_CONGELADOS);
    });
});

describe('simulador de reglas - escenarios ejercitados con entrada real', () => {
    for (const regla of REGLAS.filter((r) => r.modo === 'EJERCITA')) {
        it(`R${regla.id} - ${regla.detalle}`, () => {
            const fallo = regla.corre!();
            expect(fallo).toBeNull();
        });
    }

    it('el eco de wake+orden no genera un segundo despacho', () => {
        expect(reglaEcoNeutralizado()).toBeNull();
    });

    it('frontera del dueno: la reemision del MISMO tramo revisa; un tramo distinto abre locucion nueva', () => {
        // Contrato REAL de decidirRevision (regla 3 del modulo, guard propio en
        // conversacionRevision.test.ts): el tramo identifica la locucion; la
        // re-emision de la misma locucion no duplica (reutiliza su fila, cubierto
        // en conversacionUnaLocucionUnaFilaGuard.test.ts).
        expect(
            decidirRevision({
                tramoAbierto: { id: 't1', texto: 'siguiente carta' },
                tramoId: 't1',
                texto: 'siguiente carta',
                final: true,
            }).tipo,
        ).toBe('revisa');
        expect(
            decidirRevision({
                tramoAbierto: { id: 't1', texto: 'siguiente carta' },
                tramoId: 't2',
                texto: 'siguiente carta',
                final: false,
            }).tipo,
        ).toBe('nueva');
    });

    it('el mismo item repetido no duplica la lista', () => {
        expect(regla10SinDuplicado()).toBeNull();
    });
});

// P2.4 - prueba de detector: alimentado el infractor sintetico, la marca.
describe('simulador de reglas - el detector no es decorativo', () => {
    it('marca las reglas declaradas bajo el Anexo B y no las de fuera', () => {
        const md = ['## Anexo B', '1. **uno**', '2. **dos**', '## Otra', '9. **nueve**'].join('\n');
        expect(rulesDeclaredIn(md)).toEqual([1, 2]);
        expect(rulesDeclaredIn('## Otra\n1. **uno**')).toEqual([]);
    });
});