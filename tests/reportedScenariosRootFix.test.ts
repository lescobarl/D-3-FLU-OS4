// @vitest-environment jsdom
// ============================================================
// reportedScenariosRootFix - los escenarios REPORTADOS, por la cadena REAL.
// Raiz, no hoja: arbitro -> escritura -> servicio -> DB (notas);
// parser -> servicio (agenda); applyGameAction + store (juego).
// Entradas = las frases que FALLABAN (no las que ya pasaban).
// ============================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import type { NoteRecord } from '../src/core/db/fluDatabase';

const { notesMock } = vi.hoisted(() => {
  type Rec = NoteRecord;
  let map = new Map<string, Rec>();
  const clone = (r: Rec): Rec => ({ ...r, sync: { ...r.sync } });
  return {
    notesMock: {
      async add(record: Rec) { map.set(record.id, clone(record)); return record.id; },
      async put(record: Rec) { map.set(record.id, clone(record)); return record.id; },
      async bulkPut(records: Rec[]) { for (const r of records) map.set(r.id, clone(r)); },
      async delete(id: string) { map.delete(id); },
      async get(id: string) { const r = map.get(id); return r ? clone(r) : undefined; },
      async toArray() { return Array.from(map.values()).map(clone); },
      __reset() { map = new Map<string, Rec>(); },
      __all() { return Array.from(map.values()).map(clone); },
    },
  };
});

vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never), fluDb: { notes: notesMock } };
});

import { useNotes } from '../src/hooks/useNotes';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import { writeSuperNoteList, superNoteIncoming } from '../src/app/superNoteActions';
import { isSuperNoteLabel } from '../src/core/notes/superNoteTarget';
import { parseAgendaCommand } from '../src/core/agenda/agendaCommandParser';
import { createAgendaService, type AgendaDb } from '../src/core/agenda/agendaService';
import type { AgendaItem } from '../src/core/agenda/agendaModel';
import { applyGameAction } from '../src/app/gameActions';
import { clearActiveGameSession, getActiveGameSession } from '../src/core/games/gameSessionStore';

beforeEach(() => {
  notesMock.__reset();
  clearActiveGameSession();
});

