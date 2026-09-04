// ============================================================
// environmentPrompt.test.ts — FASE A: el LLM interpreta la esencia
// de la orden (ambientes dinámicos, sin coincidencia literal)
// ============================================================
// Demuestra que el prompt de ambientes es DATOS (catálogo fusionado
// built-ins + dinámicos), no un catálogo duro: un ambiente dinámico
// registrado en la caché aparece en el prompt sin tocar el código.
// Cero literales: los ids/nombres/frases se derivan del catálogo real.
import { describe, test, expect, afterEach } from 'vitest'
import { buildAmbientePrompt } from '../src/core/environments/environmentPrompt'
import {
  ENVIRONMENTS,
  getAmbientes,
  getAmbiente,
  setMergedAmbientes,
  resetMergedAmbientes,
  DEFAULT_AMBIENTE_ID,
} from '../src/core/environments/environmentRegistry'
import { cloneBuiltin } from '../src/core/catalogs/mergeCatalog'
import { buildSystemPrompt, buildMinimalContractSchema } from '../src/voice/lib/gemini'

afterEach(() => {
  resetMergedAmbientes()
})

describe('buildAmbientePrompt — catálogo built-in (datos reales, cero literales)', () => {
  test('enlista cada ambiente del catálogo con su id y nombre reales', () => {
    const prompt = buildAmbientePrompt('es')
    const ambientes = getAmbientes()
    expect(ambientes.length).toBeGreaterThan(0)
    for (const ambiente of ambientes) {
      expect(prompt).toContain(`"${ambiente.id}"`)
      expect(prompt).toContain(ambiente.nombre)
    }
  })

  test('incluye frases de ejemplo reales del catálogo (es)', () => {
    const prompt = buildAmbientePrompt('es')
    const ambiente = getAmbiente(DEFAULT_AMBIENTE_ID)
    const frases = ambiente?.frasesActivacion.es ?? []
    expect(frases.length).toBeGreaterThan(0)
    expect(prompt).toContain(frases[0])
  })

  test('instruye volver al asistente por defecto con el id exacto', () => {
    const prompt = buildAmbientePrompt('es')
    expect(prompt).toContain(`Para volver al asistente por defecto, emite ambiente con el id exacto "${DEFAULT_AMBIENTE_ID}"`)
  })

  test('versión en inglés: instrucciones y frases en inglés', () => {
    const prompt = buildAmbientePrompt('en')
    const ambiente = getAmbiente(DEFAULT_AMBIENTE_ID)
    const frases = ambiente?.frasesActivacion.en ?? []
    expect(prompt).toContain('Available environments')
    expect(prompt).toContain(`"${DEFAULT_AMBIENTE_ID}"`)
    if (frases.length > 0) expect(prompt).toContain(frases[0])
  })
})

describe('buildAmbientePrompt — dinámico (prueba de que NO es catálogo duro)', () => {
  test('un ambiente dinámico registrado aparece en el prompt tras setMergedAmbientes', () => {
    const dinamico = cloneBuiltin(ENVIRONMENTS[0], 'modo-selva')
    dinamico.nombre = 'Modo Selva'
    setMergedAmbientes([...ENVIRONMENTS, dinamico])

    const prompt = buildAmbientePrompt('es')
    expect(prompt).toContain('"modo-selva"')
    expect(prompt).toContain('Modo Selva')
  })

  test('las frases del ambiente dinámico se propagan al prompt', () => {
    const dinamico = cloneBuiltin(ENVIRONMENTS[0], 'modo-selva')
    dinamico.frasesActivacion.es = ['hazme una guia de supervivencia en la selva']
    setMergedAmbientes([...ENVIRONMENTS, dinamico])

    const prompt = buildAmbientePrompt('es')
    expect(prompt).toContain('hazme una guia de supervivencia en la selva')
  })

  test('catálogo vacío → prompt vacío (guard de datos)', () => {
    setMergedAmbientes([])
    expect(buildAmbientePrompt('es')).toBe('')
    expect(buildAmbientePrompt('en')).toBe('')
  })

  test('resetMergedAmbientes restaura el catálogo built-in en el prompt', () => {
    const dinamico = cloneBuiltin(ENVIRONMENTS[0], 'modo-selva')
    dinamico.nombre = 'Modo Selva'
    setMergedAmbientes([...ENVIRONMENTS, dinamico])
    expect(buildAmbientePrompt('es')).toContain('Modo Selva')

    resetMergedAmbientes()
    expect(buildAmbientePrompt('es')).not.toContain('modo-selva')
  })
})

describe('buildSystemPrompt — inyección del bloque de ambientes (gemini.js)', () => {
  test('incluye el bloque ambiente y el id por defecto', () => {
    const prompt = buildSystemPrompt({
      role: '',
      theme: '',
      phase: '',
      language: 'es',
      includeConfig: true,
    })
    expect(prompt).toContain('ambiente')
    expect(prompt).toContain(`"${DEFAULT_AMBIENTE_ID}"`)
  })

  test('incluye el catálogo fusionado (dinámico) dentro del system prompt', () => {
    const dinamico = cloneBuiltin(ENVIRONMENTS[0], 'modo-selva')
    dinamico.nombre = 'Modo Selva'
    setMergedAmbientes([...ENVIRONMENTS, dinamico])

    const prompt = buildSystemPrompt({
      role: '',
      theme: '',
      phase: '',
      language: 'es',
      includeConfig: true,
    })
    expect(prompt).toContain('"modo-selva"')
  })
})

describe('buildMinimalContractSchema — campo ambiente en el schema mínimo', () => {
  test('el campo ambiente es nullable y NO es requerido', () => {
    const schema = buildMinimalContractSchema()
    expect(schema.properties.ambiente).toEqual({ type: 'string', nullable: true })
    expect(schema.required).not.toContain('ambiente')
  })
})
