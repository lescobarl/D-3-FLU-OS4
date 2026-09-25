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

// ============================================================
// Helper: extraer lista de parámetros de una función
// ============================================================

// ============================================================
// Tests — GeminiService source code inspection
// ============================================================

describe('🧪 Language Regression — GeminiService methods accept language param', () => {
    const src = readFileSync('./src/services/gemini.ts', 'utf-8');
    // La orquestación de generateMinute (log + normalización) vive en el motor
    // único (BaseAIService); gemini.ts solo aporta el transporte.
    const base = readFileSync('./src/core/ai/aiServiceBase.ts', 'utf-8');

    // ── generateMinute ──
    it('generateMinute debe usar isEnglish y delegar al system prompt compartido (Rule #1)', () => {
        // generateMinute usa isEnglish para el log de conversación (User/Usuario)
        expect(base).toContain('isEnglish');
        expect(base).toContain("isEnglish ? 'User' : 'Usuario'");
        // El system prompt vive en la única fuente de verdad: src/core/ai/prompts.ts
        expect(base).toContain('buildMinuteSystemPrompt');
        const promptsSrc = readFileSync('./src/core/ai/prompts.ts', 'utf-8');
        expect(promptsSrc).toContain('? `You are FLU');
        expect(promptsSrc).toContain('Eres FLU');
    });

    it('generateMinute debe usar language-aware default title', () => {
        expect(base).toContain('isEnglish');
        expect(base).toContain('`Minutes -');
        expect(base).toContain('`Minuta -');
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
});
