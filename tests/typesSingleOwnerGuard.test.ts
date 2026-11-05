/**
 * typesSingleOwnerGuard — UN solo dueno por tipo del vocabulario de dominio.
 *
 * Defecto medido (auditoria de codigo, 2026-10-02): el mismo tipo estaba declarado
 * dos veces, con tres consecuencias distintas:
 *   - IDENTICOS (duplicacion pura): `AgendaFireAction` (agendaMotor vs useAgenda),
 *     `DndSchedule` (dndPolicy vs useDoNotDisturb) y `NewShoppingItemInput`
 *     (shoppingList vs shoppingService).
 *   - DIVERGENTES (peor): `NewNoteInput` en notesList NO tenia `body` y en
 *     notesService SI: el contrato de la lista era mas estrecho que el servicio.
 *   - COLISION DE NOMBRE (un nombre, dos cosas): `ParticipantConfig` (registro de
 *     participantes vs config de evaluacion del participante) y `RegisterResult`
 *     (union generica del catalogo vs resultado del registro de participantes).
 *   AGENTS.md 4: "una etiqueta, un sitio".
 *
 * El guard pregunta DOS cosas:
 *   1) TEXTO: cuantas DECLARACIONES hay por familia (debe ser EXACTAMENTE 1).
 *      Se recorre TODO `src` (no una lista a mano): una copia en un fichero fuera
 *      de la lista pasaria el guard sin ser vista.
 *   2) COMPORTAMIENTO: la forma que el consumidor construye de verdad (el input de
 *      nota con `body`, el horario de No Molestar, las acciones de agenda). Para un
 *      invariante de TIPOS el juez de compilacion es `tsc` (pre-commit y CI) y los
 *      tests de conducta de los consumidores, que ya estan en el gate.
 *
 * Prueba de DETECTOR real (0.24): se alimenta una copia sintetica y una familia
 * perdida, y se comprueba que el detector las marca; si el guard siguiera verde
 * seria teatro.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AgendaFireAction } from '../src/core/agenda/agendaMotor';
import type { DndSchedule } from '../src/core/dnd/dndPolicy';
import type { NewNoteInput } from '../src/core/notes/notesList';

/** Familias de nombres que deben resolver a UNA declaracion (dueno unico). */
const TYPE_FAMILIES: readonly (readonly string[])[] = [
    ['AgendaFireAction'],
    ['DndSchedule'],
    ['NewShoppingItemInput'],
    ['NewNoteInput'],
    ['ParticipantConfig'],
    ['ParticipantEvaluationConfig'],
    ['RegisterResult'],
    ['ParticipantRegisterResult'],
];

export interface SourceFile {
    file: string;
    source: string;
}

const DECL_RE = (name: string) => new RegExp(`^(?:export\\s+)?(?:interface|type)\\s+${name}\\b`);

/** Sitios de declaracion por familia: `archivo:linea`. */
export function findTypeSites(sources: ReadonlyArray<SourceFile>): Record<string, string[]> {
    const sites: Record<string, string[]> = {};
    for (const { file, source } of sources) {
        source.split('\n').forEach((line, index) => {
            for (const family of TYPE_FAMILIES) {
                for (const name of family) {
                    if (DECL_RE(name).test(line)) {
                        sites[family[0]] = sites[family[0]] || [];
                        sites[family[0]].push(`${file}:${index + 1} (${name})`);
                    }
                }
            }
        });
    }
    return sites;
}

/** Familias cuyo numero de declaraciones no es exactamente 1. */
export function findDuplicatedTypes(sources: ReadonlyArray<SourceFile>): string[] {
    const sites = findTypeSites(sources);
    return TYPE_FAMILIES.map((f) => f[0])
        .filter((key) => (sites[key] || []).length !== 1)
        .map((key) => `${key} (${(sites[key] || []).length}): ${(sites[key] || []).join(', ') || '(ninguna)'}`);
}

function domainSources(): SourceFile[] {
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
            const rel = `${dir}/${entry.name}`;
            if (entry.isDirectory()) walk(rel);
            else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) files.push(rel);
        }
    };
    walk('src');
    return files.map((file) => ({ file, source: readFileSync(join(process.cwd(), file), 'utf8') }));
}

describe('typesSingleOwnerGuard — un dueno por tipo del vocabulario', () => {
    it('cada tipo del vocabulario esta declarado en un solo sitio', () => {
        const bad = findDuplicatedTypes(domainSources());
        expect(bad, `Tipos sin dueno unico (archivo:linea):\n  ${bad.join('\n  ')}`).toEqual([]);
    });

    it('PRUEBA DE DETECTOR: la copia se marca', () => {
        const synthetic: SourceFile[] = [
            { file: 'src/a.ts', source: 'export interface DndSchedule {\n  start: string;\n}' },
            { file: 'src/b.ts', source: 'export interface DndSchedule {\n  start: string;\n}' },
        ];
        expect(findDuplicatedTypes(synthetic).join('\n')).toContain('DndSchedule (2)');
    });

    it('PRUEBA DE DETECTOR: la familia perdida se marca (anti-vacuidad)', () => {
        const vacio: SourceFile[] = [{ file: 'src/a.ts', source: 'export const x = 1;' }];
        const bad = findDuplicatedTypes(vacio);
        expect(bad.length).toBe(TYPE_FAMILIES.length);
        expect(bad.join('\n')).toContain('(ninguna)');
    });

    it('el codigo limpio no se marca', () => {
        const clean: SourceFile[] = TYPE_FAMILIES.map((f) => ({
            file: `src/${f[0]}.ts`,
            source: `export interface ${f[0]} {\n  x: string;\n}`,
        }));
        expect(findDuplicatedTypes(clean)).toEqual([]);
    });

    it('COMPORTAMIENTO: el input de nota del dueno unico acepta body (la copia estrecha no lo tenia)', () => {
        const input: NewNoteInput = { label: 'Lista', body: 'un item por linea' };
        expect(input.body).toBe('un item por linea');
        const sinBody: NewNoteInput = { label: 'Solo titulo' };
        expect(sinBody.body).toBeUndefined();
    });

    it('COMPORTAMIENTO: el horario de No Molestar del dueno unico es {start,end}', () => {
        const schedule: DndSchedule = { start: '22:00', end: '07:00' };
        expect(Object.keys(schedule).sort()).toEqual(['end', 'start']);
    });

    it('COMPORTAMIENTO: la accion de agenda del dueno unico cubre las 3 acciones del dominio', () => {
        const acciones: AgendaFireAction[] = ['sonar', 'avisar', 'marcar'];
        expect(acciones).toHaveLength(3);
    });
});
