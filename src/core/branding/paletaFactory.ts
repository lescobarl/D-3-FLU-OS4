// ============================================================
// Paleta Factory — Construcción de payloads de paletas (1B)
// ------------------------------------------------------------
// Capa pura entre el formulario de gestión (B4) y el esquema
// estricto `paletaSchema`. El esquema exige una PaletteDefinition
// COMPLETA (las 13 claves CSS del set de variables de la paleta,
// cada una #RRGGBB), así que crear/clonar siempre parte de una
// PLANTILLA built-in clonada (structuredClone) y solo se
// sobrescriben los campos editables definidos en el plan B1:
//   name, colors (13 claves), decoration?, cssClass?.
// El id canónico se deriva del nombre (slugifyPalette).
//
// Regla #1: sin hardcode — las claves CSS provienen de
// PALETTE_COLOR_KEYS (seasonalPalettes).
// ============================================================

import { PALETTE_COLOR_KEYS, type PaletteDefinition } from './seasonalPalettes';
import { stripDiacriticsLower } from '../../lib/textUtils';

// -----------------------------------------------------------
// Slug de id
// -----------------------------------------------------------

/**
 * Convierte un nombre en un slug de id canónico (minúsculas,
 * dígitos y guiones simples, sin acentos ni caracteres extra).
 * Ej.: "Modo Neon" → "modo-neon", "Bosque Encantado" → "bosque-encantado".
 */
export function slugifyPalette(nombre: string): string {
    return stripDiacriticsLower(nombre)
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// -----------------------------------------------------------
// Campos editables (contrato del formulario B4)
// -----------------------------------------------------------

export type PaletteColorKey = (typeof PALETTE_COLOR_KEYS)[number];

export interface EditablePaletteFields {
    /** Nombre legible (se usa para derivar el slug de id). */
    name: string;
    /** Las 13 variables CSS de la paleta (cada una #RRGGBB). */
    colors: Record<PaletteColorKey, string>;
    /** Decoración del avatar 3D (vacío = sin decoración). */
    decoration: string;
    /** Clase CSS adicional (vacío = sin clase). */
    cssClass: string;
}

/**
 * Extrae los campos editables de una paleta existente. Los colores
 * opcionales ausentes se completan con cadena vacía para la edición.
 */
export function editableFieldsOf(palette: PaletteDefinition): EditablePaletteFields {
    const colors = {} as Record<PaletteColorKey, string>;
    for (const key of PALETTE_COLOR_KEYS) {
        colors[key] = palette.colors[key] ?? '';
    }
    return {
        name: palette.name,
        colors,
        decoration: palette.decoration ?? '',
        cssClass: palette.cssClass ?? '',
    };
}

/**
 * Campos editables en blanco para el flujo "crear nuevo": limpia la
 * identidad (name, decoration, cssClass) pero conserva los colores
 * de la plantilla, garantizando que el payload pase la validación.
 */
export function emptyEditableFields(template: PaletteDefinition): EditablePaletteFields {
    const base = editableFieldsOf(template);
    base.name = '';
    base.decoration = '';
    base.cssClass = '';
    return base;
}

// -----------------------------------------------------------
// Construcción del payload completo
// -----------------------------------------------------------

/**
 * Construye una PaletteDefinition COMPLETA a partir de una plantilla
 * clonada y los campos editados. El id canónico se deriva del nombre
 * (slug). Devuelve una copia nueva (structuredClone); nunca muta la
 * plantilla. decoration/cssClass solo se incluyen si tienen valor no
 * vacío (el esquema los permite opcionales pero no vacíos).
 */
export function buildPaletaPayload(
    template: PaletteDefinition,
    fields: EditablePaletteFields
): PaletteDefinition {
    const payload = structuredClone(template);

    payload.id = slugifyPalette(fields.name);
    payload.name = fields.name.trim();

    // Colores: siempre las 13 claves canónicas, valores recortados.
    const colors = {} as Record<PaletteColorKey, string>;
    for (const key of PALETTE_COLOR_KEYS) {
        colors[key] = (fields.colors[key] ?? '').trim();
    }
    payload.colors = colors;

    const decoration = fields.decoration.trim();
    if (decoration) {
        payload.decoration = decoration;
    } else {
        delete payload.decoration;
    }

    const cssClass = fields.cssClass.trim();
    if (cssClass) {
        payload.cssClass = cssClass;
    } else {
        delete payload.cssClass;
    }

    return payload;
}
