// ============================================================
// IAIService — Interface for AI Service (Dependency Injection)
// ============================================================
// Abstraction over AI providers (Gemini, local fallback, etc.)
// Enables DI, testability, and provider swapping.
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuration injected
//   - Rule #3: NO `new` en lógica de negocio — DI via interfaces
//   - Obligación #1: Inyección de Dependencias
// ============================================================

import type {
    AppAnalysisContract,
    DocumentContract,
    GenerationFormato,
} from '../../types/documentContracts';

/**
 * Options for AI service calls.
 */
export interface AIRequestOptions {
    apiKey: string;
    language?: string;
    role?: string;
    theme?: string;
    /** Personality traits to inject into the system prompt (Phase 1) */
    traits?: string[];
    /** Communication tone to inject into the system prompt (Phase 1) */
    tone?: string;
    /** Nivel de explicación (FASE P: simple | detallado | avanzado) */
    explanationLevel?: string;
}

/**
 * Conversation entry for AI processing.
 */
export interface AIHistoryEntry {
    role: string;
    text: string;
    speakerName?: string;
    response?: string;
}

/**
 * Minute generation result.
 * Matches OS2's createMinuteDraftFromSummary format exactly.
 * NO contenido/puntos_clave — those do NOT exist in OS2.
 */
export interface AIMinuteResult {
    titulo: string;
    participantes: string[];
    resumen: string;
    acuerdos: string[];
    pendientes: string[];
    siguientes_pasos: string[];
    tema_sesion?: string;
}

/**
 * Summary generation result.
 * Same structure as AIMinuteResult — both produce the same OS2-compatible format.
 */
export interface AISummaryResult {
    titulo: string;
    participantes: string[];
    resumen: string;
    acuerdos: string[];
    pendientes: string[];
    siguientes_pasos: string[];
}

/**
 * Participant evaluation result.
 */
export interface AIParticipantEvaluation {
    intervenir: boolean;
    motivo_corto: string;
    borrador_aportacion: string;
    confianza: number;
}

/**
 * Workspace image generation result.
 */
export interface AIWorkspaceImageResult {
    image_url: string;
    trace: Record<string, unknown>;
}

/**
 * Input para analyzeDocument (F1) — lo que produce documentParser.
 * El LLM lo enriquece en un DocumentContract final (resumen/puntos_clave/escenarios).
 */
export interface DocumentAnalysisInput {
    tipo: string;
    nombre: string;
    mime: string;
    hojas?: Array<{ nombre: string; rol: string; celdas: number; errores: string[] }>;
    errores: string[];
    chunks: string[];
    rawText: string;
    resumen_heuristico: string;
    qa_context: string;
}

/**
 * Input para analyzeApp (F2) — resultado de la fase estática del appAnalyzer.
 */
export interface AppAnalysisInput {
    proyecto: string;
    framework: 'react' | 'flutter' | 'other';
    /** Resumen de la estructura (manifest/config/tabs/rutas/componentes). */
    estructura: string;
    /** Muestra de archivos relevantes. */
    archivos: string[];
    errores_detectados: string[];
}

/**
 * Input para generateDocument (F3) / generateVideo (F4).
 */
export interface GenerationInput {
    formato: GenerationFormato;
    parametros?: {
        calidad?: string;
        duracion_min?: number;
        orientacion?: string;
        tema?: string;
    };
    fuentes: Array<{ tipo: string; ref: string }>;
    /** Contenido ya analizado (contrato, texto o guion) a serializar. */
    contenido_analizado?: string;
}

/**
 * Resultado de generateDocument (F3) — contenido serializado listo para descargar.
 */
export interface GeneratedDocumentResult {
    content: string;
    mime: string;
    ext: string;
    nombre: string;
    bytes?: number;
    url?: string;
}

/**
 * AI Service Interface — all AI operations.
 * Implementations: GeminiService, FallbackService, MockService
 */
export interface IAIService {
    /** Generate a minute from conversation history */
    generateMinute(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
        emotionalState: string,
    ): Promise<AIMinuteResult>;

    /** Generate a contextual response */
    generateResponse(
        options: AIRequestOptions,
        userText: string,
        botName: string,
        history: AIHistoryEntry[],
    ): Promise<string>;

    /** Evaluate whether FLU should intervene */
    generateParticipantEvaluation(
        options: AIRequestOptions,
        conversationLog: string,
        maxDraftChars?: number,
    ): Promise<AIParticipantEvaluation>;

    /** Generate a conversation summary (OS2 style) */
    generateConversationSummary(
        options: AIRequestOptions,
        history: AIHistoryEntry[],
    ): Promise<AISummaryResult>;

    /** Generate a workspace image from a prompt */
    generateWorkspaceImage(
        prompt: string,
        tipo: string | null | undefined,
        language?: string,
    ): Promise<AIWorkspaceImageResult>;

    /** Analyze an image via Gemini Vision (OCR/digitalization) */
    generateVisionAnalysis(
        imageBase64: string,
        mimeType: string,
        language?: string,
        profile?: string,
    ): Promise<{
        materia: string;
        problemas: string[];
        instrucciones: string;
        nivel: string;
        texto_extraido: string;
    }>;

    /** F1 — analizar un documento parseado en un documentContract completo. */
    analyzeDocument(
        payload: DocumentAnalysisInput,
        language?: string,
    ): Promise<DocumentContract>;

    /** F2 — analizar la funcionalidad de una app (fase estática → appAnalysisContract). */
    analyzeApp(
        payload: AppAnalysisInput,
        language?: string,
    ): Promise<AppAnalysisContract>;

    /** F3 — generar un documento (contenido del LLM serializado por el adaptador). */
    generateDocument(
        payload: GenerationInput,
        language?: string,
    ): Promise<GeneratedDocumentResult>;
}
