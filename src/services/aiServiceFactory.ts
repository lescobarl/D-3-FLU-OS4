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

// Storage key for AI provider preference
const AI_PROVIDER_KEY = 'flu-ai-provider';

// Available AI providers
// 'openrouter' = default: OpenAI-compatible gateway → Google Gemini 2.5 Flash Lite
// 'gemini'     = Google Gemini nativo (Generative Language API)
// 'local'      = any OpenAI-compatible local endpoint (Ollama, LM Studio, localhost)
//                that routes text operations through the same text engine (F1/F2/F3).
// 'deepseek'   = legacy alias (mismo motor de texto; se conserva por compatibilidad)
export type AIProvider = 'openrouter' | 'gemini' | 'deepseek' | 'local';

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
        const stored = localStorage.getItem(AI_PROVIDER_KEY);
        if (stored === 'openrouter' || stored === 'gemini' || stored === 'deepseek' || stored === 'local') {
            return stored;
        }
    } catch {
        // ignore
    }

    // Check environment variable
    const envProvider = import.meta.env.VITE_PREFERRED_AI_PROVIDER;
    if (envProvider === 'openrouter' || envProvider === 'gemini' || envProvider === 'deepseek' || envProvider === 'local') {
        return envProvider;
    }

    // Default: Gemini 2.5 Flash Lite via OpenRouter (motor de texto único)
    return 'openrouter';
}

/**
 * Set the preferred AI provider.
 */
export function setPreferredAIProvider(provider: AIProvider): void {
    try {
        localStorage.setItem(AI_PROVIDER_KEY, provider);
    } catch {
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
    
    switch (provider) {
        case 'gemini':
            // Gemini nativo (solo si el usuario elige la API directa de Google)
            return geminiService;
        case 'openrouter':
        case 'deepseek':
        case 'local':
            // Motor de texto OpenAI-compatible (OpenRouter → Gemini 2.5 Flash Lite
            // por defecto; 'local' enruta a Ollama / LM Studio / localhost).
            // 'deepseek' es un alias legacy del mismo motor.
            return createIntelligentAIService();
        default:
            // Fallback al motor de texto por defecto (provider siempre resuelve a un valor válido)
            return createIntelligentAIService();
    }
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
                console.error('[Intelligent AI Service] Error generating workspace image:', error);
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
        openrouter: {
            name: 'Gemini 2.5 Flash Lite (OpenRouter)',
            costPerMillionTokens: 0.30,
            speedTokensPerSec: '40-60',
            co2Emissions: 'Low',
            spanishSupport: 'Excellent'
        },
        gemini: {
            name: 'Google Gemini (nativo)',
            costPerMillionTokens: 0.50,
            speedTokensPerSec: '15-30',
            co2Emissions: 'High',
            spanishSupport: 'Good'
        },
        deepseek: {
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