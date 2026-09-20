// ============================================================
// localTts — Text-to-Speech 100% local
// ============================================================
// Consume la API ÚNICA de síntesis de voz expuesta por fluSpeech
// (C21: un solo módulo toca el motor del navegador).
//
// Cumple:
//   - Modo 100% local: las voces son locales del SO (localService)
//   - Rule #1: sin endpoints hardcodeados
//   - Funciones puras (buildLocalNarrationSegments, pickBestLocalVoice)
//     testables sin navegador real.
// ============================================================

import { getSpeechEngine } from '../voice/lib/fluSpeech';

export interface LocalTtsOptions {
    lang?: string;
    rate?: number;
    pitch?: number;
    onStart?: () => void;
    onEnd?: () => void;
    onError?: (error: unknown) => void;
}

export interface LocalTtsVoiceInfo {
    name: string;
    lang: string;
    localService: boolean;
    default: boolean;
    voiceURI: string;
}

export interface NarrationSegment {
    index: number;
    title: string;
    text: string;
}

export function getSpeechSynthesis(): SpeechSynthesis | null {
    return getSpeechEngine();
}

/** True si el motor TTS del navegador está reproduciendo o tiene cola. */
export function isTtsSpeaking(): boolean {
    const synth = getSpeechSynthesis();
    return Boolean(synth && (synth.speaking || synth.pending));
}

function mapVoice(voice: SpeechSynthesisVoice): LocalTtsVoiceInfo {
    return {
        name: voice.name,
        lang: voice.lang,
        localService: Boolean(voice.localService),
        default: Boolean(voice.default),
        voiceURI: voice.voiceURI,
    };
}

/**
 * Devuelve las voces locales disponibles. Prefiere las marcadas como
 * `localService` (instaladas en el SO); si el navegador no reporta el
 * flag, devuelve todas las voces como fallback.
 */
export function getLocalVoices(): LocalTtsVoiceInfo[] {
    const synth = getSpeechSynthesis();
    if (!synth) return [];
    const voices = synth.getVoices();
    if (!Array.isArray(voices) || voices.length === 0) return [];
    const mapped = voices.map(mapVoice);
    const local = mapped.filter((v) => v.localService);
    return local.length > 0 ? local : mapped;
}

/** True si hay al menos una voz local que pueda usarse para TTS. */
export function isLocalTtsAvailable(): boolean {
    return getLocalVoices().length > 0;
}

/**
 * Elige la mejor voz local para un idioma destino (p. ej. 'es' acepta
 * es-ES, es-MX...). Prioridad:
 *   1. coincidencia exacta del BCP-47 (es-MX === es-MX)
 *   2. prefijo exacto (es-MX empieza con es)
 *   3. familia de idioma (es-ES → es)
 *   4. primera voz disponible
 */
export function pickBestLocalVoice(
    voices: LocalTtsVoiceInfo[],
    lang = 'es',
): LocalTtsVoiceInfo | null {
    if (!Array.isArray(voices) || voices.length === 0) return null;
    const target = lang.trim().toLowerCase();
    const exact = voices.find((v) => v.lang.toLowerCase() === target);
    if (exact) return exact;
    const startsWith = voices.find((v) => v.lang.toLowerCase().startsWith(target));
    if (startsWith) return startsWith;
    const family = target.split('-')[0];
    if (family) {
        const byFamily = voices.find((v) => v.lang.toLowerCase().startsWith(family));
        if (byFamily) return byFamily;
    }
    return voices[0];
}

export interface SpeakResult {
    started: boolean;
    error?: string;
}

/**
 * Pronuncia un texto con las voces locales del sistema.
 * Devuelve { started: true } si el utterance se encoló; en otro caso
 * un código de error legible (sin excepciones).
 */
export function speakLocal(text: string, options: LocalTtsOptions = {}): SpeakResult {
    const synth = getSpeechSynthesis();
    if (!synth) return { started: false, error: 'tts-unavailable' };
    const clean = (text || '').trim();
    if (!clean) return { started: false, error: 'empty-text' };
    const voices = getLocalVoices();
    const voice = pickBestLocalVoice(voices, options.lang || 'es');
    if (!voice) return { started: false, error: 'no-local-voice' };

    let utterance: SpeechSynthesisUtterance;
    try {
        utterance = new SpeechSynthesisUtterance(clean);
    } catch {
        console.warn('[catch] src/services/localTts.ts');
        return { started: false, error: 'utterance-unsupported' };
    }

    const matched = synth.getVoices().find((v) => v.voiceURI === voice.voiceURI);
    // No forzar una voz de OTRO idioma (leería el texto en inglés): si la voz
    // elegida no comparte idioma con el solicitado, se deja sin voz para que el
    // motor use el `lang` pedido (evita "narración en inglés").
    const requested = (options.lang || 'es').trim().toLowerCase();
    const requestedFamily = requested.split('-')[0];
    const voiceLang = String(voice.lang || '').toLowerCase();
    const sameLanguage =
        voiceLang === requested || (!!requestedFamily && voiceLang.startsWith(requestedFamily));
    if (matched && sameLanguage) utterance.voice = matched;
    utterance.lang = sameLanguage ? voice.lang : (options.lang || 'es');
    if (typeof options.rate === 'number') utterance.rate = options.rate;
    if (typeof options.pitch === 'number') utterance.pitch = options.pitch;

    utterance.onstart = () => options.onStart?.();
    utterance.onend = () => options.onEnd?.();
    utterance.onerror = (event) => {
        // cancel() dispara un evento 'canceled' que no debe tratarse como error.
        if (event && event.error === 'canceled') {
            options.onEnd?.();
            return;
        }
        options.onError?.(event);
    };

    // Evita solapamiento con reproducciones anteriores.
    synth.cancel();
    synth.speak(utterance);
    return { started: true };
}

/** Detiene cualquier reproducción de voz local en curso. */
export function stopLocalSpeech(): void {
    const synth = getSpeechSynthesis();
    if (synth) {
        synth.cancel();
    }
}

/**
 * Limpia markdown/símbolos para NARRAR: evita leer "slash slash", viñetas,
 * almohadillas o separadores de tabla. Fuente única de la narración (el TTS
 * nunca habla marcas).
 */
export function sanitizeForNarration(text = ''): string {
    return String(text || '')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s*/gm, '')
        .replace(/^\s*[-+*]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        .replace(/[*_~>|;]/g, ' ')
        .replace(/\//g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/**
 * Divide el contenido generado en segmentos narrables por sección.
 * Cada encabezado de Markdown (#..######) abre una nueva sección; el
 * texto previo al primer encabezado se agrupa como "Introducción".
 */
export function buildLocalNarrationSegments(content: string, _language = 'es'): NarrationSegment[] {
    if (!content || !content.trim()) return [];
    const lines = content.trim().split(/\r?\n/);
    const heading = /^#{1,6}\s+(.+)$/;
    const segments: NarrationSegment[] = [];
    let title = 'Introducción';
    let buffer: string[] = [];
    let index = 0;

    const flush = () => {
        const text = sanitizeForNarration(buffer.join('\n'));
        if (text) {
            segments.push({ index: index, title, text });
            index += 1;
        }
        buffer = [];
    };

    for (const line of lines) {
        const match = heading.exec(line.trim());
        if (match) {
            flush();
            title = sanitizeForNarration(match[1]) || 'Sección';
        } else {
            buffer.push(line);
        }
    }
    flush();

    if (segments.length === 0 && content.trim()) {
        segments.push({ index: 0, title: 'Introducción', text: sanitizeForNarration(content) });
    }
    return segments;
}
