/**
 * deadExportsGuard - no puede haber exportaciones MUERTAS en src/.
 *
 * QUE VIGILA: un simbolo exportado de `src/` cuya UNICA aparicion en todo el
 * repositorio (src + tests + configs de raiz + scripts) es su propia declaracion.
 * Eso no es "export sobrante" (cosmetico): es codigo que nadie importa, nadie llama
 * y nadie lee. Nacio en ROJO con 97 casos medidos con este mismo escaneo, y se puso
 * verde borrandolos.
 *
 * POR QUE ES UN ESCANEO Y NO UNA LISTA: una lista se queda vieja en cuanto entra
 * codigo nuevo; el escaneo atrapa la basura el mismo dia que se crea.
 *
 * DE DONDE MIRA (aprendido a golpes): si solo se mira `src/` y `tests/`, un simbolo
 * usado desde `vite.config.ts` (p. ej. createBrowserProxy) parece muerto y la guarda
 * pide borrar codigo VIVO. Por eso entran tambien configs de raiz, scripts y hooks.
 *
 * FAMILIAS INTROSPECTADAS (falsos positivos con motivo escrito): hay modulos cuyos
 * exports se consumen como DATO por introspeccion (`import.meta.glob`), asi que el
 * escaneo de texto no puede verlos. Hoy solo `src/core/games/**` (sus tablas
 * `*_FRAMES` las descubre `tests/systemMatrix.test.ts`). Borrarlas puso el contrato
 * de comandos del juego en rojo: se midio y se restauro.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const RAIZ = process.cwd();

/** Un par (ruta relativa, contenido) sobre el que se puede escanear. */
export interface FuenteTexto {
    archivo: string;
    texto: string;
}

/** Simbolos que se usan por cadena/ventana y por eso el escaneo no los ve. */
const EXCEPCIONES = new Map<string, string>([
    // DEUDA DECLARADA, no falso positivo: en el modulo de gemini queda UNA
    // exportacion muerta (mapChatMessagesToGemini) que hoy NO se puede borrar sin
    // romper dos reglas del propio repo: su trinquete de tamano (P6.6) exige apretar
    // el techo EN EL MISMO cambio y la atomicidad (0.22) prohibe que src y el guard
    // que lo mide viajen juntos. Se podra cuando el techo baje sin tocar src.
    ['mapChatMessagesToGemini', 'deuda: P6.6 exige apretar el techo y 0.22 lo prohibe en el mismo commit'],
]);

/** Familias cuyo exports se consumen por INTROSPECCION (ver cabecera). */
const FAMILIAS_INTROSPECTADAS: readonly string[] = ['src/core/games/'];

const PATRONES = [
    /^export\s+(?:async\s+)?function\s+(\w+)/gm,
    /^export\s+const\s+(\w+)/gm,
    /^export\s+let\s+(\w+)/gm,
    /^export\s+class\s+(\w+)/gm,
    /^export\s+interface\s+(\w+)/gm,
    /^export\s+type\s+(\w+)/gm,
    /^export\s+enum\s+(\w+)/gm,
];

const recorrer = (dir: string, out: string[] = []): string[] => {
    if (!existsSync(dir)) return out;
    for (const entrada of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entrada.name);
        if (entrada.isDirectory()) recorrer(p, out);
        else out.push(p);
    }
    return out;
};

/** Los textos que entran en el escaneo: src, tests, configs de raiz, scripts y hooks. */
export function fuentesDelRepo(raiz = RAIZ): FuenteTexto[] {
    const elegidos = [
        ...recorrer(join(raiz, 'src')).filter((f) => /\.(ts|tsx|js|jsx)$/.test(f) && !/\.d\.ts$/.test(f)),
        ...recorrer(join(raiz, 'tests')).filter((f) => /\.(ts|tsx)$/.test(f)),
        ...recorrer(join(raiz, 'scripts')).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)),
        ...recorrer(join(raiz, '.githooks')).filter((f) => /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(f)),
        ...[
            'vite.config.ts',
            'vitest.config.ts',
            'playwright.config.ts',
            'index.html',
            'package.json',
            'tsconfig.json',
            'eslint.config.mjs',
        ]
            .map((f) => join(raiz, f))
            .filter(existsSync),
    ];
    return elegidos.map((f) => ({ archivo: relative(raiz, f).replace(/\\/g, '/'), texto: readFileSync(f, 'utf8') }));
}

