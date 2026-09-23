// ============================================================
// aiServiceBase.ts — Motor ÚNICO de IA (una sola implementación de IAIService)
// ============================================================
// Extracción pura de la orquestación compartida por los motores de IA:
//   - construcción del log de conversación y prompts (minuta/OS2)
//   - normalización de resultados (minuta, resumen, evaluación, visión)
//   - map-reduce de documentos (F1), contrato de app (F2), serialización F3
//   - guardas de imagen de workspace
// Los adapters (services/gemini.ts, services/deepseek.ts) solo implementan
// el TRANSPORTE (una ruta de red por operación) y sus variantes de
// normalización propias. Ninguno re-implementa los métodos del contrato.
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuración desde appConfig
//   - Rule #3: NO `new` en lógica de negocio — DI via interfaces
//   - §8.6/§10.2: implementación única (guard aiServiceSingleImplGuard)
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { GENERATION_TIMEOUT_MS, TEXT_TOKEN_BUDGETS, VALID_VISUAL_TIPOS } from '../config/appConfig';
import { buildMinuteSystemPrompt } from './prompts';
import {
    buildMapPrompt,
    buildReducePrompt,
    buildSingleAnalysisPrompt,
    mergePartialSummaries,
    applyReduceToContract,
} from '../../lib/documentChunker';
import type { ChunkContext, PartialSummary } from '../../lib/documentChunker';
import { serializeDocument } from '../../lib/formatAdapters';
import { buildBaseDocumentContract, buildHeuristicAppAnalysis } from '../../lib/analysisFallbacks';
import {
    buildGenerationPrompt,
    buildGenerationSystemPrompt,
    buildGenerationFallbackContent,
} from '../../lib/generationPrompts';
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
} from './IAIService';
import type { DocumentContract, AppAnalysisContract } from '../../types/documentContracts';
import { logCaughtError } from '../../lib/caughtError';
import { SPEECH_LOCALES } from '../config/localeConfig';

// -----------------------------------------------------------
// Helpers compartidos (exportados para tests/adapters)
// -----------------------------------------------------------

/**
 * Compone el log de conversación con etiqueta de hablante. Fuente única para
 * minuta y resumen (mismo formato que OS2).
 * @param history Entradas de conversación.
 * @param isEnglish Idioma de las etiquetas por defecto.
 */
export function buildConversationLog(history: AIHistoryEntry[], isEnglish: boolean): string {
    return history
        .map((e) => `${e.speakerName || (e.role === 'user' ? (isEnglish ? 'User' : 'Usuario') : 'FLU')}: ${e.text}`)
        .join('\n');
}

/**
 * Normaliza el objeto OS2 devuelto por cualquier backend a AIMinuteResult,
 * con títulos por defecto language-aware y respaldo del resumen al log.
 * @param raw Objeto ya parseado (proxy JSON o contenido del motor de texto).
 * @param isEnglish Idioma del título por defecto.
 * @param conversationLog Respaldo de `resumen` cuando el LLM no lo devuelve.
 */
export function normalizeMinute(
    raw: Record<string, unknown>,
    isEnglish: boolean,
    conversationLog: string,
): AIMinuteResult {
    return {
        titulo: String(raw.titulo || '') || (isEnglish
            ? `Minutes - ${new Date().toLocaleDateString(SPEECH_LOCALES.en)}`
            : `Minuta - ${new Date().toLocaleDateString(SPEECH_LOCALES.es)}`),
        participantes: Array.isArray(raw.participantes) ? raw.participantes as string[] : [],
        resumen: String(raw.resumen || '') || conversationLog,
        acuerdos: Array.isArray(raw.acuerdos) ? raw.acuerdos as string[] : [],
        pendientes: Array.isArray(raw.pendientes) ? raw.pendientes as string[] : [],
        siguientes_pasos: Array.isArray(raw.siguientes_pasos) ? raw.siguientes_pasos as string[] : [],
    };
}

/**
 * Parsea JSON de forma segura; devuelve null si falla (nunca lanza).
 * Acepta JSON puro o envuelto en bloques ```json ... ``` y, en último
 * término, extrae el primer objeto `{...}`.
 * @param text Contenido crudo del LLM.
 */
