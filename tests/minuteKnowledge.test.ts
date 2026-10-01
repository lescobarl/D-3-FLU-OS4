/**
 * voice/lib/minuteKnowledge — capa de modulo (antes sin cubrir).
 *
 * POR QUE ESTE TEST: `src/voice/lib/minuteKnowledge.js` estaba al 0% de
 * cobertura. Su modulo hermano `src/lib/minuteKnowledgeHelpers.ts` (dueno
 * canonico de los parsers) ya tiene test; el hueco eran las funciones propias
 * de la capa de voz: parseo de la minuta dictada, claves/ids, formato de
 * historyCode, recorte de descripciones, snapshot de resumen y el upsert del
 * historial. Son puras (salvo el `new Date()` del upsert, que solo fija el
 * codigo YYMMDD y no se asserta literal), asi que se testean por conducta.
 */
import { describe, expect, it } from 'vitest';
import {
    MINUTE_DESCRIPTION_LIMIT,
    buildMinuteHistoryEntries,
    buildMinuteKey,
    buildMinuteKnowledgeId,
    buildVoiceMinuteKnowledgeBase,
    compareMinuteHistoryCodeAsc,
    compareMinuteHistoryCodeDesc,
    createEmptyMinuteDraft,
    formatMinuteHistoryCode,
    formatMinuteHistoryLabel,
    hasMinuteDraftContent,
    minuteDraftToSummarySnapshot,
    normalizeMinuteKnowledgeRecord,
    parseMinuteDraftText,
    resolveMinuteThemeForSave,
    truncateMinuteDescription,
    upsertMinuteHistoryEntry,
} from '../src/voice/lib/minuteKnowledge.js';

describe('minuteKnowledge — parseMinuteDraftText', () => {
    it('reconoce las seis secciones del acta y reparte su contenido', () => {
        const draft = parseMinuteDraftText(
            [
                'Titulo: Reunión de padres',
                'Resumen: Se revisó el plan',
                'Participantes: Ana, Luis, Marta',
                'Acuerdos: Enviar circular',
                'Pendientes: Comprar material',
                'Siguientes pasos: Fijar fecha',
            ].join('\n'),
        );

        expect(draft.titulo).toBe('Reunión de padres');
        expect(draft.resumen).toBe('Se revisó el plan');
        expect(draft.participantes).toEqual(['Ana', 'Luis', 'Marta']);
        expect(draft.acuerdos).toEqual(['Enviar circular']);
        expect(draft.pendientes).toEqual(['Comprar material']);
        expect(draft.siguientes_pasos).toEqual(['Fijar fecha']);
    });

    it('acumula el resumen multilinea separando por espacio', () => {
        const draft = parseMinuteDraftText('Resumen: primera linea\nsegunda linea\n\ntercera');

        expect(draft.resumen).toBe('primera linea segunda linea tercera');
    });

    it('agrega los guiones a la lista de la seccion vigente', () => {
        const draft = parseMinuteDraftText(
            ['Acuerdos: primero', '- segundo', '- tercero', 'Pendientes: uno', '- dos'].join('\n'),
        );

        expect(draft.acuerdos).toEqual(['primero', 'segundo', 'tercero']);
        expect(draft.pendientes).toEqual(['uno', 'dos']);
    });

    it('ignora el texto suelto fuera del resumen (no lo inyecta en listas)', () => {
        const draft = parseMinuteDraftText('Acuerdos: uno\nruido sin seccion\nResumen: solo esto');

        expect(draft.acuerdos).toEqual(['uno']);
        expect(draft.resumen).toBe('solo esto');
    });

    it('un guion pertenece a la ultima seccion declarada (no la reinicia el ruido)', () => {
        const draft = parseMinuteDraftText('Acuerdos: uno\nruido sin seccion\n- bullet');

        expect(draft.acuerdos).toEqual(['uno', 'bullet']);
        expect(draft.resumen).toBe('');
    });

    it('antes de cualquier seccion, ni el texto ni los guiones entran al borrador', () => {
        const draft = parseMinuteDraftText('texto previo suelto\n- bullet sin dueno\nAcuerdos: uno');

        expect(draft.acuerdos).toEqual(['uno']);
        expect(draft.resumen).toBe('');
        expect(draft.titulo).toBe('');
    });

    it('conserva id y tema_sesion del borrador base y solo pisa lo dictado', () => {
        const base = { id: 'd-7', titulo: 'Viejo', tema_sesion: 'Clase de ingles' };
        const draft = parseMinuteDraftText('Titulo: Nuevo', base);

        expect(draft.id).toBe('d-7');
        expect(draft.titulo).toBe('Nuevo');
        expect(draft.tema_sesion).toBe('Clase de ingles');
    });

    it('sin texto devuelve un borrador vacio valido', () => {
        const draft = parseMinuteDraftText('');

        expect(draft.titulo).toBe('');
        expect(draft.resumen).toBe('');
        expect(draft.participantes).toEqual([]);
    });
});

