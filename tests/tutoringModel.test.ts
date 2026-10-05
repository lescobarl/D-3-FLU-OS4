// ============================================================
// tutoringModel - CONDUCTA del modelo de tutoria y de su consulta de avance.
//
// El hueco MEDIDO: FLU no tenia NADA de tutoria: ninguna area declarada, ninguna
// regla de pedagogia y ninguna forma de decir el avance real (la consulta "¿como
// voy en ingles?" caia al LLM, que solo puede inventarlo). Aqui se fija:
//   1. el vocabulario de areas (conocidas + cualquiera nueva),
//   2. la consulta de avance por area, resuelta con las MINUTAS (almacen unico),
//   3. la regla de pedagogia que se le da al modelo,
//   4. que no se rompe la consulta por numero de minuta (lo ya validado).
// ============================================================
import { describe, expect, it } from 'vitest'
import {
  buildTutoringRule,
  findKnownTutoringArea,
  isTutoringGlobalProgressQuery,
  isTutoringProgressQuery,
  parseTutoringProgressQuery,
  resolveMinuteTutoringArea,
  resolveTutoringArea,
  resolveTutoringLevel,
} from '../src/core/tutoring/tutoringModel'
import { buildTutoringProgress, listTutoringAreas, minuteCoversTutoringArea } from '../src/core/tutoring/tutoringProgress'
import { resolveMinuteQuery } from '../src/lib/minuteKnowledgeHelpers'
import { isMinuteKnowledgeRequest } from '../src/voice/lib/audioMath.js'
import { buildCapabilitiesPrompt } from '../src/services/capabilities'

const INGLES = { id: 'ingles', label: 'Inglés' }

const minute = (
  code: string,
  temaSesion: string,
  resumen: string,
  pendientes: string[] = [],
  siguientes: string[] = [],
) => ({
  historyCode: code,
  description: 'Clase',
  date: `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}`,
  summarySnapshot: {
    kind: 'minuta',
    titulo: 'Clase',
    tema_sesion: temaSesion,
    resumen,
    participantes: ['Hablante 1'],
    acuerdos: [],
    pendientes,
    siguientes_pasos: siguientes,
  },
})

const MINUTAS = [
  minute('260702-01', 'Practica de conversacion en ingles', 'Repasamos el past simple.', [], ['Practicar 10 verbos irregulares']),
  minute('260701-01', 'Clase de matematicas', 'Fracciones equivalentes.', ['Terminar la tarea'], []),
  minute('260630-01', 'Conversacion en ingles', 'Vocabulario de la casa.', ['Repasar preposiciones'], []),
]

describe('1. vocabulario de areas: una etiqueta, un sitio, y cualquiera es valida', () => {
  it('las conocidas vuelven a su id canonico (con o sin diacriticos, es o en)', () => {
    for (const label of ['ingles', 'Inglés', 'INGLES', 'English', 'ingles conversacional']) {
      expect(resolveTutoringArea(label), label).toEqual(INGLES)
    }
    expect(resolveTutoringArea('matematicas')).toEqual({ id: 'matematicas', label: 'Matemáticas' })
  })

  it('cualquier otra area se admite tal cual (id normalizado): "mejorar en cualquier area"', () => {
    expect(resolveTutoringArea('origami')).toEqual({ id: 'origami', label: 'origami' })
    expect(resolveTutoringArea('Historia del arte')).toEqual({ id: 'historia-del-arte', label: 'Historia del arte' })
    expect(resolveTutoringArea('')).toBeNull()
    expect(resolveTutoringArea('   ')).toBeNull()
  })

  it('el area se reconoce por palabra completa (no dentro de otra palabra)', () => {
    expect(findKnownTutoringArea('quiero practicar ingles')).toEqual(INGLES)
    expect(findKnownTutoringArea('vivo en un apartamento')).toBeNull()
  })

  it('el detector no es decorativo: distingue la mencion real', () => {
    expect(minuteCoversTutoringArea(MINUTAS[0], INGLES)).toBe(true)
    expect(minuteCoversTutoringArea(MINUTAS[1], INGLES)).toBe(false)
  })
})

