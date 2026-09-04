// ============================================================
// tests/selfKnowledge.test.ts
// Autoconocimiento de FLU — Punto 1 del plan de implementación
// (plan-implementacion-autoconocimiento-y-busqueda-web.md §1.5).
// ------------------------------------------------------------
// Valida la capa pura de src/core/selfKnowledge/selfKnowledge.ts:
//   - buildSelfKnowledgeSnapshot compila desde FLU_CONFIG real
//     (sin mocks): comandos, juegos, sitios, workspaces, pestañas,
//     proveedores de búsqueda y capacidades de contrato.
//   - buildSelfManifesto('es'/'en') no vacío, sin placeholders '||',
//     sin URLs hardcodeadas, menciona juegos y comandos.
//   - findCapabilityByText resuelve "loteria", "quien soy",
//     "que sabes hacer" (ésta última con config sintética hasta P1-C).
//   - isSelfKnowledgeRequest reconoce frases es/en y rechaza
//     falsos positivos (textos cortos o ajenos).
// ============================================================
import { describe, test, expect } from 'vitest';
import {
    buildSelfKnowledgeSnapshot,
    findCapabilityByText,
    capabilitiesByCategoria,
    buildSelfManifesto,
    buildSelfManifestoPrompt,
    isSelfKnowledgeRequest,
    normalizeSelfText,
    type SelfKnowledgeConfig,
} from '../src/core/selfKnowledge/selfKnowledge';
import { GAME_IDS } from '../src/core/games/gameCatalog';
import { WORKSPACE_TIPOS } from '../src/core/config/appConfig';
import { FLU_CONFIG } from '../src/voice/lib/fluConfig';
import { buildSystemPrompt, buildUserPrompt, buildConversationMessages, buildMinimalContractSchema } from '../src/voice/lib/gemini';
import { detectSessionVoiceCommand } from '../src/voice/lib/audioMath';
import { NAVIGATION_COMMAND_IDS, GEMINI_INFERABLE_COMMAND_IDS } from '../src/voice/lib/voiceCommands';

/** Bloques de voiceCommands que NO son comandos accionables (mismo contrato que el módulo). */
const VOICE_COMMAND_SKIP_KEYS = new Set(['listeningAckPhrases', 'commandLogPreserveWake']);

describe('buildSelfKnowledgeSnapshot — compilación desde FLU_CONFIG real (sin mocks)', () => {
    const snapshot = buildSelfKnowledgeSnapshot();

    test('totalCapacidades es igual a la cantidad real de entradas', () => {
        expect(snapshot.capabilities.length).toBeGreaterThan(0);
        expect(snapshot.totalCapacidades).toBe(snapshot.capabilities.length);
    });

    test('compila todos los bloques de voz de voiceCommands (1 entrada por bloque accionable)', () => {
        const expectedCount = Object.entries(FLU_CONFIG.voiceCommands).filter(
            ([key, value]) => !VOICE_COMMAND_SKIP_KEYS.has(key) && Array.isArray(value),
        ).length;
        expect(expectedCount).toBeGreaterThan(0);
        expect(snapshot.comandos.length).toBe(expectedCount);

        for (const [key, value] of Object.entries(FLU_CONFIG.voiceCommands)) {
            if (VOICE_COMMAND_SKIP_KEYS.has(key) || !Array.isArray(value)) continue;
            expect(snapshot.capabilities.some((c) => c.id === `comando:${key}`)).toBe(true);
        }
        // `commandLogPreserveWake` es booleano: no debe generar entrada.
        expect(snapshot.capabilities.some((c) => c.id === 'comando:commandLogPreserveWake')).toBe(false);
    });

    test('compila los juegos del GAME_CATALOG (contrato plan §1.5: 21 juegos)', () => {
        expect(GAME_IDS).toHaveLength(21);
        expect(snapshot.juegos.length).toBe(GAME_IDS.length);
        for (const id of GAME_IDS) {
            expect(snapshot.capabilities.some((c) => c.id === `juego:${id}`)).toBe(true);
        }
    });

    test('incluye los sitios de la allowlist por defecto', () => {
        expect(snapshot.sitiosPermitidos).toContain('wikipedia.org');
        expect(snapshot.sitiosPermitidos).toContain('educ.ar');
        expect(snapshot.sitiosPermitidos.length).toBeGreaterThan(0);
    });

    test('tiposWorkspace coincide con WORKSPACE_TIPOS', () => {
        expect([...snapshot.tiposWorkspace].sort()).toEqual([...WORKSPACE_TIPOS].sort());
    });

    test('pestañas coincide con FLU_CONFIG.ui.tabs.items', () => {
        const tabIds = FLU_CONFIG.ui.tabs.items.map((tab: { id: string }) => tab.id);
        expect([...snapshot.pestañas].sort()).toEqual([...tabIds].sort());
    });

    test('proveedores de búsqueda: solo los habilitados (config-driven)', () => {
        expect(snapshot.proveedoresBusqueda).toEqual(
            expect.arrayContaining(['wikipedia', 'duckduckgo', 'commons', 'commons-video']),
        );
        expect(snapshot.proveedoresBusqueda).not.toContain('youtube');
        expect(snapshot.proveedoresBusqueda).not.toContain('invidious');
    });

    test('cada capacidad tiene id, labelEs y labelEn no vacíos', () => {
        for (const cap of snapshot.capabilities) {
            expect(cap.id.length).toBeGreaterThan(0);
            expect(cap.labelEs.length).toBeGreaterThan(0);
            expect(cap.labelEn.length).toBeGreaterThan(0);
            expect(['comando', 'pagina', 'juego', 'sitio', 'workspace', 'busqueda', 'contrato']).toContain(
                cap.categoria,
            );
        }
    });
});

