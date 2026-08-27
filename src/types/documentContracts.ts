// ============================================================
// Document / App / Generation Contracts
// ============================================================
// Contratos estructurados para las 4 capacidades nuevas:
//   F1 análisis de documentos (documentContract)
//   F2 análisis de funcionalidad de apps (appAnalysisContract)
//   F3 generación de documentos (generationContract + generationJob)
//   F4 generación de video (usa generationContract con formato 'video')
//
// Siguen el patrón workspaceContract: el LLM produce el contenido
// y los adaptadores solo serializan. (Rule #1: NO HARDCODE)
// ============================================================

/** Tipos de documento soportados por el parser. */
export type DocumentTipo = 'xlsm' | 'xlsx' | 'pptx' | 'docx' | 'pdf' | 'text' | 'csv' | 'md';

/** Rol funcional de una hoja de cálculo (o sección) dentro del documento. */
export type SheetRol = 'input' | 'calculo' | 'output' | 'informativa';

/** Información de una hoja de cálculo dentro del documento. */
export interface DocumentSheetInfo {
    nombre: string;
    rol: SheetRol;
    celdas: number;
    errores: string[];
}

/**
 * documentContract — resultado del análisis de un documento.
 * Estructura estratificada: lectura (resumen) + estructura (hojas) + lógica (errores/escenarios).
 */
export interface DocumentContract {
    tipo: DocumentTipo;
    mime: string;
    nombre: string;
    tamaño: number;
    hojas?: DocumentSheetInfo[];
    /** Errores de fórmula heredados (#REF!, #VALUE!, etc.) detectados. */
    errores: string[];
    resumen: string;
    puntos_clave: string[];
    escenarios?: Record<string, unknown>[];
    /** Texto estructurado para Q&A posterior (contexto del LLM). */
    qa_context: string;
}

/** Información de una pantalla detectada en el análisis de una app. */
export interface AppScreenInfo {
    id: string;
    nombre: string;
    proposito: string;
    entradas: string[];
    acciones: string[];
    salidas: string[];
}

/** Flujo funcional detectado (secuencia de pasos entre pantallas). */
export interface AppFlowInfo {
    nombre: string;
    pasos: string[];
}

/**
 * appAnalysisContract — resultado del análisis de funcionalidad de una app.
 * Fase estática (código/estructura) + fase dinámica (recorrido headless).
 */
export interface AppAnalysisContract {
    proyecto: string;
    framework: 'react' | 'flutter' | 'other';
    pantallas: AppScreenInfo[];
    flujos: AppFlowInfo[];
    errores_detectados: string[];
}

/** Formatos de generación soportados por la capa de adaptadores. */
export type GenerationFormato = 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'md' | 'html' | 'csv' | 'json' | 'ics' | 'video';

/** Parámetros de generación (calidad, duración, orientación, tema). */
export interface GenerationParams {
    calidad?: 'baja' | 'media' | 'alta';
    duracion_min?: number;
    orientacion?: 'vertical' | 'horizontal';
    tema?: string;
}

/** Fuente de contenido para una generación (documento analizado, app, conversación, minuta). */
export interface GenerationSource {
    tipo: 'documento' | 'app' | 'conversacion' | 'minuta';
    ref: string;
}

/**
 * generationContract — petición de generación.
 * El LLM produce el contenido; la capa de adaptadores lo serializa.
 */
export interface GenerationContract {
    formato: GenerationFormato;
    parametros: GenerationParams;
    fuentes: GenerationSource[];
}

/** Estados de un trabajo de generación (para UI/progreso). */
export type GenerationJobState = 'pendiente' | 'analizando' | 'escribiendo' | 'ensamblando' | 'listo' | 'error';

/**
 * generationJob — estado de un trabajo de generación.
 * Vive en el store (no se persiste) para reflejar progreso en la UI.
 */
export interface GenerationJob {
    id: string;
    estado: GenerationJobState;
    progreso: number;
    formato: string;
    url_resultado?: string;
    error?: string;
    timestamp: number;
}

/** Resultado completo de un análisis de documento (contrato + texto + chunks). */
export interface DocumentAnalysisResult {
    contract: DocumentContract;
    rawText: string;
    chunks: string[];
    warnings: string[];
}

/** Resultado de la fase dinámica de análisis de app (DOM/screenshots/consola). */
export interface AppDynamicSnapshot {
    pantalla: string;
    titulo: string;
    acciones: string[];
    errores_consola: string[];
    captura: string;
}
