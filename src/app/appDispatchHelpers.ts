/**
 * Helpers de DESPACHO a nivel modulo de `App` (extraidos de `src/App.tsx`, que esta en el
 * techo del trinquete de tamano: `tests/godFileSizeGuard.test.ts`).
 *
 * POR QUE VIVEN AQUI: la RUTA CONVERSACIONAL (acciones del LLM) y el FALLBACK OFFLINE
 * (re-parsero del transcript) tienen que compartir el MISMO conjunto de options del arbitro y
 * el MISMO resolvedor de intencion por dominio. Al ser funciones puras de sus argumentos (mas
 * config), su sitio es un modulo hoja: no tocan estado del componente ni hooks.
 *
 * NO es una ruta doble: `App.tsx` las importa y no conserva copia.
 */
import { normalizeSpaces } from '../lib/textUtils'
import { resolveNoteVoiceIntent } from '../voice/api/commands'
import { FLU_CONFIG } from '../voice/api/config'

import { resolveDiaryVoiceIntent } from '../core/diary/diaryIntentParser'
import { resolveAgendaDomainIntent } from '../core/agenda/domainScopedIntent'
import type { ArbiterResult } from './arbiterDispatch'

/**
 * Determina si un workspace de tipo 'text' es una respuesta conversacional
 * redundante (el contenido escrito duplica la respuesta hablada) en lugar de
 * contenido estructurado genuino.
 *
 * El contrato de IA (deepseek.ts/gemini.ts) instruye: "workspace debe
 * establecerse cuando el usuario pide crear contenido". Sin embargo, los
 * modelos suelen rellenar workspace.contenido con la MISMA respuesta hablada
 * para preguntas conversacionales simples ("platícame de los autos a
 * gasolina"). Eso provoca que la pestaña «respuesta» del Pizarrón muestre el
 * texto en 2 lugares (latestResponse + workspaceArtifact.contenido).
 *
 * Se considera contenido genuino (NO redundante) cuando:
 *   - hay puntos_clave distintos (estructura real), o
 *   - el contenido escrito difiere sustancialmente de la respuesta hablada
 *     (p. ej. una versión escrita más extensa/detallada).
 */
export function isRedundantTextWorkspace(opts: {
    contenido: string;
    titulo: string;
    puntosClave: string[];
    respuestaVoz: string;
}): boolean {
    const { contenido, titulo, puntosClave, respuestaVoz } = opts;
    // Puntos clave reales ⇒ contenido estructurado, no redundante.
    if (puntosClave.length > 0) return false;

    const spoken = normalizeSpaces(respuestaVoz);
    const written = normalizeSpaces(contenido || titulo || '');
    if (!spoken || !written) return false;

    // Si el contenido escrito es esencialmente la respuesta hablada (mismo
    // texto o subconjunto casi idéntico), es redundante.
    const spokenTokens = spoken.toLowerCase().split(' ').filter(Boolean);
    const writtenTokens = written.toLowerCase().split(' ').filter(Boolean);
    if (!spokenTokens.length || !writtenTokens.length) return false;

    const writtenSet = new Set(writtenTokens);
    let overlap = 0;
    for (const token of spokenTokens) {
        if (writtenSet.has(token)) overlap += 1;
    }
    const overlapRatio = overlap / spokenTokens.length;
    // Umbral alto: solo se suprime cuando el escrito replica casi por completo
    // lo hablado (respuesta conversacional duplicada), no cuando añade detalle.
    return overlapRatio >= 0.85;
}

/**
 * Construye las options del árbitro determinista a partir de FLU_CONFIG.
 * Misma fuente que usan los manejadores __fluHandle* para que el `action`
 * devuelto sea COMPLETO (con defaultOffsetMs, defaultAlarmTimeOfDay y
 * defaultTimerMinutes aplicados) y el despacho no tenga que re-parcear.
 */
export interface ArbiterOptions {
    defaultOffsetMs: number;
    now: number;
    defaultAlarmTimeOfDay: string | undefined;
    defaultTimerMinutes: number;
}