describe('2. la consulta de avance por area tiene una forma reconocible', () => {
  it('la reconoce en es y en en', () => {
    for (const query of ['¿cómo voy en inglés?', 'como voy en ingles', 'mi avance en inglés', 'que tal voy en ingles', 'how am I doing in English', 'my progress in english']) {
      expect(parseTutoringProgressQuery(query), query).toEqual(INGLES)
    }
  })

  it('admite un area NUEVA dicha en la consulta', () => {
    expect(parseTutoringProgressQuery('¿cómo voy en origami?')).toEqual({ id: 'origami', label: 'origami' })
  })

  it('NO secuestra una charla normal ni una consulta que no es de avance', () => {
    for (const query of ['cuéntame un chiste', 'pon música', '¿cómo estás?', 'hablemos en inglés']) {
      expect(isTutoringProgressQuery(query), query).toBe(false)
    }
  })
})

describe('3. el avance se DERIVA de las minutas (almacen unico, sin tabla nueva)', () => {
  it('agrega solo las minutas del area, en el orden recibido', () => {
    const avance = buildTutoringProgress(MINUTAS, INGLES)
    expect(avance.sesiones).toBe(2)
    expect(avance.practicado).toEqual(['Repasamos el past simple.', 'Vocabulario de la casa.'])
    expect(avance.pendientes).toEqual(['Practicar 10 verbos irregulares', 'Repasar preposiciones'])
    expect(avance.ultimaFecha).toBe('2026-07-02')
  })

  it('el NIVEL sale de bandas aprobadas (0/1-2/3-5/6+), no de un umbral suelto', () => {
    expect(resolveTutoringLevel(0)).toEqual({ id: 'sin-empezar', label: 'sin empezar' })
    expect(resolveTutoringLevel(1).id).toBe('inicial')
    expect(resolveTutoringLevel(2).id).toBe('inicial')
    expect(resolveTutoringLevel(3).id).toBe('en-progreso')
    expect(resolveTutoringLevel(5).id).toBe('en-progreso')
    expect(resolveTutoringLevel(6).id).toBe('avanzado')
    expect(resolveTutoringLevel(99).id).toBe('avanzado')
    expect(resolveTutoringLevel(2, 'en').label).toBe('beginner')
  })

  it('la voz del avance dice el nivel (2 sesiones de ingles -> inicial)', () => {
    const result = resolveMinuteQuery('¿cómo voy en inglés?', MINUTAS, { language: 'es' })
    expect(result.contract?.respuesta_voz).toContain('Nivel: inicial')
    expect(result.contract?.workspace?.contenido || '').toContain('Nivel: inicial')
  })

  it('el dominio SUMA aciertos/errores que conto el tutor (P8.63) y da el % de acierto', () => {
    const m1 = { historyCode: '260702-01', summarySnapshot: { titulo: 'Clase', tema_sesion: 'Practica de ingles', resumen: 'Past simple.', practica: { aciertos: 8, errores: 2 } } }
    const m2 = { historyCode: '260701-01', summarySnapshot: { titulo: 'Clase', tema_sesion: 'Practica de ingles', resumen: 'Verbos.', practica: { aciertos: 4, errores: 2 } } }
    const avance = buildTutoringProgress([m1, m2], INGLES)
    expect(avance.dominio).toEqual({ aciertos: 12, errores: 4, precision: 75 })
  })

  it('sin datos de practica el dominio es 0/0 y NO se inventa en la voz', () => {
    const avance = buildTutoringProgress(MINUTAS, INGLES)
    expect(avance.dominio).toEqual({ aciertos: 0, errores: 0, precision: 0 })
    const result = resolveMinuteQuery('¿cómo voy en inglés?', MINUTAS, { language: 'es' })
    expect(result.contract?.respuesta_voz).not.toContain('Dominio')
  })

  it('la voz dice el dominio cuando el tutor lo conto (singular correcto)', () => {
    const m = { historyCode: '260702-01', summarySnapshot: { titulo: 'Clase', tema_sesion: 'Practica de ingles', resumen: 'Past simple.', practica: { aciertos: 9, errores: 1 } } }
    const result = resolveMinuteQuery('¿cómo voy en inglés?', [m], { language: 'es' })
    expect(result.contract?.respuesta_voz).toContain('Dominio: 9 aciertos y 1 error (90% de acierto)')
  })

  it('separa el avance DERIVADO: rango de sesiones + pendientes en curso vs anteriores', () => {
    // Sin umbrales inventados: "en curso" es lo pendiente de la ULTIMA sesion y
    // "anteriores" lo que estaba pendiente antes y ya no figura en la ultima.
    const avance = buildTutoringProgress(MINUTAS, INGLES)
    expect(avance.ultimaFecha).toBe('2026-07-02')
    expect(avance.primeraFecha).toBe('2026-06-30')
    expect(avance.enCurso).toEqual(['Practicar 10 verbos irregulares'])
    expect(avance.anteriores).toEqual(['Repasar preposiciones'])
  })

  it('sin minutas del area el avance es 0 (no se inventa nada)', () => {
    const avance = buildTutoringProgress(MINUTAS, { id: 'origami', label: 'origami' })
    expect(avance).toEqual({ area: { id: 'origami', label: 'origami' }, sesiones: 0, practicado: [], pendientes: [], ultimaFecha: '', primeraFecha: '', enCurso: [], anteriores: [], dominio: { aciertos: 0, errores: 0, precision: 0 } })
  })
})

