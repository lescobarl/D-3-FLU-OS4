// ============================================================
// Gemini API Proxy — OS2 parity middleware for Vite
// OS2's useFluVoiceAssistant calls requestFluContract(),
// requestParticipantEvaluation(), requestConversationSummary()
// which POST to /api/gemini/* endpoints.
// In OS2 there's a backend Express server; in OS3 we proxy
// directly to Gemini API via Vite middleware.
//
// This proxy imports the canonical implementations from OS2's
// gemini.js — no duplicate code, no patches, no dual paths.
//
// UNIFIED PROXY (OS4):
// ALL Gemini API calls MUST go through this proxy.
// GeminiService (gemini.ts) delegates here instead of calling
// Gemini directly. This ensures a single source of truth.
// ============================================================

import type { IncomingMessage, ServerResponse } from 'http';
import { appendFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Imprime la entrada del relay y la ANEXA a `debug.log` (fichero LIMPIABLE: se trunca
 * al arrancar el server). Es diagnostico: si la escritura falla, se registra y no
 * tumba el relay.
 */
function writeClientLogLine(file: string | null, line: string, data: unknown): void {
    if (data !== undefined) console.info(line, data);
    else console.info(line);
    if (!file) return;
    try {
        appendFileSync(file, line + '\n');
    } catch (err: unknown) {
        logCaughtError('[geminiProxy] client log: fallo al escribir debug.log', errorField(err, 'message') || err);
    }
}
import { sendJson, type MiddlewareHost } from './httpJson';
import { logCaughtError } from '../lib/caughtError';
import {
    OPENROUTER_DEFAULTS,
    isLocalTextEndpoint,
    joinApiUrl,
    resolveServerTextApiKey,
    resolveServerTextApiUrl,
    setServerEnv,
} from '../core/config/sharedConfig';

// ─── Import canonical implementations from OS2 ──────────────
// These are the exact same functions OS2 uses in its Express server.
import {
    generateFluContract,
    generateConversationSummary,
    generateOpenRouterImage,
    generateVideoViaFal,
    generateParticipantEvaluation,
    generateWorkspaceImage,
    analyzeImage,
} from '../voice/lib/gemini.js';

// ─── Response Cache ──────────────────────────────────────────
// Evita llamadas duplicadas a Gemini.
// - Contract/response cache: 30s TTL (conversación dinámica) — Fase 6
// - Participant eval cache: 30s TTL (same conversation window)

/**
 * Cuerpo JSON aceptado por los endpoints del proxy (campos conocidos).
 *
 * `history`, `personality` y `creativity` replican los tipos que infiere
 * TypeScript para los parámetros de `voice/lib/gemini.js` (módulo JS sin
 * declaraciones): `never[]` y `null`. El valor real llega del JSON parseado,
 * por lo que en runtime no se restringe.
 */
interface ProxyBody {
    apiKey?: string;
    transcript?: string;
    history?: never[];
    language?: string;
    mode?: string;
    knowledgeMode?: string;
    personality?: null;
    creativity?: null;
    role?: string;
    theme?: string;
    intent?: string;
    speaker?: string;
    phase?: string;
    model?: string;
    conversationLog?: string;
    maxDraftChars?: number;
    prompt?: string;
    system?: string;
    maxTokens?: number;
    temperature?: number;
    imageBase64?: string;
    mimeType?: string;
    profile?: string;
    workspace?: unknown;
    count?: number;
    // Entradas del turno que el motor de voz SI envia y que antes no estaban
    // declaradas aqui (por eso el borde las perdia sin que nada lo dijera).
    knowledgeBase?: string;
    knowledgeBase2?: string;
    recentMemory?: string;
    startupPrompt?: string;
    agendaText?: string;
    selfKnowledgeText?: string;
    diaryContext?: string;
    notesContext?: string;
    horarioContext?: string;
    resultadosContext?: string;
    delta?: boolean;
    level?: string;
    tag?: string;
    message?: string;
    data?: unknown;
    [key: string]: unknown;
}

/** Lee un campo de un error lanzado sin asumir su forma (nunca lanza). */
function errorField(err: unknown, key: string): unknown {
    if (err && typeof err === 'object') return Reflect.get(err, key);
    return undefined;
}

interface CacheEntry {
    data: unknown;
    timestamp: number;
}

const CONTRACT_CACHE = new Map<string, CacheEntry>();
const CONTRACT_CACHE_TTL_MS = 30_000;                 // Fase 6: 60s → 30s (conversación dinámica)
const CONTRACT_CACHE_MAX = 100;                       // OPTIMIZATION E: 50 → 100

const EVAL_CACHE = new Map<string, CacheEntry>();
const EVAL_CACHE_TTL_MS = 30_000;           // 30s (OPTIMIZATION C)
const EVAL_CACHE_MAX = 50;

const VISION_CACHE = new Map<string, CacheEntry>();
const VISION_CACHE_TTL_MS = 300_000;        // 5 min (imagen repetida = mismo análisis)
const VISION_CACHE_MAX = 20;

// ─── IMAGE GENERATION CACHE ───────────────────────────────────
function getCachedResponse(cache: Map<string, CacheEntry>, key: string, ttl: number): unknown | null {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > ttl) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function setCachedResponse(cache: Map<string, CacheEntry>, key: string, data: unknown, max: number): void {
    if (cache.size >= max) {
        const oldest = cache.entries().next().value;
        if (oldest) cache.delete(oldest[0]);
    }
    cache.set(key, { data, timestamp: Date.now() });
}

/** Hash ligero sin dependencias (djb2) para huellas de transcript/history/config. */
function simpleHash(input: string): string {
    let hash = 5381;
    const str = String(input ?? '');
    for (let i = 0; i < str.length; i += 1) {
        hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0; // hash * 33 + c
    }
    return hash.toString(36);
}

/**
 * Fase 6 — Clave de caché mejorada para CONTRACT_CACHE.
 * Mantiene la firma endurecida previa (normalizado | historia | fuente | idioma | firma)
 * y AÑADE:
 *  - mode / knowledgeMode: aísla 'contract' | 'response' | 'minutes'.
 *  - transcript_hash / history_hash: huellas completas del contenido (ya no sólo longitud).
 *  - config fingerprint (personality + creativity): invalida la caché al cambiar
 *    la configuración del asistente (Fase 6, punto 3).
 */
function buildContractCacheKey(body: ProxyBody | null): string {
    // La clave se deriva del CUERPO COMPLETO (menos la apiKey, que no cambia el
    // prompt): asi cualquier entrada que module la respuesta -phase, role, theme,
    // startupPrompt, agendaText, recentMemory, KB, contextos del radar- invalida
    // la entrada de cache. Antes la clave solo cubria transcript+history+idioma+
    // mode+knowledgeMode+personality+creativity, y dos turnos con el MISMO
    // transcript y distinto rol/fase recibian la respuesta del otro (medido
    // 2026-10-03: rol Medico y rol Chef -> respuestas byte-identicas).
    const payload: Record<string, unknown> = { ...(body ?? {}) };
    delete payload.apiKey;
    const mode = body?.mode || 'contract';
    return `${mode}|${simpleHash(JSON.stringify(payload))}`;
}

/**
 * Build a hash key for participant evaluation caching (OPTIMIZATION C).
 * The evaluation depends on the conversation log content and config.
 */
function buildEvalCacheKey(body: ProxyBody | null): string {
    const conversationLog = body?.conversationLog;
    // Use first 200 chars of conversationLog as fingerprint (enough to detect changes)
    const logFingerprint = (conversationLog || '').slice(0, 200);
    return `${logFingerprint}|${body?.language || 'es'}|${body?.role || ''}|${body?.theme || ''}|${body?.maxDraftChars || 420}`;
}

// ─── Shared helpers ──────────────────────────────────────────

function parseBody<T = ProxyBody>(req: IncomingMessage): Promise<T | null> {
    return new Promise<T | null>((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => {
            if (chunks.length === 0) return resolve(null);
            const body = Buffer.concat(chunks).toString('utf-8');
            try {
                resolve(JSON.parse(body));
            } catch (e) {
        logCaughtError('[catch] src/server/geminiProxy.ts', e);
                resolve(null);
            }
        });
        req.on('error', (err) => reject(err));
    });
}

