// ============================================================
// dynamicPaletas.test.ts — Fase 1B: Paletas dinámicas
// ------------------------------------------------------------
// Cubre la capa pura del catálogo dinámico de paletas:
//   - slugifyPalette (id canónico a partir del nombre)
//   - editableFieldsOf / emptyEditableFields (contrato del formulario)
//   - buildPaletaPayload (payload completo desde plantilla)
//   - mergeCatalog / cloneBuiltin (fusión built-ins + dinámicos)
//   - paletaSchema (validación estricta)
//   - caché fusionada setMergedPalettes / resetMergedPalettes
// ============================================================
import { afterEach, describe, expect, it } from 'vitest';

import {
  PALETTES,
  builtinPaletteEntries,
  getAllPalettes,
  getFusedPalettes,
  getPalette,
  getPaletteKeys,
  resetMergedPalettes,
  setMergedPalettes,
  type PaletteDefinition,
} from '../src/core/branding/seasonalPalettes';
import {
  buildPaletaPayload,
  editableFieldsOf,
  emptyEditableFields,
  slugifyPalette,
  type EditablePaletteFields,
} from '../src/core/branding/paletaFactory';
import { cloneBuiltin, isReservedId, mergeCatalog } from '../src/core/catalogs/mergeCatalog';
import { paletaSchema } from '../src/core/catalogs/catalogSchema';

// ------------------------------------------------------------
// Helpers compartidos
// ------------------------------------------------------------
// Plantilla: un built-in COMPLETO (default incluye las 13 claves
// CSS del set de variables, por lo que sirve como plantilla para
// el esquema estricto).
const TEMPLATE = builtinPaletteEntries().find((paleta) => paleta.id === 'default') ?? builtinPaletteEntries()[0];

function buildFields(overrides: Partial<EditablePaletteFields> = {}): EditablePaletteFields {
  return {
    name: 'Modo Neon',
    colors: {
      '--bg-primary': '#0d1117',
      '--bg-secondary': '#161b22',
      '--bg-tertiary': '#21262d',
      '--bg-card': '#1c2128',
      '--text-primary': '#f0f6fc',
      '--text-secondary': '#c9d1d9',
      '--text-muted': '#8b949e',
      '--accent-cyan': '#58a6ff',
      '--accent-green': '#3fb950',
      '--accent-orange': '#f0883e',
      '--accent-red': '#f85149',
      '--accent-pink': '#db61a2',
      '--border-color': '#30363d',
    },
    decoration: '',
    cssClass: '',
    ...overrides,
  };
}

function validPayload(): PaletteDefinition {
  return buildPaletaPayload(TEMPLATE, buildFields());
}

// Devuelve una copia del payload sin una clave de color dada (para
// los casos de fallo del esquema, ya que el payload siempre trae 13).
function stripColor(payload: PaletteDefinition, key: string): PaletteDefinition {
  const colors = payload.colors as Record<string, string | undefined>;
  delete colors[key];
  return { ...payload, colors: colors as PaletteDefinition['colors'] };
}

// Restaura la caché fusionada entre pruebas (nunca deja estado mutado).
afterEach(() => {
  resetMergedPalettes();
});

// ------------------------------------------------------------
describe('slugifyPalette — id canónico', () => {
  it('convierte nombres en slugs minúsculos con guiones', () => {
    expect(slugifyPalette('Modo Neon')).toBe('modo-neon');
    expect(slugifyPalette('Paleta  Verano 2')).toBe('paleta-verano-2');
  });

  it('elimina acentos y caracteres especiales', () => {
    expect(slugifyPalette('Bosque Encantado')).toBe('bosque-encantado');
    expect(slugifyPalette('Otoño Ártico')).toBe('otono-artico');
  });

  it('descarta guiones iniciales/finales y devuelve vacío para texto sin letras', () => {
    expect(slugifyPalette('  Modo  ')).toBe('modo');
    expect(slugifyPalette('!!!')).toBe('');
  });
});