describe('minuteKnowledge — buildMinuteKey', () => {
    it('compone titulo|tema en minusculas y colapsa espacios', () => {
        expect(buildMinuteKey({ titulo: '  Reunión   trimestral ', tema_sesion: 'Clase' })).toBe(
            'reunión trimestral|clase',
        );
    });

    it('cleanForSpeech borra guiones del titulo (no los conserva como separador)', () => {
        expect(buildMinuteKey({ titulo: 'Reunión-2026', tema_sesion: '' })).toBe('reunión 2026|');
    });

    it('titulos distintos producen claves distintas', () => {
        expect(buildMinuteKey({ titulo: 'A' })).not.toBe(buildMinuteKey({ titulo: 'B' }));
    });

    it('sin argumentos no revienta y devuelve la clave vacia', () => {
        expect(buildMinuteKey()).toBe('|');
    });
});

describe('minuteKnowledge — formatMinuteHistoryCode', () => {
    it('formatea YYMMDD-SS con ceros a la izquierda', () => {
        expect(formatMinuteHistoryCode(new Date(2026, 0, 9), 3)).toBe('260109-03');
    });

    it('usa el mes local 1-based (enero = 01, diciembre = 12)', () => {
        expect(formatMinuteHistoryCode(new Date(2026, 11, 31), 1)).toBe('261231-01');
    });

    it('no trunca secuencias de mas de dos digitos', () => {
        expect(formatMinuteHistoryCode(new Date(2026, 5, 7), 123)).toBe('260607-123');
    });
});

describe('minuteKnowledge — resolveMinuteThemeForSave', () => {
    it('cae al titulo cuando la sesion sigue en el placeholder generico', () => {
        expect(resolveMinuteThemeForSave({ titulo: 'Reunión de padres', sessionTheme: 'sesion general' })).toBe(
            'Reunión de padres',
        );
    });

    it('cae al titulo cuando el tema esta vacio', () => {
        expect(resolveMinuteThemeForSave({ titulo: 'Reunión', sessionTheme: '' })).toBe('Reunión');
    });

    it('conserva el tema real de la sesion', () => {
        expect(resolveMinuteThemeForSave({ titulo: 'Reunión', sessionTheme: 'Clase de ingles' })).toBe(
            'Clase de ingles',
        );
    });
});

describe('minuteKnowledge — comparadores de historyCode', () => {
    const a = { historyCode: '260101-01' };
    const b = { historyCode: '260103-01' };
    const c = { historyCode: '260102-07' };

    it('desc: fecha mas reciente primero y, a igual fecha, secuencia mayor', () => {
        const sorted = [a, c, b].sort(compareMinuteHistoryCodeDesc);
        expect(sorted.map((e) => e.historyCode)).toEqual(['260103-01', '260102-07', '260101-01']);
    });

    it('asc es el inverso exacto de desc', () => {
        expect(compareMinuteHistoryCodeAsc(a, b)).toBe(-compareMinuteHistoryCodeDesc(a, b));
        const sorted = [a, c, b].sort(compareMinuteHistoryCodeAsc);
        expect(sorted.map((e) => e.historyCode)).toEqual(['260101-01', '260102-07', '260103-01']);
    });

    it('a igual fecha y secuencia devuelve 0 (orden estable)', () => {
        expect(compareMinuteHistoryCodeDesc({ historyCode: '260101-02' }, { historyCode: '260101-02' })).toBe(0);
    });
});