/**
 * Lee el cuerpo crudo como texto (para sinks que envían NDJSON, no JSON).
 * @param req Petición entrante.
 * @returns El cuerpo completo como string UTF-8.
 */
function readRawBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        req.on('data', (chunk: Buffer) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        req.on('error', (err) => reject(err));
    });
}

// ─── Request handlers ────────────────────────────────────────

// Key del servidor inyectada desde .env (vite.config.ts → loadEnv →
// createGeminiMiddleware({ env })). El bundle de configuración de Vite no
// expone las variables de .env a import.meta.env, así que el proxy la recibe
// aquí y la usa como respaldo cuando el cliente no envía apiKey.
let serverEnvApiKey = '';

/**
 * Sonda de diagnostico del turno (P8.28), APAGADA por defecto: con
 * FLU_CONTRACT_TRACE=1 el proxy registra QUE le llega en cada turno de contrato
 * (transcript, rol, tema, fase, KB y cola del historial). Existe porque el sintoma
 * del dueno (una pregunta real respondida con la personalidad del perfil) no se
 * reproduce con el cuerpo minimo: hay que ver el cuerpo REAL. No cambia conducta.
 */
function isContractTraceOn(): boolean {
    return process.env.FLU_CONTRACT_TRACE === '1' || process.env.FLU_CONTRACT_TRACE === 'true';
}

