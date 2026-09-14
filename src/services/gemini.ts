// ============================================================
// GeminiService — AI-powered features (OS2 parity)
// ============================================================
// UNIFIED PROXY ARCHITECTURE:
// ALL Gemini API calls go through the Vite middleware proxy
// (geminiProxy.ts), which delegates to the canonical JS
// implementation in gemini.js. This ensures a single source
// of truth — no dual paths, no duplicate logic.
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuration from appConfig
//   - Rule #3: NO `new` en lógica de negocio — DI via interfaces
//   - Obligación #1: Inyección de Dependencias
//   - Obligación #2: JSDoc en todo método
// ============================================================

import { GEMINI_CONFIG, STORAGE_KEYS, VALID_VISUAL_TIPOS, WORKSPACE_TIPOS, buildPollinationsUrl, readStorage, resolveTextApiKey } from '../core/config/appConfig';
import { buildMinuteSystemPrompt } from '../core/ai/prompts';
import { useIntegrationStore } from '../store/integrationStore';
import { v4 as uuidv4 } from 'uuid';
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
import type { FluAccion, FluContract, FluDiagnostics } from '../types/bridge';
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
import { postGeminiContract } from './geminiContractClient';

// -----------------------------------------------------------
// Helpers
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
    const direct = String(apiKey ?? '').trim();
    if (direct) {
        return { apiKey: direct, apiKeySource: 'localStorage' };
    }
    // Delegar a resolveTextApiKey() centralizado (Rule #1: NO HARDCODE)
    const textApiKey = resolveTextApiKey();
    if (textApiKey) {
        return { apiKey: textApiKey, apiKeySource: 'textConfig' };
    }
    return { apiKey: '', apiKeySource: 'missing' };
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
    } catch {
        // Store not available (e.g. test environment)
    }
    return undefined;
}

/**
 * Parsea JSON de forma segura; devuelve null si falla (nunca lanza).
 */
function safeParseJson(text: string): any | null {
    if (!text || !text.trim()) return null;
    try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object') return value;
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) return JSON.parse(match[1]);
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

// -----------------------------------------------------------
// GeminiService — Implementation of IAIService
// All methods delegate to the Vite middleware proxy.
// -----------------------------------------------------------

/**
 * Service that implements IAIService using Google Gemini API.
 * All configuration is injected via appConfig, not hardcoded.
 * All API calls go through the unified proxy (geminiProxy.ts).
 */
