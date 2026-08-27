// ============================================================
// Tests para src/lib/minuteKnowledgeHelpers.ts
// Validan que las funciones nuevas igualan el comportamiento
// esperado para que FLU responda sobre minutas guardadas.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    parseMinuteHistoryCode,
    parseMinuteSequenceFromQuery,
    findMinuteRecordBySequence,
    buildMinuteKnowledgeBase2,
    buildMinuteLookupContract,
    resolveMinuteQuery,
    selectMinuteForLookup,
} from '../src/lib/minuteKnowledgeHelpers';

describe('minuteKnowledgeHelpers — parseMinuteHistoryCode', () => {
    it('extrae date + sequence de un historyCode OS2 (YYMMDD-NN)', () => {
        expect(parseMinuteHistoryCode('260713-01')).toEqual({ date: '260713', sequence: 1 });
        expect(parseMinuteHistoryCode('260630-02')).toEqual({ date: '260630', sequence: 2 });
        expect(parseMinuteHistoryCode('260101-10')).toEqual({ date: '260101', sequence: 10 });
    });

    it('maneja historyCode inválido', () => {
        expect(parseMinuteHistoryCode('')).toEqual({ date: '', sequence: 0 });
        expect(parseMinuteHistoryCode('foo')).toEqual({ date: 'foo', sequence: 0 });
    });
});

describe('minuteKnowledgeHelpers — parseMinuteSequenceFromQuery', () => {
    it('detecta números en español: "minuta uno"', () => {
        expect(parseMinuteSequenceFromQuery('dame el resumen de la minuta uno')).toBe(1);
    });

    it('detecta números en español: "minuta dos"', () => {
        expect(parseMinuteSequenceFromQuery('la minuta dos por favor')).toBe(2);
    });

    it('detecta número arábigo: "minuta 4"', () => {
        expect(parseMinuteSequenceFromQuery('lee la minuta 4')).toBe(4);
    });

    it('detecta "minute 3" en inglés', () => {
        expect(parseMinuteSequenceFromQuery('show me minute three')).toBe(3);
    });

    it('detecta "minuta numero cinco"', () => {
        expect(parseMinuteSequenceFromQuery('dame la minuta numero cinco')).toBe(5);
    });

    it('retorna null cuando no hay número de minuta', () => {
        expect(parseMinuteSequenceFromQuery('hola, ¿qué tal?')).toBe(null);
        expect(parseMinuteSequenceFromQuery('genera un resumen')).toBe(null);
    });
});

describe('minuteKnowledgeHelpers — findMinuteRecordBySequence', () => {
    const records = [
        { id: 'a', historyCode: '260713-01', description: 'Resumen de competencia de jonrones' },
        { id: 'b', historyCode: '260630-02', description: 'Otra minuta' },
        { id: 'c', historyCode: '260630-01', description: 'Duplicado de secuencia 1' },
    ];

    it('encuentra la minuta por sequence=1 (260713-01)', () => {
        const found = findMinuteRecordBySequence(records, 1);
        expect(found?.id).toBe('a');
    });

    it('encuentra la minuta por sequence=2', () => {
        const found = findMinuteRecordBySequence(records, 2);
        expect(found?.id).toBe('b');
    });

    it('cuando hay varios con la misma secuencia, retorna el más reciente (lexicográficamente mayor)', () => {
        // Hay dos con sequence=1: 260630-01 y 260713-01 → debe ganar 260713-01
        const found = findMinuteRecordBySequence(records, 1);
        expect(found?.historyCode).toBe('260713-01');
    });

    it('retorna null si la secuencia no existe', () => {
        expect(findMinuteRecordBySequence(records, 99)).toBe(null);
        expect(findMinuteRecordBySequence(records, 0)).toBe(null);
        expect(findMinuteRecordBySequence([], 1)).toBe(null);
    });
});

