// ============================================================
// documentParser.ts — parsing de documentos por MIME (F1)
// ============================================================
// Capa de lectura del análisis de documentos. Soporta nativamente
// texto/csv/md/json y de forma dinámica (con degradación elegante)
// xlsx/xlsm (SheetJS), pdf (pdfjs-dist), docx (mammoth) y pptx
// (pptx-parser + jszip). Cada parser devuelve warnings si la
// biblioteca no está disponible o falla, sin romper el flujo.
//
// Principio de la arquitectura: el LLM produce el contenido final
// (resumen/puntos_clave/escenarios); este módulo solo EXTRAE la
// estructura y el texto en crudo (Rule #1: NO HARDCODE → límites
// centralizados en fluConfig.limits.documentAnalysis).
// ============================================================

import type {
  DocumentTipo,
  DocumentContract,
  DocumentSheetInfo,
  SheetRol,
  DocumentAnalysisResult,
} from '../types/documentContracts';
import { FLU_CONFIG } from '../voice/lib/fluConfig';
import { logCaughtError } from './caughtError';

// ------------------------------------------------------------
// Límites centralizados (fluConfig.limits.documentAnalysis)
// ------------------------------------------------------------
interface DocumentAnalysisLimits {
  maxFileSizeBytes: number;
  maxTextChars: number;
  maxChunks: number;
  chunkChars: number;
  maxSheets: number;
  maxCellsPerSheet: number;
}

function getLimits(): DocumentAnalysisLimits {
  const l = ((FLU_CONFIG.limits as Record<string, unknown>).documentAnalysis ||
    {}) as Partial<DocumentAnalysisLimits>;
  return {
    maxFileSizeBytes: l.maxFileSizeBytes ?? 25 * 1024 * 1024,
    maxTextChars: l.maxTextChars ?? 200000,
    maxChunks: l.maxChunks ?? 48,
    chunkChars: l.chunkChars ?? 4000,
    maxSheets: l.maxSheets ?? 40,
    maxCellsPerSheet: l.maxCellsPerSheet ?? 12000,
  };
}

// ------------------------------------------------------------
// Mapeo extensión → tipo / MIME
// ------------------------------------------------------------
const EXTENSION_TO_TIPO: Record<string, DocumentTipo> = {
  xlsm: 'xlsm',
  xlsx: 'xlsx',
  pptx: 'pptx',
  docx: 'docx',
  pdf: 'pdf',
  txt: 'text',
  csv: 'csv',
  md: 'md',
  markdown: 'md',
  json: 'text',
};

const TIPO_TO_MIME: Record<DocumentTipo, string> = {
  xlsm: 'application/vnd.ms-excel.sheet.macroEnabled.12',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  text: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
};

// Códigos de error de Excel que se marcan (celdas heredadas rotas).
const EXCEL_ERROR_PATTERN = /^#(REF!|VALUE!|DIV\/0!|N\/A|NAME\?|NULL!|NUM!|SPILL!|CALC!|GETTING_DATA)$/;

// ------------------------------------------------------------
// Identificación del tipo de documento
// ------------------------------------------------------------
export function getDocumentTipo(file: { name: string; type: string }): {
  tipo: DocumentTipo;
  mime: string;
} {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const tipo = EXTENSION_TO_TIPO[ext] || inferTipoFromMime(file.type);
  const mime = file.type || TIPO_TO_MIME[tipo] || 'application/octet-stream';
  return { tipo, mime };
}

function inferTipoFromMime(mime: string): DocumentTipo {
  const m = (mime || '').toLowerCase();
  if (m.includes('spreadsheet') || m.includes('excel')) return m.includes('macro') ? 'xlsm' : 'xlsx';
  if (m.includes('presentation') || m.includes('powerpoint')) return 'pptx';
  if (m.includes('word') || m.includes('document')) return 'docx';
  if (m.includes('pdf')) return 'pdf';
  if (m.includes('csv')) return 'csv';
  if (m.includes('markdown')) return 'md';
  return 'text';
}

/** Indica si el archivo es un documento soportado por el parser. */
export function isSupportedDocument(file: { name: string }): boolean {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return Boolean(EXTENSION_TO_TIPO[ext]);
}

// ------------------------------------------------------------
// Utilidades
// ------------------------------------------------------------
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function readArrayBufferAsUtf8(data: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8').decode(data);
  } catch {
        logCaughtError('[catch] src/lib/documentParser.ts');
    const bytes = new Uint8Array(data);
    let out = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
    }
    return decodeURIComponent(escape(out));
  }
}