// Prioridad server-side SIN estado: env (.env) > apiKey del cliente
// (panel/localStorage, BYOK). El operador configura la key en .env = fuente de
// verdad; la key del navegador solo se usa cuando el servidor no tiene ninguna.
// No hay caché de "última key vista" (0 parches): una key obsoleta/inválida de
// localStorage jamás se reutiliza ni pisa la key real del servidor. Devuelve el
// body con la apiKey resuelta para que gemini.js (fuente canónica OS2) la
// reciba por su parámetro documentado y nunca caiga en el fallback "API key no
// configurada".
function resolveServerApiKey(body: ProxyBody | null): ProxyBody | null {
    if (serverEnvApiKey) {
        return { ...(body || {}), apiKey: serverEnvApiKey };
    }
    // Sin clave de servidor se respeta el cuerpo tal cual (la clave del cliente,
    // si viene, ya está dentro): no hay nada que reescribir.
    return body;
}

/**
 * Genera el contrato FLU completo (modo por defecto, paridad OS2).
 * @param body — Cuerpo de la petición con transcript, history, config, etc.
 */
/**
 * Traduce el cuerpo HTTP al contrato de `generateFluContract` (DUENO UNICO de
 * "que entradas del turno viajan al prompt").
 *
 * El cuerpo se reenvia COMPLETO: el generador ya declara que campos acepta, asi
 * que el proxy no mantiene aqui una lista blanca que pueda divergir. Defecto
 * medido (auditoria 2026-10-03): la lista blanca filtraba 10 de los 22 campos
 * del turno (knowledgeBase, knowledgeBase2, recentMemory, startupPrompt,
 * agendaText, selfKnowledgeText, diaryContext, notesContext, horarioContext,
 * resultadosContext), dejando mudos en el carril de voz el radar de contexto
 * (bloques 6-9), la personalidad del perfil, el bloque de emocion, el
 * autoconocimiento y la KB/minutas. Guard: tests/contractBoundaryGuard.test.ts
 * @param body Cuerpo de la peticion (se reenvia integro).
 */
/**
 * Traduce el cuerpo HTTP al contrato de `generateFluContract`.
 *
 * DUENO UNICO de "que entradas del turno viajan al prompt". La lista se
 * declara aqui y NO puede divergir en silencio: `tests/contractBoundaryGuard`
 * cuenta estas claves contra las que envia el motor de voz y mide, campo a
 * campo, que cada una llega al prompt (mas los campos condicionales de su modo).
 * Mantener la lista corta provoco el defecto medido del 2026-10-03: 10 de 22
 * campos perdidos (agenda, diario, notas, horario, resultados, KB general, KB
 * de minutas, autoconocimiento, emocion y personalidad del perfil) -> el radar
 * de contexto (bloques 6-9), la personalidad del perfil y la KB quedaron mudos
 * en el carril de voz. Las claves del generador NO se pueden derivar por tipo
 * (`Parameters<typeof generateFluContract>[0]` resuelve a `never` porque el
 * modulo es JS sin tipos), asi que la lista es la declaracion del contrato.
 *
 * @param body Cuerpo ya resuelto por `resolveServerApiKey`.
 */
