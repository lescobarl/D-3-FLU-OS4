// ============================================================
// analysisFallbacks.test.ts — respaldos heurísticos compartidos (F1/F2)
// ============================================================
// Cubre: buildBaseDocumentContract (contrato base del parser) y
// buildHeuristicAppAnalysis (contrato heurístico de apps sin LLM).
// ============================================================

import { describe, test, expect } from 'vitest';
import { buildBaseDocumentContract, buildHeuristicAppAnalysis } from '../src/lib/analysisFallbacks';
import type { DocumentAnalysisInput, AppAnalysisInput } from '../src/core/ai/IAIService';

describe('analysisFallbacks — buildBaseDocumentContract', () => {
    test('construye el contrato completo desde el payload', () => {
        const payload: DocumentAnalysisInput = {
            tipo: 'xlsx',
            mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            nombre: 'libro.xlsx',
            hojas: [{ nombre: 'A', rol: 'input', celdas: 1, errores: [] }],
            errores: ['#REF!'],
            chunks: ['abc'],
            rawText: 'abc',
            resumen_heuristico: 'Resumen heurístico',
            qa_context: 'contexto QA',
        };
        const contract = buildBaseDocumentContract(payload);
        expect(contract.tipo).toBe('xlsx');
        expect(contract.mime).toBe(payload.mime);
        expect(contract.nombre).toBe('libro.xlsx');
        expect(contract.tamaño).toBe(3); // rawText.length
        expect(contract.hojas?.[0].rol).toBe('input');
        expect(contract.errores).toEqual(['#REF!']);
        expect(contract.resumen).toBe('Resumen heurístico');
        expect(contract.puntos_clave).toEqual([]);
        expect(contract.qa_context).toBe('contexto QA');
    });

    test('payload vacío produce valores por defecto', () => {
        const contract = buildBaseDocumentContract({} as DocumentAnalysisInput);
        expect(contract.tipo).toBe('text');
        expect(contract.mime).toBe('text/plain');
        expect(contract.nombre).toBe('documento');
        expect(contract.tamaño).toBe(0);
        expect(contract.hojas).toBeUndefined();
        expect(contract.errores).toEqual([]);
        expect(contract.resumen).toBe('');
        expect(contract.puntos_clave).toEqual([]);
        expect(contract.qa_context).toBe('');
    });
});

describe('analysisFallbacks — buildHeuristicAppAnalysis', () => {
    test('construye pantallas y flujos desde los archivos', () => {
        const payload: AppAnalysisInput = {
            proyecto: 'Mi App',
            framework: 'react',
            estructura: 'Framework detectado: react',
            archivos: ['src/Home.tsx', 'src/Settings.tsx', 'src/Profile.tsx'],
            errores_detectados: ['src/Home.tsx:1: TODO'],
        };
        const contract = buildHeuristicAppAnalysis(payload);
        expect(contract.proyecto).toBe('Mi App');
        expect(contract.framework).toBe('react');
        expect(contract.pantallas).toHaveLength(3);
        expect(contract.pantallas[0].id).toBe('screen-1');
        expect(contract.pantallas[0].nombre).toBe('Home.tsx');
        expect(contract.pantallas[0].proposito).toContain('Pantalla detectada');
        expect(contract.pantallas[0].entradas).toEqual([]);
        expect(contract.pantallas[0].acciones).toEqual([]);
        expect(contract.pantallas[0].salidas).toEqual([]);
        expect(contract.flujos[0].nombre).toBe('Recorrido estático');
        expect(contract.flujos[0].pasos).toEqual(['Ver Home.tsx', 'Ver Settings.tsx', 'Ver Profile.tsx']);
        expect(contract.errores_detectados).toEqual(['src/Home.tsx:1: TODO']);
    });

    test('limita el número de pantallas a 12', () => {
        const archivos = Array.from({ length: 15 }, (_, i) => `src/Screen${i}.tsx`);
        const contract = buildHeuristicAppAnalysis({
            archivos,
            framework: 'other',
        } as AppAnalysisInput);
        expect(contract.pantallas).toHaveLength(12);
    });

    test('payload vacío produce valores por defecto', () => {
        const contract = buildHeuristicAppAnalysis({} as AppAnalysisInput);
        expect(contract.proyecto).toBe('Proyecto');
        expect(contract.framework).toBe('other');
        expect(contract.pantallas).toEqual([]);
        expect(contract.flujos[0].pasos).toEqual(['Explorar estructura']);
        expect(contract.errores_detectados).toEqual([]);
    });
});
