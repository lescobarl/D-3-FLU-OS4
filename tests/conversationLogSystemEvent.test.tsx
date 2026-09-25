// @vitest-environment jsdom
// ============================================================
// conversationLogSystemEvent.test.tsx — GUARD (bitácora limpia)
// ------------------------------------------------------------
// Invariante: la bitácora NO muestra los eventos narrativos del
// sistema (`[FLU recuerda] ...`, entradas con `meta.systemEvent`).
// Esas entradas viven en `conversationHistory` porque Gemini las
// necesita como contexto, pero son memoria interna de FLU, no
// filas de conversación visibles.
//
// Nace ROJO: hoy ConversationLog pinta cualquier entrada de rol
// 'flu', incluida la del evento de sistema.
// ============================================================
import { describe, it, expect } from 'vitest';
import type { ComponentType } from 'react';
import { render, screen } from '@testing-library/react';
import { ConversationLog } from '../src/voice/components/ConversationLog';

// Componente OS2 en JS (sin tipos TS): mismo cast que usa FluConversationTabView.
const ConversationLogAny = ConversationLog as ComponentType<any>;

const now = Date.now();

const userEntry = {
    id: 'u1',
    role: 'user',
    text: 'hola flu',
    speakerName: 'Hablante 1',
    timestamp: now,
};

const normalFluEntry = {
    id: 'f1',
    role: 'flu',
    text: 'Claro, te ayudo',
    speakerName: 'FLU',
    timestamp: now,
};

const systemEventEntry = {
    id: 's1',
    role: 'flu',
    text: '[FLU recuerda] Me enojé porque levanté la mano, esperé un tiempo razonable y nadie me cedió la palabra.',
    speakerName: 'FLU',
    timestamp: now,
    meta: { systemEvent: { type: 'participant_ignored', participantName: 'Hablante', waitedMs: 8000 } },
};

describe('ConversationLog — la bitácora excluye eventos de sistema', () => {
    it('no renderiza entradas con meta.systemEvent, pero sí las filas normales', () => {
        render(
            <ConversationLogAny
                entries={[userEntry, systemEventEntry, normalFluEntry]}
                emptyLabel="Sin conversación"
            />,
        );

        expect(screen.getByText('hola flu')).toBeTruthy();
        expect(screen.getByText('Claro, te ayudo')).toBeTruthy();
        expect(screen.queryByText(/FLU recuerda/)).toBeNull();
    });
});
