// ============================================================
// Text engine (deepseek.ts) — Motor de texto OpenAI-compatible
// ============================================================
// Implementa IAIService y enruta TODO el texto a través de un endpoint
// OpenAI-compatible. Por defecto usa OpenRouter → Google Gemini 2.5 Flash:
//   https://openrouter.ai/api/v1/chat/completions  (model: google/gemini-2.5-flash)
//
// Arquitectura (SOLO 2 APIs):
//   - Imágenes → Pollinations.ai (buildPollinationsUrl, sin clave)
//   - Texto    → OpenRouter (Gemini 2.5 Flash Lite) vía buildTextApiUrl
//
// Configurable desde Ajustes → "Texto": modelo, clave y URL
// (STORAGE_KEYS.TEXT_MODEL / TEXT_API_KEY / TEXT_API_URL).
//
// También soporta endpoints locales (Ollama / LM Studio / localhost) para
// F1/F2/F3 en modo 100% local (isLocalTextEndpoint), sin requerir clave API.
// ============================================================

import { DEEPSEEK_CONFIG, GENERATION_TIMEOUT_MS, OPENROUTER_CONFIG, STORAGE_KEYS, VALID_VISUAL_TIPOS, WORKSPACE_TIPOS, buildPollinationsUrl, buildTextApiUrl, isLocalTextEndpoint, readStorage } from '../core/config/appConfig';
import { buildMinuteSystemPrompt } from '../core/ai/prompts';
import { fetchTextEngine } from '../core/ai/httpClient';
import { buildCapabilitiesPrompt } from './capabilities';
import type {
    IAIService,
    AIRequestOptions,
    AIHistoryEntry,
    AIMinuteResult,
    AISummaryResult,
    AIParticipantEvaluation,
    AIWorkspaceImageResult,
    DocumentAnalysisInput,
    AppAnalysisInput,
    GenerationInput,
    GeneratedDocumentResult,
} from '../core/ai/IAIService';
import type { FluContract, FluDiagnostics } from '../types/bridge';
import type { DocumentContract, AppAnalysisContract } from '../types/documentContracts';
import {
    buildMapPrompt,
    buildReducePrompt,
    buildSingleAnalysisPrompt,
    mergePartialSummaries,
    applyReduceToContract,
} from '../lib/documentChunker';
import type { ChunkContext, PartialSummary } from '../lib/documentChunker';
import { serializeDocument } from '../lib/formatAdapters';
import { buildBaseDocumentContract, buildHeuristicAppAnalysis } from '../lib/analysisFallbacks';
import {
    buildGenerationPrompt,
    buildGenerationSystemPrompt,
    buildGenerationFallbackContent,
} from '../lib/generationPrompts';

// -----------------------------------------------------------
// Helpers
// -----------------------------------------------------------

/**
 * Build diagnostics metadata for a text engine response.
 */
function buildDiagnostics(apiKeySource: string, model?: string): FluDiagnostics {
    const savedModel = (() => {
        try { return localStorage.getItem(STORAGE_KEYS.TEXT_MODEL); } catch { return null; }
    })();
    return {
        provider: 'openrouter',
        model: model || savedModel || OPENROUTER_CONFIG.MODEL,
        apiKeySource,
    };
}

/**
 * Resolve the text engine API key from direct param, text-specific localStorage key, or env.
 * (Backward-compatible with VITE_DEEPSEEK_API_KEY via OPENROUTER_CONFIG.API_KEY fallback.)
 */
function resolveDeepSeekApiKey(apiKey: string = ''): { apiKey: string; apiKeySource: string } {
    if (apiKey && apiKey.trim()) {
        return { apiKey: apiKey.trim(), apiKeySource: 'param' };
    }

    const stored = (() => {
        try { return localStorage.getItem(STORAGE_KEYS.TEXT_API_KEY); } catch { return null; }
    })();
    if (stored && stored.trim()) {
        return { apiKey: stored.trim(), apiKeySource: 'localStorage' };
    }

    const envKey = OPENROUTER_CONFIG.API_KEY || DEEPSEEK_CONFIG.API_KEY;
    if (envKey && envKey.trim()) {
        return { apiKey: envKey.trim(), apiKeySource: 'env' };
    }

    return { apiKey: '', apiKeySource: 'none' };
}

/**
 * Resolve creativity temperature for DeepSeek requests.
 */
function resolveCreativityTemperature(): number | undefined {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CREATIVITY);
        if (stored) {
            const value = parseFloat(stored);
            if (!isNaN(value) && value >= 0 && value <= 1) {
                return value;
            }
        }
    } catch {
        // ignore
    }
    return OPENROUTER_CONFIG.DEFAULT_TEMPERATURE;
}

