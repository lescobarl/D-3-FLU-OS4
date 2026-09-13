// ============================================================
// formatAdapters.ts — capa de adaptadores de formato (F3/F4)
// ============================================================
// Principio de arquitectura: el LLM produce el CONTENIDO; esta
// capa SOLO serializa al formato solicitado. Formatos nativos
// (md/html/csv/json/ics) se generan directamente; los binarios
// (pdf/docx/xlsx/pptx) usan import dinámico con degradación
// elegante a markdown si la biblioteca no está disponible.
//
// Rule #1: NO HARDCODE → extensiones/MIME por formato, sin
// literales dispersos en los servicios.
// ============================================================

import type { GeneratedDocumentResult } from '../core/ai/IAIService';
import type { GenerationFormato } from '../types/documentContracts';

// ------------------------------------------------------------
// Tabla central de formatos (extensión + MIME)
// ------------------------------------------------------------
export interface FormatInfo {
  ext: string;
  mime: string;
}

export const FORMAT_INFO: Record<GenerationFormato, FormatInfo> = {
  pdf: { ext: 'pdf', mime: 'application/pdf' },
  docx: { ext: 'docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
  xlsx: { ext: 'xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pptx: { ext: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
  md: { ext: 'md', mime: 'text/markdown' },
  html: { ext: 'html', mime: 'text/html' },
  csv: { ext: 'csv', mime: 'text/csv' },
  json: { ext: 'json', mime: 'application/json' },
  ics: { ext: 'ics', mime: 'text/calendar' },
  video: { ext: 'md', mime: 'text/markdown' },
};

export function safeFileName(nombre: string, ext: string): string {
  const base = (nombre || 'flu-documento').replace(/[^\w\-\u00C0-\uFFFF. ]+/g, '').trim() || 'flu-documento';
  const clean = base.replace(/\.(pdf|docx|xlsx|pptx|md|html|csv|json|ics)$/i, '');
  return `${clean}.${ext}`;
}

function toBlobUrl(content: string, mime: string): string {
  try {
    if (typeof Blob === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return '';
    }
    const blob = new Blob([content], { type: mime });
    return URL.createObjectURL(blob);
  } catch {
    return '';
  }
}

function textResult(content: string, mime: string, ext: string, nombre: string): GeneratedDocumentResult {
  const trimmed = content ?? '';
  return {
    content: trimmed,
    mime,
    ext,
    nombre: safeFileName(nombre, ext),
    bytes: trimmed.length,
    url: toBlobUrl(trimmed, mime),
  };
}

// ------------------------------------------------------------
// Serialización binaria (import dinámico + degradación)
// ------------------------------------------------------------
function fallbackMarkdown(content: string, nombre: string, target: FormatInfo): GeneratedDocumentResult {
  return textResult(content, FORMAT_INFO.md.mime, FORMAT_INFO.md.ext, nombre);
}

async function serializePdf(content: string, nombre: string): Promise<GeneratedDocumentResult> {
  try {
    // @ts-ignore - biblioteca opcional (pdfkit), cargada dinámicamente
    const mod: any = await import('pdfkit/js/pdfkit.standalone');
    const PDFDocument = mod.default || mod;
    if (typeof PDFDocument !== 'function') throw new Error('pdfkit no disponible');
    const doc = new PDFDocument({ margin: 48 });
    const chunks: Uint8Array[] = [];
    doc.on('data', (chunk: Uint8Array) => chunks.push(chunk));
    const done = new Promise<void>((resolve, reject) => {
      doc.on('end', () => resolve());
      doc.on('error', (err: Error) => reject(err));
    });
    const lines = String(content || '').split(/\r?\n/);
    for (const line of lines) {
      const t = (line || '').trim();
      if (!t) {
        doc.text(' ');
        continue;
      }
      if (/^#{1,6}\s/.test(t)) {
        doc.fontSize(t.startsWith('# ') ? 20 : t.startsWith('## ') ? 16 : 13).text(t.replace(/^#{1,6}\s*/, ''));
        doc.fontSize(11);
      } else {
        doc.text(t);
      }
    }
    doc.end();
    await done;
    const total = chunks.reduce((acc, c) => acc + c.length, 0);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    const binary = String.fromCharCode(...bytes);
    const dataUrl = `data:${FORMAT_INFO.pdf.mime};base64,${btoa(binary)}`;
    return {
      content: dataUrl,
      mime: FORMAT_INFO.pdf.mime,
      ext: FORMAT_INFO.pdf.ext,
      nombre: safeFileName(nombre, FORMAT_INFO.pdf.ext),
      bytes: bytes.length,
    };
  } catch (e) {
    console.warn('[formatAdapters] PDF serialization unavailable, falling back to markdown:', e);
    return fallbackMarkdown(content, nombre, FORMAT_INFO.pdf);
  }
}

async function serializeDocx(content: string, nombre: string): Promise<GeneratedDocumentResult> {
  try {
    // @ts-ignore - biblioteca opcional (docx), cargada dinámicamente
    const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
    const lines = String(content || '').split(/\r?\n/).map((l) => l.trim());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const children: any[] = [];
    for (const line of lines) {
      if (!line) continue;
      if (/^#\s/.test(line)) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun({ text: line.replace(/^#\s*/, ''), bold: true, size: 28 })] }));
      } else if (/^##\s/.test(line)) {
        children.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: line.replace(/^##\s*/, ''), bold: true, size: 24 })] }));
      } else if (/^[-*]\s/.test(line)) {
        children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: line.replace(/^[-*]\s*/, '') })] }));
      } else {
        children.push(new Paragraph({ children: [new TextRun({ text: line })] }));
      }
    }
    const doc = new Document({ sections: [{ children }] });
    const blob = await Packer.toBlob(doc);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const dataUrl = await blobToDataUrl(blob, FORMAT_INFO.docx.mime);
    return {
      content: dataUrl,
      mime: FORMAT_INFO.docx.mime,
      ext: FORMAT_INFO.docx.ext,
      nombre: safeFileName(nombre, FORMAT_INFO.docx.ext),
      bytes: bytes.length,
    };
  } catch (e) {
    console.warn('[formatAdapters] DOCX serialization unavailable, falling back to markdown:', e);
    return fallbackMarkdown(content, nombre, FORMAT_INFO.docx);
  }
}

