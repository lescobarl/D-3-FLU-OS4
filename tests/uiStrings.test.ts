import { describe, expect, it } from 'vitest'
import { UI_STRINGS, pickText } from '../src/lib/uiStrings'

describe('uiStrings — el texto de UI sale del catalogo', () => {
    it('elige el idioma activo y cae a español si la clave no lo tiene', () => {
        expect(pickText('es', 'recordatorio')).toBe(UI_STRINGS.recordatorio.es)
        expect(pickText('en', 'recordatorio')).toBe(UI_STRINGS.recordatorio.en)
        expect(pickText('desconocido', 'recordatorio')).toBe(UI_STRINGS.recordatorio.es)
    })

    it('solo el codigo exacto en sale del español; un locale en-US cae a es', () => {
        expect(pickText('en-US', 'recordatorio')).toBe(UI_STRINGS.recordatorio.es)
        expect(pickText(undefined as unknown as string, 'recordatorio')).toBe(UI_STRINGS.recordatorio.es)
    })

    it('sustituye los marcadores con los parametros de la llamada', () => {
        expect(pickText('es', 'hoy_a_las_time', { time: '17:00' })).toBe('hoy a las 17:00')
        expect(pickText('en', 'hoy_a_las_time', { time: '17:00' })).toBe('today at 17:00')
    })

    it('admite varias sustituciones y numeros', () => {
        const p = { yyyy: 2026, mm: '03', dd: '09', time: '9:30' }
        expect(pickText('en', 'el_dd_mm_yyyy_a_las_time', p)).toBe('on 2026-03-09 at 9:30')
        expect(pickText('es', 'el_dd_mm_yyyy_a_las_time', p)).toBe('el 09/03/2026 a las 9:30')
    })

    it('deja el marcador intacto si falta el parametro, en vez de escribir undefined', () => {
        const sinParam = pickText('es', 'hoy_a_las_time')
        expect(sinParam).toBe(UI_STRINGS.hoy_a_las_time.es)
        expect(sinParam).toContain('{time}')
        expect(sinParam).not.toContain('undefined')
        expect(pickText('es', 'hoy_a_las_time', {})).toContain('{time}')
    })

    it('no toca el texto de las claves sin marcadores', () => {
        expect(pickText('es', 'recordatorio', { sobra: 'x' })).toBe(UI_STRINGS.recordatorio.es)
    })
})

describe('uiStrings — invariantes del catalogo', () => {
    const entradas = Object.entries(UI_STRINGS)
    const marcadores = (t: string) => [...t.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

    it('cada clave tiene las dos lenguas no vacias', () => {
        expect(entradas.length).toBeGreaterThan(50)
        for (const [clave, v] of entradas) {
            expect(v.es.length, clave).toBeGreaterThan(0)
            expect(v.en.length, clave).toBeGreaterThan(0)
        }
    })

    it('no hay dos claves con el mismo par de textos (el catalogo deduplica)', () => {
        const pares = entradas.map(([, v]) => v.es + '\u0000' + v.en)
        expect(pares.length).toBe(new Set(pares).size)
    })

    it('una plantilla usa los mismos marcadores en las dos lenguas', () => {
        for (const [clave, v] of entradas) {
            expect(marcadores(v.en), clave).toEqual(marcadores(v.es))
        }
    })
})