describe('capabilitiesByCategoria — agrupación consistente', () => {
    const snapshot = buildSelfKnowledgeSnapshot();
    const groups = capabilitiesByCategoria(snapshot);

    test('la suma de los grupos es el total de capacidades', () => {
        const total = Object.values(groups).reduce((acc, arr) => acc + arr.length, 0);
        expect(total).toBe(snapshot.totalCapacidades);
    });

    test('cada grupo solo contiene capacidades de su categoría', () => {
        for (const [categoria, caps] of Object.entries(groups)) {
            expect(caps.every((cap) => cap.categoria === categoria)).toBe(true);
        }
    });
});

describe('findCapabilityByText — resolución por texto', () => {
    test('resuelve "loteria" → juego loteria', () => {
        expect(findCapabilityByText('loteria', 'es')?.id).toBe('juego:loteria');
    });

    test('resuelve "quien soy" → juego quien_soy (alias/id normalizado)', () => {
        expect(findCapabilityByText('quien soy', 'es')?.id).toBe('juego:quien_soy');
    });

    test('resuelve "que sabes hacer" → comando conocerFlu con config sintética (hasta P1-C)', () => {
        const configConConocer: SelfKnowledgeConfig = {
            ...FLU_CONFIG,
            voiceCommands: {
                ...FLU_CONFIG.voiceCommands,
                conocerFlu: ['que sabes hacer', 'que puedes hacer', 'cuentame tus habilidades', 'what can you do'],
            },
        };
        expect(findCapabilityByText('que sabes hacer', 'es', configConConocer)?.id).toBe('comando:conocerFlu');
    });

    test('devuelve null para texto sin capacidad (gibberish / vacío)', () => {
        expect(findCapabilityByText('zzzzyxqw', 'es')).toBeNull();
        expect(findCapabilityByText('', 'es')).toBeNull();
    });
});

