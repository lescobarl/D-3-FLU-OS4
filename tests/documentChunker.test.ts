// ============================================================
// documentChunker.test.ts — pruebas del pipeline map-reduce (F1)
// ============================================================
// Cubre: construcción de prompts (map/reduce/single), fusión de
// lecturas parciales (mergePartialSummaries), aplicación del
// resultado al contrato y límites centralizados.
// ============================================================

import { describe, test, expect } from 'vitest';
import {
    buildMapPrompt,
    buildReducePrompt,
    buildSingleAnalysisPrompt,
    mergePartialSummaries,
    applyReduceToContract,
    getDocumentAnalysisLimits,
} from '../src/lib/documentChunker';
import type { ChunkContext, PartialSummary } from '../src/lib/documentChunker';
import type { DocumentContract } from '../src/types/documentContracts';

const ctx: ChunkContext = {
    tipo: 'xlsx',
    nombre: 'libro.xlsx',
    hojas: [{ nombre: 'Datos', rol: 'input', celdas: 10, errores: [] }],
    errores: ['#REF!'],
};

const partials: Array<PartialSummary & { indice: number }> = [
    { indice: 1, resumen: 'Primer fragmento describe los ingresos.', puntos_clave: ['Punto A', 'Punto B'] },
    { indice: 2, resumen: 'Segundo fragmento detalla los egresos.', puntos_clave: ['punto b', 'Punto C'] },
];

describe('documentChunker — buildMapPrompt', () => {
    test('incluye el bloque de contexto del documento', () => {
        const prompt = buildMapPrompt('contenido', 1, 3, ctx);
        expect(prompt).toContain('Tipo de documento: xlsx');
        expect(prompt).toContain('Nombre del archivo: libro.xlsx');
        expect(prompt).toContain('Estructura: "Datos" (input, 10 celdas)');
        expect(prompt).toContain('Errores de fórmula detectados: #REF!');
    });

    test('indica el fragmento y la instrucción de idioma (es)', () => {
        const prompt = buildMapPrompt('contenido', 1, 3, ctx, 'es');
        expect(prompt).toContain('Fragmento 1/3');
        expect(prompt).toContain('Responde únicamente en español.');
        expect(prompt).toContain('"puntos_clave"');
    });

    test('instrucción de idioma en inglés', () => {
        const prompt = buildMapPrompt('content', 1, 2, ctx, 'en');
        expect(prompt).toContain('Respond in English only.');
    });
});

describe('documentChunker — buildReducePrompt', () => {
    test('serializa las lecturas parciales y pide consolidación', () => {
        const prompt = buildReducePrompt(partials, ctx);
        expect(prompt).toContain('--- Fragmento 1 ---');
        expect(prompt).toContain('Resumen: Primer fragmento describe los ingresos.');
        expect(prompt).toContain('Puntos: Punto A | Punto B');
        expect(prompt).toContain('escenarios');
        expect(prompt).toContain('Responde únicamente en español.');
    });
});

describe('documentChunker — buildSingleAnalysisPrompt', () => {
    test('incluye el texto completo y el formato de respuesta', () => {
        const prompt = buildSingleAnalysisPrompt('texto completo del documento', ctx);
        expect(prompt).toContain('Texto extraído completo del documento:');
        expect(prompt).toContain('texto completo del documento');
        expect(prompt).toContain('escenarios');
        expect(prompt).toContain('Responde únicamente en español.');
    });
});

describe('documentChunker — mergePartialSummaries', () => {
    test('une resúmenes y deduplica puntos clave (case-insensitive)', () => {
        const merged = mergePartialSummaries(partials);
        expect(merged.resumen).toBe(
            'Primer fragmento describe los ingresos. Segundo fragmento detalla los egresos.'
        );
        expect(merged.puntos_clave).toEqual(['Punto A', 'Punto B', 'Punto C']);
        expect(merged.escenarios).toEqual([]);
    });

    test('respeta el máximo de puntos clave', () => {
        const merged = mergePartialSummaries(partials, 2);
        expect(merged.puntos_clave).toEqual(['Punto A', 'Punto B']);
    });

    test('con lecturas vacías devuelve valores por defecto', () => {
        const merged = mergePartialSummaries([]);
        expect(merged.resumen).toBe('');
        expect(merged.puntos_clave).toEqual([]);
    });
});

describe('documentChunker — applyReduceToContract', () => {
    const base: DocumentContract = {
        tipo: 'text',
        mime: 'text/plain',
        nombre: 'doc.txt',
        tamaño: 5,
        errores: [],
        resumen: 'Resumen base',
        puntos_clave: ['Clave base'],
        qa_context: 'qa',
    };

    test('aplica el resultado de la fase reduce', () => {
        const contract = applyReduceToContract(base, {
            resumen: 'Resumen reducido',
            puntos_clave: ['Clave 1'],
            escenarios: [{ nombre: 'E1', descripcion: 'd' }],
        });
        expect(contract.resumen).toBe('Resumen reducido');
        expect(contract.puntos_clave).toEqual(['Clave 1']);
        expect(contract.escenarios).toEqual([{ nombre: 'E1', descripcion: 'd' }]);
    });

    test('conserva los valores base cuando el reduce está vacío', () => {
        const contract = applyReduceToContract(base, { resumen: '', puntos_clave: [] });
        expect(contract.resumen).toBe('Resumen base');
        expect(contract.puntos_clave).toEqual(['Clave base']);
    });

    test('conserva los escenarios base si el reduce no trae', () => {
        const withScenarios: DocumentContract = {
            ...base,
            escenarios: [{ nombre: 'Base', descripcion: 'x' }],
        };
        const contract = applyReduceToContract(withScenarios, {
            resumen: 'Nuevo',
            puntos_clave: ['K'],
        });
        expect(contract.escenarios).toEqual([{ nombre: 'Base', descripcion: 'x' }]);
    });
});

describe('documentChunker — getDocumentAnalysisLimits', () => {
    test('devuelve un tope de chunks positivo', () => {
        const limits = getDocumentAnalysisLimits();
        expect(limits.maxChunks).toBeGreaterThan(0);
    });
});