function proxyBodyToGenerateParams(body: ProxyBody | null) {
    return {
        apiKey: body?.apiKey,
        transcript: body?.transcript,
        intent: body?.intent,
        speaker: body?.speaker,
        theme: body?.theme,
        role: body?.role,
        phase: body?.phase,
        model: body?.model,
        language: body?.language,
        history: body?.history,
        knowledgeMode: body?.knowledgeMode,
        personality: body?.personality,
        creativity: body?.creativity,
        knowledgeBase: body?.knowledgeBase,
        knowledgeBase2: body?.knowledgeBase2,
        recentMemory: body?.recentMemory,
        startupPrompt: body?.startupPrompt,
        agendaText: body?.agendaText,
        selfKnowledgeText: body?.selfKnowledgeText,
        diaryContext: body?.diaryContext,
        notesContext: body?.notesContext,
        horarioContext: body?.horarioContext,
        resultadosContext: body?.resultadosContext,
    };
}

async function handleContractMode(body: ProxyBody | null): Promise<unknown> {
    return generateFluContract(proxyBodyToGenerateParams(body));
}

/**
 * Genera únicamente la respuesta hablada, sin contrato (modo `response`).
 * Usado por GeminiService.generateResponse() para Push-to-Talk fallback.
 * @param body — Cuerpo de la petición con transcript, language, role, theme, history, etc.
 */
async function handleResponseMode(body: ProxyBody | null): Promise<{ respuesta_voz: string; text: string }> {
    // Los defaults del modo `response` se aplican SOBRE el reenvio completo
    // (nunca en lugar de el): la lista de campos que viajan tiene un solo dueno.
    const fullResult = await generateFluContract({
        ...proxyBodyToGenerateParams(body),
        transcript: body?.transcript || '',
        language: body?.language || 'es',
        role: body?.role || '',
        theme: body?.theme || '',
        history: body?.history || [],
        personality: body?.personality || null,
        intent: body?.intent || '',
        speaker: body?.speaker || '',
        phase: body?.phase || '',
        model: body?.model || undefined,
    });
    return {
        respuesta_voz: fullResult?.contract?.respuesta_voz || '',
        text: fullResult?.contract?.respuesta_voz || '',
    };
}

/**
 * Genera un resumen de conversación estilo minuta (modo `minute`).
 * Usado por GeminiService.generateMinute().
 * @param body — Cuerpo de la petición con history, language, role, theme, model.
 */
async function handleMinuteMode(body: ProxyBody | null): Promise<unknown> {
    const summaryResult = await generateConversationSummary({
        apiKey: body?.apiKey,
        history: body?.history || [],
        language: body?.language || 'es',
        role: body?.role || '',
        theme: body?.theme || '',
        model: body?.model || undefined,
    });
    return summaryResult?.summary || summaryResult;
}

/**
 * Despacha la petición `/api/gemini/contract` según `body.mode`
 * (`contract` | `response` | `minute`), aplicando caché a los modos `contract` y `response`
 * (Fase 6). Cada modo queda aislado en su propia función (sin caminos duplicados).
 */