describe('buildSelfManifesto — manifiesto 1ª persona compilado', () => {
    test("('es') no vacío, sin '||', sin URLs, menciona comandos y juegos", () => {
        const es = buildSelfManifesto('es');
        expect(es.length).toBeGreaterThan(0);
        expect(es).not.toContain('||');
        expect(es).not.toMatch(/https?:\/\//);
        expect(es).toContain('Soy FLU');
        expect(es).toMatch(/Comandos de voz:/);
        expect(es).toMatch(/Juegos:/);
        expect(es).toContain('Loteria');
        // Juegos con requiresApi se marcan explícitamente (cuentacuentos / cuento_colaborativo).
        expect(es).toContain('(requieren IA)');
    });

    test("('en') no vacío, sin '||', sin URLs, menciona comandos y juegos", () => {
        const en = buildSelfManifesto('en');
        expect(en.length).toBeGreaterThan(0);
        expect(en).not.toContain('||');
        expect(en).not.toMatch(/https?:\/\//);
        expect(en).toContain('I am FLU');
        expect(en).toMatch(/Voice commands:/);
        expect(en).toMatch(/Games:/);
        expect(en).toContain('(require AI)');
    });
});

describe('buildSelfManifestoPrompt — bloque compacto para el system prompt', () => {
    test('es: encabeza con AUTOCONOCIMIENTO e incluye el manifiesto', () => {
        const es = buildSelfManifestoPrompt('es');
        expect(es).toContain('AUTOCONOCIMIENTO');
        expect(es).toContain('Soy FLU');
    });

    test('en: encabeza con SELF-KNOWLEDGE e incluye el manifiesto', () => {
        const en = buildSelfManifestoPrompt('en');
        expect(en).toContain('SELF-KNOWLEDGE');
        expect(en).toContain('I am FLU');
    });
});

describe('isSelfKnowledgeRequest — intento local determinista', () => {
    test('true para frases es de CONOCER_FLU (canónicas + variantes con acentos)', () => {
        expect(isSelfKnowledgeRequest('que sabes hacer', 'es')).toBe(true);
        expect(isSelfKnowledgeRequest('¿Qué sabes hacer?', 'es')).toBe(true);
        expect(isSelfKnowledgeRequest('oye flu que puedes hacer', 'es')).toBe(true);
        expect(isSelfKnowledgeRequest('cuentame tus habilidades', 'es')).toBe(true);
        expect(isSelfKnowledgeRequest('para que sirves', 'es')).toBe(true);
    });

    test('true para frases en de CONOCER_FLU', () => {
        expect(isSelfKnowledgeRequest('what can you do', 'en')).toBe(true);
        expect(isSelfKnowledgeRequest('what do you do', 'en')).toBe(true);
        expect(isSelfKnowledgeRequest('what are your skills', 'en')).toBe(true);
    });

    test('false para textos cortos o ajenos (sin falsos positivos)', () => {
        expect(isSelfKnowledgeRequest('flu', 'es')).toBe(false);
        expect(isSelfKnowledgeRequest('hola flu', 'es')).toBe(false);
        expect(isSelfKnowledgeRequest('reproduce musica', 'es')).toBe(false);
        expect(isSelfKnowledgeRequest('abre youtube', 'es')).toBe(false);
        expect(isSelfKnowledgeRequest('', 'es')).toBe(false);
    });

    test('config-driven: lee voiceCommands.conocerFlu cuando existe (P1-C)', () => {
        const customConfig: SelfKnowledgeConfig = {
            ...FLU_CONFIG,
            voiceCommands: {
                ...FLU_CONFIG.voiceCommands,
                conocerFlu: ['muestrame tus capacidades', 'que haces'],
            },
        };
        expect(isSelfKnowledgeRequest('muestrame tus capacidades', 'es', customConfig)).toBe(true);
        // ConocerFlu presente en config: el fallback queda en segundo plano.
        expect(isSelfKnowledgeRequest('what can you do', 'en', customConfig)).toBe(false);
    });
});

describe('normalizeSelfText — normalización sin acentos y en minúsculas', () => {
    test('elimina tildes, signos y colapsa espacios', () => {
        expect(normalizeSelfText('¿Qué sabes hacer?')).toBe('que sabes hacer');
        expect(normalizeSelfText('  Reproduce   MÚSICA ')).toBe('reproduce musica');
    });
});

describe('P1-B — inyección del manifiesto en buildSystemPrompt (gemini.js §1.2)', () => {
    test('es: el system prompt incluye el bloque AUTOCONOCIMIENTO de FLU', () => {
        const prompt = buildSystemPrompt({ role: '', theme: '', phase: 'conversation', language: 'es' });
        expect(prompt).toContain('AUTOCONOCIMIENTO DE FLU');
        expect(prompt).toContain('Soy FLU');
    });

    test('en: el system prompt incluye el bloque FLU SELF-KNOWLEDGE', () => {
        const prompt = buildSystemPrompt({ role: '', theme: '', phase: 'conversation', language: 'en' });
        expect(prompt).toContain('FLU SELF-KNOWLEDGE');
        expect(prompt).toContain('I am FLU');
    });
});

describe('P1-C — detección local CONOCER_FLU (audioMath.detectSessionVoiceCommand §1.3)', () => {
    test('NAVIGATION_COMMAND_IDS incluye CONOCER_FLU (§1.3.1)', () => {
        expect(NAVIGATION_COMMAND_IDS).toContain('CONOCER_FLU');
    });

    test('reconoce frases es de CONOCER_FLU desde la config real', () => {
        const esPhrases = [
            'que sabes hacer',
            'que puedes hacer',
            'que sabe hacer flu',
            'que puedes hacer flu',
            'que haces',
            'que funciones tienes',
            'cuentame tus habilidades',
            'para que sirves',
        ];
        for (const phrase of esPhrases) {
            expect(detectSessionVoiceCommand(phrase, FLU_CONFIG.voiceCommands)).toBe('CONOCER_FLU');
        }
    });

    test('reconoce frases en de CONOCER_FLU desde la config real', () => {
        const enPhrases = ['what can you do', 'what do you do', 'what are your skills', 'what can flu do'];
        for (const phrase of enPhrases) {
            expect(detectSessionVoiceCommand(phrase, FLU_CONFIG.voiceCommands)).toBe('CONOCER_FLU');
        }
    });

    test('sin falsos positivos en frases ajenas (no responde CONOCER_FLU)', () => {
        const unrelated = ['reproduce musica', 'abre youtube', 'genera un resumen', 'hasta luego flu', ''];
        for (const phrase of unrelated) {
            expect(detectSessionVoiceCommand(phrase, FLU_CONFIG.voiceCommands)).not.toBe('CONOCER_FLU');
        }
    });
});

describe('P1-D — inyección del autoconocimiento en buildUserPrompt/buildConversationMessages (gemini.js §1.4)', () => {
    const baseParams = {
        transcript: 'que sabes hacer flu',
        intent: {},
        speaker: '',
        theme: '',
        role: '',
        phase: 'conversation',
    };

    test('es: inyecta el bloque AUTOCONOCIMIENTO DE FLU con el manifiesto', () => {
        const prompt = buildUserPrompt({
            ...baseParams,
            language: 'es',
            selfKnowledgeText: 'Soy FLU, tu asistente de voz.',
        });
        expect(prompt).toContain('AUTOCONOCIMIENTO DE FLU');
        expect(prompt).toContain('Soy FLU, tu asistente de voz.');
    });

    test('en: inyecta el bloque FLU SELF-KNOWLEDGE con el manifiesto', () => {
        const prompt = buildUserPrompt({
            ...baseParams,
            language: 'en',
            selfKnowledgeText: 'I am FLU, your voice assistant.',
        });
        expect(prompt).toContain('FLU SELF-KNOWLEDGE');
        expect(prompt).toContain('I am FLU, your voice assistant.');
    });

    test('empty-guard: sin selfKnowledgeText NO se ensucia el prompt (por defecto vacío)', () => {
        const prompt = buildUserPrompt({ ...baseParams, language: 'es' });
        expect(prompt).not.toContain('AUTOCONOCIMIENTO DE FLU');
        expect(prompt).not.toContain('FLU SELF-KNOWLEDGE');
    });

    test('buildConversationMessages propaga selfKnowledgeText al último mensaje de usuario', () => {
        const messages = buildConversationMessages({
            ...baseParams,
            language: 'es',
            history: [],
            selfKnowledgeText: 'Soy FLU, tu asistente de voz.',
        });
        const last = messages[messages.length - 1];
        expect(last.role).toBe('user');
        expect(String(last.content)).toContain('AUTOCONOCIMIENTO DE FLU');
        expect(String(last.content)).toContain('Soy FLU, tu asistente de voz.');
    });
});

describe('Opción A — GEMINI_INFERABLE_COMMAND_IDS sincronizado con NAVIGATION_COMMAND_IDS y gemini.js', () => {
    test('GEMINI_INFERABLE_COMMAND_IDS ⊆ NAVIGATION_COMMAND_IDS (todo lo inferible es un comando conocido)', () => {
        expect(GEMINI_INFERABLE_COMMAND_IDS.length).toBeGreaterThan(0);
        for (const id of GEMINI_INFERABLE_COMMAND_IDS) {
            expect(NAVIGATION_COMMAND_IDS).toContain(id);
        }
    });

    test('buildMinimalContractSchema describe TODOS los comandos inferibles (sin lista estática duplicada)', () => {
        const description = buildMinimalContractSchema().properties.navegacion.properties.comando.description;
        for (const id of GEMINI_INFERABLE_COMMAND_IDS) {
            expect(description).toContain(id);
        }
    });

    test('buildUserPrompt (es) lista TODOS los comandos inferibles', () => {
        const prompt = buildUserPrompt({
            transcript: 'abre wikipedia',
            intent: {},
            speaker: '',
            theme: '',
            role: '',
            phase: 'conversation',
            language: 'es',
        });
        for (const id of GEMINI_INFERABLE_COMMAND_IDS) {
            expect(prompt).toContain(`"${id}"`);
        }
    });

    test('buildUserPrompt (en) lista TODOS los comandos inferibles', () => {
        const prompt = buildUserPrompt({
            transcript: 'open wikipedia',
            intent: {},
            speaker: '',
            theme: '',
            role: '',
            phase: 'conversation',
            language: 'en',
        });
        for (const id of GEMINI_INFERABLE_COMMAND_IDS) {
            expect(prompt).toContain(`"${id}"`);
        }
    });
});