/** Nombres exportados por un texto. */
export function exportadosDe(texto: string): string[] {
    const nombres = new Set<string>();
    for (const patron of PATRONES) {
        for (const m of texto.matchAll(patron)) nombres.add(m[1]);
    }
    for (const m of texto.matchAll(/^export\s*\{([^}]+)\}/gm)) {
        for (const trozo of m[1].split(',')) {
            const nombre = trozo.split(/\s+as\s+/).pop()!.trim();
            if (/^\w+$/.test(nombre)) nombres.add(nombre);
        }
    }
    return [...nombres];
}

/** Escaneo puro (sin disco): recibe los textos y devuelve las exportaciones muertas. */
export function buscarMuertosEn(fuentes: readonly FuenteTexto[]): { archivo: string; nombre: string }[] {
    const esIntrospectada = (archivo: string) => FAMILIAS_INTROSPECTADAS.some((p) => archivo.startsWith(p));
    const muertos: { archivo: string; nombre: string }[] = [];
    for (const { archivo, texto } of fuentes) {
        if (!archivo.startsWith('src/') || esIntrospectada(archivo)) continue;
        for (const nombre of exportadosDe(texto)) {
            if (EXCEPCIONES.has(nombre)) continue;
            const re = new RegExp(`\\b${nombre}\\b`, 'g');
            let apariciones = 0;
            for (const otra of fuentes) apariciones += (otra.texto.match(re) || []).length;
            if (apariciones <= 1) muertos.push({ archivo, nombre });
        }
    }
    return muertos.sort((a, b) => a.archivo.localeCompare(b.archivo) || a.nombre.localeCompare(b.nombre));
}

describe('deadExportsGuard - exportaciones muertas', () => {
    it('ninguna exportacion de src/ se queda sin que nadie la use', () => {
        const muertos = buscarMuertosEn(fuentesDelRepo());

        expect(
            muertos.map((m) => `${m.archivo} :: ${m.nombre}`),
            `exportaciones muertas (borrar o justificar en EXCEPCIONES):\n${muertos
                .map((m) => `  ${m.archivo} :: ${m.nombre}`)
                .join('\n')}`,
        ).toEqual([]);
    });

    /**
     * PRUEBA DE DETECTOR (P2.4): el detector NO es decorativo. Se le alimenta una
     * entrada infractora SINTETICA y se comprueba que la marca; y una que SI se usa,
     * y se comprueba que no la marca. Sin esto, la guarda podria estar verde para
     * siempre sin proteger nada.
     */
    it('el detector no es decorativo: marca la entrada infractora y respeta la usada', () => {
        const infractora = buscarMuertosEn([
            { archivo: 'src/sintetico-a.ts', texto: 'export function simboloSinUso() { return 1 }\n' },
            { archivo: 'tests/sintetico.test.ts', texto: '// no lo usa nadie\n' },
        ]);
        expect(infractora).toEqual([{ archivo: 'src/sintetico-a.ts', nombre: 'simboloSinUso' }]);

        const usada = buscarMuertosEn([
            { archivo: 'src/sintetico-b.ts', texto: 'export function simboloUsado() { return 1 }\n' },
            { archivo: 'tests/sintetico.test.ts', texto: 'simboloUsado()\n' },
        ]);
        expect(usada).toEqual([]);

        // La familia introspectada no se marca aunque no aparezca en ningun texto.
        const introspectada = buscarMuertosEn([
            { archivo: 'src/core/games/sintetico.ts', texto: 'export const TABLA_FRAMES = Object.freeze({})\n' },
            { archivo: 'tests/otro.test.ts', texto: 'import.meta.glob("../src/core/games/*.ts")\n' },
        ]);
        expect(introspectada).toEqual([]);
    });
});