async function handleContract(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);
        const mode = body?.mode || 'contract';

        // PUERTA DEL TRANSCRIPT (dueno unico: el proxy). Sin transcript NO hay
        // pregunta y el modelo NO debe generar: contestaba un SALUDO que el turno
        // hablaba como respuesta a la pregunta real del usuario. Defecto medido
        // (2026-10-02, bug del dueno "Okay Flow Platicame de los aviones" -> "Soy
        // FLU, tu asistente de voz. En que puedo ayudarte hoy?"): con el cuerpo
        // perdido (body ausente/vacio/null, o transcript en blanco) el proxy
        // respondia 200 y el saludo se commiteaba como respuesta del turno. Su
        // hermano /api/gemini/text ya rechaza el campo ausente con 400
        // missing_prompt; aqui faltaba la misma puerta. Se rechaza ANTES de la
        // cache y del modelo.
        if (isContractTraceOn()) {
            const hist = body?.history;
            console.info('[geminiProxy][trace] contrato IN', {
                mode,
                transcript: String(body?.transcript ?? '').slice(0, 140),
                role: body?.role,
                theme: body?.theme,
                phase: body?.phase,
                knowledgeMode: body?.knowledgeMode,
                kbLen: String(body?.knowledgeBase ?? '').length,
                kb2Len: String(body?.knowledgeBase2 ?? '').length,
                startupLen: String(body?.startupPrompt ?? '').length,
                startupHead: String(body?.startupPrompt ?? '').slice(0, 90),
                selfKnowledgeLen: String(body?.selfKnowledgeText ?? '').length,
                personalityOn: Boolean(body?.personality),
                historyType: Array.isArray(hist) ? 'array' : typeof hist,
                historyLen: Array.isArray(hist) ? hist.length : String(hist ?? '').length,
                historyTail: JSON.stringify(Array.isArray(hist) ? hist.slice(-3) : hist).slice(0, 400),
            });
        }

        const requiresTranscript = mode === 'contract' || mode === 'response';
        if (requiresTranscript && !String(body?.transcript ?? '').trim()) {
            // Sonda P8.28 (mecanismo no reproducido de la perdida del cuerpo):
            // si reaparece, el log dice QUE llego (claves del cuerpo) y no hay que
            // adivinar. Encendida por defecto: solo escribe cuando la puerta salta.
            console.info(
                '[geminiProxy] contrato SIN transcript: se rechaza sin llamar al modelo',
                { mode, hasBody: body !== null, keys: Object.keys(body ?? {}).slice(0, 24) },
            );
            return sendJson(res, 400, {
                error: 'missing_transcript',
                detail: 'El campo "transcript" es obligatorio.',
            });
        }

        // ── Cache check (contract + response) ──────────────────
        // Fase 6: caché por (transcript_hash, history_hash, language, mode,
        // knowledgeMode, config fingerprint) con TTL 30s (conversación dinámica).
        const isCacheableMode = mode === 'contract' || mode === 'response';
        let contractCacheKey = '';
        if (isCacheableMode && body?.transcript) {
            contractCacheKey = buildContractCacheKey(body);
            const cached = getCachedResponse(CONTRACT_CACHE, contractCacheKey, CONTRACT_CACHE_TTL_MS);
            if (cached) {
                return sendJson(res, 200, cached);
            }
        }

        // ── Dispatch por modo (cada modo es una función separada) ──
        let result: unknown;
        if (mode === 'response') {
            result = await handleResponseMode(body);
        } else if (mode === 'minute') {
            result = await handleMinuteMode(body);
        } else {
            result = await handleContractMode(body);
        }

        // ── Cache the result ───────────────────────────────────
        if (contractCacheKey) {
            setCachedResponse(CONTRACT_CACHE, contractCacheKey, result, CONTRACT_CACHE_MAX);
        }

        sendJson(res, 200, result);
    } catch (caught: unknown) {
        const error = { status: Number(errorField(caught, 'status')) || 500 };
        const message = errorField(caught, 'message');
        logCaughtError('[geminiProxy] handleContract ERROR', message, {
            code: errorField(caught, 'code'),
            status: error.status,
            apiKeySource: errorField(caught, 'apiKeySource'),
            model: errorField(caught, 'model'),
            detail: errorField(caught, 'detail'),
        });
        sendJson(res, error.status || 500, {
            error: message,
            code: errorField(caught, 'code') || 'unknown',
            detail: errorField(caught, 'detail') || '',
            model: errorField(caught, 'model') || '',
            apiKeySource: errorField(caught, 'apiKeySource') || '',
            bodyPreview: errorField(caught, 'bodyPreview') || '',
        });
    }
}

async function handleSummary(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);
        const result = await generateConversationSummary({
            apiKey: body?.apiKey,
            history: body?.history || [],
            language: body?.language || 'es',
            role: body?.role || '',
            theme: body?.theme || '',
            model: body?.model || undefined,
        });

        // OS2 returns { summary: { titulo, ... }, diagnostics: {...} }
        // Normalize: flatten summary if nested
        const normalized = result?.summary
            ? {
                ...result.summary,
                diagnostics: result.diagnostics || null,
            }
            : result;

        sendJson(res, 200, normalized);
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/gemini/summary error', errorField(error, 'message'));
        sendJson(res, Number(errorField(error, 'status')) || 500, {
            error: errorField(error, 'message'),
            code: errorField(error, 'code') || 'unknown',
            detail: errorField(error, 'detail') || '',
            model: errorField(error, 'model') || '',
            apiKeySource: errorField(error, 'apiKeySource') || '',
            bodyPreview: errorField(error, 'bodyPreview') || '',
        });
    }
}

