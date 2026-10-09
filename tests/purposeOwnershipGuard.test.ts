/**
 * purposeOwnershipGuard — capa SEMANTICA de duplicacion (P9.25): "el mismo proposito
 * con OTRO algoritmo".
 *
 * El detector ESTRUCTURAL (structureDuplicationGuard) compara esqueletos: dos funciones
 * con el mismo proposito pero distinto algoritmo NO colisionan. Medido 2026-10-08:
 * 3 remuestreadores vivos (resample.downsample box, pcmAudio.resampleLinear lineal,
 * embeddingFrames.downsampleTo16k decimacion) con las dos barreras en VERDE.
 *
 * Aqui el proposito tiene UN dueno declarado y las variantes con su MOTIVO, y la barrera
 * cae si aparece una CUARTA por FORMA (no por nombre exacto): las `formas` cubren las
 * variantes reales (downsample, downsampleToNk, resampleX), que es lo que exige 7.7.d.
 *
 * NO hay reduccion disponible: tests/embeddingFrames.test.ts PINEA la decimacion
 * (48000 -> 16000 da [0,3,6]). Por eso se CIERRA COMO CLASIFICACION (7.7.e) y la
 * evidencia es la cobertura del detector, no una metrica 1 -> 0.
 */
import { describe, expect, it } from 'vitest';
import { readSources } from '../scripts/duplication.mjs';
import {
    PURPOSES,
    declaredOf,
    evaluatePurposes,
    purposeCandidates,
    purposeCandidatesIn,
} from '../scripts/purposeOwners.mjs';

describe('proposito con dueno unico — mismo proposito, distinto algoritmo (P9.25)', () => {
    const sources = readSources('src');
    const { undeclared, missing } = evaluatePurposes(sources) as {
        undeclared: Array<Record<string, string | number>>;
        missing: string[];
    };

    it('no hay implementaciones del proposito fuera del dueno y sus variantes declaradas', () => {
        const detalle = undeclared
            .map((u) => `  ${u.file}:${u.symbol}:${u.line} (proposito ${u.purposeId}, forma ${u.forma})`)
            .join('\n');
        expect(
            undeclared.map((u) => `${u.file}:${u.symbol}`),
            `Implementaciones del proposito SIN declarar (archivo:simbolo:linea):\n${detalle}\n` +
                'Deja una sola (importa el dueno) o declara la variante con su motivo en scripts/purposeOwners.mjs.',
        ).toEqual([]);
    });

    it('cada proposito declarado tiene su dueno PRESENTE en el arbol (registro vivo)', () => {
        expect(missing, 'el dueno de un proposito ya no existe: el registro quedo muerto').toEqual([]);
    });

    it('ANTI-VACUIDAD: las formas del registro ven las implementaciones reales', () => {
        expect(sources.length, 'se leyeron muy pocos ficheros de src').toBeGreaterThan(300);
        // El proposito 'resample' tiene 3 formas declaradas y el arbol materializa las 3:
        // si una dejara de existir, la cobertura caeria (y con ella este caso).
        const candidatos = purposeCandidates(sources) as Array<{ purposeId: string; forma: string }>;
        for (const p of PURPOSES as Array<{ id: string; formas: Array<{ forma: string }> }>) {
            const cubiertas = new Set(candidatos.filter((c) => c.purposeId === p.id).map((c) => c.forma)).size;
            expect(cubiertas, `formas materializadas de ${p.id}`).toBe(p.formas.length);
        }
    });
});

describe('el detector no es decorativo (prueba de mutacion)', () => {
    const purpose = PURPOSES[0];

    it('marca una CUARTA implementacion renombrada y no marca al dueno ni a las variantes', () => {
        const cuarta = purposeCandidatesIn(
            'src/voice/lib/otroResampler.js',
            'export function resampleTo48k(input, fromRate) {\n  return input\n}',
            purpose,
        );
        expect(cuarta.map((c) => `${c.file}:${c.symbol}`)).toEqual(['src/voice/lib/otroResampler.js:resampleTo48k']);
        // El dueno y las variantes NO se marcan (estan declarados).
        const declarados = declaredOf(purpose);
        expect(declarados.has('src/voice/lib/asr/resample.js:downsample')).toBe(true);
        expect(declarados.has('src/voice/lib/embeddingFrames.js:downsampleTo16k')).toBe(true);
        // El barrido real SI ve al dueno (control positivo, no vaciedad).
        const reales = evaluatePurposes(readSources('src')).candidates;
        expect(reales.some((c) => c.file === 'src/voice/lib/asr/resample.js' && c.symbol === 'downsample')).toBe(true);
    });

    it('la forma "downsample" no se confunde con "downsampleTo16k" (mide la implementacion, 7.7.d)', () => {
        const soloDownsample = purpose.formas[0].re.test('function downsample(s, a, b) {');
        const noDownsampleTo = purpose.formas[0].re.test('function downsampleTo16k(s, a, b) {');
        expect(soloDownsample).toBe(true);
        expect(noDownsampleTo).toBe(false);
        expect(purpose.formas[1].re.test('function downsampleTo16k(s, a, b) {')).toBe(true);
    });
});