// ------------------------------------------------------------
describe('editableFieldsOf / emptyEditableFields — contrato del formulario', () => {
  it('expone nombre, las 13 claves de color y opcionales de la paleta', () => {
    const fields = editableFieldsOf(TEMPLATE);
    expect(fields.name).toBe(TEMPLATE.name);
    expect(Object.keys(fields.colors)).toHaveLength(13);
    expect(fields.colors['--bg-primary']).toBe(TEMPLATE.colors['--bg-primary']);
    expect(fields.decoration).toBe(TEMPLATE.decoration ?? '');
    expect(fields.cssClass).toBe(TEMPLATE.cssClass ?? '');
  });

  it('no comparte referencias: mutar colors no afecta a la paleta', () => {
    const fields = editableFieldsOf(TEMPLATE);
    fields.colors['--bg-primary'] = '#000000';
    expect(TEMPLATE.colors['--bg-primary']).not.toBe('#000000');
  });

  it('emptyEditableFields limpia la identidad pero conserva los colores', () => {
    const fields = emptyEditableFields(TEMPLATE);
    expect(fields.name).toBe('');
    expect(fields.decoration).toBe('');
    expect(fields.cssClass).toBe('');
    expect(fields.colors['--bg-primary']).toBe(TEMPLATE.colors['--bg-primary']);
  });
});

// ------------------------------------------------------------
describe('buildPaletaPayload — payload completo desde plantilla', () => {
  it('deriva el id canónico del nombre (slug) y recorta name', () => {
    const payload = buildPaletaPayload(TEMPLATE, buildFields({ name: '  Modo Neon  ' }));
    expect(payload.id).toBe('modo-neon');
    expect(payload.name).toBe('Modo Neon');
  });

  it('conserva las 13 claves de color con valores recortados', () => {
    const payload = buildPaletaPayload(TEMPLATE, buildFields());
    expect(Object.keys(payload.colors)).toHaveLength(13);
    expect(payload.colors['--bg-primary']).toBe('#0d1117');
  });

  it('incluye decoration/cssClass solo si tienen valor no vacío', () => {
    const payload = buildPaletaPayload(
      TEMPLATE,
      buildFields({ decoration: 'santa-hat', cssClass: 'season-navidad' })
    );
    expect(payload.decoration).toBe('santa-hat');
    expect(payload.cssClass).toBe('season-navidad');

    const vacio = buildPaletaPayload(TEMPLATE, buildFields());
    expect(vacio.decoration).toBeUndefined();
    expect(vacio.cssClass).toBeUndefined();
  });

  it('no muta la plantilla de origen', () => {
    const snapshot = structuredClone(TEMPLATE);
    buildPaletaPayload(TEMPLATE, buildFields());
    expect(TEMPLATE).toEqual(snapshot);
  });
});

// ------------------------------------------------------------
describe('mergeCatalog / cloneBuiltin — fusión built-ins + dinámicos', () => {
  it('mantiene los built-ins primero y añade los dinámicos después', () => {
    const dynamic = [cloneBuiltin(builtinPaletteEntries()[0], 'modo-neon')];
    const merged = mergeCatalog(builtinPaletteEntries(), dynamic);
    expect(merged[0].id).toBe(builtinPaletteEntries()[0].id);
    expect(merged[merged.length - 1].id).toBe('modo-neon');
  });

  it('omite dinámicos con id reservado (built-in) o duplicado', () => {
    const dynamic = [
      cloneBuiltin(builtinPaletteEntries()[0], 'navidad'), // id reservado
      cloneBuiltin(builtinPaletteEntries()[0], 'modo-neon'),
      cloneBuiltin(builtinPaletteEntries()[0], 'modo-neon'), // duplicado
    ];
    const merged = mergeCatalog(builtinPaletteEntries(), dynamic);
    expect(merged).toHaveLength(builtinPaletteEntries().length + 1);
    // 'navidad' ES un built-in, así que debe quedar EXACTAMENTE una entrada
    // (la built-in); el clon dinámico con id reservado se omite.
    expect(merged.filter((paleta) => paleta.id === 'navidad')).toHaveLength(1);
    expect(merged.filter((paleta) => paleta.id === 'modo-neon')).toHaveLength(1);
  });

  it('nunca muta el arreglo de built-ins', () => {
    const snapshot = builtinPaletteEntries().map((paleta) => ({ ...paleta }));
    mergeCatalog(builtinPaletteEntries(), [cloneBuiltin(builtinPaletteEntries()[0], 'modo-neon')]);
    expect(builtinPaletteEntries()).toEqual(snapshot);
  });

  it('isReservedId detecta ids pertenecientes a los built-ins', () => {
    expect(isReservedId('navidad', builtinPaletteEntries())).toBe(true);
    expect(isReservedId('modo-neon', builtinPaletteEntries())).toBe(false);
  });

  it('cloneBuiltin produce una copia profunda con id sustituido', () => {
    const source = builtinPaletteEntries()[0];
    const copy = cloneBuiltin(source, 'modo-neon');
    expect(copy.id).toBe('modo-neon');
    expect(copy.colors).toEqual(source.colors);
    copy.colors['--bg-primary'] = '#000000';
    expect(source.colors['--bg-primary']).not.toBe('#000000');
  });
});

