// ============================================================
// workspaceVocabularyContract.test.ts
//
// LA CLASE DEL DEFECTO, no una instancia. El vocabulario del contrato workspace
// (tipos visuales y de generacion) estaba declarado a mano en seis sitios
// (sharedConfig, visualConfig, fluVisualPipeline, workspaceContract y dos en
// App). Coincidian por suerte; al anadir un tipo en uno solo, una via lo
// aceptaba y la otra no: divergencia silenciosa, la misma forma que el defecto
// de acciones[].dominio.
//
// Este guard vigila la CLASE, no los seis ficheros: escanea src/ buscando
// CUALQUIER re-declaracion literal de un rol del contrato. Cubre las dos formas
// en que se reintroduce: una lista literal y una union de tipos escrita a mano
// (una union tambien enumera el vocabulario).
//
// Criterio de deteccion: CONJUNTO EXACTO. Una enumeracion cuenta como copia
// solo si su conjunto de literales es identico al del rol. Co-ocurrir no basta:
// 'doc'/'video' aparecen en vocabularios distintos (kinds de UI, formatos de
// artefacto con 'pdf'), y marcarlos seria un falso positivo que empujaria a
// aflojar el guard en vez de arreglar el codigo.
//
// Ademas: los predicados de pertenencia viven en UN solo sitio y voz los
// DELEGA (identidad, no copia). Esa comprobacion es la que faltaba: cuando
// workspaceContract re-exporto sin importar, el cuerpo seguia llamando a un
// binding inexistente y `tsc` no lo vio porque los .js no se comprueban.
// ============================================================
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
    GENERATION_WORKSPACE_TIPOS,
    VALID_VISUAL_TIPOS,
    WORKSPACE_TIPOS,
    isGenerationWorkspaceTipo,
    isVisualWorkspaceTipo,
    isWorkspaceTipo,
} from '../src/core/config/sharedConfig';
import * as workspaceContract from '../src/voice/lib/workspaceContract.js';

const SRC_DIR = path.resolve(__dirname, '../src');

/** El unico modulo autorizado a enumerar el vocabulario. */
const MODULO_CANONICO = 'core/config/sharedConfig.ts';

/** Roles del contrato: cada uno es un vocabulario que no debe repetirse. */
const ROLES: Array<{ nombre: string; miembros: readonly string[] }> = [
    { nombre: 'visual', miembros: VALID_VISUAL_TIPOS },
    { nombre: 'generacion', miembros: GENERATION_WORKSPACE_TIPOS },
    { nombre: 'workspace', miembros: WORKSPACE_TIPOS },
];

function ficherosFuente(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...ficherosFuente(full));
        else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) out.push(full);
    }
    return out;
}

/** Literales citados dentro de un fragmento. */
function literalesDe(fragmento: string): string[] {
    const out: string[] = [];
    const re = /'([^'\n]*)'|"([^"\n]*)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(fragmento)) !== null) out.push(m[1] ?? m[2]);
    return out;
}

/** Clave canonica de un conjunto de literales (para comparar por igualdad). */
function clave(valores: readonly string[]): string {
    return [...new Set(valores)].sort().join('\u0000');
}

/** Indice de linea de una posicion. */
function lineaDe(texto: string, indice: number): number {
    return texto.slice(0, indice).split('\n').length;
}

/**
 * Enumeraciones del texto: listas literales `['a','b']` y uniones `'a' | 'b'`.
 * Devuelve el conjunto de literales de cada una (solo las de >= 2 miembros).
 */
function enumeraciones(texto: string): Array<{ valores: string[]; indice: number }> {
    const out: Array<{ valores: string[]; indice: number }> = [];
    let m: RegExpExecArray | null;

    const reArray = /\[([^[\]]{0,400})]/g;
    while ((m = reArray.exec(texto)) !== null) {
        const valores = literalesDe(m[1]);
        if (valores.length >= 2) out.push({ valores, indice: m.index });
    }

    const reUnion = /'[^'\n]{0,60}'(?:\s*\|\s*'[^'\n]{0,60}')+/g;
    while ((m = reUnion.exec(texto)) !== null) {
        const valores = literalesDe(m[0]);
        if (valores.length >= 2) out.push({ valores, indice: m.index });
    }

    return out;
}

