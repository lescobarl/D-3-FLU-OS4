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

import { OPENROUTER_CONFIG, STORAGE_KEYS, TEXT_TOKEN_LIMITS, buildTextApiUrl, isLocalTextEndpoint, readStorage, resolveTextApiKey } from '../core/config/appConfig';import { resolveApiKey } from '../core/config/sharedConfig';
import { buildPollinationsImageResult } from './pollinationsImage';
import { fetchTextEngine } from '../core/ai/httpClient';
import { logCaughtError } from '../lib/caughtError';
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
import { resolveConfiguredTemperature } from './aiTemperature';

import { pickText } from '../lib/uiStrings';
import { GENERATION_FAILED_SOURCE } from '../lib/generationTrace';
// -----------------------------------------------------------
// Helpers específicos del transporte de texto
// -----------------------------------------------------------

/**
 * Resolve the text engine API key. DELEGA en el resolver central (mismo par que
 * usa `services/gemini.ts`): `resolveApiKey` fija el orden (directa > central) y
 * `resolveTextApiKey` es la unica fuente de la clave (localStorage > env). Antes
 * esta funcion re-implementaba esa resolucion aqui — con su propio orden y sus
 * propias lecturas de localStorage — asi que un cambio en la prioridad dejaba a
 * este motor con otro criterio (ruta doble de secreto).
 */