async function handleParticipantEval(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);

        // ── Participant eval cache (OPTIMIZATION C) ────────────
        // Cache evaluation results for the same conversation window (30s TTL).
        // This avoids re-evaluating the same context when FLU checks multiple times.
        if (body?.conversationLog) {
            const cacheKey = buildEvalCacheKey(body);
            const cached = getCachedResponse(EVAL_CACHE, cacheKey, EVAL_CACHE_TTL_MS);
            if (cached) {
                return sendJson(res, 200, cached);
            }
        }

        const result = await generateParticipantEvaluation({
            apiKey: body?.apiKey,
            conversationLog: body?.conversationLog || '',
            language: body?.language || 'es',
            role: body?.role || '',
            theme: body?.theme || '',
            maxDraftChars: body?.maxDraftChars || 420,
            model: body?.model || undefined,
        });

        // OS2 returns { evaluation: { intervenir, ... }, diagnostics: {...} }
        // Normalize: flatten evaluation if nested
        const normalized = result?.evaluation
            ? {
                ...result.evaluation,
                diagnostics: result.diagnostics || null,
            }
            : result;

        // Cache the normalized result
        if (body?.conversationLog) {
            const cacheKey = buildEvalCacheKey(body);
            setCachedResponse(EVAL_CACHE, cacheKey, normalized, EVAL_CACHE_MAX);
        }

        sendJson(res, 200, normalized);
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/gemini/participant-eval error', errorField(error, 'message'));
        sendJson(res, Number(errorField(error, 'status')) || 500, {
            error: errorField(error, 'message'),
            code: errorField(error, 'code') || 'unknown',
            detail: errorField(error, 'detail') || '',
            model: errorField(error, 'model') || '',
            apiKeySource: errorField(error, 'apiKeySource') || '',
            bodyPreview: errorField(error, 'bodyPreview') || '',
        });
    }
}

async function handleWorkspaceImage(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);
        const result = await generateWorkspaceImage({ workspace: body?.workspace, language: body?.language });
        sendJson(res, 200, result);
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/workspace-image error', errorField(error, 'message'));
        sendJson(res, Number(errorField(error, 'status')) || 500, { error: errorField(error, 'message') });
    }
}

// Paso 5: fallback de imagen por OpenRouter (único fallback real cuando la
// URL de Pollinations falla al cargar en el navegador). La apiKey se resuelve
// en el servidor (env > cliente) y nunca se expone al browser.
async function handleOpenRouterImage(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);
        const result = await generateOpenRouterImage(body || {});
        sendJson(res, 200, result);
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/openrouter-image error', errorField(error, 'message'));
        sendJson(res, Number(errorField(error, 'status')) || 500, { error: errorField(error, 'message') });
    }
}

// Video real con fal.ai (text-to-video). La apiKey viaja del cliente (FALAI_CONFIG.API_KEY)
// o de env; nunca se resuelve con la clave de texto/OpenRouter.
async function handleFalVideo(req: IncomingMessage, res: ServerResponse) {
    try {
        const body = await parseBody(req);
        const result = await generateVideoViaFal(body || {});
        sendJson(res, 200, result);
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/fal-video error', errorField(error, 'message'));
        sendJson(res, Number(errorField(error, 'status')) || 500, { error: errorField(error, 'message') });
    }
}

async function handleVisionAnalysis(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);
        const apiKey = body?.apiKey ?? '';
        const imageBase64 = body?.imageBase64;
        const mimeType = body?.mimeType ?? '';
        const language = body?.language;
        const profile = body?.profile;

        if (!imageBase64) {
            return sendJson(res, 400, { error: 'imageBase64 is required' });
        }

        // Cache por hash parcial del base64 (primeros 100 chars)
        const cacheKey = `vision:${(imageBase64 || '').slice(0, 100)}`;
        const cached = getCachedResponse(VISION_CACHE, cacheKey, VISION_CACHE_TTL_MS);
        if (cached) {
            return sendJson(res, 200, cached);
        }

        const result = await analyzeImage({ apiKey, imageBase64, mimeType, language, profile });
        setCachedResponse(VISION_CACHE, cacheKey, result, VISION_CACHE_MAX);
        sendJson(res, 200, result);
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/gemini/vision error', errorField(error, 'message'));
        sendJson(res, Number(errorField(error, 'status')) || 500, { error: errorField(error, 'message') });
    }
}

