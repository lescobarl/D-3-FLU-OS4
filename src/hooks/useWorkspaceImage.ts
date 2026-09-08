// ============================================================
// useWorkspaceImage — Hook para gestión de imágenes del workspace
// ============================================================
// Extraído de App.tsx para reducir la carga del componente principal.
// Maneja:
//   - Refs para control de concurrencia (requestId, prompt, tipo, URL)
//   - Estados de carga/error/expansión
//   - Timeout de 30s para carga de imagen
//   - Retry de generación sin re-preguntar a Gemini
//   - Escape key para cerrar overlay
//   - Cleanup en unmount
// ============================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { aiService } from '../services/aiServiceFactory';
import { fetchOpenRouterImageFallback } from '../voice/lib/imageGeneration';
import { resolveTextApiKey } from '../core/config/appConfig';
import { relayLog } from '../lib/clientLogRelay';

/** Traza visible en el dev server (relayLog) para diagnosticar el eslabón de imagen. */
function traceImage(label: string, extra: Record<string, unknown>) {
    relayLog('LOG', 'WorkspaceImage', label, extra);
}

export interface WorkspaceImageState {
    /** URL de la imagen generada, o null si no hay */
    imageUrl: string | null;
    /** Si está en proceso de carga */
    isLoading: boolean;
    /** Si la carga falló */
    isFailed: boolean;
    /** Si el overlay de imagen expandida está visible */
    isExpanded: boolean;
    /** Contador de reintentos de carga de la URL (para forzar recarga del <img>) */
    loadAttempt: number;
    /** Reintentar generación con el último prompt/tipo */
    retry: () => void;
    /** Reintentar la carga de la URL actual (Pollinations es stateless: misma URL → misma imagen) */
    retryLoad: () => void;
    /** Abrir overlay expandido */
    expand: () => void;
    /** Cerrar overlay expandido */
    close: () => void;
    /** Marcar como fallido (para onError en JSX) */
    markFailed: () => void;
    /** Intentar fallback con generación por OpenRouter (único fallback) cuando Pollinations falla */
    fallbackToOpenRouter: () => Promise<void>;
    /** Generar imagen desde un contract de Gemini */
    generateFromContract: (promptVisual: string, tipo: string | null) => Promise<void>;
    /** Limpiar todo el estado de imagen */
    clear: () => void;
    /** Ref del timeout de carga (para onLoad/onError en JSX) */
    loadTimeoutRef: React.MutableRefObject<number>;
    /** Ref de la URL actual (para onLoad/onError en JSX) */
    urlRef: React.MutableRefObject<string>;
}

