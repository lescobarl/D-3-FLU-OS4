// ============================================================
// GeminiService — Adapter de transporte (proxy Gemini) sobre el motor único
// ============================================================
// ADAPTER: la orquestación común vive en src/core/ai/aiServiceBase.ts
// (BaseAIService, implementación única de IAIService). Este archivo solo
// aporta:
//   - el transporte de red por operación (SIEMPRE por el proxy Vite:
//     /api/gemini/contract, /api/gemini/participant-eval, /api/gemini/vision,
//     /api/gemini/text y Pollinations directo para imagen stateless)
//   - las variantes de normalización propias del proxy
//   - generateFluContract (contrato de voz, específico de este backend)
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuración desde appConfig
//   - Rule #3: NO `new` en lógica de negocio — DI via interfaces
//   - §8.6/§10.2: implementación única (guard aiServiceSingleImplGuard)
// ============================================================

import { GEMINI_CONFIG, STORAGE_KEYS, WORKSPACE_TIPOS, buildPollinationsUrl, readStorage, resolveTextApiKey } from '../core/config/appConfig';
import { buildMinuteSystemPrompt } from '../core/ai/prompts';
import { useIntegrationStore } from '../store/integrationStore';
import type {
    IAIService,
    AIRequestOptions,
    AIHistoryEntry,
    AISummaryResult,
    AIParticipantEvaluation,
    AIWorkspaceImageResult,
} from '../core/ai/IAIService';
import type { FluAccion, FluContract, FluDiagnostics } from '../types/bridge';
import { postGeminiContract } from './geminiContractClient';
import { logCaughtError } from '../lib/caughtError';
import { resolveApiKey } from '../core/config/sharedConfig';
import { fetchTextEngineResilient, REQUEST_TIMEOUT_PRESETS } from '../core/ai/httpClient';
import {
    BaseAIService,
    type AIVisionAnalysisResult,
    type MinuteRequest,
    type TextCompletionRequest,
} from '../core/ai/aiServiceBase';

// -----------------------------------------------------------
// Helpers específicos del transporte Gemini
// -----------------------------------------------------------

/**
 * Build diagnostics metadata for a Gemini response.
 */
function buildDiagnostics(apiKeySource: string, model?: string): FluDiagnostics {
    const savedModel = readStorage<string | null>(STORAGE_KEYS.TEXT_MODEL, null);
    return {
        provider: 'google-gemini',
        model: model || savedModel || GEMINI_CONFIG.MODEL,
        apiKeySource,
    };
}

/**
 * Resolve Gemini API key from direct param or centralized config.
 * Usa resolveTextApiKey() desde appConfig:
 *   localStorage (flu-text-api-key) > env var > empty. Sin legado.
 */
function resolveGeminiApiKey(apiKey: string = ''): { apiKey: string; apiKeySource: string } {
    return resolveApiKey(apiKey, resolveTextApiKey);
}

/**
 * Helper: read creativity (temperature) from FLU Configurator
 */
function resolveCreativityTemperature(): number | undefined {
    try {
        const state = useIntegrationStore.getState();
        if (state?.advancedConfig?.creativity !== undefined && state.advancedConfig.creativity !== null) {
            return state.advancedConfig.creativity;
        }
    } catch (err) {
        logCaughtError('[catch] src/services/gemini.ts', err);
        // Store not available (e.g. test environment)
    }
    return undefined;
}

// -----------------------------------------------------------
// GeminiService — Adapter de transporte (proxy Gemini)
// -----------------------------------------------------------

/**
 * Adapter que implementa IAIService delegando la orquestación en
 * BaseAIService y todo el transporte en el proxy Vite (geminiProxy.ts).
 */
class GeminiService extends BaseAIService implements IAIService {
    protected readonly engineLabel = 'Gemini';

    protected canUseTextBackend(): boolean {
        return Boolean(resolveGeminiApiKey().apiKey);
    }

    protected documentAnalysisSystem(language: string): string {
        return language === 'en'
            ? 'You are a document analyst. Respond in English only. Return valid JSON.'
            : 'Eres un analista de documentos. Responde únicamente en español. Devuelve JSON válido.';
    }