describe('minuteKnowledge — formatMinuteHistoryLabel', () => {
    it('prefija el code a la descripcion', () => {
        expect(formatMinuteHistoryLabel({ historyCode: '260101-01', description: 'Reunión' })).toBe(
            '260101-01-Reunión',
        );
    });

    it('cae al titulo del snapshot si no hay descripcion', () => {
        expect(formatMinuteHistoryLabel({ historyCode: '260101-01', summarySnapshot: { titulo: 'Acta' } })).toBe(
            '260101-01-Acta',
        );
    });

    it('sin code usa la descripcion, y sin descripcion usa el code', () => {
        expect(formatMinuteHistoryLabel({ description: 'Reunión' })).toBe('Reunión');
        expect(formatMinuteHistoryLabel({ historyCode: '260101-01' })).toBe('260101-01');
        expect(formatMinuteHistoryLabel({})).toBe('');
    });
});

describe('minuteKnowledge — truncateMinuteDescription', () => {
    it('recorta al limite por defecto sin partir espacios previos', () => {
        expect(MINUTE_DESCRIPTION_LIMIT).toBe(10);
        expect(truncateMinuteDescription('Reunión trimestral de padres')).toBe('Reunión tr');
    });

    it('no toca textos que caben en el limite', () => {
        expect(truncateMinuteDescription('Corta')).toBe('Corta');
        expect(truncateMinuteDescription('1234567890')).toBe('1234567890');
    });

    it('normaliza espacios y devuelve vacio si no queda texto', () => {
        expect(truncateMinuteDescription('   ')).toBe('');
        expect(truncateMinuteDescription('  a   b  ', 3)).toBe('a b');
    });
});

describe('minuteKnowledge — createEmptyMinuteDraft', () => {
    it('devuelve el borrador canonico con el tema normalizado', () => {
        const draft = createEmptyMinuteDraft('  Clase   de ingles ');
        expect(draft).toEqual({
            id: '',
            titulo: '',
            participantes: [],
            resumen: '',
            acuerdos: [],
            pendientes: [],
            siguientes_pasos: [],
            tema_sesion: 'Clase de ingles',
        });
    });
});

describe('minuteKnowledge — hasMinuteDraftContent', () => {
    it('un borrador vacio no tiene contenido', () => {
        expect(hasMinuteDraftContent(createEmptyMinuteDraft('x'))).toBe(false);
        expect(hasMinuteDraftContent({})).toBe(false);
    });

    it('una sola seccion con contenido basta', () => {
        expect(hasMinuteDraftContent({ titulo: 'X' })).toBe(true);
        expect(hasMinuteDraftContent({ resumen: 'algo' })).toBe(true);
        expect(hasMinuteDraftContent({ acuerdos: ['uno'] })).toBe(true);
        expect(hasMinuteDraftContent({ siguientes_pasos: ['uno'] })).toBe(true);
    });

    it('elementos en blanco no cuentan como contenido', () => {
        expect(hasMinuteDraftContent({ titulo: '   ', participantes: ['  ', ''] })).toBe(false);
    });
});

describe('minuteKnowledge — minuteDraftToSummarySnapshot', () => {
    it('normaliza y filtra elementos vacios de las listas', () => {
        const snapshot = minuteDraftToSummarySnapshot({
            titulo: '  Acta  ',
            participantes: [' Ana ', '', '  '],
            acuerdos: ['uno'],
            tema_sesion: ' Clase ',
        });

        expect(snapshot).toEqual({
            titulo: 'Acta',
            participantes: ['Ana'],
            resumen: '',
            acuerdos: ['uno'],
            pendientes: [],
            siguientes_pasos: [],
            tema_sesion: 'Clase',
        });
    });

    it('sin argumentos devuelve arrays vacios validos', () => {
        const snapshot = minuteDraftToSummarySnapshot();
        expect(snapshot.acuerdos).toEqual([]);
        expect(snapshot.titulo).toBe('');
    });
});