/**
 * Divide el texto en chunks con frontera de salto de línea
 * (map-reduce del LLM). Función pura y testeable.
 */
export function chunkText(text: string, chunkChars = 4000, maxChunks = 48): string[] {
  const clean = text.replace(/\r\n/g, '\n');
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length && chunks.length < maxChunks) {
    let end = Math.min(start + chunkChars, clean.length);
    if (end < clean.length) {
      const boundary = clean.lastIndexOf('\n', end);
      if (boundary > start + chunkChars * 0.5) end = boundary;
    }
    chunks.push(clean.slice(start, end).trim());
    start = end;
  }
  return chunks.filter((c) => c.length > 0);
}

/**
 * Detecta el rol funcional de una hoja a partir de su densidad de
 * fórmulas y de contenido textual. Función pura y testeable.
 */
export function detectSheetRol(stats: { celdas: number; formulas: number; valoresTexto: number }): SheetRol {
  if (!stats.celdas) return 'informativa';
  const densidadFormula = stats.formulas / stats.celdas;
  if (densidadFormula >= 0.5) return 'calculo';
  if (densidadFormula >= 0.15) return 'output';
  if (stats.valoresTexto / stats.celdas >= 0.6) return 'informativa';
  return 'input';
}

// ------------------------------------------------------------
// Estructura de retorno interno del parser
// ------------------------------------------------------------
interface ParsedPayload {
  rawText: string;
  hojas?: DocumentSheetInfo[];
  errores: string[];
  qa_context: string;
  warnings: string[];
}

function buildQaContext(hojas: DocumentSheetInfo[] | undefined, errores: string[]): string {
  const lines: string[] = [];
  if (hojas && hojas.length) {
    hojas.forEach((h) =>
      lines.push(`Hoja "${h.nombre}" (rol: ${h.rol}, ${h.celdas} celdas)`)
    );
  }
  if (errores.length) {
    lines.push(`Errores de fórmula detectados (${errores.length}): ${errores.slice(0, 20).join('; ')}`);
  }
  return lines.join('\n');
}

function buildHeuristicResumen(payload: ParsedPayload, rawText: string): string {
  const head = rawText.replace(/\s+/g, ' ').trim().slice(0, 400);
  const line =
    payload.hojas && payload.hojas.length
      ? `Documento con ${payload.hojas.length} hoja(s): ${payload.hojas
          .map((h) => `${h.nombre} (${h.rol})`)
          .join(', ')}.`
      : '';
  const body = head ? `Inicio del contenido: ${head}` : 'Documento sin texto extraíble.';
  return [line, body].filter(Boolean).join(' ');
}

// ------------------------------------------------------------
// Parsers por tipo
// ------------------------------------------------------------
/** Forma mínima de la biblioteca SheetJS que consume el parser. */
interface XlsxCell { v?: unknown; f?: string }
interface XlsxSheet { '!ref'?: string; [cell: string]: unknown }
interface XlsxRange { s: { r: number; c: number }; e: { r: number; c: number } }
interface XlsxModule {
  utils: {
    decode_range(ref: string): XlsxRange;
    encode_cell(cell: { r: number; c: number }): string;
  };
  read(data: Uint8Array, opts: { type: 'array' }): {
    SheetNames: string[];
    Sheets: Record<string, unknown>;
  };
}

function inspectSheet(ws: unknown, name: string, XLSX: unknown, limits: DocumentAnalysisLimits): {
  sheet: DocumentSheetInfo;
  errors: string[];
  sampleText: string;
} {
  const x = XLSX as XlsxModule;
  const anyWs = ws as XlsxSheet;
  const ref = anyWs && anyWs['!ref'];
  if (!ref) {
    return {
      sheet: { nombre: name, rol: 'informativa', celdas: 0, errores: [] },
      errors: [],
      sampleText: `(hoja vacía: ${name})`,
    };
  }
  let celdasConValor = 0;
  let formulas = 0;
  let valoresTexto = 0;
  const errores: string[] = [];
  const sample: string[] = [];
  const range = x.utils.decode_range(ref);
  let visited = 0;
  outer: for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      if (visited >= limits.maxCellsPerSheet) break outer;
      const addr = x.utils.encode_cell({ r, c });
      const cell = anyWs[addr] as XlsxCell | undefined;
      if (!cell) continue;
      visited += 1;
      const val = cell.v;
      if (val === undefined || val === null || val === '') continue;
      celdasConValor += 1;
      if (cell.f) formulas += 1;
      if (typeof val === 'string') {
        const str = val.trim();
        if (str) sample.push(str);
        if (EXCEL_ERROR_PATTERN.test(str)) {
          errores.push(`${addr}: ${str}`);
        } else {
          valoresTexto += 1;
        }
      }
    }
  }
  const sheet: DocumentSheetInfo = {
    nombre: name,
    rol: detectSheetRol({ celdas: celdasConValor, formulas, valoresTexto }),
    celdas: celdasConValor,
    errores: errores.slice(0, 8),
  };
  return { sheet, errors: errores, sampleText: sample.slice(0, 60).join(' | ') };
}