export function buildArbiterOptions(): ArbiterOptions {
    const arbiterRemindersConfig = FLU_CONFIG?.reminders || {};
    const arbiterOffsetMinutes = Number(
        arbiterRemindersConfig.defaultReminderOffsetMinutes,
    );
    const arbiterDefaultOffsetMs = (Number.isFinite(arbiterOffsetMinutes)
        ? arbiterOffsetMinutes
        : 10) * 60 * 1000;
    const arbiterTemporalConfig = FLU_CONFIG?.temporal || {};
    return {
        defaultOffsetMs: arbiterDefaultOffsetMs,
        now: Date.now(),
        defaultAlarmTimeOfDay: arbiterTemporalConfig.defaultAlarmTimeOfDay,
        defaultTimerMinutes: Number(arbiterTemporalConfig.defaultTimerMinutes) || 5,
    };
}

/** Intención estructurada de nota aceptada por el manejador de voz. */
export interface NoteVoiceIntent {
    action?: string;
    handled?: boolean;
    data?: { label?: unknown; target?: unknown; body?: unknown; item?: unknown };
}

/** Intención estructurada de diario aceptada por el manejador de voz. */
export interface DiaryVoiceIntent {
    action?: string;
    handled?: boolean;
    data?: { content?: unknown };
}

/**
 * Resuelve una intención ESTRUCTURADA a partir del `dominio` que el cerebro
 * conversacional ya clasificó (`accion.dominio`), cuando el re-parseo del texto
 * libre con el árbitro NO matcheó. No cambia la autoridad del parser: usa el
 * MISMO parser de dominio, solo que sin exigir el trigger verbal.
 */
export function resolveDomainScopedIntent(
    domain: string | null | undefined,
    text: string,
    _opts: { defaultOffsetMs?: number; now?: number; language?: 'es' | 'en' },
): ArbiterResult | null {
    if (!domain || !text) return null;
    if (domain === 'note') {
        // Fuente unica de parseo de notas (el MISMO resolver que el handler):
        // alta, borrado por destino, vaciado y quitar item. Antes solo entendia
        // el alta, asi que el borrado por esta ruta se perdia.
        const intent = resolveNoteVoiceIntent(text) as NoteVoiceIntent | null;
        if (!intent) return null;
        return {
            matched: true,
            domain: 'note',
            action: { handled: true, action: intent.action, data: intent.data },
            channel: 'flu',
        };
    }
    if (domain === 'diary') {
        // Fuente unica de parseo del diario (el MISMO resolver que el handler):
        // sin regex paralelas que puedan divergir del parser de core.
        const intent = resolveDiaryVoiceIntent(text, { language: _opts.language });
        if (!intent) return null;
        return {
            matched: true,
            domain: 'diary',
            action: { handled: true, action: intent.action, data: intent.data },
            channel: 'flu',
        };
    }
    // Tramo de AGENDA: entra lo que la clasificacion del LLM ya decidio (el
    // texto sigue mandando para el instante). Ver core/agenda/domainScopedIntent.
    return resolveAgendaDomainIntent(domain, text, _opts);
}

/**
 * Expone el callback de contrato en `window` SOLO en desarrollo (e2e).
 * En producción no publica el hook de prueba: sin superficie de test en runtime.
 */
export function exposeContractHookDev<T>(callback: T): T {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
        window.__fluOnContractResolved = callback as (resolved: unknown) => Promise<unknown>;
    }
    return callback;
}

/**
 * Expone un puente de desarrollo en `window` SOLO en desarrollo (misma politica que
 * exposeContractHookDev). NO se usa para los `__fluHandleX` que la app consume en
 * runtime: esos se asignan directamente (ver tests/devGlobalsGuard.test.ts).
 * El `useCallback` de dentro se evalua siempre: se envuelve la ASIGNACION, nunca el
 * hook, para no alterar el orden de hooks entre renders.
 */
export function exposeDevHook<K extends keyof Window>(name: K, callback: Window[K]): Window[K] {
    if (import.meta.env.DEV && typeof window !== 'undefined') {
        const target: Window = window;
        target[name] = callback;
    }
    return callback;
}
