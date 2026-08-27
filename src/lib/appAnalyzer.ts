// ============================================================
// appAnalyzer.ts — Fase estática del análisis de apps (F2)
// ============================================================
// Analiza la estructura de un proyecto (manifest, config, rutas,
// pantallas, componentes) y produce un AppAnalysisInput para el
// LLM, más un contrato heurístico de respaldo (sin LLM).
//
// Fase dinámica (recorrido headless con screenshots) queda como
// extensión opcional: este módulo es 100% estático y testeable.
// (Rule #1: NO HARDCODE — límites/regex centralizados aquí.)
// ============================================================

import type { AppAnalysisInput } from '../core/ai/IAIService';
import type { AppAnalysisContract } from '../types/documentContracts';
import { buildHeuristicAppAnalysis } from './analysisFallbacks';

export interface AppAnalyzerResult {
    input: AppAnalysisInput;
    heuristic: AppAnalysisContract;
    /** Archivos candidatos a "pantallas" (rutas/tabs/vistas). */
    screenFiles: string[];
    /** Archivos de configuración/enrutamiento encontrados. */
    configFiles: string[];
}

// ------------------------------------------------------------
// Patrones de framework / pantallas / enrutamiento
// ------------------------------------------------------------
const FRAMEWORK_PATTERNS: Array<{ name: 'react' | 'flutter' | 'other'; files: string[]; markers: string[] }> = [
    {
        name: 'flutter',
        files: ['pubspec.yaml', 'pubspec.lock', 'lib/main.dart'],
        markers: ['import \'package:flutter', 'MaterialApp(', 'Scaffold('],
    },
    {
        name: 'react',
        files: ['package.json', 'vite.config.ts', 'vite.config.js', 'next.config.js', 'src/App.tsx', 'src/App.jsx'],
        markers: ['react', 'vite', 'next', 'react-dom', '@vitejs'],
    },
];

const SCREEN_HINTS = [
    /(screen|pantalla|page|pagina|view|vista|tab|route|ruta)[/\\_.-]/i,
    /^(src\/)?(app|main|index|home|dashboard|settings|config)(\.(tsx|jsx|js|ts|dart))?$/i,
];

const CONFIG_HINTS = [
    /(package\.json|pubspec\.yaml|vite\.config|tsconfig|next\.config|index\.html|manifest|\.env)/i,
];

const ERROR_MARKERS = [
    /TODO\s*[:：]/i,
    /FIXME\s*[:：]/i,
    /console\.error\(/,
    /throw new (Error|Exception)/,
    /@ts-ignore/,
    /eslint-disable/,
];

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function detectFramework(files: string[], contents: Record<string, string>): 'react' | 'flutter' | 'other' {
    const lower = files.map((f) => f.toLowerCase());
    const allText = Object.values(contents || {}).join('\n').toLowerCase();
    for (const pattern of FRAMEWORK_PATTERNS) {
        const hasFile = pattern.files.some((f) => lower.some((lf) => lf === f || lf.endsWith(`/${f}`)));
        const hasMarker = pattern.markers.some((m) => allText.includes(m.toLowerCase()));
        if (hasFile || hasMarker) return pattern.name;
    }
    return 'other';
}

function isScreenFile(path: string): boolean {
    return SCREEN_HINTS.some((re) => re.test(path));
}

function isConfigFile(path: string): boolean {
    return CONFIG_HINTS.some((re) => re.test(path));
}

function collectErrors(files: string[], contents: Record<string, string>): string[] {
    const errors: string[] = [];
    for (const file of files) {
        const content = contents?.[file] || '';
        if (!content) continue;
        const lines = content.split('\n');
        lines.forEach((line, i) => {
            if (ERROR_MARKERS.some((re) => re.test(line))) {
                errors.push(`${file}:${i + 1}: ${line.trim().slice(0, 120)}`);
            }
        });
    }
    // Limitar a una muestra razonable
    return errors.slice(0, 40);
}

function buildEstructura(
    files: string[],
    configFiles: string[],
    screenFiles: string[],
    framework: string,
): string {
    const lines: string[] = [];
    lines.push(`Framework detectado: ${framework}`);
    lines.push(`Archivos totales: ${files.length}`);
    if (configFiles.length) {
        lines.push(`Configuración: ${configFiles.join(', ')}`);
    }
    if (screenFiles.length) {
        lines.push(`Pantallas/vistas candidatas (${screenFiles.length}): ${screenFiles.slice(0, 20).join(', ')}`);
    }
    return lines.join('\n');
}

// ------------------------------------------------------------
// Entrada principal
// ------------------------------------------------------------
/**
 * Analiza la estructura de un proyecto (fase estática de F2).
 * @param proyecto Nombre del proyecto.
 * @param files Lista de rutas de archivo (relativas al proyecto).
 * @param contents Opcional: mapa archivo → contenido para detección de errores.
 */
export function analyzeAppStructure(
    proyecto: string,
    files: string[],
    contents?: Record<string, string>,
): AppAnalyzerResult {
    const list = Array.isArray(files) ? files : [];
    const contentsMap = contents || {};
    const framework = detectFramework(list, contentsMap);
    const configFiles = list.filter(isConfigFile);
    const screenFiles = list.filter(isScreenFile).slice(0, 40);
    const errores = collectErrors(list, contentsMap);
    const estructura = buildEstructura(list, configFiles, screenFiles, framework);

    const input: AppAnalysisInput = {
        proyecto: proyecto || 'Proyecto',
        framework,
        estructura,
        archivos: screenFiles.length ? screenFiles : list.slice(0, 40),
        errores_detectados: errores,
    };

    return {
        input,
        heuristic: buildHeuristicAppAnalysis(input),
        screenFiles,
        configFiles,
    };
}
