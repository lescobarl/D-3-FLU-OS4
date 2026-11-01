/**
 * conversationLateSignatureGuard — la medida tardía persiste el TIMBRE.
 *
 * Hallazgo 2026-11-01: `reetiquetarFila` actualizaba etiqueta+evidencia pero
 * dejaba `signature:null`. El store caía a la etiqueta para `voiceKeyFor` y
 * abría hablantes nuevos o mezclaba voces. Ahora `CambiosFila` incluye `firma`,
 * el adaptador la persiste y el cierre pasa el vector de la plantilla.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

describe('medida tardía — la firma se persiste con el hablante', () => {
  it('el contrato, el adaptador y el cierre incluyen firma', () => {
    expect(source('src/voice/conversation/ports.ts')).toContain(
      "Partial<Pick<Fila, 'etiqueta' | 'evidencia' | 'firma'>>",
    );
    expect(source('src/voice/conversation/adaptersAlmacen.ts')).toContain(
      'firma: cambios.firma ?? anterior.firma',
    );
    expect(source('src/voice/conversation/cierre.ts')).toContain(
      'const firma = plantilla?.vector ?? fila.firma',
    );
    expect(source('src/voice/conversation/cierre.ts')).toContain('...(firma ? { firma } : {})');
  });

  it('el detector no es decorativo', () => {
    const sinFirma = "type CambiosFila = Readonly<Partial<Pick<Fila, 'etiqueta' | 'evidencia'>>>";
    expect(sinFirma.includes("'firma'")).toBe(false);
    expect(
      "type CambiosFila = Readonly<Partial<Pick<Fila, 'etiqueta' | 'evidencia' | 'firma'>>>".includes(
        "'firma'",
      ),
    ).toBe(true);
  });
});