// ------------------------------------------------------------
describe('paletaSchema — validación estricta', () => {
  it('acepta un payload completo válido', () => {
    expect(paletaSchema.validate(validPayload())).toBeNull();
  });

  it('declara como reservados los ids de los built-ins', () => {
    expect(paletaSchema.reservedIds.has('navidad')).toBe(true);
    expect(paletaSchema.reservedIds.has('modo-neon')).toBe(false);
  });

  it('rechaza ids que no son slugs', () => {
    const payload = validPayload();
    payload.id = 'Modo Neon';
    expect(paletaSchema.validate(payload)).toMatch(/slug/);
  });

  it('rechaza name vacío', () => {
    const payload = validPayload();
    payload.name = '   ';
    expect(paletaSchema.validate(payload)).toMatch(/name/);
  });

  it('rechaza colors con claves faltantes', () => {
    const payload = stripColor(validPayload(), '--bg-primary');
    expect(paletaSchema.validate(payload)).toMatch(/exactamente/);
  });

  it('rechaza colors con claves extra', () => {
    const payload = validPayload();
    const colors = { ...payload.colors, '--extra': '#000000' } as Record<string, unknown>;
    (payload as unknown as { colors: unknown }).colors = colors;
    expect(paletaSchema.validate(payload)).toMatch(/exactamente/);
  });

  it('rechaza valores de color no hex', () => {
    const payload = validPayload();
    payload.colors['--bg-primary'] = 'red';
    expect(paletaSchema.validate(payload)).toMatch(/colors\.--bg-primary/);
  });

  it('acepta decoration/cssClass opcionales ausentes', () => {
    expect(paletaSchema.validate(validPayload())).toBeNull();
  });

  it('rechaza decoration vacía cuando está presente', () => {
    const payload = validPayload();
    payload.decoration = '';
    expect(paletaSchema.validate(payload)).toMatch(/decoration/);
  });

  it('rechaza cssClass vacía cuando está presente', () => {
    const payload = validPayload();
    payload.cssClass = '   ';
    expect(paletaSchema.validate(payload)).toMatch(/cssClass/);
  });
});

// ------------------------------------------------------------
describe('caché fusionada — setMergedPalettes / resetMergedPalettes', () => {
  it('arranca con el catálogo built-in (una entrada por paleta)', () => {
    expect(getAllPalettes()).toHaveLength(Object.keys(PALETTES).length);
    expect(getAllPalettes()).toEqual(builtinPaletteEntries());
    expect(getFusedPalettes()).toBe(getAllPalettes());
  });

  it('setMergedPalettes sustituye la caché y actualiza los getters', () => {
    const dinamica = buildPaletaPayload(TEMPLATE, buildFields({ name: 'Modo Neon' }));
    const merged = [...builtinPaletteEntries(), dinamica];
    setMergedPalettes(merged);

    expect(getFusedPalettes()).toBe(merged);
    expect(getAllPalettes()).toBe(merged);
    expect(getPaletteKeys()).toContain('modo-neon');
    expect(getPalette('modo-neon').name).toBe('Modo Neon');
    expect(getPalette('default')).toBeDefined();
  });

  it('getPalette resuelve contra la caché fusionada', () => {
    const dinamica = buildPaletaPayload(TEMPLATE, buildFields({ name: 'Modo Neon' }));
    setMergedPalettes([...builtinPaletteEntries(), dinamica]);
    expect(getPalette('modo-neon').name).toBe('Modo Neon');
  });

  it('resetMergedPalettes restaura el catálogo built-in', () => {
    const dinamica = buildPaletaPayload(TEMPLATE, buildFields({ name: 'Modo Neon' }));
    setMergedPalettes([...builtinPaletteEntries(), dinamica]);
    resetMergedPalettes();

    expect(getAllPalettes()).toEqual(builtinPaletteEntries());
    expect(getPaletteKeys()).not.toContain('modo-neon');
    expect(getPalette('modo-neon')).toBe(PALETTES.default);
  });

  it('los ids desconocidos devuelven la paleta default', () => {
    expect(getPalette('inexistente')).toBe(PALETTES.default);
    expect(getPaletteKeys()).not.toContain('inexistente');
  });
});
