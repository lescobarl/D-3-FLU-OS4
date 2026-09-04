// ============================================================
// Resolución determinista de intents de ambiente (activación por voz)
// ------------------------------------------------------------
// Al igual que configCommands/gameCommands, este módulo resuelve de forma
// 100% local y determinista un intent de ambiente a partir del texto
// transcrito, sin depender del LLM. `frasesActivacion` es dato puro del
// catálogo de ambientes (ver environmentRegistry.ts).
// ============================================================

import { normalizeForMatch, hasToken } from '../../voice/lib/configCommands.js';
import {
    getAmbientes,
    isAmbienteId,
    DEFAULT_AMBIENTE_ID,
} from './environmentRegistry';

/**
 * Intent de ambiente: `activar` aplica un oficio; `reset` restaura el
 * ambiente por defecto (`asistente`).
 */
export type EnvironmentIntent =
    | { tipo: 'activar'; ambienteId: string }
    | { tipo: 'reset'; ambienteId: string };

/** Mapea el idioma detectado a la clave de frases (`en` → en, resto → es). */
function resolveLangKey(lang = ''): 'es' | 'en' {
    return lang === 'en' ? 'en' : 'es';
}

/**
 * Resuelve de forma determinista y local un intent de ambiente a partir del
 * texto transcrito, contrastando contra las frases de activación del catálogo.
 * Retorna `null` si no hay coincidencia. El primer ambiente del catálogo que
 * coincida gana; el ambiente por defecto (`asistente`) se interpreta como
 * `reset`.
 */
export function resolveEnvironmentIntent(text = '', lang = 'es'): EnvironmentIntent | null {
    const normalized = normalizeForMatch(text);
    if (!normalized) return null;

    const langKey = resolveLangKey(lang);
    for (const ambiente of getAmbientes()) {
        const frases = ambiente.frasesActivacion?.[langKey] ?? [];
        const matched = frases.some((frase) => hasToken(normalized, frase));
        if (matched) {
            return ambiente.id === DEFAULT_AMBIENTE_ID
                ? { tipo: 'reset', ambienteId: DEFAULT_AMBIENTE_ID }
                : { tipo: 'activar', ambienteId: ambiente.id };
        }
    }

    return null;
}

/**
 * Normaliza un `ambiente` crudo (string u objeto) proveniente del contrato
 * en un intent válido. Formas aceptadas:
 *   - string: id válido → `activar`; `asistente` → `reset`.
 *   - objeto `{ tipo, ambienteId }`: se valida y se coacciona a un intent
 *     consistente (`reset` siempre apunta al ambiente por defecto).
 * Retorna `null` para entradas no válidas.
 */
export function normalizeEnvironment(raw: unknown): EnvironmentIntent | null {
    if (raw === null || raw === undefined) return null;

    if (typeof raw === 'string') {
        const ambienteId = raw.trim().toLowerCase();
        if (!isAmbienteId(ambienteId)) return null;
        return ambienteId === DEFAULT_AMBIENTE_ID
            ? { tipo: 'reset', ambienteId: DEFAULT_AMBIENTE_ID }
            : { tipo: 'activar', ambienteId };
    }

    if (typeof raw === 'object') {
        const candidate = raw as { tipo?: unknown; ambienteId?: unknown };
        const tipo =
            candidate.tipo === 'reset' || candidate.tipo === 'activar'
                ? candidate.tipo
                : null;
        const ambienteId =
            typeof candidate.ambienteId === 'string'
                ? candidate.ambienteId.trim().toLowerCase()
                : '';
        if (!tipo || !isAmbienteId(ambienteId)) return null;
        if (tipo === 'reset' || ambienteId === DEFAULT_AMBIENTE_ID) {
            return { tipo: 'reset', ambienteId: DEFAULT_AMBIENTE_ID };
        }
        return { tipo: 'activar', ambienteId };
    }

    return null;
}