async function parseExcel(data: ArrayBuffer): Promise<ParsedPayload> {
  const limits = getLimits();
  let XLSX: unknown;
  try {
    XLSX = await import('xlsx');
  } catch {
        logCaughtError('[catch] src/lib/documentParser.ts');
    return {
      rawText: '',
      errores: [],
      qa_context: '',
      warnings: ['No se pudo cargar el lector de Excel (xlsx). Análisis de estructura omitido.'],
    };
  }
  try {
    const wb = (XLSX as XlsxModule).read(new Uint8Array(data), { type: 'array' });
    const sheets: DocumentSheetInfo[] = [];
    const allErrors: string[] = [];
    const lines: string[] = [];
    const warnings: string[] = [];
    const names = wb.SheetNames.slice(0, limits.maxSheets);
    if (wb.SheetNames.length > limits.maxSheets) {
      warnings.push(`El libro tiene ${wb.SheetNames.length} hojas; se inspeccionaron las primeras ${limits.maxSheets}.`);
    }
    for (const name of names) {
      const ws = wb.Sheets[name];
      const info = inspectSheet(ws, name, XLSX, limits);
      sheets.push(info.sheet);
      info.errors.forEach((e) => allErrors.push(`[${name}] ${e}`));
      lines.push(`=== Hoja: ${name} ===`);
      lines.push(info.sampleText);
    }
    const rawText = lines.join('\n');
    return {
      rawText,
      hojas: sheets,
      errores: allErrors,
      qa_context: buildQaContext(sheets, allErrors),
      warnings,
    };
  } catch (e) {
        logCaughtError('[catch] src/lib/documentParser.ts', e);
    return {
      rawText: '',
      errores: [],
      qa_context: '',
      warnings: [`No se pudo analizar el Excel: ${errMsg(e)}`],
    };
  }
}

async function parsePdf(data: ArrayBuffer): Promise<ParsedPayload> {
  try {
    const pdfjs = await import('pdfjs-dist');
    if (!pdfjs || typeof pdfjs.getDocument !== 'function') {
      throw new Error('módulo pdfjs-dist no disponible');
    }
    if (typeof document !== 'undefined' && !pdfjs.GlobalWorkerOptions?.workerSrc) {
      try {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
      } catch {
        logCaughtError('[catch] src/lib/documentParser.ts');
        /* sin worker configurado: se intenta igual; si falla, degradación */
      }
    }
    const loadingTask = pdfjs.getDocument({ data: new Uint8Array(data) });
    const doc = await loadingTask.promise;
    const pages: string[] = [];
    const maxPages = Math.min(doc.numPages, getLimits().maxSheets);
    for (let i = 1; i <= maxPages; i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = (content.items || [])
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ');
      pages.push(`=== Página ${i} ===\n${text}`);
    }
    await loadingTask.destroy().catch(() => undefined);
    return { rawText: pages.join('\n'), errores: [], qa_context: '', warnings: [] };
  } catch (e) {
        logCaughtError('[catch] src/lib/documentParser.ts', e);
    return {
      rawText: '',
      errores: [],
      qa_context: '',
      warnings: [`No se pudo analizar el PDF: ${errMsg(e)}`],
    };
  }
}

async function parseDocx(data: ArrayBuffer): Promise<ParsedPayload> {
  try {
    const mammoth = await import('mammoth');
    if (!mammoth || typeof mammoth.extractRawText !== 'function') {
      throw new Error('módulo mammoth no disponible');
    }
    const result = await mammoth.extractRawText({ arrayBuffer: data });
    const rawText = (result && result.value) || '';
    return { rawText, errores: [], qa_context: '', warnings: [] };
  } catch (e) {
        logCaughtError('[catch] src/lib/documentParser.ts', e);
    return {
      rawText: '',
      errores: [],
      qa_context: '',
      warnings: [`No se pudo analizar el documento de Word: ${errMsg(e)}`],
    };
  }
}

