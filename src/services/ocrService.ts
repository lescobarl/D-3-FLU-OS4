// ============================================================
// ocrService — Extracción de texto de imágenes y PDFs (OCR)
// ============================================================
// Estrategia "local primero, remoto opcional" (Rule #1: NO HARDCODE):
//   - Motor local: Tesseract.js (spa+eng) — funciona sin API keys,
//     siempre como respaldo por defecto.
//   - Motor remoto: endpoint HTTP genérico opcional configurado con
//     OCR_API_URL / OCR_MODEL / OCR_API_KEY (espeja el patrón texto/imagen).
//   - PDF escaneado: pdfjs-dist rasteriza cada página → Tesseract local.
//
// Desacoplado: no depende de App.tsx; resuelve su configuración desde
// appConfig.STORAGE_KEYS (fuente de verdad) y se usa en los puntos de
// llamada (processImageFile, useDocumentAnalysis) sin parches.
//
// Cumple:
//   - Rule #1: NO HARDCODE — configuración desde appConfig
//   - Rule #2: NO PARCHES — servicio autónomo con degradación elegante
// ============================================================

import { STORAGE_KEYS, readStorage } from '../core/config/appConfig';
import { fetchTextEngine } from '../core/ai/httpClient';

export interface OcrResult {
    text: string;
    engine: 'local' | 'remote';
    warnings: string[];
}

export interface OcrConfig {
    apiKey: string;
    model: string;
    apiUrl: string;
}

/** Resolver configuración OCR desde el almacenamiento persistente. */
export function resolveOcrConfig(): OcrConfig {
    return {
        apiKey: readStorage(STORAGE_KEYS.OCR_API_KEY, ''),
        model: readStorage(STORAGE_KEYS.OCR_MODEL, ''),
        apiUrl: readStorage(STORAGE_KEYS.OCR_API_URL, ''),
    };
}

/**
 * OCR local con Tesseract.js (español + inglés).
 * Carga dinámica lazy: la biblioteca pesada solo se descarga bajo demanda.
 */
export async function extractWithLocal(dataUrl: string): Promise<string> {
    const Tesseract = await import('tesseract.js');
    const worker = await Tesseract.createWorker('spa+eng');
    try {
        const { data } = await worker.recognize(dataUrl);
        return String(data?.text || '').trim();
    } finally {
        await worker.terminate().catch(() => undefined);
    }
}

/**
 * OCR remoto genérico: POST { image_base64, model?, api_key? } → { text | texto_extraido }.
 * Contrato documentado para que cualquier proxy/backend compatible pueda servir OCR.
 */
async function extractWithRemote(dataUrl: string, cfg: OcrConfig): Promise<string> {
    const res = await fetchTextEngine(cfg.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            image_base64: dataUrl,
            ...(cfg.model ? { model: cfg.model } : {}),
            ...(cfg.apiKey ? { api_key: cfg.apiKey } : {}),
        }),
    });
    if (!res.ok) throw new Error(`OCR remoto respondió ${res.status}`);
    const payload: { text?: unknown; texto_extraido?: unknown } = await res.json();
    const text = payload?.text ?? payload?.texto_extraido ?? '';
    return String(text || '').trim();
}

/**
 * Extraer texto de una imagen (data URL).
 * Usa el motor remoto si OCR_API_URL está configurado; si falla o no está,
 * cae a Tesseract local (siempre disponible). Nunca lanza: devuelve texto vacío
 * con warnings para que el llamador decida (degradación elegante).
 */
export async function extractTextFromImage(dataUrl: string): Promise<OcrResult> {
    const cfg = resolveOcrConfig();
    if (cfg.apiUrl) {
        try {
            const text = await extractWithRemote(dataUrl, cfg);
            if (text) return { text, engine: 'remote', warnings: [] };
        } catch (err) {
        console.warn('[catch] src/services/ocrService.ts:', err);
            const warnings = [`OCR remoto falló (${String(err)}); usando OCR local.`];
            try {
                return { text: await extractWithLocal(dataUrl), engine: 'local', warnings };
            } catch (localErr) {
        console.warn('[catch] src/services/ocrService.ts:', localErr);
                return { text: '', engine: 'local', warnings: [...warnings, String(localErr)] };
            }
        }
    }
    try {
        return { text: await extractWithLocal(dataUrl), engine: 'local', warnings: [] };
    } catch (err) {
        console.warn('[catch] src/services/ocrService.ts:', err);
        return { text: '', engine: 'local', warnings: [String(err)] };
    }
}

/**
 * Extraer texto de un PDF (escaneado): rasteriza cada página con pdfjs-dist
 * y la pasa por Tesseract local. Solo debe invocarse cuando el PDF no tiene
 * capa de texto (la lectura de texto real vive en documentParser.parsePdf).
 */
export async function extractTextFromPdf(data: ArrayBuffer, maxPages = 5): Promise<OcrResult> {
    const warnings: string[] = [];
    if (typeof document === 'undefined') {
        return { text: '', engine: 'local', warnings: ['OCR de PDF requiere entorno de navegador.'] };
    }
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
        throw new Error('módulo pdfjs-dist no disponible');
    }
    if (!pdfjs.GlobalWorkerOptions?.workerSrc) {
        try {
            pdfjs.GlobalWorkerOptions.workerSrc = new URL(
                'pdfjs-dist/build/pdf.worker.min.mjs',
                import.meta.url,
            ).toString();
        } catch {
        console.warn('[catch] src/services/ocrService.ts');
            /* sin worker configurado: se intenta igual; degradación si falla */
        }
    }
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
    const doc = await loadingTask.promise;
    const pagesToScan = Math.min(doc.numPages, maxPages);
    const chunks: string[] = [];
    try {
        for (let pageNum = 1; pageNum <= pagesToScan; pageNum += 1) {
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 2 });
            const canvas = document.createElement('canvas');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            const ctx = canvas.getContext('2d');
            if (!ctx) {
                warnings.push(`No se pudo rasterizar la página ${pageNum}.`);
                continue;
            }
            await page.render({ canvasContext: ctx, canvas, viewport }).promise;
            chunks.push(await extractWithLocal(canvas.toDataURL('image/png')));
        }
    } finally {
        await loadingTask.destroy().catch(() => undefined);
    }
    return { text: chunks.join('\n').trim(), engine: 'local', warnings };
}
