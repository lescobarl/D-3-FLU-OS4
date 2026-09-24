// ============================================================
// dynamicAmbientes.test.ts — Fase 1A: Ambientes dinámicos
// ------------------------------------------------------------
// Cubre la capa pura del catálogo dinámico de ambientes:
//   - slugifyAmbiente (id canónico a partir del nombre)
//   - editableFieldsOfEnvironment / emptyEnvironmentEditableFields (contrato del formulario)
//   - buildAmbientePayload (payload completo desde plantilla)
//   - mergeCatalog / cloneBuiltin (fusión built-ins + dinámicos)
//   - ambienteSchema (validación estricta)
//   - caché fusionada setMergedAmbientes / resetMergedAmbientes
// ============================================================
import { afterEach, describe, expect, it } from 'vitest';

import {
  ENVIRONMENTS,
  ENVIRONMENT_TAB_IDS,
  getAmbiente,
  getAmbientes,
  getEnvironmentCssVars,
  getVisibleTabIds,
  isAmbienteId,
  resetMergedAmbientes,
  setMergedAmbientes,
  type EnvironmentDefinition,
} from '../src/core/environments/environmentRegistry';
import {
  buildAmbientePayload,
  editableFieldsOfEnvironment,
  emptyEnvironmentEditableFields,
  slugifyAmbiente,
  type EditableAmbienteFields,
} from '../src/core/environments/ambienteFactory';
import { cloneBuiltin, isReservedId, mergeCatalog } from '../src/core/catalogs/mergeCatalog';
import { ambienteSchema } from '../src/core/catalogs/catalogSchema';

// ------------------------------------------------------------
// Helpers compartidos
// ------------------------------------------------------------
// Plantilla: un built-in COMPLETO (asistente deja `voz.instrucciones`
// vacía por diseño, así que no sirve como plantilla para el esquema estricto).
const TEMPLATE = ENVIRONMENTS.find((ambiente) => ambiente.id === 'chef') ?? ENVIRONMENTS[0];

function buildFields(overrides: Partial<EditableAmbienteFields> = {}): EditableAmbienteFields {
  return {
    nombre: 'Modo Selva',
    tagline: 'Aventura en la selva',
    icono: '🦜',
    frasesEs: 'actúa como explorador',
    frasesEn: 'act as an explorer',
    vars: { 'flu-accent': '#1b5e20' },
    decoracion: null,
    tabs: ['workspace', 'conversation'],
    ...overrides,
  };
}

function validPayload(): EnvironmentDefinition {
  return buildAmbientePayload(TEMPLATE, buildFields());
}

// Restaura la caché fusionada entre pruebas (nunca deja estado mutado).
afterEach(() => {
  resetMergedAmbientes();
});

// ------------------------------------------------------------
describe('slugifyAmbiente — id canónico', () => {
  it('convierte nombres en slugs minúsculos con guiones', () => {
    expect(slugifyAmbiente('Modo Selva')).toBe('modo-selva');
    expect(slugifyAmbiente('Bosque Encantado')).toBe('bosque-encantado');
  });

  it('normaliza espacios múltiples y recorta bordes', () => {
    expect(slugifyAmbiente('  Chef   Nocturno  ')).toBe('chef-nocturno');
  });

  it('elimina acentos y caracteres especiales', () => {
    expect(slugifyAmbiente('Café del Bosque')).toBe('cafe-del-bosque');
    expect(slugifyAmbiente('Montaña 3D!')).toBe('montana-3d');
  });

  it('descarta guiones iniciales/finales y devuelve vacío para texto sin letras', () => {
    expect(slugifyAmbiente('-Hola-')).toBe('hola');
    expect(slugifyAmbiente('!!!')).toBe('');
  });
});

// ------------------------------------------------------------
describe('editableFieldsOfEnvironment / emptyEnvironmentEditableFields — contrato del formulario', () => {
  const ambiente = ENVIRONMENTS.find((a) => a.id === 'chef') ?? ENVIRONMENTS[0];

  it('expone identidad, frases, tema y pestañas del ambiente', () => {
    const fields = editableFieldsOfEnvironment(ambiente);
    expect(fields.nombre).toBe(ambiente.nombre);
    expect(fields.tagline).toBe(ambiente.tagline);
    expect(fields.icono).toBe(ambiente.icono);
    expect(fields.frasesEs.split('\n')).toEqual(ambiente.frasesActivacion.es);
    expect(fields.frasesEn.split('\n')).toEqual(ambiente.frasesActivacion.en);
    expect(fields.vars).toEqual({ ...ambiente.tema.vars });
    expect(fields.decoracion).toBe(ambiente.tema.decoracion);
    expect(fields.tabs).toEqual([...ambiente.pestanas.mostrar]);
  });

  it('no comparte referencias: mutar vars no afecta al ambiente', () => {
    const fields = editableFieldsOfEnvironment(ambiente);
    fields.vars['flu-accent'] = '#000000';
    expect(ambiente.tema.vars['flu-accent']).not.toBe('#000000');
  });

  it('no comparte referencias: mutar tabs no afecta al ambiente', () => {
    const tabsBefore = [...ambiente.pestanas.mostrar];
    const fields = editableFieldsOfEnvironment(ambiente);
    fields.tabs.pop();
    expect(ambiente.pestanas.mostrar).toEqual(tabsBefore);
  });

  it('emptyEnvironmentEditableFields limpia la identidad pero conserva tema y pestañas', () => {
    const fields = emptyEnvironmentEditableFields(ambiente);
    expect(fields.nombre).toBe('');
    expect(fields.tagline).toBe('');
    expect(fields.icono).toBe('');
    expect(fields.frasesEs).toBe('');
    expect(fields.frasesEn).toBe('');
    expect(fields.decoracion).toBe(ambiente.tema.decoracion);
    expect(fields.tabs).toEqual([...ambiente.pestanas.mostrar]);
  });
});

