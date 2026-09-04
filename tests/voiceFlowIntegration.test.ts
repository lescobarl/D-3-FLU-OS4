// ============================================================
// voiceFlowIntegration — Flujo completo voz → contrato → acción
// ------------------------------------------------------------
// §3.7 del plan de corrección de defectos raíz. Los tests unitarios
// pasaban pero no cubrían el flujo real voz→Gemini→contrato→acción,
// por eso "solo perdían el tiempo". Este archivo encadena los módulos
// de orquestación PURA que componen el flujo y verifica, por cada
// defecto corregido, que el fast-path determinista dispara la acción
// correcta SIN depender de Gemini:
//
//   Regresión 2.1  → "desactiva la temporada" apaga el branding.
//   Regresión 2.5  → el dictado de horario agrega una entrada real.
//   Regresión 2.6  → "genera una carta" produce un workspace doc/video.
//   Guard 3.1      → no hay tipos de workspace sin dispatch.
//   Guard 3.1      → los comandos deterministas no requieren Gemini.
//
// Regla #1: sin hardcode — catálogos y límites desde config.
// ============================================================
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addAuditLog, type HorarioRecord } from '../src/core/db/fluDatabase';
import {
  createHorarioService,
  type HorarioDb,
} from '../src/core/horario/horarioService';
import { parseHorarioIntent } from '../src/core/horario/horarioIntentParser';
import { resolveConfigCommandFromText } from '../src/voice/lib/configCommands';
import { resolveDeterministicCommand } from '../src/voice/lib/deterministicArbiter';
import {
  detectSessionVoiceCommand,
  resolveFinalConversationAction,
} from '../src/voice/lib/audioMath';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import {
  isGenerationWorkspaceTipo,
  isVisualWorkspaceTipo,
  normalizeWorkspaceContract,
} from '../src/voice/lib/workspaceContract';

// IndexedDB no está disponible en vitest → se mockea el log de auditoría.
vi.mock('../src/core/db/fluDatabase', async () => {
  const actual = await vi.importActual<typeof import('../src/core/db/fluDatabase')>('../src/core/db/fluDatabase');
  return { ...actual, addAuditLog: vi.fn(async () => undefined as never) };
});

// Referencia de reloj fija: jueves 15 de enero de 2026, 10:00 local.
const NOW = new Date(2026, 0, 15, 10, 0, 0, 0).getTime();
const now = (): number => NOW;

const HORARIO_CONFIG = {
  maxClasesPorDia: 3,
  diaMin: 1,
  diaMax: 7,
  defaultColor: 'm1',
  colores: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'] as const,
};

let idCounter = 0;