describe('4. la consulta de avance la resuelve FLU en local (no la IA)', () => {
  it('"¿cómo voy en inglés?" devuelve contrato local con el avance REAL', () => {
    const result = resolveMinuteQuery('¿cómo voy en inglés?', MINUTAS, { language: 'es' })
    expect(result.mode).toBe('local')
    expect(result.diagnostics?.route).toBe('tutoring-progress')
    expect(result.contract?.respuesta_voz).toContain('Inglés')
    expect(result.contract?.respuesta_voz).toContain('2')
    expect(result.contract?.respuesta_voz).toContain('Practicar 10 verbos irregulares')
    expect(result.contract?.workspace?.contenido || '').toContain('Repasamos el past simple.')
  })

  it('sin sesiones del area lo dice honestamente (no inventa un avance)', () => {
    const result = resolveMinuteQuery('¿cómo voy en origami?', MINUTAS, { language: 'es' })
    expect(result.mode).toBe('local')
    expect(result.diagnostics?.route).toBe('tutoring-progress-empty')
    expect(result.contract?.respuesta_voz.toLowerCase()).toContain('todavía no')
  })

  it('la puerta de la KB de minutas reconoce la consulta de avance', () => {
    expect(isMinuteKnowledgeRequest('¿cómo voy en inglés?')).toBe(true)
  })

  it('no se rompe lo ya validado: la minuta POR NUMERO sigue resolviendose local', () => {
    const result = resolveMinuteQuery('minuta 1', MINUTAS, { language: 'es' })
    expect(result.mode).toBe('local')
    expect(result.diagnostics?.route).toBe('minute-lookup-hit')
    expect(result.contract?.respuesta_voz).toBeTruthy()
  })
})

describe('5. la regla de pedagogia que recibe el modelo tiene un solo dueno', () => {
  it('explica el metodo y el idioma de la practica, en los dos idiomas', () => {
    const es = buildTutoringRule('es')
    expect(es).toContain('REGLA DE TUTORÍA')
    expect(es).toContain('PRACTIQUE')
    expect(es).toContain('idioma')
    const en = buildTutoringRule('en')
    expect(en).toContain('TUTORING RULE')
    expect(en).toContain('PRACTICE')
  })

  it('llega al prompt de capacidades (es y en)', () => {
    expect(buildCapabilitiesPrompt('es')).toContain('REGLA DE TUTORÍA')
    expect(buildCapabilitiesPrompt('en')).toContain('TUTORING RULE')
  })
})