function resolveDeepSeekApiKey(apiKey: string = ''): { apiKey: string; apiKeySource: string } {
    return resolveApiKey(apiKey, resolveTextApiKey);
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
export function buildPersonalizationRule(options: AIRequestOptions, isEnglish: boolean): string {
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

    canUseTextBackend(): boolean {
        return hasUsableTextBackend();
    }

    protected documentAnalysisSystem(language: string): string {
        return pickText(language, 'eres_un_analista_de_documentos_responde_un');
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

        const temperature = request.options.temperature ?? resolveConfiguredTemperature();
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
            const response = await this.fetchTextCompletion({
                apiKey,
                url,
                model,
                messages,
                temperature,
                maxTokens: TEXT_TOKEN_LIMITS.json,
                jsonMode: true,
            });

            const parsed = await this.readJsonResponse<Record<string, unknown>>(response, {}, 'Text API error');
            return parsed;
        } catch (error) {
            logCaughtError('src/services/deepseek.ts', error);
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
    /**
     * Resuelve el preambulo de una llamada de texto (clave, temperatura, modelo,
     * URL e idioma). Dueño unico de ese bloque en el adaptador.
     * @param options Opciones de la peticion de IA.
     * @returns Parametros ya resueltos para el fetch.
     */
    private resolveTextCall(options: AIRequestOptions): {
        apiKey: string;
        temperature: number | undefined;
        model: string;
        url: string;
        isEnglish: boolean;
    } {
        const { apiKey } = resolveDeepSeekApiKey(options.apiKey);
        if (!apiKey) {
            throw new Error('API key de texto no configurada (OpenRouter/Gemini)');
        }
        return {
            apiKey,
            temperature: options.temperature ?? resolveConfiguredTemperature(),
            model: readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL),
            url: buildTextApiUrl('/chat/completions'),
            isEnglish: options.language === 'en',
        };
    }

    /**
     * Lee la respuesta del API de texto y parsea su JSON con un respaldo.
     * Dueño unico del "chequeo ok + parseo + respaldo": las tres llamadas del
     * adaptador (texto, evaluacion, vision) la consumen en vez de repetirla.
     * @param response Respuesta cruda de fetch.
     * @param fallback Objeto que se devuelve si el JSON no se puede parsear.
     * @param errorLabel Prefijo del error cuando la respuesta no es ok.
     * @returns JSON parseado o el respaldo.
     */
    private async readJsonResponse<T>(response: Response, fallback: T, errorLabel: string): Promise<T> {
        if (!response.ok) {
            throw new Error(`${errorLabel}: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        const responseText = data.choices[0]?.message?.content || '{}';

        try {
            return JSON.parse(responseText) as T;
        } catch (e) {
            logCaughtError('src/services/deepseek.ts', e);
            return fallback;
        }
    }

    protected async fetchResponse(
        options: AIRequestOptions,
        userText: string,
        botName: string,
        history: AIHistoryEntry[],
    ): Promise<string> {
        const { apiKey, temperature, model, url, isEnglish } = this.resolveTextCall(options);

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
            const response = await this.fetchTextCompletion({
                apiKey,
                url,
                model,
                messages,
                temperature,
                maxTokens: TEXT_TOKEN_LIMITS.chat,
                jsonMode: false,
            });

            if (!response.ok) {
                throw new Error(`Text API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            return data.choices[0]?.message?.content || '';
        } catch (error) {
            logCaughtError('src/services/deepseek.ts', error);
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
        const { apiKey, temperature, model, url, isEnglish } = this.resolveTextCall(options);

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
            const response = await this.fetchTextCompletion({
                apiKey,
                url,
                model,
                messages,
                temperature,
                maxTokens: TEXT_TOKEN_LIMITS.brief,
                jsonMode: true,
            });

            const parsed = await this.readJsonResponse(
                response,
                { intervenir: false, motivo_corto: '', borrador_aportacion: '', confianza: 0.5 },
                'Text API error',
            );

            return {
                intervenir: Boolean(parsed.intervenir),
                motivo_corto: String(parsed.motivo_corto || ''),
                borrador_aportacion: String(parsed.borrador_aportacion || '').slice(0, maxDraftChars),
                confianza: Math.max(0, Math.min(1, Number(parsed.confianza) || 0.5)),
            };
        } catch (error) {
            logCaughtError('src/services/deepseek.ts', error);
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
            return buildPollinationsImageResult(prompt, language);
        } catch (error: unknown) {
            const detail = error && typeof error === 'object' && 'message' in error ? error.message : error;
            logCaughtError('[Text engine] Workspace image generation failed', detail || error);
            return {
                image_url: '',
                trace: {
                    provider: 'error',
                    hasImage: false,
                    source: GENERATION_FAILED_SOURCE,
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
                    max_tokens: TEXT_TOKEN_LIMITS.json,
                    response_format: { type: 'json_object' }
                }),
            });

            const parsed = await this.readJsonResponse(
                response,
                {
                    materia: 'Desconocida',
                    problemas: [],
                    instrucciones: '',
                    nivel: 'Básico',
                    texto_extraido: ''
                },
                'Vision API error (OpenRouter/Gemini)',
            );

            return {
                materia: String(parsed.materia || 'Desconocida'),
                problemas: Array.isArray(parsed.problemas) ? parsed.problemas as string[] : [],
                instrucciones: String(parsed.instrucciones || ''),
                nivel: String(parsed.nivel || 'Básico'),
                texto_extraido: String(parsed.texto_extraido || ''),
            };
        } catch (error) {
            logCaughtError('src/services/deepseek.ts', error);
            throw error;
        }
    }

    /**
     * POST unico al endpoint OpenAI-compatible. Dueno del cuerpo de red
     * (headers + model/messages/temperature/max_tokens + json mode): `postJson`,
     * minuta, respuesta y evaluacion lo consumen. `jsonMode: false` NO fuerza
     * response_format (endpoints locales la rechazan).
     */
    private async fetchTextCompletion(args: {
        apiKey: string;
        url: string;
        model: string;
        messages: Array<{ role: string; content: string }>;
        temperature?: number;
        maxTokens?: number;
        jsonMode?: boolean;
        timeoutMs?: number;
    }): Promise<Response> {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (args.apiKey) headers.Authorization = `Bearer ${args.apiKey}`;
        const body: Record<string, unknown> = {
            model: args.model,
            messages: args.messages,
            max_tokens: args.maxTokens ?? OPENROUTER_CONFIG.DEFAULT_MAX_TOKENS,
            temperature: args.temperature ?? resolveConfiguredTemperature(),
        };
        if (args.jsonMode !== false) body.response_format = { type: 'json_object' };
        return fetchTextEngine(
            args.url,
            { method: 'POST', headers, body: JSON.stringify(body) },
            args.timeoutMs,
        );
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

        const response = await this.fetchTextCompletion({
            apiKey,
            url,
            model: readStorage(STORAGE_KEYS.TEXT_MODEL, OPENROUTER_CONFIG.MODEL),
            messages,
            maxTokens: options.maxTokens,
            temperature: options.temperature,
            // Local endpoints (Ollama, LM Studio) may not support OpenAI JSON mode.
            // jsonMode=false (generación de documentos/guiones) pide markdown/texto libre,
            // por lo que NO se fuerza response_format json_object (rompía el contenido).
            jsonMode: !local && options.jsonMode !== false,
            timeoutMs: options.timeoutMs,
        });
        if (!response.ok) {
            throw new Error(`Text API error: ${response.status} ${response.statusText}`);
        }
        const data = await response.json();
        return String(data.choices?.[0]?.message?.content || '{}');
    }
}

// Export singleton instance
export const deepseekService = new DeepSeekService();
