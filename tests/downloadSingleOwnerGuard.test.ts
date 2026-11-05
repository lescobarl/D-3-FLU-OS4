/**
 * downloadSingleOwnerGuard — un solo dueño del ancla de descarga.
 *
 * Hallazgo 2026-11-01: `downloadBlob` ya era dueño del Blob, pero
 * DocumentsHistoryPanel, GenerationProgressPanel y sessionRecorder repetían
 * `createObjectURL + <a download> + click + revoke` con variantes (target,
 * rel y revoke diferido). El guard falla si vuelve a aparecer una asignación
 * `.download =` fuera de `src/lib/downloadFile.ts`.
 *
 * El detector se prueba por los dos lados: marca una copia sintética y no
 * marca al dueño.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { walkFiles } from '../scripts/fsScan.mjs';

const ROOT = process.cwd();
const OWNER = 'src/lib/downloadFile.ts';

export interface SourceFile {
  file: string;
  source: string;
}

/** Líneas que asignan `.download` fuera del dueño (ignora comentarios). */
export function downloadAnchorOffenders(sources: ReadonlyArray<SourceFile>): string[] {
  const out: string[] = [];
  for (const { file, source } of sources) {
    if (file === OWNER) continue;
    source.split(/\r?\n/).forEach((line, index) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;
      if (/\.download\s*=/.test(line)) out.push(`${file}:${index + 1}`);
    });
  }
  return out;
}

function readSrc(): SourceFile[] {
  return walkFiles(join(ROOT, 'src'), (entry: string) => /\.(ts|tsx|js|jsx|mjs)$/.test(entry)).map((file) => ({
    file: relative(ROOT, file).replace(/\\/g, '/'),
    source: readFileSync(file, 'utf8'),
  }));
}

describe('descarga — un solo dueño del ancla', () => {
  it('solo src/lib/downloadFile.ts asigna .download', () => {
    const offenders = downloadAnchorOffenders(readSrc());
    expect(
      offenders,
      'Ancla de descarga fuera del dueño (importa downloadBlob/downloadUrl):\n  ' +
        offenders.join('\n  '),
    ).toEqual([]);
  });

  it('el dueño expone Blob y URL', () => {
    const owner = readFileSync(join(ROOT, OWNER), 'utf8');
    expect(owner).toContain('export function downloadBlob(');
    expect(owner).toContain('export function downloadUrl(');
    expect(owner).toContain('link.download = fileName');
  });

  it('el detector no es decorativo', () => {
    const synthetic = [
      { file: 'src/a.ts', source: "const a = document.createElement('a');\na.download = 'x';\n" },
    ];
    expect(downloadAnchorOffenders(synthetic)).toEqual(['src/a.ts:2']);
    expect(downloadAnchorOffenders([{ file: OWNER, source: "a.download = 'x';\n" }])).toEqual([]);
  });
});
