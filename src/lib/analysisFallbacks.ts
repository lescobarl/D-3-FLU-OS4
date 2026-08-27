// ============================================================
// analysisFallbacks.ts — respaldos heurísticos compartidos (F1/F2)
// ============================================================
// Los servicios (deepseek.ts / gemini.ts) construyen sus contratos
// base y respaldos sin LLM desde este módulo para mantener una
// única fuente de verdad (Rule #1: NO HARDCODE; Rule #2: sin
// parches duplicados).
// ============================================================

import type { DocumentAnalysisInput, AppAnalysisInput } from '../core/ai/IAIService';
import type { DocumentContract, AppAnalysisContract, AppScreenInfo, AppFlowInfo } from '../types/documentContracts';

/**
 * Construye el contrato base de un documento a partir de la salida
 * del parser (sin enriquecimiento LLM). Usado como respaldo elegante
 * cuando no hay API key o falla la llamada al LLM.
 */
export function buildBaseDocumentContract(payload: DocumentAnalysisInput): DocumentContract {
    const rawText = payload.rawText || '';
    return {
        tipo: (payload.tipo as DocumentContract['tipo']) || 'text',
        mime: payload.mime || 'text/plain',
        nombre: payload.nombre || 'documento',
        tamaño: rawText.length,
        hojas: Array.isArray(payload.hojas) ? (payload.hojas as DocumentContract['hojas']) : undefined,
        errores: Array.isArray(payload.errores) ? payload.errores : [],
        resumen: payload.resumen_heuristico || '',
        puntos_clave: [],
        qa_context: payload.qa_context || '',
    };
}

/**
 * Contrato heurístico de análisis de app (sin LLM).
 * Construye pantallas/flujos básicos a partir de la estructura
 * y errores detectados por la fase estática (degradación elegante).
 */
export function buildHeuristicAppAnalysis(payload: AppAnalysisInput): AppAnalysisContract {
    const screens: AppScreenInfo[] = Array.isArray(payload.archivos) && payload.archivos.length
        ? payload.archivos.slice(0, 12).map((archivo, i) => ({
            id: `screen-${i + 1}`,
            nombre: archivo.split('/').pop() || archivo,
            proposito: 'Pantalla detectada estáticamente (sin IA).',
            entradas: [],
            acciones: [],
            salidas: [],
        }))
        : [];
    const framework = payload.framework || 'other';
    const flows: AppFlowInfo[] = [{
        nombre: 'Recorrido estático',
        pasos: screens.length ? screens.map((s) => `Ver ${s.nombre}`) : ['Explorar estructura'],
    }];
    return {
        proyecto: payload.proyecto || 'Proyecto',
        framework,
        pantallas: screens,
        flujos: flows,
        errores_detectados: Array.isArray(payload.errores_detectados) ? payload.errores_detectados : [],
    };
}