// ------------------------------------------------------------
describe('buildAmbientePayload — payload completo desde plantilla', () => {
  it('deriva el id canónico del nombre (slug) y recorta identidad', () => {
    const payload = buildAmbientePayload(TEMPLATE, buildFields({ nombre: '  Modo Selva  ' }));
    expect(payload.id).toBe('modo-selva');
    expect(payload.nombre).toBe('Modo Selva');
  });

  it('divide frases por línea descartando líneas vacías', () => {
    const payload = buildAmbientePayload(
      TEMPLATE,
      buildFields({ frasesEs: 'actúa como explorador\n  \nbusca el tesoro' })
    );
    expect(payload.frasesActivacion.es).toEqual(['actúa como explorador', 'busca el tesoro']);
    expect(payload.frasesActivacion.en).toEqual(['act as an explorer']);
  });

  it('inyecta solo las variables CSS con valor no vacío (recortado)', () => {
    const payload = buildAmbientePayload(
      TEMPLATE,
      buildFields({
        vars: { 'flu-accent': '  #1b5e20  ', 'flu-bg': '', 'flu-text': '   ' },
      })
    );
    expect(payload.tema.vars).toEqual({ 'flu-accent': '#1b5e20' });
  });

  it('respeta decoración y pestañas editadas', () => {
    const payload = buildAmbientePayload(
      TEMPLATE,
      buildFields({ decoracion: 'heart', tabs: ['minutes', 'system'] })
    );
    expect(payload.tema.decoracion).toBe('heart');
    expect(payload.pestanas.mostrar).toEqual(['minutes', 'system']);
  });

  it('produce un payload que pasa la validación estricta del esquema', () => {
    expect(ambienteSchema.validate(validPayload())).toBeNull();
  });

  it('no muta la plantilla de origen', () => {
    const template = structuredClone(TEMPLATE);
    buildAmbientePayload(TEMPLATE, buildFields({ nombre: 'Otra Selva', decoracion: 'flower' }));
    expect(TEMPLATE).toEqual(template);
  });
});