describe('6b. avance GLOBAL (todas las areas) sin nombrar ninguna (P8.64)', () => {
  it('reconoce la consulta global y NO secuestra una frase que solo empieza igual', () => {
    for (const q of ['¿cómo voy?', 'mi avance', 'que tal voy', 'como voy en general', 'how am I doing', 'my progress']) {
      expect(isTutoringGlobalProgressQuery(q), q).toBe(true)
    }
    for (const q of ['¿cómo voy a hacer esto?', 'hablemos en inglés', 'cuéntame un chiste', 'pon música']) {
      expect(isTutoringGlobalProgressQuery(q), q).toBe(false)
    }
  })

  it('lista las areas presentes en las minutas, sin repetir y en orden', () => {
    expect(listTutoringAreas(MINUTAS).map((a) => a.id)).toEqual(['ingles', 'matematicas'])
  })

  it('la resuelve EN LOCAL con las areas reales y su nivel', () => {
    const result = resolveMinuteQuery('¿cómo voy?', MINUTAS, { language: 'es' })
    expect(result.mode).toBe('local')
    expect(result.diagnostics?.route).toBe('tutoring-progress')
    expect(result.contract?.respuesta_voz).toContain('Inglés')
    expect(result.contract?.respuesta_voz).toContain('Matemáticas')
  })

  it('sin minutas lo dice honestamente (no inventa areas)', () => {
    const result = resolveMinuteQuery('¿cómo voy?', [], { language: 'es' })
    expect(result.mode).toBe('local')
    expect(result.diagnostics?.route).toBe('tutoring-progress-empty')
    expect(result.contract?.respuesta_voz.toLowerCase()).toContain('todavia no')
  })
})

describe('6. el area se puede ETIQUETAR en la minuta (P8.58): el texto deja de ser la unica via', () => {
  const taggeada = (code: string, area: string, tema: string, resumen: string) => ({
    historyCode: code,
    description: tema,
    date: `20${code.slice(0, 2)}-${code.slice(2, 4)}-${code.slice(4, 6)}`,
    summarySnapshot: { kind: 'minuta', titulo: tema, tema_sesion: tema, resumen, tutoring_area: area },
  })

  it('una clase de ingles resumida como Past simple CUENTA por su etiqueta', () => {
    // Es el hueco MEDIDO: ni el tema ni el resumen nombran el area; antes se perdia.
    const minuta = taggeada('261003-01', 'Inglés', 'Past simple', 'We practised irregular verbs.')
    expect(minuteCoversTutoringArea(minuta, INGLES)).toBe(true)
    const avance = buildTutoringProgress([minuta], INGLES)
    expect(avance.sesiones).toBe(1)
    expect(avance.practicado).toEqual(['We practised irregular verbs.'])
  })

  it('la etiqueta de OTRA area no cuenta', () => {
    const minuta = taggeada('261003-02', 'Matemáticas', 'Past simple', 'We practised irregular verbs.')
    expect(minuteCoversTutoringArea(minuta, INGLES)).toBe(false)
  })

  it('sin etiqueta se conserva el respaldo por texto (lo ya validado)', () => {
    const minuta = { historyCode: '261001-01', description: 'Clase', summarySnapshot: { titulo: 'Clase', tema_sesion: 'Practica de ingles', resumen: 'Vocabulario.' } }
    expect(minuteCoversTutoringArea(minuta, INGLES)).toBe(true)
  })

  it('la etiqueta se resuelve de la minuta Y de la conversacion (dueno unico)', () => {
    expect(resolveMinuteTutoringArea('Past simple', 'quiero practicar ingles conversacional')).toEqual(INGLES)
    expect(resolveMinuteTutoringArea('Past simple', '')).toBeNull()
    expect(resolveMinuteTutoringArea('Clase de matematicas', '')).toEqual({ id: 'matematicas', label: 'Matemáticas' })
  })

  it('una consulta de avance con la minuta etiquetada la cuenta EN LOCAL', () => {
    const minuta = taggeada('261003-01', 'Inglés', 'Past simple', 'We practised irregular verbs.')
    const result = resolveMinuteQuery('¿cómo voy en inglés?', [minuta], { language: 'es' })
    expect(result.mode).toBe('local')
    expect(result.diagnostics?.route).toBe('tutoring-progress')
    expect(result.contract?.respuesta_voz).toContain('1 sesión registrada')
  })

  it('la ultima sesion se presenta como FECHA legible, no como el codigo de la minuta', () => {
    // La minuta real guarda historyCode (YYMMDD-NN) y no una fecha: la voz lo leia
    // tal cual ("261005 01"). Debe sonar como fecha.
    const minuta = {
      historyCode: '261005-01',
      description: 'Clase',
      summarySnapshot: { titulo: 'Clase', tema_sesion: 'Practica de ingles', resumen: 'Vocabulario.' },
    }
    const result = resolveMinuteQuery('¿cómo voy en inglés?', [minuta], { language: 'es' })
    expect(result.contract?.respuesta_voz).toContain('5 de octubre de 2026')
    expect(result.contract?.respuesta_voz).not.toContain('261005')
  })
})