describe('minuteKnowledge — buildMinuteKnowledgeId', () => {
    it('compone perfil|usuario|clave en minusculas sin signos de puntuacion', () => {
        expect(buildMinuteKnowledgeId({ profileId: 'prof1', userId: 'user1', minuteKey: 'acta|x' })).toBe(
            'prof1|user1|acta|x',
        );
    });

    it('campos faltantes no inyectan "undefined"', () => {
        expect(buildMinuteKnowledgeId({ profileId: 'p' })).toBe('p||');
        expect(buildMinuteKnowledgeId()).toBe('||');
    });
});

describe('minuteKnowledge — normalizeMinuteKnowledgeRecord', () => {
    it('deriva minuteKey/description y sella el id y el historyCode recibidos', () => {
        const record = normalizeMinuteKnowledgeRecord({
            id: ' 7 ',
            profileId: 'p',
            userId: 'u',
            historyCode: ' 260101-01 ',
            summarySnapshot: { titulo: 'Reunión', participantes: ['Ana'] },
        });

        expect(record.id).toBe('7');
        expect(record.profileId).toBe('p');
        expect(record.userId).toBe('u');
        expect(record.minuteKey).toBe('reunión|');
        expect(record.historyCode).toBe('260101-01');
        expect(record.description).toBe('Reunión');
        expect(record.summarySnapshot.participantes).toEqual(['Ana']);
    });

    it('acepta un registro plano (sin summarySnapshot) y lo usa como snapshot', () => {
        const record = normalizeMinuteKnowledgeRecord({ id: '1', titulo: 'X', tema_sesion: 't' });

        expect(record.minuteKey).toBe('x|t');
        expect(record.summarySnapshot.tema_sesion).toBe('t');
    });

    it('description cae al titulo y los sellos de tiempo se generan si faltan', () => {
        const record = normalizeMinuteKnowledgeRecord({ summarySnapshot: { titulo: 'Acta' } });

        expect(record.description).toBe('Acta');
        expect(record.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(record.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('respeta createdAt/updatedAt provistos', () => {
        const record = normalizeMinuteKnowledgeRecord({
            createdAt: '2020-01-01T00:00:00.000Z',
            updatedAt: '2020-02-02T00:00:00.000Z',
        });

        expect(record.createdAt).toBe('2020-01-01T00:00:00.000Z');
        expect(record.updatedAt).toBe('2020-02-02T00:00:00.000Z');
    });
});

describe('minuteKnowledge — buildVoiceMinuteKnowledgeBase', () => {
    it('sin registros (o entrada no-array) devuelve cadena vacia', () => {
        expect(buildVoiceMinuteKnowledgeBase([])).toBe('');
        expect(buildVoiceMinuteKnowledgeBase()).toBe('');
    });

    it('emite header [Minuta N · CODE] y las secciones con contenido', () => {
        const base = buildVoiceMinuteKnowledgeBase([
            {
                historyCode: '260101-01',
                description: 'Reunión trimestral',
                summarySnapshot: {
                    titulo: 'Reunión trimestral',
                    resumen: 'Se acordó X',
                    participantes: ['Ana', 'Luis'],
                    acuerdos: ['X', 'Y'],
                },
            },
        ]);

        expect(base).toContain('[Minuta 1 · 260101-01] Reunión trimestral');
        expect(base).toContain('Resumen: Se acordó X');
        expect(base).toContain('Participantes: Ana, Luis');
        expect(base).toContain('Acuerdos: X | Y');
    });

    it('sin historyCode usa el fallbackIndex como numero de minuta', () => {
        const base = buildVoiceMinuteKnowledgeBase([
            { description: 'Primera' },
            { description: 'Segunda' },
        ]);

        expect(base).toContain('[Minuta 1] Primera');
        expect(base).toContain('[Minuta 2] Segunda');
    });

    it('recorta la ventana al tope de filas del prompt (24)', () => {
        const records = Array.from({ length: 30 }, (_, i) => ({ description: `Minuta ${i + 1}` }));
        const entries = buildVoiceMinuteKnowledgeBase(records).split('\n\n');

        expect(entries).toHaveLength(24);
        expect(entries.at(-1)).toContain('Minuta 24');
        expect(buildVoiceMinuteKnowledgeBase(records)).not.toContain('Minuta 25');
    });
});

describe('minuteKnowledge — buildMinuteHistoryEntries', () => {
    it('normaliza cada registro y los ordena descendente por historyCode', () => {
        const entries = buildMinuteHistoryEntries([
            { historyCode: '260101-01', summarySnapshot: { titulo: 'Uno' } },
            { historyCode: '260103-01', summarySnapshot: { titulo: 'Tres' } },
            { historyCode: '260102-07', summarySnapshot: { titulo: 'Dos' } },
        ]);

        expect(entries.map((e) => e.historyCode)).toEqual(['260103-01', '260102-07', '260101-01']);
        expect(entries[0].minuteKey).toBe('tres|');
    });

    it('lista vacia produce lista vacia', () => {
        expect(buildMinuteHistoryEntries([])).toEqual([]);
    });
});

describe('minuteKnowledge — upsertMinuteHistoryEntry', () => {
    it('una minuta nueva recibe el siguiente codigo universal y conserva su id', () => {
        const entries = buildMinuteHistoryEntries([
            { id: 'e1', historyCode: '260101-01', summarySnapshot: { titulo: 'Uno' } },
            { id: 'e2', historyCode: '260102-05', summarySnapshot: { titulo: 'Dos' } },
        ]);

        const { entries: next, savedEntry } = upsertMinuteHistoryEntry(
            entries,
            { id: 'd9', titulo: 'Nueva', tema_sesion: 'Clase' },
            { profileId: 'p', userId: 'u' },
        );

        expect(savedEntry.id).toBe('d9');
        expect(savedEntry.minuteKey).toBe('nueva|clase');
        expect(savedEntry.description).toBe('Nueva');
        expect(savedEntry.historyCode).toMatch(/^\d{6}-06$/);
        expect(savedEntry.historyCode.slice(0, 6)).toBe(formatMinuteHistoryCode(new Date(), 1).slice(0, 6));
        expect(next).toHaveLength(3);
        expect(next[0]).toEqual(savedEntry);
    });

    it('sin id genera uno nuevo (uuid no vacio)', () => {
        const { savedEntry } = upsertMinuteHistoryEntry([], { titulo: 'Suelta', tema_sesion: 'Clase' });

        expect(savedEntry.id).toMatch(/[0-9a-f-]{20,}/i);
    });

    it('misma minuteKey: actualiza el contenido y CONSERVA codigo, id y createdAt', () => {
        const existing = normalizeMinuteKnowledgeRecord({
            id: 'e1',
            historyCode: '260101-02',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            summarySnapshot: { titulo: 'Reunión', tema_sesion: 'Clase' },
        });

        const { entries, savedEntry } = upsertMinuteHistoryEntry(
            [existing],
            { titulo: 'Reunión', tema_sesion: 'Clase', resumen: 'contenido nuevo' },
            { profileId: 'p', userId: 'u' },
        );

        expect(entries).toHaveLength(1);
        expect(savedEntry.id).toBe('e1');
        expect(savedEntry.historyCode).toBe('260101-02');
        expect(savedEntry.createdAt).toBe('2026-01-01T00:00:00.000Z');
        expect(savedEntry.summarySnapshot.resumen).toBe('contenido nuevo');
        expect(savedEntry.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    });
});
