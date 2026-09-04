// ============================================================
// hardcodeGuard.test.ts — Guard para Rule #1 (NO HARDCODE)
// ============================================================
// Escanea src/ buscando literales de URL (https?://) fuera de los
// módulos de configuración centralizados. Cualquier URL de endpoint
// usado en lógica de negocio (fetch, WebSocket, etc.) debe vivir en
// src/core/config/appConfig.ts o en un módulo de datos/config explícito.
//
// Este test es la "regla de lint" pragmática del proyecto (ESLint no está
// instalado en devDependencies) y sigue el patrón fs-scan de
// tests/architecture.test.ts. Permite: módulos de config/datos explícitos
// y dominios seguros (dev local, namespaces XML, contenido de datos,
// placeholders de UI y referencias informativas en comentarios/hints).
// ============================================================

import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'fs';
import path from 'path';

// Directorio raíz de la aplicación (una carpeta arriba de tests/).
const SRC_DIR = path.resolve(__dirname, '../src');

// Dominios seguros en CUALQUIER archivo: dev local, namespaces, contenido
// de datos (pistas demo), placeholders de UI y referencias informativas.
// Los dominios de APIs reales NO están aquí: deben vivir en appConfig.
const SAFE_URL_PATTERNS: RegExp[] = [
    /^localhost(?::|\/|$)/i,           // servidores de desarrollo locales
    /^127\.0\.0\.1(?::|\/|$)/i,        // STT dev server (ws://127.0.0.1:8787)
    /^example\.com(?:\/|$)/i,          // sonda de red (default en appConfig)
    /^one\.one\.one\.one(?:\/|$)/i,    // sonda de red (default en appConfig)
    /^www\.w3\.org(?:\/|$)/i,          // namespace SVG (XML)
    /^archive\.org(?:\/|$)/i,          // pistas demo de dominio público (datos)
    /^www\.soundhelix\.com(?:\/|$)/i,  // base de audio demo (datos)
    /^api\.deezer\.com(?:\/|$)/i,      // referencia en comentario (musicSearch)
    /^aistudio\.google\.com(?:\/|$)/i, // página de ayuda de Gemini API key (UI hint)
    /^openrouter\.ai(?:\/|$)/i,        // placeholder de UI + default en appConfig
    /^image\.pollinations\.ai(?:\/|$)/i, // placeholder de UI + config de visuales
];

// Archivos que SON configuración/datos centralizados (se permiten sin host-check).
// NOTA: las rutas son RELATIVAS a src/ (formato de relPath en el escáner).
const ALLOWED_CONFIG_FILES = new Set([
    'core/config/appConfig.ts',  // single source of truth (Rule #1)
    'voice/lib/visualConfig.js', // módulo de config del pipeline visual
    'voice/lib/fluConfig.js',    // FLU_CONFIG centralizado (browser/search, voz, etc.)
    'services/musicPlayer.ts',   // catálogo estático de pistas demo (datos)
]);

function walkDir(dir: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkDir(full));
        } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
            results.push(full);
        }
    }
    return results;
}

function extractHost(urlToken: string): string {
    const m = urlToken.match(/^https?:\/\/([^/]+)/);
    if (!m) return '';
    // Recorta signos de puntuación finales (`, `)`) y puntos de fin de frase
    // (ej. "http://localhost." dentro de un mensaje de ayuda en prosa).
    // Un host válido nunca termina en punto dentro de una URL real.
    return m[1].replace(/[^a-zA-Z0-9.-]+$/g, '').replace(/\.+$/, '').toLowerCase();
}

function isAllowedUrl(urlToken: string, relPath: string): boolean {
    if (ALLOWED_CONFIG_FILES.has(relPath)) return true;
    const host = extractHost(urlToken);
    return SAFE_URL_PATTERNS.some((pattern) => pattern.test(host));
}

let violations: { file: string; url: string; line: number }[] = [];
let totalUrls = 0;

beforeAll(() => {
    const files = walkDir(SRC_DIR);
    const urlRegex = /https?:\/\/[^\s"'`]+/g;
    for (const file of files) {
        const relPath = path.relative(SRC_DIR, file).split(path.sep).join('/');
        const content = fs.readFileSync(file, 'utf-8');
        let match: RegExpExecArray | null;
        while ((match = urlRegex.exec(content)) !== null) {
            totalUrls += 1;
            const urlToken = match[0];
            if (!isAllowedUrl(urlToken, relPath)) {
                const line = content.slice(0, match.index).split('\n').length;
                violations.push({ file: relPath, url: urlToken, line });
            }
        }
    }
});

describe('Hardcode Guard — Rule #1: NO HARDCODE', () => {
    it('el escáner detecta literales de URL en src/ (no es un no-op)', () => {
        expect(totalUrls).toBeGreaterThan(20);
    });

    it('no debe haber URLs hardcodeadas fuera de los módulos de configuración', () => {
        const report = violations
            .map((v) => `  ${v.file}:${v.line}  →  ${v.url}`)
            .join('\n');
        expect(report, `URLs fuera de la configuración centralizada:\n${report}`).toBe('');
    });
});