class GeminiService implements IAIService {
    /**
     * Generate an AI-powered minute from conversation history.
     * Delegates to proxy with mode='minute'.
     * Returns OS2-compatible format: titulo, participantes, resumen, acuerdos, pendientes, siguientes_pasos.
     */
    async generateMinute(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
        emotionalState: string,
    ): Promise<AIMinuteResult> {
        const isEnglish = options.language === 'en';
        const temperature = resolveCreativityTemperature();

        // Build conversation log for the proxy
        const conversationLog = history
            .map((e) => `${e.speakerName || (e.role === 'user' ? (isEnglish ? 'User' : 'Usuario') : 'FLU')}: ${e.text}`)
            .join('\n');

        // Build system prompt (single source of truth — src/core/ai/prompts.ts, Rule #1)
        const systemPrompt = buildMinuteSystemPrompt(isEnglish);

        const userMessage = isEnglish
            ? `Session emotional state: ${emotionalState}

Conversation:
${conversationLog}

Generate the minute in JSON format.`
            : `Estado emocional de la sesión: ${emotionalState}

Conversación:
${conversationLog}

Genera la minuta en formato JSON.`;

        // Delegate to proxy with mode='minute'
        const response = await postGeminiContract({
            mode: 'minute',
            apiKey: resolveGeminiApiKey(options.apiKey).apiKey,
            language: options.language || 'es',
            role: options.role || '',
            theme: options.theme || '',
            history: history,
            systemPrompt,
            userMessage,
            temperature,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Proxy error' }));
            throw new Error(errorData.error || `Proxy returned ${response.status}`);
        }

        const data = await response.json();

        // The proxy returns the summary in OS2 format
        // Normalize to AIMinuteResult
        return {
            titulo: String(data.titulo || '') || (isEnglish
                ? `Minutes - ${new Date().toLocaleDateString('en-US')}`
                : `Minuta - ${new Date().toLocaleDateString('es-MX')}`),
            participantes: Array.isArray(data.participantes) ? data.participantes as string[] : [],
            resumen: String(data.resumen || '') || conversationLog,
            acuerdos: Array.isArray(data.acuerdos) ? data.acuerdos as string[] : [],
            pendientes: Array.isArray(data.pendientes) ? data.pendientes as string[] : [],
            siguientes_pasos: Array.isArray(data.siguientes_pasos) ? data.siguientes_pasos as string[] : [],
        };
    }

    /**
     * Generate an AI-powered contextual response.
     * Delegates to proxy with mode='response'.
     */
    async generateResponse(
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
     * Evaluate whether FLU should intervene in the conversation (OS2 parity).
     * Delegates to proxy via /api/gemini/participant-eval.
     */
    async generateParticipantEvaluation(
        options: AIRequestOptions,
        conversationLog: string,
        maxDraftChars: number = 420,
    ): Promise<AIParticipantEvaluation> {
        // Delegate to proxy
        const response = await fetch('/api/gemini/participant-eval', {
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
        });

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
     * Generate an AI-powered meeting summary (OS2 style).
     * Delegates to proxy with mode='minute' (single route — same as generateMinute).
     */
    async generateConversationSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult> {
        const isEnglish = options.language === 'en';
        const temperature = resolveCreativityTemperature();

        // Build conversation log for the proxy
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
            temperature,
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
                .map((item: any): FluAccion | null => {
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

    /**
     * Generate a workspace image from a Gemini workspace prompt (OS2 parity).
     * Uses Pollinations.ai (free, no API key needed).
     * Delegates to proxy via /api/workspace-image.
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
        // Accept image_prompt, diagram, and 3d as valid visual tipos for Pollinations generation
        // (VALID_VISUAL_TIPOS centralized in appConfig — Rule #1: NO HARDCODE)
        if (!VALID_VISUAL_TIPOS.includes(tipoStr)) {
            return {
                image_url: '',
                trace: { provider: 'none', hasImage: false, source: 'not_visual_tipo', tipo: tipoStr },
            };
        }

        // Delegate to proxy
        // The proxy's handleWorkspaceImage passes body to
        // generateWorkspaceImage({ apiKey, workspace, language }) from gemini.js
        // which returns { imageUrl, trace } (camelCase).
        try {
            const response = await fetch('/api/workspace-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: '',
                    language,
                    workspace: { prompt_visual: prompt, tipo: tipoStr },
                }),
            });

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
        } catch (error: any) {
            console.warn('[Gemini] Workspace image generation failed:', error?.message || error);
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
            } catch {
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
    }

    /**
     * Analiza una imagen usando Gemini Vision API (OCR multimodal).
     * Delega al proxy: POST /api/gemini/vision
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
        if (!imageBase64) {
            return { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' };
        }

        try {
            const response = await fetch('/api/gemini/vision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiKey: '',
                    imageBase64,
                    mimeType,
                    language,
                    profile,
                }),
            });

            if (!response.ok) {
                throw new Error(`Proxy returned ${response.status}`);
            }

            return await response.json();
        } catch (error: any) {
            console.warn('[Gemini] Vision analysis failed:', error?.message || error);
            return { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' };
        }
    }

    /**
     * POST genérico al proxy /api/gemini/text y devuelve el texto.
     * Mantiene el invariante "todas las llamadas Gemini pasan por el proxy".
     */
    private async postText(body: Record<string, unknown>): Promise<string> {
        const response = await fetch('/api/gemini/text', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            throw new Error(`Proxy returned ${response.status}`);
        }
        const data = await response.json();
        return String(data?.text || '');
    }

    /**
     * F1 — analizar un documento (map-reduce sobre los chunks) vía proxy.
     * Degrada elegantemente al contrato heurístico si no hay API key o falla.
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

        const { apiKey } = resolveGeminiApiKey();
        if (!apiKey) return base;

        const system = language === 'en'
            ? 'You are a document analyst. Respond in English only. Return valid JSON.'
            : 'Eres un analista de documentos. Responde únicamente en español. Devuelve JSON válido.';

        try {
            const chunks = Array.isArray(payload.chunks) && payload.chunks.length
                ? payload.chunks.filter(Boolean)
                : (payload.rawText ? [payload.rawText] : []);

            if (chunks.length <= 2) {
                const singlePrompt = chunks.length
                    ? buildSingleAnalysisPrompt(chunks.join('\n\n'), ctx, language)
                    : buildSingleAnalysisPrompt('(documento sin texto extraído)', ctx, language);
                const raw = await this.postText({
                    apiKey,
                    system,
                    prompt: singlePrompt,
                    maxTokens: 1800,
                });
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
                    const raw = await this.postText({
                        apiKey,
                        system,
                        prompt: buildMapPrompt(chunks[i], i + 1, chunks.length, ctx, language),
                        maxTokens: 900,
                    });
                    const parsed = safeParseJson(raw);
                    partials.push({
                        indice: i + 1,
                        resumen: String(parsed?.resumen || ''),
                        puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    });
                } catch (e) {
                    console.warn(`Gemini analyzeDocument map chunk ${i + 1} failed:`, e);
                    partials.push({ indice: i + 1, resumen: '', puntos_clave: [] });
                }
            }

            // Fase reduce: fusión con LLM; respaldo heurístico si falla.
            let reduced: { resumen: string; puntos_clave: string[]; escenarios?: Record<string, unknown>[] };
            try {
                const raw = await this.postText({
                    apiKey,
                    system,
                    prompt: buildReducePrompt(partials, ctx, language),
                    maxTokens: 1800,
                });
                const parsed = safeParseJson(raw);
                reduced = {
                    resumen: String(parsed?.resumen || ''),
                    puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    escenarios: Array.isArray(parsed?.escenarios) ? parsed.escenarios : undefined,
                };
            } catch (e) {
                console.warn('Gemini analyzeDocument reduce failed, using heuristic merge:', e);
                reduced = mergePartialSummaries(partials);
            }
            return applyReduceToContract(base, reduced);
        } catch (error) {
            console.warn('Gemini analyzeDocument fallback to heuristic contract:', error);
            return base;
        }
    }

    /**
     * F2 — analizar la funcionalidad de una app (fase estática → contrato) vía proxy.
     * Degrada elegantemente al análisis heurístico si no hay API key.
     */
    async analyzeApp(
        payload: AppAnalysisInput,
        language = 'es',
    ): Promise<AppAnalysisContract> {
        const { apiKey } = resolveGeminiApiKey();
        if (!apiKey) return buildHeuristicAppAnalysis(payload);

        try {
            const system = language === 'en'
                ? 'You are an app analyst. Respond in English only. Return valid JSON.'
                : 'Eres un analista de aplicaciones. Responde únicamente en español. Devuelve JSON válido.';
            const prompt = [
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
            ].join('\n');
            const raw = await this.postText({ apiKey, system, prompt, maxTokens: 2200 });
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
                    id: String(s?.id || `screen-${uuidv4()}`),
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
            console.warn('Gemini analyzeApp fallback to heuristic analysis:', error);
            return buildHeuristicAppAnalysis(payload);
        }
    }

    /**
     * F3 — generar un documento (contenido del LLM serializado por el adaptador) vía proxy.
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
        const { apiKey } = resolveGeminiApiKey();
        if (!apiKey) {
            return serializeDocument(payload.formato, buildGenerationFallbackContent(payload, language), nombre);
        }
        try {
            const raw = await this.postText({
                apiKey,
                system: buildGenerationSystemPrompt(language),
                prompt: buildGenerationPrompt(payload, language),
                maxTokens: 3000,
            });
            return serializeDocument(payload.formato, raw, nombre);
        } catch (error) {
            console.warn('Gemini generateDocument fallback to fallback content:', error);
            return serializeDocument(payload.formato, buildGenerationFallbackContent(payload, language), nombre);
        }
    }
}

// -----------------------------------------------------------
/** Singleton instance of GeminiService (tipo concreto: conserva generateFluContract). */
export const geminiService: GeminiService = new GeminiService();