/** Copias literales de algun rol del contrato, fuera del modulo canonico. */
function redeclaraciones(): string[] {
    const hallazgos: string[] = [];
    const rolesPorClave = new Map(ROLES.map((r) => [clave(r.miembros), r.nombre]));

    for (const fichero of ficherosFuente(SRC_DIR)) {
        const rel = path.relative(SRC_DIR, fichero).replace(/\\/g, '/');
        if (rel === MODULO_CANONICO) continue;
        const texto = fs.readFileSync(fichero, 'utf8');

        for (const { valores, indice } of enumeraciones(texto)) {
            const nombre = rolesPorClave.get(clave(valores));
            if (nombre) {
                hallazgos.push(
                    `${rel}:${lineaDe(texto, indice)} copia el vocabulario "${nombre}" ` +
                        `(${valores.join(', ')})`,
                );
            }
        }
    }
    return hallazgos;
}

describe('contrato workspace - el vocabulario vive en un solo sitio', () => {
    it('ningun modulo fuera del canonico re-declara el vocabulario (la clase del defecto)', () => {
        const hallazgos = redeclaraciones();
        expect(
            hallazgos,
            'enumeraste el vocabulario del contrato fuera del modulo canonico;\n' +
                'importa la lista y/o usa los predicados en vez de copiarla:\n  ' +
                hallazgos.join('\n  '),
        ).toEqual([]);
    });

    it('el detector distingue una copia de un vocabulario parecido (prueba de mutacion)', () => {
        const copia = enumeraciones(`const V = ['image_prompt', 'diagram', '3d'];`);
        expect(copia.map((e) => clave(e.valores))).toContain(clave(VALID_VISUAL_TIPOS));

        const union = enumeraciones(`type T = 'image_prompt' | 'diagram' | '3d';`);
        expect(union.map((e) => clave(e.valores))).toContain(clave(VALID_VISUAL_TIPOS));

        // Superconjunto: vocabulario DISTINTO, no debe marcarse como copia.
        const ajeno = enumeraciones(`const F = ['doc', 'video', 'pdf'];`);
        for (const e of ajeno) {
            expect(clave(e.valores)).not.toBe(clave(GENERATION_WORKSPACE_TIPOS));
        }

        // Referencia por import/predicado: no hay enumeracion.
        expect(enumeraciones(`const x = isVisualWorkspaceTipo(t);`)).toEqual([]);
    });

    it('los roles son subconjuntos del contrato y no se solapan', () => {
        const contrato = new Set<string>(WORKSPACE_TIPOS);
        for (const tipo of VALID_VISUAL_TIPOS) expect(contrato.has(tipo)).toBe(true);
        for (const tipo of GENERATION_WORKSPACE_TIPOS) expect(contrato.has(tipo)).toBe(true);
        for (const tipo of VALID_VISUAL_TIPOS) {
            expect(GENERATION_WORKSPACE_TIPOS as readonly string[]).not.toContain(tipo);
        }
    });

    it('la pertenencia vive en el nucleo y voz la DELEGA (misma funcion, no copia)', () => {
        // Identidad de funcion: si alguien reintroduce una lista local, esto falla.
        expect(workspaceContract.isVisualWorkspaceTipo).toBe(isVisualWorkspaceTipo);
        expect(workspaceContract.isGenerationWorkspaceTipo).toBe(isGenerationWorkspaceTipo);
    });

    it('los predicados aceptan exactamente su lista y nada mas', () => {
        for (const tipo of WORKSPACE_TIPOS) expect(isWorkspaceTipo(tipo)).toBe(true);
        for (const tipo of VALID_VISUAL_TIPOS) expect(isVisualWorkspaceTipo(tipo)).toBe(true);
        for (const tipo of GENERATION_WORKSPACE_TIPOS) {
            expect(isGenerationWorkspaceTipo(tipo)).toBe(true);
        }

        for (const ajeno of ['svg', 'gif', 'video_prompt', '', null, undefined]) {
            expect(isWorkspaceTipo(ajeno)).toBe(false);
            expect(isVisualWorkspaceTipo(ajeno)).toBe(false);
            expect(isGenerationWorkspaceTipo(ajeno)).toBe(false);
        }
    });

    it('las dos vias coinciden: la puerta de voz y la del servicio visual', () => {
        // La divergencia original habria hecho que una aceptase lo que la otra no.
        for (const tipo of WORKSPACE_TIPOS) {
            expect(workspaceContract.isVisualWorkspaceTipo(tipo)).toBe(
                isVisualWorkspaceTipo(tipo),
            );
        }
    });
});