/** Diapositiva devuelta por pptx-parser (módulo sin tipos declarados). */
interface PptxSlide {
  texts?: unknown;
}

async function parsePptx(data: ArrayBuffer): Promise<ParsedPayload> {
  try {
    const mod = await import('pptx-parser');
    const pptxParser = mod.default || Reflect.get(mod, 'default') || mod;
    if (typeof pptxParser !== 'function') {
      throw new Error('módulo pptx-parser no disponible');
    }
    const slides = await pptxParser(new Uint8Array(data));
    const lines: string[] = [];
    (slides || []).forEach((slide: PptxSlide, idx: number) => {
      lines.push(`=== Diapositiva ${idx + 1} ===`);
      const texts: string[] = [];
      const collect = (node: unknown): void => {
        if (!node) return;
        if (typeof node === 'string') {
          if (node.trim()) texts.push(node.trim());
          return;
        }
        if (typeof node === 'object' && 'text' in node && typeof node.text === 'string' && node.text.trim()) {
          texts.push(node.text.trim());
        }
        if (Array.isArray(node)) {
          node.forEach(collect);
        } else if (typeof node === 'object') {
          for (const v of Object.values(node)) {
            if (typeof v === 'string' || typeof v === 'object') collect(v);
          }
        }
      };
      collect(slide && slide.texts);
      lines.push(texts.join(' | '));
    });
    return { rawText: lines.join('\n'), errores: [], qa_context: '', warnings: [] };
  } catch (e) {
        logCaughtError('[catch] src/lib/documentParser.ts', e);
    return {
      rawText: '',
      errores: [],
      qa_context: '',
      warnings: [`No se pudo analizar la presentación: ${errMsg(e)}`],
    };
  }
}

async function parseText(data: ArrayBuffer, _mime: string): Promise<ParsedPayload> {
  try {
    const text = readArrayBufferAsUtf8(data);
    return { rawText: text, errores: [], qa_context: '', warnings: [] };
  } catch (e) {
        logCaughtError('[catch] src/lib/documentParser.ts', e);
    return {
      rawText: '',
      errores: [],
      qa_context: '',
      warnings: [`No se pudo leer el texto: ${errMsg(e)}`],
    };
  }
}

// ------------------------------------------------------------
// Entrada principal
// ------------------------------------------------------------
/**
 * Analiza un archivo y produce un DocumentAnalysisResult
 * (contrato base + texto en crudo + chunks + warnings).
 */
export async function parseDocument(file: File): Promise<DocumentAnalysisResult> {
  const limits = getLimits();
  const warnings: string[] = [];
  if (file.size > limits.maxFileSizeBytes) {
    warnings.push(`El archivo supera el tope de ${Math.round(limits.maxFileSizeBytes / 1024 / 1024)} MB.`);
  }

  const { tipo, mime } = getDocumentTipo(file);
  let data: ArrayBuffer;
  try {
    data = await file.arrayBuffer();
  } catch (e) {
        logCaughtError('[catch] src/lib/documentParser.ts', e);
    return {
      contract: {
        tipo,
        mime,
        nombre: file.name,
        tamaño: file.size,
        errores: [],
        resumen: 'No se pudo leer el archivo.',
        puntos_clave: [],
        qa_context: '',
      },
      rawText: '',
      chunks: [],
      warnings: [`No se pudo leer el archivo: ${errMsg(e)}`],
    };
  }

  let payload: ParsedPayload;
  switch (tipo) {
    case 'xlsm':
    case 'xlsx':
      payload = await parseExcel(data);
      break;
    case 'pdf':
      payload = await parsePdf(data);
      break;
    case 'docx':
      payload = await parseDocx(data);
      break;
    case 'pptx':
      payload = await parsePptx(data);
      break;
    default:
      payload = await parseText(data, mime);
      break;
  }

  const rawText = payload.rawText.slice(0, limits.maxTextChars);
  const chunks = chunkText(rawText, limits.chunkChars, limits.maxChunks);

  const contract: DocumentContract = {
    tipo,
    mime,
    nombre: file.name,
    tamaño: file.size,
    hojas: payload.hojas,
    errores: payload.errores,
    resumen: buildHeuristicResumen(payload, rawText),
    puntos_clave: [],
    qa_context: payload.qa_context || rawText.slice(0, 4000),
  };

  return {
    contract,
    rawText,
    chunks,
    warnings: [...warnings, ...payload.warnings],
  };
}