describe('minuteKnowledgeHelpers — buildMinuteKnowledgeBase2', () => {
    const records = [
        {
            id: 'a',
            historyCode: '260713-01',
            description: 'Resumen de competencia de jonrones',
            summarySnapshot: {
                titulo: 'Resumen de competencia de jonrones',
                participantes: ['Ana', 'Beto'],
                resumen: 'Sesión sobre el récord de jonrones en MLB 2026.',
                acuerdos: ['Analizar estadísticas de 2026', 'Revisar a los pitchers'],
                pendientes: ['Comparar con 2025'],
                siguientes_pasos: ['Preparar dashboard'],
                tema_sesion: 'Béisbol',
            },
        },
    ];

    it('genera KB2 con header [Minuta N · YYMMDD-NN] y secciones formateadas', () => {
        const kb = buildMinuteKnowledgeBase2(records);
        expect(kb).toContain('[Minuta 1 · 260713-01] Resumen de competencia de jonrones');
        expect(kb).toContain('Titulo: Resumen de competencia de jonrones');
        expect(kb).toContain('Resumen: Sesión sobre el récord de jonrones en MLB 2026.');
        expect(kb).toContain('Participantes: Ana, Beto');
        expect(kb).toContain('Acuerdos: Analizar estadísticas de 2026 | Revisar a los pitchers');
    });

    it('retorna string vacío cuando no hay minutas', () => {
        expect(buildMinuteKnowledgeBase2([])).toBe('');
        expect(buildMinuteKnowledgeBase2(null as any)).toBe('');
        expect(buildMinuteKnowledgeBase2(undefined as any)).toBe('');
    });
});

describe('minuteKnowledgeHelpers — buildMinuteLookupContract', () => {
    const record = {
        id: 'a',
        historyCode: '260713-01',
        description: 'Resumen de competencia de jonrones',
        summarySnapshot: {
            titulo: 'Resumen de competencia de jonrones',
            participantes: ['Ana', 'Beto'],
            resumen: 'Sesión sobre el récord de jonrones en MLB 2026.',
            acuerdos: ['Analizar estadísticas de 2026'],
            pendientes: ['Comparar con 2025'],
            siguientes_pasos: ['Preparar dashboard'],
            tema_sesion: 'Béisbol',
        },
    };

    it('construye respuesta_voz con datos de la minuta cuando la encuentra', () => {
        const contract = buildMinuteLookupContract({
            sequence: 1,
            record,
            records: [record],
            language: 'es',
        });
        expect(contract.respuesta_voz).toContain('La minuta 1');
        expect(contract.respuesta_voz).toContain('Resumen de competencia de jonrones');
        expect(contract.respuesta_voz).toContain('Sesión sobre el récord de jonrones');
        expect(contract.respuesta_voz).toContain('Acuerdos:');
        expect(contract.navegacion.comando).toBe(null);
        expect(contract.workspace.tipo).toBe('text');
        expect(contract.workspace.titulo).toBe('Resumen de competencia de jonrones');
    });

    it('construye respuesta de "no encontrada" con catálogo cuando record es null', () => {
        const contract = buildMinuteLookupContract({
            sequence: 99,
            record: null,
            records: [record],
            language: 'es',
        });
        expect(contract.respuesta_voz).toContain('No encuentro la minuta 99');
        expect(contract.respuesta_voz).toContain('minuta 1');
        expect(contract.workspace).toBe(null);
    });
});

describe('minuteKnowledgeHelpers — resolveMinuteQuery (función principal)', () => {
    const records = [
        {
            id: 'a',
            historyCode: '260713-01',
            description: 'Resumen de competencia de jonrones',
            summarySnapshot: {
                titulo: 'Resumen de competencia de jonrones',
                participantes: ['Ana'],
                resumen: 'Sobre jonrones.',
                acuerdos: [],
                pendientes: [],
                siguientes_pasos: [],
                tema_sesion: '',
            },
        },
    ];

    it('resuelve localmente cuando la query tiene número de minuta', () => {
        const result = resolveMinuteQuery('dame el resumen de la minuta uno', records, { language: 'es' });
        expect(result.mode).toBe('local');
        expect(result.contract).toBeDefined();
        expect(result.contract?.respuesta_voz).toContain('Resumen de competencia de jonrones');
        expect(result.diagnostics?.route).toBe('minute-lookup-hit');
        expect(result.diagnostics?.sequence).toBe(1);
        expect(result.diagnostics?.historyCode).toBe('260713-01');
    });

    it('retorna mode: local + minute-lookup-miss cuando la secuencia no existe', () => {
        const result = resolveMinuteQuery('dame la minuta 99', records, { language: 'es' });
        expect(result.mode).toBe('local');
        expect(result.contract?.respuesta_voz).toContain('No encuentro');
        expect(result.diagnostics?.route).toBe('minute-lookup-miss');
    });

    it('retorna mode: gemini cuando la query no menciona número de minuta', () => {
        const result = resolveMinuteQuery('¿cuántas minutas tengo guardadas?', records, { language: 'es' });
        expect(result.mode).toBe('gemini');
        expect(result.contract).toBeUndefined();
    });
});

