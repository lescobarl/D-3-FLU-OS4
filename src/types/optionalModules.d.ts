// ============================================================
// optionalModules.d.ts — Tipos de dependencias opcionales (V13)
// ------------------------------------------------------------
// Bibliotecas cargadas dinámicamente que no publican tipos propios.
// Declararlas aquí evita `@ts-ignore` y mantiene el contrato del
// import dinámico en un único punto tipado.
// ============================================================

declare module 'pptx-parser' {
  /** Slide extraída de un .pptx, en el orden del documento. */
  export interface PptxSlide {
    readonly [key: string]: unknown;
  }
  /** Parsea un .pptx desde bytes; resuelve la lista de slides. */
  const parsePptx: (data: Uint8Array) => Promise<PptxSlide[]>;
  export default parsePptx;
}

declare module 'pdfkit/js/pdfkit.standalone' {
  export interface PdfKitDocumentOptions {
    margin?: number;
    size?: string | readonly [number, number];
  }
  export interface PdfKitDocument {
    on(event: 'data', cb: (chunk: Uint8Array) => void): this;
    on(event: 'end', cb: () => void): this;
    on(event: 'error', cb: (err: Error) => void): this;
    on(event: string, cb: (...args: unknown[]) => void): this;
    text(text: string): this;
    fontSize(size: number): this;
    end(): void;
  }
  export interface PdfKitDocumentConstructor {
    new (options?: PdfKitDocumentOptions): PdfKitDocument;
  }
  const PDFDocument: PdfKitDocumentConstructor;
  export default PDFDocument;
}
