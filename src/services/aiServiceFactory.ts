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
import { STORAGE_KEYS } from '../core/config/appConfig';
import { logCaughtError } from '../lib/caughtError';
import {
    AI_PROVIDER_IDS,
    AI_PROVIDER_ROUTES,
    DEFAULT_AI_PROVIDER,
    isAIProvider,
    type AIProvider,
} from '../core/config/sharedConfig';
import { localGet, localSet } from '../core/storage/localStore';

// Re-export del tipo canónico (fuente única: sharedConfig.ts) para no romper
// a los importadores históricos de aiServiceFactory.
export type { AIProvider };

// Storage key for AI provider preference (fuente única: STORAGE_KEYS)
const AI_PROVIDER_KEY = STORAGE_KEYS.AI_PROVIDER;

// Available AI providers — identidad, default y rutas viven en
// sharedConfig.ts (AI_PROVIDERS / AI_PROVIDER_ROUTES). No se repiten aquí.

/**
 * Get the preferred AI provider from configuration.
 * Priority:
 * 1. localStorage preference
 * 2. Environment variable (VITE_PREFERRED_AI_PROVIDER)
 * 3. Default to 'openrouter' (Gemini 2.5 Flash Lite via OpenRouter)
 */
export function getPreferredAIProvider(): AIProvider {
    try {
        // Check localStorage
        const stored = localGet(AI_PROVIDER_KEY);
        if (isAIProvider(stored)) {
            return stored;
        }
    } catch (e) {
        logCaughtError('[catch] src/services/aiServiceFactory.ts', e);
        // ignore
    }

    // Check environment variable
    const envProvider = import.meta.env.VITE_PREFERRED_AI_PROVIDER;
    if (isAIProvider(envProvider)) {
        return envProvider;
    }

    // Default desde la fuente única (sharedConfig.DEFAULT_AI_PROVIDER).
    return DEFAULT_AI_PROVIDER;
}

/**
 * Set the preferred AI provider.
 */
export function setPreferredAIProvider(provider: AIProvider): void {
    try {
        localSet(AI_PROVIDER_KEY, provider);
    } catch (e) {
        logCaughtError('[catch] src/services/aiServiceFactory.ts', e);
        // ignore
    }
}

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

/**
 * Get statistics about AI providers for comparison.
 */
export function getAIProviderStats() {
    return {
        [AI_PROVIDER_IDS.OPENROUTER]: {
            name: 'Gemini 2.5 Flash Lite (OpenRouter)',
            costPerMillionTokens: 0.30,
            speedTokensPerSec: '40-60',
            co2Emissions: 'Low',
            spanishSupport: 'Excellent'
        },
        [AI_PROVIDER_IDS.GEMINI]: {
            name: 'Google Gemini (nativo)',
            costPerMillionTokens: 0.50,
            speedTokensPerSec: '15-30',
            co2Emissions: 'High',
            spanishSupport: 'Good'
        },
        [AI_PROVIDER_IDS.DEEPSEEK]: {
            name: 'DeepSeek-v3.2 (legacy)',
            costPerMillionTokens: 0.14,
            speedTokensPerSec: '40-60',
            co2Emissions: 'Low (60% less)',
            spanishSupport: 'Excellent'
        }
    };
}

// Export the default service instance for backward compatibility
export const aiService = getAIService();