    /**
     * POST al proxy /api/gemini/text y devuelve el texto.
     * Mantiene el invariante "todas las llamadas Gemini pasan por el proxy".
     */
    protected async completeText(request: TextCompletionRequest): Promise<string> {
        const response = await fetchTextEngineResilient('/api/gemini/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey: resolveGeminiApiKey().apiKey,
                system: request.system,
                prompt: request.prompt,
                maxTokens: request.maxTokens,
            }),
        }, { timeoutMs: REQUEST_TIMEOUT_PRESETS.conversation });
        if (!response.ok) {
            throw new Error(`Proxy returned ${response.status}`);
        }
        const data = await response.json();
        return String(data?.text || '');
    }

    /**
     * Minuta vía proxy (mode='minute'). Devuelve el JSON OS2 ya parseado.
     */
    protected async fetchMinute(request: MinuteRequest): Promise<Record<string, unknown>> {
        const temperature = resolveCreativityTemperature();
        const userMessage = request.isEnglish
            ? `Session emotional state: ${request.emotionalState}

Conversation:
${request.conversationLog}

Generate the minute in JSON format.`
            : `Estado emocional de la sesión: ${request.emotionalState}

Conversación:
${request.conversationLog}

Genera la minuta en formato JSON.`;

        const response = await postGeminiContract({
            mode: 'minute',
            apiKey: resolveGeminiApiKey(request.options.apiKey).apiKey,
            language: request.options.language || 'es',
            role: request.options.role || '',
            theme: request.options.theme || '',
            history: request.history,
            systemPrompt: request.systemPrompt,
            userMessage,
            temperature,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Proxy error' }));
            throw new Error(errorData.error || `Proxy returned ${response.status}`);
        }

        return await response.json();
    }

    /**
     * Resumen de conversación vía proxy (mode='minute', estado neutral).
     */
    protected async fetchSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult> {
        const isEnglish = options.language === 'en';
        const conversationLog = history
            .map((e) => `${e.speakerName || (e.role === 'user' ? (isEnglish ? 'User' : 'Usuario') : 'FLU')}: ${e.text}`)
            .join('\n');

        // Build system prompt (single source of truth — src/core/ai/prompts.ts, Rule #1)
        const systemPrompt = buildMinuteSystemPrompt(isEnglish);

        const userMessage = isEnglish
            ? `Session emotional state: neutral

Conversation:
${conversationLog}

Generate the minute in JSON format.`
            : `Estado emocional de la sesión: neutral

Conversación:
${conversationLog}

Genera la minuta en formato JSON.`;

        // Delegate to proxy with mode='minute' (same route as generateMinute)
        const response = await postGeminiContract({
            mode: 'minute',
            apiKey: resolveGeminiApiKey(options.apiKey).apiKey,
            language: options.language || 'es',
            role: options.role || '',
            theme: options.theme || '',
            history: history,
            systemPrompt,
            userMessage,
            temperature: resolveCreativityTemperature(),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Proxy error' }));
            throw new Error(errorData.error || `Proxy returned ${response.status}`);
        }

        const data = await response.json();

        // The proxy returns the summary in OS2 format
        // Normalize to AISummaryResult
        return {
            titulo: String(data.titulo || '').trim() || (isEnglish ? 'Conversation minutes' : 'Minuta de conversacion'),
            participantes: Array.isArray(data.participantes) ? data.participantes.filter(Boolean) : [],
            resumen: String(data.resumen || '').trim(),
            acuerdos: Array.isArray(data.acuerdos) ? data.acuerdos.filter(Boolean) : [],
            pendientes: Array.isArray(data.pendientes) ? data.pendientes.filter(Boolean) : [],
            siguientes_pasos: Array.isArray(data.siguientes_pasos) ? data.siguientes_pasos.filter(Boolean) : [],
        };
    }

    /**
     * Respuesta contextual vía proxy (mode='response').
     */
    protected async fetchResponse(
        options: AIRequestOptions,
        userText: string,
        botName: string,
        history: AIHistoryEntry[],
    ): Promise<string> {
        const isEnglish = options.language === 'en';
        const conversationLog = history
            .slice(-10)
            .map((e) => `${e.role === 'user' ? (isEnglish ? 'User' : 'Usuario') : botName}: ${e.text}`)
            .join('\n');

        // Build system prompt
        const systemPrompt = isEnglish
            ? `You are ${botName}, a friendly conversational assistant with personality.
Respond in English naturally and contextually.
Be warm, empathetic and keep the conversation flowing.
Do not use markdown or special formatting. Only plain text.`
            : `Eres ${botName}, un asistente conversacional amigable y con personalidad.
Responde en español de forma natural y contextual.
Sé cálido, empático y mantén una conversación fluida.
No uses markdown ni formato especial. Solo texto plano.`;

        // FASE P: traits/tone/explanationLevel must reach the LLM through the
        // `personality` object. The proxy's handleResponseMode rebuilds the prompt
        // server-side from `personality` (it ignores the client's local systemPrompt),
        // so the personality object is the only channel that works in response mode.
        const personality = (options.traits || options.tone || options.explanationLevel)
            ? {
                traits: options.traits || [],
                tone: options.tone || '',
                explanationLevel: options.explanationLevel || '',
                name: '',
                profile: options.role || '',
            }
            : null;

        const userMessage = isEnglish
            ? `Recent history:
${conversationLog}

User message: ${userText}

Respond as ${botName}:`
            : `Historial reciente:
${conversationLog}

Mensaje del usuario: ${userText}

Responde como ${botName}:`;

        // Delegate to proxy with mode='response'
        const response = await postGeminiContract({
            mode: 'response',
            apiKey: resolveGeminiApiKey(options.apiKey).apiKey,
            transcript: userText,
            language: options.language || 'es',
            role: options.role || '',
            theme: options.theme || '',
            history: history,
            personality,
            systemPrompt,
            userMessage,
            temperature: resolveCreativityTemperature(),
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Proxy error' }));
            throw new Error(errorData.error || `Proxy returned ${response.status}`);
        }

        const data = await response.json();
        return (data.respuesta_voz || data.text || '').trim();
    }

    /**
     * Evaluación de intervención vía proxy /api/gemini/participant-eval.
     */
    protected async fetchEvaluation(
        options: AIRequestOptions,
        conversationLog: string,
        maxDraftChars: number = 420,
    ): Promise<AIParticipantEvaluation> {
        // Delegate to proxy
        const response = await fetchTextEngineResilient('/api/gemini/participant-eval', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                apiKey: resolveGeminiApiKey(options.apiKey).apiKey,
                language: options.language || 'es',
                role: options.role || '',
                theme: options.theme || '',
                conversationLog,
                maxDraftChars,
            }),
        }, { timeoutMs: REQUEST_TIMEOUT_PRESETS.conversation });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Proxy error' }));
            throw new Error(errorData.error || `Proxy returned ${response.status}`);
        }

        const data = await response.json();

        // The proxy normalizes the response (flattens evaluation wrapper)
        return {
            intervenir: Boolean(data.intervenir),
            motivo_corto: String(data.motivo_corto || '').trim(),
            borrador_aportacion: String(data.borrador_aportacion || '').trim(),
            confianza: Number(data.confianza) || 0,
        };
    }

    /**
     * Imagen de workspace: proxy /api/workspace-image con respaldo directo a
     * Pollinations (stateless, sin clave).
     */
    protected async fetchImage(
        prompt: string,
        tipoStr: string,
        language: string,
    ): Promise<AIWorkspaceImageResult> {
        try {
            const response = await fetchTextEngineResilient('/api/workspace-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: '',
                    language,
                    workspace: { prompt_visual: prompt, tipo: tipoStr },
                }),
            }, { timeoutMs: REQUEST_TIMEOUT_PRESETS.image });

            if (!response.ok) {
                throw new Error(`Proxy returned ${response.status}`);
            }

            const data = await response.json();

            // generateWorkspaceImage() returns { imageUrl, trace } (camelCase)
            if (data?.imageUrl) {
                return {
                    image_url: data.imageUrl,
                    trace: data.trace || {
                        provider: 'pollinations',
                        hasImage: true,
                        source: 'proxy',
                    },
                };
            }

            // Fallback: build URL directly (Pollinations is stateless)
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
            logCaughtError('[Gemini] Workspace image generation failed', detail || error);
            // Fallback: build URL directly (Pollinations is stateless, no API key needed)
            try {
                const imageUrl = buildPollinationsUrl(prompt);
                return {
                    image_url: imageUrl,
                    trace: {
                        provider: 'pollinations',
                        hasImage: true,
                        source: 'pollinations_ai_fallback',
                        prompt,
                        language,
                    },
                };
            } catch (e) {
                logCaughtError('[catch] src/services/gemini.ts', e);
                return {
                    image_url: '',
                    trace: {
                        provider: 'error',
                        hasImage: false,
                        source: 'generation_failed',
                        error: (error && typeof error === 'object' && 'message' in error ? error.message : undefined) || 'unknown',
                        prompt,
                    },
                };
            }
        }
    }

    /**
     * Visión multimodal vía proxy /api/gemini/vision (OCR/digitalización).
     */
    protected async fetchVision(
        imageBase64: string,
        mimeType: string,
        language: string,
        profile: string,
    ): Promise<AIVisionAnalysisResult> {
        if (!imageBase64) {
            return { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' };
        }

        try {
            const response = await fetchTextEngineResilient('/api/gemini/vision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: '',
                    imageBase64,
                    mimeType,
                    language,
                    profile,
                }),
            }, { timeoutMs: REQUEST_TIMEOUT_PRESETS.image });

            if (!response.ok) {
                throw new Error(`Proxy returned ${response.status}`);
            }

            return await response.json();
        } catch (error: unknown) {
            const detail = error && typeof error === 'object' && 'message' in error ? error.message : error;
            logCaughtError('[Gemini] Vision analysis failed', detail || error);
            return { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' };
        }
    }

    /**
     * Generate a Gemini contract for conversation (OS2 parity).
     * Delegates to proxy via /api/gemini/contract.
     * Returns FluContract with diagnostics metadata.
     */
    async generateFluContract(
        options: AIRequestOptions,
        transcript: string,
        history: AIHistoryEntry[],
    ): Promise<FluContract> {
        // Build personality object from traits/tone/explanationLevel (OS2 parity + FASE P)
        // generateFluContract() in gemini.js expects a `personality` object
        // with traits, tone and explanationLevel sub-properties, not flat fields.
        const personality = (options.traits || options.tone || options.explanationLevel)
            ? {
                traits: options.traits || [],
                tone: options.tone || '',
                explanationLevel: options.explanationLevel || '',
                name: '',
                profile: options.role || '',
            }
            : null;

        // Delegate to proxy
        const response = await postGeminiContract({
            mode: 'contract',
            apiKey: resolveGeminiApiKey(options.apiKey).apiKey,
            transcript,
            language: options.language || 'es',
            role: options.role || '',
            theme: options.theme || '',
            history,
            personality,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Proxy error' }));
            const error = new Error(errorData.error || `Proxy returned ${response.status}`) as Error & {
                code?: string;
                status?: number;
                detail?: string;
                model?: string;
                apiKeySource?: string;
                bodyPreview?: string;
            };
            error.code = errorData.code || `proxy_${response.status}`;
            error.status = response.status;
            error.detail = errorData.detail || '';
            error.model = errorData.model || '';
            error.apiKeySource = errorData.apiKeySource || '';
            error.bodyPreview = errorData.bodyPreview || '';
            throw error;
        }

        const data = await response.json();

        // The proxy returns the full contract from generateFluContract()
        // Normalize to FluContract format
        const contract = data?.contract || data;

        const respuesta_voz = String(contract.respuesta_voz || '').trim();
        if (!respuesta_voz) {
            const error = new Error('empty_response') as Error & { code?: string };
            error.code = 'empty_response';
            throw error;
        }

        const navegacionRaw = (contract.navegacion || {}) as Record<string, unknown>;
        const workspaceRaw = contract.workspace as Record<string, unknown> | null;

        // Extract animacion, emocion and musica from the contract
        const animacion = contract.animacion ? String(contract.animacion).trim() : undefined;
        const emocion = contract.emocion ? String(contract.emocion).trim() : undefined;
        const rawMusica = contract.musica as { accion?: unknown; cancion?: unknown } | undefined;
        const musica =
            rawMusica &&
            ['play_music', 'pause_music', 'stop_music'].includes(String(rawMusica.accion || '').trim())
                ? {
                    accion: String(rawMusica.accion).trim() as 'play_music' | 'pause_music' | 'stop_music',
                    cancion: rawMusica.cancion ? String(rawMusica.cancion).trim() : undefined,
                }
                : undefined;

        // Extract acciones (structured conversational actions) from the contract
        const acciones = (() => {
            const rawAcciones = Array.isArray(contract.acciones) ? contract.acciones : null;
            if (!rawAcciones || rawAcciones.length === 0) return undefined;
            const VALID_DOMINIOS = ['reminder', 'temporal', 'diary', 'note', 'horario'];
            const parsed = rawAcciones
                .map((item: Record<string, unknown>): FluAccion | null => {
                    if (!item || typeof item !== 'object') return null;
                    const dominio = String(item.dominio || '').trim();
                    const texto = String(item.texto || '').trim();
                    if (!VALID_DOMINIOS.includes(dominio) || !texto) return null;
                    return { dominio: dominio as FluAccion['dominio'], texto };
                })
                .filter((a: FluAccion | null): a is FluAccion => a !== null);
            return parsed.length > 0 ? parsed : undefined;
        })();

        const resolved = resolveGeminiApiKey(options.apiKey);

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
            acciones,
            animacion,
            emocion,
            musica,
            diagnostics: buildDiagnostics(resolved.apiKeySource),
        };
    }
}

// -----------------------------------------------------------
/** Singleton instance of GeminiService (tipo concreto: conserva generateFluContract). */
export const geminiService: GeminiService = new GeminiService();
