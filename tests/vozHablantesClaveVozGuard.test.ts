// ============================================================
// vozHablantesClaveVozGuard (P11.10) - el NOMBRE sale de la VOZ, no de la clave/etiqueta.
// ------------------------------------------------------------
// MEDIDO EN VIVO 2026-10-13 (debug.log del dueno, 03:30:40-03:36:26): el nombre se pegaba
// a la CLAVE derivada de la etiqueta (speaker_N), que la diarizacion reutiliza/renombra
// (row-update voz="speaker_1" nombre="Luis" y despues el MISMO speaker_1 sin nombre), y la
// identidad contra la BASE usaba el piso de la SESION (0.66) en vez del de identidad
// registrada (cosineRegisteredMatchThreshold 0.76).
//
// INVARIANTES (una regla, un sitio: speakerDirectory):
//   I1 una etiqueta reciclada NO hereda el nombre de otra voz (fila con firma medida).
//   I2 la fila con VOZ medida resuelve el nombre por su VECTOR; sin coincidencia no hereda.
//   I4 la BASE exige su propio piso (0.76) y el MODELO; la SESION conserva el suyo (0.66).
// ============================================================
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  registerVoiceName,
  resetVoiceDirectory,
  resolveVoiceIdentity,
} from '../src/voice/lib/speakerDirectory.js'
import { resolveRowSpeakerLabel } from '../src/voice/lib/conversationRow.js'
import { compareCosineSignatures } from '../src/voice/lib/speakerCore.js'
import { getModelId } from '../src/voice/lib/embeddingConfig.js'

/** Vector unitario base (eje 0). */
const EJE = (() => {
  const v = new Array(512).fill(0)
  v[0] = 1
  return v
})()

/** Vector con COSENO EXACTO `cos` respecto a la base (mismo primer eje, segundo eje en t). */
function conCoseno(base: number[], cos: number): number[] {
  const t = Math.sqrt(1 / (cos * cos) - 1)
  const v = base.slice()
  v[1] = t
  return v
}

const V_LUIS = EJE.slice()
const V_MISMA_VOZ = conCoseno(EJE, 0.8)
const V_BANDA_MEDIA = conCoseno(EJE, 0.7)
const V_MUJER = conCoseno(EJE, 0.55)
const MODELO = getModelId()

beforeEach(() => {
  resetVoiceDirectory()
})
afterEach(() => {
  resetVoiceDirectory()
})

describe('P11.10 - la fila resuelve su nombre por la VOZ, no por la clave', () => {
  it('I1/I2: una etiqueta RECICLADA no hereda el nombre de otra voz (fila con su firma)', () => {
    registerVoiceName('speaker_1', 'Luis', { vector: V_LUIS })
    // La voz de la mujer reutiliza la etiqueta "Hablante 1" -> misma clave speaker_1.
    expect(compareCosineSignatures(V_MUJER, V_LUIS)).toBeLessThan(0.66)
    const fila = { speakerId: 'speaker_1', signature: V_MUJER }
    expect(resolveRowSpeakerLabel(fila), 'la etiqueta reciclada NO puede heredar "Luis"').not.toBe('Luis')
    expect(resolveRowSpeakerLabel(fila)).toBe('Hablante 1')
  })

  it('I2: la MISMA voz (su vector) SI lleva su nombre', () => {
    registerVoiceName('speaker_1', 'Luis', { vector: V_LUIS })
    const fila = { speakerId: 'speaker_1', signature: V_MISMA_VOZ }
    expect(resolveRowSpeakerLabel(fila)).toBe('Luis')
  })

  it('compatibilidad: una fila SIN firma sigue resolviendo por la clave (no se toca)', () => {
    registerVoiceName('speaker_1', 'Luis', { vector: V_LUIS })
    expect(resolveRowSpeakerLabel({ speakerId: 'speaker_1' })).toBe('Luis')
    expect(resolveRowSpeakerLabel({ speakerId: 'speaker_name_luis' })).toBe('Luis')
  })

  it('compatibilidad: el renombre MANUAL (sin vector) se honra aunque la fila traiga firma', () => {
    registerVoiceName('speaker_3', 'Ana')
    expect(resolveRowSpeakerLabel({ speakerId: 'speaker_3', signature: V_MUJER })).toBe('Ana')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): un nombre-pegado-a-clave no vacia a la fila', () => {
    registerVoiceName('speaker_name_luis', 'Luis', { vector: V_LUIS })
    const suya = { speakerId: 'speaker_name_luis', signature: V_LUIS }
    const ajena = { speakerId: 'speaker_name_luis', signature: V_MUJER }
    expect(resolveRowSpeakerLabel(suya)).toBe('Luis')
    expect(resolveRowSpeakerLabel(ajena), 'una voz distinta NO puede mostrar el nombre ajeno').not.toBe('Luis')
  })
})

describe('P11.10 - el piso de la BASE es el de identidad registrada (I4, con MODELO)', () => {
  it('la BASE (candidatos) exige 0.76: una similitud de 0.70 NO casa', () => {
    const candidatos = [{ name: 'Luis', vector: V_LUIS, model: MODELO }]
    expect(resolveVoiceIdentity(V_BANDA_MEDIA, { candidates: candidatos }), 'la base no puede casar en la banda de la sesion').toBeNull()
  })

  it('la BASE SI casa con la misma voz (0.80) y con el MISMO modelo', () => {
    const candidatos = [{ name: 'Luis', vector: V_LUIS, model: MODELO }]
    const r = resolveVoiceIdentity(V_MISMA_VOZ, { candidates: candidatos })
    expect(r?.name).toBe('Luis')
  })

  it('I4: un vector de OTRO modelo NO se compara (ni en la base ni en la sesion)', () => {
    const candidatos = [{ name: 'Luis', vector: V_LUIS, model: 'modelo-viejo' }]
    expect(resolveVoiceIdentity(V_MISMA_VOZ, { candidates: candidatos })).toBeNull()
    registerVoiceName('speaker_1', 'Luis', { vector: V_LUIS, model: 'modelo-viejo' })
    expect(resolveVoiceIdentity(V_MISMA_VOZ)).toBeNull()
  })

  it('la SESION conserva su piso (0.66): 0.70 ya es la misma voz dentro de la reunion', () => {
    registerVoiceName('speaker_1', 'Luis', { vector: V_LUIS })
    const r = resolveVoiceIdentity(V_BANDA_MEDIA)
    expect(r?.name).toBe('Luis')
  })

  it('PRUEBA DE DETECTOR (el detector no es decorativo): si los DOS pisos son el de sesion, la base casa en 0.70', () => {
    const candidatos = [{ name: 'Luis', vector: V_LUIS, model: MODELO }]
    const conPisoDeSesion = resolveVoiceIdentity(V_BANDA_MEDIA, { candidates: candidatos, registeredFloor: 0.66 })
    expect(conPisoDeSesion?.name, 'asi se comportaba el defecto medido').toBe('Luis')
  })
})