// ============================================================
// selectMinuteForLookup — integración con onContractResolved
// Decide qué minuta poblar el MinuteDraftPanel y si cambiar de tab.
// ============================================================

describe('minuteKnowledgeHelpers — selectMinuteForLookup', () => {
    const minutes = [
        {
            id: 'm-1',
            historyCode: '260713-01',
            description: 'Resumen de competencia de jonrones',
            summarySnapshot: {
                titulo: 'Resumen de competencia de jonrones',
                participantes: ['Hablante 1', 'Hablante 2'],
                resumen: 'Sobre jonrones.',
                acuerdos: ['Acuerdo A'],
                pendientes: [],
                siguientes_pasos: ['Paso Siguiente 1'],
                tema_sesion: 'Béisbol',
            },
        },
    ];

    it('retorna null cuando diagnostics es null', () => {
        const sel = selectMinuteForLookup({
            diagnostics: null,
            minutes,
            conversationActive: false,
        });
        expect(sel).toBe(null);
    });

    it('retorna null cuando diagnostics.route NO es "minute-lookup-hit"', () => {
        const sel = selectMinuteForLookup({
            diagnostics: { route: 'minute-lookup-miss', historyCode: '260713-01' },
            minutes,
            conversationActive: false,
        });
        expect(sel).toBe(null);
    });

    it('retorna null cuando diagnostics.route es "minute-lookup-hit" pero historyCode no existe en minutes', () => {
        const sel = selectMinuteForLookup({
            diagnostics: { route: 'minute-lookup-hit', historyCode: '999999-99' },
            minutes,
            conversationActive: false,
        });
        expect(sel).toBe(null);
    });

    it('retorna selección exitosa en hit sin conversación activa: shouldSwitchTab=true', () => {
        const sel = selectMinuteForLookup({
            diagnostics: { route: 'minute-lookup-hit', historyCode: '260713-01' },
            minutes,
            conversationActive: false,
            fallbackTheme: 'Clase',
        });
        expect(sel).not.toBe(null);
        expect(sel?.matched.id).toBe('m-1');
        expect(sel?.shouldSwitchTab).toBe(true);
        expect(sel?.draft.titulo).toBe('Resumen de competencia de jonrones');
        expect(sel?.draft.participantes).toEqual(['Hablante 1', 'Hablante 2']);
        expect(sel?.draft.tema_sesion).toBe('Béisbol');
    });

    it('retorna selección exitosa en hit CON conversación activa: shouldSwitchTab=false (no interrumpe)', () => {
        const sel = selectMinuteForLookup({
            diagnostics: { route: 'minute-lookup-hit', historyCode: '260713-01' },
            minutes,
            conversationActive: true,
            fallbackTheme: 'Clase',
        });
        expect(sel).not.toBe(null);
        expect(sel?.shouldSwitchTab).toBe(false);
        // Aún así debe popular el draft
        expect(sel?.draft.titulo).toBe('Resumen de competencia de jonrones');
    });

    it('usa fallbackTheme cuando la minuta no tiene tema_sesion', () => {
        const minutesNoTheme = [{
            id: 'm-2',
            historyCode: '260713-02',
            description: 'Sin tema',
            summarySnapshot: {
                titulo: 'Sin tema',
                participantes: [],
                resumen: '',
                acuerdos: [],
                pendientes: [],
                siguientes_pasos: [],
                tema_sesion: '',
            },
        }];
        const sel = selectMinuteForLookup({
            diagnostics: { route: 'minute-lookup-hit', historyCode: '260713-02' },
            minutes: minutesNoTheme,
            conversationActive: false,
            fallbackTheme: 'Rol por defecto',
        });
        expect(sel?.draft.tema_sesion).toBe('Rol por defecto');
    });

    it('retorna null cuando minutes está vacío', () => {
        const sel = selectMinuteForLookup({
            diagnostics: { route: 'minute-lookup-hit', historyCode: '260713-01' },
            minutes: [],
            conversationActive: false,
        });
        expect(sel).toBe(null);
    });
});