/**
 * Determine whether a usable text backend is configured for F1/F2/F3 and for
 * the FLU participant evaluation gate (useFluParticipant.runEvaluation).
 * Returns true when an API key is present OR the configured TEXT_API_URL is a
 * local endpoint (Ollama / LM Studio / localhost) that does not need a key.
 */
export function hasUsableTextBackend(): boolean {
    const { apiKey } = resolveDeepSeekApiKey();
    if (apiKey) return true;
    const url = buildTextApiUrl('/chat/completions');
    return isLocalTextEndpoint(url);
}

/**
 * Parsea JSON de forma segura; devuelve null si falla (nunca lanza).
 */
function safeParseJson(text: string): any | null {
    if (!text || !text.trim()) return null;
    try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object') return value;
        // El LLM a veces envuelve el JSON en bloques ```json ... ```
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) {
            return JSON.parse(match[1]);
        }
        return null;
    } catch {
        try {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch {
            return null;
        }
        return null;
    }
}

/**
 * FASE P — Personalización profunda por persona.
 * El motor de texto (OpenRouter) se invoca directamente (sin proxy), así que el
 * nivel de explicación, el tono y los rasgos se inyectan en el systemPrompt local.
 * Devuelve una cadena vacía cuando no hay personalización activa (sin cambios de
 * comportamiento en el caso por defecto).
 */
function buildPersonalizationRule(options: AIRequestOptions, isEnglish: boolean): string {
    const parts: string[] = [];
    if (options.traits && options.traits.length > 0) {
        parts.push(
            isEnglish
                ? `Your personality traits are: ${options.traits.join(', ')}.`
                : `Tus rasgos de personalidad son: ${options.traits.join(', ')}.`,
        );
    }
    if (options.tone) {
        parts.push(
            isEnglish
                ? `Your communication tone is: ${options.tone}.`
                : `Tu tono de comunicacion es: ${options.tone}.`,
        );
    }
    if (options.explanationLevel) {
        parts.push(
            isEnglish
                ? `Explanation level: ${options.explanationLevel}. Adjust the depth of your answers to match this level (simple = short and plain, detallado = thorough with steps and examples, avanzado = technical and advanced).`
                : `Nivel de explicacion: ${options.explanationLevel}. Ajusta la profundidad de tus respuestas a ese nivel (simple = breve y claro, detallado = a fondo con pasos y ejemplos, avanzado = tecnico).`,
        );
    }
    return parts.length > 0 ? `\n\n${parts.join(' ')}` : '';
}

// -----------------------------------------------------------
// DeepSeekService — Implementation of IAIService
// -----------------------------------------------------------

/**
 * Text engine implementing the IAIService interface.
 * Routes all text through an OpenAI-compatible endpoint (default:
 * OpenRouter → Google Gemini 2.5 Flash Lite). Provides all AI-powered
 * features: minutas, chat, contrato, evaluación, visión y F1/F2/F3.
 */
class DeepSeekService implements IAIService {
    /**
     * Generate a minute from conversation history using the text engine.
     */
    async generateMinute(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
        emotionalState: string,
    ): Promise<AIMinuteResult> {
        const { apiKey } = resolveDeepSeekApiKey(options.apiKey);
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }

        const temperature = resolveCreativityTemperature();
        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const url = buildTextApiUrl('/chat/completions');
        const isEnglish = options.language === 'en';

        // Build conversation log
        const conversationLog = history
            .map((e) => `${e.speakerName || (e.role === 'user' ? (isEnglish ? 'User' : 'Usuario') : 'FLU')}: ${e.text}`)
            .join('\n');