export function useWorkspaceImage(language: string): WorkspaceImageState {
    // ---- Refs ----
    const urlRef = useRef<string>('');
    const requestRef = useRef(0);
    const promptRef = useRef<string>('');
    const tipoRef = useRef<string | null>(null);
    const loadTimeoutRef = useRef<number>(0);
    // Contador de reintentos de carga de la URL (ref espejo de loadAttempt para
    // leer el valor actual de forma síncrona dentro de retryLoad sin efectos en el updater).
    const loadAttemptRef = useRef(0);

    // ---- Estados ----
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isFailed, setIsFailed] = useState(false);
    // Contador de reintentos de carga de la URL. Se incrementa en retryLoad()
    // para forzar una recarga del <img> (Pollinations es stateless: la misma
    // URL devuelve la misma imagen una vez generada, así que reintentar la URL
    // suele bastar ante fallos transitorios o generación lenta en frío).
    const [loadAttempt, setLoadAttempt] = useState(0);
    // Máximo de reintentos de carga de la URL antes de caer al fallback de Gemini.
    const MAX_LOAD_RETRIES = 3;

    // ---- Limpiar timeout ----
    const clearLoadTimeout = useCallback(() => {
        if (loadTimeoutRef.current) {
            clearTimeout(loadTimeoutRef.current);
            loadTimeoutRef.current = 0;
        }
    }, []);

    // ---- Retry ----
    const retry = useCallback(() => {
        const prompt = promptRef.current;
        const tipo = tipoRef.current;
        if (!prompt) return;
        loadAttemptRef.current = 0;
        setLoadAttempt(0);
        setIsLoading(true);
        setIsFailed(false);
        const requestId = Date.now();
        requestRef.current = requestId;
        aiService.generateWorkspaceImage(prompt, tipo, language).then((result) => {
            if (requestRef.current !== requestId) return;
            if (result.image_url) {
                urlRef.current = result.image_url;
                setImageUrl(result.image_url);
                setIsLoading(false);
                setIsFailed(false);
            } else {
                setIsLoading(false);
                setIsFailed(true);
            }
        }).catch((err) => {
            if (requestRef.current !== requestId) return;
            console.warn('[useWorkspaceImage] Retry failed:', err);
            setIsLoading(false);
            setIsFailed(true);
        });
    }, [language]);

    // ---- Expand / Close ----
    const expand = useCallback(() => setIsExpanded(true), []);
    const close = useCallback(() => setIsExpanded(false), []);

    // ---- Mark failed (for onError handlers in JSX) ----
    const markFailed = useCallback(() => {
        traceImage('markFailed (img onError/agotada)', {
            url: String(urlRef.current || '').slice(0, 120),
            prompt: String(promptRef.current || '').slice(0, 60),
        });
        setIsFailed(true);
        clearLoadTimeout();
    }, [clearLoadTimeout]);

    // ---- Fallback a OpenRouter image generation (único fallback) ----
    // Cuando la URL de Pollinations falla al cargar en el <img>, intentamos
    // generar la imagen por OpenRouter (si hay clave configurada) antes de
    // mostrar el placeholder. Devuelve un data URL que no depende de red.
    // El fallback es automático: si hay clave de OpenRouter, se considera.
    const fallbackToOpenRouter = useCallback(async () => {
        const prompt = promptRef.current;
        if (!prompt) {
            markFailed();
            return;
        }
        const apiKey = resolveTextApiKey();
        if (!apiKey) {
            markFailed();
            return;
        }
        // Evitar reintentos concurrentes: invalidar peticiones previas
        const requestId = Date.now();
        requestRef.current = requestId;
        setIsLoading(true);
        setIsFailed(false);
        try {
            const result = await fetchOpenRouterImageFallback({
                workspace: { prompt_visual: prompt, tipo: tipoRef.current },
                language,
                apiKey,
            });
            if (requestRef.current !== requestId) return;
            if (result.image_url) {
                urlRef.current = result.image_url;
                setImageUrl(result.image_url);
                setIsLoading(false);
                setIsFailed(false);
            } else {
                traceImage('openrouter-fallback:sin-URL', {
                    trace: (result as any)?.trace || undefined,
                    prompt: String(prompt).slice(0, 60),
                });
                console.warn('[useWorkspaceImage] OpenRouter fallback returned no image:', result.trace);
                setIsLoading(false);
                setIsFailed(true);
            }
        } catch (err) {
            if (requestRef.current !== requestId) return;
            console.warn('[useWorkspaceImage] OpenRouter fallback failed:', err);
            setIsLoading(false);
            setIsFailed(true);
        }
    }, [language, markFailed]);

    // ---- Retry load of current URL (Pollinations is stateless) ----
    // Cuando el <img> dispara onError por un fallo transitorio o por generación
    // lenta en frío, reintentamos cargar la MISMA URL (Pollinations es stateless:
    // una vez generada, la misma URL devuelve la misma imagen). Solo tras agotar
    // MAX_LOAD_RETRIES caemos al fallback de Gemini.
    const retryLoad = useCallback(() => {
        if (!urlRef.current) {
            markFailed();
            return;
        }
        // Los data/blob URLs (fallback de generación real: Gemini/OpenRouter)
        // no son stateless como Pollinations: si fallan, no se reintenta ni se
        // vuelve a generar en bucle; se marca el fallo y se deja decidir al usuario.
        const currentUrl = urlRef.current;
        if (currentUrl.startsWith('data:') || currentUrl.startsWith('blob:')) {
            markFailed();
            return;
        }
        if (loadAttemptRef.current >= MAX_LOAD_RETRIES) {
            // Agotados los reintentos de URL → fallback a OpenRouter (si hay clave)
            void fallbackToOpenRouter();
            return;
        }
        loadAttemptRef.current += 1;
        setLoadAttempt(loadAttemptRef.current);
    }, [fallbackToOpenRouter, markFailed]);

    // ---- Generate from contract ----
    const generateFromContract = useCallback(async (promptVisual: string, tipo: string | null) => {
        // Guardar prompt y tipo para posible retry
        promptRef.current = promptVisual;
        tipoRef.current = tipo;
        loadAttemptRef.current = 0;
        setLoadAttempt(0);
        setIsLoading(true);
        setIsFailed(false);
        const requestId = Date.now();
        requestRef.current = requestId;
        try {
            const result = await aiService.generateWorkspaceImage(promptVisual, tipo, language);
            if (requestRef.current !== requestId) return;
            traceImage('generateFromContract:result', {
                tipo,
                prompt: String(promptVisual).slice(0, 60),
                provider: (result as any)?.trace?.provider || (result as any)?.provider || '?',
                ok: Boolean(result.image_url),
                url: String(result.image_url || '').slice(0, 90),
                trace: (result as any)?.trace || undefined,
            });
            if (result.image_url) {
                urlRef.current = result.image_url;
                setImageUrl(result.image_url);
                setIsLoading(false);
                setIsFailed(false);
            } else {
                setIsLoading(false);
                setIsFailed(true);
            }
        } catch (err) {
            if (requestRef.current !== requestId) return;
            console.warn('[useWorkspaceImage] Generation failed:', err);
            setIsLoading(false);
            setIsFailed(true);
        }
    }, [language]);

    // ---- Clear ----
    const clear = useCallback(() => {
        requestRef.current = Date.now();
        setImageUrl(null);
        setIsLoading(false);
        setIsFailed(false);
        setIsExpanded(false);
        loadAttemptRef.current = 0;
        setLoadAttempt(0);
        urlRef.current = '';
        promptRef.current = '';
        tipoRef.current = null;
        clearLoadTimeout();
    }, [clearLoadTimeout]);

    // ---- Escape key handler ----
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape' && isExpanded) {
                setIsExpanded(false);
            }
        };
        if (isExpanded) {
            window.addEventListener('keydown', handleKeyDown);
        }
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isExpanded]);

    // ---- Cleanup on unmount ----
    useEffect(() => {
        return () => {
            urlRef.current = '';
            clearLoadTimeout();
        };
    }, [clearLoadTimeout]);

    // ---- Image load timeout ----
    // Solo aplica a URLs de red (Pollinations y similares). Los data/blob URLs
    // (imagen generada por el servidor: Gemini/OpenRouter) no dependen de red y
    // cargan casi instantáneamente; aplicarles el watchdog provocaba un falso
    // "No se pudo cargar la imagen" bajo una imagen ya visible (el onLoad puede
    // dispararse antes de registrar el temporizador).
    useEffect(() => {
        if (imageUrl && !isFailed && !imageUrl.startsWith('data:') && !imageUrl.startsWith('blob:')) {
            clearLoadTimeout();
            loadTimeoutRef.current = window.setTimeout(() => {
                console.warn('[useWorkspaceImage] Image load timeout (30s) for:', imageUrl);
                setIsFailed(true);
                loadTimeoutRef.current = 0;
            }, 30000);
        }
        return () => {
            clearLoadTimeout();
        };
    }, [imageUrl, isFailed, clearLoadTimeout]);

    return {
        imageUrl,
        isLoading,
        isFailed,
        isExpanded,
        loadAttempt,
        retry,
        retryLoad,
        expand,
        close,
        markFailed,
        fallbackToOpenRouter,
        generateFromContract,
        clear,
        loadTimeoutRef,
        urlRef,
    };
}
