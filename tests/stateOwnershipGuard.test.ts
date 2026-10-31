/**
 * PROPIEDAD DEL ESTADO CRITICO — cuenta DUENOS, no parecidos.
 *
 * La auditoria de duplicacion del repo (V18 "mismo cuerpo con distinto nombre" y
 * D0 "simbolo exportado en >1 fichero") mide CLONES. Medido: no puede ver
 *   - listas compuestas `Object.freeze([...])` (su regex exige `=> {`);
 *   - solapes PARCIALES de tokens (agrupa por cuerpo IDENTICO);
 *   - escritores de UNA linea (los descarta por tamano);
 * y D0 exige colision de NOMBRE exportado, que un dict local no produce.
 * Por eso tres rutas duplicadas de DATO pasaron en verde.
 *
 * Este guard hace la pregunta que faltaba: por cada dato critico, CUANTOS
 * escritores y CUANTOS criterios hay. Un dato, un dueno.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const read = (p: string) => readFileSync(p, 'utf8');

function walk(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else acc.push(full);
    }
    return acc;
}

const srcFiles = () => walk(SRC).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f));

/** Coincidencias de un patron en un texto. */
export function countMatches(src: string, re: RegExp): number {
    return (src.match(re) || []).length;
}

/**
 * Tokens de la lista UNICA de afirmaciones, LEIDOS de su dueno (no re-enumerados
 * aqui: re-enumerarlos seria la misma copia que el guard persigue).
 */
export function bareAffirmationTokens(ownerSrc: string): string[] {
    const block = ownerSrc.match(/BARE_AFFIRMATION_FRAMES[^=]*=\s*Object\.freeze\(\[([\s\S]*?)\]\)/);
    return block ? (block[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)) : [];
}

/**
 * Ficheros que re-enumeran el CONJUNTO COMPLETO de afirmaciones. Un motor puede
 * compartir 1-4 tokens con la lista por coincidencia lexica (son conjuntos
 * distintos); lo que no puede es volver a escribir el conjunto entero.
 */
export function reEnumeratingSources(sources: Record<string, string>, tokens: string[]): string[] {
    if (!tokens.length) return [];
    return Object.entries(sources)
        .filter(([name]) => !name.endsWith('gameUtils.ts'))
        .filter(([, src]) => tokens.every((t) => src.includes(`'${t}'`)))
        .map(([name]) => name);
}

const srcSources = () =>
    Object.fromEntries(srcFiles().map((f) => [f.replace(/\\/g, '/'), read(f)]));
const rel = (f: string) => f.replace(/\\/g, '/').replace(`${SRC.replace(/\\/g, '/')}/`, '');

/**
 * Ficheros que este guard lee, declarados por RUTA COMPLETA a proposito: el
 * criterio 0.24 (`readersOf`) descubre a los lectores por el literal de la ruta,
 * y un guard que lee todo `src/` con `walk()` seria invisible para el.
 */
const READ_TARGETS = [
    'src/core/games/gameUtils.ts',
    'src/core/games/loteria.ts',
    'src/voice/compose/conversationMotorProducto.js',
] as const;

describe('un dato, un dueno — identificadores y afirmaciones', () => {
    it('el ID del turno se acuna en UN solo sitio (nace al abrir el turno)', () => {
        // El corte de la tuberia vieja (2026-10-25) movio el acunado al hook: alli
        // nace el turno cuando el modulo commitea una locucion nueva. Sigue siendo UN
        // solo sitio; el modulo no lleva contador propio.
        const mint = srcFiles().filter((f) => countMatches(read(f), /activeTurnIdRef\.current\s*\+=/) > 0);
        expect(mint.map(rel)).toEqual(['voice/hooks/useFluVoiceAssistant.js']);
    });

    it('no existe un segundo contador de turno (identidad unica)', () => {
        const con = srcFiles().filter((f) => read(f).includes('turnCommitIdRef')).map(rel);
        expect(con).toEqual([]);
    });

    it('la fila del usuario decide por UN criterio (sin rama posicional)', () => {
        // Corte 2026-10-30 (problema 6): el escritor pasivo (pasivo.ts) se retiró con
        // la ruta doble. El ÚNICO escritor de la fila de usuario es el compositor del
        // módulo (conversationMotorProducto.js): identidad por locutionId, sin gate
        // por turno de la fila ni relaciones difusas de frases ni rama posicional.
        const row = read(join(ROOT, 'src/voice/compose/conversationMotorProducto.js'));
        expect(row.includes('phrasesRelate')).toBe(false);
        expect(/\.turnId\s*[=!]==?/.test(row)).toBe(false);
        expect(row.includes('id: evento.fila.locutionId')).toBe(true);
    });

    it('ningun motor re-enumera el conjunto completo de afirmaciones', () => {
        const tokens = bareAffirmationTokens(read(join(ROOT, 'src/core/games/gameUtils.ts')));
        expect(tokens.length).toBeGreaterThan(10);
        expect(reEnumeratingSources(srcSources(), tokens)).toEqual([]);
    });

    it('ningun fuente escribe a mano el primario de sesion (dueno unico)', () => {
        const con = srcFiles()
            .filter((f) => countMatches(read(f), /sessionPrimarySpeakerRef\.current\s*=/) > 0)
            .map(rel);
        expect(con).toEqual([]);
    });

    it('los ficheros declarados existen y se leen (el guard no miente)', () => {
        for (const t of READ_TARGETS) expect(read(join(ROOT, t)).length).toBeGreaterThan(0);
    });
});

// P2.4 — prueba de detector: alimentado el infractor sintetico, la marca.
describe('propiedad - el detector no es decorativo', () => {
    it('marca el motor que re-enumera el conjunto y no al que compone', () => {
        const tokens = ['si', 'dale', 'vale'];
        expect(
            reEnumeratingSources({ 'games/loteria.ts': "['si', 'dale', 'vale']" }, tokens),
        ).toEqual(['games/loteria.ts']);
        expect(
            reEnumeratingSources(
                { 'games/loteria.ts': "[...OWN_ORDERS, ...BARE_AFFIRMATION_FRAMES]" },
                tokens,
            ),
        ).toEqual([]);
    });

    it('cuenta escritores reales y no menciona falsos positivos', () => {
        expect(countMatches('activeTurnIdRef.current += 1', /activeTurnIdRef\.current\s*\+=/)).toBe(1);
        expect(countMatches('turnCommitIdRef.current += 1', /activeTurnIdRef\.current\s*\+=/)).toBe(0);
        expect(countMatches('sessionPrimarySpeakerRef.current = name', /sessionPrimarySpeakerRef\.current\s*=/)).toBe(1);
        expect(countMatches('getSessionPrimary: () => sessionPrimarySpeakerRef.current || ""', /sessionPrimarySpeakerRef\.current\s*=/)).toBe(0);
    });

    it('lee los tokens de su dueno y no los re-enumera', () => {
        const tokens = bareAffirmationTokens("export const BARE_AFFIRMATION_FRAMES: readonly string[] = Object.freeze([\n    'si', 'dale',\n]);");
        expect(tokens).toEqual(['si', 'dale']);
    });

    it('detecta un gate por turno de fila y perdona la proyeccion y el proveedor', () => {
        const gate = /\.turnId\s*[=!]==?/;
        expect(gate.test('if (evento.fila.turnId === ultimo) return')).toBe(true);
        expect(gate.test('turnId: evento.fila.turnId,')).toBe(false);
        expect(gate.test("turnId: () => (typeof turnId === 'function' ? turnId() : null)")).toBe(false);
    });
});