export function safeParseJson(text: string): Record<string, unknown> | null {
    if (!text || !text.trim()) return null;
    try {
        const value = JSON.parse(text);
        if (value && typeof value === 'object') return value;
        const match = text.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (match) return JSON.parse(match[1]);
        return null;
    } catch (e) {
        logCaughtError('[catch] src/core/ai/aiServiceBase.ts', e);
        try {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch (e) {
            logCaughtError('[catch] src/core/ai/aiServiceBase.ts', e);
            return null;
        }
        return null;
    }
}

// -----------------------------------------------------------
// Contratos de transporte (lo que cada adapter aporta)
// -----------------------------------------------------------

/** Petición de texto genérica para F1/F2/F3. */
export interface TextCompletionRequest {
    system: string;
    prompt: string;
    maxTokens: number;
    /** false = pide texto libre (no fuerza response_format json_object). */
    jsonMode?: boolean;
    timeoutMs?: number;
}

/** Petición de minuta (modo 'minute' del proxy o mensajes del motor de texto). */
export interface MinuteRequest {
    options: AIRequestOptions;
    history: AIHistoryEntry[];
    emotionalState: string;
    isEnglish: boolean;
    conversationLog: string;
    systemPrompt: string;
}

/** Resultado del análisis multimodal (OCR/digitalización). */
export interface AIVisionAnalysisResult {
    materia: string;
    problemas: string[];
    instrucciones: string;
    nivel: string;
    texto_extraido: string;
}

// System prompt compartido de F2 (idéntico en ambos backends).
const APP_ANALYSIS_SYSTEM = {
    en: 'You are an app analyst. Respond in English only. Return valid JSON.',
    es: 'Eres un analista de aplicaciones. Responde únicamente en español. Devuelve JSON válido.',
} as const;

// -----------------------------------------------------------
// BaseAIService — implementación ÚNICA de IAIService
// -----------------------------------------------------------

/**
 * Motor de IA agnóstico del proveedor. Implementa los 9 métodos de
 * IAIService con la orquestación compartida y delega en hooks abstractos el
 * transporte de red (uno por operación) y las variantes de normalización
 * propias de cada backend.
 */
export abstract class BaseAIService implements IAIService {
    /** Etiqueta del backend para logs (`Gemini`, `DeepSeek`, ...). */
    protected abstract readonly engineLabel: string;

    /** ¿Hay backend de texto usable (api key o endpoint local sin clave)? */
    protected abstract canUseTextBackend(): boolean;

    /** System prompt del análisis de documentos (F1), específico del backend. */
    protected abstract documentAnalysisSystem(language: string): string;

    /** Ejecuta una completion de texto cruda (F1/F2/F3). */
    protected abstract completeText(request: TextCompletionRequest): Promise<string>;

    /** Obtiene el objeto OS2 (minuta) ya parseado del backend. */
    protected abstract fetchMinute(request: MinuteRequest): Promise<Record<string, unknown>>;

    /** Obtiene el resumen de conversación normalizado. */
    protected abstract fetchSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult>;

    /** Obtiene la respuesta conversacional. */
    protected abstract fetchResponse(
        options: AIRequestOptions,
        userText: string,
        botName: string,
        history: AIHistoryEntry[],
    ): Promise<string>;

    /** Evalúa si FLU debe intervenir. */
    protected abstract fetchEvaluation(
        options: AIRequestOptions,
        conversationLog: string,
        maxDraftChars?: number,
    ): Promise<AIParticipantEvaluation>;

    /** Genera el artefacto de imagen de workspace (transporte propio). */
    protected abstract fetchImage(
        prompt: string,
        tipoStr: string,
        language: string,
    ): Promise<AIWorkspaceImageResult>;

    /** Analiza una imagen (visión multimodal). */
    protected abstract fetchVision(
        imageBase64: string,
        mimeType: string,
        language: string,
        profile: string,
    ): Promise<AIVisionAnalysisResult>;

    /**
     * Generate an AI-powered minute from conversation history.
     * Returns OS2-compatible format: titulo, participantes, resumen,
     * acuerdos, pendientes, siguientes_pasos.
     */
    async generateMinute(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
        emotionalState: string,
    ): Promise<AIMinuteResult> {
        const isEnglish = options.language === 'en';
        const conversationLog = buildConversationLog(history, isEnglish);
        const systemPrompt = buildMinuteSystemPrompt(isEnglish);
        const raw = await this.fetchMinute({
            options,
            history,
            emotionalState,
            isEnglish,
            conversationLog,
            systemPrompt,
        });
        return normalizeMinute(raw, isEnglish, conversationLog);
    }

    /**
     * Generate an AI-powered contextual response.
     */
    async generateResponse(
        options: AIRequestOptions,
        userText: string,
        botName: string,
        history: AIHistoryEntry[],
    ): Promise<string> {
        return this.fetchResponse(options, userText, botName, history);
    }

    /**
     * Evaluate whether FLU should intervene in the conversation (OS2 parity).
     */
    async generateParticipantEvaluation(
        options: AIRequestOptions,
        conversationLog: string,
        maxDraftChars?: number,
    ): Promise<AIParticipantEvaluation> {
        return this.fetchEvaluation(options, conversationLog, maxDraftChars);
    }

    /**
     * Generate an AI-powered meeting summary (OS2 style).
     */
    async generateConversationSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult> {
        return this.fetchSummary(options, history);
    }

    /**
     * Generate a workspace image from a prompt.
     * Guardas comunes (prompt vacío / tipo no visual) antes del transporte.
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
        // VALID_VISUAL_TIPOS centralizado en appConfig — Rule #1: NO HARDCODE
        if (!VALID_VISUAL_TIPOS.includes(tipoStr)) {
            return {
                image_url: '',
                trace: { provider: 'none', hasImage: false, source: 'not_visual_tipo', tipo: tipoStr },
            };
        }

        return this.fetchImage(prompt, tipoStr, language);
    }

    /**
     * Analiza una imagen (visión multimodal / OCR). Delegado al transporte.
     */
    async generateVisionAnalysis(
        imageBase64: string,
        mimeType: string,
        language: string = 'es',
        profile: string = 'tutor',
    ): Promise<AIVisionAnalysisResult> {
        return this.fetchVision(imageBase64, mimeType, language, profile);
    }

    /**
     * F1 — analizar un documento (map-reduce sobre los chunks).
     * Degrada elegantemente al contrato heurístico si no hay backend de texto
     * o falla el LLM.
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

        if (!this.canUseTextBackend()) return base;

        const system = this.documentAnalysisSystem(language);

        try {
            const chunks = Array.isArray(payload.chunks) && payload.chunks.length
                ? payload.chunks.filter(Boolean)
                : (payload.rawText ? [payload.rawText] : []);

            if (chunks.length <= 2) {
                const singlePrompt = chunks.length
                    ? buildSingleAnalysisPrompt(chunks.join('\n\n'), ctx, language)
                    : buildSingleAnalysisPrompt('(documento sin texto extraído)', ctx, language);
                const raw = await this.completeText({ system, prompt: singlePrompt, maxTokens: TEXT_TOKEN_BUDGETS.single });
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
                    const raw = await this.completeText({
                        system,
                        prompt: buildMapPrompt(chunks[i], i + 1, chunks.length, ctx, language),
                        maxTokens: TEXT_TOKEN_BUDGETS.mapChunk,
                    });
                    const parsed = safeParseJson(raw);
                    partials.push({
                        indice: i + 1,
                        resumen: String(parsed?.resumen || ''),
                        puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    });
                } catch (e) {
                    logCaughtError(`${this.engineLabel} analyzeDocument map chunk ${i + 1} failed:`, e);
                    partials.push({ indice: i + 1, resumen: '', puntos_clave: [] });
                }
            }

            // Fase reduce: fusión con LLM; respaldo heurístico si falla.
            let reduced: { resumen: string; puntos_clave: string[]; escenarios?: Record<string, unknown>[] };
            try {
                const raw = await this.completeText({
                    system,
                    prompt: buildReducePrompt(partials, ctx, language),
                    maxTokens: TEXT_TOKEN_BUDGETS.reduce,
                });
                const parsed = safeParseJson(raw);
                reduced = {
                    resumen: String(parsed?.resumen || ''),
                    puntos_clave: Array.isArray(parsed?.puntos_clave) ? parsed.puntos_clave.map(String) : [],
                    escenarios: Array.isArray(parsed?.escenarios) ? parsed.escenarios : undefined,
                };
            } catch (e) {
                logCaughtError(`${this.engineLabel} analyzeDocument reduce failed, using heuristic merge:`, e);
                reduced = mergePartialSummaries(partials);
            }
            return applyReduceToContract(base, reduced);
        } catch (error) {
            logCaughtError(`${this.engineLabel} analyzeDocument fallback to heuristic contract:`, error);
            return base;
        }
    }

    /**
     * F2 — analizar la funcionalidad de una app (fase estática → contrato).
     * Degrada elegantemente al análisis heurístico si no hay backend de texto.
     */
    async analyzeApp(
        payload: AppAnalysisInput,
        language = 'es',
    ): Promise<AppAnalysisContract> {
        if (!this.canUseTextBackend()) return buildHeuristicAppAnalysis(payload);

        const system = language === 'en' ? APP_ANALYSIS_SYSTEM.en : APP_ANALYSIS_SYSTEM.es;

        try {
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
            const raw = await this.completeText({ system, prompt, maxTokens: TEXT_TOKEN_BUDGETS.appAnalysis });
            const parsed = safeParseJson(raw);
            const screens: Record<string, unknown>[] = Array.isArray(parsed?.pantallas) ? parsed.pantallas : [];
            const flows: Record<string, unknown>[] = Array.isArray(parsed?.flujos) ? parsed.flujos : [];
            const llmErrors = Array.isArray(parsed?.errores_detectados) ? parsed.errores_detectados.map(String) : [];
            const mergedErrors = Array.from(new Set([
                ...(Array.isArray(payload.errores_detectados) ? payload.errores_detectados : []),
                ...llmErrors,
            ]));
            return {
                proyecto: payload.proyecto || 'Proyecto',
                framework: payload.framework || 'other',
                pantallas: screens.map((s) => ({
                    id: String(s?.id || `screen-${uuidv4()}`),
                    nombre: String(s?.nombre || 'Pantalla'),
                    proposito: String(s?.proposito || ''),
                    entradas: Array.isArray(s?.entradas) ? s.entradas.map(String) : [],
                    acciones: Array.isArray(s?.acciones) ? s.acciones.map(String) : [],
                    salidas: Array.isArray(s?.salidas) ? s.salidas.map(String) : [],
                })),
                flujos: flows.map((f) => ({
                    nombre: String(f?.nombre || 'Flujo'),
                    pasos: Array.isArray(f?.pasos) ? f.pasos.map(String) : [],
                })),
                errores_detectados: mergedErrors,
            };
        } catch (error) {
            logCaughtError(`${this.engineLabel} analyzeApp fallback to heuristic analysis:`, error);
            return buildHeuristicAppAnalysis(payload);
        }
    }

    /**
     * F3 — generar un documento (contenido del LLM serializado por el adaptador).
     * Si ya hay contenido analizado, se serializa directamente; degrada a
     * contenido de respaldo si no hay backend de texto o falla la llamada.
     */
    async generateDocument(
        payload: GenerationInput,
        language = 'es',
    ): Promise<GeneratedDocumentResult> {
        const nombre = payload.fuentes?.[0]?.ref || `flu-${payload.formato}`;
        if (payload.contenido_analizado && payload.contenido_analizado.trim()) {
            return serializeDocument(payload.formato, payload.contenido_analizado, nombre);
        }
        if (!this.canUseTextBackend()) {
            return serializeDocument(payload.formato, buildGenerationFallbackContent(payload, language), nombre);
        }
        try {
            const raw = await this.completeText({
                system: buildGenerationSystemPrompt(language),
                prompt: buildGenerationPrompt(payload, language),
                maxTokens: TEXT_TOKEN_BUDGETS.generation,
                jsonMode: false,
                timeoutMs: GENERATION_TIMEOUT_MS,
            });
            return serializeDocument(payload.formato, raw, nombre);
        } catch (error) {
            logCaughtError(`${this.engineLabel} generateDocument fallback to fallback content:`, error);
            return serializeDocument(payload.formato, buildGenerationFallbackContent(payload, language), nombre);
        }
    }
}
