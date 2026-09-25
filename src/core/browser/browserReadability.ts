// ============================================================
// browserReadability.ts — Extracción de lectura curada
// Convierte el HTML crudo de un sitio permitido en texto legible.
// Implementación 100% regex (sin DOMParser) para funcionar tanto
// en el navegador como en el entorno node de vitest.
// ============================================================

const BLOCK_TAGS = ['script', 'style', 'nav', 'header', 'footer', 'aside', 'form', 'button', 'iframe'] as const;

const PARAGRAPH_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'blockquote'] as const;

function stripBlocks(html: string, tags: readonly string[]): string {
  let out = String(html || '');
  for (const tag of tags) {
    out = out.replace(new RegExp(`<${tag}[\\s\\S]*?<\\/${tag}>`, 'gi'), ' ');
  }
  return out;
}

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&/gi, '&')
    .replace(/</gi, '<')
    .replace(/>/gi, '>')
    .replace(/"/gi, '"')
    .replace(/'|'/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function extractFirstTag(html: string, tag: string): string {
  const match = String(html || '').match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? normalizeWhitespace(match[1]) : '';
}

function collectByTags(html: string, tags: readonly string[]): string[] {
  const out: string[] = [];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(String(html || ''))) !== null) {
      const text = normalizeWhitespace(m[1]);
      if (text) out.push(text);
    }
  }
  return out;
}

export interface ReadableContent {
  title: string;
  paragraphs: string[];
}

export function extractReadableContent(html: string): ReadableContent {
  const cleaned = stripBlocks(html, BLOCK_TAGS);
  const title = extractFirstTag(cleaned, 'title') || extractFirstTag(cleaned, 'h1');
  let paragraphs = collectByTags(cleaned, PARAGRAPH_TAGS);
  // Evita repetir el título como párrafo
  if (title) {
    paragraphs = paragraphs.filter((p) => p !== title);
  }
  return { title, paragraphs };
}

export function truncateContent(text: string, maxChars: number): string {
  const clean = String(text ?? '');
  const limit = Number(maxChars) > 0 ? Number(maxChars) : clean.length;
  if (clean.length <= limit) return clean;
  const segments = clean.split('\n\n');
  let acc = '';
  for (const segment of segments) {
    const candidate = acc ? `${acc}\n\n${segment}` : segment;
    if (candidate.length > limit) break;
    acc = candidate;
  }
  if (!acc) return `${clean.slice(0, limit)}…`;
  return acc.length < clean.length ? `${acc}\n\n…` : acc;
}