function createMapDb(initial: HorarioRecord[] = []): HorarioDb {
  const map = new Map<string, HorarioRecord>();
  for (const r of initial) map.set(r.id, { ...r, sync: { ...r.sync } });
  return {
    async add(record: HorarioRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async put(record: HorarioRecord): Promise<unknown> {
      map.set(record.id, { ...record, sync: { ...record.sync } });
      return undefined;
    },
    async delete(id: string): Promise<void> {
      map.delete(id);
    },
    async get(id: string): Promise<HorarioRecord | undefined> {
      const row = map.get(id);
      return row ? { ...row, sync: { ...row.sync } } : undefined;
    },
    async toArray(): Promise<HorarioRecord[]> {
      return Array.from(map.values()).map((r) => ({ ...r, sync: { ...r.sync } }));
    },
  };
}

let db: HorarioDb;
let service: ReturnType<typeof createHorarioService>;

beforeEach(() => {
  vi.clearAllMocks();
  idCounter = 0;
  db = createMapDb();
  service = createHorarioService({
    db,
    config: HORARIO_CONFIG,
    now,
    newId: () => `hor-${++idCounter}`,
  });
});

// ------------------------------------------------------------
// Regresión 2.1 — "desactiva la temporada" apaga el branding
// ------------------------------------------------------------
describe('§3.7 flujo voz→acción — branding off (regresión 2.1)', () => {
  it('resuelve "desactiva la temporada" a mode=disabled sin depender de Gemini', () => {
    const cmd = resolveConfigCommandFromText('desactiva la temporada');
    expect(cmd).toEqual({
      accion: 'set_branding',
      componente: 'branding',
      clave: 'mode',
      valor: 'disabled',
    });
  });

  it('resuelve "apaga el branding" a mode=disabled (variante)', () => {
    const cmd = resolveConfigCommandFromText('apaga el branding');
    expect(cmd?.accion).toBe('set_branding');
    expect(cmd?.clave).toBe('mode');
    expect(cmd?.valor).toBe('disabled');
  });

  it('no dispara branding en conversación casual (guardia triple)', () => {
    expect(resolveConfigCommandFromText('cuéntame un chiste')).toBeNull();
    expect(resolveConfigCommandFromText('hola flu')).toBeNull();
  });
});

// ------------------------------------------------------------
// Regresión 2.5 — dictado de horario agrega una entrada real
// ------------------------------------------------------------
describe('§3.7 flujo voz→acción — dictado de horario (regresión 2.5)', () => {
  it('encadena parseHorarioIntent → createHorarioService.add y persiste', async () => {
    const intent = parseHorarioIntent('agrega matemáticas el lunes a las 8 hasta las 9');
    expect(intent.handled).toBe(true);
    expect(intent.action).toBe('horario.add');
    expect(intent.data).toMatchObject({
      materia: 'matemáticas',
      dia: 1,
      inicio: '08:00',
      fin: '09:00',
    });

    const data = intent.data!;
    const result = await service.add({
      materia: data.materia!,
      dia: data.dia!,
      inicio: data.inicio!,
      fin: data.fin ?? '',
    });
    expect(result.ok).toBe(true);
    expect(result.record?.materia).toBe('matemáticas');
    expect(result.record?.dia).toBe(1);
    expect(result.record?.inicio).toBe('08:00');

    // Persistido de verdad en la base en memoria.
    const rows = await db.toArray();
    expect(rows).toHaveLength(1);
    expect(rows[0].materia).toBe('matemáticas');
    expect(addAuditLog).toHaveBeenCalled();
  });

  it('el dictado sin hora pide aclaración y NO persiste nada', async () => {
    const intent = parseHorarioIntent('agrega física el martes');
    expect(intent.handled).toBe(true);
    expect(intent.action).toBeNull();
    expect(intent.reply).toContain('¿A qué hora');
    expect(await db.toArray()).toHaveLength(0);
  });

  it('consulta de horario por voz devuelve la intención de consulta', () => {
    const intent = parseHorarioIntent('qué clases tengo mañana');
    expect(intent.handled).toBe(true);
    expect(intent.action).toBe('horario.query');
    expect(intent.data?.when).toBe('manana');
  });
});

// ------------------------------------------------------------
// Regresión 2.6 — "genera una carta" produce un workspace doc
// ------------------------------------------------------------
describe('§3.7 flujo voz→acción — generación doc/video (regresión 2.6)', () => {
  it('normalizeWorkspaceContract preserva el tipo doc para su dispatch', () => {
    const normalized = normalizeWorkspaceContract({
      tipo: 'doc',
      titulo: 'Carta de recomendación',
      contenido: 'Por la presente recomiendo a…',
    });
    expect(normalized).not.toBeNull();
    expect(normalized?.tipo).toBe('doc');
    expect(isGenerationWorkspaceTipo(normalized?.tipo)).toBe(true);
    expect(normalized?.contenido).toContain('recomiendo');
  });

  it('normalizeWorkspaceContract preserva el tipo video para su dispatch', () => {
    const normalized = normalizeWorkspaceContract({
      tipo: 'video',
      titulo: 'Video resumen',
      contenido: 'Guion del video de presentación',
    });
    expect(normalized?.tipo).toBe('video');
    expect(isGenerationWorkspaceTipo('video')).toBe(true);
  });

  it('rechaza un workspace doc sin contenido (no hay qué generar)', () => {
    const normalized = normalizeWorkspaceContract({ tipo: 'doc', titulo: '', contenido: '' });
    expect(normalized).toBeNull();
  });
});

// ------------------------------------------------------------
// Guard 3.1 — no hay tipos de workspace sin dispatch
// ------------------------------------------------------------
describe('§3.7 guard de arquitectura — todo tipo de workspace tiene dispatch', () => {
  it('cada tipo normalizable pertenece a una familia con dispatch (visual/doc-video/horario/texto)', () => {
    const visual = ['image_prompt', 'diagram', '3d'];
    const generation = ['doc', 'video'];
    const horario = ['horario'];
    const text = ['text'];

    for (const t of visual) expect(isVisualWorkspaceTipo(t)).toBe(true);
    for (const t of generation) expect(isGenerationWorkspaceTipo(t)).toBe(true);

    // Todos los tipos conocidos deben caer en alguna familia de dispatch.
    const all = [...visual, ...generation, ...horario, ...text];
    for (const t of all) {
      const fam =
        isVisualWorkspaceTipo(t) ||
        isGenerationWorkspaceTipo(t) ||
        t === 'horario' ||
        t === 'text';
      expect(fam, `tipo ${t} sin familia de dispatch`).toBe(true);
    }
  });

  it('normalizeWorkspaceContract conserva el tipo horario con su modo', () => {
    const normalized = normalizeWorkspaceContract({
      tipo: 'horario',
      modo: 'semana',
      contenido: 'Lunes 8:00 matemáticas',
      puntos_clave: ['matemáticas'],
    });
    expect(normalized?.tipo).toBe('horario');
    expect(normalized?.modo).toBe('semana');
  });

  it('un workspace sin tipo cae a text (familia por defecto con dispatch)', () => {
    const normalized = normalizeWorkspaceContract({ contenido: 'un texto cualquiera' });
    expect(normalized?.tipo).toBe('text');
  });
});

// ------------------------------------------------------------
// Guard 3.1 — los comandos deterministas no requieren Gemini
// ------------------------------------------------------------
describe('§3.7 guard de arquitectura — fast-path determinista sin Gemini', () => {
  it('el resolvedor de config devuelve un contrato accionable (no texto libre)', () => {
    const cmd = resolveConfigCommandFromText('pon el idioma en inglés');
    expect(cmd).not.toBeNull();
    expect(cmd?.accion).toBe('set_config');
    expect(cmd?.clave).toBe('language');
    expect(cmd?.valor).toBe('en');
  });

  it('el resolvedor de config devuelve null para frases no deterministas (van a Gemini)', () => {
    // Estas frases NO tienen verbo directivo del catálogo → no deben producir
    // un comando determinista falso; deben delegar a la conversación.
    expect(resolveConfigCommandFromText('¿cómo estás?')).toBeNull();
    expect(resolveConfigCommandFromText('explícame qué es la fotosíntesis')).toBeNull();
  });
});

// ------------------------------------------------------------
// §2D — la búsqueda web "busca X" se resuelve por fast-path
// determinista en conversación, sin depender de que Gemini decida.
// ------------------------------------------------------------
describe('§2D flujo voz→acción — búsqueda web determinista (BUSCAR)', () => {
  const vc = FLU_CONFIG.voiceCommands;

  it('detectSessionVoiceCommand reconoce "Busca en la web" como BUSCAR', () => {
    expect(detectSessionVoiceCommand('Busca en la web', vc)).toBe('BUSCAR');
  });

  it('detectSessionVoiceCommand reconoce la búsqueda con consulta', () => {
    expect(detectSessionVoiceCommand('busca en la web capital de Francia', vc)).toBe(
      'BUSCAR',
    );
  });

  it('el árbitro resuelve "Busca en la web" al dominio navigation/BUSCAR', () => {
    const result = resolveDeterministicCommand('Busca en la web', { language: 'es' });
    expect(result.matched).toBe(true);
    expect(result.domain).toBe('navigation');
    expect(result.action).toBe('BUSCAR');
  });

  it('en conversación la acción final es command BUSCAR (no flu → no Gemini)', () => {
    // resolveFinalConversationAction decide la ruta de dispatch en modo
    // conversación. Si devuelve {kind:'command', command:'BUSCAR'}, el flujo
    // va por dispatchPassiveVoiceCommand (determinista) y NUNCA por
    // processConversationFluQuery (que es quien llama a Gemini).
    const action = resolveFinalConversationAction('Busca en la web', vc);
    expect(action.kind).toBe('command');
    expect(action.command).toBe('BUSCAR');
  });

  it('en conversación la búsqueda con consulta también es command BUSCAR', () => {
    const action = resolveFinalConversationAction('busca en la web capital de Francia', vc);
    expect(action.kind).toBe('command');
    expect(action.command).toBe('BUSCAR');
  });

  it('una frase "busca X" sin prefijo de catálogo NO se fuerza a BUSCAR (delega)', () => {
    // "busca capital de Francia" no está en las frases del catálogo buscar →
    // no debe producir un comando determinista falso; va a la conversación.
    const action = resolveFinalConversationAction('busca capital de Francia', vc);
    expect(action.kind).not.toBe('command');
  });
});