// ------------------------------------------------------------
describe('mergeCatalog / cloneBuiltin — fusión built-ins + dinámicos', () => {
  const builtins = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];

  it('mantiene los built-ins primero y añade los dinámicos después', () => {
    const dynamic = [
      { id: 'c', label: 'C' },
      { id: 'd', label: 'D' },
    ];
    const merged = mergeCatalog(builtins, dynamic);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('omite dinámicos con id reservado o duplicado', () => {
    const dynamic = [
      { id: 'a', label: 'Reservado' },
      { id: 'c', label: 'C' },
      { id: 'c', label: 'C duplicado' },
      { id: 'd', label: 'D' },
    ];
    const merged = mergeCatalog(builtins, dynamic);
    expect(merged).toHaveLength(4);
    expect(merged.map((item) => item.id)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('nunca muta el arreglo de built-ins', () => {
    const snapshot = structuredClone(builtins);
    mergeCatalog(builtins, [{ id: 'x', label: 'X' }]);
    expect(builtins).toEqual(snapshot);
  });

  it('isReservedId detecta ids pertenecientes a los built-ins', () => {
    expect(isReservedId('a', builtins)).toBe(true);
    expect(isReservedId('x', builtins)).toBe(false);
  });

  it('cloneBuiltin produce una copia profunda con id sustituido', () => {
    const source = { id: 'a', label: 'A', nested: { deep: [1, 2, 3] } };
    const copy = cloneBuiltin(source, 'modo-selva');
    expect(copy.id).toBe('modo-selva');
    expect(copy.label).toBe('A');
    copy.nested.deep.push(4);
    expect(source.nested.deep).toEqual([1, 2, 3]);
  });
});

// ------------------------------------------------------------
describe('ambienteSchema — validación estricta', () => {
  it('acepta un payload completo válido', () => {
    expect(ambienteSchema.validate(validPayload())).toBeNull();
  });

  it('rechaza ids que no son slugs', () => {
    const payload = validPayload();
    payload.id = 'Modo Selva';
    expect(ambienteSchema.validate(payload)).toMatch(/slug/);
  });

  it('rechaza claves CSS no permitidas en tema.vars', () => {
    const payload = validPayload();
    (payload.tema.vars as Record<string, unknown>)['flu-extra'] = '#000';
    expect(ambienteSchema.validate(payload)).toMatch(/clave no permitida/);
  });

  it('rechaza valores de color CSS inválidos en tema.vars', () => {
    const payload = validPayload();
    (payload.tema.vars as Record<string, unknown>)['flu-accent'] = 'not-a-color';
    expect(ambienteSchema.validate(payload)).toMatch(/color CSS/);
  });

  it('rechaza decoraciones no soportadas', () => {
    const payload = validPayload();
    (payload.tema as { decoracion: unknown }).decoracion = 'dragon';
    expect(ambienteSchema.validate(payload)).toMatch(/decoracion/);
  });

  it('rechaza pestanas vacías', () => {
    const payload = validPayload();
    payload.pestanas.mostrar = [];
    expect(ambienteSchema.validate(payload)).toMatch(/pestanas/);
  });

  it('rechaza pestanas no válidas (fuera del catálogo)', () => {
    const payload = validPayload();
    (payload.pestanas as { mostrar: unknown[] }).mostrar = ['chat'];
    expect(ambienteSchema.validate(payload)).toMatch(/pestanas/);
  });

  it('acepta voz.instrucciones vacía (vacío = sin instrucciones de rol, como el asistente)', () => {
    const payload = validPayload();
    payload.voz.instrucciones = '';
    expect(ambienteSchema.validate(payload)).toBeNull();
  });

  it('acepta voz.instrucciones con solo espacios (equivale a vacío en el runtime)', () => {
    const payload = validPayload();
    payload.voz.instrucciones = '   ';
    expect(ambienteSchema.validate(payload)).toBeNull();
  });

  it('rechaza voz.instrucciones que no es texto', () => {
    const payload = validPayload();
    (payload.voz as { instrucciones: unknown }).instrucciones = 42;
    expect(ambienteSchema.validate(payload)).toMatch(/instrucciones/);
  });

  it('rechaza voz.frases que no son arreglos', () => {
    const payload = validPayload();
    (payload.voz as { frases: unknown }).frases = { es: 'no-array', en: [] };
    expect(ambienteSchema.validate(payload)).toMatch(/frases/);
  });

  it('rechaza payloads no-objeto', () => {
    expect(ambienteSchema.validate(null as unknown as EnvironmentDefinition)).toBe('payload inválido');
  });

  it('rechaza bienvenida vacía', () => {
    const payload = validPayload();
    payload.bienvenida.es = '';
    expect(ambienteSchema.validate(payload)).toMatch(/bienvenida/);
  });
});

// ------------------------------------------------------------
describe('caché fusionada — setMergedAmbientes / resetMergedAmbientes', () => {
  it('arranca apuntando al catálogo built-in (referencia idéntica)', () => {
    expect(getAmbientes()).toBe(ENVIRONMENTS);
  });

  it('setMergedAmbientes sustituye la caché y actualiza los getters', () => {
    const dinamico = cloneBuiltin(ENVIRONMENTS[0], 'modo-selva');
    dinamico.nombre = 'Modo Selva';
    const merged = [...ENVIRONMENTS, dinamico];
    setMergedAmbientes(merged);

    expect(getAmbientes()).toBe(merged);
    expect(isAmbienteId('modo-selva')).toBe(true);
    expect(getAmbiente('modo-selva')?.nombre).toBe('Modo Selva');
    expect(getAmbiente('asistente')).toBeDefined();
  });

  it('los getters reflejan pestanas y variables CSS del ambiente dinámico', () => {
    const dinamico = cloneBuiltin(ENVIRONMENTS[0], 'modo-selva');
    dinamico.pestanas.mostrar = ['workspace', 'conversation'];
    dinamico.tema.vars = { 'flu-accent': '#1b5e20' };
    setMergedAmbientes([...ENVIRONMENTS, dinamico]);

    expect(getVisibleTabIds('modo-selva')).toEqual(['workspace', 'conversation']);
    expect(getEnvironmentCssVars('modo-selva')).toEqual({ 'flu-accent': '#1b5e20' });
  });

  it('resetMergedAmbientes restaura el catálogo built-in', () => {
    setMergedAmbientes([...ENVIRONMENTS, cloneBuiltin(ENVIRONMENTS[0], 'modo-selva')]);
    resetMergedAmbientes();

    expect(getAmbientes()).toBe(ENVIRONMENTS);
    expect(isAmbienteId('modo-selva')).toBe(false);
    expect(getAmbiente('modo-selva')).toBeUndefined();
  });

  it('los ids desconocidos devuelven valores seguros por defecto', () => {
    expect(getAmbiente('inexistente')).toBeUndefined();
    expect(isAmbienteId('inexistente')).toBe(false);
    expect(getVisibleTabIds('inexistente')).toHaveLength(ENVIRONMENT_TAB_IDS.length);
    expect(getEnvironmentCssVars('inexistente')).toEqual({});
  });
});
