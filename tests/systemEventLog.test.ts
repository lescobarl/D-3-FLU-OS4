// ============================================================
// Tests para src/lib/systemEventLog.ts
// Validan el formateo (1ª persona), filtrado, dedup y
// conversión a ConversationEntry con role:'flu'.
// ============================================================

import { describe, it, expect } from 'vitest';
import {
    formatSystemEvent,
    buildSystemConversationEntry,
    filterRecentSystemEvents,
    systemEventDedupKey,
    isDuplicateSystemEvent,
    SYSTEM_EVENT_WINDOW_MS,
} from '../src/lib/systemEventLog';
import type { SystemEvent } from '../src/lib/systemEventLog';
import type { ConversationEntry } from '../src/types/bridge';

const NOW = 1700000000000;

const baseEvent: SystemEvent = {
    type: 'participant_ignored',
    timestamp: NOW,
    participantName: 'Hablante 1',
    waitedMs: 8000,
};

describe('systemEventLog — formatSystemEvent (1ª persona)', () => {
    it('formatea participant_ignored en español con el texto del usuario', () => {
        const text = formatSystemEvent(baseEvent, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('Me enojé porque levanté la mano');
        expect(text).toContain('esperé un tiempo razonable');
        expect(text).toContain('nadie me cedió la palabra');
        expect(text).toContain('snif');
    });

    it('formatea participant_ignored en inglés', () => {
        const text = formatSystemEvent(baseEvent, 'en');
        expect(text).toContain('[FLU remembers]');
        expect(text).toContain('I got upset');
        expect(text).toContain('raised my hand');
        expect(text).toContain('nobody gave me the floor');
        expect(text).toContain('sniff');
    });

    it('formatea participant_ignored sin nombre (anónimo) — no usa nombre', () => {
        const text = formatSystemEvent({ type: 'participant_ignored', timestamp: NOW, waitedMs: 5000 }, 'es');
        expect(text).not.toContain('alguien');
        expect(text).toContain('Me enojé porque levanté la mano');
    });

    it('formatea participant_rejected con razón', () => {
        const event: SystemEvent = {
            type: 'participant_rejected',
            timestamp: NOW,
            participantName: 'Hablante 2',
            reason: 'no fue apropiado',
        };
        const text = formatSystemEvent(event, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('Hablante 2');
        expect(text).toContain('Motivo: no fue apropiado');
    });

    it('formatea participant_granted sin detalles extra', () => {
        const event: SystemEvent = {
            type: 'participant_granted',
            timestamp: NOW,
            participantName: 'Hablante 3',
        };
        const text = formatSystemEvent(event, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('Le cedí la palabra');
        expect(text).toContain('Hablante 3');
    });

    it('redondea waitedMs a segundos — ignorado ya no muestra segundos exactos', () => {
        const text = formatSystemEvent({ ...baseEvent, waitedMs: 7250 }, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('Me enojé porque levanté la mano');
    });

    // --- Nuevos tipos de eventos ---

    it('formatea user_praise en español', () => {
        const event: SystemEvent = {
            type: 'user_praise',
            timestamp: NOW,
            participantName: 'Usuario',
            praiseText: 'Bien hecho',
        };
        const text = formatSystemEvent(event, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('me elogió');
        expect(text).toContain('feliz');
        expect(text).toContain('😊');
    });

    it('formatea user_praise en inglés', () => {
        const event: SystemEvent = {
            type: 'user_praise',
            timestamp: NOW,
            participantName: 'User',
            praiseText: 'Good job',
        };
        const text = formatSystemEvent(event, 'en');
        expect(text).toContain('[FLU remembers]');
        expect(text).toContain('praised me');
        expect(text).toContain('happy');
    });

    it('formatea user_criticism en español', () => {
        const event: SystemEvent = {
            type: 'user_criticism',
            timestamp: NOW,
            participantName: 'Usuario',
            criticismText: 'No sirves',
        };
        const text = formatSystemEvent(event, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('me criticó');
        expect(text).toContain('triste');
        expect(text).toContain('Me esforzaré más');
    });

    it('formatea user_criticism en inglés', () => {
        const event: SystemEvent = {
            type: 'user_criticism',
            timestamp: NOW,
            participantName: 'User',
            criticismText: 'You are useless',
        };
        const text = formatSystemEvent(event, 'en');
        expect(text).toContain('[FLU remembers]');
        expect(text).toContain('criticized me');
        expect(text).toContain('sad');
    });

    it('formatea topic_change en español', () => {
        const event: SystemEvent = {
            type: 'topic_change',
            timestamp: NOW,
        };
        const text = formatSystemEvent(event, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('tema de conversación cambió');
        expect(text).toContain('adaptando');
    });

    it('formatea topic_change en inglés', () => {
        const event: SystemEvent = {
            type: 'topic_change',
            timestamp: NOW,
        };
        const text = formatSystemEvent(event, 'en');
        expect(text).toContain('[FLU remembers]');
        expect(text).toContain('topic changed');
    });

    it('formatea interruption_detected en español', () => {
        const event: SystemEvent = {
            type: 'interruption_detected',
            timestamp: NOW,
            interruptionText: 'Espera',
        };
        const text = formatSystemEvent(event, 'es');
        expect(text).toContain('[FLU recuerda]');
        expect(text).toContain('Me interrumpieron');
        expect(text).toContain('frustrado');
    });

    it('formatea interruption_detected en inglés', () => {
        const event: SystemEvent = {
            type: 'interruption_detected',
            timestamp: NOW,
            interruptionText: 'Wait',
        };
        const text = formatSystemEvent(event, 'en');
        expect(text).toContain('[FLU remembers]');
        expect(text).toContain('interrupted');
        expect(text).toContain('frustrated');
    });
});

describe('systemEventLog — buildSystemConversationEntry (role: flu)', () => {
    it('crea entrada con role: flu, speakerName: FLU y meta.systemEvent', () => {
        const entry = buildSystemConversationEntry(baseEvent, 'es');
        expect(entry.id).toBeTypeOf('string');
        expect(entry.id.length).toBeGreaterThan(0);
        expect(entry.role).toBe('flu');
        expect(entry.speakerName).toBe('FLU');
        expect(entry.timestamp).toBe(NOW);
        expect(entry.sentiment).toBe('negative');
        expect(entry.phase).toBe('SESION_ACTIVA');
        expect(entry.text).toContain('[FLU recuerda]');
        expect(entry.meta?.systemEvent?.type).toBe('participant_ignored');
        expect(entry.meta?.systemEvent?.waitedMs).toBe(8000);
        expect(entry.meta?.systemEvent?.participantName).toBe('Hablante 1');
    });

    it('preserva los campos específicos de cada tipo en meta.systemEvent', () => {
        const event: SystemEvent = {
            type: 'participant_rejected',
            timestamp: NOW,
            participantName: 'X',
            reason: 'invalid',
        };
        const entry = buildSystemConversationEntry(event, 'es');
        expect(entry.meta?.systemEvent?.type).toBe('participant_rejected');
        expect(entry.meta?.systemEvent?.reason).toBe('invalid');
        expect(entry.meta?.systemEvent?.waitedMs).toBeUndefined();
    });

    it('usa texto en inglés cuando language=en', () => {
        const entry = buildSystemConversationEntry(baseEvent, 'en');
        expect(entry.text).toContain('[FLU remembers]');
    });

    it('genera IDs únicos para cada entrada', () => {
        const a = buildSystemConversationEntry(baseEvent);
        const b = buildSystemConversationEntry(baseEvent);
        expect(a.id).not.toBe(b.id);
    });

    // --- Nuevos tipos ---

    it('crea entrada para user_praise con sentimiento positivo', () => {
        const event: SystemEvent = {
            type: 'user_praise',
            timestamp: NOW,
            participantName: 'Usuario',
            praiseText: 'Bien hecho',
        };
        const entry = buildSystemConversationEntry(event, 'es');
        expect(entry.sentiment).toBe('positive');
        expect(entry.meta?.systemEvent?.type).toBe('user_praise');
    });

    it('crea entrada para user_criticism con sentimiento negativo', () => {
        const event: SystemEvent = {
            type: 'user_criticism',
            timestamp: NOW,
            participantName: 'Usuario',
            criticismText: 'No sirves',
        };
        const entry = buildSystemConversationEntry(event, 'es');
        expect(entry.sentiment).toBe('negative');
        expect(entry.meta?.systemEvent?.type).toBe('user_criticism');
    });

    it('crea entrada para topic_change con sentimiento neutral', () => {
        const event: SystemEvent = {
            type: 'topic_change',
            timestamp: NOW,
        };
        const entry = buildSystemConversationEntry(event, 'es');
        expect(entry.sentiment).toBe('neutral');
        expect(entry.meta?.systemEvent?.type).toBe('topic_change');
    });

    it('crea entrada para interruption_detected con sentimiento negativo', () => {
        const event: SystemEvent = {
            type: 'interruption_detected',
            timestamp: NOW,
            interruptionText: 'Espera',
        };
        const entry = buildSystemConversationEntry(event, 'es');
        expect(entry.sentiment).toBe('negative');
        expect(entry.meta?.systemEvent?.type).toBe('interruption_detected');
    });
});

describe('systemEventLog — filterRecentSystemEvents', () => {
    const recent = buildSystemConversationEntry({ ...baseEvent, timestamp: NOW - 1000 });
    const old = buildSystemConversationEntry({ ...baseEvent, timestamp: NOW - (10 * 60 * 1000) });
    const userEntry: ConversationEntry = {
        id: 'u1', role: 'user', text: 'hola', timestamp: NOW, speakerName: 'Hablante 1',
    };

    it('filtra eventos del sistema dentro de la ventana', () => {
        const result = filterRecentSystemEvents([recent, old, userEntry], NOW);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(recent.id);
    });

    it('excluye eventos del futuro (clock skew extremo)', () => {
        const future = buildSystemConversationEntry({ ...baseEvent, timestamp: NOW + 5000 });
        const result = filterRecentSystemEvents([future, old], NOW);
        expect(result).toHaveLength(0);
    });

    it('excluye entradas que NO son eventos del sistema', () => {
        const result = filterRecentSystemEvents([userEntry], NOW);
        expect(result).toHaveLength(0);
    });

    it('usa ventana custom', () => {
        const oldish = buildSystemConversationEntry({ ...baseEvent, timestamp: NOW - 5000 });
        const result = filterRecentSystemEvents([oldish], NOW, 1000);
        expect(result).toHaveLength(0);
    });

    it('expone SYSTEM_EVENT_WINDOW_MS con valor razonable (5 min)', () => {
        expect(SYSTEM_EVENT_WINDOW_MS).toBe(5 * 60 * 1000);
    });
});

describe('systemEventLog — systemEventDedupKey + isDuplicateSystemEvent', () => {
    it('genera la misma clave para eventos en el mismo bucket de tiempo', () => {
        const a: SystemEvent = { ...baseEvent, timestamp: 1000 };
        const b: SystemEvent = { ...baseEvent, timestamp: 1500 }; // mismo bucket (1000/3000=0)
        expect(systemEventDedupKey(a)).toBe(systemEventDedupKey(b));
    });

    it('genera claves distintas para eventos en buckets distintos', () => {
        const a: SystemEvent = { ...baseEvent, timestamp: 1000 };
        const b: SystemEvent = { ...baseEvent, timestamp: 5000 };
        expect(systemEventDedupKey(a)).not.toBe(systemEventDedupKey(b));
    });

    it('incluye el participantName en la clave', () => {
        const a: SystemEvent = { ...baseEvent, participantName: 'A', timestamp: 1000 };
        const b: SystemEvent = { ...baseEvent, participantName: 'B', timestamp: 1000 };
        expect(systemEventDedupKey(a)).not.toBe(systemEventDedupKey(b));
    });

    it('isDuplicateSystemEvent retorna true para evento duplicado', () => {
        const existing = [buildSystemConversationEntry({ ...baseEvent, timestamp: 1000 })];
        const duplicate: SystemEvent = { ...baseEvent, timestamp: 1500 };
        expect(isDuplicateSystemEvent(duplicate, existing)).toBe(true);
    });

    it('isDuplicateSystemEvent retorna false para evento nuevo', () => {
        const existing = [buildSystemConversationEntry({ ...baseEvent, timestamp: 1000 })];
        const fresh: SystemEvent = { ...baseEvent, timestamp: 10000 };
        expect(isDuplicateSystemEvent(fresh, existing)).toBe(false);
    });

    it('isDuplicateSystemEvent ignora entradas que no son eventos del sistema', () => {
        const userEntry: ConversationEntry = {
            id: 'u1', role: 'user', text: 'hola', timestamp: 1000, speakerName: 'Hablante 1',
        };
        const fresh: SystemEvent = { ...baseEvent, timestamp: 1000 };
        expect(isDuplicateSystemEvent(fresh, [userEntry])).toBe(false);
    });

    it('genera claves para nuevos tipos de eventos', () => {
        const praise: SystemEvent = {
            type: 'user_praise', timestamp: 1000, participantName: 'User', praiseText: 'Bien',
        };
        const criticism: SystemEvent = {
            type: 'user_criticism', timestamp: 1000, participantName: 'User', criticismText: 'Mal',
        };
        expect(systemEventDedupKey(praise)).toContain('user_praise');
        expect(systemEventDedupKey(criticism)).toContain('user_criticism');
    });
});
