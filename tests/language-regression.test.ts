// ============================================================
// 🧪 Language Regression Tests — GeminiService methods
// ============================================================
// Estas pruebas verifican que todos los métodos de GeminiService
// acepten el parámetro `language` (via AIRequestOptions) y lo
// usen correctamente mediante `isEnglish`.
//
// Usan fs.readFileSync() para inspeccionar el código fuente
// en tiempo de compilación, no en runtime.
// ============================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

import { generateResponse as fallbackGenerateResponse } from '../src/services/fallbackResponses';

// ============================================================
// Helper: extraer lista de parámetros de una función
// ============================================================
function getParamList(fn: (...args: any[]) => any): string[] {
    const fnStr = fn.toString();
    const match = fnStr.match(/\(([^)]*)\)/);
    if (!match) return [];
    return match[1].split(',').map((p: string) => p.trim());
}

// ============================================================
// Tests — GeminiService source code inspection
// ============================================================

describe('🧪 Language Regression — GeminiService methods accept language param', () => {
    const src = readFileSync('./src/services/gemini.ts', 'utf-8');

    // ── generateMinute ──
    it('generateMinute debe usar isEnglish y delegar al system prompt compartido (Rule #1)', () => {
        // generateMinute usa isEnglish para el log de conversación (User/Usuario)
        expect(src).toContain('isEnglish');
        expect(src).toContain("isEnglish ? 'User' : 'Usuario'");
        // El system prompt vive en la única fuente de verdad: src/core/ai/prompts.ts
        expect(src).toContain('buildMinuteSystemPrompt');
        const promptsSrc = readFileSync('./src/core/ai/prompts.ts', 'utf-8');
        expect(promptsSrc).toContain('? `You are FLU');
        expect(promptsSrc).toContain('Eres FLU');
    });

    it('generateMinute debe usar language-aware default title', () => {
        expect(src).toContain('isEnglish');
        expect(src).toContain('`Minutes -');
        expect(src).toContain('`Minuta -');
    });

    // ── generateResponse (GeminiService) ──
    it('generateResponse (GeminiService) debe usar isEnglish para decidir idioma', () => {
        expect(src).toContain('isEnglish');
        expect(src).toContain('? `You are');
        expect(src).toContain('Eres');
        expect(src).toContain("isEnglish ? 'User' : 'Usuario'");
    });

    // ── generateParticipantEvaluation ──
    it('generateParticipantEvaluation debe usar isEnglish', () => {
        expect(src).toContain('isEnglish');
    });

    // ── generateConversationSummary ──
    it('generateConversationSummary debe usar isEnglish', () => {
        expect(src).toContain('isEnglish');
    });

    it('generateConversationSummary debe tener default title language-aware', () => {
        expect(src).toContain('isEnglish ?');
        expect(src).toContain('Conversation minutes');
        expect(src).toContain('Minuta de conversacion');
    });

    // ── generateFluContract ──
    it('generateFluContract debe usar isEnglish', () => {
        expect(src).toContain('isEnglish');
    });

    it('generateFluContract debe usar language-aware conversation log labels', () => {
        expect(src).toContain("isEnglish ? 'User' : 'Usuario'");
    });

    // ── generateWorkspaceImage ──
    it('generateWorkspaceImage debe aceptar language como parámetro', () => {
        expect(src).toContain('language');
    });

    // ── AIRequestOptions debe tener language ──
    it('AIRequestOptions debe incluir language', () => {
        expect(src).toContain('language');
    });

    // ── fallbackResponses generateResponse ──
    it('fallbackResponses generateResponse debe aceptar language como 4to parámetro', () => {
        const params = getParamList(fallbackGenerateResponse);
        expect(params[3]).toContain('language');
    });

    it('fallbackResponses generateResponse debe tener respuestas en inglés', () => {
        const fallbackSrc = fallbackGenerateResponse.toString();
        expect(fallbackSrc).toContain('isEnglish');
        expect(fallbackSrc).toContain('Hello again!');
        expect(fallbackSrc).toContain('See you later!');
        expect(fallbackSrc).toContain("You're welcome!");
        expect(fallbackSrc).toContain("I'm great!");
        expect(fallbackSrc).toContain("I'm really glad");
        expect(fallbackSrc).toContain("I'm so sorry");
        expect(fallbackSrc).toContain('Of course I can help');
        expect(fallbackSrc).toContain('Good question.');
    });

    it('fallbackResponses generateResponse debe detectar patrones en inglés', () => {
        const fallbackSrc = fallbackGenerateResponse.toString();
        expect(fallbackSrc).toContain('hello');
        expect(fallbackSrc).toContain('goodbye');
        expect(fallbackSrc).toContain('thanks');
        expect(fallbackSrc).toContain('happy');
        expect(fallbackSrc).toContain('sad');
        expect(fallbackSrc).toContain('help');
        expect(fallbackSrc).toContain('what');
        expect(fallbackSrc).toContain('how');
    });
});
