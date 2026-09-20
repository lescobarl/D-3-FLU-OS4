// ============================================================
// Text engine (deepseek.ts) — Adapter de transporte OpenAI-compatible
// ============================================================
// ADAPTER: la orquestación común vive en src/core/ai/aiServiceBase.ts
// (BaseAIService, implementación única de IAIService). Este archivo solo
// aporta:
//   - el transporte de red por operación: UNA ruta, el endpoint
//     OpenAI-compatible (fetchTextEngine → buildTextApiUrl('/chat/completions'))
//   - las variantes de normalización propias del motor de texto
//
// Por defecto usa OpenRouter → Google Gemini 2.5 Flash:
//   https://openrouter.ai/api/v1/chat/completions  (model: google/gemini-2.5-flash)
// Configurable desde Ajustes → "Texto": modelo, clave y URL
// (STORAGE_KEYS.TEXT_MODEL / TEXT_API_KEY / TEXT_API_URL).
// También soporta endpoints locales (Ollama / LM Studio / localhost) para
// F1/F2/F3 en modo 100% local (isLocalTextEndpoint), sin requerir clave API.
// ============================================================

import { DEEPSEEK_CONFIG, OPENROUTER_CONFIG, STORAGE_KEYS, buildPollinationsUrl, buildTextApiUrl, isLocalTextEndpoint, readStorage } from '../core/config/appConfig';
import { fetchTextEngine } from '../core/ai/httpClient';
import type {
    AIRequestOptions,
    AIHistoryEntry,
    AIParticipantEvaluation,
    AIWorkspaceImageResult,
    AISummaryResult,
} from '../core/ai/IAIService';
import {
    BaseAIService,
    type AIVisionAnalysisResult,
    type MinuteRequest,
    type TextCompletionRequest,
} from '../core/ai/aiServiceBase';

// -----------------------------------------------------------
// Helpers específicos del transporte de texto
// -----------------------------------------------------------

/**
 * Resolve the text engine API key from direct param, text-specific localStorage key, or env.
 * (Backward-compatible with VITE_DEEPSEEK_API_KEY via OPENROUTER_CONFIG.API_KEY fallback.)
 */
function resolveDeepSeekApiKey(apiKey: string = ''): { apiKey: string; apiKeySource: string } {
    if (apiKey && apiKey.trim()) {
        return { apiKey: apiKey.trim(), apiKeySource: 'param' };
    }

    const stored = (() => {
        try { return localStorage.getItem(STORAGE_KEYS.TEXT_API_KEY); } catch {
        console.warn('[catch] src/services/deepseek.ts'); return null; }
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
 * Resolve creativity temperature for the text engine requests.
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
        console.warn('[catch] src/services/deepseek.ts');
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
// DeepSeekService — Adapter de transporte (endpoint OpenAI-compatible)
// -----------------------------------------------------------

/**
 * Adapter que implementa IAIService delegando la orquestación en
 * BaseAIService y todo el transporte en el endpoint OpenAI-compatible
 * (OpenRouter por defecto; Ollama/LM Studio admitidos).
 */
class DeepSeekService extends BaseAIService {
    protected readonly engineLabel = 'DeepSeek';

    protected canUseTextBackend(): boolean {
        return hasUsableTextBackend();
    }

    protected documentAnalysisSystem(language: string): string {
        return language === 'en'
            ? 'You are a document analyst. Respond in English only.'
            : 'Eres un analista de documentos. Responde únicamente en español.';
    }

    /**
     * POST a chat completion y devuelve el contenido crudo.
     * Ruta única de F1/F2/F3 de este adapter.
     */
    protected async completeText(request: TextCompletionRequest): Promise<string> {
        return this.postJson(
            [
                { role: 'system', content: request.system },
                { role: 'user', content: request.prompt },
            ],
            { maxTokens: request.maxTokens, timeoutMs: request.timeoutMs, jsonMode: request.jsonMode },
        );
    }

    /**
     * Minuta desde el motor de texto. Devuelve el JSON OS2 ya parseado.
     */
    protected async fetchMinute(request: MinuteRequest): Promise<Record<string, unknown>> {
        const { apiKey } = resolveDeepSeekApiKey(request.options.apiKey);
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }

        const temperature = resolveCreativityTemperature();
        const model = readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL);
        const url = buildTextApiUrl('/chat/completions');

        const messages = [
            {
                role: 'system',
                content: request.systemPrompt
            },
            {
                role: 'user',
                content: `Generate a minute from this conversation:\n${request.conversationLog}\n\nEmotional state: ${request.emotionalState}`
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
                console.warn('[catch] src/services/deepseek.ts');
                // Fallback if JSON parsing fails
                parsed = {};
            }
            return parsed as Record<string, unknown>;
        } catch (error) {
            console.error('Text engine generateMinute error:', error);
            throw error;
        }
    }

    /**
     * Resumen de conversación: alias de generateMinute con estado neutral.
     */
    protected async fetchSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult> {
        // Alias of generateMinute (same OS2 minute format)
        return this.generateMinute(options, history, 'neutral');
    }

    /**
     * Respuesta contextual desde el motor de texto.
     */
    protected async fetchResponse(
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
     * Evaluación de intervención de FLU desde el motor de texto.
     */
    protected async fetchEvaluation(
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
                console.warn('[catch] src/services/deepseek.ts');
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
     * Imagen de workspace: Pollinations.ai directo (stateless, sin clave).
     */
    protected async fetchImage(
        prompt: string,
        tipoStr: string,
        language: string,
    ): Promise<AIWorkspaceImageResult> {
        void tipoStr;
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
        } catch (error: unknown) {
            const detail = error && typeof error === 'object' && 'message' in error ? error.message : error;
            console.warn('[Text engine] Workspace image generation failed:', detail || error);
            return {
                image_url: '',
                trace: {
                    provider: 'error',
                    hasImage: false,
                    source: 'generation_failed',
                    error: detail || 'unknown',
                    prompt,
                },
            };
        }
    }

    /**
     * Visión multimodal desde el motor de texto (Gemini 2.5 Flash Lite — OCR).
     */
    protected async fetchVision(
        imageBase64: string,
        mimeType: string,
        language: string,
        profile: string,
    ): Promise<AIVisionAnalysisResult> {
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
                console.warn('[catch] src/services/deepseek.ts');
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
     * POST a chat completion y devuelve el contenido crudo (JSON-object mode).
     */
    private async postJson(
        messages: Array<{ role: string; content: string }>,
        options: { maxTokens?: number; temperature?: number; timeoutMs?: number; jsonMode?: boolean } = {},
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
        // jsonMode=false (generación de documentos/guiones) pide markdown/texto libre,
        // por lo que NO se fuerza response_format json_object (rompía el contenido).
        if (!local && options.jsonMode !== false) body.response_format = { type: 'json_object' };

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
}

// Export singleton instance
export const deepseekService = new DeepSeekService();