// ─── Generic text generation (F1/F2/F3/F4 via Gemini) ─────────
// Endpoint genérico: recibe un prompt (y sistema opcional) y
// devuelve { text } llamando directamente a la REST API de Gemini.
// Mantiene el invariante "todas las llamadas Gemini pasan por el
// proxy" sin modificar gemini.js (fuente canónica OS2 intacta).
// El apiKey/model llegan del cliente (config centralizada) y se
// resuelven con respaldo a env de Vite.
async function handleText(req: IncomingMessage, res: ServerResponse) {
    try {
        let body = await parseBody(req);
        body = resolveServerApiKey(body);
        const prompt = String(body?.prompt || '').trim();
        if (!prompt) {
            return sendJson(res, 400, { error: 'missing_prompt', detail: 'El campo "prompt" es obligatorio.' });
        }
        const apiKey = String(body?.apiKey || '').trim() || resolveServerTextApiKey();
        const url = joinApiUrl(resolveServerTextApiUrl(), '/chat/completions');
        const local = isLocalTextEndpoint(url);
        if (!apiKey && !local) {
            return sendJson(res, 503, { error: 'no_api_key', detail: 'Sin API key de texto configurada (OpenRouter/Gemini).' });
        }
        const model = String(body?.model || '').trim() || OPENROUTER_DEFAULTS.MODEL;
        const system = String(body?.system || '').trim();
        const maxTokens = Number(body?.maxTokens || 2048);
        const temperatureRaw = body?.temperature;
        const temperature = (temperatureRaw !== undefined && temperatureRaw !== null && !isNaN(Number(temperatureRaw)))
            ? Number(temperatureRaw)
            : undefined;

        const messages: Array<{ role: string; content: string }> = [];
        if (system) {
            messages.push({ role: 'system', content: system });
        }
        messages.push({ role: 'user', content: prompt });

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) {
            headers['Authorization'] = `Bearer ${apiKey}`;
        }
        const payload: Record<string, unknown> = {
            model,
            messages,
            max_tokens: maxTokens,
            ...(temperature !== undefined ? { temperature } : {}),
        };
        if (!local) {
            payload.response_format = { type: 'json_object' };
        }

        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const detail = await response.text().catch((e) => { logCaughtError('[catch] src/server/geminiProxy.ts', e); return ''; });
            console.error('[geminiProxy] /api/gemini/text upstream error:', response.status, detail.slice(0, 300));
            return sendJson(res, response.status, { error: 'gemini_api_error', detail: detail.slice(0, 500) });
        }
        const data = await response.json();
        const text = String(data?.choices?.[0]?.message?.content || '');
        return sendJson(res, 200, { text });
    } catch (error: unknown) {
        logCaughtError('[geminiProxy] /api/gemini/text ERROR', errorField(error, 'message') || error);
        return sendJson(res, 500, { error: 'internal_error', detail: errorField(error, 'message') || 'Unknown error' });
    }
}

// ─── Middleware factory ───────────────────────────────────────

