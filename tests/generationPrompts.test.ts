// ============================================================
// generationPrompts.test.ts — pruebas de prompts de generación (F3/F4)
// ============================================================
// Cubre: prompt de sistema, prompt de usuario (fuentes/parámetros/
// instrucción por formato/idioma) y el contenido de respaldo sin IA
// para cada formato (xlsx/csv/json/ics/pptx/md).
// ============================================================

import { describe, test, expect } from 'vitest';
import {
    buildGenerationSystemPrompt,
    buildGenerationPrompt,
    buildGenerationFallbackContent,
} from '../src/lib/generationPrompts';
import type { GenerationInput } from '../src/core/ai/IAIService';

const basePayload: GenerationInput = {
    formato: 'md',
    parametros: { tema: 'Reporte mensual', calidad: 'alta' },
    fuentes: [{ tipo: 'documento', ref: 'libro.xlsx' }],
};

describe('generationPrompts — buildGenerationSystemPrompt', () => {
    test('español', () => {
        expect(buildGenerationSystemPrompt('es')).toContain('asistente de generación de documentos');
    });

    test('inglés', () => {
        expect(buildGenerationSystemPrompt('en')).toContain('document-generation assistant');
    });
});

describe('generationPrompts — buildGenerationPrompt', () => {
    test('incluye formato, fuentes y parámetros', () => {
        const prompt = buildGenerationPrompt(basePayload, 'es');
        expect(prompt).toContain('formato "md"');
        expect(prompt).toContain('1. [documento] libro.xlsx');
        expect(prompt).toContain('Tema: Reporte mensual');
        expect(prompt).toContain('Calidad: alta');
        expect(prompt).toContain('Responde únicamente en español.');
        expect(prompt).toContain('Devuelve el contenido como markdown estructurado y ejecutivo.');
    });

    test('enumera múltiples fuentes', () => {
        const payload: GenerationInput = {
            ...basePayload,
            fuentes: [
                { tipo: 'documento', ref: 'libro.xlsx' },
                { tipo: 'conversacion', ref: 'minuta 12' },
            ],
        };
        const prompt = buildGenerationPrompt(payload, 'es');
        expect(prompt).toContain('1. [documento] libro.xlsx');
        expect(prompt).toContain('2. [conversacion] minuta 12');
    });

    test('parámetros de duración y orientación', () => {
        const payload: GenerationInput = {
            formato: 'video',
            parametros: { duracion_min: 2, orientacion: 'vertical' },
            fuentes: [],
        };
        const prompt = buildGenerationPrompt(payload, 'es');
        expect(prompt).toContain('Duración objetivo: 2 min');
        expect(prompt).toContain('Orientación: vertical');
        expect(prompt).toContain('Escena');
    });

    test('instrucción de formato csv usa punto y coma', () => {
        const prompt = buildGenerationPrompt({ ...basePayload, formato: 'csv' }, 'es');
        expect(prompt).toContain('punto y coma');
    });

    test('instrucción de formato xlsx menciona sheets', () => {
        const prompt = buildGenerationPrompt({ ...basePayload, formato: 'xlsx' }, 'es');
        expect(prompt).toContain('sheets');
    });

    test('instrucción de formato ics menciona VCALENDAR', () => {
        const prompt = buildGenerationPrompt({ ...basePayload, formato: 'ics' }, 'es');
        expect(prompt).toContain('VCALENDAR');
    });

    test('sin fuentes ni parámetros produce valores por defecto', () => {
        const prompt = buildGenerationPrompt({ formato: 'md', parametros: {}, fuentes: [] }, 'es');
        expect(prompt).toContain('Ninguna fuente explícita');
        expect(prompt).toContain('Sin parámetros adicionales');
    });

    test('idioma inglés', () => {
        const prompt = buildGenerationPrompt(basePayload, 'en');
        expect(prompt).toContain('Respond in English only.');
    });
});

describe('generationPrompts — buildGenerationFallbackContent', () => {
    test('xlsx devuelve JSON con sheets', () => {
        const content = buildGenerationFallbackContent({ ...basePayload, formato: 'xlsx' }, 'es');
        const parsed = JSON.parse(content);
        expect(parsed.sheets[0].rows[0]).toEqual(['Sección', 'Detalle']);
        expect(parsed.sheets[0].rows[1]).toEqual(['Tema', 'Reporte mensual']);
        expect(parsed.notas).toContain('respaldo sin conexión');
    });

    test('csv usa separador de punto y coma', () => {
        const content = buildGenerationFallbackContent({ ...basePayload, formato: 'csv' }, 'es');
        expect(content).toContain('Sección;Detalle');
        expect(content).toContain('Tema;Reporte mensual');
    });

    test('json devuelve objeto parseable', () => {
        const content = buildGenerationFallbackContent({ ...basePayload, formato: 'json' }, 'es');
        const parsed = JSON.parse(content);
        expect(parsed.tema).toBe('Reporte mensual');
        expect(parsed.formato).toBe('json');
    });

    test('ics es un calendario válido con SUMMARY del tema', () => {
        const content = buildGenerationFallbackContent({ ...basePayload, formato: 'ics' }, 'es');
        expect(content).toContain('BEGIN:VCALENDAR');
        expect(content).toContain('BEGIN:VEVENT');
        expect(content).toContain('SUMMARY:Reporte mensual');
        expect(content).toContain('END:VCALENDAR');
    });

    test('pptx es markdown de diapositivas', () => {
        const content = buildGenerationFallbackContent({ ...basePayload, formato: 'pptx' }, 'es');
        expect(content.startsWith('# Reporte mensual')).toBe(true);
        expect(content).toContain('## Contexto');
        expect(content).toContain('libro.xlsx');
    });

    test('md incluye resumen y fuentes', () => {
        const content = buildGenerationFallbackContent(basePayload, 'es');
        expect(content.startsWith('# Reporte mensual')).toBe(true);
        expect(content).toContain('## Resumen');
        expect(content).toContain('libro.xlsx');
        expect(content).toContain('respaldo sin conexión');
    });
});
