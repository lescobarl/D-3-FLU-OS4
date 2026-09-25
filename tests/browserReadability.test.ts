// ============================================================
// browserReadability.test.ts — extractor de lectura curada
// Vitest corre en entorno node (sin DOMParser), por eso el
// extractor es 100% regex y funciona igual en node y navegador.
// ============================================================
import { describe, expect, it } from 'vitest';
import { extractReadableContent, truncateContent } from '../src/core/browser/browserReadability';

describe('browserReadability — extractReadableContent', () => {
  it('extrae el título desde <title> y los párrafos desde <p>', () => {
    const html = `
      <html>
        <head><title>Biografía de ejemplo</title></head>
        <body>
          <h1>Biografía de ejemplo</h1>
          <p>Este es el primer párrafo de la página.</p>
          <p>Este es el segundo párrafo con   espacios   extra.</p>
        </body>
      </html>`;
    const result = extractReadableContent(html);
    expect(result.title).toBe('Biografía de ejemplo');
    expect(result.paragraphs).toEqual([
      'Este es el primer párrafo de la página.',
      'Este es el segundo párrafo con espacios extra.',
    ]);
  });

  it('usa <h1> como respaldo cuando no hay <title>', () => {
    const html = '<html><body><h1>Encabezado único</h1><p>Contenido.</p></body></html>';
    const result = extractReadableContent(html);
    expect(result.title).toBe('Encabezado único');
  });

  it('elimina bloques script/style/nav/header/footer/aside', () => {
    const html = `
      <html><body>
        <nav><a href="/">Menú de navegación</a></nav>
        <header>Encabezado del sitio</header>
        <script>const secreto = 'no debe aparecer';</script>
        <style>.clase { color: red; }</style>
        <aside>Publicidad lateral</aside>
        <footer>Pie de página</footer>
        <p>El único párrafo real.</p>
      </body></html>`;
    const result = extractReadableContent(html);
    expect(result.title).toBe('');
    expect(result.paragraphs).toEqual(['El único párrafo real.']);
    const joined = result.paragraphs.join(' ');
    expect(joined).not.toContain('no debe aparecer');
    expect(joined).not.toContain('Menú de navegación');
    expect(joined).not.toContain('Pie de página');
  });

  it('recolecta elementos <li> como párrafos de lista', () => {
    const html = '<ul><li>Primer ítem</li><li>Segundo ítem</li></ul>';
    const result = extractReadableContent(html);
    expect(result.paragraphs).toEqual(['Primer ítem', 'Segundo ítem']);
  });

  it('no duplica el título dentro de los párrafos', () => {
    const html =
      '<html><head><title>Título A</title></head><body><h1>Título A</h1><p>Contenido.</p></body></html>';
    const result = extractReadableContent(html);
    expect(result.title).toBe('Título A');
    expect(result.paragraphs).toEqual(['Contenido.']);
  });
});

describe('browserReadability — truncateContent', () => {
  it('devuelve el texto intacto si no supera el límite', () => {
    expect(truncateContent('Hola mundo', 50)).toBe('Hola mundo');
  });

  it('trunca en el límite de párrafo y agrega elipsis', () => {
    const text = 'Primer párrafo.\n\nSegundo párrafo.\n\nTercer párrafo.';
    const result = truncateContent(text, 30);
    expect(result).toBe('Primer párrafo.\n\n…');
  });

  it('recorta el primer párrafo si es más largo que el límite', () => {
    const text = 'abcdefghij';
    const result = truncateContent(text, 5);
    expect(result).toBe('abcde…');
  });
});