        // Build system prompt (single source of truth — src/core/ai/prompts.ts, Rule #1)
        const systemPrompt = buildMinuteSystemPrompt(isEnglish);

        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: `Generate a minute from this conversation:\n${conversationLog}\n\nEmotional state: ${emotionalState}`
            }
        ];

        try {
            const response = await fetchTextEngine(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: temperature || 0.7,
                    max_tokens: 1000,
                    response_format: { type: 'json_object' }
                }),
            });

            if (!response.ok) {
                throw new Error(`Text API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const responseText = data.choices[0]?.message?.content || '{}';
            
            // Parse JSON response
            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch {
                // Fallback if JSON parsing fails
                parsed = {};
            }

            // Return in OS2-compatible format
            return {
                titulo: String(parsed.titulo || '') || (isEnglish
                    ? `Minutes - ${new Date().toLocaleDateString('en-US')}`
                    : `Minuta - ${new Date().toLocaleDateString('es-MX')}`),
                participantes: Array.isArray(parsed.participantes) ? parsed.participantes as string[] : [],
                resumen: String(parsed.resumen || '') || conversationLog,
                acuerdos: Array.isArray(parsed.acuerdos) ? parsed.acuerdos as string[] : [],
                pendientes: Array.isArray(parsed.pendientes) ? parsed.pendientes as string[] : [],
                siguientes_pasos: Array.isArray(parsed.siguientes_pasos) ? parsed.siguientes_pasos as string[] : [],
            };
        } catch (error) {
            console.error('Text engine generateMinute error:', error);
            throw error;
        }
    }

    /**
     * Generate a contextual response using the text engine.
     */
    async generateResponse(
        options: AIRequestOptions,
        userText: string,
        botName: string,
        history: AIHistoryEntry[],
    ): Promise<string> {
        const { apiKey } = resolveDeepSeekApiKey(options.apiKey);
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }

        const temperature = resolveCreativityTemperature();
        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const url = buildTextApiUrl('/chat/completions');
        const isEnglish = options.language === 'en';

        // Format conversation context
        const messages = [
            {
                role: 'system',
                content: `You are ${botName}, a conversational assistant. Respond naturally and helpfully in ${isEnglish ? 'English' : 'Spanish'}.` + buildPersonalizationRule(options, isEnglish),
            },
            ...history.map(entry => ({
                role: entry.role === 'user' ? 'user' : 'assistant',
                content: entry.text
            })),
            {
                role: 'user',
                content: userText
            }
        ];

        try {
            const response = await fetchTextEngine(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: temperature || 0.7,
                    max_tokens: 500,
                }),
            });

            if (!response.ok) {
                throw new Error(`Text API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices[0]?.message?.content || '';
        } catch (error) {
            console.error('Text engine generateResponse error:', error);
            throw error;
        }
    }

    /**
     * Evaluate whether FLU should intervene.
     */
    async generateParticipantEvaluation(
        options: AIRequestOptions,
        conversationLog: string,
        maxDraftChars: number = 200,
    ): Promise<AIParticipantEvaluation> {
        const { apiKey } = resolveDeepSeekApiKey(options.apiKey);
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }

        const temperature = resolveCreativityTemperature();
        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const url = buildTextApiUrl('/chat/completions');
        const isEnglish = options.language === 'en';

        const systemPrompt = isEnglish
            ? `You are FLU, an educational assistant. Analyze the conversation and decide if FLU should intervene.
Response format (JSON):
{
  "intervenir": boolean,
  "motivo_corto": "short reason in Spanish",
  "borrador_aportacion": "draft contribution text",
  "confianza": number between 0 and 1
}`
            : `Eres FLU, un asistente educativo. Analiza la conversación y decide si FLU debe intervenir.
Formato de respuesta (JSON):
{
  "intervenir": boolean,
  "motivo_corto": "razón corta en español",
  "borrador_aportacion": "texto de aportación borrador",
  "confianza": número entre 0 y 1
}`;

        const messages = [
            {
                role: 'system',
                content: systemPrompt
            },
            {
                role: 'user',
                content: `Conversation:\n${conversationLog}\n\nShould FLU intervene? Provide evaluation.`
            }
        ];

        try {
            const response = await fetchTextEngine(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: temperature || 0.7,
                    max_tokens: 300,
                    response_format: { type: 'json_object' }
                }),
            });

            if (!response.ok) {
                throw new Error(`Text API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const responseText = data.choices[0]?.message?.content || '{}';
            
            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch {
                parsed = { intervenir: false, motivo_corto: '', borrador_aportacion: '', confianza: 0.5 };
            }

            return {
                intervenir: Boolean(parsed.intervenir),
                motivo_corto: String(parsed.motivo_corto || ''),
                borrador_aportacion: String(parsed.borrador_aportacion || '').slice(0, maxDraftChars),
                confianza: Math.max(0, Math.min(1, Number(parsed.confianza) || 0.5)),
            };
        } catch (error) {
            console.error('Text engine generateParticipantEvaluation error:', error);
            throw error;
        }
    }

    /**
     * Generate a conversation summary (OS2 style).
     */
    async generateConversationSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult> {
        // Alias of generateMinute (same OS2 minute format)
        return this.generateMinute(options, history, 'neutral');
    }

    /**
     * Generate a contract (response + navigation + workspace) using the text engine.
     * Calls the OpenAI-compatible chat API with a structured prompt that asks for JSON
     * output matching the FluContract interface.
     */
    async generateFluContract(
        options: AIRequestOptions,
        transcript: string,
        history: AIHistoryEntry[],
    ): Promise<FluContract> {
        const { apiKey } = resolveDeepSeekApiKey(options.apiKey);
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }

        const temperature = resolveCreativityTemperature();
        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const url = buildTextApiUrl('/chat/completions');
        const isEnglish = options.language === 'en';

        // Build conversation context from history
        const conversationLog = history
            .map((e) => `${e.speakerName || (e.role === 'user' ? (isEnglish ? 'User' : 'Usuario') : 'FLU')}: ${e.text}`)
            .join('\n');

        const baseSystemPrompt = isEnglish
            ? `You are FLU, an educational assistant that generates structured responses.
Your task is to analyze the conversation and the user's latest message, then respond in JSON format.

Response format (JSON):
{
  "respuesta_voz": "your spoken response in English",
  "navegacion": {
    "comando": "FLU_WAKE" | "INICIAR_CONVERSACION" | "CERRAR_ESCUCHA" | "ABRIR_ESCUCHA" | "NAVEGAR" | "BUSCAR" | null,
    "destino": "screen_id" | null,
    "parametros": {}
  },
  "workspace": {
    "titulo": "short title",
    "tipo": "text" | "image_prompt" | "diagram" | "3d" | null,
    "contenido": "text content",
    "prompt_visual": "image generation prompt",
    "puntos_clave": ["key point 1", "key point 2"]
  } | null,
  "animacion": "animation_name" | null,
  "emocion": "emotion_name" | null,
  "musica": {
    "accion": "play_music" | "pause_music" | "stop_music" | null,
    "cancion": "song id or title"
  } | null
}

Rules:
- respuesta_voz is REQUIRED and must be a natural, conversational response
- navegacion.comando should be set when the user wants to navigate or control FLU; use "NAVEGAR" when the user asks to open, navigate to or search a curated site (e.g. "navegar a wikipedia", "abre wikipedia", "busca en wikipedia") and fill navegacion.parametros.sitio with the site name
- use "BUSCAR" when the user asks to search the web in general (e.g. "buscá capital de Francia", "search the capital of France", "qué significa X") and fill navegacion.parametros.consulta with the search query
- use "INICIAR_CONVERSACION" ONLY when the user explicitly asks to start, begin or reset the conversation/session (e.g. "iniciar conversación", "empezar conversación", "nueva conversación", "start a new conversation"). NEVER set it for an ordinary conversational question or request for information; those are plain answers with navegacion.comando = null.
- use "CERRAR_ESCUCHA" ONLY when the user explicitly asks to stop/close the listening (e.g. "cerrar escucha", "dejar de escuchar", "stop listening"). NEVER set it after answering a normal question.
- use "ABRIR_ESCUCHA" ONLY when the user explicitly asks to resume/open the listening (e.g. "abrir escucha", "seguir escuchando", "resume listening"). NEVER set it for a normal question.
- workspace should be set when the user asks for content creation
- animacion and emocion are optional hints for avatar behavior
- musica should be set when the user asks to play, pause or stop music; cancion can be a playlist id or title (plays instantly) or any song name (FLU searches it online, public domain)

${buildCapabilitiesPrompt('en')}`
            : `Eres FLU, un asistente educativo que genera respuestas estructuradas.
Tu tarea es analizar la conversación y el último mensaje del usuario, luego responder en formato JSON.

Formato de respuesta (JSON):
{
  "respuesta_voz": "tu respuesta hablada en español",
  "navegacion": {
    "comando": "FLU_WAKE" | "INICIAR_CONVERSACION" | "CERRAR_ESCUCHA" | "ABRIR_ESCUCHA" | "NAVEGAR" | "BUSCAR" | null,
    "destino": "screen_id" | null,
    "parametros": {}
  },
  "workspace": {
    "titulo": "título corto",
    "tipo": "text" | "image_prompt" | "diagram" | "3d" | null,
    "contenido": "contenido de texto",
    "prompt_visual": "prompt para generar imagen",
    "puntos_clave": ["punto clave 1", "punto clave 2"]
  } | null,
  "animacion": "nombre_animacion" | null,
  "emocion": "nombre_emocion" | null,
  "musica": {
    "accion": "play_music" | "pause_music" | "stop_music" | null,
    "cancion": "id o título de canción"
  } | null
}

Reglas:
- respuesta_voz es REQUERIDO y debe ser una respuesta natural y conversacional
- navegacion.comando debe establecerse cuando el usuario quiere navegar o controlar FLU; usa "NAVEGAR" cuando pida abrir, navegar o buscar un sitio curado (ej: "navegar a wikipedia", "abre wikipedia", "busca en wikipedia") y llena navegacion.parametros.sitio con el nombre del sitio
- usa "BUSCAR" cuando el usuario pida buscar en la web en general (ej: "buscá capital de Francia", "buscá recetas de cocina", "¿qué significa X?") y llena navegacion.parametros.consulta con la consulta
- usa "INICIAR_CONVERSACION" SOLO cuando el usuario pida explícitamente iniciar, comenzar o reiniciar la conversación/sesión (ej: "iniciar conversación", "empezar conversación", "nueva conversación", "nueva sesión"). NUNCA lo uses para una pregunta conversacional o petición de información normal; esas son respuestas simples con navegacion.comando = null.
- usa "CERRAR_ESCUCHA" SOLO cuando el usuario pida explícitamente detener/cerrar la escucha (ej: "cerrar escucha", "dejar de escuchar", "detener escucha"). NUNCA lo uses tras responder una pregunta normal.
- usa "ABRIR_ESCUCHA" SOLO cuando el usuario pida explícitamente reanudar/abrir la escucha (ej: "abrir escucha", "seguir escuchando", "continuar escuchando"). NUNCA lo uses para una pregunta normal.
- workspace debe establecerse cuando el usuario pide crear contenido
- animacion y emocion son sugerencias opcionales para el comportamiento del avatar
- musica debe establecerse cuando el usuario pide reproducir, pausar o detener música; cancion puede ser un id o título del playlist (suena al instante) o cualquier nombre de canción (FLU la busca en línea, dominio público)

${buildCapabilitiesPrompt('es')}`;

const systemPrompt = baseSystemPrompt + buildPersonalizationRule(options, isEnglish);

const messages = [
            { role: 'system', content: systemPrompt },
            ...history.map(entry => ({
                role: entry.role === 'user' ? 'user' : 'assistant',
                content: entry.text
            })),
            {
                role: 'user',
                content: transcript
                    ? `Latest message: "${transcript}"\n\nConversation so far:\n${conversationLog}`
                    : `Continue the conversation:\n${conversationLog}`
            }
        ];

        try {
            const response = await fetchTextEngine(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    temperature: temperature || 0.7,
                    max_tokens: 800,
                    response_format: { type: 'json_object' }
                }),
            });

            if (!response.ok) {
                throw new Error(`Text API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const responseText = data.choices[0]?.message?.content || '{}';

            let parsed: Record<string, unknown>;
            try {
                parsed = JSON.parse(responseText);
            } catch {
                parsed = {};
            }

            const respuesta_voz = String(parsed.respuesta_voz || '').trim();
            if (!respuesta_voz) {
                const error = new Error('empty_response') as any;
                error.code = 'empty_response';
                throw error;
            }

            const navegacionRaw = (parsed.navegacion || {}) as Record<string, unknown>;
            const workspaceRaw = parsed.workspace as Record<string, unknown> | null;

            return {
                respuesta_voz,
                navegacion: {
                    comando: String(navegacionRaw.comando || '') || null,
                    destino: String(navegacionRaw.destino || '') || null,
                    parametros: (navegacionRaw.parametros as Record<string, unknown>) || {},
                },
                workspace: workspaceRaw
                    ? {
                        titulo: String(workspaceRaw.titulo || '').trim(),
                        tipo: (WORKSPACE_TIPOS.includes(String(workspaceRaw.tipo || '').trim())
                            ? String(workspaceRaw.tipo).trim()
                            : null) as 'text' | 'image_prompt' | 'diagram' | '3d' | null,
                        contenido: String(workspaceRaw.contenido || '').trim(),
                        prompt_visual: String(workspaceRaw.prompt_visual || '').trim(),
                        puntos_clave: Array.isArray(workspaceRaw.puntos_clave)
                            ? workspaceRaw.puntos_clave.map((item: unknown) => String(item || '').trim()).filter(Boolean)
                            : [],
                    }
                    : null,
                animacion: parsed.animacion ? String(parsed.animacion).trim() : undefined,
                emocion: parsed.emocion ? String(parsed.emocion).trim() : undefined,
                musica: (() => {
                    const rawMusica = parsed.musica && typeof parsed.musica === 'object' ? (parsed.musica as any) : undefined;
                    const musicaFromModel =
                        rawMusica &&
                        ['play_music', 'pause_music', 'stop_music'].includes(String(rawMusica.accion || '').trim())
                        ? {
                            accion: String(rawMusica.accion).trim() as 'play_music' | 'pause_music' | 'stop_music',
                            cancion: rawMusica.cancion ? String(rawMusica.cancion).trim() : undefined,
                        }
                        : undefined;
                    return musicaFromModel || undefined;
                })(),
                diagnostics: buildDiagnostics('localStorage', model),
            };
        } catch (error: any) {
            console.error('Text engine generateFluContract error:', error);
            // Re-throw with consistent error shape
            if (error.code === 'empty_response') throw error;
            const wrapped = new Error(error.message || 'Text contract generation failed') as any;
            wrapped.code = error.code || 'text_engine_error';
            wrapped.status = error.status || 500;
            wrapped.detail = error.detail || '';
            wrapped.model = model;
            wrapped.apiKeySource = 'localStorage';
            throw wrapped;
        }
    }

    /**
     * Generate a workspace image from a prompt.
     * Uses Pollinations.ai (free, no API key needed) as the stateless image service.
     */
    async generateWorkspaceImage(
        prompt: string,
        tipo: string | null | undefined,
        language: string = 'es',
    ): Promise<AIWorkspaceImageResult> {
        if (!prompt) {
            return {
                image_url: '',
                trace: { provider: 'none', hasImage: false, source: 'no_prompt' },
            };
        }

        const tipoStr = String(tipo || '').trim().toLowerCase();
        // (VALID_VISUAL_TIPOS centralized in appConfig — Rule #1: NO HARDCODE)
        if (!VALID_VISUAL_TIPOS.includes(tipoStr)) {
            return {
                image_url: '',
                trace: { provider: 'none', hasImage: false, source: 'not_visual_tipo', tipo: tipoStr },
            };
        }

        // Use Pollinations.ai directly (stateless, no API key needed)
        try {
            const imageUrl = buildPollinationsUrl(prompt);
            return {
                image_url: imageUrl,
                trace: {
                    provider: 'pollinations',
                    model: 'pollinations',
                    kind: 'url',
                    source: 'pollinations_ai',
                    hasImage: true,
                    prompt,
                    language,
                },
            };
        } catch (error: any) {
            console.warn('[Text engine] Workspace image generation failed:', error?.message || error);
            return {
                image_url: '',
                trace: {
                    provider: 'error',
                    hasImage: false,
                    source: 'generation_failed',
                    error: error?.message || 'unknown',
                    prompt,
                },
            };
        }
    }

    /**
     * Analyze an image via the multimodal text engine (Gemini 2.5 Flash Lite — OCR/digitalización).
     */
    async generateVisionAnalysis(
        imageBase64: string,
        mimeType: string,
        language: string = 'es',
        profile: string = 'tutor',
    ): Promise<{
        materia: string;
        problemas: string[];
        instrucciones: string;
        nivel: string;
        texto_extraido: string;
    }> {
        const { apiKey } = resolveDeepSeekApiKey();
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }

        // Gemini 2.5 Flash Lite es multimodal: maneja image_url en formato OpenAI.
        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const url = buildTextApiUrl('/chat/completions');

        const messages = [
            {
                role: 'system',
                content: `Eres FLU, un asistente educativo. Analiza la imagen y extrae información educativa.\nIdioma: ${language}\nPerfil: ${profile}\nFormato: JSON con {materia: string, problemas: string[], instrucciones: string, nivel: string, texto_extraido: string}`
            },
            {
                role: 'user',
                content: [
                    {
                        type: 'text',
                        text: 'Analiza esta imagen y extrae información educativa:'
                    },
                    {
                        type: 'image_url',
                        image_url: {
                            url: `data:${mimeType};base64,${imageBase64}`
                        }
                    }
                ]
            }
        ];

        try {
            const response = await fetchTextEngine(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                },
                body: JSON.stringify({
                    model,
                    messages,
                    max_tokens: 1000,
                    response_format: { type: 'json_object' }
                }),
            });

            if (!response.ok) {
                throw new Error(`Vision API error (OpenRouter/Gemini): ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            const responseText = data.choices[0]?.message?.content || '{}';
            
            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch {
                parsed = {
                    materia: 'Desconocida',
                    problemas: [],
                    instrucciones: '',
                    nivel: 'Básico',
                    texto_extraido: ''
                };
            }

            return {
                materia: String(parsed.materia || 'Desconocida'),
                problemas: Array.isArray(parsed.problemas) ? parsed.problemas as string[] : [],
                instrucciones: String(parsed.instrucciones || ''),
                nivel: String(parsed.nivel || 'Básico'),
                texto_extraido: String(parsed.texto_extraido || ''),
            };
        } catch (error) {
            console.error('Text engine generateVisionAnalysis error:', error);
            throw error;
        }
    }

    /**
     * POST a chat completion and return the raw content string (JSON-object mode).
     */
    private async postJson(
        messages: Array<{ role: string; content: any }>,
        options: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
    ): Promise<string> {
        const url = buildTextApiUrl('/chat/completions');
        const local = isLocalTextEndpoint(url);
        const { apiKey } = resolveDeepSeekApiKey();
        if (!apiKey && !local) throw new Error('API key de texto no configurada (OpenRouter/Gemini)');

        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        const body: Record<string, unknown> = {
            model,
            messages,
            max_tokens: options.maxTokens ?? OPENROUTER_CONFIG.DEFAULT_MAX_TOKENS,
            temperature: options.temperature ?? resolveCreativityTemperature(),
        };
        // Local endpoints (Ollama, LM Studio) may not support OpenAI JSON mode.
        if (!local) body.response_format = { type: 'json_object' };

        const response = await fetchTextEngine(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
        }, options.timeoutMs);
        if (!response.ok) {
            throw new Error(`Text API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return String(data.choices?.[0]?.message?.content || '{}');
    }

    /**
     * F1 — analizar un documento (map-reduce sobre los chunks).
     * Degrada elegantemente al contrato heurístico si no hay API key o falla el LLM.
     */
    async analyzeDocument(
        payload: DocumentAnalysisInput,
        language = 'es',
    ): Promise<DocumentContract> {
        const base = buildBaseDocumentContract(payload);
        const ctx: ChunkContext = {
            tipo: base.tipo,
            nombre: base.nombre,
            hojas: base.hojas,
            errores: base.errores,
        };

        if (!hasUsableTextBackend()) return base;

        try {
            const chunks = Array.isArray(payload.chunks) && payload.chunks.length
                ? payload.chunks.filter(Boolean)
                : (payload.rawText ? [payload.rawText] : []);

            if (chunks.length <= 2) {
                const singlePrompt = chunks.length
                    ? buildSingleAnalysisPrompt(chunks.join('\n\n'), ctx, language)
                    : buildSingleAnalysisPrompt('(documento sin texto extraído)', ctx, language);
                const raw = await this.postJson([
                    { role: 'system', content: language === 'en' ? 'You are a document analyst. Respond in English only.' : 'Eres un analista de documentos. Responde únicamente en español.' },
                    { role: 'user', content: singlePrompt },
                ], { maxTokens: 1800 });
                const parsed = safeParseJson(raw);
                return applyReduceToContract(base, {
                    resumen: String(parsed?.resumen || base.resumen),
                    puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    escenarios: Array.isArray(parsed?.escenarios) ? parsed.escenarios : undefined,
                });
            }

            // Fase map: una llamada por chunk (con degradación por chunk).
            const partials: Array<PartialSummary & { indice: number }> = [];
            for (let i = 0; i < chunks.length; i++) {
                try {
                    const raw = await this.postJson([
                        { role: 'system', content: language === 'en' ? 'You are a document analyst. Respond in English only.' : 'Eres un analista de documentos. Responde únicamente en español.' },
                        { role: 'user', content: buildMapPrompt(chunks[i], i + 1, chunks.length, ctx, language) },
                    ], { maxTokens: 900 });
                    const parsed = safeParseJson(raw);
                    partials.push({
                        indice: i + 1,
                        resumen: String(parsed?.resumen || ''),
                        puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    });
                } catch (e) {
                    console.warn(`DeepSeek analyzeDocument map chunk ${i + 1} failed:`, e);
                    partials.push({ indice: i + 1, resumen: '', puntos_clave: [] });
                }
            }

            // Fase reduce: fusión con LLM; respaldo heurístico si falla.
            let reduced: { resumen: string; puntos_clave: string[]; escenarios?: Record<string, unknown>[] };
            try {
                const raw = await this.postJson([
                    { role: 'system', content: language === 'en' ? 'You are a document analyst. Respond in English only.' : 'Eres un analista de documentos. Responde únicamente en español.' },
                    { role: 'user', content: buildReducePrompt(partials, ctx, language) },
                ], { maxTokens: 1800 });
                const parsed = safeParseJson(raw);
                reduced = {
                    resumen: String(parsed?.resumen || ''),
                    puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    escenarios: Array.isArray(parsed?.escenarios) ? parsed.escenarios : undefined,
                };
            } catch (e) {
                console.warn('DeepSeek analyzeDocument reduce failed, using heuristic merge:', e);
                reduced = mergePartialSummaries(partials);
            }
            return applyReduceToContract(base, reduced);
        } catch (error) {
            console.warn('DeepSeek analyzeDocument fallback to heuristic contract:', error);
            return base;
        }
    }

    /**
     * F2 — analizar la funcionalidad de una app (fase estática → contrato).
     * Degrada elegantemente al análisis heurístico si no hay API key.
     */
    async analyzeApp(
        payload: AppAnalysisInput,
        language = 'es',
    ): Promise<AppAnalysisContract> {
        if (!hasUsableTextBackend()) return buildHeuristicAppAnalysis(payload);

        try {
            const raw = await this.postJson([
                { role: 'system', content: language === 'en' ? 'You are an app analyst. Respond in English only. Return valid JSON.' : 'Eres un analista de aplicaciones. Responde únicamente en español. Devuelve JSON válido.' },
                { role: 'user', content: [
                    'Analiza la funcionalidad de la siguiente aplicación (fase estática):',
                    `Proyecto: ${payload.proyecto}`,
                    `Framework: ${payload.framework}`,
                    `Estructura:\n${payload.estructura || '(sin estructura)'}`,
                    `Archivos relevantes (muestra):\n${(payload.archivos || []).join('\n')}`,
                    `Errores detectados: ${(payload.errores_detectados || []).join('; ') || 'ninguno'}`,
                    'Devuelve JSON válido con el formato:',
                    '{"pantallas":[{"id":string,"nombre":string,"proposito":string,"entradas":string[],"acciones":string[],"salidas":string[]}],',
                    '"flujos":[{"nombre":string,"pasos":string[]}],',
                    '"errores_detectados":string[]}',
                    'Solo usa información presente en la estructura proporcionada; no inventes.',
                ].join('\n') },
            ], { maxTokens: 2200 });
            const parsed = safeParseJson(raw);
            const screens = Array.isArray(parsed?.pantallas) ? parsed.pantallas : [];
            const flows = Array.isArray(parsed?.flujos) ? parsed.flujos : [];
            const llmErrors = Array.isArray(parsed?.errores_detectados) ? parsed.errores_detectados.map(String) : [];
            const mergedErrors = Array.from(new Set([
                ...(Array.isArray(payload.errores_detectados) ? payload.errores_detectados : []),
                ...llmErrors,
            ]));
            return {
                proyecto: payload.proyecto || 'Proyecto',
                framework: payload.framework || 'other',
                pantallas: screens.map((s: any) => ({
                    id: String(s?.id || `screen-${Math.random().toString(36).slice(2, 8)}`),
                    nombre: String(s?.nombre || 'Pantalla'),
                    proposito: String(s?.proposito || ''),
                    entradas: Array.isArray(s?.entradas) ? s.entradas.map(String) : [],
                    acciones: Array.isArray(s?.acciones) ? s.acciones.map(String) : [],
                    salidas: Array.isArray(s?.salidas) ? s.salidas.map(String) : [],
                })),
                flujos: flows.map((f: any) => ({
                    nombre: String(f?.nombre || 'Flujo'),
                    pasos: Array.isArray(f?.pasos) ? f.pasos.map(String) : [],
                })),
                errores_detectados: mergedErrors,
            };
        } catch (error) {
            console.warn('DeepSeek analyzeApp fallback to heuristic analysis:', error);
            return buildHeuristicAppAnalysis(payload);
        }
    }

    /**
     * F3 — generar un documento (contenido del LLM serializado por el adaptador).
     * Si ya hay contenido analizado, se serializa directamente; degrada a contenido
     * de respaldo si no hay API key o falla la llamada.
     */
    async generateDocument(
        payload: GenerationInput,
        language = 'es',
    ): Promise<GeneratedDocumentResult> {
        const nombre = payload.fuentes?.[0]?.ref || `flu-${payload.formato}`;
        if (payload.contenido_analizado && payload.contenido_analizado.trim()) {
            return serializeDocument(payload.formato, payload.contenido_analizado, nombre);
        }
        if (!hasUsableTextBackend()) {
            return serializeDocument(payload.formato, buildGenerationFallbackContent(payload, language), nombre);
        }
        try {
            const content = await this.postJson([
                { role: 'system', content: buildGenerationSystemPrompt(language) },
                { role: 'user', content: buildGenerationPrompt(payload, language) },
            ], { maxTokens: 3000, timeoutMs: GENERATION_TIMEOUT_MS });
            return serializeDocument(payload.formato, content, nombre);
        } catch (error) {
            console.warn('Text engine generateDocument fallback to fallback content:', error);
            return serializeDocument(payload.formato, buildGenerationFallbackContent(payload, language), nombre);
        }
    }
}

// Export singleton instance
export const deepseekService = new DeepSeekService();