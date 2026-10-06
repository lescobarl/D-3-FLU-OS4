// ============================================================
// imageInsumo — el analisis de una IMAGEN subida entra al historial
// ------------------------------------------------------------
// Hueco medido (2026-10-06): para una imagen, App.tsx metia al historial SOLO
// `result.texto_extraido` y bajo `if (result.texto_extraido)`. Un DIBUJO (o una
// foto sin texto legible) no generaba NINGUN contexto, asi que FLU no podia
// continuar la explicacion (p. ej. tutoria en ingles sobre un dibujo). El propio
// analisis ya trae materia/problemas/instrucciones/nivel: aqui se exige que TODO
// eso entre al contexto, no solo el texto.
// GUARD: nace ROJO (el modulo no existe) y pasa cuando buildImageInsumo compone
// el insumo desde el analisis COMPLETO.
// ============================================================
import { describe, it, expect } from 'vitest'
import { buildImageInsumo } from '../src/core/documents/imageInsumo'

const CON_TEXTO = {
    materia: 'Matematicas',
    problemas: ['3+4', '5x2'],
    instrucciones: 'Resolver y entregar el lunes',
    nivel: 'primaria',
    texto_extraido: 'Tarea de matematicas: 3+4 y 5x2',
}

const DIBUJO_SIN_TEXTO = {
    materia: 'Ingles',
    problemas: [],
    instrucciones: 'Describe el dibujo en ingles y practica vocabulario',
    nivel: 'basico',
    texto_extraido: '',
}

const VACIO = { materia: '', problemas: [], instrucciones: '', nivel: '', texto_extraido: '' }

describe('imageInsumo — el analisis de imagen entra al historial (no solo el texto)', () => {
    it('una imagen CON texto lleva el texto y la materia', () => {
        const out = buildImageInsumo(CON_TEXTO, 'es')
        expect(out).toBeTruthy()
        expect(out).toContain('Matematicas')
        expect(out).toContain('Tarea de matematicas')
    })

    it('un DIBUJO (sin texto) genera contexto con materia/instrucciones', () => {
        const out = buildImageInsumo(DIBUJO_SIN_TEXTO, 'es')
        expect(out, 'un dibujo sin texto NO puede quedarse sin contexto').toBeTruthy()
        expect(out).toContain('Ingles')
        expect(out).toContain('Describe el dibujo')
    })

    it('en ingles el insumo sale en ingles', () => {
        const out = buildImageInsumo(DIBUJO_SIN_TEXTO, 'en')
        expect(out).toMatch(/image/i)
        expect(out).toContain('Ingles')
    })

    it('un analisis VACIO no inventa contexto', () => {
        expect(buildImageInsumo(VACIO, 'es')).toBeNull()
        expect(buildImageInsumo(null, 'es')).toBeNull()
        expect(buildImageInsumo(undefined, 'es')).toBeNull()
    })
})

// Prueba de detector (P2.4): el criterio marca el analisis de dibujo como
// "con contexto" y no marca el vacio; no es un guard decorativo.
describe('imageInsumo — el detector discrimina', () => {
    it('marca el dibujo y no marca el vacio', () => {
        expect(buildImageInsumo(DIBUJO_SIN_TEXTO, 'es')).not.toBeNull()
        expect(buildImageInsumo(VACIO, 'es')).toBeNull()
    })
})