// ------------------------------------------------------------
// 1) NOTA DEL SUPER - la frase SIN "en" ("incluye la nota del super pan")
// ------------------------------------------------------------
describe('nota del super - el item sin conector "en" no se pierde', () => {
  it('"incluye la nota del super pan" llega a la nota (cadena real)', async () => {
    const { result } = renderHook(() => useNotes({ participantId: 'u' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const r = resolveDeterministicCommand('Okay Flow incluye la nota del súper pan', { language: 'es' }) as any;
    expect(r?.matched).toBe(true);
    expect(r?.domain).toBe('note');
    expect(r?.action?.action).toBe('notes.add');
    expect(r?.action?.data?.body).toBe('pan');

    // Copia literal de la ruta del intent en App.tsx (super note).
    const { label, body } = r.action.data;
    expect(isSuperNoteLabel(label)).toBe(true);
    await act(async () => {
      const written = await writeSuperNoteList(
        result.current as never,
        (result.current as any).notes ?? [],
        superNoteIncoming(label, body),
        { personId: 'u' },
      );
      expect(written.ok).toBe(true);
    });
    await waitFor(() => expect(result.current.notes).toHaveLength(1));
    expect(result.current.notes[0].body).toBe('pan');
  });

  it('las tres ordenes reales acumulan en UNA sola nota Super', async () => {
    const { result } = renderHook(() => useNotes({ participantId: 'u' }));
    await waitFor(() => expect(result.current.loading).toBe(false));

    const frases = [
      'Okay Flow incluye la nota del súper un poco de pan',
      'Okay Flow incluye en la nota del súper insecticida',
      'Okay Flow adiciona en la nota del súper focos',
    ];
    for (const f of frases) {
      const r = resolveDeterministicCommand(f, { language: 'es' }) as any;
      expect(r?.matched).toBe(true);
      const { label, body } = r.action.data;
      await act(async () => {
        await writeSuperNoteList(
          result.current as never,
          (result.current as any).notes ?? [],
          superNoteIncoming(label, body),
          { personId: 'u' },
        );
        await new Promise((res) => setTimeout(res, 20));
      });
    }
    const vivas = notesMock.__all().filter((x) => !x.sync.deleted);
    expect(vivas).toHaveLength(1);
    expect(vivas[0].label).toBe('Super');
    expect(vivas[0].body).toBe('un poco de pan\ninsecticida\nfocos');
  });
});

// ------------------------------------------------------------
// 2) AGENDA - "del jueves" acota la serie en TODO kind (no solo clase)
// ------------------------------------------------------------
const NOW = new Date('2026-09-22T10:00:00').getTime();

function makeDb(): AgendaDb {
  const map = new Map<string, AgendaItem>();
  return {
    async add(item) { map.set(item.id, { ...item, sync: { ...item.sync } }); },
    async put(item) { map.set(item.id, { ...item, sync: { ...item.sync } }); },
    async bulkPut(items) { for (const item of items) map.set(item.id, { ...item, sync: { ...item.sync } }); },
    async delete(id) { map.delete(id); },
    async get(id) { return map.get(id); },
    async toArray() { return Array.from(map.values()).map((i) => ({ ...i, sync: { ...i.sync } })); },
  };
}

describe('agenda - el dia nombrado acota la cancelacion en TODO kind', () => {
  for (const [frase, kind, label] of [
    ['Okay Flow borra la junta de comité del jueves', 'junta', 'comité'],
    ['Okay Flow borra la cita del dentista del jueves', 'cita', 'dentista'],
    ['Okay Flow borra el recordatorio del jueves', 'recordatorio', 'recordatorio'],
    ['Okay Flow borra la clase de historia del jueves', 'clase', 'historia'],
  ] as const) {
    it(`${kind}: "${frase}" -> scopeDays [4]`, () => {
      const cmd = parseAgendaCommand(frase, { now: NOW });
      expect(cmd.action).toBe('agenda.cancel');
      expect(cmd.kind).toBe(kind);
      expect(cmd.scopeDays).toEqual([4]);
      expect(cmd.label).toBe(label);
    });
  }

  it('"borra todas las clases" NO acota (conjunto completo) - no se rompe', () => {
    const cmd = parseAgendaCommand('Okay Flow borra todas las clases', { now: NOW });
    expect(cmd.action).toBe('agenda.cancel');
    expect(cmd.scopeDays).toBeUndefined();
    expect(cmd.label).toBe('');
  });

  it('servicio: borrar la junta del jueves deja el martes vivo', async () => {
    const db = makeDb();
    const svc = createAgendaService({ db, now: () => 1_000_000, newId: (() => { let n = 0; return () => `id-${++n}`; })() });
    await svc.create({ kind: 'junta', label: 'comité', trigger: { type: 'weekly', daysOfWeek: [2, 4], timeOfDay: '10:00' }, personId: 'p1' });
    const cmd = parseAgendaCommand('Okay Flow borra la junta de comité del jueves', { now: NOW });
    const count = await svc.cancelByTarget({
      personId: 'p1',
      kind: cmd.kind!,
      target: cmd.label || '',
      ...(cmd.scopeDays?.length ? { daysOfWeek: cmd.scopeDays } : {}),
    });
    expect(count).toBe(1);
    const [item] = await svc.list({ personId: 'p1' });
    expect(item.status).toBe('pending');
    expect(item.trigger.type === 'weekly' && item.trigger.daysOfWeek).toEqual([2]);
  });
});

// ------------------------------------------------------------
// 3) JUEGO - un arranque repetido NO reinicia la partida
// ------------------------------------------------------------
function gameCtx() {
  return {
    languageRef: { current: 'es' },
    conversationActiveRef: { current: false },
    speakFluRef: { current: async () => undefined },
    scheduleResumeListening: () => undefined,
    participantIdRef: { current: 'p1' },
  };
}

describe('juego - arranque idempotente', () => {
  it('"vamos a jugar loteria" dos veces NO resetea el mazo', async () => {
    await applyGameAction({ gameId: 'loteria', action: 'start' } as never, gameCtx() as never);
    const first = getActiveGameSession();
    expect(first).not.toBeNull();
    const cursorTrasPrimero = (first!.state as { cursor: number }).cursor;

    await applyGameAction({ gameId: 'loteria', action: 'start' } as never, gameCtx() as never);
    const second = getActiveGameSession();
    expect(second).toBe(first);
    expect((second!.state as { cursor: number }).cursor).toBe(cursorTrasPrimero);
  });

  it('cambiar de juego SI arranca de cero', async () => {
    await applyGameAction({ gameId: 'loteria', action: 'start' } as never, gameCtx() as never);
    await applyGameAction({ gameId: 'adivina_numero', action: 'start' } as never, gameCtx() as never);
    expect(getActiveGameSession()?.id).toBe('adivina_numero');
  });

  it('avanzar sigue funcionando (turn)', async () => {
    await applyGameAction({ gameId: 'loteria', action: 'start' } as never, gameCtx() as never);
    const before = (getActiveGameSession()!.state as { cursor: number }).cursor;
    await applyGameAction({ gameId: 'loteria', action: 'turn', playerText: 'siguiente' } as never, gameCtx() as never);
    expect((getActiveGameSession()!.state as { cursor: number }).cursor).toBe(before + 1);
  });
});