export function createGeminiMiddleware({ env = {} }: { env?: Record<string, string> } = {}) {
    // Capturar la key de texto desde .env (inyectada vía loadEnv en vite.config.ts).
    // Prioridad única (sharedConfig): VITE_OPENROUTER > VITE_GEMINI > VITE_DEEPSEEK.
    setServerEnv(env);
    serverEnvApiKey = resolveServerTextApiKey();
    return {
        name: 'gemini-proxy',
        configureServer(server: MiddlewareHost) {
            // POST /api/gemini/contract — OS2's requestFluContract()
            server.middlewares.use('/api/gemini/contract', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleContract(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/gemini/contract', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/gemini/summary — OS2's requestConversationSummary()
            server.middlewares.use('/api/gemini/summary', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleSummary(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/gemini/summary', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/gemini/participant-eval — OS2's requestParticipantEvaluation()
            server.middlewares.use('/api/gemini/participant-eval', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleParticipantEval(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/gemini/participant-eval', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/workspace-image — OS2's fetchWorkspaceImageSource()
            server.middlewares.use('/api/workspace-image', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleWorkspaceImage(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/workspace-image', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/openrouter-image — fallback de imagen por OpenRouter
            // (único fallback real cuando la URL de Pollinations falla al cargar).
            server.middlewares.use('/api/openrouter-image', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleOpenRouterImage(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/openrouter-image', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/fal-video — video real con fal.ai (text-to-video)
            server.middlewares.use('/api/fal-video', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleFalVideo(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/fal-video', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/gemini/vision — OCR analysis of uploaded images
            server.middlewares.use('/api/gemini/vision', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleVisionAnalysis(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/gemini/vision', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /api/gemini/text — generic text generation (F1/F2/F3/F4)
            server.middlewares.use('/api/gemini/text', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    await handleText(req, res);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] Unhandled error in /api/gemini/text', errorField(err, 'message') || err);
                    sendJson(res, 500, { error: 'internal_error', detail: errorField(err, 'message') || 'Unknown error' });
                }
            });
            // POST /__flu_agent_trace — OS2's fluTrace.js agent sink (accepted, logged)
            server.middlewares.use('/__flu_agent_trace', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    const body = await parseBody(req);
                    const count = Number(body?.count) || 0;
                    console.info(
                        `[geminiProxy] agent trace aceptado (no persistido): count=${count} delta=${body?.delta === true}`,
                    );
                } catch (err: unknown) {
                    // El sink es de diagnóstico: un body ilegible no debe romper la app,
                    // pero tampoco se silencia (queda contexto en el log del servidor).
                    logCaughtError('[geminiProxy] agent trace: body ilegible, se acepta igual', errorField(err, 'message') || err);
                }
                sendJson(res, 200, { accepted: true, note: 'trace logged but not persisted' });
            });
            // POST /__flu_listen_log — OS2's listenLog.js (accepted, logged)
            server.middlewares.use('/__flu_listen_log', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    const raw = await readRawBody(req);
                    const lines = raw.split(/\r?\n/).filter(Boolean);
                    if (env.FLU_LISTEN_TRACE === '1' || env.FLU_LISTEN_TRACE === 'true') {
                        for (const line of lines) {
                            console.info(`[flu-listen] ${line}`);
                        }
                    }
                    console.info(`[geminiProxy] listen log aceptado (no persistido): ${lines.length} línea(s)`);
                } catch (err: unknown) {
                    logCaughtError('[geminiProxy] listen log: body ilegible, se acepta igual', errorField(err, 'message') || err);
                }
                sendJson(res, 200, { accepted: true, note: 'listen log logged but not persisted' });
            });
            // POST /__flu_client_log — Frontend log relay (BunnyViewer, avatar, etc.)
            // Roo (assistant) reads these from the server terminal to debug without browser access.
            let clientLogFile: string | null = null;
            try {
                clientLogFile = resolve(process.cwd(), 'debug.log');
                writeFileSync(clientLogFile, '');
            } catch (err: unknown) {
                clientLogFile = null;
                logCaughtError('[geminiProxy] client log: no se pudo abrir debug.log', errorField(err, 'message') || err);
            }
            server.middlewares.use('/__flu_client_log', async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
                if (req.method !== 'POST') return next();
                try {
                    const body = await parseBody<ProxyBody | ProxyBody[]>(req);
                    // Client sends arrays of log entries. Handle both array and single-object formats.
                    const entries = Array.isArray(body) ? body : [body];
                    for (const entry of entries) {
                        const level = entry?.level;
                        const tag = entry?.tag;
                        const message = entry?.message;
                        const data = entry?.data;
                        const ts = new Date().toISOString().slice(11, 23);
                        const safeMessage = message ?? '';
                        if (data !== undefined) {
                        writeClientLogLine(clientLogFile, `[flu-client ${ts}] ${level ?? 'info'} ${tag ?? ''} ${safeMessage}`, data);
                        } else {
                            writeClientLogLine(clientLogFile, `[flu-client ${ts}] ${level ?? 'info'} ${tag ?? ''} ${safeMessage}`, undefined);
                        }
                    }
                } catch (err: unknown) {
                    // Relay de diagnóstico: no se silencia el fallo de parseo.
                    logCaughtError('[geminiProxy] client log: body ilegible, se acepta igual', errorField(err, 'message') || err);
                }
                sendJson(res, 200, { accepted: true });
            });
        },
    };
}
