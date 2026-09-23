import { slugifyPalette } from '../branding/paletaFactory';
// ============================================================
// Ambiente Factory — Construcción de payloads de ambientes (1A)
// ------------------------------------------------------------
// Capa pura entre el formulario de gestión (A5) y el esquema
// estricto `ambienteSchema`. El esquema exige una EnvironmentDefinition
// COMPLETA (bienvenida, voz, contenido, capVisible...), así que
// crear/clonar siempre parte de una PLANTILLA built-in clonada
// (structuredClone) y solo se sobrescriben los campos editables
// definidos en el plan A5:
//   nombre, tagline, icono, frasesActivacion es/en,
//   tema.vars, tema.decoracion, pestanas.mostrar.
// El resto (bienvenida, voz.*, contenido, capVisible) hereda de la
// plantilla, garantizando que el payload pase la validación.
//
// Regla #1: sin hardcode — los rangos permitidos (claves CSS,
// decoraciones, pestañas) vienen de environmentRegistry.
// ============================================================

import {
    ENVIRONMENT_CSS_VAR_KEYS,
    type EnvironmentCssVarKey,
    type EnvironmentDecoration,
    type EnvironmentDefinition,
    type EnvironmentTabId,
} from './environmentRegistry';

// -----------------------------------------------------------
// Slug de id
// -----------------------------------------------------------

/**
 * Convierte un nombre en un slug de id canónico (minúsculas,
 * dígitos y guiones simples, sin acentos ni caracteres extra).
 * Ej.: "Modo Selva" → "modo-selva", "Bosque Encantado" → "bosque-encantado".
 */
export function slugifyAmbiente(nombre: string): string {
    return slugifyPalette(nombre);
}

// -----------------------------------------------------------
// Campos editables (contrato del formulario A5)
// -----------------------------------------------------------

export interface EditableAmbienteFields {
    /** Nombre legible (se usa para derivar el slug de id). */
    nombre: string;
    /** Frase corta descriptiva. */
    tagline: string;
    /** Emoji/ícono representativo. */
    icono: string;
    /** Frases de activación ES, una por línea. */
    frasesEs: string;
    /** Frases de activación EN, una por línea. */
    frasesEn: string;
    /** Variables CSS `--flu-*` (clave sin prefijo). Valor vacío = no inyectar. */
    vars: Partial<Record<EnvironmentCssVarKey, string>>;
    /** Decoración 3D (null = la temporada estacional decide). */
    decoracion: EnvironmentDecoration;
    /** Pestañas visibles en este ambiente. */
    tabs: EnvironmentTabId[];
}

/**
 * Extrae los campos editables de un ambiente existente.
 * Las frases se agrupan una por línea para edición en textarea.
 */
export function editableFieldsOf(ambiente: EnvironmentDefinition): EditableAmbienteFields {
    return {
        nombre: ambiente.nombre,
        tagline: ambiente.tagline,
        icono: ambiente.icono,
        frasesEs: ambiente.frasesActivacion.es.join('\n'),
        frasesEn: ambiente.frasesActivacion.en.join('\n'),
        vars: { ...ambiente.tema.vars },
        decoracion: ambiente.tema.decoracion,
        tabs: [...ambiente.pestanas.mostrar],
    };
}

/**
 * Campos editables en blanco para el flujo "crear nuevo": conserva
 * el resto de la plantilla (tema, pestañas) pero limpia la identidad.
 */
export function emptyEditableFields(template: EnvironmentDefinition): EditableAmbienteFields {
    const base = editableFieldsOf(template);
    base.nombre = '';
    base.tagline = '';
    base.icono = '';
    base.frasesEs = '';
    base.frasesEn = '';
    return base;
}

// -----------------------------------------------------------
// Construcción del payload completo
// -----------------------------------------------------------

/** Divide líneas en frases (trim + descarta vacías). */
function splitPhrases(value: string): string[] {
    return value
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
}

/**
 * Construye una EnvironmentDefinition COMPLETA a partir de una
 * plantilla clonada y los campos editados. El id canónico se deriva
 * del nombre (slug). Devuelve una copia nueva (structuredClone);
 * nunca muta la plantilla.
 */
export function buildAmbientePayload(
    template: EnvironmentDefinition,
    fields: EditableAmbienteFields
): EnvironmentDefinition {
    const payload = structuredClone(template);

    payload.id = slugifyAmbiente(fields.nombre);
    payload.nombre = fields.nombre.trim();
    payload.tagline = fields.tagline.trim();
    payload.icono = fields.icono.trim();

    payload.frasesActivacion = {
        es: splitPhrases(fields.frasesEs),
        en: splitPhrases(fields.frasesEn),
    };

    // Tema: solo se inyectan las claves con valor no vacío.
    const vars: Partial<Record<EnvironmentCssVarKey, string>> = {};
    for (const key of ENVIRONMENT_CSS_VAR_KEYS) {
        const value = fields.vars[key];
        if (value && value.trim()) {
            vars[key] = value.trim();
        }
    }
    payload.tema.vars = vars;
    payload.tema.decoracion = fields.decoracion;

    payload.pestanas.mostrar = [...fields.tabs];

    return payload;
}
