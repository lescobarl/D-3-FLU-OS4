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

export interface WorkspaceImageState {
    /** URL de la imagen generada, o null si no hay */
    imageUrl: string | null;
    /** Si está en proceso de carga */
    isLoading: boolean;
    /** Si la carga falló */
    isFailed: boolean;
    /** Si el overlay de imagen expandida está visible */
    isExpanded: boolean;
    /** Reintentar generación con el último prompt/tipo */
    retry: () => void;
    /** Abrir overlay expandido */
    expand: () => void;
    /** Cerrar overlay expandido */
    close: () => void;
    /** Marcar como fallido (para onError en JSX) */
    markFailed: () => void;
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

    // ---- Estados ----
    const [imageUrl, setImageUrl] = useState<string | null>(null);
    const [isExpanded, setIsExpanded] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isFailed, setIsFailed] = useState(false);

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
        setIsFailed(true);
        clearLoadTimeout();
    }, [clearLoadTimeout]);

    // ---- Generate from contract ----
    const generateFromContract = useCallback(async (promptVisual: string, tipo: string | null) => {
        // Guardar prompt y tipo para posible retry
        promptRef.current = promptVisual;
        tipoRef.current = tipo;
        setIsLoading(true);
        setIsFailed(false);
        const requestId = Date.now();
        requestRef.current = requestId;
        try {
            const result = await aiService.generateWorkspaceImage(promptVisual, tipo, language);
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
    useEffect(() => {
        if (imageUrl && !isFailed) {
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
        retry,
        expand,
        close,
        markFailed,
        generateFromContract,
        clear,
        loadTimeoutRef,
        urlRef,
    };
}
