// ============================================================
// AI Service Factory — Selecciona entre OpenRouter (texto) y Gemini (nativo)
// ============================================================
// Provides a unified interface for AI services with automatic
// fallback and configuration-based selection.
//
// Arquitectura (SOLO 2 APIs):
//   - Texto    → OpenRouter → Google Gemini 2.5 Flash Lite (default)
//   - Imágenes → Pollinations.ai (sin clave, siempre)
//
// Selection logic:
// 1. Check localStorage for preferred AI provider
// 2. Check environment variables
// 3. Default to 'openrouter' (Gemini 2.5 Flash Lite via OpenRouter)
// ============================================================

import { geminiService } from './gemini';
import { deepseekService } from './deepseek';
import type { IAIService } from '../core/ai/IAIService';
import { logCaughtError } from '../lib/caughtError';
import { AI_PROVIDER_ROUTES, type AIProvider } from '../core/config/sharedConfig';
import {
    getPreferredAIProvider,
    setPreferredAIProvider,
} from '../core/ai/providerPreference';

// Re-export del tipo canónico (fuente única: sharedConfig.ts) para no romper
// a los importadores históricos de aiServiceFactory.
export type { AIProvider };

// Re-export del dueño único de la preferencia del proveedor.
export { getPreferredAIProvider, setPreferredAIProvider };

/**
 * Get the appropriate AI service instance based on configuration.
 * Includes automatic fallback if the primary service fails.
 *
 * IMPORTANT: Image generation operations always use Pollinations.ai
 * (via the text engine wrapper), regardless of the text provider.
 */
export function getAIService(): IAIService {
    const provider = getPreferredAIProvider();

    // Ruta de despacho declarada en config (AI_PROVIDER_ROUTES); el motor de
    // texto OpenAI-compatible cubre openrouter/deepseek/local, y 'native'
    // resuelve a Gemini nativo (API directa de Google).
    const route = AI_PROVIDER_ROUTES[provider];
    return route === 'native' ? geminiService : createIntelligentAIService();
}

/**
 * Creates an intelligent AI service that routes ALL text through the
 * OpenAI-compatible text engine (OpenRouter → Gemini 2.5 Flash Lite) and
 * ALL image generation through Pollinations.ai.
 */
function createIntelligentAIService(): IAIService {
    const primaryService = deepseekService;
    const fallbackService = geminiService;
    
    return {
        // Delegate most operations to the text engine (OpenRouter/Gemini)
        generateMinute: primaryService.generateMinute.bind(primaryService),
        generateResponse: primaryService.generateResponse.bind(primaryService),
        generateParticipantEvaluation: primaryService.generateParticipantEvaluation.bind(primaryService),
        generateConversationSummary: primaryService.generateConversationSummary.bind(primaryService),
        generateVisionAnalysis: primaryService.generateVisionAnalysis.bind(primaryService),

        // Capacidad del SISTEMA (no del adapter): el gate de texto pregunta por el
        // proveedor activo. Se delega para que la respuesta sea unica.
        canUseTextBackend: primaryService.canUseTextBackend.bind(primaryService),
        
        // F1/F2/F3 — text-only operations (text engine)
        analyzeDocument: primaryService.analyzeDocument.bind(primaryService),
        analyzeApp: primaryService.analyzeApp.bind(primaryService),
        generateDocument: primaryService.generateDocument.bind(primaryService),
        
        // Use Pollinations.ai for image generation (stateless, no key needed)
        // with enhanced error handling
        generateWorkspaceImage: async (prompt: string, tipo: string | null | undefined, language: string = 'es') => {
            try {
                return await fallbackService.generateWorkspaceImage(prompt, tipo, language);
            } catch (error) {
                logCaughtError('[Intelligent AI Service] Error generating workspace image:', error);
                // Return a graceful fallback instead of throwing
                return {
                    image_url: '',
                    trace: {
                        provider: 'none',
                        hasImage: false,
                        source: 'error_fallback',
                        error: error instanceof Error ? error.message : 'Unknown error'
                    }
                };
            }
        },
    };
}

// Export the default service instance for backward compatibility
export const aiService = getAIService();