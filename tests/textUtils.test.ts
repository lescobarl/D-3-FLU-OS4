// ============================================================
// textUtils.test.ts — Fuente única de pickLabel (y utilidades de texto)
// ============================================================
// pickLabel se centralizó aquí (había 4 copias locales en
// App.tsx/WorkspaceHub/HoyPanel/ResultFeed). Cubre su contrato:
// selección por idioma con fallback final.
// ============================================================
import { describe, it, expect } from 'vitest';
import { pickLabel } from '../src/lib/textUtils';

describe('🧪 textUtils — pickLabel (fuente única de rótulos bilingües)', () => {
    const labels = { es: 'Hola', en: 'Hello' };

    it('devuelve el rótulo según el idioma activo', () => {
        expect(pickLabel(labels, 'es', 'X')).toBe('Hola');
        expect(pickLabel(labels, 'en', 'X')).toBe('Hello');
    });

    it('cualquier idioma no-en cae al rótulo en español', () => {
        expect(pickLabel(labels, 'fr', 'X')).toBe('Hola');
        expect(pickLabel(labels, '', 'X')).toBe('Hola');
    });

    it('hace fallback a es si falta el rótulo del idioma y luego al fallback final', () => {
        expect(pickLabel({ es: 'Solo es' }, 'en', 'X')).toBe('Solo es');
        expect(pickLabel({ en: 'Only en' }, 'es', 'X')).toBe('X');
        expect(pickLabel(undefined, 'es', 'X')).toBe('X');
        expect(pickLabel({ es: '', en: '' }, 'es', 'X')).toBe('X');
    });
});