async function serializeXlsx(content: string, nombre: string): Promise<GeneratedDocumentResult> {
  try {
    // @ts-ignore - biblioteca opcional (SheetJS), cargada dinámicamente
    const XLSX: any = await import('xlsx');
    let parsed: any;
    try {
      parsed = JSON.parse(String(content || '{}'));
    } catch {
      parsed = { rows: String(content || '').split(/\r?\n/).map((l) => l.split('\t')) };
    }
    const wb = XLSX.utils.book_new();
    const sheetDefs = Array.isArray(parsed.sheets) && parsed.sheets.length
      ? parsed.sheets
      : [{ name: 'Hoja 1', rows: parsed.rows || parsed.filas || [] }];
    for (const def of sheetDefs) {
      const rows = Array.isArray(def.rows) ? def.rows : [];
      const ws = XLSX.utils.aoa_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, String(def.name || 'Hoja 1').slice(0, 31));
    }
    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const bytes = new Uint8Array(out);
    const dataUrl = `data:${FORMAT_INFO.xlsx.mime};base64,${bytesToBase64(bytes)}`;
    return {
      content: dataUrl,
      mime: FORMAT_INFO.xlsx.mime,
      ext: FORMAT_INFO.xlsx.ext,
      nombre: safeFileName(nombre, FORMAT_INFO.xlsx.ext),
      bytes: bytes.length,
    };
  } catch (e) {
    console.warn('[formatAdapters] XLSX serialization unavailable, falling back to markdown:', e);
    return fallbackMarkdown(content, nombre, FORMAT_INFO.xlsx);
  }
}

async function serializePptx(content: string, nombre: string): Promise<GeneratedDocumentResult> {
  try {
    // @ts-ignore - biblioteca opcional (pptxgenjs), cargada dinámicamente
    const PptxGenJS: any = await import('pptxgenjs');
    const PptxGen = PptxGenJS.default || PptxGenJS;
    const pptx = new PptxGen();
    const slidesRaw = String(content || '').split(/(?=^#\s)/m);
    for (const raw of slidesRaw) {
      const lines = raw.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      if (!lines.length) continue;
      const slide = pptx.addSlide();
      const title = lines[0].replace(/^#\s*/, '');
      slide.addText(title, { x: 0.5, y: 0.4, w: 9, h: 0.8, fontSize: 28, bold: true, color: '1F3864' });
      let y = 1.5;
      for (const line of lines.slice(1)) {
        const text = line.replace(/^[-*]\s*/, '');
        slide.addText(text, { x: 0.6, y, w: 8.8, h: 0.5, fontSize: 16 });
        y += 0.55;
        if (y > 6.8) break;
      }
    }
    const data = await pptx.write('arraybuffer');
    const bytes = new Uint8Array(data);
    const dataUrl = `data:${FORMAT_INFO.pptx.mime};base64,${bytesToBase64(bytes)}`;
    return {
      content: dataUrl,
      mime: FORMAT_INFO.pptx.mime,
      ext: FORMAT_INFO.pptx.ext,
      nombre: safeFileName(nombre, FORMAT_INFO.pptx.ext),
      bytes: bytes.length,
    };
  } catch (e) {
    console.warn('[formatAdapters] PPTX serialization unavailable, falling back to markdown:', e);
    return fallbackMarkdown(content, nombre, FORMAT_INFO.pptx);
  }
}

// ------------------------------------------------------------
// Utilidades de bytes
// ------------------------------------------------------------
async function blobToDataUrl(blob: Blob, mime: string): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

// ------------------------------------------------------------
// Entrada principal
// ------------------------------------------------------------
/**
 * Serializa el contenido producido por el LLM al formato solicitado.
 * Devuelve un GeneratedDocumentResult listo para descarga.
 */
export async function serializeDocument(
  formato: GenerationFormato,
  content: string,
  nombre: string,
): Promise<GeneratedDocumentResult> {
  switch (formato) {
    case 'md':
      return textResult(content, FORMAT_INFO.md.mime, FORMAT_INFO.md.ext, nombre);
    case 'html':
      return textResult(content, FORMAT_INFO.html.mime, FORMAT_INFO.html.ext, nombre);
    case 'csv':
      return textResult(content, FORMAT_INFO.csv.mime, FORMAT_INFO.csv.ext, nombre);
    case 'json':
      return textResult(content, FORMAT_INFO.json.mime, FORMAT_INFO.json.ext, nombre);
    case 'ics':
      return textResult(content, FORMAT_INFO.ics.mime, FORMAT_INFO.ics.ext, nombre);
    case 'video':
      return textResult(content, FORMAT_INFO.video.mime, FORMAT_INFO.video.ext, nombre);
    case 'pdf':
      return serializePdf(content, nombre);
    case 'docx':
      return serializeDocx(content, nombre);
    case 'xlsx':
      return serializeXlsx(content, nombre);
    case 'pptx':
      return serializePptx(content, nombre);
    default:
      return textResult(content, 'text/plain', 'txt', nombre);
  }
}

/** Extensión/MIME por formato (para UI y descargas). */
export function getFormatInfo(formato: GenerationFormato): FormatInfo {
  return FORMAT_INFO[formato] || { ext: 'txt', mime: 'text/plain' };
}
